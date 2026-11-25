// 기본값과 저장 데이터 정규화·가져오기 검증
import type { AppData, BoardStyle, ClassRoom, PickerConfig, Schedule, SeatingConfig, SeatLayout, Settings, SoundId, Student, StudentCardId, WidgetCardId, WidgetData } from './types';
import { cleanGroups, cleanLayout, suggestLayout, LIMITS } from './seating';
import { clamp, newId } from './util';
import { normalizeWarnFrom } from './timer';

export const BOARD_THEMES: { name: string; color: string; bg: string }[] = [
  { name: '흰 바탕 · 검은 글씨', color: '#1f2328', bg: '#ffffff' },
  { name: '칠판 초록 · 흰 글씨', color: '#ffffff', bg: '#1f4d3a' },
  { name: '남색 · 흰 글씨', color: '#ffffff', bg: '#1d2b4f' },
  { name: '검정 · 노란 글씨', color: '#ffe066', bg: '#111111' },
  { name: '크림 · 진한 갈색', color: '#3b2a1a', bg: '#fdf6e3' },
];

export const TEXT_COLORS = ['#1f2328', '#ffffff', '#ffe066', '#d6336c', '#1c7ed6', '#2b8a3e', '#e8590c'];
export const BG_COLORS = ['#ffffff', '#1f4d3a', '#1d2b4f', '#111111', '#fdf6e3', '#e7f5ff'];

export const SOUNDS: { id: SoundId; name: string }[] = [
  { id: 'chime', name: '차임 (딩동댕)' },
  { id: 'bell', name: '종소리' },
  { id: 'marimba', name: '마림바' },
  { id: 'beep', name: '전자음 (삐삐삐)' },
  { id: 'none', name: '무음' },
];

export function defaultBoard(): BoardStyle {
  return { text: '', fontSize: 14, color: '#1f2328', bg: '#ffffff', align: 'center', bold: true, autoFit: true };
}

export function defaultSettings(): Settings {
  return {
    studentDisplay: null,
    studentFullscreen: true,
    studentAlwaysOnTop: true,
    boardLive: false,
    showStudentOnStartup: true,
    autoLaunch: false,
    closeToTrayNoticeShown: false,
    timerSound: 'chime',
    timerVolume: 70,
    timerDisplayMode: 'split',
    timerWarnFrom: 0,
    timerActivity: '',
    lastTimerSec: 300,
  };
}

export function defaultSeating(n = 24): SeatingConfig {
  return { layout: suggestLayout(n, 'pair'), fixed: [], excludeAway: true, emptyPolicy: 'back', draft: null, confirmed: null, saved: [] };
}

export function defaultPicker(): PickerConfig {
  return { count: 1, mode: 'unique', excludeAway: true, pickedPool: [], history: [] };
}

export function newClass(name: string): ClassRoom {
  return { id: newId('c_'), name, students: [], seating: defaultSeating(), picker: defaultPicker() };
}

export const WIDGET_CARDS: { id: WidgetCardId; name: string }[] = [
  { id: 'calendar', name: '달력' },
  { id: 'agenda', name: '일정 정리 · 할 일' },
  { id: 'memo', name: '메모' },
  { id: 'clock', name: '시계 · 교시' },
  { id: 'weather', name: '날씨 · 미세먼지' },
  { id: 'meal', name: '급식' },
  { id: 'timetable', name: '이번 주 시간표' },
  { id: 'tools', name: '수업 도구' },
];

export const STUDENT_CARDS: { id: StudentCardId; name: string }[] = [
  { id: 'calendar', name: '달력' },
  { id: 'weather', name: '날씨 · 미세먼지' },
  { id: 'meal', name: '급식' },
  { id: 'week', name: '이번 주 시간표' },
  { id: 'today', name: '오늘 시간표' },
  { id: 'notice', name: '알림장' },
];

