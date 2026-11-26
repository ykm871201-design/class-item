// 투표 전용 화면 (교실 PC 모니터, 학생이 한 명씩 직접 누름)
// - 후보 선택은 이 화면 안에만 잠시 있고, 제출하는 순간 지운다. 다음 학생에게 이전 선택이 보이지 않는다.
// - 득표·관리 정보는 받지 않는다. 교사 메뉴는 PIN을 넣어야 열린다 (판단은 메인 프로세스에서).
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { VoteView } from '../../shared/types';

type SubmitResult = { ok: boolean; saved?: boolean; error?: string };

declare global {
  interface Window {
    voteApi: {
      getView(): Promise<VoteView>;
      submit(p: { token: string; choices: string[]; abstain: boolean }): Promise<SubmitResult>;
      unlock(pin: string): Promise<{ ok: boolean; error?: string }>;
      admin(action: string): Promise<{ ok: boolean; error?: string; saved?: boolean }>;
      onView(cb: (v: VoteView) => void): () => void;
      onTeacherKey(cb: () => void): () => void;
    };
  }
}

type Stage = 'idle' | 'confirm' | 'sending' | 'done' | 'unsaved' | 'error';

function App() {
  const [view, setView] = useState<VoteView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [abstain, setAbstain] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const sendingRef = useRef(false); // 연타·더블클릭으로 두 번 보내지 않게 (화면 갱신 전에도 막힘)
  const pendingToken = useRef<string | null>(null);
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    window.voteApi.getView().then(setView);
    const off1 = window.voteApi.onView(setView);
    const off2 = window.voteApi.onTeacherKey(() => setPinOpen(true));
    return () => {
      off1();
      off2();
    };
  }, []);

  // 새 투표 기회가 열리거나 닫히면 선택 흔적을 모두 지운다
  const token = view?.ballot?.token ?? null;
  useEffect(() => {
    if (token !== lastToken.current) {
      lastToken.current = token;
      setSelected([]);
      setAbstain(false);
      setHint('');
      if (token) setStage('idle');
    }
  }, [token]);

  // 완료 화면은 잠시 보여 준 뒤 대기 화면으로
  useEffect(() => {
    if (stage !== 'done') return;
    const t = window.setTimeout(() => setStage('idle'), 3500);
    return () => window.clearTimeout(t);
  }, [stage]);

  if (!view) return <div className="vote-root" />;

  const submit = async () => {
    if (!token || sendingRef.current) return;
    sendingRef.current = true;
    const choices = abstain ? [] : selected.slice();
    const isAbstain = abstain;
    // 보내는 순간 화면의 선택을 지운다
    setSelected([]);
    setAbstain(false);
    setStage('sending');
    pendingToken.current = token;
    let r: SubmitResult;
    try {
      r = await window.voteApi.submit({ token, choices, abstain: isAbstain });
    } catch {
      r = { ok: false, error: '투표를 보내지 못했습니다.' };
    }
    sendingRef.current = false;
    if (r.ok && r.saved) {
      pendingToken.current = null;
      setStage('done');
    } else if (r.ok) {
      setStage('unsaved'); // 접수는 됐지만 저장 확인 전 — 같은 기회로 다시 저장만 시도 (다시 세지 않음)
    } else {
      pendingToken.current = null;
      setMessage(r.error ?? '투표를 접수하지 못했습니다.');
      setStage('error');
    }
  };

  const retrySave = async () => {
    const t = pendingToken.current;
    if (!t || sendingRef.current) return;
    sendingRef.current = true;
    const r = await window.voteApi.submit({ token: t, choices: [], abstain: false }).catch(() => ({ ok: false }) as SubmitResult);
    sendingRef.current = false;
    if (r.ok && r.saved) {
      pendingToken.current = null;
      setStage('done');
    }
  };

  const toggle = (id: string) => {
    if (!view.election) return;
    setAbstain(false);
    const max = view.election.maxChoices;
    setSelected((cur) => {
      if (cur.includes(id)) {
        setHint('');
        return cur.filter((x) => x !== id);
      }
      if (max === 1) return [id];
      if (cur.length >= max) {
        setHint(`최대 ${max}명까지 고를 수 있어요. 다른 후보를 먼저 빼 주세요.`);
        return cur;
      }
      setHint('');
      return [...cur, id];
    });
  };

  let body: ReactElement;
  if (pinOpen && !view.admin) body = <PinPad onClose={() => setPinOpen(false)} />;
  else if (view.admin) body = <AdminMenu view={view} onLeave={() => setPinOpen(false)} />;
  else if (stage === 'unsaved' || (view.unsaved && pendingToken.current))
    body = (
      <Center>
        <div className="vote-big">투표가 아직 저장되지 않았어요</div>
        <p className="vote-sub">선생님을 불러 주세요. 다시 저장해도 표가 두 번 세어지지 않습니다.</p>
        <button className="vote-btn primary" onClick={retrySave} data-testid="vote-retry">
          다시 저장하기
        </button>
      </Center>
    );
  else if (stage === 'sending')
    body = (
      <Center>
        <div className="vote-big">투표를 보내는 중…</div>
      </Center>
    );
  else if (stage === 'done')
    body = (
      <Center>
        <div className="vote-check">✓</div>
        <div className="vote-big" data-testid="vote-done">
          투표가 접수되었습니다
        </div>
        <p className="vote-sub">자리로 돌아가 주세요.</p>
      </Center>
    );
  else if (stage === 'error')
    body = (
      <Center>
        <div className="vote-big">투표를 접수하지 못했어요</div>
        <p className="vote-sub">{message} 선생님께 말씀해 주세요.</p>
        <button className="vote-btn" onClick={() => setStage('idle')}>
          확인
        </button>
      </Center>
    );
  else if (view.locked)
    body = (
      <Center>
        <div className="vote-big">잠시 멈춤</div>
        <p className="vote-sub">{view.locked}</p>
      </Center>
    );
  else if (view.ballot && view.election && view.election.phase === 'voting')
    body =
      stage === 'confirm' ? (
        <Confirm view={view} selected={selected} abstain={abstain} onBack={() => setStage('idle')} onSubmit={submit} />
      ) : (
        <Ballot view={view} selected={selected} hint={hint} onToggle={toggle} onAbstain={() => {
          setSelected([]);
          setAbstain(true);
          setStage('confirm');
        }} onNext={() => {
          if (!selected.length) return setHint('후보를 고르거나 ‘기권하기’를 눌러 주세요.');
          setAbstain(false);
          setStage('confirm');
        }} />
      );
  else
    body = (
      <Center>
        {view.election && (
          <div className="vote-title-sm">
            {view.election.title} · {view.election.position}
          </div>
        )}
        <div className="vote-big" data-testid="vote-wait">
          {view.election?.phase === 'voting' ? '다음 학생을 기다리고 있어요' : '투표가 진행 중이 아닙니다'}
        </div>
        <p className="vote-sub">선생님이 투표를 열어 주면 시작합니다.</p>
        {view.election && view.voterLimit > 0 && (
          <p className="vote-progress">
            투표한 학생 <b>{view.ballots}</b> / {view.voterLimit}명
          </p>
        )}
      </Center>
    );

  const showTeacherBtn = !pinOpen && !view.admin;
  return (
    <div className="vote-root" data-testid="vote-root">
      {body}
      {showTeacherBtn && (
        <button className="vote-teacher" onClick={() => setPinOpen(true)} data-testid="vote-teacher">
          선생님 (F9)
        </button>
      )}
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="vote-center">{children}</div>;
}

