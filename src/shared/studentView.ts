// 학생 화면에 전달할 데이터만 골라 만든다.
// 고정 자리 여부, 학생 ID, 결석 정보, 교사용 설정은 절대 포함하지 않는다.
import type { AppData, BoardStyle, ClassRoom, Runtime, SeatingResult, StudentBoardView, StudentSeatingView, StudentView } from './types';
import { displayNames } from './roster';
import { allSeats, columnGaps, disabledList, seatColumns, totalRows } from './seating';

export function boardView(b: BoardStyle): StudentBoardView {
  return { text: b.text, fontSize: b.fontSize, color: b.color, bg: b.bg, align: b.align, bold: b.bold, autoFit: b.autoFit };
}

export function seatingView(cls: ClassRoom, result: SeatingResult, reveal: { revealId: string; animate: boolean; startedAt: number }): StudentSeatingView {
  const names = displayNames(cls.students);
  const layout = result.layout;
  const dis = new Set(disabledList(layout));
  const seats = allSeats(layout).map((s) => {
    const sid = result.assignment[s.id];
    return { r: s.r, c: s.c, disabled: dis.has(s.id) && !sid, name: sid ? names.get(sid) ?? null : null };
  });
  // 섞기 연출에 쓸 이름 (배치에 포함된 학생 이름을 무작위 순서 없이 목록으로만 전달)
  const shuffleNames = seats.filter((s) => s.name).map((s) => s.name as string).sort();
  return {
    type: layout.type,
    rows: totalRows(layout),
    cols: seatColumns(layout),
    gaps: columnGaps(layout),
    seats,
    revealId: reveal.revealId,
    animate: reveal.animate,
    startedAt: reveal.startedAt,
    shuffleNames,
  };
}

export function buildStudentView(data: AppData, rt: Pick<Runtime, 'timer' | 'seatingReveal' | 'pickerReveal'> & { widget?: Runtime['widget'] }, now = Date.now()): StudentView {
  const cls = data.classes.find((c) => c.id === data.currentClassId) ?? null;
  let seating: StudentSeatingView | null = null;
  if (cls) {
    if (rt.seatingReveal && rt.seatingReveal.classId === cls.id) seating = seatingView(cls, rt.seatingReveal.result, rt.seatingReveal);
    else if (cls.seating.confirmed) seating = seatingView(cls, cls.seating.confirmed, { revealId: 'confirmed-' + cls.seating.confirmed.id, animate: false, startedAt: 0 });
  }
  const picker = rt.pickerReveal
    ? {
        names: rt.pickerReveal.names.slice(),
        revealId: rt.pickerReveal.revealId,
        animate: rt.pickerReveal.animate,
        startedAt: rt.pickerReveal.startedAt,
        shuffleNames: rt.pickerReveal.poolNames.slice(),
      }
    : null;
  const t = rt.timer;
  const timer =
    t.shown && t.status !== 'idle'
      ? { status: t.status, durationMs: t.durationMs, endAt: t.endAt, remainingMs: t.remainingMs, activity: t.activity, mode: t.mode }
      : null;
  // 학생용 위젯: 시계·교시·날씨·급식·시간표·알림장만 (구글 캘린더·개인 일정·메모는 보내지 않음)
  void now;
  const w = data.widget;
  const widget =
    data.studentBase === 'widget'
      ? {
          main: data.studentWidgetMain,
          periods: { ...w.periods },
          timetable: w.timetable.map((d) => d.slice(0, w.periods.count)),
          weather: rt.widget?.weather ?? null,
          weatherRegion: w.weatherRegion,
          meal: rt.widget?.meal ?? null,
          notice: w.studentNotice,
          holidays: w.holidays,
          background: w.background,
          glass: w.glass,
        }
      : null;
  return { base: data.studentBase, board: boardView(data.boardPublished), seating, picker, timer, widget };
}
