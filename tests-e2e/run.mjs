// 실제 Electron 앱을 띄워 주요 흐름을 검증하는 E2E 스크립트 (Playwright + Electron)
// 실행: DISPLAY가 있는 환경(또는 xvfb-run)에서 `npm run e2e`
// 가상 환경에는 실제 두 번째 모니터가 없으므로 Electron screen API를 가짜 디스플레이로 바꿔 연결·해제를 흉내 낸다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright'); // 전역 설치된 Playwright 사용
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const electronPath = require(path.join(root, 'node_modules/electron'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2e-'));
const shots = path.join(root, 'tests-e2e', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✔', name);
  } catch (e) {
    failures.push(name);
    console.log('  ✘', name, '\n     ', e?.message ?? e);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, msg = 'timeout') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(msg);
    await sleep(100);
  }
}

async function launch() {
  const app = await electron.launch({ executablePath: electronPath, args: ['--no-sandbox', root], env: { ...process.env, CT_E2E: '1', CT_USER_DATA: userData, TZ: process.env.TZ } });
  const teacher = await app.firstWindow();
  await teacher.waitForSelector('.t-app');
  return { app, teacher };
}

// 가짜 디스플레이 구성: 주 모니터(교사) + TV(학생)
async function setDisplays(app, withTv) {
  await app.evaluate(({ screen }, withTv) => {
    const mk = (id, x, label) => ({ id, label, bounds: { x, y: 0, width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, size: { width: 1920, height: 1080 }, workAreaSize: { width: 1920, height: 1040 }, rotation: 0, internal: false, touchSupport: 'unknown', monochrome: false, accelerometerSupport: 'unknown', colorDepth: 24, colorSpace: '', depthPerComponent: 8, displayFrequency: 60, detected: true });
    const primary = mk(101, 0, '교사 모니터');
    const tv = mk(202, 1920, '교실 TV');
    const list = withTv ? [primary, tv] : [primary];
    screen.getAllDisplays = () => list;
    screen.getPrimaryDisplay = () => primary;
    screen.emit(withTv ? 'display-added' : 'display-removed', {}, withTv ? tv : tv);
  }, withTv);
  await sleep(400);
}

const studentWin = async (app) => {
  for (const w of app.windows()) if ((await w.title()) === '학생 화면') return w;
  return null;
};
const swInfo = (app) =>
  app.evaluate(() => {
    const s = globalThis.__ct.student;
    const w = s.win && !s.win.isDestroyed() ? s.win : null;
    return w ? { visible: w.isVisible(), bounds: w.getBounds(), top: w.isAlwaysOnTop(), full: w.isFullScreen(), mode: s.mode } : null;
  });
const dispatch = (app, a) => app.evaluate((_e, a) => globalThis.__ct.ctl.dispatch(a), a);
const pad2 = (n) => String(n).padStart(2, '0');

console.log('E2E 시작 — 데이터 폴더:', userData);
let { app, teacher } = await launch();

await check('단일 모니터 시작: 학생 창을 교사 화면에 띄우지 않음', async () => {
  const info = await swInfo(app);
  assert(!info || !info.visible, '학생 창이 표시됨');
  const status = await teacher.textContent('[data-testid=student-status]');
  assert(status.includes('학생용 디스플레이 없음'), status);
});

await check('명단 붙여넣기 (동명이인 포함 23명)', async () => {
  await teacher.click('[data-tab=roster]');
  const names = ['김민준', '이서연', '박지호', '최유나', '정하준', '김민준', '강서윤', '조은우', '윤지아', '장도윤', '임수아', '한시우', '오하은', '서준서', '신지유', '권예준', '황다은', '안주원', '송채원', '류건우', '전소율', '홍현우', '문서아'];
  await teacher.fill('[data-testid=bulk-input]', '번호\t이름\n' + names.map((n, i) => `${i + 1}\t${n}`).join('\n'));
  await teacher.click('[data-testid=bulk-append]');
  await until(async () => (await teacher.locator('[data-testid=student-table] tbody tr').count()) === 23, 3000, '23명이 아님');
  const txt = await teacher.textContent('[data-testid=student-table]');
  assert(txt.includes('김민준(1)') && txt.includes('김민준(6)'), '동명이인 표시 없음');
});

await check('TV 연결 감지 → 칠판 표시 전 편집 문구는 학생 화면에 없음', async () => {
  await setDisplays(app, true);
  await teacher.click('[data-tab=board]');
  await teacher.fill('[data-testid=board-input]', '편집 중인 문장');
  await sleep(500);
  const sv = await app.evaluate(() => JSON.stringify(globalThis.__ct.ctl.studentView()));
  assert(!sv.includes('편집 중인 문장'), '편집 중 문장이 학생 화면 데이터에 포함됨');
});

await check('학생 화면에 표시 → TV 디스플레이에 칠판 표시', async () => {
  await teacher.fill('[data-testid=board-input]', '오늘의 할 일\n1. 수학 익힘책 24쪽\n2. 받아쓰기 연습');
  await teacher.click('[data-testid=board-publish]');
  const info = await until(() => swInfo(app), 5000, '학생 창 없음');
  assert(info.visible, '학생 창 숨김');
  assert(info.bounds.x >= 1920, '학생 창이 TV 디스플레이에 있지 않음: ' + JSON.stringify(info.bounds));
  assert(info.top, '학생 화면이 다른 창보다 위에 있지 않음 (기본 설정: 항상 위)');
  const sw = await until(() => studentWin(app));
  await sw.waitForSelector('[data-testid=board-text]');
  const t = await sw.textContent('[data-testid=board-text]');
  assert(t.includes('수학 익힘책'), t);
  await sw.screenshot({ path: path.join(shots, '01-student-board.png') });
});

await check('숨겨진 고정 자리: 교사 UI로 고정 → 바로 추첨·공개 → 학생 화면에 고정 표시 없음', async () => {
  await teacher.click('[data-tab=seating]');
  await teacher.click('[data-seat=r0c0]');
  await teacher.waitForSelector('[data-testid=seat-popover]');
  await teacher.locator('[data-testid=seat-popover] .opt', { hasText: '4. 최유나' }).click();
  await until(async () => (await teacher.textContent('[data-testid=fixed-list]'))?.includes('최유나'), 3000, '고정 목록에 없음');
  await teacher.screenshot({ path: path.join(shots, '02-teacher-seating-fixed.png') });
  await teacher.click('[data-testid=seat-draw-reveal]');
  const sw = await studentWin(app);
  await sw.waitForSelector('.st-seat.shuffling', { timeout: 3000 });
  await sw.screenshot({ path: path.join(shots, '03-student-seating-shuffle.png') });
  await sw.waitForSelector('.st-seat.reveal', { timeout: 5000 });
  await sleep(600);
  const visible = await sw.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('*')].map((e) => e.className + ' ' + [...e.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'title').map((a) => a.value).join(' ')).join(' '));
  assert(!/🔒|고정|lock|fixed/i.test(visible), '학생 화면에 고정 관련 표시가 있음');
  const seats = await sw.$$eval('[data-testid=seat]', (els) => els.map((e) => ({ cls: e.className, text: e.textContent })));
  const filled = seats.filter((s) => s.text);
  assert(filled.length === 23, '배치 인원 ' + filled.length);
  assert(new Set(filled.map((s) => s.text)).size === 23, '중복 이름');
  assert(new Set(filled.map((s) => s.cls)).size === 1, '좌석마다 다른 스타일: ' + [...new Set(filled.map((s) => s.cls))].join(' | '));
  assert(seats[0].text === '최유나', '고정 좌석 결과가 다름: ' + seats[0].text);
  await sw.screenshot({ path: path.join(shots, '04-student-seating.png') });
});

