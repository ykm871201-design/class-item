// Electron 메인 프로세스: 창·디스플레이·알림 영역·예약 감시·IPC
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, powerSaveBlocker, screen, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store';
import { Controller, type Ports } from './controller';
import { Updater } from './updater';
import { WidgetManager } from './widget';
import { resolveStudentDisplay, type DisplayInfo } from '../shared/displays';
import { validateImport } from '../shared/defaults';
import type { DisplayRef, Runtime } from '../shared/types';
import { localDateKey } from '../shared/util';

const APP_ID = 'kr.school.classroomtools';
const isE2E = !!process.env.CT_E2E;

// 사용자 데이터 경로: %APPDATA%\ClassroomTools (실행 파일 폴더가 아님)
app.setPath('userData', process.env.CT_USER_DATA || path.join(app.getPath('appData'), 'ClassroomTools'));
app.setAppUserModelId(APP_ID);

// 중복 실행 방지 — 두 번째 실행은 기존 창을 띄우고 종료
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showTeacher());
  app.whenReady().then(init);
}

let store: Store;
let ctl: Controller;
let updater: Updater;
let widget: WidgetManager;
let teacherWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

const asset = (f: string) => path.join(__dirname, '..', 'assets', f);

/** 창 가운데가 놓인 디스플레이 ID (연결된 디스플레이 목록 기준) */
function displayOf(b: Electron.Rectangle): number {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const all = screen.getAllDisplays();
  const hit = all.find((d) => cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height);
  return (hit ?? screen.getPrimaryDisplay()).id;
}

