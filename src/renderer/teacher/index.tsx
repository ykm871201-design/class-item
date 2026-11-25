import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FullState, SoundId } from '../../shared/types';
import { ScaledStudentScreen } from '../common/StudentScreen';
import { StateCtx, act, api, dismissToast, toast, useAppState, useToasts } from './api';
import { playSound } from './sound';
import { nextRun } from '../../shared/schedule';
import { formatDateTimeKo } from '../../shared/util';
import { BoardTab } from './BoardTab';
import { TimerTab } from './TimerTab';
import { ScheduleTab } from './ScheduleTab';
import { SeatingTab } from './SeatingTab';
import { PickerTab } from './PickerTab';
import { RosterTab } from './RosterTab';
import { SettingsTab } from './SettingsTab';
import { WidgetTab } from './WidgetTab';

type Tab = 'board' | 'timer' | 'schedule' | 'seating' | 'picker' | 'roster' | 'widget' | 'settings';
const TABS: { id: Tab; label: string; ico: string }[] = [
  { id: 'board', label: '칠판', ico: '📝' },
  { id: 'timer', label: '타이머', ico: '⏱️' },
  { id: 'schedule', label: '예약', ico: '⏰' },
  { id: 'seating', label: '자리 배치', ico: '🪑' },
  { id: 'picker', label: '발표 뽑기', ico: '🎯' },
  { id: 'roster', label: '학생 명단', ico: '👥' },
  { id: 'widget', label: '위젯', ico: '🗓️' },
  { id: 'settings', label: '설정', ico: '⚙️' },
];

function App() {
  const [state, setState] = useState<FullState | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('tab') as Tab) || 'board';
    } catch {
      return 'board';
    }
  });
  const played = useRef(new Set<string>());

  useEffect(() => {
    api().getState().then(setState);
    const off1 = api().onState(setState);
    const off3 = api().onNav((t) => setTab(t as Tab));
    // 타이머 종료 알림음: 같은 타이머 실행(runId)에 대해 한 번만 재생
    const off2 = api().onSound((p) => {
      if (played.current.has(p.runId)) return;
      played.current.add(p.runId);
      (window.__soundPlays ||= []).push(p.runId);
      playSound(p.sound as SoundId | 'tick' | 'tick-urgent', p.volume);
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('tab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  if (!state) return <div style={{ padding: 40 }}>불러오는 중…</div>;
  return (
    <StateCtx.Provider value={state}>
      <div className="t-app">
        <TopBar setTab={setTab} />
        <div className="t-body">
          <nav className="t-nav">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} data-tab={t.id}>
                <span className="ico">{t.ico}</span>
                {t.label}
                {t.id === 'schedule' && <UnreadBadge />}
                {t.id === 'settings' && state.runtime.update.status === 'available' && <span className="badge" title="새 버전이 있습니다">새 버전</span>}
              </button>
            ))}
          </nav>
          <main className="t-main">
            {tab === 'board' && <BoardTab />}
            {tab === 'timer' && <TimerTab />}
            {tab === 'schedule' && <ScheduleTab />}
            {tab === 'seating' && <SeatingTab />}
            {tab === 'picker' && <PickerTab />}
            {tab === 'roster' && <RosterTab />}
            {tab === 'widget' && <WidgetTab />}
            {tab === 'settings' && <SettingsTab />}
          </main>
          <SidePanel setTab={setTab} />
        </div>
        <Toasts />
      </div>
    </StateCtx.Provider>
  );
}

function UnreadBadge() {
  const s = useAppState();
  const n = s ? s.data.scheduleLog.filter((e) => !e.acknowledged).length : 0;
  return n ? <span className="badge">{n}</span> : null;
}