export const MEMO_COLORS = ['#fff3a8', '#ffd6e0', '#d3e9ff', '#d8f5c9', '#ece0ff', '#ffe2c2'];
// 차례로 붙는 캘린더 색 (내 일정 초록·공휴일 빨강과 겹치지 않게, 이웃 색끼리 잘 구분되게)
export const CALENDAR_COLORS = ['#3b5bdb', '#e67700', '#9c36b5', '#0c8599', '#c2255c', '#5c940d', '#1c7ed6', '#d9480f', '#5f3dc4', '#495057', '#862e9c', '#2b8a3e'];
export const BOARD_BACKGROUNDS: { id: string; name: string; css: string }[] = [
  { id: 'sky', name: '하늘', css: 'linear-gradient(160deg, #a5d8ff 0%, #d0ebff 45%, #fff4e6 100%)' },
  { id: 'forest', name: '숲', css: 'linear-gradient(160deg, #2f9e44 0%, #8ce99a 55%, #e6fcf5 100%)' },
  { id: 'sunset', name: '노을', css: 'linear-gradient(160deg, #f76707 0%, #ffa8a8 50%, #e5dbff 100%)' },
  { id: 'night', name: '밤하늘', css: 'linear-gradient(160deg, #1c2541 0%, #3a506b 60%, #5bc0be 100%)' },
  { id: 'paper', name: '종이', css: 'linear-gradient(160deg, #f8f9fa 0%, #e9ecef 100%)' },
];

export function defaultWidget(): WidgetData {
  return {
    showOnStartup: true,
    bounds: null,
    hiddenCards: [],
    calendars: [],
    localShowOnStudent: false,
    holidays: true,
    holidaysOnStudent: true,
    localEvents: [],
    todos: [],
    memos: [{ id: newId('m_'), title: '', text: '여기에 메모를 적어 보세요', color: MEMO_COLORS[0] }],
    periods: { firstStart: '09:00', length: 40, breakLen: 10, count: 6, lunchAfter: 4, lunchLen: 50, playAfter: 2, playLen: 20 },
    timetable: Array.from({ length: 5 }, () => Array.from({ length: 10 }, () => '')),
    weatherRegion: 'seoul',
    school: null,
    glass: true,
    background: 'sky',
    studentNotice: '',
    studentHiddenCards: [],
  };
}

export function defaultData(): AppData {
  const c = newClass('우리 반');
  return {
    version: 1,
    classes: [c],
    currentClassId: c.id,
    boardDraft: defaultBoard(),
    boardPublished: defaultBoard(),
    phrases: [
      { id: newId('p_'), title: '아침 활동', text: '아침 활동\n책 읽기 시간입니다' },
      { id: newId('p_'), title: '정리 시간', text: '자리 정리하고\n바르게 앉아요' },
      { id: newId('p_'), title: '모둠 활동', text: '모둠 활동\n서로의 생각을 나누어요' },
    ],
    schedules: [],
    scheduleLog: [],
    scheduleFired: {},
    lastScheduleCheckAt: 0,
    settings: defaultSettings(),
    studentBase: 'blank',
    studentWidgetMain: 'clock',
    widget: defaultWidget(),
  };
}

// ---- 정규화 (저장 파일·가져오기 파일이 일부 손상되어도 안전하게 복원) ----

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const arr = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => x !== null) : []);
const SOUND_IDS: SoundId[] = ['chime', 'bell', 'beep', 'marimba', 'none'];
const sound = (v: unknown, d: SoundId): SoundId => (SOUND_IDS.includes(v as SoundId) ? (v as SoundId) : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

function normBoard(v: unknown): BoardStyle {
  const d = defaultBoard();
  if (!isObj(v)) return d;
  return {
    text: str(v.text, ''),
    fontSize: clamp(num(v.fontSize, d.fontSize), 3, 40),
    color: color(v.color, d.color),
    bg: color(v.bg, d.bg),
    align: v.align === 'left' ? 'left' : 'center',
    bold: bool(v.bold, d.bold),
    autoFit: bool(v.autoFit, d.autoFit),
  };
}

function normStudent(v: unknown): Student | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  return {
    id: v.id,
    number: Math.round(num(v.number, 0)),
    name: v.name.slice(0, 20),
    absentDate: typeof v.absentDate === 'string' ? v.absentDate : null,
    excluded: bool(v.excluded, false),
    gender: v.gender === 'M' || v.gender === 'F' ? v.gender : null,
  };
}

const idList = (v: unknown) => arr(v, (x) => (typeof x === 'string' ? x : null));

const genderMapOf = (v: unknown): Record<string, 'M' | 'F'> =>
  isObj(v) ? (Object.fromEntries(Object.entries(v).filter(([, g]) => g === 'M' || g === 'F')) as Record<string, 'M' | 'F'>) : {};

