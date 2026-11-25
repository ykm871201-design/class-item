// 외부(GPT) 코드 검토에서 지적된 문제의 회귀 테스트
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/store';
import { Controller, type Ports } from '../src/main/controller';
import { defaultData, normalizeData, validateImport } from '../src/shared/defaults';
import { parseIcs } from '../src/shared/ical';
import { pickStudents } from '../src/shared/picker';
import { remainingMs } from '../src/shared/timer';
import type { AppData } from '../src/shared/types';
import { makeStudents, TODAY } from './helpers';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ct-review-'));
const withClass = (name: string): AppData => {
  const d = defaultData();
  d.classes[0].name = name;
  d.classes[0].students = makeStudents(5);
  return d;
};

function makeCtl(data = defaultData()) {
  const calls: string[] = [];
  const ports: Ports = {
    persist: () => calls.push('persist'),
    persistNow: () => calls.push('persistNow'),
    showStudent: () => (calls.push('show'), true),
    hideStudent: () => {},
    applyTopmost: () => {},
    playSound: () => {},
    notify: () => {},
    broadcast: () => {},
    studentWindowStatus: () => ({ visible: true, mode: 'display', fullscreen: true, displayAvailable: true, displayLabel: '', alwaysOnTop: true }),
    displays: () => [],
  };
  const ctl = new Controller(data, ports, { userDataPath: '', appVersion: 't' });
  return { ctl, calls };
}
const L = (d: number, h: number, m: number, s = 0) => new Date(2026, 10, d, h, m, s).getTime();

afterEach(() => vi.restoreAllMocks());

describe('[검토 1] 구조가 깨진 저장 파일 → 백업에서 복원, 정상 백업을 덮어쓰지 않음', () => {
  it('본 파일 {} + 정상 백업이면 백업의 명단을 복원하고, 다음 저장 뒤에도 백업이 정상으로 남음', () => {
    const dir = tmp();
    const s = new Store(dir);
    fs.writeFileSync(s.backup, JSON.stringify(withClass('RESTORE_ME')));
    fs.writeFileSync(s.file, '{}');
    const d = s.load();
    expect(d.classes[0].name).toBe('RESTORE_ME');
    expect(s.loadWarning).toMatch(/백업/);
    expect(fs.readdirSync(dir).some((f) => f.includes('.broken-'))).toBe(true); // 깨진 파일 보관
    s.save(d);
    s.flush();
    expect(JSON.parse(fs.readFileSync(s.backup, 'utf8')).classes[0].name).toBe('RESTORE_ME');
    expect(JSON.parse(fs.readFileSync(s.file, 'utf8')).classes[0].name).toBe('RESTORE_ME');
  });
  it('정상 파일이면 저장 때 이전 정상본을 백업으로 둠', () => {
    const dir = tmp();
    const s = new Store(dir);
    fs.writeFileSync(s.file, JSON.stringify(withClass('OLD')));
    const d = s.load();
    d.classes[0].name = 'NEW';
    s.save(d);
    s.flush();
    expect(JSON.parse(fs.readFileSync(s.backup, 'utf8')).classes[0].name).toBe('OLD');
    expect(JSON.parse(fs.readFileSync(s.file, 'utf8')).classes[0].name).toBe('NEW');
  });
});

describe('[검토 2] 저장 실패를 잃지 않고 다시 시도하며 알림', () => {
  it('rename 실패 후 다시 flush하면 저장되고, 실패는 onError로 알림', () => {
    const dir = tmp();
    const s = new Store(dir);
    const errors: string[] = [];
    s.onStatus = (st) => st.error && errors.push(st.error);
    fs.writeFileSync(s.file, JSON.stringify(withClass('BEFORE')));
    const d = s.load();
    d.classes[0].name = 'AFTER';
    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    s.save(d);
    s.flush();
    expect(errors.length).toBe(1);
    expect(JSON.parse(fs.readFileSync(s.file, 'utf8')).classes[0].name).toBe('BEFORE');
    spy.mockRestore();
    s.flush(); // 재시도
    expect(JSON.parse(fs.readFileSync(s.file, 'utf8')).classes[0].name).toBe('AFTER');
    s.dispose();
  });
});

