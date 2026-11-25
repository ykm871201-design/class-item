// 학생 화면 렌더링 (학생 창과 교사용 미리보기가 같은 코드를 사용)
// 입력은 StudentView 뿐이며, 고정 자리 등 교사용 정보는 애초에 전달되지 않는다.
import { useEffect, useMemo, useState } from 'react';
import type { StudentBoardView, StudentPickerView, StudentSeatingView, StudentTimerView, StudentView } from '../../shared/types';
import { formatClock } from '../../shared/util';
import { fitFontPx, widestAt100 } from './fit';
import { useNow, useSize, useFontsReady } from './hooks';

const LINE_HEIGHT = 1.3;
const SEAT_SHUFFLE_MS = 2000;
const PICK_SHUFFLE_MS = 1800;

export function StudentScreen({ view }: { view: StudentView }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const fontsReady = useFontsReady();
  const t = view.timer;
  let content: React.ReactNode;
  if (t && t.mode === 'full') content = <TimerPanel timer={t} variant="full" />;
  else if (t && t.mode === 'split') content = <SplitView board={view.board} timer={t} size={size} />;
  else if (view.base === 'board') content = <BoardArea board={view.board} w={size.w} h={size.h} refH={size.h} />;
  else if (view.base === 'seating' && view.seating) content = <SeatingBoard s={view.seating} />;
  else if (view.base === 'picker' && view.picker) content = <PickerBoard p={view.picker} />;
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
        style={{ fontSize: px, fontWeight: board.bold ? 800 : 500, textAlign: board.align, lineHeight: LINE_HEIGHT, justifyContent: board.align === 'center' ? 'center' : 'flex-start' }}
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
function SplitView({ board, timer, size }: { board: StudentBoardView; timer: StudentTimerView; size: { w: number; h: number } }) {
  const { w, h } = size;
  // 오른쪽 아래 1/4(가로 50% × 세로 50%)은 타이머 전용. 칠판 문구는 남은 영역 중
  // 위쪽 띠(전체 너비 × 위 50%)와 왼쪽 띠(왼쪽 50% × 전체 높이) 가운데 글씨가 더 크게 들어가는 쪽에 배치한다.
  const layout = useMemo(() => {
    const padTop = Math.round(Math.min(w, h / 2) * 0.06);
    const padLeft = Math.round(Math.min(w / 2, h) * 0.06);
    const top = boardFontPx(board, w - padTop * 2, h / 2 - padTop * 2, h);
    const left = boardFontPx(board, w / 2 - padLeft * 2, h - padLeft * 2, h);
    return left > top ? 'left' : 'top';
  }, [board, w, h]);
  const bw = layout === 'top' ? w : w / 2;
  const bh = layout === 'top' ? h / 2 : h;
  return (
    <div className="st-split" style={{ background: board.bg }}>
      <div className={`st-split-board st-split-board-${layout}`} style={{ width: bw, height: bh }} data-testid="split-board" data-layout={layout}>
        <BoardArea board={board} w={bw} h={bh} refH={h} />
      </div>
      <div className="st-split-timer" style={{ width: w / 2, height: h / 2 }} data-testid="split-timer">
        <TimerPanel timer={timer} variant="split" />
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
function columnTracks(s: Pick<StudentSeatingView, 'type' | 'cols' | 'pairsPerGroup'>): { tracks: number[]; seatTrack: number[] } {
  const tracks: number[] = [];
  const seatTrack: number[] = [];
  for (let c = 0; c < s.cols; c++) {
    if (c > 0) {
      let gap = 0.22;
      if (s.type === 'pair') {
        if (c % 2 === 1) gap = 0.05; // 짝 사이
        else gap = (c / 2) % s.pairsPerGroup === 0 ? 0.55 : 0.2; // 분단 사이 / 같은 분단의 짝 사이
      }
      tracks.push(gap);
    }
    seatTrack.push(tracks.length);
    tracks.push(1);
  }
  return { tracks, seatTrack };
}

export function seatGridTemplate(s: Pick<StudentSeatingView, 'type' | 'cols' | 'pairsPerGroup'>) {
  const { tracks, seatTrack } = columnTracks(s);
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
  const grid = seatGridTemplate(s);
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