await check('교사 미리 추첨은 학생 화면에 보이지 않고, 공개를 눌러야 표시', async () => {
  await dispatch(app, { type: 'student/base', base: 'board' });
  await teacher.click('[data-testid=seat-draw-preview]');
  await sleep(500);
  const v1 = await app.evaluate(() => globalThis.__ct.ctl.studentView());
  assert(v1.base === 'board', '미리 추첨 후 학생 화면이 바뀜: ' + v1.base);
  const draft = await app.evaluate(() => globalThis.__ct.ctl.cls.seating.draft.assignment);
  await teacher.click('[data-testid=seat-reveal]');
  await sleep(2800);
  const sw = await studentWin(app);
  const shown = await sw.$$eval('[data-testid=seat]', (els) => els.map((e) => e.textContent));
  const names = await app.evaluate(() => { const c = globalThis.__ct.ctl.cls; return Object.fromEntries(c.students.map((s) => [s.id, s.name])); });
  assert(shown.includes(names[draft.r0c1].replace(/\(.*/, '')) || shown.some((t) => t.startsWith(names[draft.r0c1])), '공개된 배치가 미리 추첨 결과와 다름');
});

await check('고정 학생 결석 → 다시 섞기 시 제외, 고정 설정은 유지', async () => {
  const id = await app.evaluate(() => globalThis.__ct.ctl.cls.students.find((s) => s.name === '최유나').id);
  await dispatch(app, { type: 'student/update', id, absent: true });
  await dispatch(app, { type: 'seating/draw', reveal: true });
  await sleep(2700);
  const sw = await studentWin(app);
  const texts = await sw.$$eval('[data-testid=seat]', (els) => els.map((e) => e.textContent).filter(Boolean));
  assert(texts.length === 22 && !texts.includes('최유나'), '결석 고정 학생이 포함됨');
  const fixed = await app.evaluate(() => globalThis.__ct.ctl.cls.seating.fixed.length);
  assert(fixed === 1, '고정 설정이 사라짐');
  await dispatch(app, { type: 'student/update', id, absent: false });
  await dispatch(app, { type: 'seating/confirm' });
});

await check('짝꿍형 → 개인형 전환 시 자리 부족하면 줄 자동 추가, 배치 정상', async () => {
  await teacher.click('[data-testid=layout-single]');
  await sleep(300);
  const r = await dispatch(app, { type: 'seating/draw', reveal: false });
  assert(r.ok, r.error);
  const n = await app.evaluate(() => Object.keys(globalThis.__ct.ctl.cls.seating.draft.assignment).length);
  assert(n === 23, '배치 인원 ' + n);
  await teacher.click('[data-testid=layout-pair]');
  await sleep(300);
  const fixedStill = await app.evaluate(() => globalThis.__ct.ctl.cls.seating.fixed.length);
  assert(fixedStill === 1, '형태 전환 후 고정 설정 사라짐');
});

// 칠판에 긴 문구 공개
const longText = '오늘의 활동 안내\n1. 모둠별로 자료를 읽고 중요한 내용을 세 가지로 정리합니다\n2. 정리한 내용을 바탕으로 발표 자료를 만듭니다\n3. 발표 순서를 정하고 역할을 나눕니다\n4. 다른 모둠의 발표를 듣고 질문을 하나씩 준비합니다\n5. 사용한 물건은 제자리에 정리합니다';
await dispatch(app, { type: 'board/updateDraft', patch: { text: longText } });
await dispatch(app, { type: 'board/publish' });

let schedTime;
await check('예약 등록(교사 UI) — 다음 실행 시각 표시', async () => {
  await teacher.click('[data-tab=schedule]');
  let now = new Date();
  if (now.getSeconds() > 45) {
    await sleep((62 - now.getSeconds()) * 1000);
    now = new Date();
  }
  const at = new Date(now.getTime() + 60_000);
  schedTime = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  await teacher.click('[data-testid=schedule-new]');
  await teacher.fill('[data-testid=sch-name]', '쉬는 시간 테스트');
  await teacher.fill('[data-testid=sch-time]', schedTime);
  await teacher.fill('[data-testid=sch-min]', '0');
  await teacher.locator('[data-testid=schedule-editor] input[type=number]').nth(1).fill('6');
  // 오늘 요일 포함 매일
  await teacher.locator('[data-testid=schedule-editor] button', { hasText: '매일' }).click();
  await teacher.locator('[data-testid=schedule-editor] input[type=text]').nth(1).fill('쉬는 시간');
  await teacher.click('[data-testid=sch-save]');
  await teacher.waitForSelector('[data-testid=schedule-item]');
  const next = await teacher.textContent('[data-testid=schedule-next]');
  assert(next.includes(schedTime), next);
});

await check('같은 시각 예약은 저장 전 충돌 안내', async () => {
  const r = await dispatch(app, { type: 'schedule/save', schedule: { id: '', name: '중복', enabled: true, time: schedTime, durationSec: 60, repeat: 'weekly', date: '', days: [0, 1, 2, 3, 4, 5, 6], activity: '', sound: 'chime', volume: 50, displayMode: 'full', createdAt: 0 } });
  assert(!r.ok && r.error.includes('같은 시각'), JSON.stringify(r));
});

await check('교사 창 알림 영역 숨김 + 학생 창 숨김 상태에서 예약 실행 → TV에 함께 보기 표시, 맨 위 고정, 교사 창은 계속 숨김', async () => {
  await dispatch(app, { type: 'student/hide' });
  await app.evaluate(() => {
    const t = globalThis.__ct.teacherWin;
    t.minimize();
    t.hide(); // 알림 영역으로 숨김 (✕ 버튼과 같은 동작)
    globalThis.__ct.ctl.rt.inTray = true;
    // 포커스를 빼앗는 호출 감시 (가상 X 서버에는 창 관리자가 없어 최소화 자체는 확인할 수 없음)
    const calls = (globalThis.__focusCalls = []);
    for (const m of ['show', 'focus', 'restore', 'moveTop']) {
      const orig = t[m].bind(t);
      t[m] = (...a) => (calls.push('teacher.' + m), orig(...a));
    }
    const sw = globalThis.__ct.student.win;
    for (const m of ['show', 'focus']) {
      const orig = sw[m].bind(sw);
      sw[m] = (...a) => (calls.push('student.' + m), orig(...a));
    }
    const orig = sw.showInactive.bind(sw);
    sw.showInactive = (...a) => (calls.push('student.showInactive'), orig(...a));
  });
  await sleep(500);
  assert(!(await swInfo(app)).visible, '학생 창이 숨겨지지 않음');
  console.log('     (예약 시각 ' + schedTime + '까지 대기…)');
  await until(async () => (await swInfo(app))?.visible, 75_000, '예약 시각에 학생 창이 나타나지 않음');
  const info = await swInfo(app);
  assert(info.bounds.x >= 1920, '학생 창이 TV에 있지 않음');
  assert(info.top, '타이머 표시 중 맨 위 고정이 아님');
  assert(!(await app.evaluate(() => globalThis.__ct.teacherWin.isVisible())), '교사 창이 나타남');
  const calls = await app.evaluate(() => globalThis.__focusCalls);
  assert(calls.includes('student.showInactive'), '학생 창을 포커스 없이 표시하지 않음: ' + calls.join());
  assert(!calls.some((c) => c.startsWith('teacher.') || c === 'student.focus' || c === 'student.show'), '포커스를 빼앗는 호출: ' + calls.join());
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=split-timer]');
  const boardTxt = await sw.textContent('[data-testid=split-board]');
  assert(boardTxt.includes('발표 자료를 만듭니다'), '함께 보기에서 칠판 내용이 유지되지 않음');
  await sw.screenshot({ path: path.join(shots, '05-student-split-timer.png') });
});

