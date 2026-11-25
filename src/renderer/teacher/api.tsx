import { createContext, useContext, useEffect, useState } from 'react';
import type { FullState } from '../../shared/types';

export interface Api {
  getState(): Promise<FullState>;
  dispatch(a: { type: string; [k: string]: any }): Promise<{ ok: boolean; error?: string; [k: string]: any }>;
  app(a: { type: string; [k: string]: any }): Promise<{ ok: boolean; error?: string; [k: string]: any }>;
  confirm(o: { message: string; detail?: string; ok?: string; cancel?: string }): Promise<boolean>;
  onState(cb: (s: FullState) => void): () => void;
  onSound(cb: (p: { runId: string; sound: string; volume: number }) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
    __soundPlays?: string[];
  }
}

export const api = (): Api => window.api;

// ---- 알림 메시지 (토스트) ----
export type ToastKind = 'info' | 'ok' | 'warn' | 'err';
type Toast = { id: number; kind: ToastKind; text: string };
let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
let seq = 1;
export function toast(text: string, kind: ToastKind = 'info', ms = 4500) {
  const t = { id: seq++, kind, text };
  toasts = [...toasts.slice(-3), t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => dismissToast(t.id), kind === 'err' ? Math.max(ms, 7000) : ms);
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  listeners.forEach((l) => l(toasts));
}
export function useToasts(): Toast[] {
  const [t, setT] = useState(toasts);
  useEffect(() => {
    listeners.add(setT);
    return () => {
      listeners.delete(setT);
    };
  }, []);
  return t;
}

/** 동작 실행 — 실패하면 안내 메시지 표시 */
export async function act(type: string, payload: Record<string, any> = {}, okText?: string) {
  const r = await api().dispatch({ type, ...payload });
  if (!r.ok && r.error) toast(r.error, 'err');
  else if (r.ok && okText) toast(okText, 'ok', 2500);
  return r;
}

export const StateCtx = createContext<FullState | null>(null);
export function useAppState(): FullState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('no state');
  return s;
}
