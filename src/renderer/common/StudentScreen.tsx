// 학생 화면 렌더링 (학생 창과 교사용 미리보기가 같은 코드를 사용)
// 입력은 StudentView 뿐이며, 고정 자리 등 교사용 정보는 애초에 전달되지 않는다.
import { useEffect, useMemo, useState } from 'react';
import type { StudentBoardView, StudentElectionView, StudentPickerView, StudentSeatingView, StudentTimerView, StudentView, StudentWidgetView } from '../../shared/types';
import { BOARD_BACKGROUNDS } from '../../shared/defaults';
import { koreanHolidays } from '../../shared/holidays';
import { REGIONS, airGrade, buildPeriods, periodNow, weatherText } from '../../shared/widget';
import { WEEKDAY_KO, localDateKey, pad2 } from '../../shared/util';
import { formatClock } from '../../shared/util';
import { fitFontPx, fitLShape, widestAt100 } from './fit';
import { FitText } from './FitText';
import { useNow, useSize, useFontsReady } from './hooks';

const LINE_HEIGHT = 1.3;
const SEAT_SHUFFLE_MS = 2000;
const PICK_SHUFFLE_MS = 1800;

export function StudentScreen({ view }: { view: StudentView }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const fontsReady = useFontsReady();
  const t = view.timer;
  let content: React.ReactNode;
  // 학생용 위젯: 타이머·칠판은 위젯의 큰 시계 자리에 뜬다
  if (view.base === 'widget' && view.widget) content = <StudentWidget view={view} w={view.widget} />;
  else if (t && t.mode === 'full') content = <TimerPanel timer={t} variant="full" />;
  else if (t && t.mode === 'split') content = <SplitView board={view.board} timer={t} size={size} />;
  else if (view.base === 'board') content = <BoardArea board={view.board} w={size.w} h={size.h} refH={size.h} />;
  else if (view.base === 'seating' && view.seating) content = <SeatingBoard s={view.seating} />;
  else if (view.base === 'picker' && view.picker) content = <PickerBoard p={view.picker} />;
  else if (view.base === 'election' && view.election) content = <ElectionBoard e={view.election} />;
  else content = <div className="st-blank" />;
  return (
    <div className="st-root" ref={ref} data-fonts={fontsReady ? '1' : '0'} data-base={view.base} data-timer={t ? t.mode : 'none'}>
      {size.w > 0 && content}
    </div>
  );
}

// ---------------- 칠판 ----------------
function BoardArea({ board, w, h, refH }: { board: StudentBoardView; w: number; h: number; refH: number }) {
  const pad = Math.round(Math.min(w, h) * 0.06);
  const innerW = Math.max(0, w - pad * 2);
  const innerH = Math.max(0, h - pad * 2);
  const px = useMemo(() => boardFontPx(board, innerW, innerH, refH), [board, innerW, innerH, refH]);
  return (
    <div className="st-board" style={{ background: board.bg, color: board.color, padding: pad, width: w, height: h }}>
      <div
        className="st-board-text"
        data-testid="board-text"
        data-valign={board.vAlign ?? 'middle'}
        style={{ fontSize: px, fontWeight: board.bold ? 800 : 500, textAlign: board.align, lineHeight: LINE_HEIGHT, justifyContent: board.align === 'center' ? 'center' : 'flex-start', alignItems: board.vAlign === 'top' ? 'flex-start' : board.vAlign === 'bottom' ? 'flex-end' : 'center' }}
      >
        <span style={{ width: '100%' }}>{board.text}</span>
      </div>
    </div>
  );
}

/** 지정 크기(화면 높이 대비 %) 이하에서, 영역 안에 다 들어가는 가장 큰 크기. 자동 맞춤이면 영역을 가득 채운다 */
export function boardFontPx(board: StudentBoardView, innerW: number, innerH: number, refH: number): number {
  if (!board.text.trim()) return 16;
  const max = board.autoFit ? refH * 0.4 : (refH * board.fontSize) / 100;
  return fitFontPx(board.text, innerW, innerH, max, { bold: board.bold, align: board.align, lineHeight: LINE_HEIGHT });
}