await check('함께 보기: 긴 칠판 문구가 타이머 영역에 가려지거나 잘리지 않음', async () => {
  const sw = await studentWin(app);
  const r = await sw.evaluate(() => {
    const t = document.querySelector('[data-testid=board-text]');
    const span = t.querySelector('span');
    const tr = document.querySelector('[data-testid=split-timer]').getBoundingClientRect();
    const br = span.getBoundingClientRect();
    const area = document.querySelector('[data-testid=split-board]').getBoundingClientRect();
    const overlap = !(br.right <= tr.left || br.left >= tr.right || br.bottom <= tr.top || br.top >= tr.bottom);
    return { overlap, inside: br.left >= area.left - 1 && br.right <= area.right + 1 && br.top >= area.top - 1 && br.bottom <= area.bottom + 1, overflow: t.scrollHeight > t.clientHeight + 1, len: span.textContent.length };
  });
  assert(!r.overlap, '칠판 글자가 타이머와 겹침');
  assert(r.inside && !r.overflow, '칠판 글자가 영역 밖으로 나감 ' + JSON.stringify(r));
  assert(r.len === longText.length, '문구가 잘림');
});

await check('함께 보기: 여러 해상도·화면 배율(150%)에서도 겹침·잘림 없음', async () => {
  const sw = await studentWin(app);
  const measure = () =>
    sw.evaluate(() => {
      const t = document.querySelector('[data-testid=board-text]');
      const span = t.querySelector('span');
      const tr = document.querySelector('[data-testid=split-timer]').getBoundingClientRect();
      const br = span.getBoundingClientRect();
      const digits = document.querySelector('[data-testid=timer-digits]').getBoundingClientRect();
      const overlap = !(br.right <= tr.left || br.left >= tr.right || br.bottom <= tr.top || br.top >= tr.bottom);
      const digitsInside = digits.left >= tr.left - 1 && digits.right <= tr.right + 1 && digits.top >= tr.top - 1 && digits.bottom <= tr.bottom + 1;
      return { overlap, overflow: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1, digitsInside, vw: innerWidth, vh: innerHeight };
    });
  const sizes = [[1280, 720], [1024, 768], [1366, 768], [1920, 1200]];
  for (const [w, h] of sizes) {
    await app.evaluate(({}, [w, h]) => { const win = globalThis.__ct.student.win; win.setFullScreen(false); win.setContentSize(w, h); }, [w, h]);
    await sleep(500);
    const r = await measure();
    assert(!r.overlap && !r.overflow && r.digitsInside, `${w}x${h}: ` + JSON.stringify(r));
  }
  await app.evaluate(() => globalThis.__ct.student.win.webContents.setZoomFactor(1.5));
  await sleep(500);
  const z = await measure();
  assert(!z.overlap && !z.overflow && z.digitsInside, '150%: ' + JSON.stringify(z));
  await sw.screenshot({ path: path.join(shots, '05b-student-split-1920x1200-150pct.png') });
  await app.evaluate(() => { globalThis.__ct.student.win.webContents.setZoomFactor(1); globalThis.__ct.student.currentDisplayId = null; globalThis.__ct.student.show(true); });
  await sleep(300);
});

