// 학급임원선거 동작 처리 (Controller가 위임)
// - 교사 동작: election/* (PIN이 필요한 동작은 pin 값을 함께 받는다)
// - 투표 창 동작: openBallot / submit / retrySave / cancelOpenBallot (main.ts의 투표 창 IPC에서 호출)
// - 접수한 표는 디스크 저장이 확인된 뒤에만 ‘완료’로 알린다. 저장에 실패하면 같은 토큰으로 다시 시도해도 다시 세지 않는다.
import type { AppData, Election, ElectionRuntime, StudentElectionView, VoteView } from '../shared/types';
import { acceptBallot, applySetupPatch, candidateColor, computeResult, ELECTION_LIMITS, makeRunoff, newElection, renumber, setupProblems } from '../shared/election';
import { newId } from '../shared/util';
import { hashPin, PIN_RULE, PinGuard } from './pin';

type Result = { ok: boolean; error?: string; [k: string]: unknown } | void;

export interface ElectionHost {
  data: AppData;
  now(): number;
  notice(level: 'info' | 'warn' | 'error', message: string): void;
  /** 바로 디스크에 저장하고 성공 여부를 돌려준다 */
  persistStrict(): boolean;
  showStudent(): boolean;
  changed(persist: boolean): void;
}

export class Elections {
  rt: ElectionRuntime = { pinSet: false, unsaved: false, vote: { open: false, electionId: null, locked: null } };
  /** 저장이 확인되지 않은 접수 토큰 */
  private unsavedToken: string | null = null;
  readonly pins: PinGuard;

  constructor(private host: ElectionHost) {
    this.pins = new PinGuard(() => host.now());
    this.rt.pinSet = !!host.data.electionPin;
  }

  private get data() {
    return this.host.data;
  }

  /** 앱 시작(또는 데이터 가져오기) 때: 제출 기록 없이 열려 있던 투표 기회는 무효로 하고 알린다 */
  recoverOnLoad(): void {
    for (const e of this.data.elections) {
      if (e.openBallot) {
        e.openBallot = null;
        this.host.notice('warn', `‘${e.title} · ${e.position}’: 앱이 다시 시작되기 전에 열려 있던 투표 기회 1건은 제출 기록이 없어 세지 않았습니다. 그 학생은 ‘투표 완료’ 화면을 보지 못했으므로 다시 투표하게 해 주세요.`);
      }
    }
    this.unsavedToken = null;
    this.rt.unsaved = false;
    this.rt.pinSet = !!this.data.electionPin;
  }

  find(id: unknown): Election | undefined {
    return this.data.elections.find((e) => e.id === id);
  }

  votingElection(): Election | undefined {
    return this.data.elections.find((e) => e.phase === 'voting');
  }

  checkPin(pin: unknown): { ok: true } | { ok: false; error: string } {
    return this.pins.check(pin, this.data.electionPin);
  }

  private studentsOf(e: Election) {
    return this.data.classes.find((c) => c.id === e.classId)?.students ?? [];
  }