function Ballot({ view, selected, hint, onToggle, onAbstain, onNext }: { view: VoteView; selected: string[]; hint: string; onToggle: (id: string) => void; onAbstain: () => void; onNext: () => void }) {
  const e = view.election!;
  const n = e.candidates.length;
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  return (
    <div className="vote-ballot" data-testid="vote-ballot">
      <header className="vote-head">
        <div className="vote-title">
          {e.title} <span>· {e.position}</span>
        </div>
        <div className="vote-rule">{e.maxChoices === 1 ? '한 명을 골라 주세요' : `최대 ${e.maxChoices}명까지 고를 수 있어요`}</div>
      </header>
      <div className="vote-cands" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {e.candidates.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              className={`vote-cand${on ? ' on' : ''}`}
              style={{ ['--c' as any]: c.color }}
              onClick={() => onToggle(c.id)}
              aria-pressed={on}
              data-cand={c.number}
            >
              <span className="vote-num">{c.number}</span>
              <span className="vote-name">{c.name}</span>
              <span className="vote-mark">{on ? '✔ 선택함' : '누르면 선택'}</span>
            </button>
          );
        })}
      </div>
      <footer className="vote-foot">
        <div className="vote-count">
          <span>
            선택 <b>{selected.length}</b> / {e.maxChoices}
          </span>
          {hint && <span className="vote-hint">{hint}</span>}
        </div>
        <button className="vote-btn" onClick={onAbstain} data-testid="vote-abstain">
          기권하기
        </button>
        <button className="vote-btn primary" onClick={onNext} disabled={!selected.length} data-testid="vote-next">
          투표하기 →
        </button>
      </footer>
    </div>
  );
}