await check('종료 화면 유지 + 알림음 1회', async () => {
  const sw = await studentWin(app);
  await sw.waitForSelector('.st-timer.finished', { timeout: 10_000 });
  const t = await sw.textContent('[data-testid=timer-panel]');
  assert(t.includes('00:00') && t.includes('시간이 끝났어요!'), t);
  await sw.screenshot({ path: path.join(shots, '06-student-split-finished.png') });
  await sleep(3000);
  assert(await sw.$('.st-timer.finished'), '종료 화면이 자동으로 사라짐');
  const sounds = await app.evaluate(() => globalThis.__ct.soundLog.length);
  const played = await teacher.evaluate(() => (window.__soundPlays || []).length);
  assert(sounds === 1 && played === 1, `알림음 횟수 main=${sounds}, renderer=${played}`);
});

await check('같은 예약이 중복 실행되지 않음', async () => {
  await sleep(1500);
  const fired = await app.evaluate(() => globalThis.__ct.ctl.data.scheduleLog.filter((e) => e.kind === 'fired').length);
  assert(fired === 1, '실행 기록 ' + fired + '회');
});

await check('종료 화면 닫기 → 이전 칠판 전체 화면 복원 (항상 위 설정이라 맨 위 유지)', async () => {
  await app.evaluate(() => { const t = globalThis.__ct.teacherWin; t.restore(); t.show(); globalThis.__ct.ctl.rt.inTray = false; });
  await teacher.click('[data-tab=timer]');
  await teacher.click('[data-testid=timer-close]');
  const sw = await studentWin(app);
  await sw.waitForSelector('.st-root[data-timer=none] [data-testid=board-text]');
  const t = await sw.textContent('[data-testid=board-text]');
  assert(t.includes('발표 순서를 정하고'), '칠판 복원 안 됨');
  assert((await swInfo(app)).top, '항상 위 설정인데 맨 위가 풀림');
});

