// 칸 안에 글자가 잘리지 않게: 줄바꿈하고, 그래도 넘치면 글자 크기를 줄여 모든 글자를 보여 준다
import { useMemo } from 'react';
import { fitFontPx } from './fit';
import { useSize } from './hooks';

export function FitText({ text, ratio = 0.6, maxPx = 200, className = '', bold = true }: { text: string; ratio?: number; maxPx?: number; className?: string; bold?: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const fit = useMemo(() => {
    if (size.w <= 0 || size.h <= 0 || !text) return { px: 12, wrap: 'normal' as const };
    const max = Math.min(maxPx, size.h * (text === '—' ? 0.3 : ratio));
    const base = { bold, align: 'center' as const, lineHeight: 1.15 };
    // 반올림 차이로 넘치지 않도록 1~2px 여유
    const any = fitFontPx(text, size.w - 2, size.h - 2, max, { ...base, wrap: 'anywhere' });
    // 낱말 사이에서만 줄바꿈해도 충분히 크게 들어가면 그쪽을 쓴다 (읽기 쉬움)
    const word = fitFontPx(text, size.w - 2, size.h - 2, max, { ...base, wrap: 'normal' });
    return word >= any * 0.7 ? { px: word, wrap: 'normal' as const } : { px: any, wrap: 'anywhere' as const };
  }, [text, size.w, size.h, ratio, maxPx, bold]);
  return (
    <div ref={ref} className={`fit-text ${className}`} data-fit-text={text}>
      <span style={{ fontSize: fit.px, fontWeight: bold ? 800 : 500, overflowWrap: fit.wrap }}>{text}</span>
    </div>
  );
}
