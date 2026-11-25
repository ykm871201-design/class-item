// 자리 배치: 좌석 생성, 고정 자리·남녀 자리 검증, 무작위 배치 알고리즘
import type { Assignment, DeskGroup, EmptySeatPolicy, FixedSeat, Gender, LayoutType, SeatLayout, Student } from './types';
import { isAway } from './roster';
import { cryptoRandomInt, shuffle, type RandomInt } from './util';

export const LIMITS = {
  rows: { min: 1, max: 10 },
  pairCols: { min: 1, max: 6 },
  cols: { min: 1, max: 12 },
  groups: { min: 1, max: 8 },
  groupSize: { min: 1, max: 4 },
  totalCols: 16,
};

export const GENDER_TEXT: Record<Gender, string> = { M: '남', F: '여' };

export interface Seat {
  id: string;
  r: number; // 0 = 맨 앞 (칠판 쪽)
  c: number; // 0 = 학생 기준 맨 왼쪽
}

export function seatId(r: number, c: number): string {
  return `r${r}c${c}`;
}

export function parseSeatId(id: string): { r: number; c: number } | null {
  const m = /^r(\d+)c(\d+)$/.exec(id);
  return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
}

type LayoutShape = Pick<SeatLayout, 'type' | 'pairCols' | 'cols' | 'rows' | 'groups'>;

export function seatColumns(layout: LayoutShape): number {
  if (layout.type === 'pair') return layout.pairCols * 2;
  if (layout.type === 'custom') return layout.groups.reduce((n, g) => n + g.size, 0);
  return layout.cols;
}

/** 분단별 설정에서 c번째 열이 속한 분단 번호(0부터)와 분단 안 위치 */
export function groupOfColumn(layout: LayoutShape, c: number): { group: number; pos: number } {
  let start = 0;
  for (let g = 0; g < layout.groups.length; g++) {
    const size = layout.groups[g].size;
    if (c < start + size) return { group: g, pos: c - start };
    start += size;
  }
  return { group: -1, pos: 0 };
}

/** 해당 열의 줄 수 (분단별 설정은 분단마다 다를 수 있음) */
export function rowsAtColumn(layout: LayoutShape, c: number): number {
  if (layout.type !== 'custom') return layout.rows;
  const g = groupOfColumn(layout, c).group;
  return g >= 0 ? layout.groups[g].rows : 0;
}

/** 화면에 그릴 전체 줄 수 */
export function totalRows(layout: LayoutShape): number {
  if (layout.type !== 'custom') return layout.rows;
  return Math.max(1, ...layout.groups.map((g) => g.rows));
}

export function disabledList(layout: SeatLayout): string[] {
  return layout.type === 'pair' ? layout.disabledPair : layout.type === 'custom' ? layout.disabledCustom : layout.disabledSingle;
}

export function disabledKey(type: LayoutType): 'disabledPair' | 'disabledSingle' | 'disabledCustom' {
  return type === 'pair' ? 'disabledPair' : type === 'custom' ? 'disabledCustom' : 'disabledSingle';
}

export function genderMap(layout: SeatLayout): Record<string, Gender> {
  return layout.type === 'pair' ? layout.genderPair : layout.type === 'custom' ? layout.genderCustom : layout.genderSingle;
}

export function genderKey(type: LayoutType): 'genderPair' | 'genderSingle' | 'genderCustom' {
  return type === 'pair' ? 'genderPair' : type === 'custom' ? 'genderCustom' : 'genderSingle';
}

/** 앞줄부터, 학생 기준 왼쪽부터 정렬된 전체 좌석 */
export function allSeats(layout: LayoutShape): Seat[] {
  const cols = seatColumns(layout);
  const rows = totalRows(layout);
  const out: Seat[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r < rowsAtColumn(layout, c)) out.push({ id: seatId(r, c), r, c });
  return out;
}

export function seatExists(layout: LayoutShape, id: string): boolean {
  const p = parseSeatId(id);
  return !!p && p.c < seatColumns(layout) && p.r < rowsAtColumn(layout, p.c);
}

