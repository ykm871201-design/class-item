// 앱 전체에서 공유하는 데이터 타입 정의

/** pair: 짝꿍형, single: 개인형, custom: 분단별 설정(분단마다 한 줄 인원·줄 수를 따로 정함) */
export type LayoutType = 'pair' | 'single' | 'custom';

/** 남(M) / 여(F) */
export type Gender = 'M' | 'F';

/** 분단별 설정의 한 분단: 한 줄에 붙어 앉는 인원(1~4)과 줄 수 */
export interface DeskGroup {
  size: number;
  rows: number;
}

export interface Student {
  id: string; // 고유 ID (이름이 바뀌어도 유지)
  number: number; // 번호
  name: string;
  absentDate?: string | null; // 'YYYY-MM-DD' — 이 날짜에만 결석 처리
  excluded?: boolean; // 일시 제외 (교사가 해제할 때까지)
  gender?: Gender | null; // 성별 (남자·여자 자리 배치에 사용)
}

export interface SeatLayout {
  type: LayoutType;
  /** 짝꿍형: 한 줄의 짝(2자리 묶음) 수 */
  pairCols: number;
  /** 개인형: 한 줄의 자리 수 */
  cols: number;
  rows: number;
  /** 사용하지 않는 자리 ID 목록 (형태별로 따로 기억) */
  disabledPair: string[];
  disabledSingle: string[];
  disabledCustom: string[];
  /** 분단별 설정: 왼쪽 분단부터 */
  groups: DeskGroup[];
  /** 남자 자리·여자 자리 지정 (자리 ID → 성별). 형태별로 따로 기억. 교사에게만 보임 */
  genderPair: Record<string, Gender>;
  genderSingle: Record<string, Gender>;
  genderCustom: Record<string, Gender>;
  /** 짝꿍형에서 몇 쌍마다 분단 간격을 둘지 (기본 1 = 짝마다 분단) */
  pairsPerGroup: number;
}

export interface FixedSeat {
  seatId: string;
  studentId: string;
}

/** seatId -> studentId (빈자리는 키 없음) */
export type Assignment = Record<string, string>;

export interface SeatingResult {
  id: string;
  createdAt: number;
  layout: SeatLayout;
  assignment: Assignment;
}

export interface SavedArrangement extends SeatingResult {
  name: string;
}

export type EmptySeatPolicy = 'back' | 'random';

export interface SeatingConfig {
  layout: SeatLayout;
  fixed: FixedSeat[];
  excludeAway: boolean;
  emptyPolicy: EmptySeatPolicy;
  draft: SeatingResult | null; // 교사 미리보기용 최근 추첨 결과
  confirmed: SeatingResult | null; // 확정된 배치
  saved: SavedArrangement[];
}

export type PickMode = 'unique' | 'all';

export interface PickRecord {
  id: string;
  at: number;
  date: string; // YYYY-MM-DD
  mode: PickMode;
  studentIds: string[];
  names: string[]; // 기록 당시 표시 이름
}

export interface PickerConfig {
  count: number;
  mode: PickMode;
  excludeAway: boolean;
  pickedPool: string[]; // 중복 없이 뽑기: 이미 뽑힌 학생 ID
  history: PickRecord[];
}

export interface ClassRoom {
  id: string;
  name: string;
  students: Student[];
  seating: SeatingConfig;
  picker: PickerConfig;
}

export type TextAlign = 'left' | 'center';

export interface BoardStyle {
  text: string;
  fontSize: number; // 화면 높이 대비 % (예: 12 = 화면 높이의 12%)
  color: string;
  bg: string;
  align: TextAlign;
  bold: boolean;
  autoFit: boolean;
}

export interface Phrase {
  id: string;
  title: string;
  text: string;
}

export type SoundId = 'chime' | 'bell' | 'beep' | 'marimba' | 'none';

export type TimerDisplayMode = 'full' | 'split';

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  time: string; // 'HH:MM' (24시간)
  durationSec: number;
  repeat: 'once' | 'weekly';
  date: string; // 한 번 실행: 'YYYY-MM-DD'
  days: number[]; // 반복: 0=일 ... 6=토
  activity: string;
  sound: SoundId;
  volume: number; // 0~100
  displayMode: TimerDisplayMode;
  createdAt: number;
  /** 이 시각 이전의 발생은 실행·놓침 판정에서 제외 (생성·수정·재활성화 시각) */
  activeSince?: number;
}

export type ScheduleLogKind = 'fired' | 'missed' | 'replaced' | 'no-display' | 'info';

