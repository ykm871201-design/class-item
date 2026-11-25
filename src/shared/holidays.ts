// 대한민국 공휴일 (양력 고정 + 음력 명절 표 + 대체공휴일)
import { localDateKey } from './util';

// 음력 명절의 양력 날짜 (설날·추석은 당일, 앞뒤 하루씩 함께 쉼)
const LUNAR: Record<number, { seollal: string; buddha: string; chuseok: string }> = {
  2025: { seollal: '2025-01-29', buddha: '2025-05-05', chuseok: '2025-10-06' },
  2026: { seollal: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
  2027: { seollal: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
  2028: { seollal: '2028-01-27', buddha: '2028-05-02', chuseok: '2028-10-03' },
  2029: { seollal: '2029-02-13', buddha: '2029-05-20', chuseok: '2029-09-22' },
  2030: { seollal: '2030-02-03', buddha: '2030-05-09', chuseok: '2030-09-12' },
};

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + n));
};
const dow = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** 해당 연도의 공휴일 (날짜 → 이름) */
export function koreanHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  const add = (k: string, name: string) => {
    if (out.has(k)) out.set(k, out.get(k) + '·' + name);
    else out.set(k, name);
  };
  const p = (m: number, d: number) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 대체공휴일 대상: 주말과 겹치는 날 (설날·추석은 일요일 또는 다른 공휴일과 겹칠 때)
  const weekendSubst: string[] = [];
  add(p(1, 1), '신정');
  for (const [m, d, n] of [[3, 1, '삼일절'], [5, 5, '어린이날'], [8, 15, '광복절'], [10, 3, '개천절'], [10, 9, '한글날'], [12, 25, '성탄절']] as const) {
    add(p(m, d), n);
    weekendSubst.push(p(m, d));
  }
  add(p(6, 6), '현충일');
  const l = LUNAR[year];
  const lunarSubst: string[] = [];
  if (l) {
    add(addDays(l.seollal, -1), '설날 연휴');
    add(l.seollal, '설날');
    add(addDays(l.seollal, 1), '설날 연휴');
    add(addDays(l.chuseok, -1), '추석 연휴');
    add(l.chuseok, '추석');
    add(addDays(l.chuseok, 1), '추석 연휴');
    add(l.buddha, '부처님오신날');
    weekendSubst.push(l.buddha);
    lunarSubst.push(addDays(l.seollal, -1), l.seollal, addDays(l.seollal, 1), addDays(l.chuseok, -1), l.chuseok, addDays(l.chuseok, 1));
  }
  const base = new Map(out);
  const isOff = (k: string) => out.has(k) || dow(k) === 0 || dow(k) === 6;
  const nextFree = (k: string) => {
    let x = addDays(k, 1);
    while (isOff(x)) x = addDays(x, 1);
    return x;
  };
  // 주말과 겹치는 국경일·어린이날·부처님오신날·성탄절 → 다음 평일
  for (const k of weekendSubst) {
    const w = dow(k);
    // 설날·추석 연휴와 겹친 경우는 아래 명절 규칙에서 한 번만 처리
    const overlaps = w === 0 || w === 6 || ((base.get(k) ?? '').includes('·') && !lunarSubst.includes(k));
    if (overlaps) add(nextFree(k), '대체공휴일');
  }
  // 설날·추석 연휴가 일요일 또는 다른 공휴일과 겹치면 연휴 다음 평일
  if (l) {
    let extra = 0;
    for (const k of lunarSubst.slice(0, 3)) if (dow(k) === 0 || (base.get(k) ?? '').includes('·')) extra++;
    let last = lunarSubst[2];
    for (let i = 0; i < extra; i++) {
      last = nextFree(last);
      add(last, '대체공휴일');
    }
    extra = 0;
    for (const k of lunarSubst.slice(3)) if (dow(k) === 0 || (base.get(k) ?? '').includes('·')) extra++;
    last = lunarSubst[5];
    for (let i = 0; i < extra; i++) {
      last = nextFree(last);
      add(last, '대체공휴일');
    }
  }
  return out;
}

export function holidayName(key: string): string | null {
  const y = Number(key.slice(0, 4));
  return koreanHolidays(y).get(key) ?? null;
}
