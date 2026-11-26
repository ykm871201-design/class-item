// 학급임원선거: 설정 검증, 투표 접수, 개표·동점 판정, 재투표 — 화면·저장과 무관한 순수 함수
//
// 비밀투표 원칙
// - 후보별 합계·투표 인원·기권 수만 남긴다. 누가 누구를 골랐는지, 몇 번째 투표가 누구를 골랐는지는 남기지 않는다.
// - 투표 기회 토큰은 무작위 값으로, 중복 접수 방지에만 쓰고 선택 내용과 연결하지 않는다.
// - 당선 경계에서 동점이면 이름순·기호순·무작위로 정하지 않고 ‘재투표 필요’로 둔다.
import type { Election, ElectionCandidate, ElectionResult, ElectionResultRow, Student } from './types';
import { newId } from './util';

/** 후보 색상 (기호 순서대로, TV에서 멀리서도 구분되는 진한 색) */
export const CANDIDATE_COLORS = ['#1c7ed6', '#e03131', '#2b8a3e', '#f08c00', '#7048e8', '#0c8599', '#c2255c', '#5c940d', '#495057', '#d9480f'];

export const ELECTION_LIMITS = { seats: { min: 1, max: 10 }, voters: { min: 1, max: 100 }, candidates: { max: 20 }, title: 40, position: 20 };

export const PHASE_LABEL: Record<Election['phase'], string> = {
  setup: '설정',
  voting: '투표 진행',
  closed: '투표 마감 · 결과 확인',
  published: '결과 공개',
};

export function candidateColor(number: number): string {
  return CANDIDATE_COLORS[(Math.max(1, number) - 1) % CANDIDATE_COLORS.length];
}

export function newElection(classId: string, now: number, init: Partial<Pick<Election, 'title' | 'position' | 'voterLimit'>> = {}): Election {
  return {
    id: newId('el_'),
    classId,
    title: init.title ?? '학급임원선거',
    position: init.position ?? '회장',
    seats: 1,
    voterLimit: Math.max(1, Math.min(ELECTION_LIMITS.voters.max, init.voterLimit ?? 25)),
    maxChoices: 1,
    candidates: [],
    phase: 'setup',
    tally: {},
    ballots: 0,
    abstain: 0,
    openBallot: null,
    receipts: [],
    createdAt: now,
  };
}

/** 기호를 1부터 차례로 다시 매기고 색을 맞춘다 (설정 단계에서만) */
export function renumber(cands: ElectionCandidate[]): ElectionCandidate[] {
  return cands.map((c, i) => ({ ...c, number: i + 1, color: candidateColor(i + 1) }));
}

/** 설정 값 오류 (투표 시작 전에 모두 없어야 함) */
export function setupProblems(e: Election, students: Student[]): string[] {
  const p: string[] = [];
  if (!e.title.trim()) p.push('선거명을 입력해 주세요.');
  if (!e.position.trim()) p.push('직책명을 입력해 주세요.');
  const int = (n: number) => Number.isInteger(n);
  if (!int(e.seats) || e.seats < ELECTION_LIMITS.seats.min || e.seats > ELECTION_LIMITS.seats.max) p.push(`선출 인원은 ${ELECTION_LIMITS.seats.min}~${ELECTION_LIMITS.seats.max}명이어야 합니다.`);
  if (!int(e.voterLimit) || e.voterLimit < ELECTION_LIMITS.voters.min || e.voterLimit > ELECTION_LIMITS.voters.max) p.push(`투표 가능 인원은 ${ELECTION_LIMITS.voters.min}~${ELECTION_LIMITS.voters.max}명이어야 합니다.`);
  if (!int(e.maxChoices) || e.maxChoices < 1) p.push('1인당 선택 수는 1명 이상이어야 합니다.');
  else if (int(e.seats) && e.maxChoices > e.seats) p.push(`1인당 선택 수(${e.maxChoices}명)는 선출 인원(${e.seats}명)보다 많을 수 없습니다.`);
  const ids = e.candidates.map((c) => c.studentId);
  if (new Set(ids).size !== ids.length) p.push('같은 학생이 후보로 두 번 등록되어 있습니다.');
  const nums = e.candidates.map((c) => c.number);
  if (new Set(nums).size !== nums.length) p.push('후보 기호가 겹칩니다.');
  if (!e.runoff) {
    const roster = new Set(students.map((s) => s.id));
    const gone = e.candidates.filter((c) => !roster.has(c.studentId));
    if (gone.length) p.push(`명단에 없는 후보가 있습니다: ${gone.map((c) => c.name).join(', ')}`);
  }
  if (e.candidates.length > ELECTION_LIMITS.candidates.max) p.push(`후보는 최대 ${ELECTION_LIMITS.candidates.max}명까지 등록할 수 있습니다.`);
  if (e.candidates.length <= e.seats) p.push(`후보가 선출 인원보다 많아야 투표를 시작할 수 있습니다. (지금 후보 ${e.candidates.length}명, 선출 ${e.seats}명)`);
  return p;
}

