// 학생이 직접 누르는 투표 전용 창 (교실 PC 모니터에 전체 화면으로 띄움)
// - 교사용 창이 있는 모니터에만 연다. 학생용 TV·프로젝터로 지정된 모니터에는 열지 않는다.
// - 모니터 연결이 바뀌면 곧바로 잠그고 열린 투표 기회를 취소한다 (선택 화면이 다른 화면으로 넘어가지 않게).
// - 닫기·새로고침·개발자 도구·뒤로 가기 단축키를 막고, 교사 메뉴는 PIN을 넣어야 열린다.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Controller } from './controller';
import type { VoteView } from '../shared/types';

export interface VoteDeps {
  ctl: () => Controller;
  preload: string;
  html: string;
  icon: string;
  log: (m: string) => void;
  teacherWindow: () => BrowserWindow | null;
  /** 학생용 TV로 지정된 모니터 ID (없으면 null) */
  studentDisplayId: () => number | null;
  /** 투표 화면을 닫은 뒤 교사용 창을 다시 보이기 */
  restoreTeacher: () => void;
  isE2E: boolean;
}

/** 창 가운데가 놓인 디스플레이 */
function displayAt(b: Electron.Rectangle): Electron.Display {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return screen.getAllDisplays().find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height) ?? screen.getPrimaryDisplay();
}

export class VoteWindow {
  win: BrowserWindow | null = null;
  private allowClose = false;
  private displayId: number | null = null;
  /** 교사 메뉴가 열려 있는지 (PIN 확인 후 잠시) — 학생 화면이 보내는 값은 믿지 않고 여기서만 판단 */
  private adminUntil = 0;

  constructor(private deps: VoteDeps) {}

