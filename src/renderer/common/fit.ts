// 글자가 영역 안에 잘리지 않고 들어가는 최대 글자 크기 계산
export interface FitStyle {
  bold: boolean;
  align: 'left' | 'center';
  lineHeight: number;
  /** 'normal'이면 낱말 중간에서 줄을 바꾸지 않음 (낱말이 너무 길면 맞지 않는 것으로 판단) */
  wrap?: 'anywhere' | 'normal';
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
  el.style.overflowWrap = style.wrap ?? 'anywhere';
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

// ---------------- ㄱ자 영역 (오른쪽 아래가 비어 있는 칸) ----------------

let lbox: { box: HTMLDivElement; f1: HTMLDivElement; f2: HTMLDivElement; pad: HTMLDivElement; text: HTMLDivElement } | null = null;

function getLBox() {
  if (lbox && document.body.contains(lbox.box)) return lbox;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none' } as CSSStyleDeclaration);
  box.className = 'board-text-measure';
  const f1 = document.createElement('div');
  const f2 = document.createElement('div');
  const pad = document.createElement('div');
  const text = document.createElement('div');
  Object.assign(f1.style, { float: 'right', width: '0' });
  Object.assign(f2.style, { float: 'right', clear: 'right' });
  Object.assign(text.style, { whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'anywhere' });
  box.append(f1, f2, pad, text);
  document.body.appendChild(box);
  lbox = { box, f1, f2, pad, text };
  return lbox;
}

export interface LShape {
  width: number;
  height: number;
  cutW: number; // 오른쪽 아래 비워 둘 너비
  cutH: number; // 오른쪽 아래 비워 둘 높이
}

/**
 * width×height 칸에서 오른쪽 아래 cutW×cutH를 비워 둔 ㄱ자 영역에 글을 넣는다.
 * 위쪽 줄은 전체 너비를, 비운 칸 옆 줄은 남은 왼쪽 너비를 쓴다 (글자가 비운 칸을 가리지 않음).
 * 반환: 글자 크기와, 세로 정렬을 위한 위쪽 여백
 */
export function fitLShape(text: string, shape: LShape, maxPx: number, style: FitStyle, vAlign: 'top' | 'middle' | 'bottom' = 'top'): { px: number; offset: number } {
  const { width, height, cutW, cutH } = shape;
  if (width <= 4 || height <= 4) return { px: 8, offset: 0 };
  const m = getLBox();
  m.box.style.width = `${Math.floor(width)}px`;
  m.box.style.height = `${Math.floor(height)}px`;
  m.f1.style.height = `${Math.max(0, Math.floor(height - cutH))}px`;
  m.f2.style.width = `${Math.ceil(cutW)}px`;
  m.f2.style.height = `${Math.ceil(cutH)}px`;
  m.text.style.fontWeight = style.bold ? '800' : '500';
  m.text.style.textAlign = style.align;
  m.text.style.lineHeight = String(style.lineHeight);
  m.text.textContent = text.length ? text + (text.endsWith('\n') ? ' ' : '') : ' ';
  /** 이 크기·위쪽 여백에서 글의 아래 끝 (넘치면 height보다 큼) */
  const bottomAt = (px: number, off: number) => {
    m.text.style.fontSize = `${px}px`;
    m.pad.style.height = `${off}px`;
    return m.text.offsetTop + m.text.offsetHeight;
  };
  const fits = (px: number) => bottomAt(px, 0) <= height;
  const search = (ok: (px: number) => boolean, top: number) => {
    let lo = 6;
    let hi = Math.max(lo, Math.floor(top));
    if (ok(hi)) return hi;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // 1) 줄을 나눠도 되면 가장 큰 크기
  const pxAny = search(fits, maxPx);
  // 2) 쓴 줄을 하나도 나누지 않고(한 줄은 한 줄로) 들어가는 가장 큰 크기
  const paras = text.replace(/\n$/, '').split('\n').length;
  const lineCount = () => {
    const r = document.createRange();
    r.selectNodeContents(m.text);
    return new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top))).size;
  };
  const noSplit = (px: number) => fits(px) && lineCount() <= paras;
  const pxNoSplit = search(noSplit, pxAny);
  // 줄을 나누지 않아도 글자가 충분히 크면(70% 이상) 그쪽을 쓴다: 남는 공간이 비고 줄이 쪼개지는 것을 피함
  const px = noSplit(pxNoSplit) && pxNoSplit >= pxAny * 0.7 ? pxNoSplit : pxAny;
  if (vAlign === 'top') return { px, offset: 0 };
  // 세로 정렬: 남는 높이만큼 위쪽 여백을 준다. 여백 때문에 줄이 비운 칸 옆으로 내려가면
  // 다시 줄바꿈되어 높이가 달라지므로, 넘치지 않는 가장 큰 여백을 찾는다
  const want = (off: number) => {
    const used = bottomAt(px, off) - off;
    return vAlign === 'middle' ? (height - used) / 2 : height - used;
  };
  let off = Math.max(0, want(0));
  for (let i = 0; i < 4; i++) off = Math.max(0, Math.min(off, want(off)));
  let a = 0;
  let b = off;
  if (bottomAt(px, b) > height) {
    for (let i = 0; i < 12; i++) {
      const mid = (a + b) / 2;
      if (bottomAt(px, mid) <= height) a = mid;
      else b = mid;
    }
    off = a;
  }
  return { px, offset: Math.floor(off) };
}
