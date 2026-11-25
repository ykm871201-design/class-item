import { describe, it, expect } from 'vitest';
import { pendingAlerts, startTimer, pauseTimer, resumeTimer } from '../src/shared/timer';
import { compareVersions } from '../src/shared/version';
import { Controller, type Ports } from '../src/main/controller';
import { defaultData, normalizeData } from '../src/shared/defaults';

const start = (sec: number, warnFrom: number, now = 0) => startTimer({ durationMs: sec * 1000, activity: '', sound: 'chime', volume: 70, mode: 'split', source: 'manual', warnFrom }, now);

/** 250ms 간격으로 시간을 흘려 보내며 울린 예고음을 모음 (메인 프로세스 감시 주기와 같음) */
function simulate(t: ReturnType<typeof start>, until: number, from = 0) {
  const played: string[] = [];
  for (let now = from; now <= until; now += 250) {
    const { play } = pendingAlerts(t, now);
    for (const p of play) played.push(`${p.key}:${p.kind}`);
    t = { ...t, alerted: [...t.alerted, ...play.map((p) => p.key)] };
  }
  return played;
}

describe('종료 예고음 (정한 시점부터 끝날 때까지 1초마다)', () => {
  it('5분 타이머 · 1분 전부터 → 남은 60초부터 1초마다 60번, 마지막 10초는 높은 소리', () => {
    const p = simulate(start(300, 60), 300_000);
    expect(p.length).toBe(60);
    expect(p[0]).toBe('s60:tick');
    expect(p.filter((x) => x.endsWith(':tick-urgent')).length).toBe(10);
    expect(p[p.length - 1]).toBe('s1:tick-urgent');
    expect(new Set(p).size).toBe(60); // 같은 초에 두 번 울리지 않음
  });
  it('예고음 없음이면 울리지 않음', () => {
    expect(simulate(start(60, 0), 60_000).length).toBe(0);
  });
  it('타이머가 더 짧으면 처음부터 울림 (20초 타이머 · 30초 전부터 → 20번)', () => {
    expect(simulate(start(20, 30), 20_000).length).toBe(20);
  });
  it('일시정지 중에는 울리지 않고, 계속하면 이어서 울림', () => {
    let t = start(60, 30);
    const before = simulate(t, 40_000); // 남은 30~20초 구간
    t = { ...t, alerted: before.map((x) => x.split(':')[0]) };
    const paused = pauseTimer(t, 40_000);
    expect(pendingAlerts(paused, 100_000).play).toEqual([]);
    const resumed = resumeTimer(paused, 100_000); // 남은 20초
    const after = simulate(resumed, 120_000, 100_000);
    expect(before.length).toBe(11); // 남은 30~20초
    expect(after.length).toBe(19); // 남은 19~1초 (20초는 멈추기 전에 이미 울림)
    expect(before.length + after.length).toBe(30); // 같은 초가 두 번 울리지 않음
  });
  it('절전 복귀 등으로 감지가 늦으면 지난 초를 몰아서 울리지 않음', () => {
    const t = start(60, 30);
    expect(pendingAlerts(t, 50_500).play.map((p) => p.key)).toEqual(['s10']);
  });
});

describe('컨트롤러: 예고음 → 알림음 순서와 횟수', () => {
  it('30초 타이머 · 10초 전부터: 예고음 10번 후 종료 알림음 1번', () => {
    const sounds: string[] = [];
    const ports: Ports = {
      persist: () => {}, showStudent: () => true, hideStudent: () => {}, applyTopmost: () => {}, notify: () => {}, broadcast: () => {},
      playSound: (p) => sounds.push(p.sound), studentWindowStatus: () => ({ visible: true, mode: 'display', fullscreen: true, displayAvailable: true, displayLabel: '', alwaysOnTop: true }), displays: () => [],
    };
    const ctl = new Controller(defaultData(), ports, { userDataPath: '', appVersion: 't' });
    let now = 1_000_000;
    ctl.now = () => now;
    ctl.dispatch({ type: 'timer/start', durationSec: 30, activity: '', sound: 'bell', volume: 50, mode: 'split', warnFrom: 10 });
    for (; now <= 1_000_000 + 33_000; now += 250) ctl.tick();
    expect(sounds.filter((x) => x.startsWith('tick')).length).toBe(10);
    expect(sounds.filter((x) => x === 'bell').length).toBe(1);
    expect(sounds[sounds.length - 1]).toBe('bell');
    expect(ctl.data.settings.timerWarnFrom).toBe(10); // 다음 타이머 기본값으로 기억
  });
  it('예약에 저장한 예고음 설정이 저장·복원됨', () => {
    const d = defaultData();
    d.schedules.push({ id: 's1', name: '쉬는 시간', enabled: true, time: '10:20', durationSec: 300, repeat: 'weekly', date: '', days: [1], activity: '', sound: 'chime', volume: 70, displayMode: 'split', warnFrom: 60, createdAt: 0, activeSince: 0 });
    expect(normalizeData(JSON.parse(JSON.stringify(d))).schedules[0].warnFrom).toBe(60);
  });
});

describe('업데이트 버전 비교', () => {
  it('새 버전 판단', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
    expect(compareVersions('1.0.9', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('abc', '1.0.0')).toBe(0);
  });
});
