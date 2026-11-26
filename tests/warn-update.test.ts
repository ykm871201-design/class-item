import { describe, it, expect } from 'vitest';
import { ALERT_LOOKAHEAD_MS, pendingAlerts, startTimer, pauseTimer, resumeTimer } from '../src/shared/timer';
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
  it('5분 타이머 · 1분 전부터 → 남은 60초부터 1초마다 60번, 끝까지 같은 소리', () => {
    const p = simulate(start(300, 60), 300_000);
    expect(p.length).toBe(60);
    expect(p[0]).toBe('s60:tick');
    expect(p.every((x) => x.endsWith(':tick'))).toBe(true);
    expect(p[p.length - 1]).toBe('s1:tick');
    expect(new Set(p).size).toBe(60); // 같은 초에 두 번 울리지 않음
  });
  it('미리 알림(lookahead): 감시 주기가 들쭉날쭉해도 울릴 시각은 정확히 1초 간격', () => {
    let t = start(30, 10);
    const ats: number[] = [];
    // 250ms ± 지터로 감시
    for (let now = 0, k = 0; now <= 30_000; now += 180 + ((k++ * 97) % 150)) {
      const { play } = pendingAlerts(t, now, ALERT_LOOKAHEAD_MS);
      for (const x of play) {
        expect(x.at).toBeGreaterThanOrEqual(now); // 과거로 예약하지 않음
        ats.push(x.at);
      }
      t = { ...t, alerted: [...t.alerted, ...play.map((x) => x.key)] };
    }
    expect(ats).toEqual([20_000, 21_000, 22_000, 23_000, 24_000, 25_000, 26_000, 27_000, 28_000, 29_000]);
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
      persist: () => {}, persistNow: () => {}, showStudent: () => true, hideStudent: () => {}, applyTopmost: () => {}, notify: () => {}, broadcast: () => {},
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
  function mk() {
    const sounds: { sound: string; volume: number; at?: number }[] = [];
    const ports: Ports = {
      persist: () => {}, persistNow: () => {}, showStudent: () => true, hideStudent: () => {}, applyTopmost: () => {}, notify: () => {}, broadcast: () => {},
      playSound: (p) => sounds.push(p), studentWindowStatus: () => ({ visible: true, mode: 'display', fullscreen: true, displayAvailable: true, displayLabel: '', alwaysOnTop: true }), displays: () => [],
    };
    const ctl = new Controller(defaultData(), ports, { userDataPath: '', appVersion: 't' });
    return { ctl, sounds };
  }
  it('예고음 크기는 따로: 종료 알림음 크기와 별개로 저장·적용, 진행 중에도 바꿀 수 있음', () => {
    const { ctl, sounds } = mk();
    let now = 1_000_000;
    ctl.now = () => now;
    ctl.dispatch({ type: 'timer/start', durationSec: 20, activity: '', sound: 'bell', volume: 30, mode: 'split', warnFrom: 10, warnVolume: 95 });
    expect(ctl.data.settings.timerWarnVolume).toBe(95);
    for (; now <= 1_000_000 + 14_000; now += 250) ctl.tick();
    ctl.dispatch({ type: 'timer/defaults', patch: { timerWarnVolume: 40 } });
    for (; now <= 1_000_000 + 22_000; now += 250) ctl.tick();
    const ticks = sounds.filter((x) => x.sound === 'tick');
    expect(ticks.length).toBe(10);
    expect(ticks.slice(0, 4).every((x) => x.volume === 95)).toBe(true);
    expect(ticks.slice(-5).every((x) => x.volume === 40)).toBe(true);
    const bell = sounds.filter((x) => x.sound === 'bell');
    expect(bell.length).toBe(1);
    expect(bell[0].volume).toBe(30);
    expect(bell[0].at).toBe(1_000_000 + 20_000); // 마지막 예고음 1초 뒤 정확히
    expect(ticks[ticks.length - 1].at).toBe(1_000_000 + 19_000);
  });
  it('끝난 상태는 닫을 때까지 유지 · 반복 설정이면 20초마다 다시 울림, 닫으면 멈춤', () => {
    const { ctl, sounds } = mk();
    let now = 1_000_000;
    ctl.now = () => now;
    ctl.dispatch({ type: 'timer/defaults', patch: { timerEndRepeat: true } });
    ctl.dispatch({ type: 'timer/start', durationSec: 5, activity: '', sound: 'chime', volume: 60, mode: 'split', warnFrom: 0 });
    for (; now <= 1_000_000 + 5_000 + 65_000; now += 250) ctl.tick();
    expect(ctl.rt.timer.status).toBe('finished');
    expect(ctl.studentView().timer?.status).toBe('finished'); // 학생 화면에도 그대로
    expect(sounds.filter((x) => x.sound === 'chime').length).toBe(4); // 종료 1번 + 20·40·60초 뒤
    ctl.dispatch({ type: 'timer/close' });
    for (; now <= 1_000_000 + 200_000; now += 250) ctl.tick();
    expect(sounds.filter((x) => x.sound === 'chime').length).toBe(4);
    expect(ctl.studentView().timer).toBeNull();
  });
  it('반복 설정이 꺼져 있으면 끝난 화면은 유지하되 소리는 한 번만', () => {
    const { ctl, sounds } = mk();
    let now = 1_000_000;
    ctl.now = () => now;
    ctl.dispatch({ type: 'timer/start', durationSec: 5, activity: '', sound: 'chime', volume: 60, mode: 'split', warnFrom: 0 });
    for (; now <= 1_000_000 + 600_000; now += 1000) ctl.tick();
    expect(ctl.rt.timer.status).toBe('finished');
    expect(ctl.studentView().timer?.status).toBe('finished');
    expect(sounds.filter((x) => x.sound === 'chime').length).toBe(1);
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