await check('학생 화면 숨기기 → 맨 위 해제·숨김, 다시 보이기 → 맨 위', async () => {
  await teacher.click('text=학생 화면 숨기기');
  await sleep(400);
  let i = await swInfo(app);
  assert(!i.visible && !i.top, '숨기기 후 상태: ' + JSON.stringify(i));
  await teacher.click('text=학생 화면 보이기');
  await sleep(400);
  i = await swInfo(app);
  assert(i.visible && i.top && i.bounds.x >= 1920, '다시 보이기 후 상태: ' + JSON.stringify(i));
});

await check('항상 위 설정을 끄면: 평소에는 일반 창, 타이머 표시 중에만 맨 위', async () => {
  await app.evaluate(({}) => globalThis.__ct.ctl.data.settings.studentAlwaysOnTop = false);
  await app.evaluate(() => globalThis.__ct.student.applyTopmost(false));
  assert(!(await swInfo(app)).top, '설정을 꺼도 맨 위');
  await dispatch(app, { type: 'timer/start', durationSec: 60, activity: '', sound: 'none', volume: 0, mode: 'split' });
  assert((await swInfo(app)).top, '타이머 표시 중 맨 위가 아님');
  await dispatch(app, { type: 'timer/close' });
  assert(!(await swInfo(app)).top, '타이머 닫은 뒤 원래대로 돌아가지 않음');
  await app.evaluate(({}) => globalThis.__ct.ctl.data.settings.studentAlwaysOnTop = true);
  await app.evaluate(() => globalThis.__ct.student.applyTopmost(false));
});