  get active(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  get admin(): boolean {
    return Date.now() < this.adminUntil;
  }

  /** 투표 화면을 열 수 있는 모니터인지 확인 */
  checkTarget(): { ok: true; display: Electron.Display; single: boolean } | { ok: false; error: string } {
    const all = screen.getAllDisplays();
    const tw = this.deps.teacherWindow();
    const target = tw && !tw.isDestroyed() ? displayAt(tw.getBounds()) : screen.getPrimaryDisplay();
    const studentId = this.deps.studentDisplayId();
    if (all.length >= 2 && studentId !== null && studentId === target.id)
      return { ok: false, error: '교사용 창이 학생용 TV·프로젝터로 지정된 모니터에 있습니다. 교사용 창을 교실 PC 모니터로 옮기거나, 설정에서 학생용 디스플레이를 다른 모니터로 바꿔 주세요.' };
    return { ok: true, display: target, single: all.length < 2 };
  }

  open(electionId: string): { ok: boolean; error?: string } {
    const ctl = this.deps.ctl();
    const e = ctl.elections.find(electionId);
    if (!e || e.phase !== 'voting') return { ok: false, error: '진행 중인 투표가 없습니다. 먼저 투표를 시작해 주세요.' };
    const t = this.checkTarget();
    if (!t.ok) return t;
    this.adminUntil = 0;
    ctl.elections.rt.vote = { open: true, electionId: e.id, locked: null };
    this.displayId = t.display.id;
    if (!this.active) this.create(t.display);
    else this.place(t.display);
    // 교사용 창은 투표 화면 뒤로 숨긴다 (작업 표시줄·Alt+Tab으로 관리 화면이 보이지 않게)
    const tw = this.deps.teacherWindow();
    if (tw && !tw.isDestroyed()) tw.hide();
    this.deps.log(`투표 화면 열림 → 디스플레이 ${t.display.id} (모니터 ${screen.getAllDisplays().length}대)`);
    ctl.changed(false);
    this.push();
    return { ok: true };
  }

  private create(d: Electron.Display): void {
    const w = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      show: false,
      frame: false,
      fullscreen: true,
      kiosk: !this.deps.isE2E,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      closable: true,
      backgroundColor: '#f4f6f8',
      title: '투표',
      icon: this.deps.icon,
      webPreferences: { preload: this.deps.preload, contextIsolation: true, sandbox: true, devTools: false, spellcheck: false, backgroundThrottling: false },
    });
    w.setMenu(null);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.on('close', (ev) => {
      if (this.allowClose) return;
      ev.preventDefault(); // Alt+F4 등으로 닫히지 않게 (교사 메뉴에서만 닫음)
    });
    w.on('closed', () => {
      if (this.win === w) this.win = null;
    });
    // 키보드: 새로고침·개발자 도구·뒤로 가기·창 닫기·확대 등 단축키를 모두 막는다. F9는 교사 메뉴(PIN 입력)
    w.webContents.on('before-input-event', (ev, input) => {
      if (input.type !== 'keyDown') return;
      const k = input.key;
      if (k === 'F9') {
        ev.preventDefault();
        w.webContents.send('vote:teacherKey');
        return;
      }
      const plain = !input.control && !input.meta && !input.alt;
      const digitsOrEdit = /^[0-9]$/.test(k) || k === 'Backspace' || k === 'Enter' || k === 'Tab' || k === ' ';
      if (!(plain && digitsOrEdit)) ev.preventDefault();
    });
    w.webContents.on('context-menu', (ev) => ev.preventDefault());
    w.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    w.webContents.on('did-finish-load', () => this.push());
    // 화면이 다시 불러와지면(충돌 등) 열린 투표 기회는 취소 — 선택 내용은 화면에만 있었으므로 남지 않는다
    w.webContents.on('render-process-gone', () => {
      this.deps.ctl().elections.cancelOpenBallot();
      this.deps.log('투표 화면 프로세스가 종료되어 열린 투표 기회를 취소');
    });
    w.loadFile(this.deps.html);
    w.once('ready-to-show', () => {
      w.show();
      w.setAlwaysOnTop(true, 'screen-saver'); // 표시한 뒤 다시 지정해야 확실히 맨 위에 고정됨
      w.focus();
    });
    this.win = w;
  }

  private place(d: Electron.Display): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (displayAt(w.getBounds()).id !== d.id) {
      if (w.isFullScreen()) w.setFullScreen(false);
      w.setBounds(d.bounds);
      w.setFullScreen(true);
    }
    w.setAlwaysOnTop(true, 'screen-saver');
    w.show();
    w.focus();
  }

  /** 모니터 연결이 바뀜: 바로 잠그고 열린 투표 기회 취소 */
  onDisplaysChanged(kind: string): void {
    if (!this.active) return;
    const ctl = this.deps.ctl();
    const cancelled = ctl.elections.cancelOpenBallot();
    this.adminUntil = 0;
    ctl.elections.rt.vote = { ...ctl.elections.rt.vote, locked: '모니터 연결이 바뀌었습니다. 선생님이 화면을 확인한 뒤 다시 열어 주세요.' };
    this.deps.log(`투표 화면 잠금: 모니터 연결 변경(${kind})${cancelled ? ' · 열린 투표 기회 취소' : ''}`);
    ctl.changed(false);
    this.push();
  }

  /** 교사 메뉴 열기 (PIN 확인) */
  unlock(pin: unknown): { ok: boolean; error?: string } {
    const c = this.deps.ctl().elections.checkPin(pin);
    if (!c.ok) return c;
    this.adminUntil = Date.now() + 120_000;
    this.push();
    return { ok: true };
  }

  /** 교사 메뉴 동작 (PIN 확인 뒤에만) */
  adminAction(action: unknown): { ok: boolean; error?: string; saved?: boolean } {
    if (!this.admin) return { ok: false, error: '선생님 PIN을 먼저 입력해 주세요.' };
    const ctl = this.deps.ctl();
    const el = ctl.elections;
    switch (action) {
      case 'next': {
        const r = el.openBallot(el.rt.vote.electionId ?? '');
        if (r.ok) this.adminUntil = 0; // 학생에게 넘기면 교사 메뉴는 닫힘
        this.push();
        return r;
      }
      case 'retrySave': {
        const saved = el.retrySave();
        this.push();
        return { ok: saved, saved, error: saved ? undefined : '아직 저장하지 못했습니다. 디스크 공간·저장 폴더를 확인한 뒤 다시 시도해 주세요.' };
      }
      case 'resume': {
        const t = this.checkTarget();
        if (!t.ok) return t;
        this.displayId = t.display.id;
        this.place(t.display);
        el.rt.vote = { ...el.rt.vote, locked: null };
        ctl.changed(false);
        this.push();
        return { ok: true };
      }
      case 'cancelBallot':
        el.cancelOpenBallot();
        this.push();
        return { ok: true };
      case 'leave':
        this.adminUntil = 0;
        this.push();
        return { ok: true };
      case 'exit':
        this.close();
        return { ok: true };
    }
    return { ok: false, error: '알 수 없는 동작' };
  }

  submit(token: unknown, choices: unknown, abstain: unknown) {
    const r = this.deps.ctl().elections.submit(token, choices, abstain);
    this.push();
    return r;
  }

  close(): void {
    const ctl = this.deps.ctl();
    ctl.elections.cancelOpenBallot();
    ctl.elections.rt.vote = { open: false, electionId: null, locked: null };
    this.adminUntil = 0;
    const w = this.win;
    if (w && !w.isDestroyed()) {
      this.allowClose = true;
      w.setKiosk(false);
      w.destroy();
      this.allowClose = false;
    }
    this.win = null;
    this.deps.log('투표 화면 닫힘 → 교사용 화면');
    this.deps.restoreTeacher();
    ctl.changed(false);
  }

  /** 앱 종료 때 */
  destroy(): void {
    const w = this.win;
    if (w && !w.isDestroyed()) {
      this.allowClose = true;
      w.destroy();
    }
    this.win = null;
  }

  focus(): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    w.show();
    w.focus();
  }

  view(): VoteView {
    return this.deps.ctl().elections.voteView(this.admin);
  }

  push(): void {
    const w = this.win;
    if (w && !w.isDestroyed()) w.webContents.send('vote:view', this.view());
  }
}

export const votePaths = (dir: string) => ({ preload: path.join(dir, 'preload-vote.js'), html: path.join(dir, 'renderer', 'vote.html') });
