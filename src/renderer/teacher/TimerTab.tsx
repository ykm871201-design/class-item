import { useState } from 'react';
import type { SoundId, TimerDisplayMode } from '../../shared/types';
import { SOUNDS } from '../../shared/defaults';
import { formatClock } from '../../shared/util';
import { useNow } from '../common/hooks';
import { act, useAppState } from './api';
import { playSound } from './sound';

export const ACTIVITY_SUGGESTIONS = ['모둠 활동', '정리 시간', '쉬는 시간', '개별 활동', '발표 준비', '책 읽기', '청소 시간'];

export function SoundPicker({ sound, volume, onChange }: { sound: SoundId; volume: number; onChange: (s: SoundId, v: number) => void }) {
  return (
    <div className="row">
      <span className="field-label">종료 알림음</span>
      <select value={sound} onChange={(e) => onChange(e.target.value as SoundId, volume)}>
        {SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className="btn sm" disabled={sound === 'none' || volume === 0} onClick={() => playSound(sound, volume)}>
        ▶ 미리 듣기
      </button>
      <span className="field-label">음량</span>
      <input type="range" min={0} max={100} value={volume} disabled={sound === 'none'} onChange={(e) => onChange(sound, Number(e.target.value))} />
      <span className="small muted" style={{ width: 40 }}>
        {sound === 'none' ? '무음' : `${volume}%`}
      </span>
    </div>
  );
}

export function ModePicker({ mode, onChange }: { mode: TimerDisplayMode; onChange: (m: TimerDisplayMode) => void }) {
  return (
    <div className="seg">
      <button className={mode === 'split' ? 'on' : ''} onClick={() => onChange('split')}>
        칠판 + 타이머 함께 보기
      </button>
      <button className={mode === 'full' ? 'on' : ''} onClick={() => onChange('full')}>
        전체 화면 타이머
      </button>
    </div>
  );
}

export function TimerTab() {
  const { data, runtime } = useAppState();
  const st = data.settings;
  const t = runtime.timer;
  const [min, setMin] = useState(Math.floor(st.lastTimerSec / 60));
  const [sec, setSec] = useState(st.lastTimerSec % 60);
  const [activity, setActivity] = useState(st.timerActivity);
  const now = useNow(200, t.status === 'running');
  const remaining = t.status === 'running' ? Math.max(0, t.endAt - now) : t.status === 'finished' ? 0 : t.remainingMs;
  const total = min * 60 + sec;
  const active = t.status !== 'idle';
  const schedName = t.source === 'schedule' ? data.schedules.find((x) => x.id === t.scheduleId)?.name : null;

  const setDefaults = (patch: Record<string, unknown>) => act('timer/defaults', { patch });
  const start = () => {
    if (total <= 0) return;
    act('timer/start', { durationSec: total, activity, sound: st.timerSound, volume: st.timerVolume, mode: st.timerDisplayMode });
  };
  const quick = (m: number) => {
    setMin(m);
    setSec(0);
    setDefaults({ lastTimerSec: m * 60 });
  };

  return (
    <div>
      <h1 className="t-title">타이머</h1>
      <p className="t-sub">남은 시간은 종료 시각을 기준으로 계산하므로 창을 최소화하거나 다른 프로그램을 써도 정확합니다.</p>

      <div className="card">
        <h2>
          현재 타이머
          <span className={`timer-status ${t.status}`} data-testid="timer-status">
            {{ idle: '대기', running: '진행 중', paused: '일시정지', finished: '종료' }[t.status]}
          </span>
          {schedName && <span className="pill">예약: {schedName}</span>}
          {active && !t.shown && <span className="pill">학생 화면에서 숨김</span>}
        </h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="timer-big" data-testid="teacher-timer">
            {formatClock(active ? remaining : total * 1000)}
          </div>
          {active && t.activity && <div style={{ fontSize: 20, fontWeight: 700, marginLeft: 10 }}>{t.activity}</div>}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {!active || t.status === 'finished' ? (
            <button className="btn huge primary" onClick={start} disabled={total <= 0} data-testid="timer-start">
              ▶ 시작
            </button>
          ) : t.status === 'running' ? (
            <button className="btn huge" onClick={() => act('timer/pause')}>
              ⏸ 일시정지
            </button>
          ) : (
            <button className="btn huge primary" onClick={() => act('timer/resume')}>
              ▶ 계속
            </button>
          )}
          <button className="btn big" disabled={!active} onClick={() => act('timer/reset')}>
            ↺ 초기화
          </button>
          <button className="btn big danger" disabled={!active} onClick={() => act('timer/close')} data-testid="timer-close">
            {t.status === 'finished' ? '종료 화면 닫기' : '■ 종료'}
          </button>
          {active && (t.shown ? <button className="btn" onClick={() => act('timer/setShown', { shown: false })}>학생 화면에서 숨기기</button> : <button className="btn" onClick={() => act('timer/setShown', { shown: true })}>학생 화면에 다시 표시</button>)}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="field-label">표시 방식</span>
          <ModePicker mode={active ? t.mode : st.timerDisplayMode} onChange={(m) => (active ? act('timer/setMode', { mode: m }) : setDefaults({ timerDisplayMode: m }))} />
          <span className="small muted">진행 중에도 바꿀 수 있으며 남은 시간은 유지됩니다.</span>
        </div>
      </div>

      <div className="card">
        <h2>새 타이머 설정</h2>
        <div className="row">
          <span className="field-label">바로가기</span>
          {[1, 3, 5, 10].map((m) => (
            <button key={m} className={`btn big ${total === m * 60 ? 'sel' : ''}`} onClick={() => quick(m)}>
              {m}분
            </button>
          ))}
        </div>
        <div className="row">
          <span className="field-label">직접 입력</span>
          <input type="number" min={0} max={180} value={min} onChange={(e) => setMin(Math.max(0, Math.min(180, Number(e.target.value) || 0)))} onBlur={() => setDefaults({ lastTimerSec: Math.max(1, total) })} />
          분
          <input type="number" min={0} max={59} value={sec} onChange={(e) => setSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} onBlur={() => setDefaults({ lastTimerSec: Math.max(1, total) })} />
          초
        </div>
        <div className="row">
          <span className="field-label">활동명</span>
          <input type="text" value={activity} maxLength={30} placeholder="예: 모둠 활동" onChange={(e) => setActivity(e.target.value)} onBlur={() => setDefaults({ timerActivity: activity })} style={{ width: 220 }} />
          {ACTIVITY_SUGGESTIONS.map((a) => (
            <button key={a} className={`btn sm ${activity === a ? 'sel' : ''}`} onClick={() => { setActivity(a); setDefaults({ timerActivity: a }); }}>
              {a}
            </button>
          ))}
          <button className="btn sm" onClick={() => { setActivity(''); setDefaults({ timerActivity: '' }); }}>
            없음
          </button>
        </div>
        <SoundPicker sound={st.timerSound} volume={st.timerVolume} onChange={(s, v) => setDefaults({ timerSound: s, timerVolume: v })} />
        <p className="small muted" style={{ marginTop: 12 }}>
          시간이 끝나면 ‘00:00 · 시간이 끝났어요!’가 표시되고 알림음이 한 번 울립니다. 종료 화면은 ‘종료 화면 닫기’를 누르거나 다른 기능을 학생 화면에 띄울 때까지 유지됩니다.
        </p>
      </div>
    </div>
  );
}
