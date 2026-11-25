// 바탕화면 위젯 보드: 창 관리와 바깥 정보(구글 캘린더 iCal·날씨·급식) 받아 오기
// - 구글 캘린더 주소는 Windows 계정 암호화(safeStorage)로 저장하고, 화면(렌더러)에는 보내지 않는다.
// - 인터넷이 없으면 마지막으로 받은 정보를 그대로 보여 준다.
import { BrowserWindow, net, safeStorage, screen, shell } from 'electron';
import path from 'node:path';
import type { Controller } from './controller';
import type { CalEvent } from '../shared/types';
import { googleAddUrl, looksLikeIcsUrl, normalizeIcsUrl, parseIcs } from '../shared/ical';
import { REGIONS, cleanDishes } from '../shared/widget';
import { CALENDAR_COLORS } from '../shared/defaults';
import { localDateKey, newId } from '../shared/util';

const WEATHER_URL = process.env.CT_WEATHER_URL || 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = process.env.CT_AIR_URL || 'https://air-quality-api.open-meteo.com/v1/air-quality';
const NEIS_URL = process.env.CT_NEIS_URL || 'https://open.neis.go.kr/hub';
const UA = { 'User-Agent': 'ClassroomTools-Widget' };

export function encryptSecret(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}

export function decryptSecret(stored: string): string | null {
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch {
    /* 다른 PC·다른 Windows 계정에서 가져온 데이터는 풀 수 없음 */
  }
  return null;
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 404 ? '주소를 찾을 수 없습니다 (404)' : res.status === 401 || res.status === 403 ? '접근이 거부되었습니다. 주소가 맞는지 확인해 주세요' : `서버 오류 (${res.status})`);
    return await res.text();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('응답이 너무 늦습니다');
    if (String(e?.message ?? '').includes('net::')) throw new Error('인터넷에 연결할 수 없습니다');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export class WidgetManager {
  win: BrowserWindow | null = null;
  private saveBoundsTimer: NodeJS.Timeout | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private ctl: Controller,
    private opts: { preload: string; html: string; icon: string; log: (m: string) => void; isQuitting: () => boolean },
  ) {}

  // ---------------- 창 ----------------
  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const wa = screen.getPrimaryDisplay().workArea;
    const saved = this.ctl.data.widget.bounds;
    const onScreen = saved && screen.getAllDisplays().some((d) => saved.x < d.bounds.x + d.bounds.width - 80 && saved.x + saved.width > d.bounds.x + 80 && saved.y >= d.bounds.y - 20 && saved.y < d.bounds.y + d.bounds.height - 80);
    // 기본: 주 모니터의 왼쪽 바탕화면 아이콘 자리를 비우고 나머지를 채움
    const def = { x: wa.x + Math.min(140, Math.round(wa.width * 0.08)), y: wa.y, width: wa.width - Math.min(140, Math.round(wa.width * 0.08)), height: wa.height };
    const b = onScreen ? saved! : def;
    const w = new BrowserWindow({
      ...b,
      minWidth: 560,
      minHeight: 400,
      frame: false,
      show: false,
      skipTaskbar: true,
      title: '교실 도구 위젯',
      backgroundColor: '#d0ebff',
      icon: this.opts.icon,
      webPreferences: { preload: this.opts.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    w.setMenu(null);
    w.loadFile(this.opts.html);
    w.on('close', (e) => {
      if (this.opts.isQuitting()) return;
      e.preventDefault();
      this.hide();
    });
    const remember = () => {
      if (this.saveBoundsTimer) clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = setTimeout(() => {
        if (!w.isDestroyed() && !w.isMinimized() && !w.isMaximized()) {
          this.ctl.data.widget.bounds = w.getBounds();
          this.ctl.changed(true);
        }
      }, 600);
    };
    w.on('move', remember);
    w.on('resize', remember);
    for (const ev of ['show', 'hide', 'minimize', 'restore'] as const) w.on(ev as any, () => this.syncVisible());
    // 링크는 기본 브라우저로
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.win = w;
    return w;
  }

  private syncVisible() {
    const v = !!this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized();
    if (this.ctl.rt.widget.visible !== v) {
      this.ctl.rt.widget = { ...this.ctl.rt.widget, visible: v };
      this.ctl.changed(false);
    }
  }

  show(): void {
    const w = this.ensure();
    if (w.isMinimized()) w.restore();
    w.showInactive();
    this.syncVisible();
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
    this.syncVisible();
  }

  toggle(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized()) this.hide();
    else this.show();
  }

  resetPosition(): void {
    this.ctl.data.widget.bounds = null;
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close');
      this.win.destroy();
      this.win = null;
    }
    this.show();
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  // ---------------- 주기적 갱신 ----------------
  start(): void {
    const run = () => {
      this.refreshCalendars().catch(() => {});
      this.refreshWeather().catch(() => {});
      this.refreshMeal().catch(() => {});
    };
    setTimeout(run, 2000);
    this.timers.push(setInterval(() => this.refreshCalendars().catch(() => {}), 15 * 60_000));
    this.timers.push(setInterval(() => this.refreshWeather().catch(() => {}), 30 * 60_000));
    // 급식: 날짜가 바뀌면 새로 (1시간마다 확인)
    this.timers.push(setInterval(() => {
      const m = this.ctl.rt.widget.meal;
      if (!m || m.date !== localDateKey(Date.now()) || Date.now() - m.fetchedAt > 6 * 3600_000) this.refreshMeal().catch(() => {});
    }, 60 * 60_000));
  }

  // ---------------- 구글 캘린더 (iCal) ----------------
  async addCalendar(name: string, url: string): Promise<{ ok: boolean; error?: string; count?: number }> {
    const u = normalizeIcsUrl(url);
    if (!looksLikeIcsUrl(u)) return { ok: false, error: 'iCal 주소 형식이 아닙니다. 구글 캘린더 설정의 ‘iCal 형식의 비공개 주소’를 복사해 붙여넣어 주세요.' };
    let text: string;
    try {
      text = await fetchText(u);
    } catch (e: any) {
      return { ok: false, error: `캘린더를 받지 못했습니다: ${e?.message ?? e}` };
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: '받은 내용이 캘린더(iCal) 형식이 아닙니다. 주소를 다시 확인해 주세요.' };
    const nameFromIcs = /X-WR-CALNAME:(.+)/i.exec(text)?.[1]?.trim();
    const w = this.ctl.data.widget;
    const id = newId('cal_');
    w.calendars.push({ id, name: (name.trim() || nameFromIcs || '구글 캘린더').slice(0, 30), color: CALENDAR_COLORS[w.calendars.length % CALENDAR_COLORS.length], enabled: true, showOnStudent: false, urlEnc: encryptSecret(u) });
    const count = this.applyIcs(id, text);
    this.ctl.changed(true);
    this.opts.log(`구글 캘린더 연결: 일정 ${count}개`);
    return { ok: true, count };
  }

  private applyIcs(calId: string, text: string): number {
    const now = Date.now();
    const from = now - 400 * 86400_000;
    const to = now + 400 * 86400_000;
    const evs: CalEvent[] = parseIcs(text, from, to).map((e, i) => ({ id: `${calId}-${i}`, calId, title: e.title, start: e.start, end: e.end, allDay: e.allDay, color: '' }));
    const rt = this.ctl.rt.widget;
    this.ctl.rt.widget = {
      ...rt,
      googleEvents: [...rt.googleEvents.filter((e) => e.calId !== calId), ...evs],
      calStatus: { ...rt.calStatus, [calId]: { ok: true, fetchedAt: now, count: evs.length } },
    };
    return evs.length;
  }

  async refreshCalendars(): Promise<void> {
    for (const c of this.ctl.data.widget.calendars) {
      if (!c.enabled) continue;
      const url = decryptSecret(c.urlEnc);
      if (!url) {
        this.setCalStatus(c.id, { ok: false, error: '저장된 주소를 열 수 없습니다 (다른 PC에서 가져온 데이터). 주소를 다시 넣어 주세요.' });
        continue;
      }
      try {
        const text = await fetchText(url);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('캘린더 형식이 아닙니다');
        this.applyIcs(c.id, text);
      } catch (e: any) {
        const prev = this.ctl.rt.widget.calStatus[c.id];
        this.setCalStatus(c.id, { ok: false, fetchedAt: prev?.fetchedAt, count: prev?.count, error: String(e?.message ?? e) });
      }
    }
    this.ctl.changed(false);
  }

  private setCalStatus(id: string, st: { ok: boolean; error?: string; fetchedAt?: number; count?: number }) {
    const rt = this.ctl.rt.widget;
    this.ctl.rt.widget = { ...rt, calStatus: { ...rt.calStatus, [id]: st } };
  }

  async replaceCalendarUrl(id: string, url: string): Promise<{ ok: boolean; error?: string }> {
    const c = this.ctl.data.widget.calendars.find((x) => x.id === id);
    if (!c) return { ok: false, error: '캘린더를 찾을 수 없습니다.' };
    const u = normalizeIcsUrl(url);
    if (!looksLikeIcsUrl(u)) return { ok: false, error: 'iCal 주소 형식이 아닙니다.' };
    try {
      const text = await fetchText(u);
      if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: '캘린더(iCal) 형식이 아닙니다.' };
      c.urlEnc = encryptSecret(u);
      this.applyIcs(id, text);
      this.ctl.changed(true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  openGoogleAdd(o: { title: string; date: string; time?: string }): void {
    shell.openExternal(googleAddUrl(o));
  }

  // ---------------- 날씨 (Open-Meteo, 키 필요 없음) ----------------
  async refreshWeather(): Promise<void> {
    const r = REGIONS.find((x) => x.id === this.ctl.data.widget.weatherRegion) ?? REGIONS[0];
    try {
      const q = `latitude=${r.lat}&longitude=${r.lon}&timezone=Asia%2FSeoul`;
      const w = JSON.parse(await fetchText(`${WEATHER_URL}?${q}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1`));
      let pm10: number | undefined;
      let pm25: number | undefined;
      try {
        const a = JSON.parse(await fetchText(`${AIR_URL}?${q}&current=pm10,pm2_5`));
        pm10 = a?.current?.pm10 ?? undefined;
        pm25 = a?.current?.pm2_5 ?? undefined;
      } catch {
        /* 미세먼지는 없어도 됨 */
      }
      this.ctl.rt.widget = {
        ...this.ctl.rt.widget,
        weatherError: undefined,
        weather: { fetchedAt: Date.now(), temp: w.current.temperature_2m, code: w.current.weather_code, max: w.daily.temperature_2m_max[0], min: w.daily.temperature_2m_min[0], rainProb: w.daily.precipitation_probability_max?.[0] ?? 0, pm10, pm25 },
      };
    } catch (e: any) {
      this.ctl.rt.widget = { ...this.ctl.rt.widget, weatherError: String(e?.message ?? e) };
    }
    this.ctl.changed(false);
  }

  // ---------------- 급식 (나이스 교육정보 개방 포털) ----------------
  async searchSchool(name: string): Promise<{ ok: boolean; error?: string; schools?: { office: string; code: string; name: string; addr: string; kind: string }[] }> {
    if (!name.trim()) return { ok: false, error: '학교 이름을 입력해 주세요.' };
    try {
      const j = JSON.parse(await fetchText(`${NEIS_URL}/schoolInfo?Type=json&pIndex=1&pSize=20&SCHUL_NM=${encodeURIComponent(name.trim())}`));
      const rows = j?.schoolInfo?.[1]?.row ?? [];
      return { ok: true, schools: rows.map((r: any) => ({ office: r.ATPT_OFCDC_SC_CODE, code: r.SD_SCHUL_CODE, name: r.SCHUL_NM, addr: r.ORG_RDNMA ?? '', kind: r.SCHUL_KND_SC_NM ?? '' })) };
    } catch (e: any) {
      return { ok: false, error: `학교를 찾지 못했습니다: ${e?.message ?? e}` };
    }
  }

  async refreshMeal(dateKey = localDateKey(Date.now())): Promise<void> {
    const sc = this.ctl.data.widget.school;
    if (!sc) return;
    try {
      const ymd = dateKey.replace(/-/g, '');
      const j = JSON.parse(await fetchText(`${NEIS_URL}/mealServiceDietInfo?Type=json&ATPT_OFCDC_SC_CODE=${sc.office}&SD_SCHUL_CODE=${sc.code}&MLSV_YMD=${ymd}`));
      const rows = j?.mealServiceDietInfo?.[1]?.row ?? [];
      const lunch = rows.find((r: any) => String(r.MMEAL_SC_NM ?? '').includes('중식')) ?? rows[0];
      if (!lunch) this.ctl.rt.widget = { ...this.ctl.rt.widget, mealError: undefined, meal: { date: dateKey, dishes: [], allergies: [], fetchedAt: Date.now(), note: '오늘은 급식 정보가 없습니다' } };
      else {
        const { dishes, allergies } = cleanDishes(String(lunch.DDISH_NM ?? ''));
        this.ctl.rt.widget = { ...this.ctl.rt.widget, mealError: undefined, meal: { date: dateKey, dishes, allergies, fetchedAt: Date.now() } };
      }
    } catch (e: any) {
      this.ctl.rt.widget = { ...this.ctl.rt.widget, mealError: String(e?.message ?? e) };
    }
    this.ctl.changed(false);
  }
}