  // ---------- 교사 동작 ----------
  handle(a: { type: string; [k: string]: any }): Result {
    const now = this.host.now();
    switch (a.type) {
      case 'election/setPin': {
        const pin = String(a.pin ?? '');
        if (!PIN_RULE.test(pin)) return { ok: false, error: 'PIN은 숫자 4~8자리로 정해 주세요.' };
        if (this.data.electionPin) {
          const c = this.checkPin(a.oldPin);
          if (!c.ok) return { ok: false, error: '지금 PIN이 맞지 않습니다. ' + c.error.replace('PIN이 맞지 않습니다. ', '') };
        }
        this.data.electionPin = hashPin(pin);
        this.rt.pinSet = true;
        return { ok: true };
      }
      case 'election/create': {
        const cls = this.data.classes.find((c) => c.id === this.data.currentClassId) ?? this.data.classes[0];
        const e = newElection(cls.id, now, { voterLimit: Math.max(1, cls.students.filter((s) => !s.excluded).length || 25) });
        if (typeof a.position === 'string' && a.position.trim()) e.position = a.position.trim().slice(0, ELECTION_LIMITS.position);
        this.data.elections.push(e);
        return { ok: true, id: e.id };
      }
      case 'election/update': {
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        if (e.phase !== 'setup') return { ok: false, error: '투표를 시작한 뒤에는 후보와 투표 규칙을 바꿀 수 없습니다.' };
        applySetupPatch(e, a.patch ?? {});
        return;
      }
      case 'election/addCandidate': {
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        if (e.phase !== 'setup') return { ok: false, error: '투표를 시작한 뒤에는 후보를 바꿀 수 없습니다.' };
        if (e.runoff) return { ok: false, error: '재투표 후보는 동점 후보로 정해져 있어 바꿀 수 없습니다.' };
        const st = this.studentsOf(e).find((s) => s.id === a.studentId);
        if (!st) return { ok: false, error: '명단에서 학생을 찾을 수 없습니다.' };
        if (e.candidates.some((c) => c.studentId === st.id)) return { ok: false, error: `${st.name} 학생은 이미 후보로 등록되어 있습니다.` };
        if (e.candidates.length >= ELECTION_LIMITS.candidates.max) return { ok: false, error: `후보는 최대 ${ELECTION_LIMITS.candidates.max}명까지 등록할 수 있습니다.` };
        const number = e.candidates.length + 1;
        e.candidates.push({ id: newId('ec_'), studentId: st.id, name: st.name, number, color: candidateColor(number) });
        return;
      }
      case 'election/removeCandidate': {
        const e = this.find(a.id);
        if (!e || e.phase !== 'setup') return { ok: false, error: '투표를 시작한 뒤에는 후보를 바꿀 수 없습니다.' };
        if (e.runoff) return { ok: false, error: '재투표 후보는 바꿀 수 없습니다.' };
        e.candidates = renumber(e.candidates.filter((c) => c.id !== a.candidateId));
        return;
      }
      case 'election/moveCandidate': {
        const e = this.find(a.id);
        if (!e || e.phase !== 'setup') return { ok: false, error: '투표를 시작한 뒤에는 기호를 바꿀 수 없습니다.' };
        if (e.runoff) return { ok: false, error: '재투표 후보의 기호는 원래 선거 그대로 씁니다.' };
        const i = e.candidates.findIndex((c) => c.id === a.candidateId);
        const j = i + (a.dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= e.candidates.length) return;
        const list = e.candidates.slice();
        [list[i], list[j]] = [list[j], list[i]];
        e.candidates = renumber(list);
        return;
      }
      case 'election/start': {
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        if (e.phase !== 'setup') return { ok: false, error: '이미 투표를 시작한 선거입니다.' };
        const other = this.votingElection();
        if (other) return { ok: false, error: `‘${other.title} · ${other.position}’ 투표가 진행 중입니다. 먼저 마감해 주세요.` };
        const probs = setupProblems(e, this.studentsOf(e));
        if (probs.length) return { ok: false, error: probs.join('\n') };
        const c = this.checkPin(a.pin);
        if (!c.ok) return c;
        e.phase = 'voting';
        e.startedAt = now;
        e.tally = {};
        e.ballots = 0;
        e.abstain = 0;
        e.receipts = [];
        e.openBallot = null;
        if (!this.host.persistStrict()) this.host.notice('error', '투표 시작을 저장하지 못했습니다. 저장 문제가 해결될 때까지 투표를 열지 마세요.');
        return { ok: true };
      }
      case 'election/close': {
        const e = this.find(a.id);
        if (!e || e.phase !== 'voting') return { ok: false, error: '진행 중인 투표가 아닙니다.' };
        if (this.rt.vote.open && this.rt.vote.electionId === e.id) return { ok: false, error: '교실 PC의 투표 화면을 먼저 닫아 주세요. (투표 화면의 ‘선생님’ 버튼 → PIN → 투표 화면 닫기)' };
        if (this.unsavedToken) return { ok: false, error: '저장이 확인되지 않은 표가 있습니다. 투표 화면에서 ‘저장 다시 시도’를 먼저 해 주세요.' };
        const c = this.checkPin(a.pin);
        if (!c.ok) return c;
        e.openBallot = null;
        e.phase = 'closed';
        e.closedAt = now;
        if (!this.host.persistStrict()) this.host.notice('error', '투표 마감을 저장하지 못했습니다. 잠시 뒤 자동으로 다시 저장합니다.');
        return { ok: true };
      }
      case 'election/reset': {
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        if (this.rt.vote.open && this.rt.vote.electionId === e.id) return { ok: false, error: '교실 PC의 투표 화면을 먼저 닫아 주세요.' };
        const c = this.checkPin(a.pin);
        if (!c.ok) return c;
        e.phase = 'setup';
        e.tally = {};
        e.ballots = 0;
        e.abstain = 0;
        e.receipts = [];
        e.openBallot = null;
        e.startedAt = e.closedAt = e.publishedAt = undefined;
        if (this.unsavedToken) this.unsavedToken = null;
        this.rt.unsaved = false;
        this.host.persistStrict();
        return { ok: true };
      }
      case 'election/delete': {
        const e = this.find(a.id);
        if (!e) return;
        if (this.rt.vote.open && this.rt.vote.electionId === e.id) return { ok: false, error: '교실 PC의 투표 화면을 먼저 닫아 주세요.' };
        // 표가 들어 있거나 진행 중인 선거는 PIN 확인
        if (e.phase !== 'setup' || e.ballots > 0) {
          const c = this.checkPin(a.pin);
          if (!c.ok) return c;
        }
        this.data.elections = this.data.elections.filter((x) => x.id !== e.id);
        for (const x of this.data.elections) {
          if (x.runoffChildId === e.id) x.runoffChildId = undefined;
        }
        if (this.data.electionShownId === e.id) {
          this.data.electionShownId = null;
          if (this.data.studentBase === 'election') this.data.studentBase = 'blank';
        }
        return { ok: true };
      }
      case 'election/show': {
        // 학생 화면(TV)에 선거 안내(또는 공개한 결과)를 띄운다
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        this.data.electionShownId = e.id;
        this.data.studentBase = 'election';
        this.host.showStudent();
        return;
      }
      case 'election/publish': {
        const e = this.find(a.id);
        if (!e || (e.phase !== 'closed' && e.phase !== 'published')) return { ok: false, error: '투표를 마감한 뒤에 결과를 공개할 수 있습니다.' };
        e.phase = 'published';
        e.publishedAt = now;
        this.data.electionShownId = e.id;
        this.data.studentBase = 'election';
        this.host.showStudent();
        return { ok: true };
      }
      case 'election/unpublish': {
        const e = this.find(a.id);
        if (!e || e.phase !== 'published') return;
        e.phase = 'closed';
        e.publishedAt = undefined;
        return;
      }
      case 'election/runoff': {
        const e = this.find(a.id);
        if (!e) return { ok: false, error: '선거를 찾을 수 없습니다.' };
        if (e.runoffChildId && this.find(e.runoffChildId)) return { ok: false, error: '이미 재투표를 만들었습니다.', id: e.runoffChildId };
        const r = makeRunoff(e, now);
        if (!r) return { ok: false, error: '당선 경계에서 동점인 경우에만 재투표를 만들 수 있습니다.' };
        this.data.elections.push(r);
        e.runoffChildId = r.id;
        return { ok: true, id: r.id };
      }
    }
    return { ok: false, error: '알 수 없는 동작: ' + a.type };
  }

