// 위젯 보드 공용 로직: 교시 계산, 일정 합치기, 이번 주 일정, 날씨 지역, 학생 화면 일정
import type { CalEvent, PeriodConfig, WidgetData } from './types';
import { koreanHolidays } from './holidays';
import { pad2 } from './util';

// ---------------- 교시 ----------------

export interface PeriodSlot {
  kind: 'class' | 'lunch' | 'play';
  no: number; // 교시 번호 (점심은 0)
  label: string;
  start: number; // 하루 중 분
  end: number;
}

export function toMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? +m[1] * 60 + +m[2] : 0;
}
export function fromMin(n: number): string {
  return `${pad2(Math.floor(n / 60) % 24)}:${pad2(n % 60)}`;
}

export function buildPeriods(c: PeriodConfig): PeriodSlot[] {
  const out: PeriodSlot[] = [];
  let t = toMin(c.firstStart);
  for (let i = 1; i <= c.count; i++) {
    out.push({ kind: 'class', no: i, label: `${i}교시`, start: t, end: t + c.length });
    t += c.length;
    if (i === c.count) break;
    if (c.lunchAfter === i && c.lunchLen > 0) {
      out.push({ kind: 'lunch', no: 0, label: '점심시간', start: t, end: t + c.lunchLen });
      t += c.lunchLen;
    } else if (c.playAfter === i && c.playLen > 0) {
      out.push({ kind: 'play', no: 0, label: '중간놀이', start: t, end: t + c.playLen });
      t += c.playLen;
    } else t += c.breakLen;
  }
  return out;
}

export interface PeriodNow {
  state: 'before' | 'class' | 'lunch' | 'play' | 'break' | 'after' | 'weekend';
  title: string; // 크게 보일 말 (예: 3교시, 쉬는 시간)
  sub: string; // 예: 4교시까지
  progress: number; // 0~1 (지금 칸 안에서)
  remainSec: number; // 지금 칸이 끝날 때까지
  current: PeriodSlot | null;
  next: PeriodSlot | null;
}

export function periodNow(c: PeriodConfig, now: Date): PeriodNow {
  const slots = buildPeriods(c);
  const dow = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const none = { progress: 0, remainSec: 0, current: null };
  if (dow === 0 || dow === 6) return { state: 'weekend', title: '주말', sub: '', ...none, next: null };
  if (!slots.length) return { state: 'after', title: '', sub: '', ...none, next: null };
  if (mins < slots[0].start) {
    const remain = Math.round((slots[0].start - mins) * 60);
    return { state: 'before', title: '수업 전', sub: `1교시까지`, progress: 0, remainSec: remain, current: null, next: slots[0] };
  }
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (mins >= s.start && mins < s.end) {
      const next = slots.slice(i + 1).find((x) => x.kind === 'class') ?? null;
      return { state: s.kind, title: s.label, sub: next ? `다음 ${next.label}` : '마지막 시간', progress: (mins - s.start) / (s.end - s.start), remainSec: Math.round((s.end - mins) * 60), current: s, next };
    }
    const n = slots[i + 1];
    if (n && mins >= s.end && mins < n.start) {
      return { state: 'break', title: '쉬는 시간', sub: `다음 ${n.label}`, progress: (mins - s.end) / (n.start - s.end), remainSec: Math.round((n.start - mins) * 60), current: null, next: n };
    }
  }
  return { state: 'after', title: '수업 끝', sub: '', ...none, next: null };
}

// ---------------- 일정 ----------------

export const LOCAL_COLOR = '#2b8a3e';
export const HOLIDAY_COLOR = '#e03131';

