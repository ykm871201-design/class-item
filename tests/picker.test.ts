import { describe, it, expect } from 'vitest';
import { pickStudents, eligibleStudents } from '../src/shared/picker';
import { makeStudents, TODAY } from './helpers';

describe('발표자 뽑기', () => {
  it('중복 없이 뽑기: 전원이 한 번씩 뽑히고 완료 안내', () => {
    const st = makeStudents(7);
    let pool: string[] = [];
    const all: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = pickStudents({ students: st, mode: 'unique', excludeAway: true, pickedPool: pool, count: 2, today: TODAY });
      if (!r.ok) throw new Error(r.error);
      all.push(...r.picked.map((s) => s.id));
      pool = r.newPool;
    }
    const last = pickStudents({ students: st, mode: 'unique', excludeAway: true, pickedPool: pool, count: 1, today: TODAY });
    if (!last.ok) throw new Error(last.error);
    expect(last.allDone).toBe(true);
    all.push(...last.picked.map((s) => s.id));
    expect(new Set(all).size).toBe(7);
    const after = pickStudents({ students: st, mode: 'unique', excludeAway: true, pickedPool: last.newPool, count: 1, today: TODAY });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.allDone).toBe(true); // 자동으로 다시 포함하지 않음
  });
  it('남은 인원보다 많이 요청하면 실행 전 안내', () => {
    const st = makeStudents(5);
    const r = pickStudents({ students: st, mode: 'unique', excludeAway: true, pickedPool: ['id1', 'id2', 'id3'], count: 3, today: TODAY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2명/);
  });
  it('매번 전체에서 뽑기: 이전 당첨자도 참여, 한 회차 안 중복 없음', () => {
    const st = makeStudents(5);
    for (let i = 0; i < 200; i++) {
      const r = pickStudents({ students: st, mode: 'all', excludeAway: true, pickedPool: ['id1'], count: 5, today: TODAY });
      if (!r.ok) throw new Error(r.error);
      expect(new Set(r.picked.map((s) => s.id)).size).toBe(5);
      expect(r.newPool).toEqual(['id1']);
    }
  });
  it('결석·제외 학생 제외 옵션', () => {
    const st = makeStudents(6);
    st[0].absentDate = TODAY;
    st[1].excluded = true;
    st[2].absentDate = '2026-11-24'; // 어제 결석 → 오늘은 참여
    expect(eligibleStudents({ students: st, mode: 'all', excludeAway: true, pickedPool: [], today: TODAY }).length).toBe(4);
    expect(eligibleStudents({ students: st, mode: 'all', excludeAway: false, pickedPool: [], today: TODAY }).length).toBe(6);
  });
  it('추첨은 고르게 분포', () => {
    const st = makeStudents(5);
    const c: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) {
      const r = pickStudents({ students: st, mode: 'all', excludeAway: true, pickedPool: [], count: 1, today: TODAY });
      if (r.ok) c[r.picked[0].id] = (c[r.picked[0].id] ?? 0) + 1;
    }
    for (const v of Object.values(c)) expect(Math.abs(v - 2000)).toBeLessThan(200);
  });
});
