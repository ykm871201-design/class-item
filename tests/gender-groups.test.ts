import { describe, it, expect } from 'vitest';
import { activeSeats, allSeats, columnGaps, drawSeating, genderPattern, precheckSeating, seatExists, seatId, suggestLayout, cycleGender, toCustomGroups, cleanLayout, layoutEquals } from '../src/shared/seating';
import { parseRosterText, mergeRoster } from '../src/shared/roster';
import { buildStudentView } from '../src/shared/studentView';
import { defaultData, newClass, normalizeData } from '../src/shared/defaults';
import { idleTimer } from '../src/shared/timer';
import type { Gender, SeatLayout, Student } from '../src/shared/types';
import { makeStudents, TODAY } from './helpers';

function custom(groups: [number, number][]): SeatLayout {
  return cleanLayout({ ...suggestLayout(10, 'custom'), groups: groups.map(([size, rows]) => ({ size, rows })) });
}
function withGender(n: number, males: number): Student[] {
  return makeStudents(n).map((s, i) => ({ ...s, gender: (i < males ? 'M' : 'F') as Gender }));
}
function draw(layout: SeatLayout, students: Student[], fixed: { seatId: string; studentId: string }[] = [], emptyPolicy: 'back' | 'random' = 'back') {
  return drawSeating({ layout, students, fixed, excludeAway: true, emptyPolicy, today: TODAY });
}
function checkNoDup(r: ReturnType<typeof draw>, n: number) {
  if (!r.ok) throw new Error(r.error);
  const v = Object.values(r.assignment);
  expect(v.length).toBe(n);
  expect(new Set(v).size).toBe(n);
}

describe('분단별 설정 (분단마다 한 줄 인원이 다름)', () => {
  it('1분단 2명 · 2분단 3명, 분단마다 줄 수 다름', () => {
    const l = custom([[2, 4], [3, 3]]);
    expect(allSeats(l).length).toBe(2 * 4 + 3 * 3);
    expect(seatExists(l, seatId(3, 1))).toBe(true); // 1분단 4째 줄
    expect(seatExists(l, seatId(3, 2))).toBe(false); // 2분단은 3줄뿐
    expect(seatExists(l, seatId(0, 5))).toBe(false);
    expect(l.rows).toBe(4);
    // 같은 분단 안은 좁게, 분단 사이는 넓게
    expect(columnGaps(l)).toEqual([0.05, 0.55, 0.05, 0.05]);
  });
  for (const n of [5, 13, 17]) {
    it(`${n}명 배치: 중복·누락 없음`, () => {
      const l = custom([[2, 4], [3, 3]]);
      for (let i = 0; i < 50; i++) checkNoDup(draw(l, makeStudents(n)), n);
    });
  }
  it('30명: 2·3·2 분단 5줄 (35석)', () => {
    const l = custom([[2, 5], [3, 5], [2, 5]]);
    expect(activeSeats(l).length).toBe(35);
    for (let i = 0; i < 50; i++) checkNoDup(draw(l, makeStudents(30)), 30);
  });
  it('자리가 모자라면 실행 전 안내', () => {
    const l = custom([[2, 2], [3, 2]]); // 10석
    expect(precheckSeating({ layout: l, students: makeStudents(11), fixed: [], excludeAway: true, today: TODAY }).error).toMatch(/10석/);
  });
  it('짝꿍형을 분단별로 바꾸면 같은 자리 ID 유지 (고정·남녀 자리 유지 가능)', () => {
    const pair = suggestLayout(12, 'pair');
    const groups = toCustomGroups(pair);
    const c = cleanLayout({ ...pair, type: 'custom', groups });
    expect(allSeats(c).map((s) => s.id)).toEqual(allSeats(pair).map((s) => s.id));
  });
  it('분단 인원·줄 수가 바뀌면 이전 배치 결과와 다른 모양으로 판정', () => {
    expect(layoutEquals(custom([[2, 4], [3, 3]]), custom([[2, 4], [3, 4]]))).toBe(false);
    expect(layoutEquals(custom([[2, 4], [3, 3]]), custom([[2, 4], [3, 3]]))).toBe(true);
  });
});

