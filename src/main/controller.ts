// 앱 상태의 단일 원본. 교사 화면의 모든 동작은 dispatch()를 거친다.
import type { AppData, ClassRoom, FullState, Notice, Runtime, Schedule, ScheduleLogEntry, SeatLayout, SeatingResult, StudentView, TimerDisplayMode } from '../shared/types';
import { newClass } from '../shared/defaults';
import { displayNames, isAway, mergeRoster, parseRosterText, MAX_STUDENTS } from '../shared/roster';
import { resultProblems, activeSeats, cleanGroups, cleanLayout, cycleGender, disabledKey, disabledList, drawSeating, FIXED_ISSUE_TEXT, genderKey, genderPattern, type GenderPattern, precheckSeating, reconcileAssignment, seatExists, seatLabel, setFixed, suggestLayout, validateFixed } from '../shared/seating';
import { eligibleStudents, pickStudents } from '../shared/picker';
import { evaluateTick, findConflicts, keyToMs, validateSchedule } from '../shared/schedule';
import { idleTimer, normalizeWarnFrom, pauseTimer, pendingAlerts, remainingMs, resetTimer, resumeTimer, setTimerMode, startTimer, tickTimer } from '../shared/timer';
import { buildStudentView } from '../shared/studentView';
import { clamp, formatClock, formatDateTimeKo, localDateKey, newId } from '../shared/util';

export interface Ports {
  persist(data: AppData): void;
  /** 지금 바로 디스크에 저장 (예약 실행 기록처럼 잃으면 안 되는 것) */
  persistNow(data: AppData): void;
  /** 학생 화면 표시 요청. inactive=true면 포커스를 빼앗지 않음. 표시하지 못하면 false */
  showStudent(opts: { inactive: boolean; reason: 'teacher' | 'schedule' | 'timer' }): boolean;
  hideStudent(): void;
  applyTopmost(on: boolean): void;
  playSound(p: { runId: string; sound: string; volume: number }): void;
  notify(title: string, body: string): void;
  broadcast(state: FullState): void;
  studentWindowStatus(): Runtime['studentWindow'];
  displays(): Runtime['displays'];
}

export type Action = { type: string; [k: string]: any };
export type ActionResult = { ok: boolean; error?: string; [k: string]: any };

export class Controller {
  data: AppData;
  rt: Omit<Runtime, 'studentWindow' | 'displays' | 'now'>;
  private broadcastQueued = false;
  now: () => number = () => Date.now();

  constructor(data: AppData, private ports: Ports, extra: { userDataPath: string; appVersion: string }) {
    this.data = data;
    this.rt = {
      timer: idleTimer({ durationMs: data.settings.lastTimerSec * 1000, activity: data.settings.timerActivity, sound: data.settings.timerSound, volume: data.settings.timerVolume, mode: data.settings.timerDisplayMode, warnFrom: data.settings.timerWarnFrom }),
      update: { status: 'idle', current: extra.appVersion },
      widget: { googleEvents: [], calStatus: {}, weather: null, meal: null, visible: false },
      seatingReveal: null,
      pickerReveal: null,
      notices: [],
      inTray: false,
      userDataPath: extra.userDataPath,
      appVersion: extra.appVersion,
    };
  }

  // ---------- 공통 ----------
  get today(): string {
    return localDateKey(this.now());
  }

  get cls(): ClassRoom {
    return this.data.classes.find((c) => c.id === this.data.currentClassId) ?? this.data.classes[0];
  }

  studentView(): StudentView {
    return buildStudentView(this.data, this.rt, this.now());
  }

  fullState(): FullState {
    // 구글 캘린더 주소(암호화 값 포함)는 화면으로 보내지 않는다
    const w = this.data.widget;
    const data = { ...this.data, widget: { ...w, calendars: w.calendars.map((c) => ({ ...c, urlEnc: c.urlEnc ? 'saved' : '' })) } };
    return {
      data,
      runtime: { ...this.rt, studentWindow: this.ports.studentWindowStatus(), displays: this.ports.displays(), now: this.now() },
      studentView: this.studentView(),
    };
  }

