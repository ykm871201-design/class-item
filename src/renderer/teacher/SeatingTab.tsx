import { useEffect, useMemo, useState } from 'react';
import type { ClassRoom, LayoutType, SeatLayout } from '../../shared/types';
import { activeSeats, allSeats, disabledList, layoutEquals, precheckSeating, seatColumns, seatLabel, shortSeatLabel, validateFixed, FIXED_ISSUE_TEXT, LIMITS } from '../../shared/seating';
import { awayLabel, displayNames } from '../../shared/roster';
import { formatDateTimeKo, localDateKey } from '../../shared/util';
import { seatGridTemplate } from '../common/StudentScreen';
import { act, api, toast, useAppState } from './api';

type ClickMode = 'fix' | 'toggle';

export function SeatingTab() {
  const { data, runtime, studentView } = useAppState();
  const cls = data.classes.find((c) => c.id === data.currentClassId)!;
  const cfg = cls.seating;
  const layout = cfg.layout;
  const today = localDateKey(runtime.now);
  const names = useMemo(() => displayNames(cls.students), [cls.students]);
  const [mode, setMode] = useState<ClickMode>('fix');
  const [show, setShow] = useState<'draft' | 'confirmed'>('draft');
  const [pop, setPop] = useState<{ seatId: string; x: number; y: number } | null>(null);
  const [saveName, setSaveName] = useState('');

  const pre = precheckSeating({ layout, students: cls.students, fixed: cfg.fixed, excludeAway: cfg.excludeAway, today });
  const issues = validateFixed(layout, cls.students, cfg.fixed);
  const issueKey = new Set(issues.map((i) => i.seatId + '|' + i.studentId));
  const fixedBySeat = new Map(cfg.fixed.filter((f) => !issueKey.has(f.seatId + '|' + f.studentId)).map((f) => [f.seatId, f.studentId]));
  const result = show === 'confirmed' ? cfg.confirmed : cfg.draft;
  const resultMatches = !!result && layoutEquals(result.layout, layout);
  const revealedNow = studentView.base === 'seating' && runtime.seatingReveal?.classId === cls.id;
  const revealedIsDraft = revealedNow && cfg.draft && runtime.seatingReveal && JSON.stringify(runtime.seatingReveal.result.assignment) === JSON.stringify(cfg.draft.assignment);
  const animating = revealedNow && runtime.seatingReveal?.animate && runtime.now - (runtime.seatingReveal?.startedAt ?? 0) < 3000;

  const setLayout = async (p: Partial<SeatLayout>) => {
    const r = await act('seating/setLayout', { layout: p });
    if (r.ok && r.note) toast(r.note, 'info');
    if (r.ok && r.issues?.length) toast('자리 모양을 바꾸어 적용할 수 없게 된 고정 자리가 있습니다:\n' + r.issues.join('\n'), 'warn', 8000);
  };

  const draw = async (reveal: boolean) => {
    if (pre.error) {
      toast(pre.error, 'err');
      return;
    }
    if (issues.length) {
      const ok = await api().confirm({
        message: '적용할 수 없는 고정 자리가 있습니다. 이 항목을 빼고 배치할까요?',
        detail: issueTexts(issues, names, layout).join('\n') + '\n\n고정 자리 목록에서 조정하거나 ‘충돌 항목 해제’를 누를 수 있습니다.',
        ok: '빼고 배치',
      });
      if (!ok) return;
    }
    const r = await act('seating/draw', { reveal });
    if (r.ok) {
      setShow('draft');
      const msgs: string[] = [];
      if (r.skippedFixedAway?.length) msgs.push(`결석·제외로 이번 배치에서 빠진 고정 학생: ${r.skippedFixedAway.join(', ')}`);
      if (r.emptySeats > 0) msgs.push(`빈자리 ${r.emptySeats}석`);
      toast((reveal ? '추첨하여 학생 화면에 공개했습니다.' : '추첨했습니다. 교사 화면에서만 보입니다.') + (msgs.length ? '\n' + msgs.join('\n') : ''), 'ok', 5000);
    }
  };

  const onSeatClick = (seatId: string, e: React.MouseEvent) => {
    if (mode === 'toggle') {
      if (!disabledList(layout).includes(seatId) && fixedBySeat.has(seatId)) {
        toast('고정된 자리입니다. 먼저 고정을 해제한 뒤 사용하지 않는 자리로 바꾸세요.', 'warn');
        return;
      }
      act('seating/toggleSeat', { seatId });
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({ seatId, x: Math.min(window.innerWidth - 300, r.left), y: Math.min(window.innerHeight - 430, r.bottom + 4) });
  };

  const grid = seatGridTemplate({ type: layout.type, cols: seatColumns(layout), pairsPerGroup: layout.pairsPerGroup });
  const dis = new Set(disabledList(layout));

  return (
    <div>
      <h1 className="t-title">랜덤 자리 배치 — {cls.name}</h1>
      <p className="t-sub">교사 화면의 고정 표시(🔒)는 학생 화면에 나타나지 않습니다. 학생 화면에서는 모든 자리가 똑같이 섞이고 동시에 공개됩니다.</p>

      <div className="card">
        <h2>자리 모양</h2>
        <div className="row">
          <div className="seg">
            {(['pair', 'single'] as LayoutType[]).map((t) => (
              <button key={t} className={layout.type === t ? 'on' : ''} onClick={() => setLayout({ type: t })} data-testid={`layout-${t}`}>
                {t === 'pair' ? '짝꿍형 (2명씩)' : '개인형 (1명씩)'}
              </button>
            ))}
          </div>
          {layout.type === 'pair' ? (
            <>
              <Stepper label="한 줄의 짝 수" value={layout.pairCols} min={LIMITS.pairCols.min} max={LIMITS.pairCols.max} onChange={(v) => setLayout({ pairCols: v })} />
              <label className="inline">
                분단 간격
                <select value={layout.pairsPerGroup} onChange={(e) => setLayout({ pairsPerGroup: Number(e.target.value) })}>
                  <option value={1}>짝마다</option>
                  <option value={2}>2짝마다</option>
                  <option value={3}>3짝마다</option>
                </select>
              </label>
            </>
          ) : (
            <Stepper label="한 줄의 자리 수" value={layout.cols} min={LIMITS.cols.min} max={LIMITS.cols.max} onChange={(v) => setLayout({ cols: v })} />
          )}
          <Stepper label="줄 수" value={layout.rows} min={LIMITS.rows.min} max={LIMITS.rows.max} onChange={(v) => setLayout({ rows: v })} />
          <button
            className="btn"
            onClick={async () => {
              const r = await act('seating/suggest', {}, '학생 수에 맞게 배열했습니다.');
              if (r.issues?.length) toast('적용할 수 없게 된 고정 자리:\n' + r.issues.join('\n'), 'warn', 8000);
            }}
          >
            학생 수에 맞게 자동 배열
          </button>
        </div>
        <div className="row small">
          <span>
            전체 {allSeats(layout).length}석 · 사용 {activeSeats(layout).length}석 · 참여 학생 <b data-testid="participants">{pre.participants.length}명</b>
            {cls.students.length !== pre.participants.length && ` (결석·제외 ${cls.students.length - pre.participants.length}명 빠짐)`}
          </span>
          <label className="inline">
            <input type="checkbox" checked={cfg.excludeAway} onChange={(e) => act('seating/options', { excludeAway: e.target.checked })} />
            결석·일시 제외 학생은 배치하지 않기
          </label>
          <label className="inline">
            빈자리
            <select value={cfg.emptyPolicy} onChange={(e) => act('seating/options', { emptyPolicy: e.target.value })}>
              <option value="back">뒤쪽부터 비우기</option>
              <option value="random">무작위로 비우기</option>
            </select>
          </label>
        </div>
        {pre.error && <div className="alert err">{pre.error}</div>}
        {issues.length > 0 && (
          <div className="alert warn">
            조정이 필요한 고정 자리가 있습니다 (배치할 때 적용되지 않음):
            {'\n' + issueTexts(issues, names, layout).join('\n')}
            <div style={{ marginTop: 6 }}>
              <button className="btn sm" onClick={() => act('seating/removeInvalidFixed', {}, '충돌 항목을 해제했습니다.')}>
                충돌 항목 해제
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="row">
            <span className="field-label">자리를 누르면</span>
            <div className="seg">
              <button className={mode === 'fix' ? 'on' : ''} onClick={() => setMode('fix')}>
                🔒 학생 고정하기
              </button>
              <button className={mode === 'toggle' ? 'on' : ''} onClick={() => setMode('toggle')} data-testid="mode-toggle">
                사용 / 사용 안 함
              </button>
            </div>
          </div>
          <div className="seg">
            <button className={show === 'draft' ? 'on' : ''} onClick={() => setShow('draft')}>
              최근 추첨 결과
            </button>
            <button className={show === 'confirmed' ? 'on' : ''} onClick={() => setShow('confirmed')} disabled={!cfg.confirmed}>
              확정 배치
            </button>
          </div>
        </div>
        <div className="t-seat-wrap">
          <div className="t-front">
            <span className="side">◀ 왼쪽 (학생 기준)</span>
            <span>칠판 · 교실 앞</span>
            <span className="side">오른쪽 (학생 기준) ▶</span>
          </div>
          <div className="t-seat-grid" style={{ gridTemplateColumns: grid.template, gridTemplateRows: `repeat(${layout.rows}, auto)` }} data-testid="teacher-seat-grid">
            {allSeats(layout).map((seat) => {
              const off = dis.has(seat.id);
              const fixedSid = fixedBySeat.get(seat.id);
              const bad = issues.some((i) => i.seatId === seat.id);
              const assigned = resultMatches ? result!.assignment[seat.id] : undefined;
              const fixedStu = fixedSid ? cls.students.find((s) => s.id === fixedSid) : undefined;
              const fixedAway = fixedStu ? awayLabel(fixedStu, today) : null;
              return (
                <div
                  key={seat.id}
                  className={`t-seat${off ? ' off' : ''}${fixedSid ? ' fixed' : ''}${bad ? ' bad' : ''}${pop?.seatId === seat.id ? ' picked' : ''}${!assigned && result ? ' empty-draft' : ''}`}
                  style={{ gridColumn: grid.seatTrack[seat.c] + 1, gridRow: seat.r + 1 }}
                  onClick={(e) => onSeatClick(seat.id, e)}
                  title={seatLabel(seat.id, layout)}
                  data-seat={seat.id}
                >
                  <span className="pos">{shortSeatLabel(seat.id)}</span>
                  {fixedSid && <span className="lock">🔒</span>}
                  {off ? <span>사용 안 함</span> : assigned ? <span>{names.get(assigned)}</span> : fixedSid ? null : <span className="muted small">{result && resultMatches ? '빈자리' : ''}</span>}
                  {fixedSid && (!assigned || assigned !== fixedSid) && (
                    <span className="fixedname">
                      {names.get(fixedSid)} 고정{fixedAway ? ` (${fixedAway})` : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
          <div className="legend">
            <span>일반 자리</span>
            <span className="l-fixed">고정 자리 (교사만 보임)</span>
            <span className="l-off">사용 안 함</span>
          </div>
          <span className="small muted">
            {result
              ? resultMatches
                ? `${show === 'draft' ? '최근 추첨' : '확정 배치'}: ${formatDateTimeKo(result.createdAt)}`
                : '자리 모양이 바뀌어 이 결과를 표시할 수 없습니다. 다시 추첨하세요.'
              : '아직 추첨한 결과가 없습니다.'}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>추첨과 공개</h2>
        <div className="row">
          <button className="btn huge" onClick={() => draw(false)} disabled={!!pre.error} data-testid="seat-draw-preview">
            미리 추첨 (교사만 보기)
          </button>
          <button className="btn huge primary" onClick={() => act('seating/reveal')} disabled={!cfg.draft} data-testid="seat-reveal">
            학생 화면에 공개
          </button>
          <button className="btn huge primary" onClick={() => draw(true)} disabled={!!pre.error} data-testid="seat-draw-reveal">
            바로 추첨·공개
          </button>
        </div>
        <div className="row">
          <button className="btn big" onClick={() => draw(!!revealedIsDraft)} disabled={!!pre.error || !cfg.draft}>
            🔀 다시 섞기{revealedIsDraft ? ' (공개 중)' : ''}
          </button>
          <button className="btn big" onClick={() => act('seating/skip')} disabled={!animating}>
            ⏭ 연출 건너뛰기
          </button>
          <button className="btn big ok" disabled={!cfg.draft || !layoutEquals(cfg.draft.layout, layout)} onClick={() => act('seating/confirm', {}, '배치를 확정했습니다.')} data-testid="seat-confirm">
            ✔ 이 배치로 확정
          </button>
          {cfg.confirmed && <span className="small muted">확정: {formatDateTimeKo(cfg.confirmed.createdAt)}</span>}
        </div>
        <p className="small muted">다시 섞기와 재추첨을 해도 고정 자리 설정은 그대로 유지됩니다.</p>
      </div>

      <div className="grid2">
        <FixedList cls={cls} names={names} today={today} />
        <div className="card">
          <h2>배치 저장·불러오기</h2>
          <div className="row">
            <input type="text" value={saveName} placeholder="예: 11월 자리" onChange={(e) => setSaveName(e.target.value)} style={{ flex: 1 }} />
            <button
              className="btn"
              disabled={!cfg.draft && !cfg.confirmed}
              onClick={async () => {
                const r = await act('seating/save', { name: saveName }, '배치를 저장했습니다.');
                if (r.ok) setSaveName('');
              }}
            >
              최근 결과 저장
            </button>
          </div>
          <table className="list" style={{ marginTop: 8 }}>
            <tbody>
              {[...cfg.saved].reverse().map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <div className="small muted">
                      {formatDateTimeKo(s.createdAt)} · {s.layout.type === 'pair' ? '짝꿍형' : '개인형'} {s.layout.rows}줄
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', width: 150 }}>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        const r = await act('seating/loadSaved', { id: s.id });
                        if (r.ok) {
                          setShow('draft');
                          toast(['저장한 배치를 불러왔습니다. ‘학생 화면에 공개’ 또는 ‘확정’할 수 있습니다.', ...(r.warnings ?? [])].join('\n'), r.warnings?.length ? 'warn' : 'ok', 7000);
                        }
                      }}
                    >
                      불러오기
                    </button>{' '}
                    <button
                      className="btn sm danger"
                      onClick={async () => {
                        if (await api().confirm({ message: `‘${s.name}’ 배치를 삭제할까요?`, ok: '삭제' })) act('seating/deleteSaved', { id: s.id });
                      }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {cfg.saved.length === 0 && (
                <tr>
                  <td className="muted small">저장한 배치가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pop && <SeatPopover cls={cls} seatId={pop.seatId} x={pop.x} y={pop.y} names={names} today={today} onClose={() => setPop(null)} />}
    </div>
  );
}

function issueTexts(issues: ReturnType<typeof validateFixed>, names: Map<string, string>, layout: SeatLayout) {
  return issues.map((i) => `· ${names.get(i.studentId) ?? '(삭제된 학생)'} — ${seatLabel(i.seatId, layout)}: ${FIXED_ISSUE_TEXT[i.reason]}`);
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className="field-label">{label}</span>
      <button className="btn sm" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${label} 줄이기`}>
        −
      </button>
      <b style={{ minWidth: 22, textAlign: 'center' }}>{value}</b>
      <button className="btn sm" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`${label} 늘리기`}>
        +
      </button>
    </span>
  );
}

function FixedList({ cls, names, today }: { cls: ClassRoom; names: Map<string, string>; today: string }) {
  const layout = cls.seating.layout;
  const issues = validateFixed(layout, cls.students, cls.seating.fixed);
  return (
    <div className="card">
      <h2>
        🔒 고정 자리 목록 <span className="hint">교사만 볼 수 있습니다</span>
      </h2>
      {cls.seating.fixed.length === 0 ? (
        <div className="muted small">고정한 학생이 없습니다. 위 배치도에서 ‘학생 고정하기’ 상태로 자리를 누르세요.</div>
      ) : (
        <table className="list" data-testid="fixed-list">
          <tbody>
            {cls.seating.fixed.map((f) => {
              const st = cls.students.find((s) => s.id === f.studentId);
              const issue = issues.find((i) => i.seatId === f.seatId && i.studentId === f.studentId);
              const away = st ? awayLabel(st, today) : null;
              return (
                <tr key={f.seatId + f.studentId}>
                  <td>
                    <b>{names.get(f.studentId) ?? '(삭제된 학생)'}</b>
                    {away && <span className="pill" style={{ marginLeft: 6 }}>{away} — 이번 배치에서 제외</span>}
                  </td>
                  <td className="small">
                    {seatLabel(f.seatId, layout)}
                    {issue && <div style={{ color: 'var(--danger)' }}>{FIXED_ISSUE_TEXT[issue.reason]}</div>}
                  </td>
                  <td style={{ width: 70 }}>
                    <button className="btn sm" onClick={() => act('seating/setFixed', { seatId: f.seatId, studentId: null })}>
                      해제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {cls.seating.fixed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            className="btn sm danger"
            onClick={async () => {
              if (await api().confirm({ message: '고정 자리를 모두 해제할까요?', ok: '모두 해제' })) act('seating/clearFixed');
            }}
          >
            전체 고정 해제
          </button>
        </div>
      )}
    </div>
  );
}

function SeatPopover({ cls, seatId, x, y, names, today, onClose }: { cls: ClassRoom; seatId: string; x: number; y: number; names: Map<string, string>; today: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const layout = cls.seating.layout;
  const off = disabledList(layout).includes(seatId);
  const current = cls.seating.fixed.find((f) => f.seatId === seatId);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const list = cls.students.filter((s) => !q || s.name.includes(q) || String(s.number) === q);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={onClose} />
      <div className="popover" style={{ left: x, top: y }} data-testid="seat-popover">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>{seatLabel(seatId, layout)}</div>
        {off ? (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>
              사용하지 않는 자리입니다.
            </div>
            <button className="btn sm" onClick={() => { act('seating/toggleSeat', { seatId }); onClose(); }}>
              다시 사용하기
            </button>
          </>
        ) : (
          <>
            {current && (
              <button className="btn sm danger" style={{ width: '100%', marginBottom: 6 }} onClick={() => { act('seating/setFixed', { seatId, studentId: null }); onClose(); }}>
                🔓 {names.get(current.studentId)} 고정 해제
              </button>
            )}
            <input type="text" autoFocus placeholder="이름 또는 번호 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
            {list.map((s) => {
              const elsewhere = cls.seating.fixed.find((f) => f.studentId === s.id && f.seatId !== seatId);
              const away = awayLabel(s, today);
              const isHere = current?.studentId === s.id;
              return (
                <button key={s.id} className="opt" disabled={isHere} onClick={() => { act('seating/setFixed', { seatId, studentId: s.id }); onClose(); }}>
                  {s.number}. {names.get(s.id)} {isHere && '✓'}
                  {(elsewhere || away) && (
                    <div className="note">
                      {elsewhere && `${shortSeatLabel(elsewhere.seatId)}에 고정됨 — 고르면 이 자리로 옮김`} {away && `(${away})`}
                    </div>
                  )}
                </button>
              );
            })}
            <div style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <button className="btn sm" onClick={() => { act('seating/setFixed', { seatId, studentId: null }); act('seating/toggleSeat', { seatId }); onClose(); }}>
                이 자리 사용 안 함
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
