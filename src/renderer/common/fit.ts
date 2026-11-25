// 글자가 영역 안에 잘리지 않고 들어가는 최대 글자 크기 계산
export interface FitStyle {
  bold: boolean;
  align: 'left' | 'center';
  lineHeight: number;
}

let measurer: HTMLDivElement | null = null;

function getMeasurer(): HTMLDivElement {
  if (measurer && document.body.contains(measurer)) return measurer;
  measurer = document.createElement('div');
  measurer.setAttribute('aria-hidden', 'true');
  Object.assign(measurer.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);
  measurer.className = 'board-text-measure';
  document.body.appendChild(measurer);
  return measurer;
}

/** width×height 안에 text가 들어가는 최대 px (maxPx 이하). 잘라내지 않고 줄바꿈만 허용 */
export function fitFontPx(text: string, width: number, height: number, maxPx: number, style: FitStyle): number {
  if (width <= 4 || height <= 4) return 8;
  const el = getMeasurer();
  el.style.width = `${Math.floor(width)}px`;
  el.style.fontWeight = style.bold ? '800' : '500';
  el.style.textAlign = style.align;
  el.style.lineHeight = String(style.lineHeight);
  el.textContent = text.length ? text + (text.endsWith('\n') ? ' ' : '') : ' ';
  const fits = (px: number) => {
    el.style.fontSize = `${px}px`;
    return el.scrollHeight <= height && el.scrollWidth <= Math.ceil(width) + 1;
  };
  let lo = 6;
  let hi = Math.max(lo, Math.floor(maxPx));
  if (fits(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

let canvas: HTMLCanvasElement | null = null;
/** 글자 크기 100px일 때 가장 긴 이름의 실제 너비(px) */
export function widestAt100(names: string[], weight = 800): number {
  if (!canvas) canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  if (!ctx) return Math.max(2, ...names.map((n) => [...n].length)) * 100;
  ctx.font = `${weight} 100px ${family}`;
  let w = 0;
  for (const n of names) w = Math.max(w, ctx.measureText(n).width);
  return Math.max(w, 120);
}