describe('남자 자리 · 여자 자리', () => {
  it('짝마다 왼쪽 남·오른쪽 여 지정 → 남학생은 남자 자리, 여학생은 여자 자리', () => {
    const l0 = suggestLayout(20, 'pair'); // 3짝 x 4줄 = 24석
    const l: SeatLayout = { ...l0, genderPair: genderPattern(l0, 'pair-mf') };
    const st = withGender(20, 10);
    for (let i = 0; i < 100; i++) {
      const r = draw(l, st);
      checkNoDup(r, 20);
      if (!r.ok) return;
      for (const [seat, sid] of Object.entries(r.assignment)) expect(st.find((s) => s.id === sid)!.gender).toBe(l.genderPair[seat]);
    }
  });
  it('분단별(2명·3명)에도 패턴 적용, 홀수 인원', () => {
    const l0 = custom([[2, 4], [3, 4]]);
    const gm = genderPattern(l0, 'pair-mf');
    expect(gm[seatId(0, 0)]).toBe('M');
    expect(gm[seatId(0, 1)]).toBe('F');
    expect(gm[seatId(0, 2)]).toBe('M'); // 2분단 첫 자리
    expect(gm[seatId(0, 3)]).toBe('F');
    expect(gm[seatId(0, 4)]).toBe('M');
    const l = { ...l0, genderCustom: gm }; // 남 12석, 여 8석
    const st = withGender(19, 11);
    for (let i = 0; i < 50; i++) {
      const r = draw(l, st, [], 'random');
      checkNoDup(r, 19);
      if (!r.ok) return;
      for (const [seat, sid] of Object.entries(r.assignment)) expect(st.find((s) => s.id === sid)!.gender).toBe(gm[seat]);
    }
  });
  it('남학생이 남자 자리보다 많으면 지정 없는 자리로, 모두 지정이면 실행 전 안내', () => {
    const l0 = suggestLayout(8, 'pair'); // 8석
    const gm: Record<string, Gender> = genderPattern(l0, 'pair-mf'); // 남4 여4
    delete gm[seatId(1, 3)]; // 지정 없는 자리 1석
    const l = { ...l0, genderPair: gm };
    const r = draw(l, withGender(7, 5)); // 남5 여2
    checkNoDup(r, 7);
    if (r.ok) expect(r.genderNotes.join()).toMatch(/남학생 1명은 지정 없는 자리/);
    const bad = draw(l, withGender(8, 6)); // 남6: 남자 자리 4 + 지정 없음 1 → 부족
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/남녀 자리가 맞지 않아/);
  });
  it('성별 미입력 학생은 지정 없는 자리에만', () => {
    const l0 = suggestLayout(8, 'pair');
    const gm = genderPattern(l0, 'pair-mf');
    const l = { ...l0, genderPair: gm };
    const st = makeStudents(6); // 모두 성별 없음
    const r = draw(l, st);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/성별을 입력/);
  });
  it('고정 자리는 남녀 지정보다 우선 (여학생을 남자 자리에 고정 가능)', () => {
    const l0 = suggestLayout(8, 'pair');
    const l = { ...l0, genderPair: genderPattern(l0, 'pair-mf') };
    const st = withGender(8, 4);
    const girl = st[6].id;
    for (let i = 0; i < 30; i++) {
      // 남자 자리에 여학생 고정 → 남자 자리 3석에 남학생 4명 → 남학생 1명은 갈 곳이 없어 안내
      const r = draw(l, st, [{ seatId: seatId(0, 0), studentId: girl }]);
      expect(r.ok).toBe(false);
    }
    const st2 = withGender(7, 3); // 남3 여4, 여학생 1명을 남자 자리에 고정
    const r2 = draw(l, st2, [{ seatId: seatId(0, 0), studentId: st2[6].id }]);
    checkNoDup(r2, 7);
    if (r2.ok) expect(r2.assignment[seatId(0, 0)]).toBe(st2[6].id);
  });
  it('남녀 자리 순환 지정', () => {
    let m = cycleGender({}, 'r0c0');
    expect(m.r0c0).toBe('M');
    m = cycleGender(m, 'r0c0');
    expect(m.r0c0).toBe('F');
    m = cycleGender(m, 'r0c0');
    expect(m.r0c0).toBeUndefined();
  });
  it('남자 자리 배정은 남학생 사이에서 고르게', () => {
    const l0 = suggestLayout(4, 'pair'); // 2짝 1줄... 4석
    const l: SeatLayout = { ...l0, rows: 1, pairCols: 2, genderPair: { r0c0: 'M', r0c1: 'F', r0c2: 'M', r0c3: 'F' } };
    const st = withGender(4, 2);
    const c: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const r = draw(l, st);
      if (r.ok) c[r.assignment.r0c0] = (c[r.assignment.r0c0] ?? 0) + 1;
    }
    expect(Object.keys(c).sort()).toEqual(['id1', 'id2']);
    expect(Math.abs(c.id1 - 2000)).toBeLessThan(200);
  });
  it('학생 화면 데이터에 남녀 자리·성별 정보가 없다', () => {
    const d = defaultData();
    const cls = newClass('3반');
    cls.students = withGender(6, 3);
    cls.seating.layout = { ...suggestLayout(6, 'pair'), genderPair: genderPattern(suggestLayout(6, 'pair'), 'pair-mf') };
    const r = draw(cls.seating.layout, cls.students);
    if (!r.ok) throw new Error(r.error);
    d.classes = [cls];
    d.currentClassId = cls.id;
    d.studentBase = 'seating';
    const v = buildStudentView(d, { timer: idleTimer(), seatingReveal: { revealId: 'x', animate: false, startedAt: 0, classId: cls.id, result: { id: 'a', createdAt: 0, layout: cls.seating.layout, assignment: r.assignment } }, pickerReveal: null });
    expect(JSON.stringify(v)).not.toMatch(/gender|"M"|"F"|남자|여자/);
  });
});

