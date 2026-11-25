// Electron 메인 프로세스: 창·디스플레이·알림 영역·예약 감시·IPC
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store';
import { Controller, type Ports } from './controller';
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
let teacherWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

const asset = (f: string) => path.join(__dirname, '..', 'assets', f);

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
    this.win = w;
    return w;
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
        if (w.isMinimized() || !w.isVisible()) inactive ? w.showInactive() : w.show();
        if (!w.isFullScreen()) w.setFullScreen(true);
      } else {
        if (this.currentDisplayId !== d.id || !w.isVisible()) {
          const wa = screen.getAllDisplays().find((x) => x.id === d.id)?.workArea ?? bounds;
          if (this.currentDisplayId !== d.id) w.setBounds({ x: wa.x + Math.round(wa.width * 0.1), y: wa.y + Math.round(wa.height * 0.1), width: Math.round(wa.width * 0.8), height: Math.round(wa.height * 0.8) });
        }
        if (w.isMinimized() || !w.isVisible()) inactive ? w.showInactive() : w.show();
      }
      this.currentDisplayId = d.id;
      this.applyTopmost(this.topmost);
      return true;
    }
    if (this.mode === 'preview' && this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized() || !this.win.isVisible()) inactive ? this.win.showInactive() : this.win.show();
      return true;
    }
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

  /** 숨기기: 맨 위 표시를 풀고 최소화한 뒤 숨겨서 다른 창이 다시 보이게 한다 */
  hide(): void {
    this.wanted = false;
    const w = this.win;
    if (w && !w.isDestroyed()) {
      w.setAlwaysOnTop(false);
      if (w.isVisible() && !w.isMinimized()) w.minimize();
      w.hide();
    }
    if (this.mode === 'preview') this.mode = 'none';
  }

  /**
   * 맨 위 표시 결정.
   * - 설정 '학생 화면을 다른 창보다 위에 표시'(기본 켜짐)가 켜져 있으면 학생 화면이 보이는 동안 항상 맨 위
   * - 설정이 꺼져 있어도 타이머가 표시 중이면 맨 위 (타이머를 닫으면 원래대로)
   * - 미리보기 창(교사용 모니터에서 시험)은 맨 위로 올리지 않는다
   */
  applyTopmost(timerOn: boolean): void {
    this.topmost = timerOn;
    const w = this.win;
    if (!w || w.isDestroyed()) return;
    const want = (timerOn || ctl.data.settings.studentAlwaysOnTop) && this.mode === 'display' && w.isVisible() && !w.isMinimized();
    if (want) {
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
    } else w.setAlwaysOnTop(false);
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
  quitting = true;
  if (ctl) store.save(ctl.data);
  store.flush();
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
    // 학생 창은 키보드 입력이 필요 없으므로 항상 포커스를 빼앗지 않고 표시한다
    showStudent: () => student.show(true),
    hideStudent: () => student.hide(),
    applyTopmost: (on) => student.applyTopmost(on),
    playSound: (p) => {
      soundLog.push({ ...p, at: Date.now() });
      teacherWin?.webContents.send('sound:play', p);
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: asset('icon.png') }).show();
    },
    broadcast: (state) => {
      if (teacherWin && !teacherWin.isDestroyed()) teacherWin.webContents.send('state', state);
      student.send(state.studentView);
    },
    studentWindowStatus: () => student.status(),
    displays: () => {
      const all = screen.getAllDisplays();
      return student.displays().map((d) => ({ ...d, scaleFactor: all.find((x) => x.id === d.id)?.scaleFactor ?? 1 }));
    },
  };
  ctl = new Controller(data, ports, { userDataPath: app.getPath('userData'), appVersion: app.getVersion() });
  if (store.loadWarning) ctl.notice('warn', store.loadWarning);
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
  ctl.checkSchedules(); // 앱 재실행 시 놓친 예약 기록 (오래된 예약은 실행하지 않음)
  setInterval(() => ctl.tick(), 250);
  powerMonitor.on('resume', () => ctl.checkSchedules());
  powerMonitor.on('unlock-screen', () => ctl.checkSchedules());

  if (ctl.data.settings.showStudentOnStartup && student.resolve()) student.show(true);
  ctl.changed(false);

  if (isE2E) (globalThis as any).__ct = { ctl, student, get teacherWin() { return teacherWin; }, soundLog, store };
}

const soundLog: { runId: string; sound: string; volume: number; at: number }[] = [];

app.on('before-quit', () => {
  quitting = true;
  if (store && ctl) store.save(ctl.data);
  store?.flush();
});
app.on('window-all-closed', () => {
  /* 알림 영역에서 계속 실행 */
});

// ---------------- IPC ----------------
function registerIpc(): void {
  ipcMain.handle('state:get', () => ctl.fullState());
  ipcMain.handle('student:getView', () => ctl.studentView());
  ipcMain.handle('dispatch', (_e, action) => ctl.dispatch(action));
  ipcMain.handle('dialog:confirm', async (_e, { message, detail, ok, cancel }) => {
    const r = await dialog.showMessageBox(teacherWin!, { type: 'question', title: '교실 도구', message, detail, buttons: [ok ?? '확인', cancel ?? '취소'], defaultId: 0, cancelId: 1, noLink: true });
    return r.response === 0;
  });
  ipcMain.handle('app', async (_e, a: { type: string; [k: string]: any }) => {
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
  });
}