function normLayout(v: unknown): SeatLayout {
  const d = suggestLayout(24, 'pair');
  if (!isObj(v)) return d;
  return cleanLayout({
    type: v.type === 'single' ? 'single' : v.type === 'custom' ? 'custom' : 'pair',
    pairCols: clamp(Math.round(num(v.pairCols, d.pairCols)), LIMITS.pairCols.min, LIMITS.pairCols.max),
    cols: clamp(Math.round(num(v.cols, d.cols)), LIMITS.cols.min, LIMITS.cols.max),
    rows: clamp(Math.round(num(v.rows, d.rows)), LIMITS.rows.min, LIMITS.rows.max),
    disabledPair: idList(v.disabledPair),
    disabledSingle: idList(v.disabledSingle),
    disabledCustom: idList(v.disabledCustom),
    groups: Array.isArray(v.groups) ? cleanGroups(v.groups.filter(isObj).map((g) => ({ size: num(g.size, 2), rows: num(g.rows, 4) }))) : d.groups,
    genderPair: genderMapOf(v.genderPair),
    genderSingle: genderMapOf(v.genderSingle),
    genderCustom: genderMapOf(v.genderCustom),
    pairsPerGroup: clamp(Math.round(num(v.pairsPerGroup, 1)), 1, 3),
  });
}

function normResult(v: unknown) {
  if (!isObj(v) || !isObj(v.assignment)) return null;
  const assignment: Record<string, string> = {};
  for (const [k, x] of Object.entries(v.assignment)) if (typeof x === 'string') assignment[k] = x;
  return { id: str(v.id, newId('a_')), createdAt: num(v.createdAt, Date.now()), layout: normLayout(v.layout), assignment };
}

function normSeating(v: unknown): SeatingConfig {
  const d = defaultSeating();
  if (!isObj(v)) return d;
  return {
    layout: normLayout(v.layout),
    fixed: arr(v.fixed, (f) => (isObj(f) && typeof f.seatId === 'string' && typeof f.studentId === 'string' ? { seatId: f.seatId, studentId: f.studentId } : null)),
    excludeAway: bool(v.excludeAway, true),
    emptyPolicy: v.emptyPolicy === 'random' ? 'random' : 'back',
    draft: normResult(v.draft),
    confirmed: normResult(v.confirmed),
    saved: arr(v.saved, (x) => {
      const r = normResult(x);
      return r && isObj(x) ? { ...r, name: str(x.name, '저장한 배치') } : null;
    }),
  };
}

function normPicker(v: unknown): PickerConfig {
  const d = defaultPicker();
  if (!isObj(v)) return d;
  return {
    count: clamp(Math.round(num(v.count, 1)), 1, 30),
    mode: v.mode === 'all' ? 'all' : 'unique',
    excludeAway: bool(v.excludeAway, true),
    pickedPool: idList(v.pickedPool),
    history: arr(v.history, (h) =>
      isObj(h)
        ? { id: str(h.id, newId('h_')), at: num(h.at, 0), date: str(h.date, ''), mode: h.mode === 'all' ? 'all' : 'unique', studentIds: idList(h.studentIds), names: idList(h.names) }
        : null,
    ),
  };
}

function normClass(v: unknown): ClassRoom | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const students = arr(v.students, normStudent);
  const ids = new Set(students.map((s) => s.id));
  const seating = normSeating(v.seating);
  // 명단에 없는 학생과 연결된 고정 자리는 남기지 않는다
  seating.fixed = seating.fixed.filter((f) => ids.has(f.studentId));
  const picker = normPicker(v.picker);
  picker.pickedPool = picker.pickedPool.filter((id) => ids.has(id));
  return { id: v.id, name: str(v.name, '이름 없는 학급').slice(0, 30), students, seating, picker };
}

function normSchedule(v: unknown): Schedule | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    name: str(v.name, '예약'),
    enabled: bool(v.enabled, true),
    time: str(v.time, '09:00'),
    durationSec: clamp(Math.round(num(v.durationSec, 300)), 1, 180 * 60),
    repeat: v.repeat === 'once' ? 'once' : 'weekly',
    date: str(v.date, ''),
    days: arr(v.days, (x) => (typeof x === 'number' && x >= 0 && x <= 6 ? x : null)),
    activity: str(v.activity, ''),
    sound: sound(v.sound, 'chime'),
    volume: clamp(num(v.volume, 70), 0, 100),
    displayMode: v.displayMode === 'full' ? 'full' : 'split',
    warnFrom: normalizeWarnFrom(v.warnFrom),
    createdAt: num(v.createdAt, Date.now()),
    activeSince: num(v.activeSince, num(v.createdAt, 0)),
  };
}

