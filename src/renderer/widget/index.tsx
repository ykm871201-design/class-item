// 바탕화면 위젯 보드 (교사용 모니터)
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalEvent, FullState, WidgetCardId } from '../../shared/types';
import { ALLERGY_NAMES, REGIONS, airGrade, buildPeriods, dayStart, eventTimeLabel, eventsOn, mergedEvents, mondayOf, periodNow, weatherText } from '../../shared/widget';
import { BOARD_BACKGROUNDS, MEMO_COLORS } from '../../shared/defaults';
import { holidayName } from '../../shared/holidays';
import { WEEKDAY_KO, localDateKey, pad2 } from '../../shared/util';
import { useNow } from '../common/hooks';
import { FitText } from '../common/FitText';
import { StateCtx, act, api, dismissToast, toast, useAppState, useToasts } from '../teacher/api';

function App() {
  const [state, setState] = useState<FullState | null>(null);
  useEffect(() => {
    api().getState().then(setState);
    return api().onState(setState);
  }, []);
  if (!state) return null;
  return (
    <StateCtx.Provider value={state}>
      <Board />
      <Toasts />
    </StateCtx.Provider>
  );
}

function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

const openTeacher = (tab?: string) => api().app({ type: 'openTeacher', tab });

function Board() {
  const { data, runtime } = useAppState();
  const w = data.widget;
  const hidden = new Set(w.hiddenCards);
  const bg = BOARD_BACKGROUNDS.find((b) => b.id === w.background) ?? BOARD_BACKGROUNDS[0];
  const has = (id: WidgetCardId) => !hidden.has(id);
  const leftBottom = has('agenda') || has('memo');
  const right: WidgetCardId[] = (['clock', 'weather', 'meal', 'timetable', 'tools'] as WidgetCardId[]).filter(has);
  const showLeft = has('calendar') || leftBottom;
  return (
    <div className={`wb${w.glass ? ' glass' : ''}`} style={{ background: bg.css }} data-testid="widget-board">
      <div className="wb-top">
        <span className="wb-drag">교실 도구 · 바탕화면 보드</span>
        {runtime.update.status === 'available' && (
          <button className="wb-btn new" onClick={() => openTeacher('settings')}>
            새 버전 · 업데이트
          </button>
        )}
        <button className="wb-btn" title="학생 화면에 학생용 위젯(큰 시계·달력·날씨·급식·시간표) 띄우기" onClick={() => act('student/base', { base: 'widget', main: 'clock' }, '학생 화면에 학생용 위젯을 띄웠습니다.')}>
          📺 학생 위젯 띄우기
        </button>
        <button className="wb-btn" title="교사용 화면 열기" onClick={() => openTeacher()}>
          교사용 화면
        </button>
        <button className="wb-btn" title="위젯 설정" onClick={() => openTeacher('widget')} data-testid="wb-settings">
          ⚙
        </button>
        <button className="wb-btn" title="위젯 숨기기 (Ctrl+Alt+W로 다시 보기)" onClick={() => api().app({ type: 'widgetHide' })}>
          —
        </button>
      </div>
      <div className={`wb-grid${!showLeft ? ' no-left' : ''}${right.length === 0 ? ' no-right' : ''}`}>
        {showLeft && (
          <div className="wb-left">
            {has('calendar') && <CalendarCard />}
            {leftBottom && (
              <div className="wb-left-bottom">
                {has('agenda') && <AgendaCard />}
                {has('memo') && <MemoCard />}
              </div>
            )}
          </div>
        )}
        {right.length > 0 && (
          <div className="wb-right">
            {has('clock') && <ClockCard />}
            {has('weather') && <WeatherCard />}
            {has('meal') && <MealCard />}
            {has('timetable') && <TimetableCard />}
            {has('tools') && <ToolsCard />}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ id, title, extra, children, className }: { id: WidgetCardId; title: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`wc ${className ?? ''}`} data-card={id}>
      <header className="wc-head">
        <span className="wc-title">{title}</span>
        <span className="wc-extra">{extra}</span>
        <button className="wc-x" title="이 칸 끄기 (설정에서 다시 켬)" onClick={async () => {
          await act('widget/card', { id, hidden: true });
          toast('칸을 껐습니다. 위젯 설정(⚙)에서 다시 켤 수 있습니다.', 'info');
        }}>
          ×
        </button>
      </header>
      <div className="wc-body">{children}</div>
    </section>
  );
}

// ---------------- 달력 ----------------
function CalendarCard() {
  const { data, runtime } = useAppState();
  const w = data.widget;
  const now = useNow(60_000);
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [dayPop, setDayPop] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const first = new Date(ym.y, ym.m, 1);
  const gridStart = new Date(ym.y, ym.m, 1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const events = useMemo(() => mergedEvents(w, runtime.widget.googleEvents, cells[0].getTime(), cells[41].getTime() + 86400_000), [w, runtime.widget.googleEvents, ym.y, ym.m]);
  const today = localDateKey(now);
  const rows = cells[35].getMonth() !== ym.m ? 5 : 6;
  const errs = w.calendars.filter((c) => c.enabled && runtime.widget.calStatus[c.id] && !runtime.widget.calStatus[c.id].ok);
  const move = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));
  return (
    <Card
      id="calendar"
      title="달력"
      className="wc-cal"
      extra={
        <>
          <button className="wc-icon" title="새로 받기" onClick={() => api().app({ type: 'calendarRefresh' })}>
            ⟳
          </button>
        </>
      }
    >
      <div className="cal-nav">
        <button className="wc-icon" onClick={() => move(-1)} aria-label="이전 달">
          ‹
        </button>
        <b className="cal-month">
          {ym.y}년 {ym.m + 1}월
        </b>
        <button className="wc-icon" onClick={() => move(1)} aria-label="다음 달">
          ›
        </button>
        <span style={{ flex: 1 }} />
        <button className="wb-chip" onClick={() => setYm({ y: new Date().getFullYear(), m: new Date().getMonth() })}>
          오늘
        </button>
      </div>
      <div className="cal-grid" style={{ gridTemplateRows: `auto repeat(${rows}, 1fr)` }} data-testid="widget-calendar">
        {WEEKDAY_KO.map((d, i) => (
          <div key={d} className={`cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
            {d}
          </div>
        ))}
        {cells.slice(0, rows * 7).map((d) => {
          const key = localDateKey(d);
          const evs = eventsOn(events, key);
          const hol = w.holidays && holidayName(key);
          const out = d.getMonth() !== ym.m;
          const show = evs.slice(0, 3);
          return (
            <div
              key={key}
              className={`cal-cell${out ? ' out' : ''}${key === today ? ' today' : ''}${d.getDay() === 0 || hol ? ' sun' : d.getDay() === 6 ? ' sat' : ''}`}
              onDoubleClick={() => setAdding(key)}
              onClick={() => evs.length > 3 && setDayPop(key)}
              title="두 번 누르면 일정 추가"
              data-date={key}
            >
              <span className="cal-num">{d.getDate()}</span>
              {show.map((e) => (
                <div key={e.id} className={`cal-ev${e.calId === 'holiday' ? ' hol' : ''}`} style={{ borderLeftColor: e.color }} title={e.title}>
                  {!e.allDay && <span className="cal-ev-time">{eventTimeLabel(e)}</span>}
                  {e.title}
                </div>
              ))}
              {evs.length > 3 && <div className="cal-more" onClick={(ev) => { ev.stopPropagation(); setDayPop(key); }}>+{evs.length - 3}개 더</div>}
            </div>
          );
        })}
      </div>
      <div className="cal-foot">
        {w.calendars.length === 0 ? (
          <a href="#" onClick={(e) => { e.preventDefault(); openTeacher('widget'); }}>
            구글 캘린더 연결하기
          </a>
        ) : (
          <span className="small muted">
            {w.calendars.filter((c) => c.enabled).map((c) => (
              <span key={c.id} className="cal-legend">
                <span style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
            <span className="cal-legend">
              <span style={{ background: '#2b8a3e' }} />내 일정
            </span>
          </span>
        )}
        {errs.length > 0 && <span className="cal-err">⚠ {errs.map((c) => `${c.name}: ${runtime.widget.calStatus[c.id].error}`).join(' / ')}</span>}
        <span className="small muted" style={{ marginLeft: 'auto' }}>날짜를 두 번 누르면 일정 추가</span>
      </div>
      {dayPop && <DayPopover date={dayPop} events={eventsOn(events, dayPop)} onClose={() => setDayPop(null)} onAdd={() => { setAdding(dayPop); setDayPop(null); }} />}
      {adding && <AddEventDialog date={adding} onClose={() => setAdding(null)} />}
    </Card>
  );
}

function dateLabel(key: string) {
  const d = new Date(dayStart(key));
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}

function DayPopover({ date, events, onClose, onAdd }: { date: string; events: CalEvent[]; onClose: () => void; onAdd: () => void }) {
  return (
    <div className="wb-modal-back" onClick={onClose}>
      <div className="wb-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{dateLabel(date)}</h3>
        {events.map((e) => (
          <div key={e.id} className="day-ev">
            <span className="dot" style={{ background: e.color }} />
            <span className="t">{eventTimeLabel(e) ?? '하루 종일'}</span>
            <span style={{ flex: 1 }}>{e.title}</span>
            {e.calId === 'local' && (
              <button className="wc-icon" title="내 일정 지우기" onClick={() => act('widget/deleteEvent', { id: e.id })}>
                ✕
              </button>
            )}
          </div>
        ))}
        {events.length === 0 && <div className="muted">일정이 없습니다.</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={onAdd}>
            + 일정 추가
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEventDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const { data } = useAppState();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [d, setD] = useState(date);
  const [where, setWhere] = useState<'local' | 'google'>(data.widget.calendars.length ? 'google' : 'local');
  const save = async () => {
    if (!title.trim()) return toast('일정 내용을 입력해 주세요.', 'warn');
    if (where === 'local') {
      const r = await act('widget/addEvent', { title, date: d, time: time || undefined }, '내 일정에 넣었습니다.');
      if (r.ok) onClose();
    } else {
      await api().app({ type: 'googleAdd', title, date: d, time: time || undefined });
      toast('구글 캘린더 화면을 브라우저로 열었습니다. ‘저장’을 누르면 들어가고, 잠시 뒤 달력에도 보입니다.', 'info', 7000);
      onClose();
    }
  };
  return (
    <div className="wb-modal-back" onClick={onClose}>
      <div className="wb-modal" onClick={(e) => e.stopPropagation()} data-testid="add-event">
        <h3>일정 추가</h3>
        <div className="col">
          <input type="text" autoFocus placeholder="일정 내용 (예: 공문 제출)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <div className="row">
            <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="비우면 하루 종일" />
            <span className="small muted">시각을 비우면 하루 종일</span>
          </div>
          <div className="row">
            <span className="field-label">저장할 곳</span>
            <div className="seg">
              <button className={where === 'local' ? 'on' : ''} onClick={() => setWhere('local')}>
                내 일정 (이 PC)
              </button>
              <button className={where === 'google' ? 'on' : ''} onClick={() => setWhere('google')}>
                구글 캘린더 (브라우저에서 저장)
              </button>
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={save}>
            {where === 'local' ? '저장' : '구글 캘린더 열기'}
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 일정 정리 ----------------
function AgendaCard() {
  const { data, runtime } = useAppState();
  const w = data.widget;
  const now = useNow(60_000);
  const [text, setText] = useState('');
  const today = localDateKey(now);
  const mon = mondayOf(new Date(now));
  const from = mon.getTime();
  const events = useMemo(() => mergedEvents(w, runtime.widget.googleEvents, from, from + 7 * 86400_000 - 1), [w, runtime.widget.googleEvents, from]);
  const todos = w.todos.filter((t) => !t.done || t.doneDate === today);
  const days = Array.from({ length: 7 }, (_, i) => localDateKey(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
  return (
    <Card id="agenda" title="일정 정리 · 이번 주" className="wc-agenda">
      <div className="ag-list">
        {todos.map((t) => (
          <label key={t.id} className={`ag-row todo${t.done ? ' done' : ''}`}>
            <input type="checkbox" checked={t.done} onChange={() => act('widget/todoToggle', { id: t.id })} />
            <span className="ag-tag todo">할 일</span>
            <span className="ag-text">{t.text}</span>
            {t.date < today && !t.done && <span className="ag-badge">{Math.round((dayStart(today) - dayStart(t.date)) / 86400_000)}일째</span>}
            <button className="wc-icon ag-del" onClick={(e) => { e.preventDefault(); act('widget/todoDelete', { id: t.id }); }} title="지우기">
              ✕
            </button>
          </label>
        ))}
        {days.map((k) => {
          const evs = eventsOn(events, k);
          if (!evs.length) return null;
          const d = new Date(dayStart(k));
          return (
            <div key={k} className={`ag-day${k === today ? ' today' : ''}${k < today ? ' past' : ''}`}>
              <div className="ag-date">
                {k === today ? '오늘' : `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[d.getDay()]})`}
              </div>
              {evs.map((e) => (
                <div key={e.id} className="ag-row">
                  <span className="ag-dot" style={{ background: e.color }} />
                  {eventTimeLabel(e) && <span className="ag-time">{eventTimeLabel(e)}</span>}
                  <span className="ag-text">{e.title}</span>
                </div>
              ))}
            </div>
          );
        })}
        {todos.length === 0 && days.every((k) => !eventsOn(events, k).length) && <div className="muted small" style={{ padding: 8 }}>이번 주 일정과 할 일이 없습니다.</div>}
      </div>
      <input
        className="ag-input"
        type="text"
        placeholder="오늘 할 일 추가 (Enter)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && text.trim()) {
            await act('widget/todoAdd', { text });
            setText('');
          }
        }}
        data-testid="todo-input"
      />
    </Card>
  );
}

// ---------------- 메모 ----------------
function MemoCard() {
  const { data } = useAppState();
  return (
    <Card
      id="memo"
      title="메모"
      className="wc-memo"
      extra={
        <button className="wc-icon" title="새 메모" onClick={() => act('widget/memoAdd', { color: MEMO_COLORS[data.widget.memos.length % MEMO_COLORS.length] })}>
          +
        </button>
      }
    >
      <div className="memo-grid">
        {data.widget.memos.map((m) => (
          <Memo key={m.id} id={m.id} title={m.title} text={m.text} color={m.color} />
        ))}
        <button className="memo-new" onClick={() => act('widget/memoAdd', { color: MEMO_COLORS[data.widget.memos.length % MEMO_COLORS.length] })}>
          + 새 메모
        </button>
      </div>
    </Card>
  );
}

function Memo({ id, title, text, color }: { id: string; title: string; text: string; color: string }) {
  const [t, setT] = useState(text);
  const [h, setH] = useState(title);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<{ text?: string; title?: string }>({});
  const [menu, setMenu] = useState(false);
  useEffect(() => setT(text), [text]);
  useEffect(() => setH(title), [title]);
  // 제목과 본문을 번갈아 고쳐도 둘 다 저장되도록 바뀐 내용을 합쳐서 보냄
  const flush = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) act('widget/memoUpdate', { id, patch });
  };
  const save = (patch: { text?: string; title?: string }) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };
  useEffect(() => () => flush(), []); // 메모가 사라지거나 위젯이 닫힐 때 남은 변경 저장
  return (
    <div className="memo" style={{ background: color }}>
      <div className="memo-head">
        <input className="memo-title" placeholder="제목" value={h} onChange={(e) => { setH(e.target.value); save({ title: e.target.value }); }} onBlur={flush} />
        <button className="wc-icon" onClick={() => setMenu(!menu)} title="색·지우기">
          ⋯
        </button>
      </div>
      {menu && (
        <div className="memo-menu">
          {MEMO_COLORS.map((c) => (
            <button key={c} className="memo-color" style={{ background: c }} onClick={() => { act('widget/memoUpdate', { id, patch: { color: c } }); setMenu(false); }} />
          ))}
          <button className="btn sm danger" onClick={async () => { if (await api().confirm({ message: '이 메모를 지울까요?', ok: '지우기' })) act('widget/memoDelete', { id }); }}>
            지우기
          </button>
        </div>
      )}
      <textarea className="memo-text" value={t} placeholder="메모" onChange={(e) => { setT(e.target.value); save({ text: e.target.value }); }} onBlur={flush} />
    </div>
  );
}

// ---------------- 시계 · 교시 ----------------
function ClockCard() {
  const { data } = useAppState();
  const now = useNow(1000);
  const d = new Date(now);
  const p = periodNow(data.widget.periods, d);
  const dow = d.getDay();
  const remain = `${Math.floor(p.remainSec / 60)}분 ${pad2(p.remainSec % 60)}초 남음`;
  return (
    <Card id="clock" title={`${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY_KO[dow]}요일`} className="wc-clock">
      <div className="clk-row">
        <div className="clk-time">
          {pad2(d.getHours())}:{pad2(d.getMinutes())}
        </div>
        <div className="clk-period">
          <div className={`clk-now ${p.state}`}>{p.title}</div>
        </div>
      </div>
      {(p.state === 'class' || p.state === 'break' || p.state === 'lunch' || p.state === 'before') && (
        <>
          <div className="clk-bar">
            <div style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
          <div className="clk-sub">
            <span>{p.next ? `다음 ${p.next.label}` : p.sub}</span>
            <span>{remain}</span>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------- 날씨 ----------------
function WeatherCard() {
  const { data, runtime } = useAppState();
  const wx = runtime.widget.weather;
  const region = REGIONS.find((r) => r.id === data.widget.weatherRegion) ?? REGIONS[0];
  const air = airGrade(wx?.pm10, wx?.pm25);
  const wt = wx ? weatherText(wx.code) : null;
  return (
    <Card id="weather" title={`날씨 · ${region.name}`} className="wc-weather" extra={<button className="wc-icon" title="새로 받기" onClick={() => api().app({ type: 'weatherRefresh' })}>⟳</button>}>
      {wx ? (
        <>
          {air.text && <div className={`wx-air lv${air.level}`}>{air.text}</div>}
          <div className="wx-row">
            <span className="wx-icon">{wt!.icon}</span>
            <span className="wx-temp">{Math.round(wx.temp)}°</span>
            <span className="wx-text">{wt!.text}</span>
            <span className="wx-minmax">
              최고 {Math.round(wx.max)}° · 최저 {Math.round(wx.min)}°
              <br />
              강수확률 {wx.rainProb}%{wx.pm10 !== undefined ? ` · 미세 ${Math.round(wx.pm10)}` : ''}
              {wx.pm25 !== undefined ? ` · 초미세 ${Math.round(wx.pm25)}` : ''}
            </span>
          </div>
        </>
      ) : (
        <div className="muted small">{runtime.widget.weatherError ? `날씨를 받지 못했습니다 (${runtime.widget.weatherError})` : '날씨를 받는 중…'}</div>
      )}
    </Card>
  );
}

// ---------------- 급식 ----------------
function MealCard() {
  const { data, runtime } = useAppState();
  const [open, setOpen] = useState(false);
  const meal = runtime.widget.meal;
  const school = data.widget.school;
  const d = meal ? new Date(dayStart(meal.date)) : new Date();
  return (
    <Card
      id="meal"
      title={`급식 · ${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_KO[d.getDay()]})${school ? ` ${school.name}` : ''}`}
      className="wc-meal"
      extra={school && <button className="wc-icon" title="새로 받기" onClick={() => api().app({ type: 'mealRefresh' })}>⟳</button>}
    >
      {!school ? (
        <a href="#" onClick={(e) => { e.preventDefault(); openTeacher('widget'); }}>
          학교를 고르면 오늘 급식이 보입니다
        </a>
      ) : meal ? (
        meal.dishes.length ? (
          <div className="meal" onClick={() => setOpen(!open)} title="누르면 알레르기 정보">
            {open ? (
              meal.dishes.map((x, i) => (
                <div key={i}>
                  {x}
                  {meal.allergies[i] && <span className="muted small"> ({meal.allergies[i].split('.').filter(Boolean).map((n) => ALLERGY_NAMES[+n] ?? n).join(', ')})</span>}
                </div>
              ))
            ) : (
              <div className="meal-line">{meal.dishes.join(' · ')}</div>
            )}
          </div>
        ) : (
          <div className="muted small">{meal.note}</div>
        )
      ) : (
        <div className="muted small">{runtime.widget.mealError ? `급식을 받지 못했습니다 (${runtime.widget.mealError})` : '급식을 받는 중…'}</div>
      )}
    </Card>
  );
}

// ---------------- 시간표 ----------------
function TimetableCard() {
  const { data } = useAppState();
  const now = useNow(30_000);
  const d = new Date(now);
  const p = periodNow(data.widget.periods, d);
  const count = buildPeriods(data.widget.periods).filter((x) => x.kind === 'class').length;
  const [edit, setEdit] = useState<{ day: number; no: number } | null>(null);
  const today = d.getDay() - 1;
  return (
    <Card id="timetable" title="이번 주 시간표" className="wc-tt" extra={<span className="small muted">칸을 두 번 누르면 고치기</span>}>
      <table className="tt">
        <thead>
          <tr>
            <th />
            {['월', '화', '수', '목', '금'].map((x, i) => (
              <th key={x} className={i === today ? 'today' : ''}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: count }, (_, no) => (
            <tr key={no}>
              <th>{no + 1}</th>
              {[0, 1, 2, 3, 4].map((day) => {
                const v = data.widget.timetable[day]?.[no] ?? '';
                const cur = day === today && p.current?.kind === 'class' && p.current.no === no + 1;
                const editing = edit && edit.day === day && edit.no === no;
                return (
                  <td key={day} className={`${v ? 'filled' : ''}${cur ? ' cur' : ''}`} onDoubleClick={() => setEdit({ day, no })} data-tt={`${day}-${no}`}>
                    {editing ? (
                      <input
                        autoFocus
                        defaultValue={v}
                        onBlur={(e) => { act('widget/timetable', { day, period: no, value: e.target.value }); setEdit(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null); }}
                      />
                    ) : (
                      <FitText text={v} ratio={0.6} maxPx={14} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------- 수업 도구 ----------------
function ToolsCard() {
  const { data, runtime } = useAppState();
  const st = data.settings;
  const quick = (m: number) => act('timer/start', { durationSec: m * 60, activity: st.timerActivity, sound: st.timerSound, volume: st.timerVolume, mode: st.timerDisplayMode, warnFrom: st.timerWarnFrom, warnVolume: st.timerWarnVolume });
  const tools: { ico: string; label: string; run: () => void }[] = [
    { ico: '⏱️', label: '타이머', run: () => openTeacher('timer') },
    { ico: '1', label: '1분', run: () => quick(1) },
    { ico: '3', label: '3분', run: () => quick(3) },
    { ico: '5', label: '5분', run: () => quick(5) },
    { ico: '🎯', label: '뽑기', run: () => openTeacher('picker') },
    { ico: '🪑', label: '자리', run: () => openTeacher('seating') },
    { ico: '📝', label: '칠판', run: () => openTeacher('board') },
    { ico: '🕒', label: '학생 위젯', run: () => act('student/base', { base: 'widget', main: 'clock' }) },
    { ico: runtime.studentWindow.visible ? '🙈' : '📺', label: runtime.studentWindow.visible ? '학생 화면 숨기기' : '학생 화면 보이기', run: () => act(runtime.studentWindow.visible ? 'student/hide' : 'student/show') },
  ];
  return (
    <Card id="tools" title="수업 도구" className="wc-tools">
      <div className="tools">
        {tools.map((t) => (
          <button key={t.label} className="tool" onClick={t.run}>
            <span className="tool-ico">{t.ico}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