export type BallotCheck = { ok: true } | { ok: false; error: string };

/** 제출한 선택이 규칙에 맞는지 (후보 ID 목록, 기권이면 빈 목록 + abstain=true) */
export function checkChoices(e: Election, choices: unknown, abstain: boolean): BallotCheck {
  if (!Array.isArray(choices) || choices.some((x) => typeof x !== 'string')) return { ok: false, error: '선택 내용이 올바르지 않습니다.' };
  const list = choices as string[];
  if (abstain) return list.length === 0 ? { ok: true } : { ok: false, error: '기권할 때는 후보를 고르지 않습니다.' };
  if (list.length === 0) return { ok: false, error: '후보를 고르거나 ‘기권’을 눌러 주세요.' };
  if (new Set(list).size !== list.length) return { ok: false, error: '같은 후보를 두 번 고를 수 없습니다.' };
  if (list.length > e.maxChoices) return { ok: false, error: `최대 ${e.maxChoices}명까지 고를 수 있습니다.` };
  const valid = new Set(e.candidates.map((c) => c.id));
  if (list.some((id) => !valid.has(id))) return { ok: false, error: '후보 목록에 없는 선택이 있습니다.' };
  return { ok: true };
}

export type SubmitOutcome = { kind: 'accepted' } | { kind: 'duplicate' } | { kind: 'rejected'; error: string };

/**
 * 열린 투표 기회(token)로 한 번 접수한다. 같은 토큰을 다시 보내면 다시 세지 않는다(duplicate).
 * e를 직접 바꾼다. 개인 선택은 합계에만 더하고 따로 남기지 않는다.
 */
export function acceptBallot(e: Election, token: unknown, choices: unknown, abstain: boolean): SubmitOutcome {
  if (typeof token !== 'string' || !token) return { kind: 'rejected', error: '투표 기회가 없습니다.' };
  if (e.receipts.includes(token)) return { kind: 'duplicate' };
  if (e.phase !== 'voting') return { kind: 'rejected', error: '투표가 진행 중이 아닙니다.' };
  if (!e.openBallot || e.openBallot.token !== token) return { kind: 'rejected', error: '이 투표 기회는 끝났거나 열리지 않았습니다. 선생님께 말씀해 주세요.' };
  if (e.ballots >= e.voterLimit) return { kind: 'rejected', error: '투표 가능 인원이 모두 투표했습니다.' };
  const c = checkChoices(e, choices, abstain);
  if (!c.ok) return { kind: 'rejected', error: c.error };
  for (const id of choices as string[]) e.tally[id] = (e.tally[id] ?? 0) + 1;
  e.ballots += 1;
  if (abstain) e.abstain += 1;
  e.openBallot = null;
  e.receipts = [...e.receipts, token].slice(-(ELECTION_LIMITS.voters.max * 2));
  return { kind: 'accepted' };
}

