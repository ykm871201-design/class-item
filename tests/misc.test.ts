import { describe, it, expect } from 'vitest';
import { parseRosterText, mergeRoster, displayNames } from '../src/shared/roster';
import { buildStudentView } from '../src/shared/studentView';
import { defaultData, normalizeData, validateImport, newClass } from '../src/shared/defaults';
import { idleTimer, startTimer, pauseTimer, resumeTimer, tickTimer, remainingMs, setTimerMode, resetTimer } from '../src/shared/timer';
import { resolveStudentDisplay } from '../src/shared/displays';
import { drawSeating, suggestLayout } from '../src/shared/seating';
import { makeStudents, TODAY } from './helpers';

describe('명단 붙여넣기', () => {
  it('엑셀 번호/이름 (머리글 포함)', () => {
    const r = parseRosterText('번호\t이름\n1\t김민준\n2\t이서연\n\n3\t박지호\t남');
    expect(r.entries).toEqual([{ number: 1, name: '김민준', gender: null }, { number: 2, name: '이서연', gender: null }, { number: 3, name: '박지호', gender: 'M' }]);
  });
  it('이름만 줄바꿈 · 다양한 형식', () => {
    expect(parseRosterText('김민준\n이서연').entries).toEqual([{ number: null, name: '김민준', gender: null }, { number: null, name: '이서연', gender: null }]);
    expect(parseRosterText('1. 김민준\n2번 이서연\n3,박지호\n4 최유나').entries.map((e) => [e.number, e.name])).toEqual([[1, '김민준'], [2, '이서연'], [3, '박지호'], [4, '최유나']]);
  });
  it('자동 번호·중복 번호·30명 제한', () => {
    const r1 = mergeRoster([], parseRosterText('가\n나\n다').entries, 'append');
    expect(r1.students.map((s) => s.number)).toEqual([1, 2, 3]);
    const r2 = mergeRoster(r1.students, [{ number: 2, name: '라' }, { number: null, name: '마' }], 'append');
    expect(r2.errors.length).toBe(1);
    expect(r2.students.map((s) => s.name)).toEqual(['가', '나', '다', '마']);
    const many = mergeRoster([], Array.from({ length: 35 }, (_, i) => ({ number: null, name: 'x' + i })), 'append');
    expect(many.students.length).toBe(30);
    expect(many.errors.length).toBe(1);
  });
  it('명단 교체 시 같은 번호·이름 학생은 ID 유지', () => {
    const r1 = mergeRoster([], parseRosterText('1\t가\n2\t나').entries, 'append');
    const r2 = mergeRoster(r1.students, parseRosterText('1\t가\n2\t다').entries, 'replace');
    expect(r2.students[0].id).toBe(r1.students[0].id);
    expect(r2.students[1].id).not.toBe(r1.students[1].id);
  });
  it('동명이인은 번호로 구분', () => {
    const st = makeStudents(3, ['김민준', '이서연', '김민준']);
    const n = displayNames(st);
    expect([n.get('id1'), n.get('id2'), n.get('id3')]).toEqual(['김민준(1)', '이서연', '김민준(3)']);
  });
  it('동명이인도 ID로 구분되어 배치에서 둘 다 정확히 한 번', () => {
    const st = makeStudents(6, ['김민준', '김민준', 'a', 'b', 'c', 'd']);
    const r = drawSeating({ layout: suggestLayout(6, 'pair'), students: st, fixed: [{ seatId: 'r0c0', studentId: 'id2' }], excludeAway: true, emptyPolicy: 'back', today: TODAY });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assignment.r0c0).toBe('id2');
      expect(Object.values(r.assignment).filter((v) => v === 'id1').length).toBe(1);
    }
  });
});

describe('학생 화면 데이터에 교사용 정보가 없다', () => {
  it('고정 자리·학생 ID·결석 정보 미포함', () => {
    const d = defaultData();
    const c = newClass('3반');
    c.students = makeStudents(9, ['가', '나', '다', '라', '마', '바', '사', '아', '자']);
    c.students[4].absentDate = TODAY;
    c.seating.fixed = [{ seatId: 'r0c0', studentId: 'id1' }];
    const r = drawSeating({ layout: c.seating.layout, students: c.students, fixed: c.seating.fixed, excludeAway: true, emptyPolicy: 'back', today: TODAY });
    if (!r.ok) throw new Error();
    d.classes = [c];
    d.currentClassId = c.id;
    d.studentBase = 'seating';
    d.boardDraft.text = '편집 중인 비밀 문장';
    d.boardPublished.text = '공개한 문장';
    const result = { id: 'x', createdAt: 0, layout: c.seating.layout, assignment: r.assignment };
    const v = buildStudentView(d, { timer: idleTimer(), seatingReveal: { revealId: 'r1', animate: true, startedAt: 1, classId: c.id, result }, pickerReveal: null });
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/fixed|locked|고정|studentId|"id\d+"|absent|excluded|결석/);
    expect(json).not.toContain('편집 중인 비밀 문장');
    expect(json).toContain('공개한 문장');
    expect(json).not.toContain('"마"'); // 결석 학생 이름 없음
    // 모든 좌석 항목의 키 구성이 같음 (고정 좌석만 다른 속성이 없음)
    const keys = new Set(v.seating!.seats.map((s) => Object.keys(s).sort().join(',')));
    expect(keys.size).toBe(1);
    expect(v.timer).toBeNull();
  });
});