export function dayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 내 일정 + 공휴일 + 구글 일정을 합친 목록 (from~to) */
export function mergedEvents(w: WidgetData, google: CalEvent[], from: number, to: number, opts: { studentOnly?: boolean } = {}): CalEvent[] {
  const out: CalEvent[] = [];
  const cals = new Map(w.calendars.map((c) => [c.id, c]));
  for (const e of google) {
    const c = cals.get(e.calId);
    if (!c || !c.enabled) continue;
    if (opts.studentOnly && !c.showOnStudent) continue;
    if (e.end >= from && e.start <= to) out.push({ ...e, color: c.color });
  }
  if (!opts.studentOnly || w.localShowOnStudent)
    for (const e of w.localEvents) {
      const s = e.time ? dayStart(e.date) + (toMin(e.time) * 60000) : dayStart(e.date);
      const endDay = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
      const en = e.time ? s + 3600_000 : dayStart(endDay) + 86400_000;
      if (en >= from && s <= to) out.push({ id: e.id, calId: 'local', title: e.title, start: s, end: en, allDay: !e.time, color: LOCAL_COLOR });
    }
  if (w.holidays && (!opts.studentOnly || w.holidaysOnStudent)) {
    const y0 = new Date(from).getFullYear();
    const y1 = new Date(to).getFullYear();
    for (let y = y0; y <= y1; y++)
      for (const [k, name] of koreanHolidays(y)) {
        const s = dayStart(k);
        if (s + 86400_000 > from && s <= to) out.push({ id: 'h' + k, calId: 'holiday', title: name, start: s, end: s + 86400_000, allDay: true, color: HOLIDAY_COLOR });
      }
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));
}

/** 날짜 key에 걸치는 일정 */
export function eventsOn(events: CalEvent[], key: string): CalEvent[] {
  const s = dayStart(key);
  const e = s + 86400_000;
  return events.filter((x) => x.start < e && x.end > s && !(x.allDay && x.end <= s));
}

/** 이번 주 월요일 */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  return x;
}