await check('표시 방식 전환 시 남은 시간·일시정지 유지', async () => {
  await dispatch(app, { type: 'timer/start', durationSec: 120, activity: '모둠 활동', sound: 'none', volume: 0, mode: 'split' });
  await sleep(1200);
  await dispatch(app, { type: 'timer/pause' });
  const before = await app.evaluate(() => globalThis.__ct.ctl.rt.timer.remainingMs);
  await dispatch(app, { type: 'timer/setMode', mode: 'full' });
  await sleep(1500);
  const t = await app.evaluate(() => globalThis.__ct.ctl.rt.timer);
  assert(t.status === 'paused' && t.remainingMs === before && t.mode === 'full', JSON.stringify(t));
  const sw = await studentWin(app);
  await sw.waitForSelector('.st-timer-full');
  await sw.screenshot({ path: path.join(shots, '07-student-full-paused.png') });
  await dispatch(app, { type: 'timer/setMode', mode: 'split' });
  await dispatch(app, { type: 'timer/resume' });
  const t2 = await app.evaluate(() => globalThis.__ct.ctl.rt.timer);
  assert(t2.status === 'running' && Math.abs(t2.endAt - Date.now() - before) < 1500, '계속 후 남은 시간 불일치');
  await dispatch(app, { type: 'timer/close' });
});

