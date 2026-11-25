// iCal(.ics) 해석: 구글 캘린더 'iCal 형식의 비공개 주소'의 일정을 읽는다.
// 반복 일정(RRULE: 매일·매주·매월·매년, INTERVAL·COUNT·UNTIL·BYDAY·BYMONTHDAY), 제외 날짜(EXDATE),
// 바뀐 반복 회차(RECURRENCE-ID), 시간대(TZID, UTC 'Z', 하루 종일 DATE)를 처리한다.

export interface IcsEvent {
  uid: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
}

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): RawProp | null {
  // NAME;PARAM=V;PARAM2="V":VALUE  (값 안의 ':'는 그대로)
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

/** 시간대 tz의 벽시계 시각을 UTC epoch로 */
export function zonedToEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const offsetAt = (t: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
    };
    let t = guess - offsetAt(guess);
    t = guess - offsetAt(t);
    return t;
  } catch {
    return new Date(y, mo - 1, d, h, mi, s).getTime(); // 모르는 시간대면 PC 현지 시각
  }
}

interface ParsedTime {
  ms: number;
  allDay: boolean;
}

function parseTime(p: RawProp): ParsedTime | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (!m[4] || p.params.VALUE === 'DATE') return { ms: new Date(y, mo - 1, d).getTime(), allDay: true };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] ?? 0)];
  if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  if (p.params.TZID) return { ms: zonedToEpoch(y, mo, d, h, mi, s, p.params.TZID), allDay: false };
  return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false }; // 떠 있는 시각 = 현지
}

function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface VEvent {
  uid: string;
  title: string;
  start: ParsedTime;
  end: ParsedTime | null;
  duration: number | null;
  rrule: Record<string, string> | null;
  exdates: Set<number>;
  recurrenceId: number | null;
  cancelled: boolean;
  tzid?: string;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 같은 벽시계 시각으로 날짜만 옮긴 시각 (하루 종일·현지 시각 기준) */
function shiftDays(ms: number, days: number, ev: VEvent): number {
  if (ev.tzid && !ev.start.allDay) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ev.tzid, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const base = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day + days));
    return zonedToEpoch(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), +parts.hour, +parts.minute, +parts.second, ev.tzid);
  }
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

function localParts(ms: number, ev: VEvent): { y: number; m: number; d: number; dow: number } {
  if (ev.tzid && !ev.start.allDay) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ev.tzid, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  }
  const d = new Date(ms);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), dow: d.getDay() };
}

