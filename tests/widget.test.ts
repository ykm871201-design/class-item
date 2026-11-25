import { describe, it, expect } from 'vitest';
import { parseIcs, googleAddUrl, normalizeIcsUrl, zonedToEpoch } from '../src/shared/ical';
import { koreanHolidays } from '../src/shared/holidays';
import { buildPeriods, cleanDishes, mergedEvents, periodNow, studentAgenda, airGrade } from '../src/shared/widget';
import { defaultData, defaultWidget, normalizeData } from '../src/shared/defaults';
import { buildStudentView } from '../src/shared/studentView';
import { idleTimer } from '../src/shared/timer';
import { Controller, type Ports } from '../src/main/controller';
import type { CalEvent } from '../src/shared/types';

const L = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const RANGE = [L(2026, 1, 1), L(2027, 12, 31)] as const;

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:학교 일정
BEGIN:VTIMEZONE
TZID:Asia/Seoul
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:a1
DTSTART;VALUE=DATE:20261125
DTEND;VALUE=DATE:20261126
SUMMARY:공문 제출\\, 확인
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;TZID=Asia/Seoul:20261126T140000
DTEND;TZID=Asia/Seoul:20261126T153000
SUMMARY:학년 협의회 (긴 제목이 여러 줄로
  접혀 있는 경우)
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART:20261127T010000Z
DTEND:20261127T020000Z
SUMMARY:UTC 일정
END:VEVENT
BEGIN:VEVENT
UID:r1
DTSTART;TZID=Asia/Seoul:20261102T083000
DTEND;TZID=Asia/Seoul:20261102T084000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261130T235959Z
EXDATE;TZID=Asia/Seoul:20261111T083000
SUMMARY:아침 조회
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=Asia/Seoul:20261116T083000
DTSTART;TZID=Asia/Seoul:20261116T090000
DTEND;TZID=Asia/Seoul:20261116T091000
SUMMARY:아침 조회 (시간 변경)
END:VEVENT
BEGIN:VEVENT
UID:m1
DTSTART;VALUE=DATE:20261110
DTEND;VALUE=DATE:20261111
RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3
SUMMARY:둘째 화요일 회의
END:VEVENT
BEGIN:VEVENT
UID:y1
DTSTART;VALUE=DATE:20260301
RRULE:FREQ=YEARLY
SUMMARY:개교기념일
END:VEVENT
BEGIN:VEVENT
UID:c1
DTSTART;VALUE=DATE:20261128
STATUS:CANCELLED
SUMMARY:취소된 일정
END:VEVENT
BEGIN:VEVENT
UID:d1
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261204
SUMMARY:수학여행
END:VEVENT
END:VCALENDAR`;

describe('iCal 해석 (구글 캘린더 비공개 주소)', () => {
  const evs = parseIcs(ICS, RANGE[0], RANGE[1]);
  const by = (t: string) => evs.filter((e) => e.title === t);
  it('하루 종일·시간대·UTC·줄 접힘·이스케이프', () => {
    expect(by('공문 제출, 확인')[0]).toMatchObject({ allDay: true, start: L(2026, 11, 25), end: L(2026, 11, 26) });
    const h = by('학년 협의회 (긴 제목이 여러 줄로 접혀 있는 경우)')[0];
    expect(h.start).toBe(L(2026, 11, 26, 14));
    expect(h.end).toBe(L(2026, 11, 26, 15, 30));
    expect(by('UTC 일정')[0].start).toBe(L(2026, 11, 27, 10)); // 01:00Z = 서울 10:00
  });
  it('매주 반복(월·수), 종료일, 제외 날짜, 바뀐 회차', () => {
    const r = by('아침 조회').map((e) => new Date(e.start).getDate());
    expect(r).toEqual([2, 4, 9, 18, 23, 25, 30]); // 11일 제외, 16일은 바뀐 회차로 대체
    const moved = by('아침 조회 (시간 변경)');
    expect(moved.length).toBe(1);
    expect(moved[0].start).toBe(L(2026, 11, 16, 9));
  });
  it('매월 둘째 화요일 3번, 매년 반복, 취소 일정 제외, 여러 날 일정', () => {
    expect(by('둘째 화요일 회의').map((e) => localKey(e.start))).toEqual(['2026-11-10', '2026-12-08', '2027-01-12']);
    expect(by('개교기념일').map((e) => localKey(e.start))).toEqual(['2026-03-01', '2027-03-01']);
    expect(by('취소된 일정')).toEqual([]);
    const trip = by('수학여행')[0];
    expect(trip.end - trip.start).toBe(3 * 86400_000);
  });
  it('주소 정리·구글 추가 주소', () => {
    expect(normalizeIcsUrl(' webcal://calendar.google.com/x.ics ')).toBe('https://calendar.google.com/x.ics');
    expect(googleAddUrl({ title: '공개 수업', date: '2026-11-27', time: '14:00' })).toBe('https://calendar.google.com/calendar/render?action=TEMPLATE&text=%EA%B3%B5%EA%B0%9C%20%EC%88%98%EC%97%85&dates=20261127T140000/20261127T150000');
    expect(googleAddUrl({ title: 'x', date: '2026-12-31' })).toContain('dates=20261231/20270101');
  });
  it('시간대 변환', () => {
    expect(zonedToEpoch(2026, 7, 1, 9, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13));
  });
});
const localKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('대한민국 공휴일', () => {
  it('2026년 대체공휴일 (삼일절·부처님오신날·광복절·개천절)', () => {
    const h = koreanHolidays(2026);
    for (const k of ['2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05']) expect(h.get(k)).toContain('대체공휴일');
    expect(h.get('2026-02-17')).toBe('설날');
    expect(h.get('2026-09-25')).toBe('추석');
    expect(h.get('2026-12-25')).toBe('성탄절');
    expect([...h.keys()].filter((k) => h.get(k)!.includes('대체')).length).toBe(4);
  });
  it('2027년 설날 연휴가 일요일과 겹치면 대체공휴일', () => {
    const h = koreanHolidays(2027); // 2/6(토)~2/8(월), 2/7 일요일 → 2/9 대체
    expect(h.get('2027-02-09')).toContain('대체공휴일');
  });
});

describe('교시 계산', () => {
  const cfg = { firstStart: '09:00', length: 40, breakLen: 10, count: 6, lunchAfter: 4, lunchLen: 50 };
  it('시각표', () => {
    const s = buildPeriods(cfg);
    expect(s.map((x) => x.label)).toEqual(['1교시', '2교시', '3교시', '4교시', '점심시간', '5교시', '6교시']);
    expect(s[5].start).toBe(13 * 60); // 4교시 11:30~12:10, 점심 12:10~13:00, 5교시 13:00
  });
  it('지금 상태', () => {
    expect(periodNow(cfg, new Date(2026, 10, 25, 8, 30)).state).toBe('before');
    const c = periodNow(cfg, new Date(2026, 10, 25, 9, 20));
    expect([c.state, c.title, c.remainSec]).toEqual(['class', '1교시', 20 * 60]);
    expect(periodNow(cfg, new Date(2026, 10, 25, 9, 45)).title).toBe('쉬는 시간');
    expect(periodNow(cfg, new Date(2026, 10, 25, 12, 30)).state).toBe('lunch');
    expect(periodNow(cfg, new Date(2026, 10, 25, 16, 0)).state).toBe('after');
    expect(periodNow(cfg, new Date(2026, 10, 28, 10, 0)).state).toBe('weekend');
  });
});

describe('일정 합치기와 학생 화면', () => {
  const g: CalEvent[] = [
    { id: 'g1', calId: 'school', title: '학교 행사', start: L(2026, 11, 26, 10), end: L(2026, 11, 26, 11), allDay: false, color: '' },
    { id: 'g2', calId: 'private', title: '개인 병원 예약', start: L(2026, 11, 26, 15), end: L(2026, 11, 26, 16), allDay: false, color: '' },
  ];
  const w = { ...defaultWidget(), calendars: [
    { id: 'school', name: '학교', color: '#1c7ed6', enabled: true, showOnStudent: true, urlEnc: 'x' },
    { id: 'private', name: '개인', color: '#c2255c', enabled: true, showOnStudent: false, urlEnc: 'y' },
  ], localEvents: [{ id: 'l1', title: '내 메모 일정', date: '2026-11-27' }] };
  it('교사 화면: 모든 캘린더 + 내 일정 + 공휴일', () => {
    const ev = mergedEvents(w, g, L(2026, 11, 23), L(2026, 11, 30));
    expect(ev.map((e) => e.title).sort()).toEqual(['개인 병원 예약', '내 메모 일정', '학교 행사']);
  });
  it('학생 화면: 학생 화면에 보이기로 고른 캘린더만, 주소·개인 일정 없음', () => {
    const d = { ...defaultData(), widget: w, studentBase: 'agenda' as const };
    const v = buildStudentView(d, { timer: idleTimer(), seatingReveal: null, pickerReveal: null, widget: { googleEvents: g, calStatus: {}, weather: null, meal: null, visible: false } }, L(2026, 11, 25, 9));
    const json = JSON.stringify(v);
    expect(json).toContain('학교 행사');
    expect(json).not.toContain('개인 병원');
    expect(json).not.toContain('내 메모 일정'); // 내 일정은 기본으로 학생 화면에 안 보임
    expect(json).not.toMatch(/urlEnc|ical|https?:/);
    expect(v.agenda!.days.find((x) => x.isToday)!.date).toBe('2026-11-25');
  });
  it('studentAgenda: 주말은 일정이 있을 때만', () => {
    const a = studentAgenda({ ...defaultData(), widget: { ...w, holidaysOnStudent: false } }, g, L(2026, 11, 25));
    expect(a.days.map((d) => d.label.slice(-3))).toEqual(['(월)', '(화)', '(수)', '(목)', '(금)']);
  });
});

describe('급식·미세먼지·저장', () => {
  it('나이스 급식 이름 정리', () => {
    const r = cleanDishes('귀리밥 (5.6.)<br/>투움바파스타 (2.5.6.13.)<br/>배추김치*<br/>사과');
    expect(r.dishes).toEqual(['귀리밥', '투움바파스타', '배추김치', '사과']);
    expect(r.allergies).toEqual(['5.6', '2.5.6.13', '', '']);
  });
  it('미세먼지 단계', () => {
    expect(airGrade(25, 10).level).toBe(0);
    expect(airGrade(90, 20).level).toBe(2);
    expect(airGrade(undefined, undefined).text).toBe('');
  });
  it('위젯 데이터 저장·복원', () => {
    const d = defaultData();
    d.widget.todos.push({ id: 't', text: '교과서 신청', date: '2026-11-25', done: false });
    d.widget.timetable[0][0] = '국어';
    expect(normalizeData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('교사 화면으로 보내는 상태에 캘린더 주소(암호화 값)가 없음', () => {
    const ports = { persist() {}, showStudent: () => true, hideStudent() {}, applyTopmost() {}, playSound() {}, notify() {}, broadcast() {}, studentWindowStatus: () => ({ visible: false, mode: 'none', fullscreen: false, displayAvailable: false, displayLabel: null, alwaysOnTop: false }), displays: () => [] } as unknown as Ports;
    const d = defaultData();
    d.widget.calendars.push({ id: 'c', name: '학교', color: '#1c7ed6', enabled: true, showOnStudent: false, urlEnc: 'enc:SECRETSECRET' });
    const ctl = new Controller(d, ports, { userDataPath: '', appVersion: 't' });
    expect(JSON.stringify(ctl.fullState())).not.toContain('SECRETSECRET');
    expect(ctl.data.widget.calendars[0].urlEnc).toBe('enc:SECRETSECRET'); // 원본은 그대로 저장
  });
});
