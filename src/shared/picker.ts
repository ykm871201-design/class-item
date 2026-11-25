// 발표자 뽑기 (자리 배치의 고정 설정과 무관)
import type { PickMode, Student } from './types';
import { isAway } from './roster';
import { cryptoRandomInt, shuffle, type RandomInt } from './util';

export interface PickInput {
  students: Student[];
  mode: PickMode;
  excludeAway: boolean;
  pickedPool: string[];
  count: number;
  today: string;
  rand?: RandomInt;
}

export function eligibleStudents(input: Omit<PickInput, 'count' | 'rand'>): Student[] {
  const pool = new Set(input.pickedPool);
  return input.students.filter((s) => {
    if (input.excludeAway && isAway(s, input.today)) return false;
    if (input.mode === 'unique' && pool.has(s.id)) return false;
    return true;
  });
}

export type PickResult =
  | { ok: true; picked: Student[]; newPool: string[]; remainingAfter: number; allDone: boolean }
  | { ok: false; error: string; allDone?: boolean };

export function pickStudents(input: PickInput): PickResult {
  const rand = input.rand ?? cryptoRandomInt;
  const count = Math.floor(input.count);
  if (!(count >= 1)) return { ok: false, error: '뽑을 인원은 1명 이상이어야 합니다.' };
  const eligible = eligibleStudents(input);
  if (eligible.length === 0) {
    if (input.mode === 'unique' && input.pickedPool.length > 0)
      return { ok: false, error: '모든 학생이 이미 뽑혔습니다. "뽑힌 학생 다시 포함"을 눌러 초기화해 주세요.', allDone: true };
    return { ok: false, error: '추첨할 수 있는 학생이 없습니다.' };
  }
  if (count > eligible.length)
    return { ok: false, error: `추첨 가능한 학생은 ${eligible.length}명입니다. 뽑을 인원(${count}명)을 줄여 주세요.` };
  // 한 회차 안에서는 중복 없이: 셔플 후 앞에서 count명
  const picked = shuffle(eligible, rand).slice(0, count);
  const newPool = input.mode === 'unique' ? [...input.pickedPool, ...picked.map((s) => s.id)] : input.pickedPool.slice();
  const remainingAfter = input.mode === 'unique' ? eligible.length - count : eligible.length;
  return { ok: true, picked, newPool, remainingAfter, allDone: input.mode === 'unique' && remainingAfter === 0 };
}