function TopBar({ setTab }: { setTab: (t: Tab) => void }) {
  const s = useAppState();
  const { data, runtime } = s;
  const sw = runtime.studentWindow;
  const next = useMemo(() => {
    let best: { at: number; name: string } | null = null;
    for (const sc of data.schedules) {
      const at = nextRun(sc, runtime.now, data.scheduleFired[sc.id]);
      if (at !== null && (!best || at < best.at)) best = { at, name: sc.name };
    }
    return best;
  }, [data.schedules, data.scheduleFired, Math.floor(runtime.now / 30000)]);
  const activeCount = data.schedules.filter((x) => x.enabled).length;
  const studentChip = !sw.displayAvailable && sw.mode !== 'preview' ? 'bad' : sw.visible ? 'on' : 'warn';
  const studentText = sw.mode === 'preview' && sw.visible ? '미리보기 창 표시 중' : !sw.displayAvailable ? '학생용 디스플레이 없음' : sw.visible ? `표시 중 · ${sw.displayLabel}` : `숨김 · ${sw.displayLabel}`;
  return (
    <header className="t-top">
      <span className="brand">교실 도구</span>
      <select value={data.currentClassId ?? ''} onChange={(e) => act('class/select', { id: e.target.value })} title="현재 학급" data-testid="class-select">
        {data.classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.students.length}명)
          </option>
        ))}
      </select>
      <span className={`t-chip ${studentChip}`} title="학생용 화면 상태" data-testid="student-status">
        <span className="dot" />
        학생 화면: {studentText}
      </span>
      {sw.visible ? (
        <button className="btn sm ghost" onClick={() => act('student/hide')}>
          학생 화면 숨기기
        </button>
      ) : (
        <button className="btn sm ghost" onClick={() => act('student/show')}>
          학생 화면 보이기
        </button>
      )}
      <span className="spacer" />
      <span className={`t-chip ${next ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setTab('schedule')} title="다음 예약">
        <span className="dot" />
        {next ? `다음 예약: ${formatDateTimeKo(next.at)} ${next.name}` : '예정된 예약 없음'}
      </span>
      <span className="t-chip on" title="창을 닫아도 알림 영역에서 계속 실행되며 예약을 감시합니다">
        <span className="dot" />
        백그라운드 실행 중 · 예약 {activeCount}개 감시
      </span>
    </header>
  );
}

function SidePanel({ setTab }: { setTab: (t: Tab) => void }) {
  const s = useAppState();
  const { studentView: v, runtime, data } = s;
  const cls = data.classes.find((c) => c.id === data.currentClassId);
  const desc = v.timer
    ? v.timer.mode === 'split'
      ? '칠판 + 타이머 함께 보기'
      : '전체 화면 타이머'
    : { blank: '빈 화면', board: '칠판', seating: '자리 배치', picker: '발표자 뽑기', agenda: '이번 주 일정' }[v.base];
  const sw = runtime.studentWindow;
  return (
    <aside className="t-side">
      <h3>학생 화면 미리보기</h3>
      <div className="t-preview" data-testid="teacher-preview">
        <ScaledStudentScreen view={v} />
      </div>
      <div className="t-preview-note">
        지금 학생 화면: <b>{desc}</b>
        {!sw.visible && ' (학생 창 숨김)'}
        {sw.alwaysOnTop && ' · 맨 위 고정'}
      </div>
      {sw.visible && sw.escHides && (
        <div className="alert info" style={{ margin: 0 }} data-testid="esc-hint">
          학생 화면이 이 모니터를 덮고 있으면, 학생 화면에서 <b>Esc</b> 키를 누르면 숨겨지고 이 창으로 돌아옵니다.
        </div>
      )}
      <div className="row">
        <button className="btn" onClick={() => act('student/base', { base: 'board', dismissTimer: true })}>
          칠판 보이기
        </button>
        <button className="btn" disabled={!cls?.seating.confirmed} onClick={() => act('student/base', { base: 'seating', confirmed: true })}>
          확정 자리
        </button>
        <button className="btn" onClick={() => act('student/base', { base: 'blank' })}>
          빈 화면
        </button>
      </div>
      {v.timer && (
        <button className="btn big danger" onClick={() => act('timer/close')}>
          타이머 닫기 (이전 화면으로)
        </button>
      )}
      {!sw.displayAvailable && sw.mode !== 'preview' && (
        <div className="alert warn">
          학생용 디스플레이(TV·프로젝터)가 연결되어 있지 않습니다. 연결 후 설정에서 선택하거나, 한 화면에서 시험할 때는 미리보기 창을 여세요.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => api().app({ type: 'preview', open: true })}>
              미리보기 창 열기
            </button>
            <button className="btn sm" onClick={() => setTab('settings')}>
              디스플레이 설정
            </button>
          </div>
        </div>
      )}
      {runtime.notices.map((n) => (
        <div key={n.id} className={`alert ${n.level === 'error' ? 'err' : n.level === 'warn' ? 'warn' : 'info'}`}>
          {n.message}
          <div style={{ textAlign: 'right' }}>
            <button className="btn sm" onClick={() => act('notice/dismiss', { id: n.id })}>
              확인
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}

function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="닫기">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

window.addEventListener('unhandledrejection', (e) => toast('오류: ' + (e.reason?.message ?? e.reason), 'err'));
createRoot(document.getElementById('root')!).render(<App />);
