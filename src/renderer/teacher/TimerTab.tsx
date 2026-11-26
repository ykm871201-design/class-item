import { useEffect, useState } from 'react';
import type { SoundId, StudentBoardView, StudentView, TimerDisplayMode } from '../../shared/types';
import { ScaledStudentScreen } from '../common/StudentScreen';
import { SOUNDS } from '../../shared/defaults';
import { formatClock } from '../../shared/util';
import { WARN_FROM_CHOICES, warnFromLabel } from '../../shared/timer';
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

/** 종료 예고음: 끝나기 몇 초 전부터 종료 때까지 1초마다 같은 소리 ‘띡’ (크기 따로 조절) */
export function WarningPicker({ warnFrom, warnVolume, durationSec, onChange, onVolume }: { warnFrom: number; warnVolume: number; durationSec: number; onChange: (sec: number) => void; onVolume: (v: number) => void }) {
  const [vol, setVol] = useState(warnVolume);
  useEffect(() => setVol(warnVolume), [warnVolume]);
  const preview = () => {
    // 실제와 같이 1초 간격으로 5번 (오디오 시계로 예약해 간격이 고름)
    const base = Date.now() + 100;
    for (let i = 0; i < 5; i++) playSound('tick', vol, base + i * 1000);
  };
  return (
    <>
      <div className="row" data-testid="warning-picker">
        <span className="field-label">종료 예고음</span>
        <div className="seg">
          {WARN_FROM_CHOICES.map((c) => (
            <button key={c.sec} type="button" className={warnFrom === c.sec ? 'on' : ''} onClick={() => onChange(c.sec)} aria-pressed={warnFrom === c.sec} data-warn={c.sec}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="small muted">
          {warnFrom
            ? `끝나기 ${warnFromLabel(warnFrom).replace('부터', '')}부터 끝날 때까지 1초마다 같은 소리로 ‘띡’ 하고 울립니다.${durationSec > 0 && durationSec <= warnFrom ? ' (타이머가 더 짧아 처음부터 울립니다)' : ''}`
            : '종료 알림음만 울립니다.'}
        </span>
      </div>
      {warnFrom > 0 && (
        <div className="row">
          <span className="field-label">예고음 크기</span>
          <input type="range" min={0} max={100} value={vol} onChange={(e) => setVol(Number(e.target.value))} onPointerUp={() => vol !== warnVolume && onVolume(vol)} onKeyUp={() => vol !== warnVolume && onVolume(vol)} onBlur={() => vol !== warnVolume && onVolume(vol)} data-testid="warn-volume" />
          <span className="small muted" style={{ width: 40 }}>
            {vol === 0 ? '무음' : `${vol}%`}
          </span>
          <button type="button" className="btn sm" disabled={vol === 0} onClick={preview}>
            ▶ 예고음 미리 듣기
          </button>
        </div>
      )}
    </>
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

/**
 * 표시 방식 선택 + 학생 화면 미리보기.
 * 두 방식을 실제 학생 화면 모습(현재 학생 화면에 표시된 칠판 내용 기준)으로 나란히 보여 주고, 눌러서 고른다.
 */
export function ModePreviewPicker({ mode, onChange, board, durationSec, activity }: { mode: TimerDisplayMode; onChange: (m: TimerDisplayMode) => void; board: StudentBoardView; durationSec: number; activity: string }) {
  const options: { id: TimerDisplayMode; label: string; desc: string }[] = [
    { id: 'split', label: '칠판 + 타이머 함께 보기', desc: '칠판은 그대로, 오른쪽 아래에 타이머' },
    { id: 'full', label: '전체 화면 타이머', desc: '타이머만 화면 가득' },
  ];
  const ms = Math.max(1, durationSec) * 1000;
  return (
    <div className="mode-previews" data-testid="mode-previews">
      {options.map((o) => {
        // 미리보기는 멈춘 그림으로 보여 준다 (status 'idle' → 남은 시간 = 전체 시간)
        const view: StudentView = { base: 'board', board, seating: null, picker: null, timer: { status: 'idle', durationMs: ms, endAt: 0, remainingMs: ms, activity, mode: o.id } };
        return (
          <button key={o.id} type="button" className={`mode-preview ${mode === o.id ? 'on' : ''}`} onClick={() => onChange(o.id)} data-mode={o.id} aria-pressed={mode === o.id}>
            <div className="mode-preview-screen">
              <ScaledStudentScreen view={view} />
            </div>
            <div className="mode-preview-label">
              {mode === o.id ? '● ' : '○ '}
              {o.label}
            </div>
            <div className="small muted">{o.desc}</div>
          </button>
        );
      })}
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
    act('timer/start', { durationSec: total, activity, sound: st.timerSound, volume: st.timerVolume, mode: st.timerDisplayMode, warnFrom: st.timerWarnFrom, warnVolume: st.timerWarnVolume });
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
          {active && t.warnFrom > 0 && <span className="pill">예고음: {warnFromLabel(t.warnFrom)}</span>}
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
        {active && (
          <div className="row" style={{ marginTop: 14 }}>
            <span className="field-label">표시 방식</span>
            <ModePicker mode={t.mode} onChange={(m) => act('timer/setMode', { mode: m })} />
            <span className="small muted">진행 중에도 바꿀 수 있으며 남은 시간은 유지됩니다. 오른쪽 ‘학생 화면 미리보기’에 바로 보입니다.</span>
          </div>
        )}
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
        <WarningPicker warnFrom={st.timerWarnFrom} warnVolume={st.timerWarnVolume} durationSec={total} onChange={(sec) => setDefaults({ timerWarnFrom: sec })} onVolume={(v) => setDefaults({ timerWarnVolume: v })} />
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={st.timerEndRepeat} onChange={(e) => setDefaults({ timerEndRepeat: e.target.checked })} data-testid="end-repeat" />
            끝난 뒤 닫을 때까지 종료 알림음을 20초마다 다시 울리기
          </label>
          <span className="small muted">끝난 화면(00:00 · 시간이 끝났어요!)은 이 설정과 상관없이 직접 닫을 때까지 그대로 남습니다.</span>
        </div>
        <div className="field-label" style={{ marginTop: 14 }}>
          표시 방식 <span className="small muted" style={{ fontWeight: 400 }}>— 눌러서 고르세요. 지금 학생 화면에 표시된 칠판 내용으로 미리 보여 줍니다.</span>
        </div>
        <ModePreviewPicker mode={st.timerDisplayMode} onChange={(m) => setDefaults({ timerDisplayMode: m })} board={data.boardPublished} durationSec={total} activity={activity} />
        <p className="small muted" style={{ marginTop: 12 }}>
          시간이 끝나면 ‘00:00 · 시간이 끝났어요!’가 표시되고 알림음이 한 번 울립니다. 종료 화면은 ‘종료 화면 닫기’를 누르거나 다른 기능을 학생 화면에 띄울 때까지 유지됩니다.
        </p>
      </div>
    </div>
  );
}
