import { describe, it, expect } from 'vitest';
import { acceptBallot, computeResult, makeRunoff, newElection, setupProblems, candidateColor } from '../src/shared/election';
import { defaultData, normalizeData, validateImport } from '../src/shared/defaults';
import { Controller, type Ports } from '../src/main/controller';
import { PinGuard, hashPin, verifyPin } from '../src/main/pin';
import type { AppData, Election, Student } from '../src/shared/types';

const students: Student[] = ['김가람', '이나래', '박다온', '최라온', '정마루', '한바다'].map((name, i) => ({ id: 's' + i, number: i + 1, name, absentDate: null, excluded: false, gender: null }));

function election(n: number, patch: Partial<Election> = {}): Election {
  const e = newElection('c1', 0);
  e.candidates = students.slice(0, n).map((s, i) => ({ id: 'k' + i, studentId: s.id, name: s.name, number: i + 1, color: candidateColor(i + 1) }));
  return Object.assign(e, patch);
}

function voting(e: Election): Election {
  e.phase = 'voting';
  return e;
}

let tokenSeq = 0;
/** 투표 기회 열고 제출 (테스트용) */
function cast(e: Election, choices: string[], abstain = false) {
  const token = 'b_' + ++tokenSeq;
  e.openBallot = { token, openedAt: 0 };
  return { token, r: acceptBallot(e, token, choices, abstain) };
}

describe('선거 설정 검증', () => {
  it('정상 설정이면 문제 없음', () => {
    expect(setupProblems(election(3), students)).toEqual([]);
  });
  it('중복 후보·선택 수 초과·후보 부족·빈 직책을 막음', () => {
    const e = election(2, { seats: 2, maxChoices: 3, position: '' });
    e.candidates.push({ ...e.candidates[0], id: 'dup', number: 3 });
    const p = setupProblems(e, students).join('\n');
    expect(p).toContain('두 번 등록');
    expect(p).toContain('선출 인원(2명)보다 많을 수 없습니다');
    expect(p).toContain('직책명');
  });
  it('후보 수가 선출 인원 이하이면 시작할 수 없음 (임의 당선 방지)', () => {
    expect(setupProblems(election(1), students).join()).toContain('후보가 선출 인원보다 많아야');
    expect(setupProblems(election(2, { seats: 2 }), students).join()).toContain('후보가 선출 인원보다 많아야');
  });
  it('잘못된 인원 값', () => {
    expect(setupProblems(election(3, { seats: 0 }), students).join()).toContain('선출 인원');
    expect(setupProblems(election(3, { voterLimit: 0 }), students).join()).toContain('투표 가능 인원');
    expect(setupProblems(election(3, { voterLimit: 2.5 }), students).join()).toContain('투표 가능 인원');
  });
});

