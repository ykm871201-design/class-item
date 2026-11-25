// 타이머 상태 전이 — 남은 시간은 종료 예정 시각(endAt)과 현재 시각의 차이로 계산하므로
// 화면 갱신 횟수·창 최소화·지연과 무관하게 정확하다.
import type { SoundId, TimerDisplayMode, TimerState } from './types';
import { newId } from './util';

export function idleTimer(prev?: Partial<TimerState>): TimerState {
  return {
    status: 'idle',
    durationMs: prev?.durationMs ?? 5 * 60_000,
    endAt: 0,
    remainingMs: prev?.durationMs ?? 5 * 60_000,
    activity: prev?.activity ?? '',
    sound: prev?.sound ?? 'chime',
    volume: prev?.volume ?? 70,
    mode: prev?.mode ?? 'split',
    source: 'manual',
    shown: false,
    warnFrom: prev?.warnFrom ?? 0,
    alerted: [],
    runId: newId('t_'),
  };
}

export function remainingMs(t: TimerState, now: number): number {
  if (t.status === 'running') return Math.max(0, t.endAt - now);
  if (t.status === 'finished') return 0;
  return Math.max(0, t.remainingMs);
}

export interface StartOptions {
  durationMs: number;
  activity: string;
  sound: SoundId;
  volume: number;
  mode: TimerDisplayMode;
  source: 'manual' | 'schedule';
  scheduleId?: string;
  warnFrom?: number;
}

export function startTimer(o: StartOptions, now: number): TimerState {
  return {
    status: 'running',
    durationMs: o.durationMs,
    endAt: now + o.durationMs,
    remainingMs: o.durationMs,
    activity: o.activity,
    sound: o.sound,
    volume: o.volume,
    mode: o.mode,
    source: o.source,
    scheduleId: o.scheduleId,
    shown: true,
    warnFrom: normalizeWarnFrom(o.warnFrom),
    alerted: [],
    runId: newId('t_'),
  };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  if (t.status !== 'running') return t;
  return { ...t, status: 'paused', remainingMs: Math.max(0, t.endAt - now), endAt: 0 };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  if (t.status !== 'paused') return t;
  return { ...t, status: 'running', endAt: now + t.remainingMs };
}

/** 처음 길이로 되돌림 (멈춘 상태) */
export function resetTimer(t: TimerState): TimerState {
  return { ...t, status: 'paused', remainingMs: t.durationMs, endAt: 0, finishedAt: undefined, alerted: [], runId: newId('t_') };
}

/** 시간 경과 반영. 종료로 바뀌면 justFinished=true (알림음은 이때 한 번만) */
export function tickTimer(t: TimerState, now: number): { timer: TimerState; justFinished: boolean } {
  if (t.status === 'running' && now >= t.endAt) {
    return { timer: { ...t, status: 'finished', remainingMs: 0, finishedAt: now }, justFinished: true };
  }
  return { timer: t, justFinished: false };
}

export function setTimerMode(t: TimerState, mode: TimerDisplayMode): TimerState {
  return { ...t, mode }; // 남은 시간·일시정지 상태는 그대로
}

// ---------------- 종료 예고음 ----------------

export const WARN_FROM_CHOICES: { sec: number; label: string }[] = [
  { sec: 0, label: '없음' },
  { sec: 180, label: '3분 전부터' },
  { sec: 60, label: '1분 전부터' },
  { sec: 30, label: '30초 전부터' },
  { sec: 10, label: '10초 전부터' },
];

/** 마지막 이 시간(초) 동안은 더 높은 소리 */
export const URGENT_SEC = 10;

export function normalizeWarnFrom(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(3600, n) : 0;
}

export function warnFromLabel(sec: number): string {
  if (!sec) return '없음';
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60}분 전부터` : `${sec}초 전부터`;
}

export interface TimerAlert {
  key: string;
  kind: 'tick' | 'tick-urgent';
}

/**
 * 지금 울려야 할 종료 예고음.
 * 끝나기 warnFrom초 전부터(타이머가 그보다 짧으면 처음부터) 종료 때까지 남은 초가 바뀔 때마다 한 번씩 울린다.
 * 마지막 10초는 더 높은 소리. 일시정지 중에는 울리지 않는다.
 * 감지가 늦어(절전 등) 지나간 초는 몰아서 울리지 않고 현재 초만 울린다.
 */
export function pendingAlerts(t: TimerState, now: number): { play: TimerAlert[] } {
  if (t.status !== 'running' || !t.warnFrom) return { play: [] };
  const rem = t.endAt - now;
  if (rem <= 0 || rem > t.warnFrom * 1000) return { play: [] };
  const sec = Math.ceil(rem / 1000); // 화면에 보이는 남은 초
  const key = 's' + sec;
  if (t.alerted.includes(key)) return { play: [] };
  return { play: [{ key, kind: sec <= URGENT_SEC ? 'tick-urgent' : 'tick' }] };
}
