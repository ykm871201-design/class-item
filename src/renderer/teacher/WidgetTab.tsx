import { useState } from 'react';
import type { StudentCardId, WidgetCardId } from '../../shared/types';
import { BOARD_BACKGROUNDS, CALENDAR_COLORS, STUDENT_CARDS, WIDGET_CARDS } from '../../shared/defaults';
import { REGIONS, SUBJECTS, buildPeriods, fromMin, parseTimetablePaste } from '../../shared/widget';
import { WEEKDAY_KO } from '../../shared/util';
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

      <StudentWidgetSettings />

      <CalendarSettings />

      <TimetableSettings />

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
        <span className="small muted">구글 캘린더와 내 일정은 교사용 위젯에만 보이고, 학생용 위젯에는 나오지 않습니다.</span>
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
      <div className="row">
        {num('중간놀이: ', 'playAfter', 0, 10, '교시 뒤')}
        {num('중간놀이 길이', 'playLen', 0, 60)}
        <span className="small muted">0교시 뒤 = 중간놀이 없음</span>
      </div>
      <div className="small" style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {slots.map((s, i) => (
          <span key={i} className={`pill${s.kind === 'lunch' ? ' g-f' : s.kind === 'play' ? ' g-m' : ''}`}>
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

function StudentWidgetSettings() {
  const { data, studentView } = useAppState();
  const w = data.widget;
  const [notice, setNotice] = useState(w.studentNotice);
  const on = studentView.base === 'widget';
  return (
    <div className="card">
      <h2>
        학생용 위젯 <span className="hint">학생 화면(TV)에 띄우는 위젯</span>
      </h2>
      <p className="small" style={{ marginTop: 0 }}>
        왼쪽 큰 칸에 평소에는 <b>큰 시계와 지금 교시</b>가 보이고, 타이머나 칠판을 띄우면 그 자리에 <b>타이머 / 칠판 / 칠판+타이머</b>가 대신 뜹니다. 오른쪽에는 달력(공휴일만, 구글 캘린더는 보이지 않음)·날씨·급식·이번 주 시간표, 아래에는 오늘 시간표와 알림장이 보입니다.
      </p>
      <div className="row">
        <button className="btn primary big" onClick={() => act('student/base', { base: 'widget', main: 'clock' }, '학생 화면에 학생용 위젯을 띄웠습니다.')} data-testid="student-widget-show">
          {on ? '학생 위젯 다시 띄우기 (시계)' : '학생 화면에 학생 위젯 띄우기'}
        </button>
        {on && (
          <button className="btn" onClick={() => act('student/widgetMain', { main: data.studentWidgetMain === 'board' ? 'clock' : 'board' })}>
            큰 칸을 {data.studentWidgetMain === 'board' ? '시계로' : '칠판으로'} 바꾸기
          </button>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }} data-testid="student-cards">
        <span className="field-label">보일 칸</span>
        <label className="inline" title="타이머·칠판이 뜨는 자리라 끌 수 없습니다">
          <input type="checkbox" checked disabled />큰 시계 (항상)
        </label>
        {STUDENT_CARDS.map((c) => (
          <label key={c.id} className="inline">
            <input type="checkbox" checked={!w.studentHiddenCards.includes(c.id)} onChange={(e) => act('widget/studentCard', { id: c.id as StudentCardId, hidden: !e.target.checked })} data-sw-check={c.id} />
            {c.name}
          </label>
        ))}
      </div>
      <p className="small muted" style={{ margin: '4px 0 0' }}>칸을 끄면 남은 칸이 빈자리를 채웁니다. 오른쪽 칸을 모두 끄면 큰 시계가 화면 너비 전체를 씁니다.</p>
      <div className="col" style={{ marginTop: 10 }}>
        <span className="field-label">알림장 (학생 위젯 아래쪽에 보임)</span>
        <textarea rows={3} value={notice} maxLength={1000} placeholder={'예: 내일 준비물 - 리코더, 색연필\n수요일 현장체험학습 동의서 제출'} onChange={(e) => setNotice(e.target.value)} onBlur={() => notice !== w.studentNotice && act('widget/update', { patch: { studentNotice: notice } }, '알림장을 저장했습니다.')} data-testid="student-notice" />
      </div>
    </div>
  );
}

function TimetableSettings() {
  const { data } = useAppState();
  const w = data.widget;
  const slots = buildPeriods(w.periods).filter((x) => x.kind === 'class');
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const today = new Date().getDay(); // 0=일
  const todayIdx = today >= 1 && today <= 5 ? today - 1 : -1;
  const filled = w.timetable.some((d) => d.some((x) => x));
  const applyPaste = async () => {
    const r = parseTimetablePaste(paste, w.periods.count);
    if (!r) return toast('붙여넣은 내용에서 시간표를 찾지 못했습니다.', 'err');
    if (filled && !(await api().confirm({ message: '지금 시간표를 붙여넣은 내용으로 바꿀까요?', detail: `${r.rows}교시까지 월~금 칸을 채웁니다.`, ok: '바꾸기' }))) return;
    await act('widget/timetableAll', { table: r.table }, `시간표를 채웠습니다 (${r.rows}교시까지).`);
    setPaste('');
    setShowPaste(false);
  };
  return (
    <div className="card" data-testid="timetable-settings">
      <h2>
        이번 주 시간표 <span className="hint">매주 같은 시간표 · 교시 수는 ‘교시 시각’ 설정을 따름</span>
      </h2>
      <datalist id="subject-list">
        {SUBJECTS.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <table className="tt-edit">
        <thead>
          <tr>
            <th style={{ width: 90 }} />
            {['월', '화', '수', '목', '금'].map((x, i) => (
              <th key={x} className={i === todayIdx ? 'today' : ''}>
                {x}
                {i === todayIdx && ' (오늘)'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((sl) => (
            <tr key={sl.no}>
              <th>
                {sl.no}교시
                <div className="small muted">{fromMin(sl.start)}</div>
              </th>
              {[0, 1, 2, 3, 4].map((d) => {
                const v = w.timetable[d]?.[sl.no - 1] ?? '';
                return (
                  <td key={d} className={d === todayIdx ? 'today' : ''}>
                    <input
                      key={`${d}-${sl.no}-${v}`}
                      type="text"
                      list="subject-list"
                      defaultValue={v}
                      maxLength={20}
                      placeholder="—"
                      onBlur={(e) => e.target.value !== v && act('widget/timetable', { day: d, period: sl.no - 1, value: e.target.value.trim() })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      data-ttset={`${d}-${sl.no - 1}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="field-label">오늘 시간표{todayIdx >= 0 ? ` (${WEEKDAY_KO[today]})` : ''}</span>
        {todayIdx < 0 ? (
          <span className="small muted">오늘은 주말입니다.</span>
        ) : (
          <span className="row" style={{ gap: 6 }} data-testid="today-preview">
            {slots.map((sl) => (
              <span key={sl.no} className="pill">
                {sl.no} {w.timetable[todayIdx]?.[sl.no - 1] || '—'}
              </span>
            ))}
          </span>
        )}
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        오늘 시간표는 이 표에서 오늘 요일 줄을 그대로 가져옵니다. 학생용 위젯의 ‘오늘 시간표’와 교사용·학생용 위젯의 ‘이번 주 시간표’에 바로 반영됩니다.
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setShowPaste(!showPaste)} data-testid="tt-paste-toggle">
          엑셀·한글에서 붙여넣기
        </button>
        <button
          className="btn danger"
          disabled={!filled}
          onClick={async () => {
            if (await api().confirm({ message: '시간표를 모두 지울까요?', ok: '모두 지우기' })) act('widget/timetableAll', { table: [[], [], [], [], []] }, '시간표를 지웠습니다.');
          }}
        >
          모두 지우기
        </button>
      </div>
      {showPaste && (
        <div className="col" style={{ marginTop: 8 }}>
          <span className="small muted">시간표 표를 복사해 붙여넣으세요. 한 줄이 한 교시, 칸이 월~금입니다. 맨 위 요일 줄과 맨 앞 교시 번호 칸은 있어도 됩니다.</span>
          <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'\t월\t화\t수\t목\t금\n1\t국어\t수학\t사회\t국어\t과학\n2\t수학\t국어\t체육\t음악\t영어'} data-testid="tt-paste" />
          <div className="row">
            <button className="btn primary" disabled={!paste.trim()} onClick={applyPaste} data-testid="tt-paste-apply">
              표에 채우기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