describe('투표 접수', () => {
  it('단일 선택: 한 명만', () => {
    const e = voting(election(3));
    expect(cast(e, ['k0']).r.kind).toBe('accepted');
    expect(cast(e, ['k0', 'k1']).r).toMatchObject({ kind: 'rejected' });
    expect(e.tally).toEqual({ k0: 1 });
    expect(e.ballots).toBe(1);
  });
  it('복수 선택: 최대 수까지, 같은 후보 두 번·없는 후보는 거부', () => {
    const e = voting(election(4, { seats: 2, maxChoices: 2 }));
    expect(cast(e, ['k0', 'k1']).r.kind).toBe('accepted');
    expect(cast(e, ['k2']).r.kind).toBe('accepted'); // 최대보다 적게 고르는 것은 허용
    expect(cast(e, ['k0', 'k1', 'k2']).r.kind).toBe('rejected');
    expect(cast(e, ['k3', 'k3']).r.kind).toBe('rejected');
    expect(cast(e, ['zz']).r.kind).toBe('rejected');
    expect(e.tally).toEqual({ k0: 1, k1: 1, k2: 1 });
    expect(e.ballots).toBe(2);
  });
  it('기권은 명시적으로만 (아무도 안 고른 일반 제출은 거부)', () => {
    const e = voting(election(3));
    expect(cast(e, []).r.kind).toBe('rejected');
    expect(cast(e, [], true).r.kind).toBe('accepted');
    expect(cast(e, ['k0'], true).r.kind).toBe('rejected');
    expect(e.abstain).toBe(1);
    expect(e.ballots).toBe(1);
    expect(e.tally).toEqual({});
  });
  it('같은 투표 기회의 연타·재전송은 한 번만 집계', () => {
    const e = voting(election(3));
    const { token, r } = cast(e, ['k1']);
    expect(r.kind).toBe('accepted');
    for (let i = 0; i < 5; i++) expect(acceptBallot(e, token, ['k1'], false).kind).toBe('duplicate');
    expect(acceptBallot(e, token, ['k2'], false).kind).toBe('duplicate');
    expect(e.tally).toEqual({ k1: 1 });
    expect(e.ballots).toBe(1);
  });
  it('열리지 않은 기회·마감 후 제출 거부, 투표 가능 인원 초과 거부', () => {
    const e = voting(election(3, { voterLimit: 1 }));
    expect(acceptBallot(e, 'nope', ['k0'], false).kind).toBe('rejected');
    expect(cast(e, ['k0']).r.kind).toBe('accepted');
    expect(cast(e, ['k0']).r).toMatchObject({ kind: 'rejected', error: expect.stringContaining('모두 투표') });
    e.phase = 'closed';
    expect(cast(e, ['k0']).r.kind).toBe('rejected');
    expect(e.ballots).toBe(1);
  });
  it('저장 데이터에는 합계만 있고 개인 선택·순서 기록이 없음', () => {
    const e = voting(election(3));
    cast(e, ['k2']);
    cast(e, ['k0']);
    cast(e, [], true);
    const keys = Object.keys(e).sort();
    expect(keys).not.toContain('ballotLog');
    expect(e.tally).toEqual({ k0: 1, k2: 1 });
    // 접수 토큰 목록에는 선택 후보가 들어 있지 않음
    expect(e.receipts.every((t) => /^b_\d+$/.test(t))).toBe(true);
  });
});

describe('개표 · 동점', () => {
  const withTally = (n: number, tally: number[], patch: Partial<Election> = {}) => {
    const e = election(n, patch);
    e.phase = 'closed';
    tally.forEach((v, i) => v && (e.tally['k' + i] = v));
    e.ballots = patch.ballots ?? tally.reduce((a, b) => a + b, 0);
    return e;
  };
  it('1명 선출: 최다 득표 당선', () => {
    const r = computeResult(withTally(3, [5, 9, 2]));
    expect(r.status).toBe('decided');
    expect(r.winners).toEqual(['k1']);
  });
  it('1명 선출 동점 → 재투표 필요, 이름·기호로 정하지 않음', () => {
    const r = computeResult(withTally(3, [7, 7, 2]));
    expect(r.status).toBe('tie');
    expect(r.winners).toEqual([]);
    expect(r.tied.sort()).toEqual(['k0', 'k1']);
    expect(r.seatsLeft).toBe(1);
  });
  it('2명 선출: 1위 확정, 2위 동점이면 남은 1자리만 재투표', () => {
    const r = computeResult(withTally(4, [10, 6, 6, 1], { seats: 2, maxChoices: 2 }));
    expect(r.status).toBe('tie');
    expect(r.winners).toEqual(['k0']);
    expect(r.tied.sort()).toEqual(['k1', 'k2']);
    expect(r.seatsLeft).toBe(1);
  });
  it('2명 선출에서 1·2위가 같아도 경계 아래와 다르면 둘 다 당선', () => {
    const r = computeResult(withTally(3, [6, 6, 1], { seats: 2 }));
    expect(r.status).toBe('decided');
    expect(r.winners.sort()).toEqual(['k0', 'k1']);
  });
  it('투표 0명·전원 기권이면 당선자 없음', () => {
    expect(computeResult(withTally(3, [0, 0, 0], { ballots: 0 })).status).toBe('no-votes');
    const ab = withTally(3, [0, 0, 0], { ballots: 4 });
    ab.abstain = 4;
    const r = computeResult(ab);
    expect(r.status).toBe('all-abstain');
    expect(r.winners).toEqual([]);
  });
  it('복수 선택: 득표 합계와 투표 인원을 따로 셈', () => {
    const e = withTally(4, [3, 2, 2, 1], { seats: 2, maxChoices: 2, ballots: 4 });
    const r = computeResult(e);
    expect(r.ballots).toBe(4);
    expect(r.totalMarks).toBe(8);
  });
  it('재투표: 동점 후보만, 남은 자리만, 원래 기호·색 유지, 원래 결과 보존', () => {
    const e = withTally(4, [10, 6, 6, 1], { seats: 2, maxChoices: 2 });
    const before = JSON.stringify(e);
    const ro = makeRunoff(e, 1)!;
    expect(JSON.stringify(e)).toBe(before);
    expect(ro.seats).toBe(1);
    expect(ro.maxChoices).toBe(1);
    expect(ro.candidates.map((c) => [c.number, c.name, c.color])).toEqual([
      [2, students[1].name, candidateColor(2)],
      [3, students[2].name, candidateColor(3)],
    ]);
    expect(ro.runoff).toEqual({ parentId: e.id, priorWinners: [students[0].name] });
    expect(setupProblems(ro, students)).toEqual([]);
    expect(makeRunoff(withTally(3, [5, 1, 0]), 1)).toBeNull(); // 동점이 아니면 만들지 않음
  });
});