export interface ScheduleLogEntry {
  id: string;
  at: number;
  kind: ScheduleLogKind;
  scheduleId?: string;
  message: string;
  occurrence?: string; // 예약 발생 시각 키
  acknowledged?: boolean;
}

export interface DisplayRef {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface Settings {
  studentDisplay: DisplayRef | null; // 교사가 선택한 학생용 디스플레이
  studentFullscreen: boolean;
  /** 학생 화면이 보이는 동안 다른 창보다 항상 위에 표시 */
  studentAlwaysOnTop: boolean;
  /** 칠판 실시간 반영: 입력하는 즉시 학생 화면 칠판에 반영 */
  boardLive: boolean;
  showStudentOnStartup: boolean;
  autoLaunch: boolean;
  closeToTrayNoticeShown: boolean;
  timerSound: SoundId;
  timerVolume: number;
  timerDisplayMode: TimerDisplayMode;
  timerActivity: string;
  lastTimerSec: number;
}

export type StudentBase = 'blank' | 'board' | 'seating' | 'picker';

export interface AppData {
  version: 1;
  classes: ClassRoom[];
  currentClassId: string | null;
  boardDraft: BoardStyle;
  boardPublished: BoardStyle;
  phrases: Phrase[];
  schedules: Schedule[];
  scheduleLog: ScheduleLogEntry[];
  scheduleFired: Record<string, string>; // scheduleId -> 마지막 처리한 발생 키
  lastScheduleCheckAt: number;
  settings: Settings;
  studentBase: StudentBase;
}

// ----- 런타임 (저장하지 않음) -----

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerState {
  status: TimerStatus;
  durationMs: number;
  endAt: number; // running일 때 종료 예정 시각 (epoch ms)
  remainingMs: number; // paused/idle일 때 남은 시간
  activity: string;
  sound: SoundId;
  volume: number;
  mode: TimerDisplayMode;
  source: 'manual' | 'schedule';
  scheduleId?: string;
  shown: boolean; // 학생 화면에 타이머 표시 중인지
  finishedAt?: number;
  runId: string; // 타이머 실행마다 새로 발급 (알림음 1회 재생 보장)
}

export interface RevealState {
  revealId: string;
  animate: boolean;
  startedAt: number;
}

export interface StudentWindowStatus {
  visible: boolean;
  mode: 'display' | 'preview' | 'none';
  fullscreen: boolean;
  displayAvailable: boolean;
  displayLabel: string | null;
  alwaysOnTop: boolean;
  /** 학생 화면이 교사용 화면과 같은 모니터에 있어 Esc로 숨길 수 있는지 */
  escHides?: boolean;
}

export interface Notice {
  id: string;
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Runtime {
  timer: TimerState;
  seatingReveal: (RevealState & { classId: string; result: SeatingResult }) | null;
  pickerReveal: (RevealState & { names: string[]; poolNames: string[] }) | null;
  studentWindow: StudentWindowStatus;
  displays: (DisplayRef & { primary: boolean; scaleFactor: number })[];
  notices: Notice[];
  now: number;
  inTray: boolean;
  userDataPath: string;
  appVersion: string;
}

export interface FullState {
  data: AppData;
  runtime: Runtime;
  studentView: StudentView;
}

// ----- 학생 화면 전달용 (교사용 정보 없음) -----

export interface StudentSeatView {
  r: number;
  c: number;
  disabled: boolean;
  name: string | null;
}

export interface StudentSeatingView {
  type: LayoutType;
  rows: number;
  cols: number; // 실제 자리 열 수
  /** 열 사이 간격 (gaps[c-1] = c번째 열 앞의 간격, 자리 너비 대비 비율) */
  gaps: number[];
  seats: StudentSeatView[];
  revealId: string;
  animate: boolean;
  startedAt: number;
  shuffleNames: string[];
}

export interface StudentPickerView {
  names: string[];
  revealId: string;
  animate: boolean;
  startedAt: number;
  shuffleNames: string[];
}

export interface StudentTimerView {
  status: TimerStatus;
  durationMs: number;
  endAt: number;
  remainingMs: number;
  activity: string;
  mode: TimerDisplayMode;
}

export interface StudentBoardView {
  text: string;
  fontSize: number;
  color: string;
  bg: string;
  align: TextAlign;
  bold: boolean;
  autoFit: boolean;
}

export interface StudentView {
  base: StudentBase;
  board: StudentBoardView;
  seating: StudentSeatingView | null;
  picker: StudentPickerView | null;
  timer: StudentTimerView | null; // 표시 중일 때만
}
