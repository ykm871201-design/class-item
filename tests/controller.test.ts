import { describe, it, expect } from 'vitest';
import { Controller, type Ports } from '../src/main/controller';
import { defaultData } from '../src/shared/defaults';

function make() {
  const shown: string[] = [];
  const ports: Ports = {
    persist: () => {},
    showStudent: () => (shown.push('show'), true),
    hideStudent: () => {},
    applyTopmost: () => {},
    playSound: () => {},
    notify: () => {},
    broadcast: () => {},
    studentWindowStatus: () => ({ visible: true, mode: 'display', fullscreen: true, displayAvailable: true, displayLabel: 'TV', alwaysOnTop: true }),
    displays: () => [],
  };
  const ctl = new Controller(defaultData(), ports, { userDataPath: '', appVersion: 'test' });
  return { ctl, shown };
}

describe('칠판 실시간 반영', () => {
  it('꺼져 있으면 입력해도 학생 화면(공개본)은 그대로', () => {
    const { ctl } = make();
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '작성 중' } });
    expect(ctl.studentView().board.text).toBe('');
  });
  it('켜면 지금 내용을 바로 표시하고, 이후 입력·스타일 변경·지우기가 즉시 반영', () => {
    const { ctl, shown } = make();
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '첫 문장' } });
    ctl.dispatch({ type: 'board/setLive', value: true });
    expect(ctl.studentView().base).toBe('board');
    expect(ctl.studentView().board.text).toBe('첫 문장');
    expect(shown.length).toBe(1);
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '바로 보이는 문장' } });
    expect(ctl.studentView().board.text).toBe('바로 보이는 문장');
    ctl.dispatch({ type: 'board/updateDraft', patch: { color: '#ffffff', bg: '#1f4d3a' } });
    expect(ctl.studentView().board.bg).toBe('#1f4d3a');
    ctl.dispatch({ type: 'board/clearDraft' });
    expect(ctl.studentView().board.text).toBe('');
    expect(ctl.data.settings.boardLive).toBe(true);
  });
  it('실시간 반영 중 자리 배치 등을 보고 있으면 화면을 칠판으로 빼앗지 않고 문구만 갱신', () => {
    const { ctl } = make();
    ctl.dispatch({ type: 'board/setLive', value: true });
    ctl.data.studentBase = 'blank';
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '숨은 갱신' } });
    expect(ctl.studentView().base).toBe('blank');
    expect(ctl.data.boardPublished.text).toBe('숨은 갱신');
  });
  it('함께 보기 타이머 중에도 타이머를 멈추지 않고 문구만 갱신', () => {
    const { ctl } = make();
    ctl.dispatch({ type: 'board/setLive', value: true });
    ctl.dispatch({ type: 'timer/start', durationSec: 60, activity: '', sound: 'none', volume: 0, mode: 'split' });
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '타이머 옆 문장' } });
    const v = ctl.studentView();
    expect(v.timer?.status).toBe('running');
    expect(v.board.text).toBe('타이머 옆 문장');
  });
  it('끄면 다시 표시 버튼을 눌러야 반영', () => {
    const { ctl } = make();
    ctl.dispatch({ type: 'board/setLive', value: true });
    ctl.dispatch({ type: 'board/setLive', value: false });
    ctl.dispatch({ type: 'board/updateDraft', patch: { text: '보류' } });
    expect(ctl.studentView().board.text).toBe('');
  });
});
