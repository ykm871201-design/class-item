import { describe, it, expect } from 'vitest';
import { activeSeats, allSeats, drawSeating, precheckSeating, seatId, setFixed, suggestLayout, validateFixed, verifyAssignment, reconcileAssignment, seatColumns } from '../src/shared/seating';
import type { SeatLayout, Student } from '../src/shared/types';
import { makeStudents, TODAY } from './helpers';

function check(layout: SeatLayout, students: Student[], fixed = [] as { seatId: string; studentId: string }[], excludeAway = true, emptyPolicy: 'back' | 'random' = 'back') {
  const r = drawSeating({ layout, students, fixed, excludeAway, emptyPolicy, today: TODAY });
  if (!r.ok) throw new Error(r.error);
  const vals = Object.values(r.assignment);
  expect(new Set(vals).size).toBe(vals.length); // 중복 없음
  const expected = students.filter((s) => !(excludeAway && (s.excluded || s.absentDate === TODAY))).map((s) => s.id).sort();
  expect(vals.slice().sort()).toEqual(expected); // 누락 없음
  const active = new Set(activeSeats(layout).map((s) => s.id));
  for (const k of Object.keys(r.assignment)) expect(active.has(k)).toBe(true);
  return r;
}

describe('자리 배치 - 인원별', () => {
  for (const n of [5, 7, 13, 23, 29, 30]) {
    for (const type of ['pair', 'single'] as const) {
      it(`${n}명 / ${type === 'pair' ? '짝꿍형' : '개인형'}`, () => {
        const students = makeStudents(n);
        const layout = suggestLayout(n, type);
        expect(activeSeats(layout).length).toBeGreaterThanOrEqual(n);
        for (let i = 0; i < 50; i++) {
          const r = check(layout, students);
          expect(r.emptySeats).toBe(activeSeats(layout).length - n);
        }
      });
    }
  }
  it('홀수 인원 짝꿍형: 빈자리는 뒤쪽에 생긴다(기본)', () => {
    const layout = suggestLayout(7, 'pair'); // 2짝 x 2줄 = 8석
    expect(seatColumns(layout) * layout.rows).toBe(8);
    const r = check(layout, makeStudents(7));
    expect(Object.keys(r.assignment)).not.toContain(seatId(1, 3)); // 맨 뒤 오른쪽만 빈자리
  });
  it('빈자리 무작위 정책도 중복·누락 없음', () => {
    const layout = { ...suggestLayout(10, 'single'), rows: 4 };
    for (let i = 0; i < 50; i++) check(layout, makeStudents(10), [], true, 'random');
  });
});

describe('짝꿍형 ↔ 개인형 전환', () => {
  it('형태를 바꿔도 고정 자리가 유효하면 유지되고, 사라지는 좌석은 충돌로 보고', () => {
    const students = makeStudents(20);
    const pair: SeatLayout = { ...suggestLayout(20, 'pair') }; // 3짝(6열) x 4줄
    const fixed = [
      { seatId: seatId(0, 0), studentId: 'id5' },
      { seatId: seatId(0, 5), studentId: 'id6' },
    ];
    expect(validateFixed(pair, students, fixed)).toEqual([]);
    const single: SeatLayout = { ...pair, type: 'single', cols: 5, rows: 4 }; // 5열 → c5 없음
    const issues = validateFixed(single, students, fixed);
    expect(issues).toEqual([{ seatId: seatId(0, 5), studentId: 'id6', reason: 'seat-missing' }]);
    const r = check(single, students, fixed);
    expect(r.assignment[seatId(0, 0)]).toBe('id5');
    expect(r.issues.length).toBe(1);
    // 다시 짝꿍형으로 돌아가면 둘 다 유효
    const r2 = check(pair, students, fixed);
    expect(r2.assignment[seatId(0, 5)]).toBe('id6');
  });
  it('형태별 사용 안 함 좌석은 따로 기억한다', () => {
    const l: SeatLayout = { ...suggestLayout(12, 'pair'), disabledPair: [seatId(0, 0)], disabledSingle: [seatId(1, 1)] };
    expect(activeSeats(l).map((s) => s.id)).not.toContain(seatId(0, 0));
    expect(activeSeats({ ...l, type: 'single' }).map((s) => s.id)).not.toContain(seatId(1, 1));
    expect(activeSeats({ ...l, type: 'single' }).map((s) => s.id)).toContain(seatId(0, 0));
  });
});