// ---------------- 칠판 + 타이머 함께 보기 ----------------
// 오른쪽 아래 1/4(가로 50% × 세로 50%)은 타이머 전용.
// 칠판 문구는 나머지 ㄱ자 영역 전체를 쓴다: 위쪽 줄은 화면 전체 너비, 타이머 옆 줄은 왼쪽 절반 너비.
// 글자가 타이머를 가리지 않고, 남는 오른쪽 위 공간도 비지 않는다.
function SplitView({ board, timer, size }: { board: StudentBoardView; timer: StudentTimerView; size: { w: number; h: number } }) {
  const { w, h } = size;
  return (
    <div className="st-split" style={{ background: board.bg }}>
      <div className="st-split-board" style={{ width: w, height: h }} data-testid="split-board" data-layout="l-shape">
        <LBoardArea board={board} w={w} h={h} cutW={w / 2} cutH={h / 2} />
      </div>
      <div className="st-split-timer" style={{ width: w / 2, height: h / 2 }} data-testid="split-timer">
        <TimerPanel timer={timer} variant="split" />
      </div>
    </div>
  );
}

/** 오른쪽 아래(cutW×cutH)를 비워 둔 칠판 */
function LBoardArea({ board, w, h, cutW, cutH }: { board: StudentBoardView; w: number; h: number; cutW: number; cutH: number }) {
  const pad = Math.round(Math.min(w, h) * 0.05);
  const gap = Math.round(Math.min(w, h) * 0.02); // 타이머와 글 사이 여백
  const innerW = Math.max(0, w - pad * 2);
  const innerH = Math.max(0, h - pad * 2);
  const cw = Math.min(innerW, cutW - pad + gap);
  const ch = Math.min(innerH, cutH - pad + gap);
  const fit = useMemo(() => {
    if (!board.text.trim()) return { px: 16, offset: 0 };
    const max = board.autoFit ? h * 0.4 : (h * board.fontSize) / 100;
    return fitLShape(board.text, { width: innerW, height: innerH, cutW: cw, cutH: ch }, max, { bold: board.bold, align: board.align, lineHeight: LINE_HEIGHT }, board.vAlign ?? 'middle');
  }, [board, innerW, innerH, cw, ch, h]);
  return (
    <div className="st-board" style={{ background: board.bg, color: board.color, padding: pad, width: w, height: h }}>
      <div className="st-lbox" style={{ width: innerW, height: innerH }}>
        <div style={{ float: 'right', width: 0, height: Math.max(0, innerH - ch) }} />
        <div style={{ float: 'right', clear: 'right', width: cw, height: ch }} data-testid="board-cut" />
        <div style={{ height: fit.offset }} />
        <div
          className="st-lbox-text"
          data-testid="board-text"
          data-valign={board.vAlign ?? 'middle'}
          style={{ fontSize: fit.px, fontWeight: board.bold ? 800 : 500, textAlign: board.align, lineHeight: LINE_HEIGHT }}
        >
          {board.text}
        </div>
      </div>
    </div>
  );
}

// ---------------- 타이머 ----------------
export function TimerPanel({ timer, variant }: { timer: StudentTimerView; variant: 'full' | 'split' }) {
  const now = useNow(100, timer.status === 'running');
  const remaining = timer.status === 'running' ? Math.max(0, timer.endAt - now) : timer.status === 'finished' ? 0 : timer.remainingMs;
  const finished = timer.status === 'finished' || (timer.status === 'running' && remaining <= 0);
  const ratio = timer.durationMs > 0 ? remaining / timer.durationMs : 0;
  const tone = finished ? 'done' : ratio <= 0.1 ? 'low' : ratio <= 0.25 ? 'mid' : 'ok';
  return (
    <div className={`st-timer st-timer-${variant} tone-${tone}${finished ? ' finished' : ''}`} data-testid="timer-panel" data-status={finished ? 'finished' : timer.status}>
      <div className="st-timer-activity">{timer.activity || (finished ? '' : ' ')}</div>
      <div className="st-timer-digits" data-testid="timer-digits">
        {formatClock(remaining)}
      </div>
      {finished ? (
        <div className="st-timer-done">시간이 끝났어요!</div>
      ) : (
        <div className="st-timer-bar">
          <div className="st-timer-bar-fill" style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
        </div>
      )}
      {timer.status === 'paused' && <div className="st-timer-paused">일시정지</div>}
    </div>
  );
}