export function activeSeats(layout: SeatLayout): Seat[] {
  const dis = new Set(disabledList(layout));
  return allSeats(layout).filter((s) => !dis.has(s.id));
}

/**
 * 열 사이 간격 (자리 너비 대비). gaps[c-1]은 c번째 열 바로 앞의 간격.
 * - 짝꿍형: 짝 사이 좁게, 분단 사이 넓게
 * - 개인형: 모두 같은 간격
 * - 분단별: 같은 분단 안은 붙여서, 분단 사이는 넓게
 */
export function columnGaps(layout: Pick<SeatLayout, 'type' | 'pairCols' | 'cols' | 'rows' | 'groups' | 'pairsPerGroup'>): number[] {
  const cols = seatColumns(layout);
  const gaps: number[] = [];
  for (let c = 1; c < cols; c++) {
    if (layout.type === 'pair') {
      if (c % 2 === 1) gaps.push(0.05);
      else gaps.push((c / 2) % layout.pairsPerGroup === 0 ? 0.55 : 0.2);
    } else if (layout.type === 'custom') {
      gaps.push(groupOfColumn(layout, c).pos === 0 ? 0.55 : 0.05);
    } else gaps.push(0.22);
  }
  return gaps;
}

/** 교사에게 보여 줄 좌석 이름 (학생이 칠판을 바라보는 기준) */
export function seatLabel(id: string, layout?: SeatLayout): string {
  const p = parseSeatId(id);
  if (!p) return id;
  if (layout && layout.type === 'custom') {
    const { group, pos } = groupOfColumn(layout, p.c);
    return `${group + 1}분단 앞에서 ${p.r + 1}째 줄, 분단 안 왼쪽에서 ${pos + 1}번째`;
  }
  const base = `앞에서 ${p.r + 1}째 줄, 왼쪽에서 ${p.c + 1}번째`;
  if (layout && layout.type === 'pair') {
    const pair = Math.floor(p.c / 2) + 1;
    return `${base} (${pair}번째 짝, ${p.c % 2 === 0 ? '왼쪽' : '오른쪽'} 자리)`;
  }
  return base;
}

export function shortSeatLabel(id: string): string {
  const p = parseSeatId(id);
  return p ? `${p.r + 1}줄-${p.c + 1}번` : id;
}

export function emptyLayoutExtras(): Pick<SeatLayout, 'disabledPair' | 'disabledSingle' | 'disabledCustom' | 'genderPair' | 'genderSingle' | 'genderCustom'> {
  return { disabledPair: [], disabledSingle: [], disabledCustom: [], genderPair: {}, genderSingle: {}, genderCustom: {} };
}

/** 학생 수에 맞는 초기 배열 */
export function suggestLayout(n: number, type: LayoutType, prev?: SeatLayout): SeatLayout {
  const count = Math.max(1, n);
  let pairCols = 3;
  let cols = 6;
  if (count <= 8) {
    pairCols = 2;
    cols = 4;
  } else if (count <= 12) {
    pairCols = 3;
    cols = 4;
  } else if (count <= 24) {
    pairCols = 3;
    cols = 5;
  } else {
    pairCols = 3;
    cols = 6;
  }
  const rowsPair = Math.ceil(count / (pairCols * 2));
  const rowsSingle = Math.ceil(count / cols);
  // 분단별 설정 기본: 2명 · 3명 · 2명 분단
  const sizes = count <= 10 ? [2, 3] : [2, 3, 2];
  const perRow = sizes.reduce((a, b) => a + b, 0);
  const rowsCustom = Math.min(LIMITS.rows.max, Math.ceil(count / perRow));
  const rows = Math.min(LIMITS.rows.max, type === 'pair' ? rowsPair : type === 'custom' ? rowsCustom : rowsSingle);
  return {
    type,
    pairCols,
    cols,
    rows,
    groups: sizes.map((size) => ({ size, rows: rowsCustom })),
    pairsPerGroup: prev?.pairsPerGroup ?? 1,
    ...emptyLayoutExtras(),
  };
}