/** 반복 일정을 [from, to] 구간에서 펼친 시작 시각 목록 */
function expand(ev: VEvent, from: number, to: number): number[] {
  const start = ev.start.ms;
  if (!ev.rrule) return [start];
  const r = ev.rrule;
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL ?? '1', 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  let until = Infinity;
  if (r.UNTIL) {
    const u = parseTime({ name: 'UNTIL', params: {}, value: r.UNTIL });
    if (u) until = u.allDay ? u.ms + 86400_000 - 1 : u.ms;
  }
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((x) => x.trim()) : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map((x) => parseInt(x, 10)) : null;
  const out: number[] = [];
  let n = 0;
  const limitTo = Math.min(to, until);
  const sp = localParts(start, ev);
  const push = (t: number) => {
    if (t < start) return true;
    if (t > limitTo || n >= count) return false;
    n++;
    if (t >= from - 40 * 86400_000) out.push(t);
    return true;
  };
  const MAX = 5000;
  if (freq === 'DAILY') {
    for (let i = 0; i < MAX; i++) if (!push(shiftDays(start, i * interval, ev))) break;
  } else if (freq === 'WEEKLY') {
    const days = byDay ? byDay.map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((x) => x >= 0).sort((a, b) => a - b) : [sp.dow];
    const weekStart = shiftDays(start, -sp.dow, ev); // 그 주 일요일
    outer: for (let w = 0; w < MAX; w++) {
      for (const dd of days) {
        const t = shiftDays(weekStart, w * 7 * interval + dd, ev);
        if (t < start) continue;
        if (!push(t)) break outer;
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let i = 0; i < MAX / 10; i++) {
      const y = sp.y + Math.floor((sp.m - 1 + i * interval) / 12);
      const m = ((sp.m - 1 + i * interval) % 12) + 1;
      const dim = new Date(y, m, 0).getDate();
      const cands: number[] = [];
      if (byDay) {
        // 예: BYDAY=2TU (둘째 화요일), -1FR (마지막 금요일)
        for (const c of byDay) {
          const mm = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(c);
          if (!mm) continue;
          const wd = DAY_CODES.indexOf(mm[2]);
          const list: number[] = [];
          for (let d = 1; d <= dim; d++) if (new Date(y, m - 1, d).getDay() === wd) list.push(d);
          if (mm[1]) {
            const k = parseInt(mm[1], 10);
            const d = k > 0 ? list[k - 1] : list[list.length + k];
            if (d) cands.push(d);
          } else cands.push(...list);
        }
      } else {
        for (const md of byMonthDay ?? [sp.d]) {
          const d = md < 0 ? dim + md + 1 : md;
          if (d >= 1 && d <= dim) cands.push(d);
        }
      }
      let stop = false;
      for (const d of cands.sort((a, b) => a - b)) {
        const t = shiftDays(start, Math.round((new Date(y, m - 1, d).getTime() - new Date(sp.y, sp.m - 1, sp.d).getTime()) / 86400_000), ev);
        if (!push(t)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
  } else if (freq === 'YEARLY') {
    for (let i = 0; i < 200; i++) {
      const y = sp.y + i * interval;
      if (new Date(y, sp.m, 0).getDate() < sp.d) continue; // 2월 29일 등
      const t = shiftDays(start, Math.round((new Date(y, sp.m - 1, sp.d).getTime() - new Date(sp.y, sp.m - 1, sp.d).getTime()) / 86400_000), ev);
      if (!push(t)) break;
    }
  } else return [start];
  return out.filter((t) => !ev.exdates.has(t));
}

/**
 * .ics 내용을 읽어 [from, to] 구간에 걸치는 일정을 돌려준다.
 */
export function parseIcs(text: string, from: number, to: number): IcsEvent[] {
  const lines = unfold(text);
  const events: VEvent[] = [];
  let cur: Partial<VEvent> & { props?: RawProp[] } | null = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) {
      cur = { props: [] };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:VEVENT$/i.test(line.trim())) {
      const ev = buildEvent(cur.props!);
      if (ev) events.push(ev);
      cur = null;
      continue;
    } else if (/^END:/i.test(line)) depth--;
    else if (depth === 0) {
      const p = parseLine(line);
      if (p) cur.props!.push(p);
    }
  }
  // 바뀐 회차(RECURRENCE-ID)는 원래 회차를 대신한다
  const overrides = new Map<string, VEvent[]>();
  for (const e of events) if (e.recurrenceId !== null) overrides.set(e.uid, [...(overrides.get(e.uid) ?? []), e]);
  const out: IcsEvent[] = [];
  for (const e of events) {
    if (e.recurrenceId !== null) continue;
    const dur = e.end ? e.end.ms - e.start.ms : e.duration ?? (e.start.allDay ? 86400_000 : 0);
    const replaced = new Set((overrides.get(e.uid) ?? []).map((o) => o.recurrenceId));
    if (!e.cancelled)
      for (const t of expand(e, from, to)) {
        if (replaced.has(t)) continue;
        const endT = e.start.allDay ? shiftDays(t, Math.max(1, Math.round(dur / 86400_000)), e) : t + dur;
        if (endT >= from && t <= to) out.push({ uid: e.uid, title: e.title, start: t, end: endT, allDay: e.start.allDay });
      }
    for (const o of overrides.get(e.uid) ?? []) {
      if (o.cancelled) continue;
      const odur = o.end ? o.end.ms - o.start.ms : o.duration ?? dur;
      const endT = o.start.ms + odur;
      if (endT >= from && o.start.ms <= to) out.push({ uid: o.uid, title: o.title, start: o.start.ms, end: endT, allDay: o.start.allDay });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function buildEvent(props: RawProp[]): VEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const ds = get('DTSTART');
  if (!ds) return null;
  const start = parseTime(ds);
  if (!start) return null;
  const de = get('DTEND');
  const exdates = new Set<number>();
  for (const p of props.filter((x) => x.name === 'EXDATE'))
    for (const v of p.value.split(',')) {
      const t = parseTime({ ...p, value: v });
      if (t) exdates.add(t.ms);
    }
  const rr = get('RRULE');
  const rrule = rr ? Object.fromEntries(rr.value.split(';').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.toUpperCase(), v])) : null;
  const rid = get('RECURRENCE-ID');
  return {
    uid: get('UID')?.value ?? Math.random().toString(36),
    title: unescapeText(get('SUMMARY')?.value ?? '(제목 없음)') || '(제목 없음)',
    start,
    end: de ? parseTime(de) : null,
    duration: get('DURATION') ? parseDuration(get('DURATION')!.value) : null,
    rrule,
    exdates,
    recurrenceId: rid ? parseTime(rid)?.ms ?? null : null,
    cancelled: (get('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED',
    // TZID가 없고 'Z'(UTC)로 끝나면 반복 규칙(BYDAY 등)을 UTC 기준으로 계산해야 한다 (RFC 5545)
    tzid: ds.params.TZID ?? (/Z$/i.test(ds.value.trim()) ? 'UTC' : undefined),
  };
}

/** webcal:// 주소를 https://로, 앞뒤 공백 제거 */
export function normalizeIcsUrl(url: string): string {
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

export function looksLikeIcsUrl(url: string): boolean {
  return /^(https?|webcal):\/\/\S+$/i.test(url.trim());
}

/** 구글 캘린더 '일정 만들기' 화면 주소 (내용을 채운 채로 브라우저에서 열림) */
export function googleAddUrl(o: { title: string; date: string; time?: string; minutes?: number }): string {
  const [y, m, d] = o.date.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  let dates: string;
  if (o.time) {
    const [h, mi] = o.time.split(':').map(Number);
    const s = new Date(y, m - 1, d, h, mi);
    const e = new Date(s.getTime() + (o.minutes ?? 60) * 60000);
    const f = (x: Date) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    dates = `${f(s)}/${f(e)}`;
  } else {
    const n = new Date(y, m - 1, d + 1);
    dates = `${y}${pad(m)}${pad(d)}/${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}`;
  }
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(o.title)}&dates=${dates}`;
}