describe('[검토 3] 예약 실행 기록을 학생 화면 표시보다 먼저 즉시 저장', () => {
  it('persistNow가 show보다 먼저 불림', () => {
    const d = defaultData();
    d.schedules.push({ id: 's', name: '쉬는 시간', enabled: true, time: '10:20', durationSec: 60, repeat: 'weekly', date: '', days: [0, 1, 2, 3, 4, 5, 6], activity: '', sound: 'none', volume: 0, displayMode: 'split', createdAt: 0, activeSince: 0 });
    d.lastScheduleCheckAt = L(26, 10, 19, 59);
    const { ctl, calls } = makeCtl(d);
    ctl.now = () => L(26, 10, 20, 1);
    ctl.checkSchedules();
    expect(calls.indexOf('persistNow')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('persistNow')).toBeLessThan(calls.indexOf('show'));
    expect(ctl.data.scheduleFired.s).toBe('2026-11-26T10:20');
  });
});

describe('[검토 5] 미리 추첨 뒤 명단·조건이 바뀌면 확정·공개 전에 막음', () => {
  const setup = () => {
    const d = defaultData();
    d.classes[0].students = makeStudents(6);
    const { ctl } = makeCtl(d);
    ctl.now = () => new Date(2026, 10, 25, 9).getTime();
    expect(ctl.dispatch({ type: 'seating/draw' }).ok).toBe(true);
    return ctl;
  };
  it('학생 추가 → 확정·공개 거부', () => {
    const ctl = setup();
    ctl.dispatch({ type: 'student/add', name: '새 학생' });
    expect(ctl.dispatch({ type: 'seating/confirm' }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'seating/reveal' }).ok).toBe(false);
  });
  it('결석 처리된 학생이 들어 있으면 거부', () => {
    const ctl = setup();
    ctl.dispatch({ type: 'student/update', id: ctl.cls.students[0].id, absent: true });
    expect(ctl.dispatch({ type: 'seating/confirm' }).ok).toBe(false);
  });
  it('고정 자리를 바꿨는데 결과가 그 고정과 다르면 거부', () => {
    const ctl = setup();
    const sid = ctl.cls.students[2].id;
    const at = Object.entries(ctl.cls.seating.draft!.assignment).find(([, v]) => v === sid)![0];
    const other = Object.keys(ctl.cls.seating.draft!.assignment).find((k) => k !== at)!;
    ctl.dispatch({ type: 'seating/setFixed', seatId: other, studentId: sid });
    expect(ctl.dispatch({ type: 'seating/confirm' }).ok).toBe(false);
  });
  it('자리 모양이 바뀌면 거부, 바뀐 것이 없으면 그대로 확정 가능', () => {
    const ctl = setup();
    expect(ctl.dispatch({ type: 'seating/confirm' }).ok).toBe(true);
    ctl.dispatch({ type: 'seating/setLayout', layout: { rows: ctl.cls.seating.layout.rows + 1 } });
    expect(ctl.dispatch({ type: 'seating/reveal' }).ok).toBe(false);
  });
});

describe('[검토 6] PC 시각이 미래로 갔다 돌아와도 정상 예약이 막히지 않음', () => {
  it('29일로 잘못 갔다가 26일로 돌아오면 26일 10:20 예약이 실행됨', () => {
    const d = defaultData();
    d.schedules.push({ id: 's', name: '쉬는 시간', enabled: true, time: '10:20', durationSec: 60, repeat: 'weekly', date: '', days: [0, 1, 2, 3, 4, 5, 6], activity: '', sound: 'none', volume: 0, displayMode: 'split', createdAt: 0, activeSince: 0 });
    d.lastScheduleCheckAt = L(29, 10, 19, 59);
    const { ctl } = makeCtl(d);
    ctl.now = () => L(29, 10, 20, 1);
    ctl.checkSchedules();
    expect(ctl.data.scheduleFired.s).toBe('2026-11-29T10:20');
    ctl.now = () => L(26, 10, 19, 59);
    ctl.checkSchedules(); // 시계가 되돌아감
    ctl.now = () => L(26, 10, 20, 1);
    ctl.checkSchedules();
    expect(ctl.data.scheduleFired.s).toBe('2026-11-26T10:20');
    expect(ctl.data.scheduleLog.filter((e) => e.kind === 'fired').length).toBe(2);
  });
});