export type FixedIssueReason =
  | 'seat-missing' // 자리 모양 변경으로 좌석이 사라짐
  | 'seat-disabled' // 사용하지 않는 자리로 바뀜
  | 'student-missing' // 명단에서 삭제됨
  | 'duplicate-student'
  | 'duplicate-seat';

export interface FixedIssue {
  seatId: string;
  studentId: string;
  reason: FixedIssueReason;
}

export const FIXED_ISSUE_TEXT: Record<FixedIssueReason, string> = {
  'seat-missing': '자리 배열을 바꾸어 해당 좌석이 없어졌습니다',
  'seat-disabled': '해당 좌석이 사용하지 않는 자리로 설정되었습니다',
  'student-missing': '명단에 없는 학생입니다',
  'duplicate-student': '같은 학생이 여러 좌석에 고정되어 있습니다',
  'duplicate-seat': '같은 좌석에 여러 학생이 고정되어 있습니다',
};

/** 고정 자리 설정 중 적용할 수 없는 항목을 찾는다 (결석·제외는 문제로 보지 않음) */
export function validateFixed(layout: SeatLayout, students: Student[], fixed: FixedSeat[]): FixedIssue[] {
  const issues: FixedIssue[] = [];
  const ids = new Set(students.map((s) => s.id));
  const dis = new Set(disabledList(layout));
  const seenStudent = new Set<string>();
  const seenSeat = new Set<string>();
  for (const f of fixed) {
    let reason: FixedIssueReason | null = null;
    if (!ids.has(f.studentId)) reason = 'student-missing';
    else if (!seatExists(layout, f.seatId)) reason = 'seat-missing';
    else if (dis.has(f.seatId)) reason = 'seat-disabled';
    else if (seenStudent.has(f.studentId)) reason = 'duplicate-student';
    else if (seenSeat.has(f.seatId)) reason = 'duplicate-seat';
    if (reason) issues.push({ seatId: f.seatId, studentId: f.studentId, reason });
    else {
      seenStudent.add(f.studentId);
      seenSeat.add(f.seatId);
    }
  }
  return issues;
}

/** 좌석에 학생을 고정 (같은 학생·같은 좌석의 기존 고정은 대체) */
export function setFixed(fixed: FixedSeat[], seatIdV: string, studentId: string | null): FixedSeat[] {
  const out = fixed.filter((f) => f.seatId !== seatIdV && (studentId === null || f.studentId !== studentId));
  if (studentId) out.push({ seatId: seatIdV, studentId });
  return out;
}

// ---------------- 남자 자리·여자 자리 ----------------

export type GenderPattern = 'pair-mf' | 'pair-fm' | 'checker' | 'clear';

export const GENDER_PATTERN_TEXT: Record<GenderPattern, string> = {
  'pair-mf': '짝마다 왼쪽 남 · 오른쪽 여',
  'pair-fm': '짝마다 왼쪽 여 · 오른쪽 남',
  checker: '앞뒤 좌우 번갈아 (체크무늬)',
  clear: '남녀 자리 모두 해제',
};

/** 자주 쓰는 남녀 자리 모양을 한 번에 지정 (사용하는 자리 기준) */
export function genderPattern(layout: SeatLayout, pattern: GenderPattern): Record<string, Gender> {
  if (pattern === 'clear') return {};
  const out: Record<string, Gender> = {};
  for (const s of activeSeats(layout)) {
    // 붙어 앉는 묶음(짝·분단) 안의 위치. 개인형은 열 번호
    const pos = layout.type === 'custom' ? groupOfColumn(layout, s.c).pos : s.c;
    let male: boolean;
    if (pattern === 'checker') male = (s.r + pos) % 2 === 0;
    else male = pos % 2 === 0;
    if (pattern === 'pair-fm') male = !male;
    out[s.id] = male ? 'M' : 'F';
  }
  return out;
}