export function eventTimeLabel(e: CalEvent): string | null {
  if (e.allDay) return null;
  const d = new Date(e.start);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ---------------- 날씨 ----------------

export const REGIONS: { id: string; name: string; lat: number; lon: number }[] = [
  { id: 'seoul', name: '서울', lat: 37.5665, lon: 126.978 },
  { id: 'busan', name: '부산', lat: 35.1796, lon: 129.0756 },
  { id: 'daegu', name: '대구', lat: 35.8714, lon: 128.6014 },
  { id: 'incheon', name: '인천', lat: 37.4563, lon: 126.7052 },
  { id: 'gwangju', name: '광주', lat: 35.1595, lon: 126.8526 },
  { id: 'daejeon', name: '대전', lat: 36.3504, lon: 127.3845 },
  { id: 'ulsan', name: '울산', lat: 35.5384, lon: 129.3114 },
  { id: 'sejong', name: '세종', lat: 36.48, lon: 127.289 },
  { id: 'suwon', name: '경기 수원', lat: 37.2636, lon: 127.0286 },
  { id: 'goyang', name: '경기 고양', lat: 37.6584, lon: 126.832 },
  { id: 'seongnam', name: '경기 성남', lat: 37.4201, lon: 127.1265 },
  { id: 'uijeongbu', name: '경기 의정부', lat: 37.7381, lon: 127.0337 },
  { id: 'chuncheon', name: '강원 춘천', lat: 37.8813, lon: 127.7298 },
  { id: 'gangneung', name: '강원 강릉', lat: 37.7519, lon: 128.8761 },
  { id: 'wonju', name: '강원 원주', lat: 37.3422, lon: 127.9202 },
  { id: 'cheongju', name: '충북 청주', lat: 36.6424, lon: 127.489 },
  { id: 'chungju', name: '충북 충주', lat: 36.991, lon: 127.9259 },
  { id: 'cheonan', name: '충남 천안', lat: 36.8151, lon: 127.1139 },
  { id: 'hongseong', name: '충남 홍성', lat: 36.6012, lon: 126.6608 },
  { id: 'jeonju', name: '전북 전주', lat: 35.8242, lon: 127.148 },
  { id: 'gunsan', name: '전북 군산', lat: 35.9676, lon: 126.7369 },
  { id: 'muan', name: '전남 무안', lat: 34.9904, lon: 126.4817 },
  { id: 'yeosu', name: '전남 여수', lat: 34.7604, lon: 127.6622 },
  { id: 'suncheon', name: '전남 순천', lat: 34.9506, lon: 127.4872 },
  { id: 'andong', name: '경북 안동', lat: 36.5684, lon: 128.7294 },
  { id: 'pohang', name: '경북 포항', lat: 36.019, lon: 129.3435 },
  { id: 'gumi', name: '경북 구미', lat: 36.1195, lon: 128.3446 },
  { id: 'changwon', name: '경남 창원', lat: 35.2281, lon: 128.6811 },
  { id: 'jinju', name: '경남 진주', lat: 35.18, lon: 128.1076 },
  { id: 'gimhae', name: '경남 김해', lat: 35.2285, lon: 128.8894 },
  { id: 'jeju', name: '제주', lat: 33.4996, lon: 126.5312 },
  { id: 'seogwipo', name: '제주 서귀포', lat: 33.2541, lon: 126.56 },
];

/** WMO 날씨 코드 → 한국어·아이콘 */
export function weatherText(code: number): { text: string; icon: string } {
  if (code === 0) return { text: '맑음', icon: '☀️' };
  if (code <= 2) return { text: '구름 조금', icon: '🌤️' };
  if (code === 3) return { text: '흐림', icon: '☁️' };
  if (code === 45 || code === 48) return { text: '안개', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { text: '이슬비', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { text: '비', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { text: '눈', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { text: '소나기', icon: '🌦️' };
  if (code >= 85 && code <= 86) return { text: '눈 소나기', icon: '🌨️' };
  if (code >= 95) return { text: '뇌우', icon: '⛈️' };
  return { text: '', icon: '🌡️' };
}

/** 미세먼지로 본 실외 활동 판단 (환경부 기준) */
export function airGrade(pm10?: number, pm25?: number): { level: 0 | 1 | 2 | 3; text: string } {
  if (pm10 === undefined && pm25 === undefined) return { level: 0, text: '' };
  const g10 = pm10 === undefined ? 0 : pm10 <= 30 ? 0 : pm10 <= 80 ? 1 : pm10 <= 150 ? 2 : 3;
  const g25 = pm25 === undefined ? 0 : pm25 <= 15 ? 0 : pm25 <= 35 ? 1 : pm25 <= 75 ? 2 : 3;
  const lv = Math.max(g10, g25) as 0 | 1 | 2 | 3;
  return { level: lv, text: ['실외 활동 좋음', '실외 활동 가능 (미세먼지 보통)', '실외 활동 자제 (미세먼지 나쁨)', '실외 활동 금지 (미세먼지 매우 나쁨)'][lv] };
}

// ---------------- 급식 ----------------

/** 나이스 급식 요리 이름 정리: '귀리밥(5.6.)' → 이름과 알레르기 번호 */
export function cleanDishes(raw: string): { dishes: string[]; allergies: string[] } {
  const parts = raw.split(/<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean);
  const dishes: string[] = [];
  const allergies: string[] = [];
  for (const p of parts) {
    const m = /^(.*?)\s*\(?([\d.]+)\)?\s*$/.exec(p);
    if (m && /\d/.test(m[2]) && m[1]) {
      dishes.push(m[1].replace(/[*#]+$/, '').trim());
      allergies.push(m[2].replace(/\.$/, ''));
    } else {
      dishes.push(p.replace(/[*#]+$/, '').trim());
      allergies.push('');
    }
  }
  return { dishes, allergies };
}

export const ALLERGY_NAMES = ['', '난류', '우유', '메밀', '땅콩', '대두', '밀', '고등어', '게', '새우', '돼지고기', '복숭아', '토마토', '아황산류', '호두', '닭고기', '쇠고기', '오징어', '조개류', '잣'];