/**
 * 개표: 득표 많은 순으로 선출 인원만큼 당선.
 * 선출 인원 경계에서 동점이면 경계 위 후보만 당선 확정하고 동점 후보는 재투표 대상으로 둔다.
 * 투표 0명·전원 기권이면 당선자를 정하지 않는다.
 */
export function computeResult(e: Election): ElectionResult {
  const rows: ElectionResultRow[] = e.candidates
    .map((c) => ({ candidateId: c.id, number: c.number, name: c.name, color: c.color, votes: Math.max(0, Math.round(e.tally[c.id] ?? 0)), elected: false, tied: false }))
    .sort((a, b) => b.votes - a.votes || a.number - b.number);
  const totalMarks = rows.reduce((n, r) => n + r.votes, 0);
  const base = { rows, ballots: e.ballots, abstain: e.abstain, totalMarks };
  if (e.ballots === 0) return { ...base, status: 'no-votes', winners: [], tied: [], seatsLeft: e.seats };
  if (totalMarks === 0) return { ...base, status: 'all-abstain', winners: [], tied: [], seatsLeft: e.seats };
  const seats = Math.min(e.seats, rows.length);
  const cut = rows[seats - 1].votes; // 마지막 당선 자리의 득표
  const above = rows.filter((r) => r.votes > cut);
  const atCut = rows.filter((r) => r.votes === cut);
  let winners: string[];
  let tied: string[] = [];
  if (above.length + atCut.length <= seats) {
    winners = [...above, ...atCut].map((r) => r.candidateId);
  } else {
    winners = above.map((r) => r.candidateId);
    tied = atCut.map((r) => r.candidateId);
  }
  const w = new Set(winners);
  const t = new Set(tied);
  for (const r of rows) {
    r.elected = w.has(r.candidateId);
    r.tied = t.has(r.candidateId);
  }
  return { ...base, status: tied.length ? 'tie' : 'decided', winners, tied, seatsLeft: seats - winners.length };
}

/** 동점 후보만으로 재투표 선거를 만든다 (기호·이름·색은 원래 선거 그대로, 선출 인원은 남은 자리만) */
export function makeRunoff(e: Election, now: number): Election | null {
  if (e.phase !== 'closed' && e.phase !== 'published') return null;
  const r = computeResult(e);
  if (r.status !== 'tie') return null;
  const tied = new Set(r.tied);
  const priorWinners = [...(e.runoff?.priorWinners ?? []), ...e.candidates.filter((c) => r.winners.includes(c.id)).map((c) => c.name)];
  return {
    ...newElection(e.classId, now),
    title: `${e.title.replace(/ \(재투표( \d+)?\)$/, '')} (재투표)`.slice(0, ELECTION_LIMITS.title),
    position: e.position,
    seats: r.seatsLeft,
    voterLimit: e.voterLimit,
    maxChoices: Math.min(e.maxChoices, r.seatsLeft),
    candidates: e.candidates.filter((c) => tied.has(c.id)).map((c) => ({ ...c, id: newId('ec_') })),
    runoff: { parentId: e.id, priorWinners },
  };
}

/** 설정 단계에서만 바꿀 수 있는 값 정리 */
export function applySetupPatch(e: Election, patch: Record<string, unknown>): void {
  if (typeof patch.title === 'string') e.title = patch.title.slice(0, ELECTION_LIMITS.title);
  if (typeof patch.position === 'string') e.position = patch.position.slice(0, ELECTION_LIMITS.position);
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
  if (patch.seats !== undefined && !Number.isNaN(int(patch.seats))) e.seats = int(patch.seats);
  if (patch.voterLimit !== undefined && !Number.isNaN(int(patch.voterLimit))) e.voterLimit = int(patch.voterLimit);
  if (patch.maxChoices !== undefined && !Number.isNaN(int(patch.maxChoices))) e.maxChoices = int(patch.maxChoices);
}