  // ---------- 투표 창 ----------

  /** 다음 학생 투표 기회 1회 열기 (투표 창 관리 모드에서만 호출) */
  openBallot(electionId: string): { ok: true } | { ok: false; error: string } {
    const e = this.find(electionId);
    if (!e || e.phase !== 'voting') return { ok: false, error: '진행 중인 투표가 없습니다.' };
    if (this.unsavedToken) return { ok: false, error: '앞 학생의 표 저장이 확인되지 않았습니다. ‘저장 다시 시도’를 먼저 해 주세요.' };
    if (e.ballots >= e.voterLimit) return { ok: false, error: `투표 가능 인원(${e.voterLimit}명)이 모두 투표했습니다.` };
    if (this.rt.vote.locked) return { ok: false, error: '투표 화면이 잠겨 있습니다.' };
    e.openBallot = { token: newId('b_') + newId(), openedAt: this.host.now() };
    this.host.changed(true);
    return { ok: true };
  }

  /** 열린 투표 기회 취소 (모니터 연결 변경, 투표 화면 닫기) — 표는 세지 않음 */
  cancelOpenBallot(): boolean {
    const e = this.votingElection();
    if (!e?.openBallot) return false;
    e.openBallot = null;
    this.host.changed(true);
    return true;
  }

  /**
   * 학생 제출. 같은 토큰의 재전송·연타는 한 번만 센다.
   * saved=true일 때만 투표 창에 ‘완료’를 보여 준다.
   */
  submit(token: unknown, choices: unknown, abstain: unknown): { ok: boolean; saved?: boolean; error?: string } {
    const e = this.votingElection() ?? this.data.elections.find((x) => typeof token === 'string' && x.receipts.includes(token));
    if (!e) return { ok: false, error: '진행 중인 투표가 없습니다.' };
    const r = acceptBallot(e, token, choices, abstain === true);
    if (r.kind === 'rejected') return { ok: false, error: r.error };
    if (r.kind === 'accepted') this.unsavedToken = token as string;
    // 새로 접수했거나, 저장이 확인되지 않은 같은 표의 재전송이면 다시 저장
    if (this.unsavedToken === token) {
      const saved = this.host.persistStrict();
      if (saved) this.unsavedToken = null;
      this.rt.unsaved = !!this.unsavedToken;
      this.host.changed(false);
      return { ok: true, saved };
    }
    return { ok: true, saved: true };
  }

