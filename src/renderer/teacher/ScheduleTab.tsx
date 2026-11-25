import { useState } from 'react';
import type { Schedule } from '../../shared/types';
import { describeRepeat, nextRun } from '../../shared/schedule';
import { SOUNDS } from '../../shared/defaults';
import { WEEKDAY_KO, formatClock, formatDateTimeKo, localDateKey, pad2 } from '../../shared/util';
import { act, api, toast, useAppState } from './api';
import { ACTIVITY_SUGGESTIONS, ModePicker, SoundPicker } from './TimerTab';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function blank(now: number): Schedule {
  const d = new Date(now + 3600_000);
  return {
    id: '',
    name: '',
    enabled: true,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    durationSec: 300,
    repeat: 'weekly',
    date: localDateKey(now),
    days: [1, 2, 3, 4, 5],
    activity: '',
    sound: 'chime',
    volume: 70,
    displayMode: 'split',
    createdAt: now,
  };
}

const LOG_KIND: Record<string, string> = { fired: '실행', missed: '놓침', replaced: '전환', 'no-display': '화면 없음', info: '안내' };

export function ScheduleTab() {
  const { data, runtime } = useAppState();
  const [edit, setEdit] = useState<Schedule | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const unack = data.scheduleLog.filter((e) => !e.acknowledged);

  const save = async () => {
    if (!edit) return;
    const r = await api().dispatch({ type: 'schedule/save', schedule: edit });
    if (!r.ok) setErr(r.error ?? '저장하지 못했습니다.');
    else {
      setErr(null);
      setEdit(null);
      toast('예약을 저장했습니다.', 'ok');
    }
  };

  const sorted = [...data.schedules].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div>
      <h1 className="t-title">예약 타이머</h1>
      <p className="t-sub">정한 시각이 되면 학생 화면을 띄우고 타이머를 자동으로 시작합니다. 앱이 실행 중일 때(알림 영역 포함)만 동작하며, 앱을 완전히 종료했거나 PC가 꺼져 있으면 실행되지 않습니다.</p>

      {unack.length > 0 && (
        <div className="alert warn">
          확인하지 않은 예약 기록이 {unack.length}건 있습니다 (놓친 예약·타이머 전환 등). 아래 ‘실행 기록’에서 확인하세요.
        </div>
      )}

      {!edit && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn big primary" onClick={() => { setErr(null); setEdit(blank(runtime.now)); }} data-testid="schedule-new">
            + 새 예약 만들기
          </button>
        </div>
      )}

      {edit && <Editor s={edit} setS={setEdit} err={err} onSave={save} onCancel={() => { setEdit(null); setErr(null); }} />}

      <div className="card">
        <h2>예약 목록 ({data.schedules.length}개)</h2>
        {sorted.length === 0 && <div className="muted">등록된 예약이 없습니다. 예) 매주 월~금 10:20, 5분 ‘쉬는 시간’ 타이머</div>}
        {sorted.map((s) => {
          const next = nextRun(s, runtime.now, data.scheduleFired[s.id]);
          return (
            <div key={s.id} className={`sched-item ${s.enabled ? '' : 'off'}`} data-testid="schedule-item">
              <div className="sched-time">{s.time}</div>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {s.name} <span className="pill">{formatClock(s.durationSec * 1000)}</span> {s.activity && <span className="pill">{s.activity}</span>} <span className="pill">{s.displayMode === 'split' ? '칠판+타이머' : '전체 화면'}</span>
                </div>
                <div className="small muted">
                  {describeRepeat(s)} · 알림음 {SOUNDS.find((x) => x.id === s.sound)?.name}
                  {s.sound !== 'none' && ` ${s.volume}%`}
                </div>
                <div className="small" style={{ marginTop: 2 }} data-testid="schedule-next">
                  {s.enabled ? (next ? <b style={{ color: 'var(--ok)' }}>다음 실행: {formatDateTimeKo(next)}</b> : <span className="muted">다음 실행 없음 (완료)</span>) : <span className="muted">꺼짐</span>}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <label className="inline">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => act('schedule/toggle', { id: s.id, enabled: e.target.checked })} />
                  켜기
                </label>
                <button className="btn sm" onClick={() => { setErr(null); setEdit({ ...s }); }}>
                  수정
                </button>
                <button className="btn sm" title="지금 바로 이 예약을 실행해 봅니다" onClick={() => act('schedule/runNow', { id: s.id })}>
                  지금 실행
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (await api().confirm({ message: `‘${s.name}’ 예약을 삭제할까요?`, ok: '삭제' })) act('schedule/delete', { id: s.id });
                  }}
                >
                  삭제
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>
          실행 기록 <span className="hint">놓친 예약, 타이머 전환, 학생 화면 없음 등을 보여 줍니다</span>
        </h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn sm" disabled={unack.length === 0} onClick={() => act('log/ack')}>
            모두 확인함
          </button>
          <button
            className="btn sm danger"
            disabled={data.scheduleLog.length === 0}
            onClick={async () => {
              if (await api().confirm({ message: '예약 실행 기록을 모두 지울까요?', ok: '지우기' })) act('log/clear');
            }}
          >
            기록 지우기
          </button>
        </div>
        <div data-testid="schedule-log">
          {[...data.scheduleLog].reverse().slice(0, 60).map((e) => (
            <div key={e.id} className={`log-item ${e.kind}`} style={{ fontWeight: e.acknowledged ? 400 : 700 }}>
              <span className="k">[{LOG_KIND[e.kind]}]</span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {formatDateTimeKo(e.at)}
              </span>
              <span>{e.message}</span>
            </div>
          ))}
          {data.scheduleLog.length === 0 && <div className="muted small">기록이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}

function Editor({ s, setS, err, onSave, onCancel }: { s: Schedule; setS: (s: Schedule) => void; err: string | null; onSave: () => void; onCancel: () => void }) {
  const set = (p: Partial<Schedule>) => setS({ ...s, ...p });
  const min = Math.floor(s.durationSec / 60);
  const sec = s.durationSec % 60;
  return (
    <div className="card" style={{ borderColor: 'var(--primary)' }} data-testid="schedule-editor">
      <h2>{s.id ? '예약 수정' : '새 예약'}</h2>
      <div className="row">
        <span className="field-label">예약 이름</span>
        <input type="text" value={s.name} maxLength={30} placeholder="예: 2교시 쉬는 시간" onChange={(e) => set({ name: e.target.value })} style={{ width: 260 }} data-testid="sch-name" />
        <label className="inline" style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> 활성화
        </label>
      </div>
      <div className="row">
        <span className="field-label">실행 시각</span>
        <input type="time" value={s.time} onChange={(e) => set({ time: e.target.value })} data-testid="sch-time" />
        <span className="field-label" style={{ marginLeft: 12 }}>
          타이머 길이
        </span>
        <input type="number" min={0} max={180} value={min} onChange={(e) => set({ durationSec: Math.max(0, Math.min(180, Number(e.target.value) || 0)) * 60 + sec })} data-testid="sch-min" />
        분
        <input type="number" min={0} max={59} value={sec} onChange={(e) => set({ durationSec: min * 60 + Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} />
        초
        {[1, 3, 5, 10].map((m) => (
          <button key={m} className="btn sm" onClick={() => set({ durationSec: m * 60 })}>
            {m}분
          </button>
        ))}
      </div>
      <div className="row">
        <span className="field-label">반복</span>
        <div className="seg">
          <button className={s.repeat === 'weekly' ? 'on' : ''} onClick={() => set({ repeat: 'weekly' })}>
            매주 요일 반복
          </button>
          <button className={s.repeat === 'once' ? 'on' : ''} onClick={() => set({ repeat: 'once' })}>
            한 번 실행
          </button>
        </div>
        {s.repeat === 'weekly' ? (
          <>
            <div className="day-pick">
              {DAY_ORDER.map((d) => (
                <button key={d} className={s.days.includes(d) ? 'on' : ''} onClick={() => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] })}>
                  {WEEKDAY_KO[d]}
                </button>
              ))}
            </div>
            <button className="btn sm" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>
              월~금
            </button>
            <button className="btn sm" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>
              매일
            </button>
          </>
        ) : (
          <input type="date" value={s.date} onChange={(e) => set({ date: e.target.value })} />
        )}
      </div>
      <div className="row">
        <span className="field-label">활동명</span>
        <input type="text" value={s.activity} maxLength={30} placeholder="예: 쉬는 시간" onChange={(e) => set({ activity: e.target.value })} />
        {ACTIVITY_SUGGESTIONS.slice(0, 5).map((a) => (
          <button key={a} className="btn sm" onClick={() => set({ activity: a, name: s.name || a })}>
            {a}
          </button>
        ))}
      </div>
      <div className="row">
        <span className="field-label">표시 방식</span>
        <ModePicker mode={s.displayMode} onChange={(m) => set({ displayMode: m })} />
      </div>
      <SoundPicker sound={s.sound} volume={s.volume} onChange={(sound, volume) => set({ sound, volume })} />
      {err && <div className="alert err">{err}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn big primary" onClick={onSave} data-testid="sch-save">
          저장
        </button>
        <button className="btn big" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
