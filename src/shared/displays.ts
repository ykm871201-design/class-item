// 학생용 디스플레이 선택 (Windows 디스플레이 번호를 가정하지 않음)
import type { DisplayRef } from './types';

export interface DisplayInfo extends DisplayRef {
  primary: boolean;
}

/**
 * 저장된 선택과 현재 연결된 디스플레이를 비교하여 학생용 디스플레이를 고른다.
 * 1) 저장된 선택이 있으면 같은 ID → 같은 위치·해상도 → 같은 이름 순으로 찾는다 (교사가 직접 고른 것이므로 주 모니터도 허용).
 * 2) 찾지 못하면 주 모니터가 아닌 첫 번째 디스플레이.
 * 3) 주 모니터 하나뿐이면 null (교사용 화면을 임의로 덮지 않는다).
 */
export function resolveStudentDisplay(displays: DisplayInfo[], saved: DisplayRef | null): { display: DisplayInfo | null; matchedSaved: boolean } {
  if (saved) {
    const byId = displays.find((d) => d.id === saved.id);
    if (byId) return { display: byId, matchedSaved: true };
    const byGeom = displays.find((d) => d.x === saved.x && d.y === saved.y && d.width === saved.width && d.height === saved.height);
    if (byGeom) return { display: byGeom, matchedSaved: true };
    const byLabel = saved.label ? displays.find((d) => d.label === saved.label && !d.primary) : undefined;
    if (byLabel) return { display: byLabel, matchedSaved: true };
  }
  const secondary = displays.find((d) => !d.primary) ?? null;
  return { display: secondary, matchedSaved: false };
}

export function displayName(d: DisplayInfo, index: number): string {
  const label = d.label && d.label.trim() ? d.label.trim() : `디스플레이 ${index + 1}`;
  return `${index + 1}번: ${label} (${d.width}×${d.height})${d.primary ? ' · 주 모니터' : ''}`;
}