/** 남녀 자리 표시를 돌아가며 바꿈: 없음 → 남 → 여 → 없음 */
export function cycleGender(map: Record<string, Gender>, id: string): Record<string, Gender> {
  const out = { ...map };
  if (!out[id]) out[id] = 'M';
  else if (out[id] === 'M') out[id] = 'F';
  else delete out[id];
  return out;
}

export interface GenderCounts {
  seatsM: number;
  seatsF: number;
  seatsAny: number;
  studentsM: number;
  studentsF: number;
  studentsU: number;
}

// ---------------- 배치 ----------------

export interface DrawInput {
  layout: SeatLayout;
  students: Student[];
  fixed: FixedSeat[];
  excludeAway: boolean;
  emptyPolicy: EmptySeatPolicy;
  today: string;
  rand?: RandomInt;
}

export interface DrawSuccess {
  ok: true;
  assignment: Assignment;
  participants: string[];
  appliedFixed: FixedSeat[];
  skippedFixedAway: FixedSeat[]; // 결석·제외로 이번 배치에서 빠진 고정 학생
  issues: FixedIssue[]; // 적용하지 못한 고정 설정
  emptySeats: number;
  genderNotes: string[]; // 남녀 자리 관련 안내 (남는 자리, 일반 자리로 간 학생 수)
}

export interface DrawFailure {
  ok: false;
  error: string;
}

interface GenderPlan {
  error: string | null;
  counts: GenderCounts;
  notes: string[];
}

/** 고정 학생을 뺀 나머지 학생·좌석으로 남녀 자리 배치가 가능한지 계산 */
function planGender(seats: Seat[], gmap: Record<string, Gender>, students: Student[]): GenderPlan {
  const counts: GenderCounts = { seatsM: 0, seatsF: 0, seatsAny: 0, studentsM: 0, studentsF: 0, studentsU: 0 };
  for (const s of seats) {
    const g = gmap[s.id];
    if (g === 'M') counts.seatsM++;
    else if (g === 'F') counts.seatsF++;
    else counts.seatsAny++;
  }
  for (const st of students) {
    if (st.gender === 'M') counts.studentsM++;
    else if (st.gender === 'F') counts.studentsF++;
    else counts.studentsU++;
  }
  const notes: string[] = [];
  if (counts.seatsM + counts.seatsF === 0) return { error: null, counts, notes };
  const overM = Math.max(0, counts.studentsM - counts.seatsM);
  const overF = Math.max(0, counts.studentsF - counts.seatsF);
  const needAny = overM + overF + counts.studentsU;
  if (needAny > counts.seatsAny) {
    const parts = [`남자 자리 ${counts.seatsM}석, 여자 자리 ${counts.seatsF}석, 지정 없는 자리 ${counts.seatsAny}석`, `남학생 ${counts.studentsM}명, 여학생 ${counts.studentsF}명${counts.studentsU ? `, 성별 미입력 ${counts.studentsU}명` : ''}`];
    let hint = '남자 자리·여자 자리 수를 학생 수에 맞게 조정해 주세요.';
    if (counts.studentsU > 0) hint = `학생 명단에서 성별을 입력하거나(성별 미입력 학생은 지정 없는 자리에만 앉습니다), ${hint}`;
    return { error: `남녀 자리가 맞지 않아 배치할 수 없습니다.\n(고정 학생 제외) ${parts[0]}에 ${parts[1]}을 앉혀야 합니다.\n${hint}`, counts, notes };
  }
  if (overM) notes.push(`남자 자리가 모자라 남학생 ${overM}명은 지정 없는 자리에 앉습니다.`);
  if (overF) notes.push(`여자 자리가 모자라 여학생 ${overF}명은 지정 없는 자리에 앉습니다.`);
  if (counts.seatsM > counts.studentsM) notes.push(`남자 자리 ${counts.seatsM - counts.studentsM}석은 빈자리가 됩니다.`);
  if (counts.seatsF > counts.studentsF) notes.push(`여자 자리 ${counts.seatsF - counts.studentsF}석은 빈자리가 됩니다.`);
  return { error: null, counts, notes };
}