describe('[검토 7] 진행 중 타이머는 PC 시계 변경에 영향받지 않음', () => {
  it('시계가 1시간 뒤로 가도 남은 시간 유지', () => {
    const { ctl } = makeCtl();
    let now = L(25, 10, 0);
    ctl.now = () => now;
    ctl.dispatch({ type: 'timer/start', durationSec: 300, activity: '', sound: 'none', volume: 0, mode: 'split' });
    now += 60_000;
    expect(remainingMs(ctl.rt.timer, now)).toBe(240_000);
    now -= 3600_000; // 시계를 1시간 뒤로
    ctl.onClockJump(-3600_000);
    expect(remainingMs(ctl.rt.timer, now)).toBe(240_000);
    now += 2 * 3600_000; // 2시간 앞으로
    ctl.onClockJump(2 * 3600_000);
    expect(remainingMs(ctl.rt.timer, now)).toBe(240_000);
  });
});

describe('[검토 8] UTC(Z) 반복 일정은 UTC 기준 요일로 펼침', () => {
  it('UTC 월요일 23:30 = 한국 화요일 08:30, 첫 회차 포함', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:u\nDTSTART:20261123T233000Z\nDTEND:20261124T003000Z\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR';
    const ev = parseIcs(ics, new Date(2026, 10, 1).getTime(), new Date(2027, 0, 31).getTime());
    expect(ev.map((e) => new Date(e.start).toString().slice(0, 21))).toEqual(['Tue Nov 24 2026 08:30', 'Tue Dec 01 2026 08:30', 'Tue Dec 08 2026 08:30']);
  });
});

describe('[검토 10] 가져오기·복원 시 중복 ID와 손상된 학급', () => {
  it('같은 학생 ID가 두 번이면 하나를 새 ID로 바꿔 서로 다른 학생이 됨', () => {
    const d = defaultData();
    d.classes[0].students = [
      { id: 'same', number: 1, name: '가', absentDate: null, excluded: false, gender: null },
      { id: 'same', number: 2, name: '나', absentDate: null, excluded: false, gender: null },
    ];
    const n = normalizeData(JSON.parse(JSON.stringify(d)));
    const ids = n.classes[0].students.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    const r = pickStudents({ students: n.classes[0].students, mode: 'all', excludeAway: true, pickedPool: [], count: 2, today: TODAY });
    expect(r.ok && new Set(r.picked.map((s) => s.id)).size).toBe(2);
  });
  it('학급 ID·예약 ID 중복도 정리', () => {
    const d = defaultData();
    d.classes.push({ ...JSON.parse(JSON.stringify(d.classes[0])), name: '둘째' });
    const n = normalizeData(JSON.parse(JSON.stringify(d)));
    expect(new Set(n.classes.map((c) => c.id)).size).toBe(2);
  });
  it('손상된 학급이 들어 있는 파일은 가져오기 거부', () => {
    expect(validateImport({ version: 1, classes: [null] }).ok).toBe(false);
    expect(validateImport({ version: 1, classes: [{ id: 'c', name: 'x', students: [] }, 7] }).ok).toBe(false);
    expect(validateImport({ version: 1, classes: [{ id: 'c', name: 'x', students: [] }] }).ok).toBe(true);
  });
});

describe('칠판 세로 정렬', () => {
  it('기본은 가운데, 위쪽·아래쪽 저장·복원, 잘못된 값은 가운데', () => {
    const d = defaultData();
    expect(d.boardDraft.vAlign).toBe('middle');
    const { ctl } = makeCtl(d);
    ctl.dispatch({ type: 'board/updateDraft', patch: { vAlign: 'top', text: '위쪽 글' } });
    ctl.dispatch({ type: 'board/publish' });
    expect(ctl.studentView().board.vAlign).toBe('top');
    ctl.dispatch({ type: 'board/updateDraft', patch: { vAlign: 'sideways' } });
    expect(ctl.data.boardDraft.vAlign).toBe('top');
    expect(normalizeData(JSON.parse(JSON.stringify({ ...ctl.data, boardDraft: { ...ctl.data.boardDraft, vAlign: 'bottom' } }))).boardDraft.vAlign).toBe('bottom');
    expect(normalizeData({ version: 1, classes: [{ id: 'c', students: [] }], boardDraft: { text: 'x' } }).boardDraft.vAlign).toBe('middle');
  });
});