describe('명단 성별', () => {
  it('엑셀 번호·이름·성별, 번호·성별·이름, "이름 남" 형식', () => {
    expect(parseRosterText('번호\t이름\t성별\n1\t김민준\t남\n2\t이서연\t여\n3\t박지호').entries).toEqual([
      { number: 1, name: '김민준', gender: 'M' },
      { number: 2, name: '이서연', gender: 'F' },
      { number: 3, name: '박지호', gender: null },
    ]);
    expect(parseRosterText('1\t여\t최유나').entries[0]).toEqual({ number: 1, name: '최유나', gender: 'F' });
    expect(parseRosterText('정하준 남자\n강서윤 여').entries.map((e) => [e.name, e.gender])).toEqual([['정하준', 'M'], ['강서윤', 'F']]);
  });
  it('명단 교체 시 성별 갱신, 아이디 유지', () => {
    const a = mergeRoster([], parseRosterText('1\t가').entries, 'append');
    const b = mergeRoster(a.students, parseRosterText('1\t가\t여').entries, 'replace');
    expect(b.students[0].id).toBe(a.students[0].id);
    expect(b.students[0].gender).toBe('F');
  });
  it('저장·복원 시 분단 설정과 남녀 자리 유지', () => {
    const d = defaultData();
    d.classes[0].students = withGender(5, 2);
    d.classes[0].seating.layout = { ...custom([[2, 3], [3, 2]]), type: 'custom', genderCustom: { r0c0: 'M', r0c1: 'F' } };
    expect(normalizeData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});
