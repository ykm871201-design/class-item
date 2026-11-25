import { useMemo } from 'react';
import { eligibleStudents } from '../../shared/picker';
import { displayNames, isAway } from '../../shared/roster';
import { localDateKey, pad2 } from '../../shared/util';
import { act, api, toast, useAppState } from './api';

export function PickerTab() {
  const { data, runtime, studentView } = useAppState();
  const cls = data.classes.find((c) => c.id === data.currentClassId)!;
  const p = cls.picker;
  const today = localDateKey(runtime.now);
  const names = useMemo(() => displayNames(cls.students), [cls.students]);
  const elig = eligibleStudents({ students: cls.students, mode: p.mode, excludeAway: p.excludeAway, pickedPool: p.pickedPool, today });
  const base = cls.students.filter((s) => !(p.excludeAway && isAway(s, today)));
  const pool = new Set(p.pickedPool);
  const allDone = p.mode === 'unique' && base.length > 0 && elig.length === 0;
  const tooMany = p.count > elig.length;
  const todays = p.history.filter((h) => h.date === today).reverse();
  const shown = studentView.base === 'picker' ? runtime.pickerReveal : null;
  const animating = !!shown?.animate && runtime.now - shown.startedAt < 2200;

  const draw = async () => {
    const r = await act('picker/draw');
    if (r.ok && r.allDone) toast('모든 학생이 한 번씩 뽑혔습니다. 다시 뽑으려면 ‘뽑힌 학생 다시 포함’을 누르세요.', 'info', 7000);
  };

  return (
    <div>
      <h1 className="t-title">발표자 뽑기 — {cls.name}</h1>
      <p className="t-sub">자리 배치의 고정 설정과는 관계없이 현재 학급 명단에서 무작위로 뽑습니다.</p>
      <div className="card">
        <h2>뽑기 설정</h2>
        <div className="row">
          <span className="field-label">뽑을 인원</span>
          <button className="btn sm" disabled={p.count <= 1} onClick={() => act('picker/options', { count: p.count - 1 })}>
            −
          </button>
          <b style={{ fontSize: 22, minWidth: 40, textAlign: 'center' }} data-testid="pick-count">
            {p.count}명
          </b>
          <button className="btn sm" disabled={p.count >= 30} onClick={() => act('picker/options', { count: p.count + 1 })}>
            +
          </button>
          <div className="seg" style={{ marginLeft: 16 }}>
            <button className={p.mode === 'unique' ? 'on' : ''} onClick={() => act('picker/options', { mode: 'unique' })}>
              중복 없이 뽑기
            </button>
            <button className={p.mode === 'all' ? 'on' : ''} onClick={() => act('picker/options', { mode: 'all' })}>
              매번 전체에서 뽑기
            </button>
          </div>
          <label className="inline">
            <input type="checkbox" checked={p.excludeAway} onChange={(e) => act('picker/options', { excludeAway: e.target.checked })} />
            결석·일시 제외 학생 빼기
          </label>
        </div>
        <div className="row" style={{ fontSize: 17 }}>
          {p.mode === 'unique' ? (
            <span data-testid="pick-remaining">
              남은 학생 <b>{elig.length}명</b> / 참여 {base.length}명 (이미 뽑힘 {base.filter((s) => pool.has(s.id)).length}명)
            </span>
          ) : (
            <span data-testid="pick-remaining">
              참여 인원 <b>{elig.length}명</b>
            </span>
          )}
        </div>
        {allDone && <div className="alert info">모든 학생이 한 번씩 뽑혔습니다. ‘뽑힌 학생 다시 포함’을 누르기 전에는 다시 뽑히지 않습니다.</div>}
        {!allDone && tooMany && elig.length > 0 && <div className="alert warn">추첨 가능한 학생은 {elig.length}명입니다. 뽑을 인원을 줄여 주세요.</div>}
        {cls.students.length === 0 && <div className="alert warn">학생 명단이 비어 있습니다. ‘학생 명단’에서 학생을 등록해 주세요.</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn huge primary" onClick={draw} disabled={elig.length === 0 || tooMany} data-testid="pick-draw">
            🎯 뽑기 (학생 화면에 표시)
          </button>
          <button className="btn big" onClick={() => act('picker/skip')} disabled={!animating}>
            ⏭ 연출 건너뛰기
          </button>
          <button
            className="btn big"
            disabled={p.pickedPool.length === 0}
            onClick={async () => {
              if (await api().confirm({ message: '이미 뽑힌 학생을 다시 추첨에 포함할까요?', ok: '다시 포함' })) act('picker/resetPool', {}, '모든 학생이 다시 추첨에 포함됩니다.');
            }}
            data-testid="pick-reset"
          >
            뽑힌 학생 다시 포함
          </button>
        </div>
        {shown && (
          <div style={{ marginTop: 14 }}>
            <div className="field-label">이번 결과</div>
            <div className="pick-result" data-testid="pick-result">
              {shown.names.map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>
            오늘 추첨 기록 <span className="hint">{todays.length}회</span>
          </h2>
          <table className="list">
            <tbody>
              {todays.map((h) => {
                const d = new Date(h.at);
                return (
                  <tr key={h.id}>
                    <td style={{ width: 70 }} className="muted">
                      {pad2(d.getHours())}:{pad2(d.getMinutes())}
                    </td>
                    <td>
                      <b>{h.names.join(', ')}</b>
                    </td>
                    <td className="small muted" style={{ width: 90 }}>
                      {h.mode === 'unique' ? '중복 없이' : '전체에서'}
                    </td>
                  </tr>
                );
              })}
              {todays.length === 0 && (
                <tr>
                  <td className="muted small">오늘 추첨 기록이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 8 }}>
            <button
              className="btn sm danger"
              disabled={todays.length === 0 && p.pickedPool.length === 0}
              onClick={async () => {
                if (await api().confirm({ message: '오늘 추첨 기록을 지우고, 뽑힌 학생도 다시 포함할까요?', ok: '초기화' })) act('picker/clearHistory', {}, '기록을 초기화했습니다.');
              }}
            >
              기록 초기화
            </button>
          </div>
        </div>
        {p.mode === 'unique' && (
          <div className="card">
            <h2>아직 뽑히지 않은 학생</h2>
            <div className="row" style={{ gap: 6 }}>
              {elig.map((s) => (
                <span key={s.id} className="pill">
                  {s.number}. {names.get(s.id)}
                </span>
              ))}
              {elig.length === 0 && <span className="muted small">없음</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
