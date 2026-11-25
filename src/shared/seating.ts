// 자리 배치: 좌석 생성, 고정 자리 검증, 무작위 배치 알고리즘
import type { Assignment, EmptySeatPolicy, FixedSeat, LayoutType, SeatLayout, Student } from './types';
import { isAway } from './roster';
import { cryptoRandomInt, shuffle, type RandomInt } from './util';

export const LIMITS = {
  rows: { min: 1, max: 10 },
  pairCols: { min: 1, max: 6 },
  cols: { min: 1, max: 12 },
};

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

export function seatColumns(layout: Pick<SeatLayout, 'type' | 'pairCols' | 'cols'>): number {
  return layout.type === 'pair' ? layout.pairCols * 2 : layout.cols;
}

export function disabledList(layout: SeatLayout): string[] {
  return layout.type === 'pair' ? layout.disabledPair : layout.disabledSingle;
}

/** 앞줄부터, 학생 기준 왼쪽부터 정렬된 전체 좌석 */
export function allSeats(layout: SeatLayout): Seat[] {
  const cols = seatColumns(layout);
  const out: Seat[] = [];
  for (let r = 0; r < layout.rows; r++) for (let c = 0; c < cols; c++) out.push({ id: seatId(r, c), r, c });
  return out;
}

export function seatExists(layout: SeatLayout, id: string): boolean {
  const p = parseSeatId(id);
  return !!p && p.r < layout.rows && p.c < seatColumns(layout);
}

export function activeSeats(layout: SeatLayout): Seat[] {
  const dis = new Set(disabledList(layout));
  return allSeats(layout).filter((s) => !dis.has(s.id));
}

/** 교사에게 보여 줄 좌석 이름 (학생이 칠판을 바라보는 기준) */
export function seatLabel(id: string, layout?: SeatLayout): string {
  const p = parseSeatId(id);
  if (!p) return id;
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
  return {
    type,
    pairCols,
    cols,
    rows: Math.min(LIMITS.rows.max, type === 'pair' ? rowsPair : rowsSingle),
    disabledPair: [],
    disabledSingle: [],
    pairsPerGroup: prev?.pairsPerGroup ?? 1,
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
}

export interface DrawFailure {
  ok: false;
  error: string;
}

/** 배치 전 점검: 활성 좌석이 참여 학생보다 적은지 등 */
export function precheckSeating(input: Omit<DrawInput, 'rand' | 'emptyPolicy'>): { participants: Student[]; seats: Seat[]; error: string | null } {
  const seats = activeSeats(input.layout);
  const participants = input.students.filter((s) => !(input.excludeAway && isAway(s, input.today)));
  let error: string | null = null;
  if (participants.length === 0) error = '배치할 학생이 없습니다. 학생 명단을 확인해 주세요.';
  else if (participants.length > seats.length)
    error = `사용 가능한 자리(${seats.length}석)가 참여 학생(${participants.length}명)보다 적습니다. 줄·열을 늘리거나 사용하지 않는 자리를 다시 켜 주세요.`;
  return { participants, seats, error };
}

/**
 * 자리 배치 알고리즘
 * 1) 사용 가능한 좌석과 참여 학생 확정
 * 2) 유효한 고정 배치를 먼저 반영
 * 3) 나머지 학생을 남은 좌석에 편향 없이 무작위 배치 (Fisher–Yates)
 * 4) 중복·누락 검사
 */
export function drawSeating(input: DrawInput): DrawSuccess | DrawFailure {
  const rand = input.rand ?? cryptoRandomInt;
  const pre = precheckSeating(input);
  if (pre.error) return { ok: false, error: pre.error };
  const { participants, seats } = pre;
  const participantIds = new Set(participants.map((s) => s.id));
  const issues = validateFixed(input.layout, input.students, input.fixed);
  const bad = new Set(issues.map((i) => `${i.seatId}|${i.studentId}`));

  const assignment: Assignment = {};
  const appliedFixed: FixedSeat[] = [];
  const skippedFixedAway: FixedSeat[] = [];
  for (const f of input.fixed) {
    if (bad.has(`${f.seatId}|${f.studentId}`)) continue;
    if (!participantIds.has(f.studentId)) {
      skippedFixedAway.push(f); // 제외된 고정 학생은 억지로 포함하지 않는다
      continue;
    }
    assignment[f.seatId] = f.studentId;
    appliedFixed.push(f);
  }
  const fixedStudents = new Set(appliedFixed.map((f) => f.studentId));
  const remainingStudents = participants.filter((s) => !fixedStudents.has(s.id)).map((s) => s.id);
  const remainingSeats = seats.filter((s) => !(s.id in assignment));

  let targetSeats: Seat[];
  if (input.emptyPolicy === 'random') targetSeats = shuffle(remainingSeats, rand).slice(0, remainingStudents.length);
  else targetSeats = remainingSeats.slice(0, remainingStudents.length); // 앞자리부터 채우고 뒤쪽을 비움

  const shuffled = shuffle(remainingStudents, rand);
  targetSeats.forEach((seat, i) => {
    assignment[seat.id] = shuffled[i];
  });

  const check = verifyAssignment(assignment, participants.map((s) => s.id), seats.map((s) => s.id));
  if (check) return { ok: false, error: `배치 검증 실패: ${check}` };

  return {
    ok: true,
    assignment,
    participants: participants.map((s) => s.id),
    appliedFixed,
    skippedFixedAway,
    issues,
    emptySeats: seats.length - participants.length,
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
  return JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b));
}

export function normalizeLayout(l: SeatLayout): SeatLayout {
  return {
    type: l.type,
    pairCols: l.pairCols,
    cols: l.cols,
    rows: l.rows,
    disabledPair: [...l.disabledPair].sort(),
    disabledSingle: [...l.disabledSingle].sort(),
    pairsPerGroup: l.pairsPerGroup,
  };
}

/** 범위를 벗어난 사용 안 함 좌석 정리 */
export function cleanLayout(l: SeatLayout): SeatLayout {
  const pairL = { ...l, type: 'pair' as const };
  const singleL = { ...l, type: 'single' as const };
  return {
    ...l,
    disabledPair: [...new Set(l.disabledPair)].filter((id) => seatExists(pairL, id)),
    disabledSingle: [...new Set(l.disabledSingle)].filter((id) => seatExists(singleL, id)),
  };
}
