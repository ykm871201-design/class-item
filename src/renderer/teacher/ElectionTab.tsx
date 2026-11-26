// 학급임원선거: 설정 → 투표 진행 → 투표 마감·결과 확인 → 결과 공개
// 투표 중에는 득표 데이터가 이 화면으로 오지 않는다 (마감 후에만).
import { useEffect, useState } from 'react';
import type { Election } from '../../shared/types';
import { computeResult, ELECTION_LIMITS, PHASE_LABEL, setupProblems } from '../../shared/election';
import { act, api, toast, useAppState } from './api';

type ModalReq = {
  title: string;
  detail: string;
  pin: boolean;
  check?: string; // 체크해야 진행
  okText: string;
  danger?: boolean;
  resolve: (r: { pin: string } | null) => void;
};

const STEPS: Election['phase'][] = ['setup', 'voting', 'closed', 'published'];

export function ElectionTab() {
  const { data, runtime } = useAppState();
  const cls = data.classes.find((c) => c.id === data.currentClassId) ?? data.classes[0];
  const list = data.elections.filter((e) => e.classId === cls.id);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find((e) => e.id === selId) ?? list[list.length - 1] ?? null;
  const [modal, setModal] = useState<ModalReq | null>(null);
  const er = runtime.election;

  const ask = (m: Omit<ModalReq, 'resolve'>) => new Promise<{ pin: string } | null>((resolve) => setModal({ ...m, resolve }));

  const create = async () => {
    const r = await act('election/create', { position: list.length ? '' : '회장' });
    if (r.ok) setSelId(String(r.id));
  };

  return (
    <div>
      <h1 className="t-title">학급임원선거</h1>
      <p className="t-sub">
        교실 PC에서 학생이 한 명씩 비밀투표하고, TV·프로젝터에는 안내와 공개한 결과만 보여 줍니다. 직책마다 선거를 따로 만들어 차례로 진행하세요. 학생 본인 확인과 줄 관리는 선생님이 해 주세요.
      </p>

      <PinCard pinSet={er.pinSet} />

      <div className="card">
        <h2>
          {cls.name} 선거 목록 <span className="hint">학급별로 보관됩니다</span>
        </h2>
        <div className="row">
          {list.map((e) => (
            <button key={e.id} className={`btn${sel?.id === e.id ? ' primary' : ''}`} onClick={() => setSelId(e.id)} data-election={e.id}>
              {e.position || '(직책 없음)'} · {e.title}
              <span className="pill" style={{ marginLeft: 6, color: 'var(--text)' }}>
                {PHASE_LABEL[e.phase]}
              </span>
            </button>
          ))}
          <button className="btn" onClick={create} data-testid="election-create">
            + 새 선거 만들기
          </button>
        </div>
        {er.vote.open && (
          <div className="alert info" style={{ marginTop: 10 }}>
            교실 PC에 투표 화면이 열려 있습니다. 투표 화면의 ‘선생님’ 버튼(또는 F9) → PIN → ‘투표 화면 닫기’로 이 화면에 돌아올 수 있습니다.
          </div>
        )}
      </div>

      {sel && <ElectionDetail key={sel.id} e={sel} ask={ask} onSelect={setSelId} />}

      {modal && (
        <ConfirmModal
          req={modal}
          onDone={(r) => {
            modal.resolve(r);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function PinCard({ pinSet }: { pinSet: boolean }) {
  const [open, setOpen] = useState(!pinSet);
  const [oldPin, setOld] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  useEffect(() => setOpen(!pinSet), [pinSet]);
  const save = async () => {
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN은 숫자 4~8자리로 정해 주세요.', 'err');
    if (pin !== pin2) return toast('PIN 확인이 일치하지 않습니다.', 'err');
    const r = await act('election/setPin', { pin, oldPin }, pinSet ? 'PIN을 바꿨습니다.' : 'PIN을 정했습니다.');
    if (r.ok) {
      setOld('');
      setPin('');
      setPin2('');
    }
  };
  return (
    <div className="card">
      <h2>
        선거 관리 PIN <span className="hint">투표 시작·마감·초기화와 투표 화면의 선생님 메뉴에 필요합니다</span>
        {pinSet && <span className="pill">설정됨</span>}
      </h2>
      {pinSet && !open ? (
        <button className="btn sm" onClick={() => setOpen(true)}>
          PIN 바꾸기
        </button>
      ) : (
        <div className="row">
          {pinSet && <input type="password" inputMode="numeric" placeholder="지금 PIN" value={oldPin} onChange={(e) => setOld(e.target.value.replace(/\D/g, '').slice(0, 8))} style={{ width: 120 }} />}
          <input type="password" inputMode="numeric" placeholder="새 PIN (숫자 4~8자리)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} style={{ width: 180 }} data-testid="pin-new" />
          <input type="password" inputMode="numeric" placeholder="한 번 더" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} style={{ width: 120 }} data-testid="pin-new2" />
          <button className="btn primary" onClick={save} data-testid="pin-save">
            {pinSet ? 'PIN 바꾸기' : 'PIN 정하기'}
          </button>
          {pinSet && (
            <button className="btn" onClick={() => setOpen(false)}>
              취소
            </button>
          )}
          <span className="small muted">PIN은 이 PC에 암호화(해시)해서만 저장하며 학생 화면으로 보내지 않습니다. 데이터 내보내기 파일에도 넣지 않습니다.</span>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, min, max, disabled, onCommit, testId }: { label: string; value: number; min: number; max: number; disabled: boolean; onCommit: (n: number) => void; testId?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) {
      toast(`${label}은(는) ${min}~${max} 사이로 입력해 주세요.`, 'err');
      setV(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="col">
      <span className="field-label">{label}</span>
      <input type="number" min={min} max={max} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ width: 110 }} data-testid={testId} />
    </label>
  );
}

function TextField({ label, value, max, disabled, onCommit, width, testId }: { label: string; value: string; max: number; disabled: boolean; onCommit: (s: string) => void; width: number; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="col">
      <span className="field-label">{label}</span>
      <input value={v} maxLength={max} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} style={{ width }} data-testid={testId} />
    </label>
  );
}

function ElectionDetail({ e, ask, onSelect }: { e: Election; ask: (m: Omit<ModalReq, 'resolve'>) => Promise<{ pin: string } | null>; onSelect: (id: string) => void }) {
  const { data, runtime } = useAppState();
  const cls = data.classes.find((c) => c.id === e.classId);
  const students = cls?.students ?? [];
  const setup = e.phase === 'setup';
  const problems = setup ? setupProblems(e, students) : [];
  const upd = (patch: Record<string, unknown>) => act('election/update', { id: e.id, patch });
  const [pick, setPick] = useState('');
  const available = students.filter((s) => !e.candidates.some((c) => c.studentId === s.id)).sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'ko'));
  const parent = e.runoff ? data.elections.find((x) => x.id === e.runoff!.parentId) : undefined;
  const child = e.runoffChildId ? data.elections.find((x) => x.id === e.runoffChildId) : undefined;
  const shownOnTv = data.studentBase === 'election' && data.electionShownId === e.id && runtime.studentWindow.visible;
  const voteOpen = runtime.election.vote.open;

  const start = async () => {
    const chk = await api().app({ type: 'voteCheck' });
    if (!chk.ok) return toast(chk.error ?? '화면을 확인해 주세요.', 'err');
    const r = await ask({
      title: '투표 시작',
      detail: `시작하면 후보와 투표 규칙(선출 ${e.seats}명, 1인 ${e.maxChoices}명 선택, 투표 가능 ${e.voterLimit}명)을 바꿀 수 없습니다.${chk.single ? '\n\n모니터가 1대로 인식됩니다. TV·프로젝터를 ‘복제’로 연결했다면 투표 화면이 그대로 TV에 보입니다. Windows 키 + P에서 ‘PC 화면만’을 고르세요.' : '\n\nTV·프로젝터가 ‘복제’ 모드면 투표 화면이 TV에도 보입니다. Windows 키 + P에서 ‘확장’을 골라 주세요.'}`,
      pin: true,
      check: '화면 복제 모드가 아닌 것(확장 모드 또는 외부 화면 해제)을 확인했습니다.',
      okText: '투표 시작',
    });
    if (!r) return;
    await act('election/start', { id: e.id, pin: r.pin }, '투표를 시작했습니다. ‘교실 PC에 투표 화면 열기’를 눌러 주세요.');
  };

  const openKiosk = async () => {
    const chk = await api().app({ type: 'voteCheck' });
    if (!chk.ok) return toast(chk.error ?? '화면을 확인해 주세요.', 'err');
    const r = await ask({
      title: '교실 PC에 투표 화면 열기',
      detail: `이 모니터(교사용 화면)에 학생용 투표 화면을 전체 화면으로 엽니다. 교사용 화면은 투표 화면을 닫을 때까지 숨겨집니다.\n\n학생마다 투표 화면의 ‘선생님’ 버튼(또는 F9) → PIN → ‘다음 학생 투표 열기’를 눌러 1번씩 투표 기회를 열어 주세요.${chk.single ? '\n\n모니터가 1대로 인식됩니다. 프로젝터가 ‘복제’로 연결되어 있지 않은지 다시 확인해 주세요 (Windows 키 + P → PC 화면만).' : ''}`,
      pin: false,
      check: '화면 복제 모드가 아닌 것을 확인했습니다. (TV에는 투표 화면이 보이지 않아야 합니다)',
      okText: '투표 화면 열기',
    });
    if (!r) return;
    const o = await api().app({ type: 'voteOpen', id: e.id, displayConfirmed: true });
    if (!o.ok) toast(o.error ?? '투표 화면을 열지 못했습니다.', 'err');
  };

  const close = async () => {
    const left = e.voterLimit - e.ballots;
    const r = await ask({
      title: '투표 마감',
      detail: left > 0 ? `아직 ${left}명이 투표하지 않았습니다 (투표 ${e.ballots} / ${e.voterLimit}명).\n마감하면 더 이상 투표할 수 없습니다. 마감할까요?` : `모든 인원(${e.ballots}명)이 투표했습니다. 마감하고 개표할까요?`,
      pin: true,
      okText: '투표 마감',
      danger: left > 0,
    });
    if (!r) return;
    await act('election/close', { id: e.id, pin: r.pin }, '투표를 마감했습니다. 결과를 확인해 주세요.');
  };

  const reset = async () => {
    const r = await ask({
      title: '선거 초기화',
      detail: e.ballots > 0 ? `접수된 표 ${e.ballots}장을 모두 지우고 설정 단계로 돌아갑니다. 되돌릴 수 없습니다.` : '설정 단계로 돌아갑니다.',
      pin: true,
      check: e.ballots > 0 ? '접수된 표를 모두 지우는 것에 동의합니다.' : undefined,
      okText: '초기화',
      danger: true,
    });
    if (!r) return;
    await act('election/reset', { id: e.id, pin: r.pin }, '선거를 설정 단계로 되돌렸습니다.');
  };

  const del = async () => {
    const needPin = e.phase !== 'setup' || e.ballots > 0;
    const r = await ask({
      title: '선거 삭제',
      detail: `‘${e.title} · ${e.position}’ 선거${e.ballots ? `와 접수된 표·결과` : ''}를 삭제합니다. 되돌릴 수 없습니다.`,
      pin: needPin,
      check: '삭제하면 되돌릴 수 없다는 것을 확인했습니다.',
      okText: '삭제',
      danger: true,
    });
    if (!r) return;
    await act('election/delete', { id: e.id, pin: r.pin }, '선거를 삭제했습니다.');
  };

  const runoff = async () => {
    const r = await act('election/runoff', { id: e.id }, '동점 후보로 재투표를 만들었습니다.');
    if (r.id) onSelect(String(r.id));
  };

  return (
    <div className="card" data-testid="election-detail">
      <h2>
        {e.title} · {e.position}
        {e.runoff && <span className="pill">동점 재투표</span>}
      </h2>
      <div className="elect-steps" data-testid="election-steps">
        {STEPS.map((p, i) => (
          <span key={p} className={`elect-step${e.phase === p ? ' on' : STEPS.indexOf(e.phase) > i ? ' done' : ''}`}>
            {i + 1}. {PHASE_LABEL[p]}
          </span>
        ))}
      </div>
      {parent && (
        <p className="small">
          원래 선거: <a href="#" onClick={(ev) => (ev.preventDefault(), onSelect(parent.id))}>{parent.title}</a>
          {e.runoff!.priorWinners.length > 0 && ` · 1차 당선: ${e.runoff!.priorWinners.join(', ')}`}
        </p>
      )}

      {/* ----- 설정 ----- */}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <TextField label="선거명" value={e.title} max={ELECTION_LIMITS.title} disabled={!setup} onCommit={(title) => upd({ title })} width={220} testId="el-title" />
        <TextField label="직책명 (직접 입력)" value={e.position} max={ELECTION_LIMITS.position} disabled={!setup} onCommit={(position) => upd({ position })} width={150} testId="el-position" />
        <NumField label="선출 인원" value={e.seats} min={1} max={ELECTION_LIMITS.seats.max} disabled={!setup || !!e.runoff} onCommit={(seats) => upd({ seats, maxChoices: Math.min(e.maxChoices, seats) })} testId="el-seats" />
        <NumField label="1인당 선택 수" value={e.maxChoices} min={1} max={ELECTION_LIMITS.seats.max} disabled={!setup} onCommit={(maxChoices) => upd({ maxChoices })} testId="el-max" />
        <NumField label="투표 가능 인원" value={e.voterLimit} min={1} max={ELECTION_LIMITS.voters.max} disabled={!setup} onCommit={(voterLimit) => upd({ voterLimit })} testId="el-voters" />
      </div>
      <p className="small muted">
        기본은 1인 1표입니다. 여러 명을 뽑을 때는 1인당 선택 수를 선출 인원 이하로 정할 수 있습니다. 투표 가능 인원을 채우면 더 투표할 수 없습니다.
        {!setup && ' 투표를 시작한 뒤에는 바꿀 수 없습니다.'}
      </p>

      <div className="col" style={{ marginTop: 10 }}>
        <span className="field-label">후보 (기호 순)</span>
        <div className="elect-cands">
          {e.candidates.map((c, i) => (
            <div key={c.id} className="elect-cand" style={{ ['--c' as any]: c.color }} data-cand={c.number}>
              <span className="elect-num">{c.number}</span>
              <b>{c.name}</b>
              {setup && !e.runoff && (
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  <button className="btn sm" disabled={i === 0} onClick={() => act('election/moveCandidate', { id: e.id, candidateId: c.id, dir: -1 })} title="기호 앞으로">
                    ↑
                  </button>
                  <button className="btn sm" disabled={i === e.candidates.length - 1} onClick={() => act('election/moveCandidate', { id: e.id, candidateId: c.id, dir: 1 })} title="기호 뒤로">
                    ↓
                  </button>
                  <button className="btn sm danger" onClick={() => act('election/removeCandidate', { id: e.id, candidateId: c.id })}>
                    빼기
                  </button>
                </span>
              )}
            </div>
          ))}
          {!e.candidates.length && <span className="small muted">아직 후보가 없습니다.</span>}
        </div>
        {setup && !e.runoff && (
          <div className="row">
            <select value={pick} onChange={(ev) => setPick(ev.target.value)} data-testid="el-pick">
              <option value="">명단에서 후보 고르기…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number ? `${s.number}번 ` : ''}
                  {s.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!pick}
              onClick={async () => {
                const r = await act('election/addCandidate', { id: e.id, studentId: pick });
                if (r.ok) setPick('');
              }}
              data-testid="el-add"
            >
              후보 추가
            </button>
            {!students.length && <span className="small muted">학생 명단 탭에서 명단을 먼저 넣어 주세요.</span>}
          </div>
        )}
      </div>

      {setup && problems.length > 0 && (
        <div className="alert warn" data-testid="el-problems">
          {problems.join('\n')}
        </div>
      )}

      {/* ----- 단계별 동작 ----- */}
      <div className="row" style={{ marginTop: 14 }}>
        {setup && (
          <button className="btn primary big" disabled={problems.length > 0 || !runtime.election.pinSet} onClick={start} data-testid="el-start">
            투표 시작 (PIN)
          </button>
        )}
        {setup && !runtime.election.pinSet && <span className="small muted">먼저 위에서 선거 관리 PIN을 정해 주세요.</span>}
        {e.phase === 'voting' && (
          <>
            <button className="btn primary big" onClick={openKiosk} disabled={voteOpen} data-testid="el-kiosk">
              교실 PC에 투표 화면 열기
            </button>
            <button className="btn big danger" onClick={close} disabled={voteOpen} data-testid="el-close">
              투표 마감 (PIN)
            </button>
          </>
        )}
        <button className="btn" onClick={() => act('election/show', { id: e.id })} data-testid="el-show-tv">
          {e.phase === 'published' ? 'TV에 결과 다시 띄우기' : 'TV에 선거 안내 띄우기'}
        </button>
        {shownOnTv && <span className="pill">TV에 표시 중</span>}
      </div>

      {e.phase === 'voting' && (
        <div className="elect-progress" data-testid="el-progress">
          <div className="elect-progress-bar">
            <div style={{ width: `${Math.min(100, (e.ballots / Math.max(1, e.voterLimit)) * 100)}%` }} />
          </div>
          <b>
            투표 {e.ballots} / {e.voterLimit}명
          </b>
          <span className="small muted">후보별 득표는 투표를 마감한 뒤에만 볼 수 있습니다. (투표 중에는 이 화면으로도 보내지 않습니다)</span>
          {runtime.election.unsaved && <div className="alert err">저장이 확인되지 않은 표가 있습니다. 투표 화면의 선생님 메뉴에서 ‘저장 다시 시도’를 눌러 주세요.</div>}
        </div>
      )}

      {(e.phase === 'closed' || e.phase === 'published') && <ResultView e={e} child={child} onRunoff={runoff} onSelect={onSelect} />}

      <div className="row" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        {e.phase !== 'setup' && (
          <button className="btn danger" onClick={reset} disabled={voteOpen} data-testid="el-reset">
            초기화 (PIN)
          </button>
        )}
        <button className="btn danger" onClick={del} disabled={voteOpen && e.phase === 'voting'} data-testid="el-delete">
          선거 삭제
        </button>
      </div>
    </div>
  );
}

function ResultView({ e, child, onRunoff, onSelect }: { e: Election; child?: Election; onRunoff: () => void; onSelect: (id: string) => void }) {
  const r = computeResult(e);
  const status =
    r.status === 'decided'
      ? `당선: ${r.rows.filter((x) => x.elected).map((x) => `${x.number}번 ${x.name}`).join(', ')}`
      : r.status === 'tie'
        ? `당선 경계에서 동점입니다. ${r.winners.length ? `당선 확정: ${r.rows.filter((x) => x.elected).map((x) => x.name).join(', ')} · ` : ''}동점 후보(${r.rows.filter((x) => x.tied).map((x) => x.name).join(', ')})끼리 재투표로 ${r.seatsLeft}명을 뽑아야 합니다. 앱이 임의로 당선자를 정하지 않습니다.`
        : r.status === 'no-votes'
          ? '투표한 학생이 없어 당선자를 정하지 않았습니다.'
          : '모두 기권하여 당선자를 정하지 않았습니다.';
  const max = Math.max(1, ...r.rows.map((x) => x.votes));
  return (
    <div style={{ marginTop: 14 }} data-testid="el-result">
      <h3 style={{ margin: '0 0 8px' }}>개표 결과</h3>
      <table className="elect-table">
        <thead>
          <tr>
            <th>기호</th>
            <th>후보</th>
            <th>득표</th>
            <th style={{ width: '40%' }} />
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.candidateId} data-row={x.number}>
              <td>
                <span className="elect-num" style={{ ['--c' as any]: x.color }}>
                  {x.number}
                </span>
              </td>
              <td>
                <b>{x.name}</b>
              </td>
              <td data-votes={x.votes}>
                <b>{x.votes}표</b>
              </td>
              <td>
                <div className="elect-progress-bar" style={{ ['--c' as any]: x.color }}>
                  <div style={{ width: `${(x.votes / max) * 100}%`, background: x.color }} />
                </div>
              </td>
              <td>{x.elected ? <span className="pill" style={{ background: '#e6f4ea', color: '#1a7f37' }}>당선</span> : x.tied ? <span className="pill" style={{ background: '#fff4e5', color: '#b35900' }}>동점 · 재투표</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small" data-testid="el-summary">
        투표한 학생 <b>{r.ballots}명</b> (그중 기권 <b>{r.abstain}명</b>) · 투표 가능 {e.voterLimit}명
        {e.maxChoices > 1 && (
          <>
            {' '}
            · 1인 최대 {e.maxChoices}명 선택 → 후보 득표 합계 <b>{r.totalMarks}표</b> (투표한 학생 수와 다릅니다)
          </>
        )}
      </p>
      <div className={`alert ${r.status === 'decided' ? 'ok' : 'warn'}`} data-testid="el-status" data-status={r.status}>
        {status}
      </div>
      <div className="row">
        {e.phase === 'closed' ? (
          <button className="btn primary big" onClick={() => act('election/publish', { id: e.id }, 'TV·프로젝터에 결과를 공개했습니다.')} data-testid="el-publish">
            학생 화면(TV)에 결과 공개
          </button>
        ) : (
          <button className="btn" onClick={() => act('election/unpublish', { id: e.id }, '결과 공개를 내렸습니다.')}>
            결과 공개 내리기
          </button>
        )}
        {r.status === 'tie' &&
          (child ? (
            <button className="btn" onClick={() => onSelect(child.id)}>
              재투표 보기 ({PHASE_LABEL[child.phase]})
            </button>
          ) : (
            <button className="btn primary" onClick={onRunoff} data-testid="el-runoff">
              동점 후보로 재투표 만들기
            </button>
          ))}
      </div>
    </div>
  );
}

function ConfirmModal({ req, onDone }: { req: ModalReq; onDone: (r: { pin: string } | null) => void }) {
  const [pin, setPin] = useState('');
  const [checked, setChecked] = useState(false);
  const ready = (!req.pin || /^\d{4,8}$/.test(pin)) && (!req.check || checked);
  return (
    <div className="t-modal-back" onClick={() => onDone(null)}>
      <div className="t-modal" onClick={(ev) => ev.stopPropagation()} data-testid="el-modal">
        <h2>{req.title}</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{req.detail}</p>
        {req.check && (
          <label className="inline" style={{ margin: '8px 0' }}>
            <input type="checkbox" checked={checked} onChange={(ev) => setChecked(ev.target.checked)} data-testid="el-modal-check" />
            {req.check}
          </label>
        )}
        {req.pin && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="field-label">선거 관리 PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(ev) => setPin(ev.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(ev) => ev.key === 'Enter' && ready && onDone({ pin })}
              style={{ width: 140 }}
              data-testid="el-modal-pin"
            />
          </div>
        )}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => onDone(null)}>
            취소
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} disabled={!ready} onClick={() => onDone({ pin })} data-testid="el-modal-ok">
            {req.okText}
          </button>
        </div>
      </div>
    </div>
  );
}