/** 배치 전 점검: 활성 좌석이 참여 학생보다 적은지, 남녀 자리가 맞는지 */
export function precheckSeating(input: Omit<DrawInput, 'rand' | 'emptyPolicy'>): { participants: Student[]; seats: Seat[]; error: string | null; gender: GenderCounts | null; genderNotes: string[] } {
  const seats = activeSeats(input.layout);
  const participants = input.students.filter((s) => !(input.excludeAway && isAway(s, input.today)));
  let error: string | null = null;
  let gender: GenderCounts | null = null;
  let genderNotes: string[] = [];
  if (participants.length === 0) error = '배치할 학생이 없습니다. 학생 명단을 확인해 주세요.';
  else if (participants.length > seats.length)
    error = `사용 가능한 자리(${seats.length}석)가 참여 학생(${participants.length}명)보다 적습니다. 줄·열을 늘리거나 사용하지 않는 자리를 다시 켜 주세요.`;
  else {
    const gmap = genderMap(input.layout);
    if (Object.keys(gmap).length) {
      const { freeSeats, freeStudents } = afterFixed(input, seats, participants);
      const plan = planGender(freeSeats, gmap, freeStudents);
      gender = plan.counts;
      genderNotes = plan.notes;
      error = plan.error;
    }
  }
  return { participants, seats, error, gender, genderNotes };
}

/** 유효한 고정을 반영한 뒤 남는 좌석과 학생 */
function afterFixed(input: Omit<DrawInput, 'rand' | 'emptyPolicy'>, seats: Seat[], participants: Student[]) {
  const issues = validateFixed(input.layout, input.students, input.fixed);
  const bad = new Set(issues.map((i) => `${i.seatId}|${i.studentId}`));
  const pids = new Set(participants.map((s) => s.id));
  const applied = input.fixed.filter((f) => !bad.has(`${f.seatId}|${f.studentId}`) && pids.has(f.studentId));
  const fixedSeats = new Set(applied.map((f) => f.seatId));
  const fixedStudents = new Set(applied.map((f) => f.studentId));
  return { issues, applied, freeSeats: seats.filter((s) => !fixedSeats.has(s.id)), freeStudents: participants.filter((s) => !fixedStudents.has(s.id)) };
}

/** 정책에 따라 좌석 n개 선택 (앞자리부터 또는 무작위) */
function pickSeats(seats: Seat[], n: number, policy: EmptySeatPolicy, rand: RandomInt): Seat[] {
  if (n <= 0) return [];
  return policy === 'random' ? shuffle(seats, rand).slice(0, n) : seats.slice(0, n);
}

/**
 * 자리 배치 알고리즘
 * 1) 사용 가능한 좌석과 참여 학생 확정
 * 2) 유효한 고정 배치를 먼저 반영
 * 3) 남자 자리·여자 자리가 지정되어 있으면 남학생은 남자 자리, 여학생은 여자 자리에 먼저 무작위 배치하고,
 *    자리가 모자란 학생과 성별 미입력 학생은 지정 없는 자리에 무작위 배치
 * 4) 나머지 학생을 남은 좌석에 편향 없이 무작위 배치 (Fisher–Yates)
 * 5) 중복·누락 검사
 */