function Confirm({ view, selected, abstain, onBack, onSubmit }: { view: VoteView; selected: string[]; abstain: boolean; onBack: () => void; onSubmit: () => void }) {
  const e = view.election!;
  const chosen = e.candidates.filter((c) => selected.includes(c.id));
  return (
    <div className="vote-center" data-testid="vote-confirm">
      <div className="vote-big">{abstain ? '기권할까요?' : '이렇게 투표할까요?'}</div>
      {!abstain && (
        <div className="vote-chosen">
          {chosen.map((c) => (
            <div key={c.id} className="vote-chip" style={{ ['--c' as any]: c.color }}>
              <span className="vote-num">{c.number}</span> {c.name}
            </div>
          ))}
        </div>
      )}
      <p className="vote-sub">‘최종 제출’을 누르면 바꾸거나 취소할 수 없어요.</p>
      <div className="row" style={{ gap: 20 }}>
        <button className="vote-btn" onClick={onBack} data-testid="vote-back">
          ← 다시 고르기
        </button>
        <button className="vote-btn primary" onClick={onSubmit} data-testid="vote-submit">
          {abstain ? '기권으로 최종 제출' : '최종 제출'}
        </button>
      </div>
    </div>
  );
}

function PinPad({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const busy = useRef(false);
  const send = async (p: string) => {
    if (busy.current || p.length < 4) return;
    busy.current = true;
    const r = await window.voteApi.unlock(p).catch(() => ({ ok: false, error: '확인하지 못했습니다.' }));
    busy.current = false;
    setPin('');
    if (!r.ok) setErr(r.error ?? 'PIN이 맞지 않습니다.');
    else onClose();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p.length < 8 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') setPin((p) => (send(p), p));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="vote-center" data-testid="vote-pinpad">
      <div className="vote-big">선생님 PIN</div>
      <div className="vote-pin-dots">{pin ? '●'.repeat(pin.length) : ' '}</div>
      {err && <p className="vote-err">{err}</p>}
      <div className="vote-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '지움', '0', '확인'].map((k) => (
          <button
            key={k}
            className={`vote-key${k === '확인' ? ' primary' : ''}`}
            onClick={() => (k === '지움' ? setPin((p) => p.slice(0, -1)) : k === '확인' ? send(pin) : setPin((p) => (p.length < 8 ? p + k : p)))}
            data-key={k}
          >
            {k}
          </button>
        ))}
      </div>
      <button className="vote-btn" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

function AdminMenu({ view, onLeave }: { view: VoteView; onLeave: () => void }) {
  const [msg, setMsg] = useState('');
  const run = async (action: string) => {
    const r = await window.voteApi.admin(action).catch(() => ({ ok: false, error: '처리하지 못했습니다.' }));
    setMsg(r.ok ? '' : r.error ?? '');
    if (action === 'leave' || action === 'next') onLeave();
  };
  const full = view.voterLimit > 0 && view.ballots >= view.voterLimit;
  return (
    <div className="vote-center" data-testid="vote-admin">
      <div className="vote-title-sm">선생님 메뉴{view.election ? ` · ${view.election.title} · ${view.election.position}` : ''}</div>
      <p className="vote-progress">
        투표한 학생 <b>{view.ballots}</b> / {view.voterLimit}명
      </p>
      {view.locked && <p className="vote-err">{view.locked}</p>}
      {view.unsaved && <p className="vote-err">저장이 확인되지 않은 표가 있습니다. ‘저장 다시 시도’를 눌러 주세요.</p>}
      {full && <p className="vote-sub">투표 가능 인원이 모두 투표했습니다. 투표 화면을 닫고 교사 화면에서 마감해 주세요.</p>}
      {msg && <p className="vote-err">{msg}</p>}
      <div className="vote-admin-btns">
        {view.locked ? (
          <button className="vote-btn primary" onClick={() => run('resume')} data-testid="vote-resume">
            화면 확인 완료 · 다시 열기
          </button>
        ) : (
          <button className="vote-btn primary big" onClick={() => run('next')} disabled={full || view.unsaved || view.election?.phase !== 'voting' || !!view.ballot} data-testid="vote-open-next">
            다음 학생 투표 열기
          </button>
        )}
        {view.ballot && (
          <button className="vote-btn" onClick={() => run('cancelBallot')}>
            열린 투표 기회 취소 (세지 않음)
          </button>
        )}
        {view.unsaved && (
          <button className="vote-btn" onClick={() => run('retrySave')}>
            저장 다시 시도
          </button>
        )}
        <button className="vote-btn" onClick={() => run('exit')} data-testid="vote-exit">
          투표 화면 닫기 (교사 화면으로)
        </button>
        <button className="vote-btn" onClick={() => run('leave')}>
          메뉴 닫기
        </button>
      </div>
      {view.ballot && <p className="vote-sub">지금 학생 투표 기회가 열려 있습니다. ‘메뉴 닫기’를 누르면 학생 화면으로 돌아갑니다.</p>}
    </div>
  );
}

// 마우스 오른쪽 클릭·끌어 놓기·확대 방지
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });

createRoot(document.getElementById('root')!).render(<App />);
