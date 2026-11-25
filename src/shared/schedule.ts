// 예약 타이머 계산: 다음 실행 시각, 실행/놓침 판정, 충돌 검사 (PC 현지 시각 기준)
import type { Schedule } from './types';
import { WEEKDAY_KO, localDateKey, pad2 } from './util';

export const DUE_GRACE_MS = 2 * 60 * 1000; // 이 시간 안에 감지되면 실행, 더 늦으면 '놓침'
export const MISSED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DURATION_SEC = 180 * 60;

export function parseTime(t: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

export function parseDate(d: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  const test = new Date(y, mo - 1, dd);
  if (test.getFullYear() !== y || test.getMonth() !== mo - 1 || test.getDate() !== dd) return null;
  return { y, mo, d: dd };
}

export function occurrenceKey(ms: number): string {
  const d = new Date(ms);
  return `${localDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 특정 날짜(현지)의 예약 시각 */
function atLocal(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo, d, h, mi, 0, 0).getTime();
}

/** (fromMs, toMs] 구간의 발생 시각 목록 (enabled 여부와 무관) */
export function occurrencesBetween(s: Schedule, fromMs: number, toMs: number): number[] {
  const t = parseTime(s.time);
  if (!t || toMs <= fromMs) return [];
  const out: number[] = [];
  if (s.repeat === 'once') {
    const d = parseDate(s.date);
    if (!d) return [];
    const at = atLocal(d.y, d.mo - 1, d.d, t.h, t.m);
    if (at > fromMs && at <= toMs) out.push(at);
    return out;
  }
  const days = new Set(s.days);
  if (days.size === 0) return [];
  const start = new Date(fromMs);
  // 하루씩 진행 (현지 날짜 기준이므로 서머타임에도 안전)
  for (let i = 0; i < 400; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const at = atLocal(day.getFullYear(), day.getMonth(), day.getDate(), t.h, t.m);
    if (at > toMs) break;
    if (at > fromMs && days.has(day.getDay())) out.push(at);
  }
  return out;
}

/** 다음 실행 시각 (now 이후, 이미 처리한 발생은 건너뜀). 없으면 null */
export function nextRun(s: Schedule, now: number, firedKey?: string): number | null {
  if (!s.enabled) return null;
  const t = parseTime(s.time);
  if (!t) return null;
  // 지금 이 분에 해당하는 발생이 아직 처리되지 않았으면 그것이 다음 실행
  const nowD = new Date(now);
  const thisMinute = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), nowD.getHours(), nowD.getMinutes()).getTime();
  const from = thisMinute - 1;
  const horizon = s.repeat === 'once' ? Number.MAX_SAFE_INTEGER / 2 : now + 8 * 24 * 3600 * 1000;
  if (s.repeat === 'once') {
    const d = parseDate(s.date);
    if (!d) return null;
    const at = atLocal(d.y, d.mo - 1, d.d, t.h, t.m);
    if (at <= from) return null;
    if (firedKey && occurrenceKey(at) === firedKey) return null;
    return at;
  }
  for (const at of occurrencesBetween(s, from, horizon)) {
    if (firedKey && occurrenceKey(at) === firedKey) continue;
    if (at < (s.activeSince ?? 0)) continue;
    return at;
  }
  return null;
}

export interface Occurrence {
  schedule: Schedule;
  at: number;
  key: string;
}

export interface TickResult {
  due: Occurrence[]; // 지금 실행할 예약
  missed: Occurrence[]; // 놓친 예약 (실행하지 않고 기록만)
}

/**
 * 예약 감시 1회 판정.
 * lastCheck 이후 now까지 발생한 예약 중
 *  - now 기준 DUE_GRACE_MS 이내 → 실행
 *  - 그보다 오래됨(절전·앱 꺼짐 등) → 놓침으로 기록만 하고 실행하지 않음
 * 같은 발생은 fired[scheduleId]로 한 번만 처리된다.
 */
export function evaluateTick(schedules: Schedule[], fired: Record<string, string>, lastCheck: number, now: number, graceMs = DUE_GRACE_MS): TickResult {
  const due: Occurrence[] = [];
  const missed: Occurrence[] = [];
  const from = Math.max(Math.min(lastCheck, now - 1), now - MISSED_LOOKBACK_MS);
  for (const s of schedules) {
    if (!s.enabled) continue;
    const occ = occurrencesBetween(s, from, now).filter((at) => at >= (s.activeSince ?? 0));
    if (occ.length === 0) continue;
    const last = occ[occ.length - 1];
    const lastKey = occurrenceKey(last);
    if (fired[s.id] === lastKey) continue; // 이미 처리됨 (중복 실행 방지)
    const firedAt = fired[s.id] ? keyToMs(fired[s.id]) : -Infinity;
    const pending = occ.filter((at) => at > firedAt);
    for (const at of pending) {
      const o = { schedule: s, at, key: occurrenceKey(at) };
      if (at === last && now - at <= graceMs) due.push(o);
      else missed.push(o);
    }
  }
  due.sort((a, b) => a.at - b.at);
  missed.sort((a, b) => a.at - b.at);
  return { due, missed: missed.slice(-30) };
}

export function keyToMs(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(key);
  if (!m) return -Infinity;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** 저장 전 충돌 검사: 완전히 같은 실행 시각을 가지는 다른 활성 예약 */
export function findConflicts(s: Schedule, others: Schedule[]): Schedule[] {
  if (!s.enabled) return [];
  const t = parseTime(s.time);
  if (!t) return [];
  return others.filter((o) => {
    if (o.id === s.id || !o.enabled) return false;
    const ot = parseTime(o.time);
    if (!ot || ot.h !== t.h || ot.m !== t.m) return false;
    if (s.repeat === 'weekly' && o.repeat === 'weekly') return s.days.some((d) => o.days.includes(d));
    if (s.repeat === 'once' && o.repeat === 'once') return s.date === o.date;
    const once = s.repeat === 'once' ? s : o;
    const weekly = s.repeat === 'once' ? o : s;
    const d = parseDate(once.date);
    if (!d) return false;
    return weekly.days.includes(new Date(d.y, d.mo - 1, d.d).getDay());
  });
}

export function validateSchedule(s: Schedule, now: number): string[] {
  const errs: string[] = [];
  if (!s.name.trim()) errs.push('예약 이름을 입력해 주세요.');
  if (!parseTime(s.time)) errs.push('실행 시각이 올바르지 않습니다.');
  if (!(s.durationSec >= 1 && s.durationSec <= MAX_DURATION_SEC)) errs.push('타이머 길이는 1초 이상 180분 이하로 설정해 주세요.');
  if (s.repeat === 'once') {
    const d = parseDate(s.date);
    if (!d) errs.push('실행 날짜를 선택해 주세요.');
    else if (s.enabled && parseTime(s.time)) {
      const t = parseTime(s.time)!;
      const at = new Date(d.y, d.mo - 1, d.d, t.h, t.m).getTime();
      if (at <= now) errs.push('이미 지난 날짜·시각입니다. 실행 시각을 다시 선택해 주세요.');
    }
  } else if (s.days.length === 0) errs.push('반복할 요일을 하나 이상 선택해 주세요.');
  return errs;
}

export function describeRepeat(s: Schedule): string {
  if (s.repeat === 'once') {
    const d = parseDate(s.date);
    if (!d) return '한 번';
    const wd = WEEKDAY_KO[new Date(d.y, d.mo - 1, d.d).getDay()];
    return `${d.y}년 ${d.mo}월 ${d.d}일(${wd}) 한 번`;
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const days = order.filter((d) => s.days.includes(d));
  if (days.length === 7) return '매일';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return '매주 월~금';
  return '매주 ' + days.map((d) => WEEKDAY_KO[d]).join('·');
}