await check('발표자 뽑기: 3명 뽑기 → 학생 화면 큰 이름', async () => {
  await dispatch(app, { type: 'picker/options', count: 3, mode: 'unique' });
  await teacher.click('[data-tab=picker]');
  await teacher.click('[data-testid=pick-draw]');
  const sw = await studentWin(app);
  await sw.waitForSelector('.st-pick.reveal', { timeout: 5000 });
  const names = await sw.$$eval('[data-testid=pick-name]', (els) => els.map((e) => e.textContent));
  assert(names.length === 3 && new Set(names).size === 3, names.join());
  await sw.screenshot({ path: path.join(shots, '08-student-picker.png') });
  const rem = await teacher.textContent('[data-testid=pick-remaining]');
  assert(rem.includes('20명'), rem);
});

await check('TV 연결 해제 → 학생 창 숨김(교사 화면에 전체 화면 표시 안 함) → 재연결 시 다시 표시', async () => {
  await dispatch(app, { type: 'student/base', base: 'board' });
  await setDisplays(app, false);
  const info = await swInfo(app);
  assert(!info.visible, '연결 해제 후에도 학생 창이 보임');
  await teacher.waitForSelector('text=학생용 디스플레이 연결이 끊겨');
  const r = await dispatch(app, { type: 'student/show' });
  assert(!r.ok, '디스플레이 없이 학생 화면 표시됨');
  await setDisplays(app, true);
  const info2 = await until(async () => {
    const i = await swInfo(app);
    return i?.visible ? i : null;
  }, 3000, '재연결 후 다시 표시되지 않음');
  assert(info2.bounds.x >= 1920, '재연결 후 위치가 TV가 아님');
});

await check('교사 화면 스크린샷', async () => {
  await teacher.click('[data-tab=seating]');
  await teacher.screenshot({ path: path.join(shots, '09-teacher-seating.png') });
  await teacher.click('[data-tab=schedule]');
  await teacher.screenshot({ path: path.join(shots, '10-teacher-schedule.png') });
  await teacher.click('[data-tab=board]');
  await teacher.screenshot({ path: path.join(shots, '11-teacher-board.png') });
  await teacher.click('[data-tab=timer]');
  await teacher.screenshot({ path: path.join(shots, '12-teacher-timer.png') });
});

// 재시작 후 복원
const before = await app.evaluate(() => {
  const c = globalThis.__ct.ctl;
  return { n: c.cls.students.length, board: c.data.boardPublished.text, sched: c.data.schedules.length, fixed: c.cls.seating.fixed.length, confirmed: !!c.cls.seating.confirmed };
});
await app.evaluate(({ app }) => {
  globalThis.__ct.store.flush();
});
await app.close();

await check('앱 재시작 후 데이터 복원', async () => {
  ({ app, teacher } = await launch());
  const after = await app.evaluate(() => {
    const c = globalThis.__ct.ctl;
    return { n: c.cls.students.length, board: c.data.boardPublished.text, sched: c.data.schedules.length, fixed: c.cls.seating.fixed.length, confirmed: !!c.cls.seating.confirmed };
  });
  assert(JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));
});

await check('중복 실행 방지: 두 번째 실행은 바로 종료', async () => {
  const second = await electron.launch({ executablePath: electronPath, args: ['--no-sandbox', root], env: { ...process.env, CT_E2E: '1', CT_USER_DATA: userData } }).catch((e) => null);
  if (second) {
    const closed = await Promise.race([second.waitForEvent('close').then(() => true), sleep(6000).then(() => false)]);
    if (!closed) await second.close();
    assert(closed, '두 번째 인스턴스가 종료되지 않음');
  }
});

await app.close();
console.log(`\n결과: ${passed}개 통과, ${failures.length}개 실패`);
if (failures.length) {
  console.log('실패:', failures.join(', '));
  process.exit(1);
}