  /** 저장 실패 후 다시 시도 */
  retrySave(): boolean {
    if (!this.unsavedToken) return true;
    const saved = this.host.persistStrict();
    if (saved) this.unsavedToken = null;
    this.rt.unsaved = !!this.unsavedToken;
    this.host.changed(false);
    return saved;
  }

  // ---------- 화면으로 보내는 정보 ----------

  /** 교사·위젯 화면으로 보낼 선거 목록 — 투표 중(설정 포함)에는 득표·기권·토큰을 빼고 보낸다 */
  forTeacher(): Election[] {
    return this.data.elections.map((e) => {
      const hide = e.phase === 'setup' || e.phase === 'voting';
      return {
        ...e,
        candidates: e.candidates.map((c) => ({ ...c })),
        tally: hide ? {} : { ...e.tally },
        abstain: hide ? 0 : e.abstain,
        receipts: [],
        openBallot: e.openBallot ? { token: '', openedAt: e.openBallot.openedAt } : null,
        runoff: e.runoff ? { ...e.runoff, priorWinners: [...e.runoff.priorWinners] } : undefined,
      };
    });
  }

  /** 학생 화면(TV) — 결과는 공개한 뒤에만 */
  studentView(): StudentElectionView | null {
    if (this.data.studentBase !== 'election') return null;
    const e = this.find(this.data.electionShownId);
    if (!e) return null;
    const result =
      e.phase === 'published'
        ? (() => {
            const r = computeResult(e);
            return { status: r.status, rows: r.rows.map(({ number, name, color, votes, elected, tied }) => ({ number, name, color, votes, elected, tied })), ballots: r.ballots, abstain: r.abstain, totalMarks: r.totalMarks, seatsLeft: r.seatsLeft };
          })()
        : null;
    return {
      id: e.id,
      title: e.title,
      position: e.position,
      seats: e.seats,
      maxChoices: e.maxChoices,
      phase: e.phase,
      ballots: e.ballots,
      voterLimit: e.voterLimit,
      candidates: e.candidates.map((c) => ({ number: c.number, name: c.name, color: c.color })),
      runoff: !!e.runoff,
      priorWinners: e.runoff?.priorWinners ?? [],
      result,
    };
  }

  /** 투표 창 — 후보와 열린 투표 기회만 (득표 없음) */
  voteView(admin: boolean): VoteView {
    const e = (this.rt.vote.electionId ? this.find(this.rt.vote.electionId) : undefined) ?? this.votingElection();
    return {
      election: e ? { id: e.id, title: e.title, position: e.position, maxChoices: e.maxChoices, phase: e.phase, candidates: e.candidates.map((c) => ({ id: c.id, number: c.number, name: c.name, color: c.color })) } : null,
      ballot: e && e.phase === 'voting' && e.openBallot && !this.rt.vote.locked ? { token: e.openBallot.token } : null,
      ballots: e?.ballots ?? 0,
      voterLimit: e?.voterLimit ?? 0,
      locked: this.rt.vote.locked,
      unsaved: !!this.unsavedToken,
      admin,
    };
  }
}