// ---------------- 자리 배치 ----------------
/** 열 간격 목록으로 CSS 그리드 열 구성 (자리 1, 간격 비율) */
export function seatGridTemplate(cols: number, gaps: number[]) {
  const tracks: number[] = [];
  const seatTrack: number[] = [];
  for (let c = 0; c < cols; c++) {
    if (c > 0) tracks.push(gaps[c - 1] ?? 0.22);
    seatTrack.push(tracks.length);
    tracks.push(1);
  }
  return { template: tracks.map((t) => `${t}fr`).join(' '), seatTrack, total: tracks.reduce((a, b) => a + b, 0) };
}

function SeatingBoard({ s }: { s: StudentSeatingView }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const elapsed = Date.now() - s.startedAt;
  const shuffling = s.animate && elapsed < SEAT_SHUFFLE_MS;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!shuffling) return;
    const id = setInterval(() => setTick((x) => x + 1), 90);
    return () => clearInterval(id);
  }, [shuffling, s.revealId]);
  const grid = seatGridTemplate(s.cols, s.gaps);
  const rowGap = 0.18;
  const cellW = size.w > 0 ? size.w / grid.total : 0;
  const cellH = size.h > 0 ? size.h / (s.rows + rowGap * (s.rows - 1)) : 0;
  // 모든 자리에 같은 글자 크기: 가장 긴 이름이 자리 안에 잘리지 않게
  const widest = useMemo(() => widestAt100(s.seats.map((x) => x.name ?? '')), [s.seats]);
  const fontPx = Math.max(10, Math.min(cellH * 0.4, (cellW * 0.86 * 100) / widest));
  const pool = s.shuffleNames.length ? s.shuffleNames : [''];
  return (
    <div className="st-seating">
      <div className="st-front">
        <span className="st-front-side">◀ 왼쪽</span>
        <span className="st-front-label">칠판 (교실 앞)</span>
        <span className="st-front-side">오른쪽 ▶</span>
      </div>
      <div className="st-seat-area" ref={ref}>
        <div className="st-seat-grid" style={{ gridTemplateColumns: grid.template, gridTemplateRows: `repeat(${s.rows}, 1fr)`, rowGap: cellH * rowGap }}>
          {s.seats.map((seat, i) => {
            const col = grid.seatTrack[seat.c] + 1;
            const style = { gridColumn: col, gridRow: seat.r + 1, fontSize: fontPx };
            if (seat.disabled) return <div key={i} className="st-seat st-seat-off" style={style} />;
            const shown = shuffling && seat.name ? pool[(i * 7 + tick * 13 + ((tick * i) % 5)) % pool.length] : seat.name;
            return (
              <div key={`${s.revealId}-${i}-${shuffling ? 's' : 'r'}`} className={`st-seat${seat.name ? '' : ' st-seat-empty'}${shuffling ? ' shuffling' : s.animate ? ' reveal' : ''}`} style={style} data-testid="seat">
                <span>{shown ?? ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- 발표자 ----------------
function PickerBoard({ p }: { p: StudentPickerView }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const elapsed = Date.now() - p.startedAt;
  const shuffling = p.animate && elapsed < PICK_SHUFFLE_MS;
  const [tick, setTick] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (!shuffling) return;
    const id = setInterval(() => setTick((x) => x + 1), 80);
    const done = setTimeout(() => force((x) => x + 1), PICK_SHUFFLE_MS - elapsed + 20);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [shuffling, p.revealId]);
  const n = p.names.length;
  const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : n <= 20 ? 5 : 6;
  const rows = Math.ceil(n / cols);
  const cellW = size.w / cols;
  const cellH = size.h / Math.max(1, rows);
  const widest = useMemo(() => widestAt100([...p.names, ...p.shuffleNames]), [p.names, p.shuffleNames]);
  const fontPx = Math.max(12, Math.min(cellH * (n === 1 ? 0.6 : 0.42), (cellW * 0.84 * 100) / widest));
  const pool = p.shuffleNames.length ? p.shuffleNames : p.names;
  return (
    <div className="st-picker">
      <div className="st-picker-title">발표할 사람</div>
      <div className="st-picker-area" ref={ref}>
        <div className="st-picker-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {p.names.map((name, i) => (
            <div key={`${p.revealId}-${i}-${shuffling ? 's' : 'r'}`} className={`st-pick${shuffling ? ' shuffling' : p.animate ? ' reveal' : ''}`} style={{ fontSize: fontPx }} data-testid="pick-name">
              <span>{shuffling ? pool[(tick * 7 + i * 5) % pool.length] : name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 교사용 미리보기: 실제 학생 화면 크기(기본 1920×1080)로 그린 뒤 축소해서 보여 준다.
 * 작은 크기에서 직접 그리면 글자 맞춤·배치 계산이 달라질 수 있어, 실제 화면과 똑같은 모습을 보장하기 위함.
 */
export function ScaledStudentScreen({ view, refW = 1920, refH = 1080 }: { view: StudentView; refW?: number; refH?: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const k = size.w > 0 ? size.w / refW : 0;
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {k > 0 && (
        <div style={{ position: 'absolute', left: 0, top: 0, width: refW, height: refH, transform: `scale(${k})`, transformOrigin: '0 0' }}>
          <StudentScreen view={view} />
        </div>
      )}
    </div>
  );
}

// ---------------- 학생용 위젯 ----------------
// 교사용 위젯과 비슷한 배치: 왼쪽 큰 칸(평소 시계, 타이머·칠판을 띄우면 그것), 오른쪽에 달력·날씨·급식·시간표.
// 구글 캘린더·개인 일정·메모는 받지도 보여 주지도 않는다 (달력은 공휴일만).
function StudentWidget({ view, w }: { view: StudentView; w: StudentWidgetView }) {
  const now = useNow(1000);
  const bg = BOARD_BACKGROUNDS.find((b) => b.id === w.background) ?? BOARD_BACKGROUNDS[0];
  const t = view.timer;
  const mainKind = t ? (t.mode === 'split' ? 'split' : 'timer') : w.main === 'board' ? 'board' : 'clock';
  const on = (id: string) => !(w.hidden ?? []).includes(id as never);
  const bottom = on('today') || on('notice');
  const right = on('calendar') || on('weather') || on('meal') || on('week');
  return (
    <div className={`sw${w.glass ? ' glass' : ''}${right ? '' : ' no-right'}`} style={{ background: bg.css }} data-testid="student-widget" data-main={mainKind}>
      <div className="sw-left">
        <section className="sw-card sw-main">
          <MainArea kind={mainKind} view={view} w={w} now={now} />
        </section>
        {bottom && (
          <div className={`sw-bottom${on('today') && on('notice') ? '' : ' single'}`}>
            {on('today') && (
              <section className="sw-card" data-sw-card="today">
                <div className="sw-head">오늘 시간표</div>
                <TodayTimetable w={w} now={now} />
              </section>
            )}
            {on('notice') && (
              <section className="sw-card sw-notice" data-sw-card="notice">
                <div className="sw-head">알림장</div>
                <div className="sw-notice-text" data-testid="sw-notice">{w.notice || '오늘도 즐거운 하루!'}</div>
              </section>
            )}
          </div>
        )}
      </div>
      {right && (
        <div className="sw-right">
          {on('calendar') && (
            <section className="sw-card" data-sw-card="calendar">
              <MiniCalendar now={now} holidays={w.holidays} />
            </section>
          )}
          {on('weather') && (
            <section className="sw-card" data-sw-card="weather">
              <StudentWeather w={w} />
            </section>
          )}
          {on('meal') && (
            <section className="sw-card" data-sw-card="meal">
              <div className="sw-head">오늘 급식</div>
              <div className="sw-meal" data-testid="sw-meal">{w.meal?.dishes.length ? w.meal.dishes.join(' · ') : w.meal?.note ?? '—'}</div>
            </section>
          )}
          {on('week') && (
            <section className="sw-card sw-week" data-sw-card="week">
              <div className="sw-head">이번 주 시간표</div>
              <WeekTimetable w={w} now={now} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MainArea({ kind, view, w, now }: { kind: 'clock' | 'board' | 'timer' | 'split'; view: StudentView; w: StudentWidgetView; now: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <div className="sw-main-inner" ref={ref} data-testid="sw-main">
      {size.w > 0 &&
        (kind === 'timer' ? (
          <TimerPanel timer={view.timer!} variant="full" />
        ) : kind === 'split' ? (
          <SplitView board={view.board} timer={view.timer!} size={size} />
        ) : kind === 'board' ? (
          <BoardArea board={view.board} w={size.w} h={size.h} refH={size.h} />
        ) : (
          <BigClock w={w} now={now} />
        ))}
    </div>
  );
}

function BigClock({ w, now }: { w: StudentWidgetView; now: number }) {
  const d = new Date(now);
  const p = periodNow(w.periods, d);
  const dow = d.getDay();
  const showBar = p.state === 'class' || p.state === 'break' || p.state === 'lunch' || p.state === 'play' || p.state === 'before';
  const min = Math.ceil(p.remainSec / 60);
  return (
    <div className="sw-clock" data-testid="sw-clock">
      <div className="sw-clock-date">
        {d.getMonth() + 1}월 {d.getDate()}일 {WEEKDAY_KO[dow]}요일
      </div>
      <div className="sw-clock-time">
        {pad2(d.getHours())}:{pad2(d.getMinutes())}
      </div>
      <div className={`sw-clock-period ${p.state}`}>{p.title}</div>
      {showBar && (
        <>
          <div className="sw-clock-bar">
            <div style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
          <div className="sw-clock-sub">
            <span>{p.next ? `다음: ${p.next.label}` : p.sub}</span>
            <span>{min}분 남음</span>
          </div>
        </>
      )}
    </div>
  );
}

function TodayTimetable({ w, now }: { w: StudentWidgetView; now: number }) {
  const d = new Date(now);
  const dow = d.getDay();
  const p = periodNow(w.periods, d);
  const slots = buildPeriods(w.periods).filter((x) => x.kind === 'class');
  if (dow === 0 || dow === 6) return <div className="sw-muted">주말입니다</div>;
  return (
    <div className="sw-today">
      {slots.map((s) => (
        <div key={s.no} className={`sw-today-item${p.current?.kind === 'class' && p.current.no === s.no ? ' cur' : ''}`}>
          <span className="no">{s.no}</span>
          <FitText className="subj" text={w.timetable[dow - 1]?.[s.no - 1] || '—'} ratio={0.62} />
        </div>
      ))}
    </div>
  );
}

function WeekTimetable({ w, now }: { w: StudentWidgetView; now: number }) {
  const d = new Date(now);
  const today = d.getDay() - 1;
  const p = periodNow(w.periods, d);
  const count = w.periods.count;
  return (
    <table className="sw-tt">
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
            {[0, 1, 2, 3, 4].map((day) => (
              <td key={day} className={`${w.timetable[day]?.[no] ? 'filled' : ''}${day === today && p.current?.kind === 'class' && p.current.no === no + 1 ? ' cur' : ''}`}>
                <FitText text={w.timetable[day]?.[no] ?? ''} ratio={0.62} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MiniCalendar({ now, holidays }: { now: number; holidays: boolean }) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const hol = holidays ? koreanHolidays(y) : new Map<string, string>();
  const today = localDateKey(d);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const rows = days[35].getMonth() !== m ? 5 : 6;
  const holidayText = [...hol].filter(([k]) => k.startsWith(`${y}-${pad2(m + 1)}`)).map(([k, n]) => `${Number(k.slice(8))}일 ${n}`);
  return (
    <div className="sw-cal" data-testid="sw-calendar">
      <div className="sw-head">
        {y}년 {m + 1}월
      </div>
      <div className="sw-cal-grid">
        {WEEKDAY_KO.map((x, i) => (
          <div key={x} className={`dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
            {x}
          </div>
        ))}
        {days.slice(0, rows * 7).map((x) => {
          const k = localDateKey(x);
          return (
            <div key={k} className={`day${x.getMonth() !== m ? ' out' : ''}${x.getDay() === 0 || hol.has(k) ? ' sun' : x.getDay() === 6 ? ' sat' : ''}${k === today ? ' today' : ''}`} title={hol.get(k) ?? ''}>
              {x.getDate()}
            </div>
          );
        })}
      </div>
      {holidayText.length > 0 && <div className="sw-cal-hol">{holidayText.join(' · ')}</div>}
    </div>
  );
}

function StudentWeather({ w }: { w: StudentWidgetView }) {
  const wx = w.weather;
  const region = REGIONS.find((r) => r.id === w.weatherRegion) ?? REGIONS[0];
  if (!wx)
    return (
      <>
        <div className="sw-head">날씨 · {region.name}</div>
        <div className="sw-muted">—</div>
      </>
    );
  const t = weatherText(wx.code);
  const air = airGrade(wx.pm10, wx.pm25);
  return (
    <>
      <div className="sw-head">날씨 · {region.name}</div>
      <div className="sw-wx">
        <span className="ico">{t.icon}</span>
        <span className="temp">{Math.round(wx.temp)}°</span>
        <span className="txt">
          {t.text}
          <br />
          <small>
            {Math.round(wx.min)}° / {Math.round(wx.max)}° · 비 {wx.rainProb}%
          </small>
        </span>
      </div>
      {air.text && <div className={`sw-air lv${air.level}`}>{air.text}</div>}
    </>
  );
}

// ---------------- 학급임원선거 (TV) ----------------
// 투표 중에는 안내·후보·전체 진행 인원만. 득표·순위는 교사가 결과를 공개한 뒤에만 (데이터 자체가 그때만 온다).
function ElectionBoard({ e }: { e: StudentElectionView }) {
  const head = (
    <div className="st-elect-head">
      <div className="st-elect-title">{e.title}</div>
      <div className="st-elect-pos">
        {e.position} · {e.seats}명 선출{e.runoff ? ' · 동점 재투표' : ''}
      </div>
    </div>
  );
  if (e.result) {
    const r = e.result;
    const max = Math.max(1, ...r.rows.map((x) => x.votes));
    const status =
      r.status === 'tie'
        ? `당선 경계에서 동점입니다 — 동점 후보끼리 재투표로 ${r.seatsLeft}명을 더 뽑습니다`
        : r.status === 'no-votes'
          ? '투표한 학생이 없어 당선자를 정하지 않았습니다'
          : r.status === 'all-abstain'
            ? '모두 기권하여 당선자를 정하지 않았습니다'
            : null;
    return (
      <div className="st-elect" data-testid="st-election" data-phase="published">
        {head}
        {e.priorWinners.length > 0 && <div className="st-elect-note">1차 투표 당선: {e.priorWinners.join(', ')}</div>}
        <div className="st-elect-rows">
          {r.rows.map((x) => (
            <div key={x.number} className={`st-elect-row${x.elected ? ' won' : ''}`} style={{ ['--c' as any]: x.color }} data-result-num={x.number}>
              <span className="st-elect-num">{x.number}</span>
              <span className="st-elect-name">{x.name}</span>
              <div className="st-elect-bar">
                <div style={{ width: `${(x.votes / max) * 100}%` }} />
              </div>
              <span className="st-elect-votes">{x.votes}표</span>
              {x.elected ? <span className="st-elect-badge won">당선</span> : x.tied ? <span className="st-elect-badge tie">동점·재투표</span> : <span />}
            </div>
          ))}
        </div>
        {status && <div className="st-elect-alert">{status}</div>}
        <div className="st-elect-sum">
          투표한 학생 {r.ballots}명 (기권 {r.abstain}명){e.maxChoices > 1 ? ` · 1인 최대 ${e.maxChoices}명 선택 · 후보 득표 합계 ${r.totalMarks}표` : ''}
        </div>
      </div>
    );
  }
  const n = e.candidates.length;
  const cols = n <= 3 ? n : n <= 6 ? 3 : 4;
  return (
    <div className="st-elect" data-testid="st-election" data-phase={e.phase}>
      {head}
      <div className="st-elect-cands" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, auto))` }}>
        {e.candidates.map((c) => (
          <div key={c.number} className="st-elect-cand" style={{ ['--c' as any]: c.color }}>
            <span className="st-elect-num">{c.number}</span>
            <span className="st-elect-name">{c.name}</span>
          </div>
        ))}
      </div>
      <div className="st-elect-note">
        {e.phase === 'voting'
          ? `교실 컴퓨터에서 한 명씩 비밀투표합니다 · ${e.maxChoices === 1 ? '한 명' : `최대 ${e.maxChoices}명`}을 고르세요`
          : e.phase === 'closed'
            ? '투표가 끝났습니다. 선생님이 결과를 확인하고 있습니다.'
            : '곧 투표를 시작합니다.'}
      </div>
      {(e.phase === 'voting' || e.phase === 'closed') && (
        <div className="st-elect-progress">
          투표한 학생 {e.ballots} / {e.voterLimit}명
        </div>
      )}
    </div>
  );
}
