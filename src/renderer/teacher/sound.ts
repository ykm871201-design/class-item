// 알림음: Web Audio로 직접 합성 (외부 파일·인터넷 불필요)
import type { SoundId } from '../../shared/types';

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(c: AudioContext, out: AudioNode, freq: number, start: number, dur: number, type: OscillatorType, peak: number, attack = 0.015) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
}

export type AnySound = SoundId | 'tick';

/**
 * 한 번 재생. 반환값: 재생 길이(초)
 * at(epoch ms)을 주면 그 시각에 맞춰 오디오 시계로 예약 재생한다 (예고음 간격이 고르게 들리도록).
 * 이미 지난 시각이면 바로 재생.
 */
export function playSound(id: AnySound, volume: number, at?: number): number {
  if (id === 'none' || volume <= 0) return 0;
  const c = ac();
  const master = c.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume / 100)) * (id === 'tick' ? 1 : 0.9);
  master.connect(c.destination);
  const delay = at ? Math.min(2, Math.max(0, (at - Date.now()) / 1000)) : 0;
  const t = c.currentTime + 0.02 + delay;
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
      // 종료 예고음: 매번 똑같은 맑은 ‘띡’ (높이·길이·크기 일정, 마지막까지 같은 소리)
      tone(c, master, 1046.5, t, 0.16, 'sine', 0.85, 0.005);
      tone(c, master, 2093, t, 0.07, 'sine', 0.12, 0.005);
      return 0.2;
    }
    case 'beep': {
      for (let k = 0; k < 3; k++) tone(c, master, 880, t + k * 0.32, 0.2, 'square', 0.18);
      return 1.1;
    }
  }
  return 0;
}