describe('숨겨진 고정 자리', () => {
  it('고정 학생은 항상 지정 좌석, 나머지는 무작위', () => {
    const students = makeStudents(30);
    const layout = suggestLayout(30, 'pair');
    const fixed = [
      { seatId: seatId(0, 0), studentId: 'id17' },
      { seatId: seatId(2, 3), studentId: 'id3' },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = check(layout, students, fixed);
      expect(r.assignment[seatId(0, 0)]).toBe('id17');
      expect(r.assignment[seatId(2, 3)]).toBe('id3');
      seen.add(r.assignment[seatId(0, 1)]);
    }
    expect(seen.size).toBeGreaterThan(10); // 고정되지 않은 자리는 실제로 섞인다
    expect(seen.has('id17')).toBe(false);
  });
  it('나머지 학생 배치는 편향이 없다 (카이제곱 근사)', () => {
    const students = makeStudents(6);
    const layout: SeatLayout = { ...suggestLayout(6, 'single'), cols: 3, rows: 2 };
    const fixed = [{ seatId: seatId(0, 0), studentId: 'id1' }];
    const counts: Record<string, number> = {};
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const r = check(layout, students, fixed);
      counts[r.assignment[seatId(0, 1)]] = (counts[r.assignment[seatId(0, 1)]] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['id2', 'id3', 'id4', 'id5', 'id6']);
    const exp = N / 5;
    const chi = Object.values(counts).reduce((a, c) => a + ((c - exp) ** 2) / exp, 0);
    expect(chi).toBeLessThan(20); // 자유도 4, p≈0.0005
  });
  it('setFixed: 같은 학생·같은 좌석 중복 지정 방지', () => {
    let f = setFixed([], 'r0c0', 'id1');
    f = setFixed(f, 'r0c1', 'id1'); // 같은 학생을 다른 좌석에 → 이전 좌석 해제
    expect(f).toEqual([{ seatId: 'r0c1', studentId: 'id1' }]);
    f = setFixed(f, 'r0c1', 'id2'); // 같은 좌석에 다른 학생 → 대체
    expect(f).toEqual([{ seatId: 'r0c1', studentId: 'id2' }]);
    f = setFixed(f, 'r0c1', null);
    expect(f).toEqual([]);
  });
  it('중복 고정 데이터가 들어와도 첫 항목만 적용하고 나머지는 보고', () => {
    const students = makeStudents(8);
    const layout = suggestLayout(8, 'pair');
    const fixed = [
      { seatId: 'r0c0', studentId: 'id1' },
      { seatId: 'r0c1', studentId: 'id1' },
      { seatId: 'r0c0', studentId: 'id2' },
    ];
    const issues = validateFixed(layout, students, fixed);
    expect(issues.map((i) => i.reason)).toEqual(['duplicate-student', 'duplicate-seat']);
    const r = check(layout, students, fixed);
    expect(r.assignment.r0c0).toBe('id1');
  });
  it('결석·제외된 고정 학생은 억지로 포함하지 않는다', () => {
    const students = makeStudents(9);
    students[0].absentDate = TODAY;
    students[1].excluded = true;
    const layout = suggestLayout(9, 'pair');
    const fixed = [
      { seatId: 'r0c0', studentId: 'id1' },
      { seatId: 'r0c1', studentId: 'id2' },
      { seatId: 'r1c0', studentId: 'id3' },
    ];
    for (let i = 0; i < 30; i++) {
      const r = check(layout, students, fixed, true);
      expect(Object.values(r.assignment)).not.toContain('id1');
      expect(Object.values(r.assignment)).not.toContain('id2');
      expect(r.assignment.r1c0).toBe('id3');
      expect(r.skippedFixedAway.map((f) => f.studentId).sort()).toEqual(['id1', 'id2']);
    }
    // 결석 학생 포함 옵션이면 고정 유지
    const r = check(layout, students, fixed, false);
    expect(r.assignment.r0c0).toBe('id1');
  });
  it('삭제된 학생의 고정은 적용되지 않는다', () => {
    const students = makeStudents(6);
    const layout = suggestLayout(6, 'pair');
    const issues = validateFixed(layout, students, [{ seatId: 'r0c0', studentId: 'deleted' }]);
    expect(issues[0].reason).toBe('student-missing');
  });
});