describe('PIN', () => {
  it('평문을 저장하지 않고 확인, 여러 번 틀리면 잠김', () => {
    const h = hashPin('1234');
    expect(JSON.stringify(h)).not.toContain('1234');
    expect(verifyPin('1234', h)).toBe(true);
    expect(verifyPin('1235', h)).toBe(false);
    let now = 0;
    const g = new PinGuard(() => now, 3, 10_000);
    expect(g.check('0000', h).ok).toBe(false);
    expect(g.check('0000', h).ok).toBe(false);
    expect(g.check('0000', h).ok).toBe(false);
    expect(g.check('1234', h)).toMatchObject({ ok: false, error: expect.stringContaining('입력할 수 없습니다') });
    now = 11_000;
    expect(g.check('1234', h).ok).toBe(true);
  });
});

// ---------------- 컨트롤러 흐름 ----------------
function setup(opts: { failSave?: () => boolean; data?: AppData } = {}) {
  const d = opts.data ?? defaultData();
  if (!opts.data) d.classes[0].students = students.map((s) => ({ ...s }));
  const saved: string[] = [];
  const ports: Ports = {
    persist: () => {},
    persistNow: () => {},
    persistStrict: (x) => {
      if (opts.failSave?.()) return false;
      saved.push(JSON.stringify(x));
      return true;
    },
    showStudent: () => true,
    hideStudent: () => {},
    applyTopmost: () => {},
    playSound: () => {},
    notify: () => {},
    broadcast: () => {},
    studentWindowStatus: () => ({ visible: true, mode: 'display', fullscreen: true, displayAvailable: true, displayLabel: '', alwaysOnTop: true }),
    displays: () => [],
  };
  const ctl = new Controller(d, ports, { userDataPath: '', appVersion: 't' });
  return { ctl, saved };
}

function ready(ctl: Controller, n = 3, patch: Record<string, unknown> = {}) {
  expect(ctl.dispatch({ type: 'election/setPin', pin: '2468' }).ok).toBe(true);
  const id = String(ctl.dispatch({ type: 'election/create' }).id);
  ctl.dispatch({ type: 'election/update', id, patch: { title: '2학기 임원 선거', position: '회장', voterLimit: 5, ...patch } });
  for (let i = 0; i < n; i++) ctl.dispatch({ type: 'election/addCandidate', id, studentId: 's' + i });
  return id;
}

const el = (ctl: Controller, id: string) => ctl.data.elections.find((e) => e.id === id)!;

