import { describe, it, expect } from 'vitest';
import { evaluateTick, nextRun, findConflicts, validateSchedule, occurrenceKey, describeRepeat } from '../src/shared/schedule';
import type { Schedule } from '../src/shared/types';

// 2026-11-25 은 수요일
const at = (d: number, h: number, m: number, s = 0) => new Date(2026, 10, d, h, m, s).getTime();

function sch(p: Partial<Schedule>): Schedule {
  return { id: 'a', name: '쉬는 시간', enabled: true, time: '10:20', durationSec: 300, repeat: 'weekly', date: '', days: [1, 2, 3, 4, 5], activity: '', sound: 'chime', volume: 70, displayMode: 'split', createdAt: 0, activeSince: 0, ...p };
}

describe('다음 실행 시각', () => {
  it('월~금 10:20 — 수요일 09:00이면 오늘 10:20', () => {
    expect(nextRun(sch({}), at(25, 9, 0))).toBe(at(25, 10, 20));
  });
  it('이미 실행했으면 다음 날', () => {
    expect(nextRun(sch({}), at(25, 10, 20, 5), '2026-11-25T10:20')).toBe(at(26, 10, 20));
  });
  it('금요일 10:21 이후면 다음 주 월요일', () => {
    expect(nextRun(sch({}), at(27, 10, 21))).toBe(at(30, 10, 20));
  });
  it('토·일만 반복', () => {
    expect(nextRun(sch({ days: [0, 6] }), at(25, 12, 0))).toBe(at(28, 10, 20));
  });
  it('한 번 실행: 지난 시각은 없음, 미래는 해당 시각', () => {
    expect(nextRun(sch({ repeat: 'once', date: '2026-11-26' }), at(25, 12, 0))).toBe(at(26, 10, 20));
    expect(nextRun(sch({ repeat: 'once', date: '2026-11-24' }), at(25, 12, 0))).toBeNull();
  });
  it('비활성 예약은 다음 실행 없음', () => {
    expect(nextRun(sch({ enabled: false }), at(25, 9, 0))).toBeNull();
  });
  it('월말·연말을 넘어가도 계산', () => {
    const s = sch({ days: [5], time: '08:00' });
    expect(nextRun(s, new Date(2026, 11, 31, 9).getTime())).toBe(new Date(2027, 0, 1, 8, 0).getTime());
  });
});

describe('예약 감시 판정', () => {
  it('정시에 한 번만 실행 (중복 실행 방지)', () => {
    const s = sch({});
    const fired: Record<string, string> = {};
    let last = at(25, 10, 19, 58);
    const fires: string[] = [];
    for (let t = at(25, 10, 19, 59); t <= at(25, 10, 22, 0); t += 1000) {
      const r = evaluateTick([s], fired, last, t);
      for (const o of r.due) {
        fires.push(o.key);
        fired[s.id] = o.key;
      }
      expect(r.missed).toEqual([]);
      last = t;
    }
    expect(fires).toEqual(['2026-11-25T10:20']);
  });
  it('같은 tick을 두 번 평가해도 fired 기록으로 한 번만', () => {
    const s = sch({});
    const r1 = evaluateTick([s], {}, at(25, 10, 19), at(25, 10, 20, 1));
    expect(r1.due.length).toBe(1);
    const r2 = evaluateTick([s], { a: r1.due[0].key }, at(25, 10, 19), at(25, 10, 20, 1));
    expect(r2.due.length).toBe(0);
  });
  it('절전 복귀: 오래전 놓친 예약은 실행하지 않고 놓침으로 기록', () => {
    const s = sch({});
    // 월요일 09:00 절전 → 수요일 15:00 복귀
    const r = evaluateTick([s], {}, at(23, 9, 0), at(25, 15, 0));
    expect(r.due).toEqual([]);
    expect(r.missed.map((o) => o.key)).toEqual(['2026-11-23T10:20', '2026-11-24T10:20', '2026-11-25T10:20']);
  });
  it('2분 이내 지연(앱 재실행 직후 등)은 실행', () => {
    const r = evaluateTick([sch({})], {}, at(25, 10, 0), at(25, 10, 21, 30));
    expect(r.due.length).toBe(1);
  });
  it('여러 번 놓친 뒤 마지막이 방금이면 마지막만 실행, 이전은 놓침', () => {
    const r = evaluateTick([sch({})], {}, at(24, 9, 0), at(25, 10, 20, 10));
    expect(r.due.map((o) => o.key)).toEqual(['2026-11-25T10:20']);
    expect(r.missed.map((o) => o.key)).toEqual(['2026-11-24T10:20']);
  });
  it('예약 생성(활성화) 이전 발생은 놓침으로 보지 않음', () => {
    const r = evaluateTick([sch({ activeSince: at(25, 12, 0) })], {}, at(20, 0, 0), at(25, 12, 0, 5));
    expect(r.missed).toEqual([]);
  });
  it('비활성 예약은 실행되지 않음', () => {
    const r = evaluateTick([sch({ enabled: false })], {}, at(25, 10, 19), at(25, 10, 20, 1));
    expect(r.due).toEqual([]);
  });
  it('시계를 뒤로 돌려도 안전 (lastCheck > now)', () => {
    const r = evaluateTick([sch({})], {}, at(25, 11, 0), at(25, 10, 20, 1));
    expect(r.due).toEqual([]);
  });
  it('occurrenceKey는 현지 시각', () => {
    expect(occurrenceKey(at(25, 10, 20))).toBe('2026-11-25T10:20');
  });
});

describe('충돌·검증', () => {
  it('같은 시각·겹치는 요일은 충돌', () => {
    const a = sch({ id: 'a' });
    const b = sch({ id: 'b', days: [5, 6] });
    expect(findConflicts(a, [b]).map((x) => x.id)).toEqual(['b']);
    expect(findConflicts(a, [sch({ id: 'c', days: [0, 6] })])).toEqual([]);
    expect(findConflicts(a, [sch({ id: 'd', time: '10:21' })])).toEqual([]);
    expect(findConflicts(a, [sch({ id: 'e', enabled: false })])).toEqual([]);
  });
  it('한 번 실행과 반복 예약의 충돌', () => {
    const once = sch({ id: 'o', repeat: 'once', date: '2026-11-25' }); // 수요일
    expect(findConflicts(once, [sch({ id: 'w' })]).length).toBe(1);
    expect(findConflicts(once, [sch({ id: 'w', days: [1] })]).length).toBe(0);
  });
  it('검증 문구', () => {
    expect(validateSchedule(sch({ days: [] }), at(25, 9, 0))).toContain('반복할 요일을 하나 이상 선택해 주세요.');
    expect(validateSchedule(sch({ repeat: 'once', date: '2026-11-25', time: '08:00' }), at(25, 9, 0)).join()).toMatch(/지난/);
    expect(validateSchedule(sch({ durationSec: 0 }), at(25, 9, 0)).join()).toMatch(/타이머 길이/);
    expect(validateSchedule(sch({}), at(25, 9, 0))).toEqual([]);
  });
  it('반복 설명', () => {
    expect(describeRepeat(sch({}))).toBe('매주 월~금');
    expect(describeRepeat(sch({ days: [0, 1, 2, 3, 4, 5, 6] }))).toBe('매일');
  });
});