/** 예약·학생 화면 진단 기록: %APPDATA%\ClassroomTools\schedule-log.txt */
function diag(msg: string): void {
  try {
    const f = path.join(app.getPath('userData'), 'schedule-log.txt');
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old');
    const d = new Date();
    const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`;
    fs.appendFileSync(f, `[${ts}] ${msg}\n`, 'utf8');
  } catch {
    /* 진단 기록 실패는 무시 */
  }
}

// ---------------- 학생 창 관리 ----------------
class StudentWindow {
  win: BrowserWindow | null = null;
  mode: 'display' | 'preview' | 'none' = 'none';
  wanted = false; // 교사가 표시를 원함 (재연결 시 다시 표시)
  topmost = false;
  private framed: boolean | null = null;
  currentDisplayId: number | null = null;

  displays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label || '', width: d.bounds.width, height: d.bounds.height, x: d.bounds.x, y: d.bounds.y, primary: d.id === primary.id }));
  }

  resolve(): DisplayInfo | null {
    return resolveStudentDisplay(this.displays(), ctl.data.settings.studentDisplay).display;
  }

  private ensure(framed: boolean): BrowserWindow {
    if (this.win && !this.win.isDestroyed() && this.framed === framed) return this.win;
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close');
      this.win.destroy();
    }
    this.framed = framed;
    const w = new BrowserWindow({
      show: false,
      frame: framed,
      width: 960,
      height: 540,
      backgroundColor: '#ffffff',
      title: '학생 화면',
      autoHideMenuBar: true,
      skipTaskbar: !framed,
      icon: asset('icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload-student.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    w.setMenu(null);
    w.on('close', (e) => {
      if (quitting) return;
      e.preventDefault(); // 닫기 = 숨기기
      this.hide();
      ctl.changed(false);
    });
    for (const ev of ['show', 'hide', 'minimize', 'restore', 'enter-full-screen', 'leave-full-screen'] as const) w.on(ev as any, () => ctl?.changed(false));
    w.loadFile(path.join(__dirname, 'renderer', 'student.html'));
    w.webContents.on('did-finish-load', () => w.webContents.send('student:view', ctl.studentView()));
    // 모니터가 하나뿐이거나 교사용 창과 같은 모니터에 떠 있을 때: 학생 화면에서 Esc → 숨기고 교사용 창으로
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      if (this.escape()) e.preventDefault();
    });
    this.win = w;
    return w;
  }

  /** 숨김·최소화 상태에서 확실히 다시 보이게 한다 (포커스는 가능한 한 빼앗지 않음) */
  private reveal(w: BrowserWindow, inactive: boolean): void {
    if (!w.isVisible()) inactive ? w.showInactive() : w.show();
    if (w.isMinimized()) {
      // Windows에서 최소화된 창은 showInactive만으로 복원되지 않는 경우가 있어 restore로 확실히 복원
      w.restore();
      if (!w.isVisible()) w.showInactive();
    }
  }

  show(inactive: boolean): boolean {
    const d = this.resolve();
    if (d) {
      this.mode = 'display';
      this.wanted = true;
      const full = ctl.data.settings.studentFullscreen;
      const w = this.ensure(!full);
      const bounds = { x: d.x, y: d.y, width: d.width, height: d.height };
      if (full) {
        const onIt = this.currentDisplayId === d.id && w.isFullScreen();
        if (!onIt) {
          if (w.isFullScreen()) w.setFullScreen(false);
          w.setBounds(bounds);
        }
        this.reveal(w, inactive);
        if (!w.isFullScreen()) w.setFullScreen(true);
      } else {
        if (this.currentDisplayId !== d.id || !w.isVisible()) {
          const wa = screen.getAllDisplays().find((x) => x.id === d.id)?.workArea ?? bounds;
          if (this.currentDisplayId !== d.id) w.setBounds({ x: wa.x + Math.round(wa.width * 0.1), y: wa.y + Math.round(wa.height * 0.1), width: Math.round(wa.width * 0.8), height: Math.round(wa.height * 0.8) });
        }
        this.reveal(w, inactive);
      }
      this.currentDisplayId = d.id;
      this.applyTopmost(this.topmost);
      const ok = w.isVisible() && !w.isMinimized();
      diag(`학생 창 표시 (${inactive ? '포커스 유지' : '일반'}) → 디스플레이 ${d.id} ${d.width}x${d.height}@${d.x},${d.y} · visible=${w.isVisible()} minimized=${w.isMinimized()} fullscreen=${w.isFullScreen()} top=${w.isAlwaysOnTop()}`);
      return ok;
    }
    if (this.mode === 'preview' && this.win && !this.win.isDestroyed()) {
      this.reveal(this.win, inactive);
      diag('학생 창 표시 → 미리보기 창');
      return true;
    }
    diag(`학생 창 표시 실패: 학생용 디스플레이 없음 (연결된 디스플레이 ${this.displays().length}개)`);
    return false;
  }

  openPreview(): void {
    this.mode = 'preview';
    const w = this.ensure(true);
    if (w.isFullScreen()) w.setFullScreen(false);
    const wa = screen.getPrimaryDisplay().workArea;
    w.setBounds({ x: wa.x + wa.width - 980, y: wa.y + 40, width: 960, height: 540 });
    this.currentDisplayId = null;
    w.show();
  }

  /** 숨기기: 맨 위 표시를 풀고 창을 화면에서 내려 다른 창이 다시 보이게 한다 */
  hide(): void {
    this.wanted = false;
    const w = this.win;
    if (w && !w.isDestroyed()) {
      w.setAlwaysOnTop(false);
      w.hide(); // 최소화와 같은 효과. 최소화 상태로 두면 예약 시 다시 띄우지 못하는 경우가 있어 숨김만 사용
    }
    if (this.mode === 'preview') this.mode = 'none';
  }

  /**
   * 맨 위 표시 결정.
   * - 설정 '학생 화면을 다른 창보다 위에 표시'(기본 켜짐)가 켜져 있으면 학생 화면이 보이는 동안 항상 맨 위
   * - 설정이 꺼져 있어도 타이머가 표시 중이면 맨 위 (타이머를 닫으면 원래대로)
   * - 학생용 위젯을 띄운 동안에는 위젯 설정 '다른 창보다 항상 위에 표시'를 따른다
   * - 미리보기 창(교사용 모니터에서 시험)은 맨 위로 올리지 않는다
   */
  private wantTop(w: BrowserWindow): boolean {
    const pref = ctl.data.studentBase === 'widget' ? ctl.data.widget.studentOnTop : ctl.data.settings.studentAlwaysOnTop;
    return (this.topmost || pref) && this.mode === 'display' && w.isVisible() && !w.isMinimized();
  }

  applyTopmost(timerOn: boolean): void {
    this.topmost = timerOn;
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const want = this.wantTop(w);
    if (want) {
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
    } else w.setAlwaysOnTop(false);
  }

  /** 상태가 바뀔 때(위젯 ↔ 다른 화면, 위젯 설정 변경) 맨 위 여부가 달라졌을 때만 다시 적용 */
  syncTopmost(): void {
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    if (this.wantTop(w) !== w.isAlwaysOnTop()) this.applyTopmost(this.topmost);
  }

  /** 디스플레이 연결·해제 대응 */
  onDisplaysChanged(kind: 'added' | 'removed' | 'changed'): void {
    if (this.mode !== 'display' && this.mode !== 'none') return;
    const d = this.resolve();
    const w = this.win && !this.win.isDestroyed() ? this.win : null;
    if (!d) {
      if (w && w.isVisible()) {
        if (w.isFullScreen()) w.setFullScreen(false);
        w.setAlwaysOnTop(false);
        w.hide(); // 교사용 화면에 학생 화면을 전체 화면으로 띄우지 않는다
        ctl.notice('warn', '학생용 디스플레이 연결이 끊겨 학생 화면을 숨겼습니다. 다시 연결하면 자동으로 표시됩니다.');
      }
      this.currentDisplayId = null;
      return;
    }
    if (kind === 'added' && this.wanted && (!w || !w.isVisible())) {
      this.currentDisplayId = null;
      this.show(true);
      ctl.notice('info', '학생용 디스플레이가 연결되어 학생 화면을 다시 표시했습니다.');
    } else if (w && w.isVisible() && (this.currentDisplayId !== d.id || kind === 'changed')) {
      this.currentDisplayId = null;
      this.show(true);
    }
  }

  /** 학생 화면에서 Esc: 교사용 화면과 같은 모니터일 때만 숨기고 교사용 창으로 돌아감. 숨겼으면 true */
  escape(): boolean {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return false;
    if (!this.sharesTeacherScreen()) return false; // 학생용 TV에 따로 떠 있으면 실수로 꺼지지 않게 무시
    diag('학생 화면에서 Esc → 학생 화면 숨김 (교사용 화면과 같은 모니터)');
    ctl.dispatch({ type: 'student/hide' });
    if (teacherWin && !teacherWin.isDestroyed()) {
      if (teacherWin.isMinimized()) teacherWin.restore();
      teacherWin.show();
      teacherWin.focus();
      ctl.rt.inTray = false;
      ctl.changed(false);
    }
    return true;
  }

  /** 학생 창이 교사용 화면과 같은 모니터를 쓰는지 (모니터 1대, 미리보기 창, 주 모니터를 학생용으로 고른 경우) */
  sharesTeacherScreen(): boolean {
    const w = this.win;
    if (!w || w.isDestroyed()) return false;
    if (screen.getAllDisplays().length <= 1 || this.mode === 'preview') return true;
    const studentDisp = displayOf(w.getBounds());
    const teacherDisp = teacherWin && !teacherWin.isDestroyed() ? displayOf(teacherWin.getBounds()) : screen.getPrimaryDisplay().id;
    return studentDisp === teacherDisp;
  }

  status(): Runtime['studentWindow'] {
    const w = this.win && !this.win.isDestroyed() ? this.win : null;
    const d = this.resolve();
    const idx = d ? this.displays().findIndex((x) => x.id === d.id) : -1;
    return {
      visible: !!w && w.isVisible() && !w.isMinimized(),
      mode: this.mode,
      fullscreen: !!w && w.isFullScreen(),
      displayAvailable: !!d,
      displayLabel: d ? `${idx + 1}번 ${d.label || '디스플레이'} (${d.width}×${d.height})` : null,
      alwaysOnTop: !!w && w.isAlwaysOnTop(),
      escHides: this.sharesTeacherScreen(),
    };
  }

  send(view: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('student:view', view);
  }
}

const student = new StudentWindow();

// ---------------- 교사 창 ----------------
function createTeacher(): void {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, wa.width);
  const height = Math.min(920, wa.height);
  teacherWin = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: '교실 도구 (교사용)',
    backgroundColor: '#f4f6f8',
    icon: asset('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-teacher.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  teacherWin.setMenu(null);
  teacherWin.loadFile(path.join(__dirname, 'renderer', 'teacher.html'));
  teacherWin.once('ready-to-show', () => {
    if (!startHidden || isE2E) teacherWin?.show();
    else ctl.rt.inTray = true;
  });
  teacherWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (!ctl.data.settings.closeToTrayNoticeShown && !isE2E) {
      dialog
        .showMessageBox(teacherWin!, {
          type: 'info',
          title: '교실 도구',
          message: '창을 닫아도 교실 도구는 알림 영역에서 계속 실행됩니다.',
          detail:
            '화면 오른쪽 아래 작업 표시줄 알림 영역(^)에 있는 교실 도구 아이콘을 누르면 다시 열 수 있습니다.\n\n예약 타이머는 앱이 실행 중일 때만 동작합니다. 앱을 완전히 끝내면 예약이 실행되지 않습니다.\n\n앱을 완전히 종료하려면 알림 영역 아이콘을 오른쪽 클릭한 뒤 ‘앱 완전 종료’를 선택하세요.',
          buttons: ['알림 영역으로 이동', '앱 완전 종료', '취소'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 2) return;
          ctl.data.settings.closeToTrayNoticeShown = true;
          ctl.changed(true);
          if (response === 1) quitApp();
          else hideTeacherToTray();
        });
      return;
    }
    hideTeacherToTray();
  });
  for (const ev of ['minimize', 'restore', 'show', 'hide'] as const) teacherWin.on(ev as any, () => ctl?.changed(false));
}

function hideTeacherToTray(): void {
  teacherWin?.hide();
  ctl.rt.inTray = true;
  ctl.changed(false);
}

function showTeacher(): void {
  if (!teacherWin || teacherWin.isDestroyed()) createTeacher();
  if (teacherWin!.isMinimized()) teacherWin!.restore();
  teacherWin!.show();
  teacherWin!.focus();
  ctl.rt.inTray = false;
  ctl.changed(false);
}

function quitApp(): void {
  if (ctl) store.save(ctl.data);
  // 저장에 실패하면 그냥 끄지 않고 묻는다 (명단·설정을 잃지 않게)
  if (!store.flush()) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      title: '교실 도구',
      message: '데이터를 저장하지 못했습니다.',
      detail: `${store.status.error ?? ''}\n\n지금 종료하면 마지막 변경 내용이 저장되지 않을 수 있습니다. 디스크 공간과 저장 폴더(%APPDATA%\\ClassroomTools)를 확인해 주세요.`,
      buttons: ['종료하지 않기', '그래도 종료'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (r === 0) return;
  }
  quitting = true;
  diag('앱 완전 종료');
  app.quit();
}

// ---------------- 알림 영역 ----------------
function createTray(): void {
  const img = nativeImage.createFromPath(asset('tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('교실 도구 — 실행 중 (예약 감시 중)');
  const menu = () =>
    Menu.buildFromTemplate([
      { label: '교사용 화면 열기', click: showTeacher },
      { label: '바탕화면 위젯 보이기/숨기기 (Ctrl+Alt+W)', click: () => widget.toggle() },
      { label: student.status().visible ? '학생 화면 숨기기' : '학생 화면 보이기', click: () => (student.status().visible ? ctl.dispatch({ type: 'student/hide' }) : ctl.dispatch({ type: 'student/show' })) },
      { type: 'separator' },
      { label: '앱 완전 종료 (예약 타이머도 멈춤)', click: quitApp },
    ]);
  tray.setContextMenu(menu());
  tray.on('click', showTeacher);
  tray.on('right-click', () => tray?.setContextMenu(menu()));
  setInterval(() => tray?.setContextMenu(menu()), 5000);
}

// ---------------- 초기화 ----------------
function init(): void {
  store = new Store(app.getPath('userData'));
  const data = store.load();
  const ports: Ports = {
    persist: (d) => store.save(d),
    persistNow: (d) => {
      store.save(d);
      store.flush();
    },
    // 학생 창은 키보드 입력이 필요 없으므로 항상 포커스를 빼앗지 않고 표시한다
    showStudent: () => student.show(true),
    hideStudent: () => student.hide(),
    applyTopmost: (on) => student.applyTopmost(on),
    playSound: (p) => {
      soundLog.push({ ...p, due: p.at, at: Date.now() });
      teacherWin?.webContents.send('sound:play', p);
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: asset('icon.png') }).show();
    },
    broadcast: (state) => {
      if (teacherWin && !teacherWin.isDestroyed()) teacherWin.webContents.send('state', state);
      widget?.send('state', state);
      student.send(state.studentView);
      student.syncTopmost();
    },
    studentWindowStatus: () => student.status(),
    displays: () => {
      const all = screen.getAllDisplays();
      return student.displays().map((d) => ({ ...d, scaleFactor: all.find((x) => x.id === d.id)?.scaleFactor ?? 1 }));
    },
  };
  ctl = new Controller(data, ports, { userDataPath: app.getPath('userData'), appVersion: app.getVersion() });
  const origLog = ctl.log.bind(ctl);
  ctl.log = (kind, message, extra) => {
    diag(`[예약 ${kind}] ${message}`);
    origLog(kind, message, extra);
  };
  if (store.loadWarning) {
    ctl.notice('warn', store.loadWarning);
    diag(store.loadWarning);
  }
  // 저장 실패·복구를 교사 화면에 알림
  store.onStatus = (st) => {
    if (!st.ok) {
      ctl.notice('error', st.error ?? '데이터를 저장하지 못했습니다.');
      diag(st.error ?? '저장 실패');
    } else ctl.notice('info', '데이터 저장이 다시 정상으로 돌아왔습니다.');
    ctl.changed(false);
  };
  store.save(ctl.data); // 처음 실행 시에도 저장 파일을 바로 만든다

  // 자동 실행 설정을 OS 상태와 맞춤
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: ctl.data.settings.autoLaunch, args: ['--hidden'] });

  registerIpc();
  createTeacher();
  createTray();

  screen.on('display-added', () => {
    student.onDisplaysChanged('added');
    ctl.changed(false);
  });
  screen.on('display-removed', () => {
    student.onDisplaysChanged('removed');
    ctl.changed(false);
  });
  screen.on('display-metrics-changed', () => {
    student.onDisplaysChanged('changed');
    ctl.changed(false);
  });

  // 예약 감시: 창 표시 여부와 무관하게 메인 프로세스에서 동작
  diag(`앱 시작 v${app.getVersion()} · 예약 ${ctl.data.schedules.length}개(켜짐 ${ctl.data.schedules.filter((x) => x.enabled).length}) · 디스플레이 ${screen.getAllDisplays().length}개 · 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  ctl.checkSchedules(); // 앱 재실행 시 놓친 예약 기록 (오래된 예약은 실행하지 않음)
  // 창이 숨겨져 있어도 Windows가 백그라운드 앱을 일시 중단·지연시키지 않게 한다 (화면 꺼짐·절전은 막지 않음)
  powerSaveBlocker.start('prevent-app-suspension');
  let lastTick = Date.now();
  // PC 시계 변경 감지: 벽시계(Date.now)와 실제로 흐른 시간(performance.now, 시계 변경 영향 없음)을 비교
  let lastMono = performance.now();
  let suspended = false;
  setInterval(() => {
    const now = Date.now();
    const mono = performance.now();
    const drift = now - lastTick - (mono - lastMono);
    if (!suspended && Math.abs(drift) > 2000) {
      diag(`PC 시계가 ${Math.round(drift / 1000)}초 바뀌었습니다 → 진행 중 타이머의 남은 시간을 그대로 유지`);
      ctl.onClockJump(drift);
    } else if (now - lastTick > 30_000) diag(`예약 감시가 ${Math.round((now - lastTick) / 1000)}초 동안 멈춰 있었습니다 (절전·일시 중단 추정)`);
    suspended = false;
    lastTick = now;
    lastMono = mono;
    ctl.tick();
  }, 250);
  powerMonitor.on('suspend', () => {
    suspended = true; // 절전 동안 흐른 시간은 시계 변경이 아님
    diag('PC 절전 진입');
  });
  powerMonitor.on('resume', () => {
    suspended = true;
    diag('PC 절전 복귀');
    ctl.checkSchedules();
  });
  powerMonitor.on('unlock-screen', () => ctl.checkSchedules());

  // 바탕화면 위젯 보드
  widget = new WidgetManager(ctl, {
    preload: path.join(__dirname, 'preload-teacher.js'),
    html: path.join(__dirname, 'renderer', 'widget.html'),
    icon: asset('icon.png'),
    log: diag,
    isQuitting: () => quitting,
  });
  widget.start();
  if (ctl.data.widget.showOnStartup && !isE2E) widget.show();
  try {
    globalShortcut.register('CommandOrControl+Alt+W', () => widget.toggle());
  } catch {
    /* 다른 프로그램이 쓰는 단축키면 무시 */
  }

  // 업데이트: 시작 15초 뒤 조용히 한 번 확인 (인터넷이 없으면 아무 일도 없음)
  updater = new Updater(ctl, diag, () => {
    diag('업데이트 설치를 위해 앱 종료');
    quitApp();
  });
  if (!isE2E || process.env.CT_UPDATE_API) setTimeout(() => updater.check(true), isE2E ? 500 : 15_000);

  if (ctl.data.settings.showStudentOnStartup && student.resolve()) student.show(true);
  ctl.changed(false);

  if (isE2E) (globalThis as any).__ct = { ctl, student, get teacherWin() { return teacherWin; }, soundLog, store, updater, widget };
}

const soundLog: { runId: string; sound: string; volume: number; at: number; due?: number }[] = [];

app.on('before-quit', () => {
  quitting = true;
  if (store && ctl) store.save(ctl.data);
  store?.flush();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
// 모든 창: 다른 페이지로 이동·새 창 열기 금지 (앱은 로컬 화면만 쓴다. 외부 링크는 위젯 창에서 기본 브라우저로)
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (ev) => ev.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});
app.on('window-all-closed', () => {
  /* 알림 영역에서 계속 실행 */
});

// ---------------- IPC ----------------
/** 교사용 창·위젯 창에서 온 요청인지 (학생 창이나 다른 곳에서 온 요청은 거부) */
function fromTeacher(e: Electron.IpcMainInvokeEvent): boolean {
  const s = e.sender;
  return (!!teacherWin && !teacherWin.isDestroyed() && s === teacherWin.webContents) || (!!widget?.win && !widget.win.isDestroyed() && s === widget.win.webContents);
}
function fromStudent(e: Electron.IpcMainInvokeEvent): boolean {
  return !!student.win && !student.win.isDestroyed() && e.sender === student.win.webContents;
}
function guard<A extends unknown[], R>(check: (e: Electron.IpcMainInvokeEvent) => boolean, fn: (e: Electron.IpcMainInvokeEvent, ...a: A) => R) {
  return (e: Electron.IpcMainInvokeEvent, ...a: A): R => {
    if (!check(e)) throw new Error('허용되지 않은 요청입니다.');
    return fn(e, ...a);
  };
}

function registerIpc(): void {
  ipcMain.handle('state:get', guard(fromTeacher, () => ctl.fullState()));
  ipcMain.handle('student:getView', guard((e) => fromStudent(e) || fromTeacher(e), () => ctl.studentView()));
  // 학생 화면 안에서 받은 Esc (before-input-event로 처리되지 않은 경우의 보조 경로)
  ipcMain.handle('student:escape', guard(fromStudent, () => student.escape()));
  ipcMain.handle('dispatch', guard(fromTeacher, (_e, action) => ctl.dispatch(action)));
  ipcMain.handle('dialog:confirm', guard(fromTeacher, async (_e, { message, detail, ok, cancel }) => {
    const r = await dialog.showMessageBox(teacherWin!, { type: 'question', title: '교실 도구', message, detail, buttons: [ok ?? '확인', cancel ?? '취소'], defaultId: 0, cancelId: 1, noLink: true });
    return r.response === 0;
  }));
  ipcMain.handle('app', guard(fromTeacher, async (_e, a: { type: string; [k: string]: any }) => {
    switch (a.type) {
      case 'quit':
        quitApp();
        return { ok: true };
      case 'hideToTray':
        hideTeacherToTray();
        return { ok: true };
      case 'selectDisplay': {
        const d = student.displays().find((x) => x.id === a.id);
        if (!d) return { ok: false, error: '디스플레이를 찾을 수 없습니다.' };
        const ref: DisplayRef = { id: d.id, label: d.label, width: d.width, height: d.height, x: d.x, y: d.y };
        ctl.data.settings.studentDisplay = ref;
        if (d.primary) ctl.notice('warn', '주 모니터(교사용 화면)를 학생용으로 선택했습니다. 전체 화면이면 교사용 화면이 가려집니다.');
        if (student.status().visible || student.wanted) {
          student.currentDisplayId = null;
          if (student.mode === 'preview') student.mode = 'display';
          student.show(false);
        }
        ctl.changed(true);
        return { ok: true };
      }
      case 'setAlwaysOnTop':
        ctl.data.settings.studentAlwaysOnTop = !!a.value;
        student.applyTopmost(student.topmost);
        ctl.changed(true);
        return { ok: true };
      case 'setFullscreen': {
        ctl.data.settings.studentFullscreen = !!a.value;
        const wasVisible = student.status().visible && student.mode === 'display';
        student.currentDisplayId = null;
        if (wasVisible) student.show(false);
        ctl.changed(true);
        return { ok: true };
      }
      case 'preview':
        if (a.open) student.openPreview();
        else student.hide();
        ctl.changed(false);
        return { ok: true };
      case 'autoLaunch':
        ctl.data.settings.autoLaunch = !!a.value;
        if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: !!a.value, args: ['--hidden'] });
        ctl.changed(true);
        return { ok: true, packaged: app.isPackaged };
      case 'openDiagLog': {
        const f = path.join(app.getPath('userData'), 'schedule-log.txt');
        if (!fs.existsSync(f)) fs.writeFileSync(f, '', 'utf8');
        shell.openPath(f);
        return { ok: true };
      }
      case 'updateCheck':
        await updater.check(false);
        return { ok: true };
      case 'updateInstall':
        return updater.install();
      // ----- 바탕화면 위젯 -----
      case 'widgetToggle':
        widget.toggle();
        return { ok: true };
      case 'widgetShow':
        widget.show();
        return { ok: true };
      case 'widgetHide':
        widget.hide();
        return { ok: true };
      case 'widgetReset':
        widget.resetPosition();
        return { ok: true };
      case 'calendarAdd':
        return widget.addCalendar(String(a.name ?? ''), String(a.url ?? ''));
      case 'calendarUrl':
        return widget.replaceCalendarUrl(String(a.id), String(a.url ?? ''));
      case 'calendarRefresh':
        await widget.refreshCalendars();
        return { ok: true };
      case 'weatherRefresh':
        await widget.refreshWeather();
        return { ok: true };
      case 'schoolSearch':
        return widget.searchSchool(String(a.name ?? ''));
      case 'schoolSet':
        ctl.data.widget.school = a.school && a.school.code ? { office: String(a.school.office), code: String(a.school.code), name: String(a.school.name ?? '') } : null;
        ctl.rt.widget = { ...ctl.rt.widget, meal: null, mealError: undefined };
        ctl.changed(true);
        await widget.refreshMeal();
        return { ok: true };
      case 'mealRefresh':
        await widget.refreshMeal(typeof a.date === 'string' ? a.date : undefined);
        return { ok: true };
      case 'googleAdd':
        widget.openGoogleAdd({ title: String(a.title ?? ''), date: String(a.date), time: a.time || undefined });
        return { ok: true };
      case 'openTeacher':
        showTeacher();
        if (a.tab) teacherWin?.webContents.send('nav', a.tab);
        return { ok: true };
      case 'openDataFolder':
        shell.openPath(app.getPath('userData'));
        return { ok: true };
      case 'export': {
        const r = await dialog.showSaveDialog(teacherWin!, { title: '데이터 내보내기', defaultPath: path.join(app.getPath('documents'), `교실도구-데이터-${localDateKey(Date.now()).replace(/-/g, '')}.json`), filters: [{ name: '교실 도구 데이터', extensions: ['json'] }] });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        fs.writeFileSync(r.filePath, JSON.stringify({ app: 'classroom-tools', version: 1, exportedAt: new Date().toISOString(), data: ctl.data }, null, 1), 'utf8');
        return { ok: true, path: r.filePath };
      }
      case 'import': {
        const r = await dialog.showOpenDialog(teacherWin!, { title: '데이터 가져오기', properties: ['openFile'], filters: [{ name: '교실 도구 데이터', extensions: ['json'] }] });
        if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
        let raw: unknown;
        try {
          raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
        } catch {
          return { ok: false, error: '파일을 읽을 수 없습니다. JSON 형식의 데이터 파일인지 확인해 주세요.' };
        }
        const v = validateImport(raw);
        if (!v.ok) return { ok: false, error: v.error };
        const ok = await dialog.showMessageBox(teacherWin!, {
          type: 'warning',
          title: '데이터 가져오기',
          message: '현재 데이터를 가져온 파일의 내용으로 덮어쓸까요?',
          detail: `가져올 내용: ${v.summary}\n\n현재 학급·명단·예약·자리 설정이 모두 바뀝니다. 현재 데이터는 데이터 폴더에 백업 파일로 보관합니다.`,
          buttons: ['덮어쓰기', '취소'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (ok.response !== 0) return { ok: false, canceled: true };
        fs.writeFileSync(path.join(app.getPath('userData'), `classroom-data.before-import-${Date.now()}.json`), JSON.stringify(ctl.data), 'utf8');
        const keep = ctl.data.settings;
        const now = Date.now();
        v.data.settings = { ...v.data.settings, studentDisplay: keep.studentDisplay, autoLaunch: keep.autoLaunch, closeToTrayNoticeShown: keep.closeToTrayNoticeShown };
        for (const s of v.data.schedules) s.activeSince = now;
        v.data.lastScheduleCheckAt = now;
        ctl.data = v.data;
        ctl.rt.seatingReveal = null;
        ctl.rt.pickerReveal = null;
        ctl.changed(true);
        return { ok: true, summary: v.summary };
      }
    }
    return { ok: false, error: 'unknown' };
  }));
}
