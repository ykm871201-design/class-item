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
/** 칠판 글의 세로 위치 */
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface BoardStyle {
  text: string;
  fontSize: number; // 화면 높이 대비 % (예: 12 = 화면 높이의 12%)
  color: string;
  bg: string;
  align: TextAlign;
  vAlign: VerticalAlign;
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
  /** 종료 예고음: 끝나기 몇 초 전부터 종료 때까지 1초마다 울릴지 (0 = 없음) */
  warnFrom?: number;
  /** 종료 예고음 크기 0~100 (없으면 80) */
  warnVolume?: number;
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
  timerWarnFrom: number;
  timerWarnVolume: number; // 종료 예고음 크기 0~100
  timerEndRepeat: boolean; // 종료 후 끌 때까지 알림음을 다시 울림
  timerActivity: string;
  lastTimerSec: number;
}

export type StudentBase = 'blank' | 'board' | 'seating' | 'picker' | 'widget' | 'election';

// ----- 학급임원선거 -----

/** 설정 → 투표 진행 → 투표 마감(결과 확인) → 결과 공개 */
export type ElectionPhase = 'setup' | 'voting' | 'closed' | 'published';

export interface ElectionCandidate {
  id: string;
  studentId: string;
  name: string; // 등록 당시 이름 (명단에서 이름이 바뀌거나 삭제돼도 결과 보존)
  number: number; // 후보 기호
  color: string;
}

export interface Election {
  id: string;
  classId: string;
  title: string; // 선거명
  position: string; // 직책명 (회장·부회장 등 직접 입력)
  seats: number; // 선출 인원
  voterLimit: number; // 투표 가능 인원
  maxChoices: number; // 1인당 선택 가능한 후보 수
  candidates: ElectionCandidate[];
  phase: ElectionPhase;
  /**
   * 후보별 득표 합계. 개인별·순서별 기록은 남기지 않는다.
   * 투표 중에는 교사·위젯·학생 화면으로 보내는 상태에서 뺀다.
   */
  tally: Record<string, number>;
  ballots: number; // 투표를 마친 인원 (기권 포함)
  abstain: number; // 기권 수
  /** 지금 열려 있는 투표 기회 1회 (제출되면 사라짐). 토큰은 무작위 값이며 투표자·선택과 무관 */
  openBallot: { token: string; openedAt: number } | null;
  /** 접수된 투표 기회 토큰 — 같은 제출의 재전송을 다시 세지 않기 위한 것 (선택 내용과 연결하지 않음) */
  receipts: string[];
  createdAt: number;
  startedAt?: number;
  closedAt?: number;
  publishedAt?: number;
  /** 동점 재투표: 원래 선거 ID와 1차에서 이미 당선된 후보 이름 */
  runoff?: { parentId: string; priorWinners: string[] };
  runoffChildId?: string;
}

export interface ElectionResultRow {
  candidateId: string;
  number: number;
  name: string;
  color: string;
  votes: number;
  elected: boolean;
  tied: boolean; // 당선 경계 동점
}

export type ElectionResultStatus = 'decided' | 'tie' | 'no-votes' | 'all-abstain';

export interface ElectionResult {
  status: ElectionResultStatus;
  rows: ElectionResultRow[]; // 득표 많은 순 (같으면 기호 순 — 표시용, 당선 판정에는 쓰지 않음)
  winners: string[]; // 당선 확정 후보 ID
  tied: string[]; // 재투표가 필요한 동점 후보 ID
  seatsLeft: number; // 재투표로 뽑아야 할 인원
  ballots: number;
  abstain: number;
  totalMarks: number; // 후보 득표 합계 (복수 선택이면 투표 인원보다 많을 수 있음)
}

// ----- 바탕화면 위젯 보드 -----

export type WidgetCardId = 'calendar' | 'agenda' | 'memo' | 'clock' | 'weather' | 'meal' | 'timetable' | 'tools';

/** 학생용 위젯에서 켜고 끌 수 있는 칸 (큰 시계 칸은 항상 보임) */
export type StudentCardId = 'calendar' | 'weather' | 'meal' | 'week' | 'today' | 'notice';

/** 구글 캘린더(iCal 비공개 주소) 연결. 주소는 암호화해서 저장하고 화면에는 보내지 않는다 */
export interface CalendarSource {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  showOnStudent: boolean; // 학생 화면 '이번 주 일정'에 보이기
  urlEnc: string; // 암호화된 iCal 주소 (base64)
}

export interface LocalEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM (없으면 하루 종일)
  endDate?: string;
}

export interface Todo {
  id: string;
  text: string;
  date: string; // 만든 날 (끝낼 때까지 다음 날로 넘어감)
  done: boolean;
  doneDate?: string;
}

export interface Memo {
  id: string;
  title: string;
  text: string;
  color: string;
}

export interface PeriodConfig {
  firstStart: string; // 1교시 시작 HH:MM
  length: number; // 수업 길이(분)
  breakLen: number; // 쉬는 시간(분)
  count: number; // 교시 수
  lunchAfter: number; // 몇 교시 뒤 점심 (0 = 없음)
  lunchLen: number; // 점심(분)
  playAfter: number; // 몇 교시 뒤 중간놀이 (0 = 없음)
  playLen: number; // 중간놀이(분)
}