  changed(persist = true): void {
    if (persist) this.ports.persist(this.data);
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      this.ports.broadcast(this.fullState());
    });
  }

  notice(level: Notice['level'], message: string): void {
    this.rt.notices = [...this.rt.notices.slice(-6), { id: newId('n_'), at: this.now(), level, message }];
  }

  log(kind: ScheduleLogEntry['kind'], message: string, extra: Partial<ScheduleLogEntry> = {}): void {
    this.data.scheduleLog = [...this.data.scheduleLog, { id: newId('l_'), at: this.now(), kind, message, acknowledged: kind === 'fired' || kind === 'info', ...extra }].slice(-200);
  }

  // ---------- 타이머 / 학생 화면 ----------

  /** 타이머를 학생 화면에서 내린다 (종료 상태면 완전히 닫음) */
  private dismissTimerForOtherView(): void {
    const t = this.rt.timer;
    if (t.status === 'finished' || t.status === 'idle') this.rt.timer = { ...idleTimer(t), shown: false };
    else this.rt.timer = { ...t, shown: false };
    this.ports.applyTopmost(false);
  }

  private showTimerOnStudent(reason: 'timer' | 'schedule'): boolean {
    const ok = this.ports.showStudent({ inactive: reason === 'schedule', reason });
    this.ports.applyTopmost(this.rt.timer.shown);
    return ok;
  }

  tick(): void {
    const now = this.now();
    // 종료 예고음: 정한 시점부터 끝날 때까지 1초마다
    const al = pendingAlerts(this.rt.timer, now);
    if (al.play.length) {
      const t = this.rt.timer;
      this.rt.timer = { ...t, alerted: [...t.alerted.slice(-400), ...al.play.map((x) => x.key)] };
      if (t.volume > 0) for (const x of al.play) this.ports.playSound({ runId: `${t.runId}-${x.key}`, sound: x.kind, volume: t.volume });
    }
    // 타이머 종료 감지
    const r = tickTimer(this.rt.timer, now);
    if (r.justFinished) {
      this.rt.timer = r.timer;
      if (r.timer.sound !== 'none' && r.timer.volume > 0) this.ports.playSound({ runId: r.timer.runId, sound: r.timer.sound, volume: r.timer.volume });
      this.changed(false);
    }
    // 예약 감시 (창 표시 여부와 무관)
    this.checkSchedules(now);
  }

  checkSchedules(now = this.now()): void {
    let last = this.data.lastScheduleCheckAt || now - 1000;
    if (last > now) last = now - 1000; // 시계가 뒤로 바뀐 경우
    // PC 시각이 미래로 잘못 갔다가 돌아오면, 아직 오지 않은 시각의 처리 기록이 오늘 예약을 막는다 → 정리
    let dirty = false;
    for (const [id, key] of Object.entries(this.data.scheduleFired)) {
      if (keyToMs(key) > now + 60_000) {
        delete this.data.scheduleFired[id];
        dirty = true;
      }
    }
    if (dirty) this.log('info', 'PC 시각이 앞당겨졌다가 돌아온 것 같아, 아직 오지 않은 시각의 예약 처리 기록을 정리했습니다.');
    const res = evaluateTick(this.data.schedules, this.data.scheduleFired, last, now);
    this.data.lastScheduleCheckAt = now;
    for (const m of res.missed) {
      this.data.scheduleFired[m.schedule.id] = m.key;
      this.log('missed', `‘${m.schedule.name}’ 예약(${formatDateTimeKo(m.at)})을 놓쳤습니다. 앱이 꺼져 있었거나 PC가 절전 상태였습니다.`, { scheduleId: m.schedule.id, occurrence: m.key });
      if (m.schedule.repeat === 'once') m.schedule.enabled = false;
      dirty = true;
    }
    // 실행 기록을 학생 화면을 띄우기 전에 디스크에 먼저 저장한다.
    // (실행 직후 앱이 비정상 종료되어도 다시 켰을 때 같은 예약이 또 실행되지 않음.
    //  대신 저장 직후·표시 전에 종료되면 그 회차는 실행되지 않은 채 남는다: 중복보다 누락을 택함)
    for (const d of res.due) {
      this.data.scheduleFired[d.schedule.id] = d.key;
      if (d.schedule.repeat === 'once') d.schedule.enabled = false;
    }
    if (res.due.length) this.ports.persistNow(this.data);
    for (const d of res.due) {
      this.fireSchedule(d.schedule, d.key);
      dirty = true;
    }
    // lastScheduleCheckAt는 자주 바뀌므로 다른 변경이 있을 때나 1분마다만 저장
    if (dirty) this.changed(true);
    else if (Math.floor(now / 60000) !== Math.floor(last / 60000)) this.ports.persist(this.data);
  }

  /**
   * PC 시계가 바뀌었을 때(절전 아님): 진행 중 타이머의 종료 시각을 같이 옮겨 남은 시간을 그대로 유지한다.
   * deltaMs = (벽시계 변화) - (실제 흐른 시간)
   */
  onClockJump(deltaMs: number): void {
    const t = this.rt.timer;
    if (t.status === 'running') {
      this.rt.timer = { ...t, endAt: t.endAt + deltaMs };
      this.changed(false);
    }
  }

  fireSchedule(s: Schedule, key: string): void {
    const now = this.now();
    const prev = this.rt.timer;
    if (prev.status === 'running' || prev.status === 'paused') {
      const what = prev.source === 'schedule' ? `예약 타이머 ‘${this.data.schedules.find((x) => x.id === prev.scheduleId)?.name ?? ''}’` : '수동 타이머';
      this.log('replaced', `${what}${prev.activity ? `(${prev.activity})` : ''} — 남은 ${formatClock(remainingMs(prev, now))}을 중단하고 ‘${s.name}’ 예약 타이머로 전환했습니다.`, { scheduleId: s.id, occurrence: key, acknowledged: false });
    }
    this.rt.timer = startTimer({ durationMs: s.durationSec * 1000, activity: s.activity, sound: s.sound, volume: s.volume, mode: s.displayMode, source: 'schedule', scheduleId: s.id, warnFrom: s.warnFrom ?? 0 }, now);
    const shown = this.showTimerOnStudent('schedule');
    this.log('fired', `‘${s.name}’ 예약 타이머(${formatClock(s.durationSec * 1000)})를 시작했습니다.`, { scheduleId: s.id, occurrence: key });
    if (!shown) {
      this.log('no-display', `학생용 디스플레이가 연결되어 있지 않아 ‘${s.name}’ 타이머를 학생 화면에 표시하지 못했습니다. 타이머는 교사용 화면에서 진행 중입니다.`, { scheduleId: s.id, occurrence: key, acknowledged: false });
      this.notice('warn', '학생용 디스플레이가 없어 예약 타이머를 학생 화면에 표시하지 못했습니다.');
      this.ports.notify('예약 타이머 시작 — 학생 화면 없음', `‘${s.name}’ 타이머가 시작됐지만 학생용 디스플레이가 연결되어 있지 않습니다.`);
    } else if (this.rt.inTray) {
      this.ports.notify('예약 타이머 시작', `‘${s.name}’ ${formatClock(s.durationSec * 1000)} 타이머를 학생 화면에 표시했습니다.`);
    }
  }

  // ---------- 동작 처리 ----------
  dispatch(a: Action): ActionResult {
    try {
      const r = this.handle(a);
      return r ?? { ok: true };
    } catch (e: any) {
      console.error(e);
      return { ok: false, error: '처리 중 오류가 발생했습니다: ' + (e?.message ?? e) };
    } finally {
      this.changed(true);
    }
  }

  private findStudent(id: string) {
    return this.cls.students.find((s) => s.id === id);
  }

  /** 명단 변경 후 잘못된 연결 정리 */
  private sanitizeClass(c: ClassRoom): string[] {
    const ids = new Set(c.students.map((s) => s.id));
    const msgs: string[] = [];
    const before = c.seating.fixed.length;
    c.seating.fixed = c.seating.fixed.filter((f) => ids.has(f.studentId));
    if (c.seating.fixed.length !== before) msgs.push('삭제된 학생의 고정 자리 설정을 해제했습니다.');
    c.picker.pickedPool = c.picker.pickedPool.filter((id) => ids.has(id));
    for (const key of ['draft', 'confirmed'] as const) {
      const r = c.seating[key];
      if (r) c.seating[key] = { ...r, assignment: reconcileAssignment(r.assignment, c.students).assignment };
    }
    if (this.rt.seatingReveal && this.rt.seatingReveal.classId === c.id)
      this.rt.seatingReveal = { ...this.rt.seatingReveal, result: { ...this.rt.seatingReveal.result, assignment: reconcileAssignment(this.rt.seatingReveal.result.assignment, c.students).assignment } };
    return msgs;
  }

  private handle(a: Action): ActionResult | void {
    const c = this.cls;
    const now = this.now();
    switch (a.type) {
      // ----- 학급 -----
      case 'class/add': {
        const name = String(a.name ?? '').trim() || `새 학급 ${this.data.classes.length + 1}`;
        const nc = newClass(name.slice(0, 30));
        this.data.classes.push(nc);
        this.selectClass(nc.id);
        return { ok: true, id: nc.id };
      }
      case 'class/rename': {
        const t = this.data.classes.find((x) => x.id === a.id);
        const name = String(a.name ?? '').trim();
        if (!t || !name) return { ok: false, error: '학급 이름을 입력해 주세요.' };
        t.name = name.slice(0, 30);
        return;
      }
      case 'class/delete': {
        if (this.data.classes.length <= 1) return { ok: false, error: '학급이 하나뿐이라 삭제할 수 없습니다.' };
        this.data.classes = this.data.classes.filter((x) => x.id !== a.id);
        if (this.data.currentClassId === a.id) this.selectClass(this.data.classes[0].id);
        return;
      }
      case 'class/select':
        this.selectClass(a.id);
        return;

      // ----- 학생 -----
      case 'students/import': {
        const parsed = parseRosterText(String(a.text ?? ''));
        if (parsed.entries.length === 0) return { ok: false, error: '등록할 이름을 찾지 못했습니다.' };
        const r = mergeRoster(c.students, parsed.entries, a.mode === 'replace' ? 'replace' : 'append');
        c.students = r.students;
        const msgs = this.sanitizeClass(c);
        if (a.mode === 'replace') this.adjustLayoutForCount(c);
        return { ok: true, added: r.added, errors: [...r.errors, ...msgs, ...parsed.skipped.map((s) => `해석하지 못한 줄: ${s}`)] };
      }
      case 'student/add': {
        if (c.students.length >= MAX_STUDENTS) return { ok: false, error: `한 학급에는 최대 ${MAX_STUDENTS}명까지 등록할 수 있습니다.` };
        const name = String(a.name ?? '').trim();
        if (!name) return { ok: false, error: '이름을 입력해 주세요.' };
        const number = a.number ? Number(a.number) : null;
        const gender = a.gender === 'M' || a.gender === 'F' ? a.gender : null;
        const r = mergeRoster(c.students, [{ number: number && number > 0 ? Math.round(number) : null, name, gender }], 'append');
        if (r.added === 0) return { ok: false, error: r.errors[0] ?? '추가하지 못했습니다.' };
        c.students = r.students;
        return;
      }
      case 'student/update': {
        const s = this.findStudent(a.id);
        if (!s) return { ok: false, error: '학생을 찾을 수 없습니다.' };
        if (a.name !== undefined) {
          const name = String(a.name).trim();
          if (!name) return { ok: false, error: '이름은 비워 둘 수 없습니다.' };
          s.name = name.slice(0, 20);
        }
        if (a.number !== undefined) {
          const n = Math.round(Number(a.number));
          if (!(n >= 1 && n <= 999)) return { ok: false, error: '번호는 1 이상의 숫자로 입력해 주세요.' };
          if (c.students.some((x) => x.id !== s.id && x.number === n)) return { ok: false, error: `${n}번은 이미 다른 학생이 사용 중입니다.` };
          s.number = n;
          c.students.sort((x, y) => x.number - y.number);
        }
        if (a.absent !== undefined) s.absentDate = a.absent ? this.today : null;
        if (a.excluded !== undefined) s.excluded = !!a.excluded;
        if (a.gender !== undefined) s.gender = a.gender === 'M' || a.gender === 'F' ? a.gender : null;
        return;
      }
      case 'student/delete': {
        c.students = c.students.filter((s) => s.id !== a.id);
        const msgs = this.sanitizeClass(c);
        return { ok: true, messages: msgs };
      }
      case 'students/clearAbsent':
        for (const s of c.students) {
          s.absentDate = null;
          s.excluded = false;
        }
        return;

      // ----- 칠판 -----
      case 'board/updateDraft':
        this.data.boardDraft = { ...this.data.boardDraft, ...sanitizeBoardPatch(a.patch) };
        this.syncLiveBoard();
        return;
      case 'board/publish':
        this.publishBoard();
        return;
      case 'board/setLive':
        // 실시간 반영: 켜는 순간 지금 내용을 학생 화면에 표시하고, 이후 입력은 바로 반영
        this.data.settings.boardLive = !!a.value;
        if (this.data.settings.boardLive) this.publishBoard();
        return;
      case 'board/clearDraft':
        this.data.boardDraft = { ...this.data.boardDraft, text: '' };
        this.syncLiveBoard();
        return;
      case 'phrase/save': {
        const text = String(a.text ?? this.data.boardDraft.text);
        if (!text.trim()) return { ok: false, error: '저장할 문구가 없습니다.' };
        const title = String(a.title ?? '').trim() || text.split('\n')[0].slice(0, 20);
        this.data.phrases.push({ id: newId('p_'), title: title.slice(0, 30), text });
        return;
      }
      case 'phrase/delete':
        this.data.phrases = this.data.phrases.filter((p) => p.id !== a.id);
        return;
      case 'phrase/load': {
        const p = this.data.phrases.find((x) => x.id === a.id);
        if (p) this.data.boardDraft = { ...this.data.boardDraft, text: p.text };
        this.syncLiveBoard();
        return;
      }

      // ----- 학생 화면 -----
      case 'student/show':
        if (!this.ports.showStudent({ inactive: false, reason: 'teacher' }))
          return { ok: false, error: '학생용 디스플레이를 찾을 수 없습니다. 설정에서 디스플레이를 선택하거나 미리보기 창을 열어 주세요.' };
        this.ports.applyTopmost(this.rt.timer.shown && this.rt.timer.status !== 'idle');
        return;
      case 'student/hide':
        this.ports.applyTopmost(false);
        this.ports.hideStudent();
        return;
      case 'student/base': {
        const base = a.base as AppData['studentBase'];
        if (!['blank', 'board', 'seating', 'picker', 'widget'].includes(base)) return { ok: false };
        if (base === 'widget' && a.main) this.data.studentWidgetMain = a.main === 'board' ? 'board' : 'clock';
        if (base === 'seating' && !this.rt.seatingReveal && !c.seating.confirmed) return { ok: false, error: '확정된 자리 배치가 없습니다.' };
        this.data.studentBase = base;
        if (base === 'seating' && a.confirmed) this.rt.seatingReveal = null;
        // 학생용 위젯은 큰 칸에 타이머를 보여 주므로 진행 중인 타이머를 내리지 않는다
        if (a.dismissTimer !== false && base !== 'widget') this.dismissTimerForOtherView();
        this.ports.showStudent({ inactive: false, reason: 'teacher' });
        return;
      }

      // ----- 타이머 -----
      case 'timer/start': {
        const sec = clamp(Math.round(Number(a.durationSec)), 1, 180 * 60);
        if (!Number.isFinite(sec)) return { ok: false, error: '시간을 확인해 주세요.' };
        const mode: TimerDisplayMode = a.mode === 'full' ? 'full' : 'split';
        const warnFrom = normalizeWarnFrom(a.warnFrom ?? this.data.settings.timerWarnFrom);
        this.rt.timer = startTimer({ durationMs: sec * 1000, activity: String(a.activity ?? '').slice(0, 30), sound: a.sound ?? 'chime', volume: clamp(Number(a.volume ?? 70), 0, 100), mode, source: 'manual', warnFrom }, now);
        Object.assign(this.data.settings, { lastTimerSec: sec, timerActivity: this.rt.timer.activity, timerSound: this.rt.timer.sound, timerVolume: this.rt.timer.volume, timerDisplayMode: mode, timerWarnFrom: warnFrom });
        if (!this.showTimerOnStudent('timer')) this.notice('warn', '학생용 디스플레이가 없어 타이머는 교사용 화면에서만 진행됩니다.');
        return;
      }
      case 'timer/pause':
        this.rt.timer = pauseTimer(this.rt.timer, now);
        return;
      case 'timer/resume':
        this.rt.timer = resumeTimer(this.rt.timer, now);
        return;
      case 'timer/reset':
        if (this.rt.timer.status === 'idle') return;
        this.rt.timer = resetTimer(this.rt.timer);
        return;
      case 'timer/close': // 종료·닫기: 이전 학생 화면으로 복귀
        this.rt.timer = idleTimer(this.rt.timer);
        this.ports.applyTopmost(false);
        return;
      case 'timer/setMode': {
        const mode: TimerDisplayMode = a.mode === 'full' ? 'full' : 'split';
        this.rt.timer = setTimerMode(this.rt.timer, mode);
        this.data.settings.timerDisplayMode = mode;
        return;
      }
      case 'timer/setShown':
        if (this.rt.timer.status === 'idle') return;
        this.rt.timer = { ...this.rt.timer, shown: !!a.shown };
        if (a.shown) this.showTimerOnStudent('timer');
        else this.ports.applyTopmost(false);
        return;
      case 'timer/defaults':
        Object.assign(this.data.settings, pick(a.patch ?? {}, ['timerSound', 'timerVolume', 'timerActivity', 'lastTimerSec', 'timerDisplayMode']));
        if (a.patch?.timerWarnFrom !== undefined) this.data.settings.timerWarnFrom = normalizeWarnFrom(a.patch.timerWarnFrom);
        return;

      // ----- 예약 -----
      case 'schedule/save': {
        const s = a.schedule as Schedule;
        const existing = this.data.schedules.find((x) => x.id === s.id);
        const sched: Schedule = { ...s, id: existing ? s.id : newId('sch_'), createdAt: existing?.createdAt ?? now, activeSince: now };
        sched.days = [...new Set(sched.days)].sort();
        sched.warnFrom = normalizeWarnFrom(sched.warnFrom);
        const errors = validateSchedule(sched, now);
        if (errors.length) return { ok: false, error: errors.join('\n') };
        const conflicts = findConflicts(sched, this.data.schedules);
        if (conflicts.length) return { ok: false, error: `같은 시각(${sched.time})에 실행되는 예약이 있습니다: ${conflicts.map((x) => `‘${x.name}’`).join(', ')}\n시각이나 요일을 바꾸거나 기존 예약을 끈 뒤 저장해 주세요.` };
        if (existing) {
          // scheduleFired는 그대로 두어 이미 실행한 발생이 다시 실행되지 않게 한다
          Object.assign(existing, sched);
        } else this.data.schedules.push(sched);
        return { ok: true, id: sched.id };
      }
      case 'schedule/delete':
        this.data.schedules = this.data.schedules.filter((x) => x.id !== a.id);
        delete this.data.scheduleFired[a.id];
        return;
      case 'schedule/toggle': {
        const s = this.data.schedules.find((x) => x.id === a.id);
        if (!s) return;
        if (a.enabled) {
          const test = { ...s, enabled: true };
          const errors = validateSchedule(test, now);
          if (errors.length) return { ok: false, error: errors.join('\n') };
          const conflicts = findConflicts(test, this.data.schedules);
          if (conflicts.length) return { ok: false, error: `같은 시각에 실행되는 예약이 있어 켤 수 없습니다: ${conflicts.map((x) => `‘${x.name}’`).join(', ')}` };
          s.activeSince = now; // 꺼져 있던 동안의 발생은 놓침으로 보지 않음
        }
        s.enabled = !!a.enabled;
        return;
      }
      case 'schedule/runNow': {
        const s = this.data.schedules.find((x) => x.id === a.id);
        if (!s) return;
        this.fireSchedule(s, 'manual-' + now);
        return;
      }
      case 'log/ack':
        for (const e of this.data.scheduleLog) e.acknowledged = true;
        return;
      case 'log/clear':
        this.data.scheduleLog = [];
        return;

      // ----- 자리 배치 -----
      case 'seating/setLayout': {
        const prevType = c.seating.layout.type;
        const patch = { ...(a.layout as Partial<SeatLayout>) };
        if (patch.groups) patch.groups = cleanGroups(patch.groups);
        const l = cleanLayout({ ...c.seating.layout, ...patch });
        l.rows = clamp(Math.round(l.rows), 1, 10);
        l.pairCols = clamp(Math.round(l.pairCols), 1, 6);
        l.cols = clamp(Math.round(l.cols), 1, 12);
        l.pairsPerGroup = clamp(Math.round(l.pairsPerGroup), 1, 3);
        let note: string | undefined;
        // 형태를 바꿔 자리가 모자라면 줄을 늘려 준다
        if (patch.type && patch.type !== prevType) {
          const n = precheckSeating({ layout: l, students: c.students, fixed: [], excludeAway: c.seating.excludeAway, today: this.today }).participants.length;
          const cap = () => activeSeats(cleanLayout(l)).length;
          if (l.type === 'custom') {
            const before = Math.max(...l.groups.map((g) => g.rows));
            while (cap() < n && l.groups.some((g) => g.rows < 10)) l.groups = l.groups.map((g) => ({ ...g, rows: Math.min(10, g.rows + 1) }));
            const after = Math.max(...l.groups.map((g) => g.rows));
            if (after !== before) note = `자리가 모자라 분단 줄 수를 ${after}줄로 늘렸습니다.`;
          } else {
            const before = l.rows;
            while (cap() < n && l.rows < 10) l.rows++;
            if (l.rows !== before) note = `자리가 모자라 줄 수를 ${before}줄에서 ${l.rows}줄로 늘렸습니다.`;
          }
        }
        c.seating.layout = cleanLayout(l);
        return { ok: true, issues: this.fixedIssueTexts(c), note };
      }
      case 'seating/suggest': {
        const cur = c.seating.layout;
        const n = precheckSeating({ layout: cur, students: c.students, fixed: [], excludeAway: false, today: this.today }).participants.length;
        if (cur.type === 'custom') {
          // 분단별 설정은 분단 인원은 그대로 두고 줄 수만 학생 수에 맞춤
          const perRow = cur.groups.reduce((x, g) => x + g.size, 0);
          const rows = clamp(Math.ceil(n / perRow), 1, 10);
          c.seating.layout = cleanLayout({ ...cur, groups: cur.groups.map((g) => ({ ...g, rows })), disabledCustom: [] });
        } else {
          const sug = suggestLayout(n, cur.type, cur);
          c.seating.layout = cleanLayout({ ...cur, pairCols: sug.pairCols, cols: sug.cols, rows: sug.rows, [disabledKey(cur.type)]: [] });
        }
        return { ok: true, issues: this.fixedIssueTexts(c) };
      }
      case 'seating/toggleSeat': {
        const l = c.seating.layout;
        const key = disabledKey(l.type);
        const list = new Set(l[key]);
        if (list.has(a.seatId)) list.delete(a.seatId);
        else list.add(a.seatId);
        c.seating.layout = { ...l, [key]: [...list] };
        return { ok: true, issues: this.fixedIssueTexts(c) };
      }
      case 'seating/toggleGender': {
        const l = c.seating.layout;
        if (!seatExists(l, a.seatId)) return { ok: false, error: '없는 좌석입니다.' };
        if (disabledList(l).includes(a.seatId)) return { ok: false, error: '사용하지 않는 자리입니다.' };
        const key = genderKey(l.type);
        c.seating.layout = { ...l, [key]: cycleGender(l[key], a.seatId) };
        return;
      }
      case 'seating/genderPattern': {
        const l = c.seating.layout;
        c.seating.layout = { ...l, [genderKey(l.type)]: genderPattern(l, a.pattern as GenderPattern) };
        return;
      }
      case 'seating/setFixed': {
        if (!seatExists(c.seating.layout, a.seatId)) return { ok: false, error: '없는 좌석입니다.' };
        if (a.studentId && disabledList(c.seating.layout).includes(a.seatId)) return { ok: false, error: '사용하지 않는 자리에는 고정할 수 없습니다.' };
        if (a.studentId && !this.findStudent(a.studentId)) return { ok: false, error: '학생을 찾을 수 없습니다.' };
        c.seating.fixed = setFixed(c.seating.fixed, a.seatId, a.studentId ?? null);
        return;
      }
      case 'seating/unfixStudent':
        c.seating.fixed = c.seating.fixed.filter((f) => f.studentId !== a.studentId);
        return;
      case 'seating/clearFixed':
        c.seating.fixed = [];
        return;
      case 'seating/removeInvalidFixed': {
        const bad = new Set(validateFixed(c.seating.layout, c.students, c.seating.fixed).map((i) => i.seatId + '|' + i.studentId));
        c.seating.fixed = c.seating.fixed.filter((f) => !bad.has(f.seatId + '|' + f.studentId));
        return;
      }
      case 'seating/options':
        if (a.excludeAway !== undefined) c.seating.excludeAway = !!a.excludeAway;
        if (a.emptyPolicy !== undefined) c.seating.emptyPolicy = a.emptyPolicy === 'random' ? 'random' : 'back';
        return;
      case 'seating/draw': {
        const r = drawSeating({ layout: c.seating.layout, students: c.students, fixed: c.seating.fixed, excludeAway: c.seating.excludeAway, emptyPolicy: c.seating.emptyPolicy, today: this.today });
        if (!r.ok) return { ok: false, error: r.error };
        c.seating.draft = { id: newId('a_'), createdAt: now, layout: structuredClone(c.seating.layout), assignment: r.assignment };
        if (a.reveal) this.revealSeating(c, c.seating.draft);
        else if (this.rt.seatingReveal?.classId === c.id && this.data.studentBase === 'seating' && a.keepReveal) this.revealSeating(c, c.seating.draft);
        const names = displayNames(c.students);
        return {
          ok: true,
          skippedFixedAway: r.skippedFixedAway.map((f) => names.get(f.studentId)),
          issues: r.issues.map((i) => `${names.get(i.studentId) ?? '(삭제된 학생)'} — ${seatLabel(i.seatId)}: ${FIXED_ISSUE_TEXT[i.reason]}`),
          emptySeats: r.emptySeats,
          genderNotes: r.genderNotes,
        };
      }
      case 'seating/reveal': {
        const d = c.seating.draft;
        if (!d) return { ok: false, error: '먼저 자리를 추첨해 주세요.' };
        const bad = this.draftProblems(c);
        if (bad.length) return { ok: false, error: '미리 추첨한 뒤 명단이나 자리 조건이 바뀌어 이 결과를 공개할 수 없습니다. 다시 추첨해 주세요.\n' + bad.join('\n') };
        this.revealSeating(c, d);
        return;
      }
      case 'seating/skip':
        if (this.rt.seatingReveal) this.rt.seatingReveal = { ...this.rt.seatingReveal, animate: false };
        return;
      case 'seating/confirm': {
        const d = c.seating.draft;
        if (!d) return { ok: false, error: '확정할 배치가 없습니다.' };
        const bad = this.draftProblems(c);
        if (bad.length) return { ok: false, error: '미리 추첨한 뒤 명단이나 자리 조건이 바뀌어 이 결과를 확정할 수 없습니다. 다시 추첨해 주세요.\n' + bad.join('\n') };
        c.seating.confirmed = structuredClone(d);
        return;
      }
      case 'seating/save': {
        const src = c.seating.draft ?? c.seating.confirmed;
        if (!src) return { ok: false, error: '저장할 배치가 없습니다.' };
        const name = String(a.name ?? '').trim() || `${formatDateTimeKo(now)} 배치`;
        c.seating.saved = [...c.seating.saved, { ...structuredClone(src), id: newId('a_'), name: name.slice(0, 40) }].slice(-30);
        return;
      }
      case 'seating/loadSaved': {
        const s = c.seating.saved.find((x) => x.id === a.id);
        if (!s) return { ok: false, error: '저장된 배치를 찾을 수 없습니다.' };
        const rec = reconcileAssignment(s.assignment, c.students);
        c.seating.layout = structuredClone(s.layout);
        c.seating.draft = { id: newId('a_'), createdAt: now, layout: structuredClone(s.layout), assignment: rec.assignment };
        const warnings: string[] = [];
        if (rec.removed) warnings.push(`명단에서 삭제된 학생 ${rec.removed}명의 자리는 비웠습니다.`);
        if (rec.unseated.length) warnings.push(`저장 이후 추가된 학생(${rec.unseated.map((x) => x.name).join(', ')})은 자리가 없습니다. 다시 섞기로 새로 배치하세요.`);
        return { ok: true, warnings, issues: this.fixedIssueTexts(c) };
      }
      case 'seating/deleteSaved':
        c.seating.saved = c.seating.saved.filter((x) => x.id !== a.id);
        return;

      // ----- 발표 뽑기 -----
      case 'picker/options':
        if (a.count !== undefined) c.picker.count = clamp(Math.round(Number(a.count) || 1), 1, 30);
        if (a.mode !== undefined) c.picker.mode = a.mode === 'all' ? 'all' : 'unique';
        if (a.excludeAway !== undefined) c.picker.excludeAway = !!a.excludeAway;
        return;
      case 'picker/draw': {
        const input = { students: c.students, mode: c.picker.mode, excludeAway: c.picker.excludeAway, pickedPool: c.picker.pickedPool, count: c.picker.count, today: this.today };
        const elig = eligibleStudents(input);
        const r = pickStudents(input);
        if (!r.ok) return { ok: false, error: r.error, allDone: r.allDone };
        const names = displayNames(c.students);
        c.picker.pickedPool = r.newPool;
        const pickedNames = r.picked.map((s) => names.get(s.id) ?? s.name);
        c.picker.history = [...c.picker.history.filter((h) => h.at > now - 30 * 86400_000), { id: newId('h_'), at: now, date: this.today, mode: c.picker.mode, studentIds: r.picked.map((s) => s.id), names: pickedNames }].slice(-500);
        this.rt.pickerReveal = { revealId: newId('pr_'), animate: a.animate !== false, startedAt: now, names: pickedNames, poolNames: elig.map((s) => names.get(s.id) ?? s.name) };
        this.data.studentBase = 'picker';
        this.dismissTimerForOtherView();
        this.ports.showStudent({ inactive: false, reason: 'teacher' });
        return { ok: true, names: pickedNames, allDone: r.allDone, remaining: r.remainingAfter };
      }
      case 'picker/skip':
        if (this.rt.pickerReveal) this.rt.pickerReveal = { ...this.rt.pickerReveal, animate: false };
        return;
      case 'picker/resetPool':
        c.picker.pickedPool = [];
        return;
      case 'picker/clearHistory':
        c.picker.history = c.picker.history.filter((h) => h.date !== this.today);
        c.picker.pickedPool = [];
        return;

      // ----- 바탕화면 위젯 -----
      case 'student/widgetMain':
        this.data.studentWidgetMain = a.main === 'board' ? 'board' : 'clock';
        return;
      case 'widget/update': {
        const w = this.data.widget;
        const p = a.patch ?? {};
        if (typeof p.studentNotice === 'string') w.studentNotice = p.studentNotice.slice(0, 1000);
        for (const k of ['showOnStartup', 'localShowOnStudent', 'holidays', 'holidaysOnStudent', 'glass'] as const) if (typeof p[k] === 'boolean') w[k] = p[k];
        if (typeof p.weatherRegion === 'string') w.weatherRegion = p.weatherRegion;
        if (typeof p.background === 'string') w.background = p.background;
        if (p.periods && typeof p.periods === 'object') {
          const q = { ...w.periods, ...p.periods };
          w.periods = {
            firstStart: /^\d{1,2}:\d{2}$/.test(q.firstStart) ? q.firstStart : w.periods.firstStart,
            length: clamp(Math.round(+q.length || 40), 10, 120),
            breakLen: clamp(Math.round(+q.breakLen || 0), 0, 60),
            count: clamp(Math.round(+q.count || 6), 1, 10),
            lunchAfter: clamp(Math.round(+q.lunchAfter || 0), 0, 10),
            lunchLen: clamp(Math.round(+q.lunchLen || 0), 0, 120),
            playAfter: clamp(Math.round(+q.playAfter || 0), 0, 10),
            playLen: clamp(Math.round(+q.playLen || 0), 0, 60),
          };
        }
        return;
      }
      case 'widget/studentCard': {
        const w = this.data.widget;
        w.studentHiddenCards = a.hidden ? [...new Set([...w.studentHiddenCards, a.id])] : w.studentHiddenCards.filter((x) => x !== a.id);
        return;
      }
      case 'widget/card': {
        const w = this.data.widget;
        w.hiddenCards = a.hidden ? [...new Set([...w.hiddenCards, a.id])] : w.hiddenCards.filter((x) => x !== a.id);
        return;
      }
      case 'widget/addEvent': {
        const title = String(a.title ?? '').trim();
        if (!title) return { ok: false, error: '일정 내용을 입력해 주세요.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return { ok: false, error: '날짜를 확인해 주세요.' };
        const time = typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time) ? a.time : undefined;
        this.data.widget.localEvents.push({ id: newId('e_'), title: title.slice(0, 100), date: a.date, time });
        return;
      }
      case 'widget/deleteEvent':
        this.data.widget.localEvents = this.data.widget.localEvents.filter((e) => e.id !== a.id);
        return;
      case 'widget/todoAdd': {
        const text = String(a.text ?? '').trim();
        if (!text) return { ok: false };
        this.data.widget.todos.push({ id: newId('t_'), text: text.slice(0, 200), date: this.today, done: false });
        return;
      }
      case 'widget/todoToggle': {
        const t = this.data.widget.todos.find((x) => x.id === a.id);
        if (t) {
          t.done = !t.done;
          t.doneDate = t.done ? this.today : undefined;
        }
        // 끝낸 지 7일 지난 할 일은 정리
        const weekAgo = localDateKey(now - 7 * 86400_000);
        this.data.widget.todos = this.data.widget.todos.filter((x) => !x.done || (x.doneDate ?? '') >= weekAgo);
        return;
      }
      case 'widget/todoDelete':
        this.data.widget.todos = this.data.widget.todos.filter((x) => x.id !== a.id);
        return;
      case 'widget/memoAdd':
        this.data.widget.memos.push({ id: newId('m_'), title: '', text: '', color: a.color ?? '#fff3a8' });
        return { ok: true, id: this.data.widget.memos[this.data.widget.memos.length - 1].id };
      case 'widget/memoUpdate': {
        const m = this.data.widget.memos.find((x) => x.id === a.id);
        if (!m) return;
        if (typeof a.patch?.text === 'string') m.text = a.patch.text.slice(0, 3000);
        if (typeof a.patch?.title === 'string') m.title = a.patch.title.slice(0, 40);
        if (typeof a.patch?.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.patch.color)) m.color = a.patch.color;
        return;
      }
      case 'widget/memoDelete':
        this.data.widget.memos = this.data.widget.memos.filter((x) => x.id !== a.id);
        return;
      case 'widget/timetable': {
        const d = Math.round(Number(a.day));
        const p = Math.round(Number(a.period));
        if (d < 0 || d > 4 || p < 0 || p > 9) return { ok: false };
        this.data.widget.timetable[d][p] = String(a.value ?? '').slice(0, 20);
        return;
      }
      case 'widget/timetableAll': {
        const t = a.table;
        if (!Array.isArray(t)) return { ok: false };
        this.data.widget.timetable = Array.from({ length: 5 }, (_, d) => Array.from({ length: 10 }, (_, p) => String(t[d]?.[p] ?? '').slice(0, 20)));
        return;
      }
      case 'widget/calendarUpdate': {
        const c = this.data.widget.calendars.find((x) => x.id === a.id);
        if (!c) return { ok: false, error: '캘린더를 찾을 수 없습니다.' };
        const q = a.patch ?? {};
        if (typeof q.name === 'string' && q.name.trim()) c.name = q.name.trim().slice(0, 30);
        if (typeof q.color === 'string' && /^#[0-9a-f]{6}$/i.test(q.color)) c.color = q.color;
        if (typeof q.enabled === 'boolean') c.enabled = q.enabled;
        if (typeof q.showOnStudent === 'boolean') c.showOnStudent = q.showOnStudent;
        return;
      }
      case 'widget/calendarDelete':
        this.data.widget.calendars = this.data.widget.calendars.filter((x) => x.id !== a.id);
        this.rt.widget = { ...this.rt.widget, googleEvents: this.rt.widget.googleEvents.filter((e) => e.calId !== a.id) };
        return;

      // ----- 설정 -----
      case 'settings/update':
        Object.assign(this.data.settings, pick(a.patch ?? {}, ['showStudentOnStartup']));
        return;
      case 'notice/dismiss':
        this.rt.notices = this.rt.notices.filter((n) => n.id !== a.id);
        return;
      default:
        return { ok: false, error: '알 수 없는 동작: ' + a.type };
    }
  }

  /** 작성 중인 칠판을 학생 화면에 표시 (함께 보기 중이면 타이머는 그대로 두고 문구만 갱신) */
  private publishBoard(): void {
    this.data.boardPublished = { ...this.data.boardDraft };
    // 학생용 위젯을 보여 주는 중이면 화면을 바꾸지 않고 큰 시계 자리에 칠판을 띄운다
    if (this.data.studentBase === 'widget') {
      this.data.studentWidgetMain = 'board';
      this.ports.showStudent({ inactive: false, reason: 'teacher' });
      return;
    }
    if (this.data.studentBase !== 'board') {
      this.data.studentBase = 'board';
      this.rt.seatingReveal = null;
    }
    this.ports.showStudent({ inactive: false, reason: 'teacher' });
  }

  /** 실시간 반영이 켜져 있으면 작성 내용을 곧바로 공개본에 반영 (학생 화면 전환은 하지 않음) */
  private syncLiveBoard(): void {
    if (this.data.settings.boardLive) this.data.boardPublished = { ...this.data.boardDraft };
  }

  private selectClass(id: string): void {
    if (!this.data.classes.some((x) => x.id === id)) return;
    this.data.currentClassId = id;
    this.rt.seatingReveal = null;
    this.rt.pickerReveal = null;
    if (this.data.studentBase === 'seating' || this.data.studentBase === 'picker') this.data.studentBase = 'blank';
  }

  private adjustLayoutForCount(c: ClassRoom): void {
    const n = c.students.length;
    const l = c.seating.layout;
    const cap = (l.type === 'pair' ? l.pairCols * 2 : l.cols) * l.rows;
    if (cap < n) c.seating.layout = { ...suggestLayout(n, l.type, l) };
  }

  /** 미리 추첨한 결과가 지금 명단·조건과 맞지 않는 이유 */
  draftProblems(c: ClassRoom): string[] {
    const d = c.seating.draft;
    if (!d) return [];
    return resultProblems(d, { layout: c.seating.layout, students: c.students, fixed: c.seating.fixed, excludeAway: c.seating.excludeAway, today: this.today });
  }

  fixedIssueTexts(c: ClassRoom): string[] {
    const names = displayNames(c.students);
    return validateFixed(c.seating.layout, c.students, c.seating.fixed).map((i) => `${names.get(i.studentId) ?? '(삭제된 학생)'} — ${seatLabel(i.seatId)}: ${FIXED_ISSUE_TEXT[i.reason]}`);
  }

  private revealSeating(c: ClassRoom, result: SeatingResult): void {
    this.rt.seatingReveal = { revealId: newId('sr_'), animate: true, startedAt: this.now(), classId: c.id, result: structuredClone(result) };
    this.data.studentBase = 'seating';
    this.dismissTimerForOtherView();
    this.ports.showStudent({ inactive: false, reason: 'teacher' });
  }

  participantsInfo(c: ClassRoom) {
    return { away: c.students.filter((s) => isAway(s, this.today)).length };
  }
}

function pick<T extends object>(o: any, keys: (keyof T | string)[]): Partial<T> {
  const out: any = {};
  for (const k of keys) if (o[k as string] !== undefined) out[k] = o[k as string];
  return out;
}

function sanitizeBoardPatch(p: any) {
  const out: any = {};
  if (!p || typeof p !== 'object') return out;
  if (typeof p.text === 'string') out.text = p.text.slice(0, 5000);
  if (typeof p.fontSize === 'number') out.fontSize = clamp(p.fontSize, 3, 40);
  if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) out.color = p.color;
  if (typeof p.bg === 'string' && /^#[0-9a-f]{6}$/i.test(p.bg)) out.bg = p.bg;
  if (p.align === 'left' || p.align === 'center') out.align = p.align;
  if (typeof p.bold === 'boolean') out.bold = p.bold;
  if (typeof p.autoFit === 'boolean') out.autoFit = p.autoFit;
  return out;
}