const WIDGET_CARD_IDS = WIDGET_CARDS.map((c) => c.id);
const timeStr = (v: unknown, d: string) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : d);
const dateStr = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function normWidget(v: unknown): WidgetData {
  const d = defaultWidget();
  if (!isObj(v)) return d;
  const p = isObj(v.periods) ? v.periods : {};
  const b = isObj(v.bounds) ? v.bounds : null;
  const tt = Array.isArray(v.timetable) ? v.timetable : d.timetable;
  return {
    showOnStartup: bool(v.showOnStartup, true),
    bounds: b && [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: b.x, y: b.y, width: Math.max(480, b.width), height: Math.max(360, b.height) } : null,
    hiddenCards: arr(v.hiddenCards, (x) => (WIDGET_CARD_IDS.includes(x as WidgetCardId) ? (x as WidgetCardId) : null)),
    calendars: arr(v.calendars, (c) =>
      isObj(c) && typeof c.id === 'string'
        ? { id: c.id, name: str(c.name, '구글 캘린더').slice(0, 30), color: color(c.color, CALENDAR_COLORS[0]), enabled: bool(c.enabled, true), showOnStudent: bool(c.showOnStudent, false), urlEnc: str(c.urlEnc, '') }
        : null,
    ),
    localShowOnStudent: bool(v.localShowOnStudent, false),
    holidays: bool(v.holidays, true),
    holidaysOnStudent: bool(v.holidaysOnStudent, true),
    localEvents: arr(v.localEvents, (e) => {
      if (!isObj(e) || typeof e.title !== 'string' || !dateStr(e.date)) return null;
      return { id: str(e.id, newId('e_')), title: e.title.slice(0, 100), date: dateStr(e.date)!, time: typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) ? e.time : undefined, endDate: dateStr(e.endDate) ?? undefined };
    }),
    todos: arr(v.todos, (t) => (isObj(t) && typeof t.text === 'string' ? { id: str(t.id, newId('t_')), text: t.text.slice(0, 200), date: dateStr(t.date) ?? '2000-01-01', done: bool(t.done, false), doneDate: dateStr(t.doneDate) ?? undefined } : null)),
    memos: arr(v.memos, (m) => (isObj(m) ? { id: str(m.id, newId('m_')), title: str(m.title, '').slice(0, 40), text: str(m.text, '').slice(0, 3000), color: color(m.color, MEMO_COLORS[0]) } : null)),
    periods: {
      firstStart: timeStr(p.firstStart, d.periods.firstStart),
      length: clamp(Math.round(num(p.length, 40)), 10, 120),
      breakLen: clamp(Math.round(num(p.breakLen, 10)), 0, 60),
      count: clamp(Math.round(num(p.count, 6)), 1, 10),
      lunchAfter: clamp(Math.round(num(p.lunchAfter, 4)), 0, 10),
      lunchLen: clamp(Math.round(num(p.lunchLen, 50)), 0, 120),
      playAfter: clamp(Math.round(num(p.playAfter, 2)), 0, 10),
      playLen: clamp(Math.round(num(p.playLen, 20)), 0, 60),
    },
    timetable: Array.from({ length: 5 }, (_, i) => Array.from({ length: 10 }, (_, j) => (Array.isArray(tt[i]) && typeof tt[i][j] === 'string' ? (tt[i][j] as string).slice(0, 20) : ''))),
    weatherRegion: str(v.weatherRegion, 'seoul'),
    school: isObj(v.school) && typeof v.school.code === 'string' && typeof v.school.office === 'string' ? { office: v.school.office, code: v.school.code, name: str(v.school.name, '') } : null,
    glass: bool(v.glass, true),
    background: str(v.background, 'sky'),
    studentNotice: str(v.studentNotice, '').slice(0, 1000),
    studentHiddenCards: arr(v.studentHiddenCards, (x) => (STUDENT_CARDS.some((c) => c.id === x) ? (x as StudentCardId) : null)),
  };
}