export interface WidgetData {
  showOnStartup: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  hiddenCards: WidgetCardId[];
  calendars: CalendarSource[];
  localShowOnStudent: boolean; // '내 일정'을 학생 화면에 보이기
  holidays: boolean; // 대한민국 공휴일 표시
  holidaysOnStudent: boolean;
  localEvents: LocalEvent[];
  todos: Todo[];
  memos: Memo[];
  periods: PeriodConfig;
  timetable: string[][]; // [요일 0=월..4=금][교시] 과목
  weatherRegion: string; // 지역 ID
  school: { office: string; code: string; name: string } | null;
  glass: boolean; // 칸 바탕 반투명
  background: string; // 보드 배경 (그라데이션 ID)
  studentNotice: string; // 학생용 위젯 '알림장'
  studentHiddenCards: StudentCardId[]; // 학생용 위젯에서 끈 칸
  studentOnTop: boolean; // 학생용 위젯을 띄운 동안 학생 화면을 다른 창보다 항상 위에 둘지
}

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
  /** 학생용 위젯의 큰 칸: 평소 시계, 칠판을 띄우면 칠판 (타이머는 따로 겹쳐 표시) */
  studentWidgetMain: 'clock' | 'board';
  widget: WidgetData;
  elections: Election[];
  /** 선거 관리 PIN (솔트+해시만 저장, 평문 저장 안 함) */
  electionPin: { salt: string; hash: string } | null;
  /** 학생 화면(TV)에 띄운 선거 */
  electionShownId: string | null;
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
  warnFrom: number; // 끝나기 몇 초 전부터 예고음 (0 = 없음)
  warnVolume: number; // 예고음 크기 0~100
  alerted: string[]; // 이미 울린 예고음 (같은 초에 두 번 울리지 않게)
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

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  current: string;
  latest?: string;
  publishedAt?: string;
  notes?: string;
  progress?: number; // 0~1
  error?: string;
  checkedAt?: number;
}

/** 달력에 보이는 일정 하나 (구글·내 일정·공휴일을 합친 것) */
export interface CalEvent {
  id: string;
  calId: string; // 'local' | 'holiday' | CalendarSource.id
  title: string;
  start: number; // epoch ms (하루 종일이면 그날 0시)
  end: number;
  allDay: boolean;
  color: string;
}

export interface CalendarStatus {
  ok: boolean;
  fetchedAt?: number;
  count?: number;
  error?: string;
}

export interface WeatherInfo {
  fetchedAt: number;
  temp: number;
  code: number;
  max: number;
  min: number;
  rainProb: number;
  pm10?: number;
  pm25?: number;
}

export interface MealInfo {
  date: string; // YYYY-MM-DD
  dishes: string[];
  allergies: string[]; // 요리별 알레르기 번호 문자열
  fetchedAt: number;
  note?: string; // '급식 없음' 등
}

export interface WidgetRuntime {
  googleEvents: CalEvent[]; // 구글 캘린더에서 받은 일정 (주소는 포함하지 않음)
  calStatus: Record<string, CalendarStatus>;
  weather: WeatherInfo | null;
  weatherError?: string;
  meal: MealInfo | null;
  mealError?: string;
  visible: boolean;
}

/** 투표 전용 창 상태 (교사 화면 표시용) */
export interface VoteWindowStatus {
  open: boolean;
  electionId: string | null;
  locked: string | null; // 잠긴 이유 (모니터 연결 변경 등)
}

export interface ElectionRuntime {
  pinSet: boolean;
  /** 저장이 확인되지 않은 접수 표가 있음 (다음 학생 투표를 열 수 없음) */
  unsaved: boolean;
  vote: VoteWindowStatus;
}

export interface Runtime {
  timer: TimerState;
  election: ElectionRuntime;
  update: UpdateState;
  widget: WidgetRuntime;
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
  vAlign: VerticalAlign;
  bold: boolean;
  autoFit: boolean;
}

/** 학생용 위젯에 보낼 정보 (구글 캘린더·개인 일정·메모는 포함하지 않음) */
export interface StudentWidgetView {
  main: 'clock' | 'board';
  periods: PeriodConfig;
  timetable: string[][];
  weather: WeatherInfo | null;
  weatherRegion: string;
  meal: MealInfo | null;
  notice: string;
  holidays: boolean;
  background: string;
  glass: boolean;
  hidden: StudentCardId[];
}

/** 학생 화면(TV)에 보낼 선거 정보 — 투표 중에는 득표·개인 선택 없음, 결과는 공개한 뒤에만 */
export interface StudentElectionView {
  id: string;
  title: string;
  position: string;
  seats: number;
  maxChoices: number;
  phase: ElectionPhase;
  ballots: number;
  voterLimit: number;
  candidates: { number: number; name: string; color: string }[];
  runoff: boolean;
  priorWinners: string[];
  result: {
    status: ElectionResultStatus;
    rows: { number: number; name: string; color: string; votes: number; elected: boolean; tied: boolean }[];
    ballots: number;
    abstain: number;
    totalMarks: number;
    seatsLeft: number;
  } | null;
}

/** 투표 전용 창에 보낼 정보 — 후보와 투표 기회만 (득표·관리 정보 없음) */
export interface VoteView {
  election: { id: string; title: string; position: string; maxChoices: number; phase: ElectionPhase; candidates: { id: string; number: number; name: string; color: string }[] } | null;
  ballot: { token: string } | null;
  ballots: number;
  voterLimit: number;
  locked: string | null;
  unsaved: boolean;
  admin: boolean;
}

export interface StudentView {
  base: StudentBase;
  election?: StudentElectionView | null;
  widget?: StudentWidgetView | null;
  board: StudentBoardView;
  seating: StudentSeatingView | null;
  picker: StudentPickerView | null;
  timer: StudentTimerView | null; // 표시 중일 때만
}