describe('컨트롤러: 선거 진행', () => {
  it('PIN은 해시로만 저장, 화면 상태에는 PIN 정보 없음', () => {
    const { ctl } = setup();
    ready(ctl);
    expect(JSON.stringify(ctl.data.electionPin)).not.toContain('2468');
    expect(ctl.fullState().data.electionPin).toBeNull();
    expect(ctl.fullState().runtime.election.pinSet).toBe(true);
  });
  it('중복 후보 등록 거부, 시작 후 설정·후보 변경 거부, PIN 틀리면 시작 안 됨', () => {
    const { ctl } = setup();
    const id = ready(ctl);
    expect(ctl.dispatch({ type: 'election/addCandidate', id, studentId: 's0' }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/start', id, pin: '1111' }).ok).toBe(false);
    expect(el(ctl, id).phase).toBe('setup');
    expect(ctl.dispatch({ type: 'election/start', id, pin: '2468' }).ok).toBe(true);
    expect(ctl.dispatch({ type: 'election/update', id, patch: { maxChoices: 2 } }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/addCandidate', id, studentId: 's4' }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/removeCandidate', id, candidateId: el(ctl, id).candidates[0].id }).ok).toBe(false);
  });
  it('잘못된 설정이면 시작 거부 (선택 수 > 선출 인원)', () => {
    const { ctl } = setup();
    const id = ready(ctl, 3, { maxChoices: 2 });
    const r = ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('선출 인원');
  });
  it('다음 학생 투표 → 제출 → 저장 확인 후 완료, 중복 제출은 1회 집계', () => {
    const { ctl, saved } = setup();
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    const E = ctl.elections;
    expect(E.openBallot(id).ok).toBe(true);
    expect(E.openBallot(id).ok).toBe(true); // 같은 기회를 다시 열면 새 토큰 (이전 기회는 무효)
    const token = el(ctl, id).openBallot!.token;
    const cand = el(ctl, id).candidates[1].id;
    const before = saved.length;
    const results = [E.submit(token, [cand], false), E.submit(token, [cand], false), E.submit(token, [cand], false)];
    expect(results.every((r) => r.ok && r.saved)).toBe(true);
    expect(saved.length).toBe(before + 1); // 접수 1번에 디스크 저장 1번
    expect(el(ctl, id).ballots).toBe(1);
    expect(el(ctl, id).tally).toEqual({ [cand]: 1 });
    // 접수 뒤에는 기회가 닫힘
    expect(E.voteView(false).ballot).toBeNull();
  });
  it('저장 실패: 완료로 알리지 않고 다음 학생도 열지 않음, 다시 시도해도 1회만 집계', () => {
    let fail = true;
    const { ctl } = setup({ failSave: () => fail });
    fail = false;
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    const E = ctl.elections;
    E.openBallot(id);
    const token = el(ctl, id).openBallot!.token;
    const cand = el(ctl, id).candidates[0].id;
    fail = true;
    expect(E.submit(token, [cand], false)).toEqual({ ok: true, saved: false });
    expect(ctl.fullState().runtime.election.unsaved).toBe(true);
    expect(E.openBallot(id).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/close', id, pin: '2468' }).ok).toBe(false);
    expect(E.submit(token, [cand], false).saved).toBe(false); // 재시도 실패
    fail = false;
    expect(E.submit(token, [], false)).toEqual({ ok: true, saved: true }); // 재전송으로 저장만 다시
    expect(el(ctl, id).ballots).toBe(1);
    expect(el(ctl, id).tally).toEqual({ [cand]: 1 });
    expect(E.openBallot(id).ok).toBe(true);
  });
  it('투표 가능 인원을 채우면 새 투표를 열 수 없음', () => {
    const { ctl } = setup();
    const id = ready(ctl, 3, { voterLimit: 2 });
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    const E = ctl.elections;
    for (let i = 0; i < 2; i++) {
      E.openBallot(id);
      E.submit(el(ctl, id).openBallot!.token, [], true);
    }
    const r = E.openBallot(id);
    expect(r.ok).toBe(false);
  });
  it('투표 중에는 득표·토큰이 교사·학생 화면 상태에 없음, 마감 뒤 교사 화면에만, 공개 뒤 TV에', () => {
    const { ctl } = setup();
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    ctl.dispatch({ type: 'election/show', id });
    const E = ctl.elections;
    const cands = el(ctl, id).candidates.map((c) => c.id);
    for (const c of [cands[0], cands[0], cands[2]]) {
      E.openBallot(id);
      E.submit(el(ctl, id).openBallot!.token, [c], false);
    }
    E.openBallot(id); // 다음 학생 기회가 열린 상태
    const fs1 = ctl.fullState();
    const te = fs1.data.elections.find((x) => x.id === id)!;
    expect(te.tally).toEqual({});
    expect(te.receipts).toEqual([]);
    expect(te.openBallot?.token).toBe('');
    expect(JSON.stringify(fs1)).not.toContain(el(ctl, id).openBallot!.token);
    const sv = ctl.studentView().election!;
    expect(sv.result).toBeNull();
    expect(JSON.stringify(sv)).not.toMatch(/votes|tally/);
    expect(sv.ballots).toBe(3);
    // 투표 창 화면에는 득표가 없음
    expect(JSON.stringify(E.voteView(true))).not.toMatch(/tally|votes/);
    // 마감
    E.cancelOpenBallot();
    expect(ctl.dispatch({ type: 'election/close', id, pin: '2468' }).ok).toBe(true);
    expect(ctl.fullState().data.elections.find((x) => x.id === id)!.tally).toEqual({ [cands[0]]: 2, [cands[2]]: 1 });
    expect(ctl.studentView().election!.result).toBeNull(); // 아직 공개 전
    ctl.dispatch({ type: 'election/publish', id });
    const res = ctl.studentView().election!.result!;
    expect(res.rows[0]).toMatchObject({ number: 1, votes: 2, elected: true });
    expect(ctl.data.studentBase).toBe('election');
  });
  it('재시작: 설정·단계·접수된 표 복원, 제출 기록 없이 열려 있던 기회는 세지 않고 알림', () => {
    const { ctl, saved } = setup();
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    const E = ctl.elections;
    E.openBallot(id);
    E.submit(el(ctl, id).openBallot!.token, [el(ctl, id).candidates[0].id], false);
    E.openBallot(id); // 이 학생은 제출 전에 앱이 꺼짐
    const disk = JSON.parse(JSON.stringify(ctl.data)); // 마지막 저장 상태 (기회 열림 포함)
    expect(saved.length).toBeGreaterThan(0);
    const { ctl: c2 } = setup({ data: normalizeData(disk) });
    const e2 = el(c2, id);
    expect(e2.phase).toBe('voting');
    expect(e2.ballots).toBe(1);
    expect(e2.openBallot).toBeNull();
    expect(c2.rt.notices.some((n) => n.message.includes('세지 않았습니다'))).toBe(true);
    expect(verifyPin('2468', c2.data.electionPin)).toBe(true);
  });
  it('동점 → 재투표 생성 (원래 결과 보존)', () => {
    const { ctl } = setup();
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    const E = ctl.elections;
    const c = el(ctl, id).candidates.map((x) => x.id);
    for (const x of [c[0], c[1]]) {
      E.openBallot(id);
      E.submit(el(ctl, id).openBallot!.token, [x], false);
    }
    ctl.dispatch({ type: 'election/close', id, pin: '2468' });
    const r = ctl.dispatch({ type: 'election/runoff', id });
    expect(r.ok).toBe(true);
    const ro = el(ctl, String(r.id));
    expect(ro.candidates.map((x) => x.number)).toEqual([1, 2]);
    expect(ro.phase).toBe('setup');
    expect(el(ctl, id).tally).toEqual({ [c[0]]: 1, [c[1]]: 1 });
    expect(ctl.dispatch({ type: 'election/runoff', id }).ok).toBe(false); // 두 번 만들지 않음
  });
  it('초기화·삭제는 PIN 필요', () => {
    const { ctl } = setup();
    const id = ready(ctl);
    ctl.dispatch({ type: 'election/start', id, pin: '2468' });
    expect(ctl.dispatch({ type: 'election/reset', id, pin: '0000' }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/delete', id }).ok).toBe(false);
    expect(ctl.dispatch({ type: 'election/reset', id, pin: '2468' }).ok).toBe(true);
    expect(el(ctl, id).phase).toBe('setup');
    expect(ctl.dispatch({ type: 'election/delete', id }).ok).toBe(true);
  });
  it('예전 저장 파일(선거 항목 없음)도 정상으로 열리고, 가져오기 파일도 검증', () => {
    const d: any = JSON.parse(JSON.stringify(defaultData()));
    delete d.elections;
    delete d.electionPin;
    delete d.electionShownId;
    const n = normalizeData(d);
    expect(n.elections).toEqual([]);
    expect(n.electionPin).toBeNull();
    const v = validateImport({ app: 'classroom-tools', version: 1, data: d });
    expect(v.ok).toBe(true);
  });
  it('저장 파일의 이상한 선거 값 정리 (음수 득표, 없는 후보 득표, 기권>투표 인원)', () => {
    const d: any = JSON.parse(JSON.stringify(defaultData()));
    const e = election(3, { phase: 'closed', ballots: 2, abstain: 5, tally: { k0: 2, k9: 4, k1: -3 } as any });
    d.elections = [e, { bad: true }];
    const n = normalizeData(d);
    expect(n.elections.length).toBe(1);
    expect(n.elections[0].tally).toEqual({ k0: 2 });
    expect(n.elections[0].abstain).toBe(2);
  });
});