export function drawSeating(input: DrawInput): DrawSuccess | DrawFailure {
  const rand = input.rand ?? cryptoRandomInt;
  const pre = precheckSeating(input);
  if (pre.error) return { ok: false, error: pre.error };
  const { participants, seats } = pre;
  const { issues, applied, freeSeats, freeStudents } = afterFixed(input, seats, participants);
  const pids = new Set(participants.map((s) => s.id));
  const bad = new Set(issues.map((i) => `${i.seatId}|${i.studentId}`));
  const skippedFixedAway = input.fixed.filter((f) => !bad.has(`${f.seatId}|${f.studentId}`) && !pids.has(f.studentId));

  const assignment: Assignment = {};
  for (const f of applied) assignment[f.seatId] = f.studentId;

  const gmap = genderMap(input.layout);
  const useGender = Object.keys(gmap).length > 0;
  let genderNotes: string[] = [];
  if (useGender) {
    genderNotes = pre.genderNotes;
    const seatsM = freeSeats.filter((s) => gmap[s.id] === 'M');
    const seatsF = freeSeats.filter((s) => gmap[s.id] === 'F');
    const seatsAny = freeSeats.filter((s) => !gmap[s.id]);
    const males = shuffle(freeStudents.filter((s) => s.gender === 'M').map((s) => s.id), rand);
    const females = shuffle(freeStudents.filter((s) => s.gender === 'F').map((s) => s.id), rand);
    const unknown = freeStudents.filter((s) => s.gender !== 'M' && s.gender !== 'F').map((s) => s.id);
    const targetM = pickSeats(seatsM, Math.min(males.length, seatsM.length), input.emptyPolicy, rand);
    const targetF = pickSeats(seatsF, Math.min(females.length, seatsF.length), input.emptyPolicy, rand);
    targetM.forEach((seat, i) => (assignment[seat.id] = males[i]));
    targetF.forEach((seat, i) => (assignment[seat.id] = females[i]));
    const rest = shuffle([...males.slice(targetM.length), ...females.slice(targetF.length), ...unknown], rand);
    const targetAny = pickSeats(seatsAny, rest.length, input.emptyPolicy, rand);
    if (targetAny.length < rest.length) return { ok: false, error: '남녀 자리 배치 중 자리가 모자랍니다.' };
    targetAny.forEach((seat, i) => (assignment[seat.id] = rest[i]));
  } else {
    const remaining = shuffle(freeStudents.map((s) => s.id), rand);
    const target = pickSeats(freeSeats, remaining.length, input.emptyPolicy, rand);
    target.forEach((seat, i) => (assignment[seat.id] = remaining[i]));
  }

  const check = verifyAssignment(assignment, participants.map((s) => s.id), seats.map((s) => s.id));
  if (check) return { ok: false, error: `배치 검증 실패: ${check}` };
  if (useGender) {
    const byId = new Map(input.students.map((s) => [s.id, s]));
    const fixedSeatIds = new Set(applied.map((f) => f.seatId));
    for (const [seat, sid] of Object.entries(assignment)) {
      const g = gmap[seat];
      if (g && !fixedSeatIds.has(seat) && byId.get(sid)?.gender !== g) return { ok: false, error: '배치 검증 실패: 남녀 자리가 맞지 않음' };
    }
  }

  return {
    ok: true,
    assignment,
    participants: participants.map((s) => s.id),
    appliedFixed: applied,
    skippedFixedAway,
    issues,
    emptySeats: seats.length - participants.length,
    genderNotes,
  };
}

/** 중복·누락·잘못된 좌석이 있으면 오류 문구, 정상이면 null */
export function verifyAssignment(assignment: Assignment, participantIds: string[], activeSeatIds: string[]): string | null {
  const active = new Set(activeSeatIds);
  const seen = new Set<string>();
  for (const [seat, sid] of Object.entries(assignment)) {
    if (!active.has(seat)) return `사용할 수 없는 좌석(${seat})에 배정됨`;
    if (seen.has(sid)) return `학생이 두 번 배정됨(${sid})`;
    seen.add(sid);
  }
  for (const id of participantIds) if (!seen.has(id)) return `배정되지 않은 학생이 있음(${id})`;
  if (seen.size !== participantIds.length) return '참여하지 않는 학생이 배정됨';
  return null;
}

