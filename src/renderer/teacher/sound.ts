// 알림음: Web Audio로 직접 합성 (외부 파일·인터넷 불필요)
import type { SoundId } from '../../shared/types';

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(c: AudioContext, out: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

/** 한 번 재생. 반환값: 재생 길이(초) */
export type AnySound = SoundId | 'tick' | 'tick-urgent';

export function playSound(id: AnySound, volume: number): number {
  if (id === 'none' || volume <= 0) return 0;
  const c = ac();
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume / 100)) * 0.9;
  master.connect(c.destination);
  const t = c.currentTime + 0.05;
  switch (id) {
    case 'chime': {
      // 딩-동-댕
      const notes = [783.99, 659.25, 523.25];
      notes.forEach((f, i) => {
        tone(c, master, f, t + i * 0.45, 1.4, 'sine', 0.5);
        tone(c, master, f * 2, t + i * 0.45, 0.6, 'sine', 0.08);
      });
      return 2.4;
    }
    case 'bell': {
      for (let k = 0; k < 2; k++) {
        const s = t + k * 1.1;
        [1, 2.76, 5.4].forEach((m, i) => tone(c, master, 523.25 * m, s, 2.2 - i * 0.5, 'sine', [0.45, 0.18, 0.08][i]));
      }
      return 3.4;
    }
    case 'marimba': {
      const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      seq.forEach((f, i) => tone(c, master, f, t + i * 0.16, 0.5, 'triangle', 0.45));
      return 1.5;
    }
    case 'tick': {
      // 종료 예고음: 1초마다 부드러운 째깍
      tone(c, master, 880, t, 0.09, 'triangle', 0.28);
      return 0.1;
    }
    case 'tick-urgent': {
      // 마지막 10초: 더 높고 또렷한 삑
      tone(c, master, 1318.5, t, 0.16, 'square', 0.16);
      tone(c, master, 1318.5, t, 0.16, 'sine', 0.3);
      return 0.2;
    }
    case 'beep': {
      for (let k = 0; k < 3; k++) tone(c, master, 880, t + k * 0.32, 0.2, 'square', 0.18);
      return 1.1;
    }
  }
  return 0;
}
