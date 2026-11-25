import { useState } from 'react';
import type { WidgetCardId } from '../../shared/types';
import { BOARD_BACKGROUNDS, CALENDAR_COLORS, WIDGET_CARDS } from '../../shared/defaults';
import { REGIONS, buildPeriods, fromMin } from '../../shared/widget';
import { formatDateTimeKo } from '../../shared/util';
import { act, api, toast, useAppState } from './api';

export function WidgetTab() {
  const { data, runtime } = useAppState();
  const w = data.widget;
  const hidden = new Set(w.hiddenCards);
  const call = async (a: { type: string; [k: string]: any }, okText?: string) => {
    const r = await api().app(a);
    if (!r.ok && r.error) toast(r.error, 'err');
    else if (r.ok && okText) toast(okText, 'ok');
    return r;
  };
  const upd = (patch: Record<string, unknown>) => act('widget/update', { patch });

  return (
    <div>
      <h1 className="t-title">바탕화면 위젯</h1>
      <p className="t-sub">달력·일정·메모·교시 시계·날씨·급식·시간표를 바탕화면에 한 판으로 보여 줍니다. 위젯은 교사용 모니터에 뜨며, <b>Ctrl+Alt+W</b>로 언제든 보이고 숨길 수 있습니다.</p>

      <div className="card">
        <h2>위젯 창</h2>
        <div className="row">
          <button className="btn primary big" onClick={() => call({ type: 'widgetToggle' })} data-testid="widget-toggle">
            {runtime.widget.visible ? '위젯 숨기기' : '위젯 보이기'}
          </button>
          <button className="btn" onClick={() => call({ type: 'widgetReset' }, '위젯을 주 모니터 기본 자리로 옮겼습니다.')}>
            위치·크기 처음대로
          </button>
          <label className="inline">
            <input type="checkbox" checked={w.showOnStartup} onChange={(e) => upd({ showOnStartup: e.target.checked })} />
            앱을 켜면 위젯 자동 표시
          </label>
        </div>
        <div className="row">
          <span className="field-label">배경</span>
          {BOARD_BACKGROUNDS.map((b) => (
            <button key={b.id} className={`theme-btn`} style={{ background: b.css, outline: w.background === b.id ? '3px solid #1f6feb' : undefined, color: b.id === 'night' ? '#fff' : '#1d2430' }} onClick={() => upd({ background: b.id })}>
              {b.name}
            </button>
          ))}
          <label className="inline">
            <input type="checkbox" checked={w.glass} onChange={(e) => upd({ glass: e.target.checked })} />칸 바탕 반투명
          </label>
        </div>
        <div className="row">
          <span className="field-label">보일 칸</span>
          {WIDGET_CARDS.map((c) => (
            <label key={c.id} className="inline">
              <input type="checkbox" checked={!hidden.has(c.id)} onChange={(e) => act('widget/card', { id: c.id as WidgetCardId, hidden: !e.target.checked })} />
              {c.name}
            </label>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>위젯 위쪽 띠를 끌어 옮기고, 가장자리를 끌어 크기를 바꿉니다. 위치와 크기는 기억합니다.</p>
      </div>

      <CalendarSettings />

      <div className="grid2">
        <PeriodSettings />
        <div>
          <div className="card">
            <h2>날씨 지역</h2>
            <div className="row">
              <select value={w.weatherRegion} onChange={async (e) => { await upd({ weatherRegion: e.target.value }); call({ type: 'weatherRefresh' }); }} data-testid="weather-region">
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button className="btn sm" onClick={() => call({ type: 'weatherRefresh' })}>
                지금 받기
              </button>
              <span className="small muted">{runtime.widget.weather ? `받은 시각 ${formatDateTimeKo(runtime.widget.weather.fetchedAt)}` : runtime.widget.weatherError ?? ''}</span>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>날씨·미세먼지는 Open-Meteo(무료, 인증키 필요 없음)에서 30분마다 받습니다.</p>
          </div>
          <SchoolSettings />
        </div>
      </div>
    </div>
  );
}

function CalendarSettings() {
  const { data, runtime } = useAppState();
  const w = data.widget;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<{ id: string; url: string } | null>(null);
  const add = async () => {
    setBusy(true);
    const r = await api().app({ type: 'calendarAdd', name, url });
    setBusy(false);
    if (!r.ok) toast(r.error ?? '연결하지 못했습니다.', 'err', 9000);
    else {
      toast(`구글 캘린더를 연결했습니다. 일정 ${r.count}개를 받았습니다.`, 'ok');
      setName('');
      setUrl('');
    }
  };
  return (
    <div className="card">
      <h2>
        구글 캘린더 연결 <span className="hint">보기 · 추가는 브라우저에서</span>
      </h2>
      <details className="small" style={{ marginBottom: 10 }}>
        <summary>
          <b>iCal 비공개 주소 찾는 법</b> (처음 한 번만)
        </summary>
        <ol style={{ margin: '6px 0' }}>
          <li>PC 브라우저에서 구글 캘린더(calendar.google.com)를 엽니다.</li>
          <li>오른쪽 위 ⚙ → <b>설정</b> → 왼쪽 ‘내 캘린더의 설정’에서 연결할 캘린더를 누릅니다.</li>
          <li>아래로 내려 <b>캘린더 통합</b>의 <b>‘iCal 형식의 비공개 주소’</b> 오른쪽 복사 버튼을 누릅니다.</li>
          <li>여기 ‘iCal 주소’ 칸에 붙여넣고 <b>연결</b>을 누릅니다.</li>
        </ol>
        이 주소를 아는 사람은 일정을 볼 수 있으니 다른 곳에 공유하지 마세요. 주소는 이 PC의 Windows 계정으로 암호화해 저장합니다. 일정은 15분마다 새로 받으며, 구글에서 바꾼 내용은 몇 분~몇 시간 늦게 반영될 수 있습니다(구글이 iCal을 늦게 갱신).
      </details>
      <div className="row">
        <input type="text" placeholder="이름 (예: 학교 일정)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 180 }} />
        <input type="text" placeholder="iCal 형식의 비공개 주소 (https://calendar.google.com/calendar/ical/…/basic.ics)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 260 }} data-testid="ical-url" />
        <button className="btn primary" disabled={!url.trim() || busy} onClick={add} data-testid="ical-add">
          {busy ? '연결 중…' : '연결'}
        </button>
      </div>
      <table className="list" style={{ marginTop: 10 }} data-testid="calendar-list">
        <thead>
          <tr>
            <th>캘린더</th>
            <th style={{ width: 70 }}>보기</th>
            <th style={{ width: 110 }}>학생 화면</th>
            <th>상태</th>
            <th style={{ width: 150 }} />
          </tr>
        </thead>
        <tbody>
          {w.calendars.map((c) => {
            const st = runtime.widget.calStatus[c.id];
            return (
              <tr key={c.id}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <select value={c.color} onChange={(e) => act('widget/calendarUpdate', { id: c.id, patch: { color: e.target.value } })} style={{ background: c.color, color: '#fff', width: 44 }} title="색">
                      {CALENDAR_COLORS.map((x) => (
                        <option key={x} value={x} style={{ background: x }}>
                          ■
                        </option>
                      ))}
                    </select>
                    <input type="text" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && act('widget/calendarUpdate', { id: c.id, patch: { name: e.target.value } })} style={{ width: 150 }} />
                  </div>
                </td>
                <td>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => act('widget/calendarUpdate', { id: c.id, patch: { enabled: e.target.checked } })} />
                </td>
                <td>
                  <label className="inline small">
                    <input type="checkbox" checked={c.showOnStudent} onChange={(e) => act('widget/calendarUpdate', { id: c.id, patch: { showOnStudent: e.target.checked } })} />
                    보이기
                  </label>
                </td>
                <td className="small">
                  {st ? (st.ok ? <span style={{ color: 'var(--ok)' }}>일정 {st.count}개 · {formatDateTimeKo(st.fetchedAt!)}</span> : <span style={{ color: 'var(--danger)' }}>{st.error}</span>) : <span className="muted">받는 중…</span>}
                </td>
                <td>
                  <button className="btn sm" onClick={() => setReplace({ id: c.id, url: '' })}>
                    주소 바꾸기
                  </button>{' '}
                  <button
                    className="btn sm danger"
                    onClick={async () => {
                      if (await api().confirm({ message: `‘${c.name}’ 캘린더 연결을 끊을까요?`, detail: '구글 캘린더의 일정은 그대로이며, 이 앱에서만 보이지 않게 됩니다.', ok: '연결 끊기' })) act('widget/calendarDelete', { id: c.id });
                    }}
                  >
                    끊기
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#2b8a3e', borderRadius: 3, marginRight: 6 }} />내 일정 (이 PC)
            </td>
            <td>항상</td>
            <td>
              <label className="inline small">
                <input type="checkbox" checked={w.localShowOnStudent} onChange={(e) => act('widget/update', { patch: { localShowOnStudent: e.target.checked } })} />
                보이기
              </label>
            </td>
            <td className="small muted">위젯 달력에서 날짜를 두 번 눌러 추가 · {w.localEvents.length}개</td>
            <td />
          </tr>
          <tr>
            <td>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#e03131', borderRadius: 3, marginRight: 6 }} />대한민국 공휴일
            </td>
            <td>
              <input type="checkbox" checked={w.holidays} onChange={(e) => act('widget/update', { patch: { holidays: e.target.checked } })} />
            </td>
            <td>
              <label className="inline small">
                <input type="checkbox" checked={w.holidaysOnStudent} onChange={(e) => act('widget/update', { patch: { holidaysOnStudent: e.target.checked } })} />
                보이기
              </label>
            </td>
            <td className="small muted">대체공휴일 포함 (2025~2030년)</td>
            <td />
          </tr>
        </tbody>
      </table>
      {replace && (
        <div className="row" style={{ marginTop: 8 }}>
          <input type="text" autoFocus placeholder="새 iCal 비공개 주소" value={replace.url} onChange={(e) => setReplace({ ...replace, url: e.target.value })} style={{ flex: 1 }} />
          <button
            className="btn primary"
            onClick={async () => {
              const r = await api().app({ type: 'calendarUrl', id: replace.id, url: replace.url });
              if (r.ok) {
                toast('주소를 바꿨습니다.', 'ok');
                setReplace(null);
              } else toast(r.error ?? '바꾸지 못했습니다.', 'err');
            }}
          >
            저장
          </button>
          <button className="btn" onClick={() => setReplace(null)}>
            취소
          </button>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => api().app({ type: 'calendarRefresh' })}>
          지금 새로 받기
        </button>
        <button className="btn primary" onClick={() => act('student/base', { base: 'agenda' }, '학생 화면에 이번 주 일정을 띄웠습니다.')} data-testid="agenda-to-student">
          학생 화면에 이번 주 일정 띄우기
        </button>
        <span className="small muted">‘학생 화면’에 체크한 캘린더만 학생에게 보입니다. 개인 일정은 체크하지 마세요.</span>
      </div>
    </div>
  );
}

function PeriodSettings() {
  const { data } = useAppState();
  const p = data.widget.periods;
  const set = (patch: Record<string, unknown>) => act('widget/update', { patch: { periods: patch } });
  const slots = buildPeriods(p);
  const num = (label: string, key: keyof typeof p, min: number, max: number, unit = '분') => (
    <label className="inline small">
      {label}
      <input type="number" min={min} max={max} value={p[key] as number} onChange={(e) => set({ [key]: Number(e.target.value) })} style={{ width: 64 }} />
      {unit}
    </label>
  );
  return (
    <div className="card">
      <h2>교시 시각</h2>
      <div className="row">
        <label className="inline small">
          1교시 시작
          <input type="time" value={p.firstStart} onChange={(e) => set({ firstStart: e.target.value })} />
        </label>
        {num('수업', 'length', 10, 120)}
        {num('쉬는 시간', 'breakLen', 0, 60)}
      </div>
      <div className="row">
        {num('교시 수', 'count', 1, 10, '교시')}
        {num('점심: ', 'lunchAfter', 0, 10, '교시 뒤')}
        {num('점심 길이', 'lunchLen', 0, 120)}
      </div>
      <div className="small" style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {slots.map((s, i) => (
          <span key={i} className={`pill${s.kind === 'lunch' ? ' g-f' : ''}`}>
            {s.label} {fromMin(s.start)}~{fromMin(s.end)}
          </span>
        ))}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>시간표의 과목은 위젯의 ‘이번 주 시간표’ 칸을 두 번 눌러 적습니다.</p>
    </div>
  );
}

function SchoolSettings() {
  const { data, runtime } = useAppState();
  const [q, setQ] = useState('');
  const [list, setList] = useState<{ office: string; code: string; name: string; addr: string; kind: string }[] | null>(null);
  const school = data.widget.school;
  return (
    <div className="card">
      <h2>
        학교 (급식) <span className="hint">나이스 교육정보 개방 포털 · 인증키 필요 없음</span>
      </h2>
      {school && (
        <div className="row">
          <b>{school.name}</b>
          <span className="small muted">{runtime.widget.meal ? `오늘 급식 ${runtime.widget.meal.dishes.length}가지` : runtime.widget.mealError ?? ''}</span>
          <button className="btn sm" onClick={() => api().app({ type: 'mealRefresh' })}>
            지금 받기
          </button>
          <button className="btn sm danger" onClick={() => api().app({ type: 'schoolSet', school: null })}>
            해제
          </button>
        </div>
      )}
      <div className="row">
        <input type="text" placeholder="학교 이름 (예: 서울초등학교)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={async (e) => {
          if (e.key === 'Enter') {
            const r = await api().app({ type: 'schoolSearch', name: q });
            if (r.ok) setList(r.schools);
            else toast(r.error ?? '찾지 못했습니다.', 'err');
          }
        }} data-testid="school-q" />
        <button
          className="btn"
          onClick={async () => {
            const r = await api().app({ type: 'schoolSearch', name: q });
            if (r.ok) setList(r.schools);
            else toast(r.error ?? '찾지 못했습니다.', 'err');
          }}
          data-testid="school-search"
        >
          찾기
        </button>
      </div>
      {list && (
        <table className="list" style={{ marginTop: 6 }}>
          <tbody>
            {list.map((s) => (
              <tr key={s.office + s.code}>
                <td>
                  <b>{s.name}</b> <span className="small muted">{s.kind} · {s.addr}</span>
                </td>
                <td style={{ width: 70 }}>
                  <button className="btn sm primary" onClick={async () => { await api().app({ type: 'schoolSet', school: s }); setList(null); toast(`${s.name}을(를) 골랐습니다.`, 'ok'); }} data-testid="school-pick">
                    고르기
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="muted">찾은 학교가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