describe('좌석 부족 · 비활성 좌석', () => {
  it('활성 좌석이 학생보다 적으면 실행 전 안내', () => {
    const layout: SeatLayout = { ...suggestLayout(8, 'pair'), disabledPair: ['r0c0'] }; // 8석 중 7석
    const pre = precheckSeating({ layout, students: makeStudents(8), fixed: [], excludeAway: true, today: TODAY });
    expect(pre.error).toMatch(/7석/);
    const r = drawSeating({ layout, students: makeStudents(8), fixed: [], excludeAway: true, emptyPolicy: 'back', today: TODAY });
    expect(r.ok).toBe(false);
  });
  it('결석으로 인원이 줄면 부족 상황이 해소된다', () => {
    const layout: SeatLayout = { ...suggestLayout(8, 'pair'), disabledPair: ['r0c0'] };
    const st = makeStudents(8);
    st[3].absentDate = TODAY;
    check(layout, st);
  });
  it('비활성 좌석에는 아무도 배정되지 않고, 비활성 좌석의 고정은 보고된다', () => {
    const layout: SeatLayout = { ...suggestLayout(20, 'single'), rows: 5, disabledSingle: ['r0c0', 'r0c4'] };
    for (let i = 0; i < 50; i++) {
      const r = check(layout, makeStudents(20), [{ seatId: 'r0c0', studentId: 'id1' }]);
      expect(r.assignment.r0c0).toBeUndefined();
      expect(r.assignment.r0c4).toBeUndefined();
      expect(r.issues[0].reason).toBe('seat-disabled');
    }
  });
});

describe('검증 함수', () => {
  it('verifyAssignment가 중복·누락을 잡는다', () => {
    expect(verifyAssignment({ a: 'x', b: 'x' }, ['x'], ['a', 'b'])).toMatch(/두 번/);
    expect(verifyAssignment({ a: 'x' }, ['x', 'y'], ['a', 'b'])).toMatch(/배정되지 않은/);
    expect(verifyAssignment({ c: 'x' }, ['x'], ['a'])).toMatch(/사용할 수 없는/);
    expect(verifyAssignment({ a: 'x' }, ['x'], ['a'])).toBeNull();
  });
  it('저장된 배치 불러오기: 삭제된 학생 제거, 새 학생은 미배정 목록', () => {
    const st = makeStudents(4);
    const r = reconcileAssignment({ r0c0: 'id1', r0c1: 'gone', r0c2: 'id2' }, st);
    expect(r.assignment).toEqual({ r0c0: 'id1', r0c2: 'id2' });
    expect(r.removed).toBe(1);
    expect(r.unseated.map((s) => s.id)).toEqual(['id3', 'id4']);
  });
  it('좌석은 앞줄·왼쪽부터 정렬', () => {
    const ids = allSeats({ ...suggestLayout(4, 'single'), cols: 2, rows: 2 }).map((s) => s.id);
    expect(ids).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
  });
});
