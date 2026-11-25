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
  return { ...t, status: 'paused', remainingMs: t.durationMs, endAt: 0, finishedAt: undefined, runId: newId('t_') };
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