describe('타이머 (시각 기반)', () => {
  it('일시정지·계속·종료·모드 전환', () => {
    const t0 = startTimer({ durationMs: 60_000, activity: '모둠 활동', sound: 'chime', volume: 50, mode: 'split', source: 'manual' }, 1000);
    expect(remainingMs(t0, 31_000)).toBe(30_000);
    const p = pauseTimer(t0, 31_000);
    expect(remainingMs(p, 999_999)).toBe(30_000); // 멈춘 동안 줄지 않음
    const m = setTimerMode(p, 'full');
    expect(m.status).toBe('paused');
    expect(remainingMs(m, 0)).toBe(30_000);
    const r = resumeTimer(m, 100_000);
    expect(remainingMs(r, 110_000)).toBe(20_000);
    expect(tickTimer(r, 129_999).justFinished).toBe(false);
    const f = tickTimer(r, 130_000);
    expect(f.justFinished).toBe(true);
    expect(f.timer.status).toBe('finished');
    expect(tickTimer(f.timer, 140_000).justFinished).toBe(false); // 종료 알림은 한 번만
    expect(resetTimer(f.timer).remainingMs).toBe(60_000);
  });
  it('갱신이 지연돼도(최소화 등) 남은 시간은 실제 경과 시간 기준', () => {
    const t = startTimer({ durationMs: 300_000, activity: '', sound: 'none', volume: 0, mode: 'full', source: 'schedule' }, 0);
    expect(remainingMs(t, 299_000)).toBe(1000);
    expect(tickTimer(t, 10_000_000).timer.status).toBe('finished');
  });
});

describe('디스플레이 선택', () => {
  const primary = { id: 1, label: '노트북', width: 1920, height: 1080, x: 0, y: 0, primary: true };
  const tv = { id: 22, label: 'TV', width: 1920, height: 1080, x: 1920, y: 0, primary: false };
  it('단일 모니터면 null (교사 화면을 덮지 않음)', () => {
    expect(resolveStudentDisplay([primary], null).display).toBeNull();
    expect(resolveStudentDisplay([primary], { ...tv }).display).toBeNull();
  });
  it('저장한 TV를 ID → 위치 순으로 다시 찾음 (재연결)', () => {
    expect(resolveStudentDisplay([primary, tv], { ...tv }).display?.id).toBe(22);
    expect(resolveStudentDisplay([primary, { ...tv, id: 99 }], { ...tv }).display?.id).toBe(99);
  });
  it('선택이 없으면 주 모니터가 아닌 첫 디스플레이', () => {
    expect(resolveStudentDisplay([primary, tv], null).display?.id).toBe(22);
  });
});

describe('데이터 복원·가져오기 검증', () => {
  it('저장 후 다시 읽으면 동일', () => {
    const d = defaultData();
    d.classes[0].students = makeStudents(5);
    d.classes[0].seating.fixed = [{ seatId: 'r0c0', studentId: 'id1' }];
    const back = normalizeData(JSON.parse(JSON.stringify(d)));
    expect(back).toEqual(d);
  });
  it('명단에 없는 학생의 고정은 정리', () => {
    const d = defaultData();
    d.classes[0].students = makeStudents(5);
    d.classes[0].seating.fixed = [{ seatId: 'r0c0', studentId: 'ghost' }];
    expect(normalizeData(JSON.parse(JSON.stringify(d))).classes[0].seating.fixed).toEqual([]);
  });
  it('잘못된 파일 거부', () => {
    expect(validateImport({ foo: 1 }).ok).toBe(false);
    expect(validateImport({ app: 'other', data: {} }).ok).toBe(false);
    expect(validateImport('text').ok).toBe(false);
    const d = defaultData();
    const ok = validateImport({ app: 'classroom-tools', version: 1, data: d });
    expect(ok.ok).toBe(true);
  });
  it('손상된 값은 기본값으로', () => {
    const n = normalizeData({ version: 1, classes: [{ id: 'c1', name: 'x', students: [{ id: 's', name: 'a', number: 'bad' }], seating: { layout: { rows: 999 } } }] });
    expect(n.classes[0].seating.layout.rows).toBe(10);
    expect(n.currentClassId).toBe('c1');
  });
});
