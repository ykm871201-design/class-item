// 공용 유틸리티: ID, 난수, 날짜

export function newId(prefix = ''): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return prefix + s;
}

export type RandomInt = (maxExclusive: number) => number;

/** 편향 없는 정수 난수 [0, max) — 거부 샘플링 사용 */
export const cryptoRandomInt: RandomInt = (max) => {
  if (!Number.isInteger(max) || max <= 0) throw new Error('max must be positive integer');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
};

/** Fisher–Yates 셔플 (새 배열 반환) */
export function shuffle<T>(arr: readonly T[], rand: RandomInt = cryptoRandomInt): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 현지 날짜 'YYYY-MM-DD' */
export function localDateKey(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDateTimeKo(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAY_KO[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