export function normalizeData(raw: unknown): AppData {
  const d = defaultData();
  if (!isObj(raw)) return d;
  const classes = arr(raw.classes, normClass);
  const s = isObj(raw.settings) ? raw.settings : {};
  const ds = defaultSettings();
  const sd = isObj(s.studentDisplay) ? s.studentDisplay : null;
  const data: AppData = {
    version: 1,
    classes: classes.length ? classes : d.classes,
    currentClassId: typeof raw.currentClassId === 'string' ? raw.currentClassId : null,
    boardDraft: normBoard(raw.boardDraft),
    boardPublished: normBoard(raw.boardPublished),
    phrases: arr(raw.phrases, (p) => (isObj(p) && typeof p.text === 'string' ? { id: str(p.id, newId('p_')), title: str(p.title, '문구'), text: p.text } : null)),
    schedules: arr(raw.schedules, normSchedule),
    scheduleLog: arr(raw.scheduleLog, (e) =>
      isObj(e) && typeof e.message === 'string'
        ? { id: str(e.id, newId('l_')), at: num(e.at, 0), kind: (['fired', 'missed', 'replaced', 'no-display', 'info'].includes(e.kind) ? e.kind : 'info') as any, scheduleId: typeof e.scheduleId === 'string' ? e.scheduleId : undefined, message: e.message, occurrence: typeof e.occurrence === 'string' ? e.occurrence : undefined, acknowledged: bool(e.acknowledged, false) }
        : null,
    ).slice(-200),
    scheduleFired: isObj(raw.scheduleFired) ? Object.fromEntries(Object.entries(raw.scheduleFired).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {},
    lastScheduleCheckAt: num(raw.lastScheduleCheckAt, 0),
    settings: {
      studentDisplay: sd && typeof sd.id === 'number' ? { id: sd.id, label: str(sd.label, ''), width: num(sd.width, 0), height: num(sd.height, 0), x: num(sd.x, 0), y: num(sd.y, 0) } : null,
      studentFullscreen: bool(s.studentFullscreen, ds.studentFullscreen),
      studentAlwaysOnTop: bool(s.studentAlwaysOnTop, ds.studentAlwaysOnTop),
      boardLive: bool(s.boardLive, false),
      showStudentOnStartup: bool(s.showStudentOnStartup, ds.showStudentOnStartup),
      autoLaunch: bool(s.autoLaunch, false),
      closeToTrayNoticeShown: bool(s.closeToTrayNoticeShown, false),
      timerSound: sound(s.timerSound, ds.timerSound),
      timerVolume: clamp(num(s.timerVolume, ds.timerVolume), 0, 100),
      timerDisplayMode: s.timerDisplayMode === 'full' ? 'full' : 'split',
      timerWarnFrom: normalizeWarnFrom(s.timerWarnFrom),
      timerActivity: str(s.timerActivity, ''),
      lastTimerSec: clamp(num(s.lastTimerSec, 300), 1, 180 * 60),
    },
    studentBase: ['blank', 'board', 'seating', 'widget'].includes(raw.studentBase as string) ? (raw.studentBase as AppData['studentBase']) : 'blank',
    studentWidgetMain: raw.studentWidgetMain === 'board' ? 'board' : 'clock',
    widget: normWidget(raw.widget),
  };
  if (!data.classes.some((c) => c.id === data.currentClassId)) data.currentClassId = data.classes[0].id;
  return data;
}

/** 가져오기 파일 형식 검증 (내보내기 파일: { app, version, exportedAt, data }) */
export function validateImport(raw: unknown): { ok: true; data: AppData; summary: string } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: '올바른 데이터 파일이 아닙니다.' };
  const payload = raw.app === 'classroom-tools' ? raw.data : raw;
  if (raw.app !== undefined && raw.app !== 'classroom-tools') return { ok: false, error: '이 앱에서 내보낸 파일이 아닙니다.' };
  if (!isObj(payload) || payload.version !== 1 || !Array.isArray(payload.classes)) return { ok: false, error: '파일 형식이 맞지 않습니다. 이 앱의 "데이터 내보내기"로 만든 파일을 선택해 주세요.' };
  const data = normalizeData(payload);
  if (!Array.isArray(payload.classes) || payload.classes.length === 0 || data.classes.length === 0) return { ok: false, error: '파일에 학급 정보가 없습니다.' };
  const students = data.classes.reduce((n, c) => n + c.students.length, 0);
  return { ok: true, data, summary: `학급 ${data.classes.length}개, 학생 ${students}명, 예약 ${data.schedules.length}개` };
}