/** 저장된 배치를 현재 명단에 맞게 정리 (삭제된 학생 제거) */
export function reconcileAssignment(assignment: Assignment, students: Student[]): { assignment: Assignment; removed: number; unseated: Student[] } {
  const ids = new Set(students.map((s) => s.id));
  const out: Assignment = {};
  let removed = 0;
  const seated = new Set<string>();
  for (const [seat, sid] of Object.entries(assignment)) {
    if (ids.has(sid) && !seated.has(sid)) {
      out[seat] = sid;
      seated.add(sid);
    } else removed++;
  }
  return { assignment: out, removed, unseated: students.filter((s) => !seated.has(s.id)) };
}

export function layoutEquals(a: SeatLayout, b: SeatLayout): boolean {
  return JSON.stringify(shapeKey(a)) === JSON.stringify(shapeKey(b));
}

/** 배치 결과 비교용: 자리 모양과 사용 안 함 좌석 (남녀 자리 표시는 결과에 영향 없음) */
function shapeKey(l: SeatLayout) {
  return {
    type: l.type,
    cols: seatColumns(l),
    rows: l.type === 'custom' ? l.groups.map((g) => [g.size, g.rows]) : l.rows,
    gaps: columnGaps(l),
    disabled: [...disabledList(l)].sort(),
  };
}

export function normalizeLayout(l: SeatLayout): SeatLayout {
  return { ...l, disabledPair: [...l.disabledPair].sort(), disabledSingle: [...l.disabledSingle].sort(), disabledCustom: [...l.disabledCustom].sort() };
}

/** 분단 목록 정리 (인원 1~4, 줄 1~10, 분단 1~8개, 전체 열 16개 이하) */
export function cleanGroups(groups: DeskGroup[]): DeskGroup[] {
  const out: DeskGroup[] = [];
  let total = 0;
  for (const g of groups.slice(0, LIMITS.groups.max)) {
    const size = Math.min(LIMITS.groupSize.max, Math.max(LIMITS.groupSize.min, Math.round(g.size) || 1));
    if (total + size > LIMITS.totalCols) break;
    total += size;
    out.push({ size, rows: Math.min(LIMITS.rows.max, Math.max(LIMITS.rows.min, Math.round(g.rows) || 1)) });
  }
  return out.length ? out : [{ size: 2, rows: 4 }];
}

/** 범위를 벗어난 사용 안 함 좌석·남녀 자리 정리, 분단별 설정의 줄 수 맞춤 */
export function cleanLayout(l: SeatLayout): SeatLayout {
  const groups = cleanGroups(l.groups ?? []);
  const base = { ...l, groups };
  const pairL = { ...base, type: 'pair' as const };
  const singleL = { ...base, type: 'single' as const };
  const customL = { ...base, type: 'custom' as const };
  const keepIds = (ids: string[], shape: LayoutShape) => [...new Set(ids)].filter((id) => seatExists(shape, id));
  const keepMap = (m: Record<string, Gender>, shape: LayoutShape) => Object.fromEntries(Object.entries(m ?? {}).filter(([id, g]) => (g === 'M' || g === 'F') && seatExists(shape, id)));
  return {
    ...base,
    rows: l.type === 'custom' ? totalRows(customL) : l.rows,
    disabledPair: keepIds(l.disabledPair, pairL),
    disabledSingle: keepIds(l.disabledSingle, singleL),
    disabledCustom: keepIds(l.disabledCustom ?? [], customL),
    genderPair: keepMap(l.genderPair, pairL),
    genderSingle: keepMap(l.genderSingle, singleL),
    genderCustom: keepMap(l.genderCustom, customL),
  };
}

/** 지금 형태를 같은 자리 ID를 갖는 분단별 설정으로 바꿈 (짝꿍형 → 2명 분단들) */
export function toCustomGroups(l: SeatLayout): DeskGroup[] {
  if (l.type === 'pair') {
    const groups: DeskGroup[] = [];
    // 분단 간격 설정(pairsPerGroup)에 따라 짝 몇 개를 한 분단으로 묶을 수 없으므로(분단당 최대 4명) 짝 하나를 한 분단으로
    for (let i = 0; i < l.pairCols; i++) groups.push({ size: 2, rows: l.rows });
    return groups;
  }
  return l.groups;
}
