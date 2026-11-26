// 실제 Electron 앱을 띄워 주요 흐름을 검증하는 E2E 스크립트 (Playwright + Electron)
// 실행: DISPLAY가 있는 환경(또는 xvfb-run)에서 `npm run e2e`
// 가상 환경에는 실제 두 번째 모니터가 없으므로 Electron screen API를 가짜 디스플레이로 바꿔 연결·해제를 흉내 낸다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// 프로젝트 devDependency(playwright-core)를 먼저 쓰고, 없으면 전역 Playwright. Electron 테스트에는 브라우저 내려받기가 필요 없다.
function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright']) {
    try {
      return require(name);
    } catch {
      /* 다음 후보 */
    }
  }
  console.error('Playwright를 찾을 수 없습니다. 먼저 `npm install`을 실행해 주세요 (devDependency: playwright-core).');
  process.exit(2);
}
const { _electron: electron } = loadPlaywright();
// Windows에서도 맞는 경로 (URL.pathname은 /C:/... 처럼 앞에 /가 붙고 한글·공백이 %인코딩되어 틀림)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// 업데이트 검사용 가짜 릴리스 서버 (실제 GitHub 대신)
import http from 'node:http';
import crypto from 'node:crypto';
const fakeExe = crypto.randomBytes(300_000);
let fakeDigest = 'sha256:' + crypto.createHash('sha256').update(fakeExe).digest('hex');
const updServer = http.createServer((req, res) => {
  if (req.url === '/latest') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tag_name: 'v99.0.0', published_at: new Date().toISOString(), body: '테스트용 새 버전', assets: [{ name: 'ClassroomTools-Setup-99.0.0.exe', size: fakeExe.length, digest: fakeDigest, browser_download_url: `http://127.0.0.1:${updServer.address().port}/setup.exe` }] }));
  } else if (req.url === '/cal.ics' || req.url === '/private.ics') {
    const d = (n, h) => { const x = new Date(); x.setDate(x.getDate() + n); const p = (v) => String(v).padStart(2, '0'); return h === undefined ? `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}` : `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}T${p(h)}0000`; };
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.end(req.url === '/cal.ics'
      ? `BEGIN:VCALENDAR\r\nX-WR-CALNAME:학교 일정\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;VALUE=DATE:${d(0)}\r\nDTEND;VALUE=DATE:${d(1)}\r\nSUMMARY:공문 제출\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART;TZID=Asia/Seoul:${d(1, 14)}\r\nDTEND;TZID=Asia/Seoul:${d(1, 15)}\r\nSUMMARY:학년 협의회\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
      : `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:p\r\nDTSTART;VALUE=DATE:${d(0)}\r\nSUMMARY:개인 병원 예약\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  } else if (req.url.startsWith('/weather')) {
    res.end(JSON.stringify({ current: { temperature_2m: 15.2, weather_code: 2 }, daily: { temperature_2m_max: [16.4], temperature_2m_min: [7.1], precipitation_probability_max: [24] } }));
  } else if (req.url.startsWith('/air')) {
    res.end(JSON.stringify({ current: { pm10: 25, pm2_5: 12 } }));
  } else if (req.url.startsWith('/neis/schoolInfo')) {
    res.end(JSON.stringify({ schoolInfo: [{ head: [] }, { row: [{ ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7010000', SCHUL_NM: '서울테스트초등학교', ORG_RDNMA: '서울특별시 어딘가', SCHUL_KND_SC_NM: '초등학교' }] }] }));
  } else if (req.url.startsWith('/neis/mealServiceDietInfo')) {
    res.end(JSON.stringify({ mealServiceDietInfo: [{ head: [] }, { row: [{ MMEAL_SC_NM: '중식', DDISH_NM: '귀리밥 (5.6.)<br/>투움바파스타 (2.5.6.13.)<br/>황태미역국 (5.6.9.)<br/>배추김치' }] }] }));
  } else if (req.url === '/setup.exe') {
    res.setHeader('content-length', String(fakeExe.length));
    res.end(fakeExe);
  } else res.writeHead(404).end();
});
await new Promise((r) => updServer.listen(0, '127.0.0.1', r));
const updBase = `http://127.0.0.1:${updServer.address().port}`;
const updApi = `${updBase}/latest`;

async function launch() {
  const app = await electron.launch({ executablePath: electronPath, args: ['--no-sandbox', root], env: { ...process.env, CT_E2E: '1', CT_USER_DATA: userData, TZ: process.env.TZ, CT_UPDATE_API: updApi, CT_UPDATE_NO_INSTALL: '1', CT_WEATHER_URL: updBase + '/weather', CT_AIR_URL: updBase + '/air', CT_NEIS_URL: updBase + '/neis' } });
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
    // 실제 PC처럼 교사용 창은 주 모니터(왼쪽 1920px) 안에 둔다
    const t = globalThis.__ct.teacherWin;
    if (t && !t.isDestroyed()) t.setBounds({ x: 0, y: 0, width: 1440, height: 920 });
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

await check('모니터 1대: 학생 화면(미리보기 창)에서 Esc → 숨김, 교사용 창으로', async () => {
  await app.evaluate(() => globalThis.__ct.student.openPreview());
  await sleep(600);
  const sw = await until(() => studentWin(app), 5000, '학생 창 없음');
  assert((await swInfo(app)).visible, '미리보기 창이 안 보임');
  await teacher.waitForSelector('[data-testid=esc-hint]', { timeout: 3000 });
  // 1) 실제 키보드 입력과 같은 경로 (Electron 입력 이벤트)
  await app.evaluate(() => globalThis.__ct.student.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }));
  await until(async () => !(await swInfo(app)).visible, 3000, 'Esc를 눌러도 숨겨지지 않음');
  assert(await app.evaluate(() => globalThis.__ct.teacherWin.isVisible()), '교사용 창이 보이지 않음');
  // 2) 화면 안 키 이벤트 경로
  await app.evaluate(() => globalThis.__ct.student.openPreview());
  await sleep(500);
  await sw.keyboard.press('Escape');
  await until(async () => !(await swInfo(app)).visible, 3000, '화면 안 Esc로 숨겨지지 않음');
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

await check('칠판 세로 정렬: 위쪽·가운데·아래쪽', async () => {
  await teacher.click('[data-tab=board]');
  await dispatch(app, { type: 'board/updateDraft', patch: { text: '짧은 문장', autoFit: false, fontSize: 10 } });
  const sw = await studentWin(app);
  const pos = async (v) => {
    await teacher.click(`[data-testid=board-valign] [data-valign=${v}]`);
    await teacher.click('[data-testid=board-publish]');
    await sw.waitForSelector(`[data-testid=board-text][data-valign=${v}]`, { timeout: 3000 });
    return sw.evaluate(() => {
      const box = document.querySelector('[data-testid=board-text]').getBoundingClientRect();
      const t = document.querySelector('[data-testid=board-text] span').getBoundingClientRect();
      return { top: t.top - box.top, bottom: box.bottom - t.bottom };
    });
  };
  const top = await pos('top');
  const mid = await pos('middle');
  const bot = await pos('bottom');
  assert(top.top < 5 && bot.bottom < 5 && Math.abs(mid.top - mid.bottom) < 5, JSON.stringify({ top, mid, bot }));
  await sw.screenshot({ path: path.join(shots, '24-student-board-bottom.png') });
  await teacher.click('[data-testid=board-valign] [data-valign=middle]');
  await dispatch(app, { type: 'board/updateDraft', patch: { autoFit: true } });
});

await check('모니터 2대(학생 화면이 TV에 따로 있음): Esc를 눌러도 숨겨지지 않음', async () => {
  const sw = await studentWin(app);
  await app.evaluate(() => globalThis.__ct.student.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }));
  await sw.keyboard.press('Escape');
  await sleep(500);
  assert((await swInfo(app)).visible, 'TV 쪽 학생 화면이 Esc로 숨겨짐');
});

await check('칠판 실시간 반영: 켜면 입력하는 즉시 학생 화면에 보임', async () => {
  await teacher.click('[data-testid=board-live]');
  await teacher.fill('[data-testid=board-input]', '실시간으로 보이는 문장');
  const sw = await studentWin(app);
  await until(async () => (await sw.textContent('[data-testid=board-text]'))?.includes('실시간으로 보이는 문장'), 3000, '입력 내용이 학생 화면에 바로 반영되지 않음');
  await teacher.click('[data-testid=board-live]'); // 끄기
  await teacher.fill('[data-testid=board-input]', '오늘의 할 일\n1. 수학 익힘책 24쪽\n2. 받아쓰기 연습');
  await sleep(800);
  assert((await sw.textContent('[data-testid=board-text]')).includes('실시간으로 보이는 문장'), '끈 뒤에도 바로 반영됨');
  await teacher.click('[data-testid=board-publish]');
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

await check('미리 추첨 뒤 학생을 추가하면 공개·확정 버튼이 막히고 이유를 보여 줌', async () => {
  await teacher.click('[data-tab=seating]');
  await teacher.click('[data-testid=seat-draw-preview]');
  await sleep(300);
  assert(await teacher.isEnabled('[data-testid=seat-reveal]'), '추첨 직후 공개 버튼이 꺼져 있음');
  await dispatch(app, { type: 'student/add', name: '전학생' });
  await teacher.waitForSelector('[data-testid=draft-stale]', { timeout: 3000 });
  assert((await teacher.textContent('[data-testid=draft-stale]')).includes('전학생'), '이유에 학생 이름이 없음');
  assert(!(await teacher.isEnabled('[data-testid=seat-reveal]')) && !(await teacher.isEnabled('[data-testid=seat-confirm]')), '버튼이 막히지 않음');
  const r = await dispatch(app, { type: 'seating/confirm' });
  assert(!r.ok, '메인 프로세스에서도 막혀야 함');
  const id = await app.evaluate(() => globalThis.__ct.ctl.cls.students.find((s) => s.name === '전학생').id);
  await dispatch(app, { type: 'student/delete', id });
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

await check('분단별 설정(1분단 2명·2분단 3명·3분단 2명) + 남녀 자리 지정 → 추첨', async () => {
  // 성별 입력: 명단 화면에서 앞 12명 남, 나머지 여 (일부는 UI 버튼으로)
  const ids = await app.evaluate(() => globalThis.__ct.ctl.cls.students.map((s) => s.id));
  for (let i = 0; i < ids.length; i++) await dispatch(app, { type: 'student/update', id: ids[i], gender: i < 12 ? 'M' : 'F' });
  await teacher.click('[data-tab=roster]');
  await teacher.screenshot({ path: path.join(shots, '14-teacher-roster-gender.png') });
  await teacher.click('[data-tab=seating]');
  await teacher.click('[data-testid=layout-custom]');
  await teacher.waitForSelector('[data-testid=group-editor]');
  await teacher.click('[data-testid=group-0-size-2]');
  await teacher.click('[data-testid=group-1-size-3]');
  if ((await teacher.locator('[data-testid=group-row]').count()) < 3) await teacher.click('[data-testid=group-add]');
  await teacher.click('[data-testid=group-2-size-2]');
  await sleep(300);
  const groups = await app.evaluate(() => globalThis.__ct.ctl.cls.seating.layout.groups.map((g) => g.size));
  assert(JSON.stringify(groups) === '[2,3,2]', '분단 인원 ' + JSON.stringify(groups));
  await teacher.click('[data-testid=mode-gender]');
  await teacher.click('[data-testid=gender-pattern-pair-mf]');
  await sleep(300);
  const counts = await teacher.textContent('[data-testid=gender-counts]');
  assert(counts.includes('남자 자리') && counts.includes('여자 자리'), counts);
  await teacher.screenshot({ path: path.join(shots, '15-teacher-groups-gender.png') });
  await teacher.click('[data-testid=seat-draw-reveal]');
  await sleep(2800);
  const res = await app.evaluate(() => {
    const c = globalThis.__ct.ctl.cls;
    const gm = c.seating.layout.genderCustom;
    const fixedSeats = new Set(c.seating.fixed.map((f) => f.seatId));
    const bad = Object.entries(c.seating.draft.assignment).filter(([seat, sid]) => gm[seat] && !fixedSeats.has(seat) && c.students.find((s) => s.id === sid).gender !== gm[seat]);
    return { n: Object.keys(c.seating.draft.assignment).length, bad: bad.length, type: c.seating.layout.type };
  });
  assert(res.type === 'custom' && res.n === 23 && res.bad === 0, JSON.stringify(res));
  const sw = await studentWin(app);
  const visible = await sw.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('*')].map((e) => e.className).join(' '));
  assert(!/남자|여자|g-m|g-f|gtag|🔒|고정/.test(visible), '학생 화면에 남녀 자리·고정 표시가 있음');
  await sw.screenshot({ path: path.join(shots, '16-student-groups.png') });
  // 다음 검사를 위해 원래대로
  await teacher.click('[data-testid=gender-pattern-clear]');
  await teacher.click('[data-testid=layout-pair]');
  await teacher.click('[data-testid=mode-toggle]');
  await dispatch(app, { type: 'seating/draw', reveal: false });
  await dispatch(app, { type: 'seating/confirm' });
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

await check('예약 편집: 표시 방식별 학생 화면 미리보기 (칠판+타이머 / 전체 화면)', async () => {
  await teacher.click('[data-testid=schedule-new]');
  const ed = teacher.locator('[data-testid=schedule-editor]');
  const split = ed.locator('.mode-preview[data-mode=split]');
  const full = ed.locator('.mode-preview[data-mode=full]');
  assert((await split.locator('[data-testid=split-board]').count()) === 1 && (await split.locator('[data-testid=split-timer]').count()) === 1, '함께 보기 미리보기에 칠판·타이머가 없음');
  assert((await split.textContent()).includes('발표 자료를 만듭니다'), '미리보기에 현재 칠판 내용이 없음');
  assert((await full.locator('.st-timer-full').count()) === 1 && (await full.locator('[data-testid=split-board]').count()) === 0, '전체 화면 미리보기가 타이머만 보여 주지 않음');
  await full.click();
  assert((await full.getAttribute('aria-pressed')) === 'true' && (await split.getAttribute('aria-pressed')) === 'false', '선택이 바뀌지 않음');
  await ed.screenshot({ path: path.join(shots, '13-schedule-mode-preview.png') });
  await ed.locator('button', { hasText: '취소' }).click();
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
    // Windows에서 '최소화된 창은 showInactive만으로 복원되지 않는' 상황을 흉내 낸다
    let fakeMin = true;
    const origMin = sw.isMinimized.bind(sw);
    sw.isMinimized = () => fakeMin || origMin();
    const origRestore = sw.restore.bind(sw);
    sw.restore = (...a) => (calls.push('student.restore'), (fakeMin = false), origRestore(...a));
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
  assert(calls.includes('student.restore'), '최소화 상태에서 복원하지 않음: ' + calls.join());
  const diagLog = fs.readFileSync(path.join(userData, 'schedule-log.txt'), 'utf8');
  assert(diagLog.includes('[예약 fired]') && diagLog.includes('학생 창 표시'), '진단 기록이 남지 않음');
  assert(!calls.some((c) => c.startsWith('teacher.') || c === 'student.focus' || c === 'student.show'), '포커스를 빼앗는 호출: ' + calls.join());
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=split-timer]');
  const boardTxt = await sw.textContent('[data-testid=split-board]');
  assert(boardTxt.includes('발표 자료를 만듭니다'), '함께 보기에서 칠판 내용이 유지되지 않음');
  await sw.screenshot({ path: path.join(shots, '05-student-split-timer.png') });
});

// 함께 보기에서 칠판 글자의 실제 줄 위치를 재서 타이머와 겹치는지·잘리는지 확인
const splitMeasure = () => {
  const t = document.querySelector('[data-testid=board-text]');
  const box = t.parentElement.getBoundingClientRect();
  const tr = document.querySelector('[data-testid=split-timer]').getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(t);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
  const overlap = rects.some((b) => !(b.right <= tr.left + 0.5 || b.left >= tr.right - 0.5 || b.bottom <= tr.top + 0.5 || b.top >= tr.bottom - 0.5));
  const inside = rects.every((b) => b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1);
  const digits = document.querySelector('[data-testid=timer-digits]').getBoundingClientRect();
  const digitsInside = digits.left >= tr.left - 1 && digits.right <= tr.right + 1 && digits.top >= tr.top - 1 && digits.bottom <= tr.bottom + 1;
  return { overlap, inside, digitsInside, lines: new Set(rects.map((r) => Math.round(r.top))).size, len: t.textContent.length };
};

await check('함께 보기: 긴 칠판 문구가 타이머 영역에 가려지거나 잘리지 않음', async () => {
  const sw = await studentWin(app);
  const r = await sw.evaluate(splitMeasure);
  assert(!r.overlap, '칠판 글자가 타이머와 겹침 ' + JSON.stringify(r));
  assert(r.inside, '칠판 글자가 영역 밖으로 나감 ' + JSON.stringify(r));
  assert(r.len === longText.length, '문구가 잘림');
});

await check('함께 보기: 여러 해상도·화면 배율(150%)에서도 겹침·잘림 없음', async () => {
  const sw = await studentWin(app);
  const sizes = [[1280, 720], [1024, 768], [1366, 768], [1920, 1200]];
  for (const [w, h] of sizes) {
    await app.evaluate(({}, [w, h]) => { const win = globalThis.__ct.student.win; win.setFullScreen(false); win.setContentSize(w, h); }, [w, h]);
    await sleep(500);
    const r = await sw.evaluate(splitMeasure);
    assert(!r.overlap && r.inside && r.digitsInside, `${w}x${h}: ` + JSON.stringify(r));
  }
  await app.evaluate(() => globalThis.__ct.student.win.webContents.setZoomFactor(1.5));
  await sleep(500);
  const z = await sw.evaluate(splitMeasure);
  assert(!z.overlap && z.inside && z.digitsInside, '150%: ' + JSON.stringify(z));
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

await check('학생 위젯의 맨 위 표시는 위젯 설정을 따로 따름 (끄면 일반 창, 다른 화면은 기본 설정)', async () => {
  await dispatch(app, { type: 'student/base', base: 'widget', main: 'clock' });
  await dispatch(app, { type: 'widget/update', patch: { studentOnTop: false } });
  await new Promise((r) => setTimeout(r, 200));
  assert(!(await swInfo(app)).top, '위젯 맨 위 설정을 꺼도 맨 위');
  await dispatch(app, { type: 'student/base', base: 'board' });
  await new Promise((r) => setTimeout(r, 200));
  assert((await swInfo(app)).top, '칠판으로 바꾸면 기본 설정(맨 위)을 따라야 함');
  await dispatch(app, { type: 'student/base', base: 'widget', main: 'clock' });
  await new Promise((r) => setTimeout(r, 200));
  assert(!(await swInfo(app)).top, '위젯으로 돌아오면 다시 일반 창이어야 함');
  // 이미 일반 창이면 ‘맨 위 해제’를 다시 보내지 않아야 함 (Windows는 해제 요청을 받으면 그 창을 다른 창들 앞으로 올림)
  await app.evaluate(() => {
    const w = globalThis.__ct.student.win;
    globalThis.__topCalls = [];
    if (!w.__origTop) w.__origTop = w.setAlwaysOnTop.bind(w);
    w.setAlwaysOnTop = (...a) => (globalThis.__topCalls.push(a[0]), w.__origTop(...a));
  });
  await app.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getAllDisplays()[1], ['workArea']));
  await dispatch(app, { type: 'student/widgetMain', main: 'board' });
  await dispatch(app, { type: 'board/publish' });
  await dispatch(app, { type: 'student/show' });
  await dispatch(app, { type: 'student/widgetMain', main: 'clock' });
  await new Promise((r) => setTimeout(r, 300));
  const calls = await app.evaluate(() => globalThis.__topCalls.slice());
  assert(calls.length === 0 && !(await swInfo(app)).top, '일반 창인데 맨 위 설정 호출이 반복됨: ' + JSON.stringify(calls));
  // 타이머는 진행 중에만 맨 위, 끝나면(끝난 화면이 남아 있어도) 설정대로 일반 창
  await dispatch(app, { type: 'timer/start', durationSec: 2, activity: '', sound: 'none', volume: 0, mode: 'split', warnFrom: 0 });
  await new Promise((r) => setTimeout(r, 300));
  assert((await swInfo(app)).top, '타이머 진행 중인데 맨 위가 아님');
  await new Promise((r) => setTimeout(r, 2500));
  const fin = await app.evaluate(() => globalThis.__ct.ctl.rt.timer.status);
  assert(fin === 'finished' && !(await swInfo(app)).top, `타이머가 끝났는데 계속 맨 위 (${fin})`);
  await dispatch(app, { type: 'timer/close' });
  await app.evaluate(() => {
    const w = globalThis.__ct.student.win;
    w.setAlwaysOnTop = w.__origTop;
  });
  await dispatch(app, { type: 'widget/update', patch: { studentOnTop: true } });
  await new Promise((r) => setTimeout(r, 200));
  assert((await swInfo(app)).top, '위젯 맨 위 설정을 켜도 맨 위가 아님');
  await dispatch(app, { type: 'student/base', base: 'blank' });
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

await check('함께 보기: 두세 줄 문구가 타이머 위 오른쪽 빈 곳까지 써서 불필요하게 줄바꿈되지 않음 (세로 정렬 포함)', async () => {
  const sw = await studentWin(app);
  const text = '1. 뒴뒴수학 36~38쪽 풀기\n2.아침독서';
  await dispatch(app, { type: 'board/updateDraft', patch: { text, autoFit: true, align: 'left', vAlign: 'top' } });
  await dispatch(app, { type: 'board/publish' });
  await dispatch(app, { type: 'timer/start', durationSec: 300, activity: '아침시간', sound: 'none', volume: 0, mode: 'split' });
  await sw.waitForSelector('[data-testid=split-timer]');
  await sleep(400);
  const r = await sw.evaluate(splitMeasure);
  await sw.screenshot({ path: path.join(shots, '25-student-split-two-lines.png') });
  assert(r.lines === 2 && !r.overlap && r.inside, '두 줄 문구가 더 많은 줄로 나뉨: ' + JSON.stringify(r));
  for (const v of ['middle', 'bottom']) {
    await dispatch(app, { type: 'board/updateDraft', patch: { vAlign: v } });
    await dispatch(app, { type: 'board/publish' });
    await sleep(400);
    const q = await sw.evaluate(splitMeasure);
    assert(!q.overlap && q.inside, v + ': ' + JSON.stringify(q));
  }
  const three = '1. 뒴뒴수학 36~38쪽 풀기\n2. 아침독서 20분\n3. 알림장 쓰고 가방 정리하기';
  await dispatch(app, { type: 'board/updateDraft', patch: { text: three, vAlign: 'top' } });
  await dispatch(app, { type: 'board/publish' });
  await sleep(400);
  const r3 = await sw.evaluate(splitMeasure);
  assert(!r3.overlap && r3.inside && r3.lines <= 4, '세 줄 문구: ' + JSON.stringify(r3));
  await sw.screenshot({ path: path.join(shots, '26-student-split-three-lines.png') });
  await dispatch(app, { type: 'timer/close' });
  await dispatch(app, { type: 'board/updateDraft', patch: { text: longText, align: 'center', vAlign: 'middle' } });
  await dispatch(app, { type: 'board/publish' });
});

await check('종료 예고음: 6초 타이머 · 10초 전부터 → 1초마다 예고음 후 종료 알림음 1번', async () => {
  const before = await app.evaluate(() => globalThis.__ct.soundLog.length);
  const beforeR = await teacher.evaluate(() => (window.__soundPlays || []).length);
  await dispatch(app, { type: 'timer/start', durationSec: 6, activity: '', sound: 'bell', volume: 40, mode: 'split', warnFrom: 10, warnVolume: 90 });
  const endAt = await app.evaluate(() => globalThis.__ct.ctl.rt.timer.endAt);
  const sw = await until(() => studentWin(app));
  await sleep(7500);
  const entries = await app.evaluate((_e, n) => globalThis.__ct.soundLog.slice(n), before);
  const log = entries.map((x) => x.sound);
  const ticks = entries.filter((x) => x.sound === 'tick');
  assert(ticks.length === 6 && log.every((x) => x === 'tick' || x === 'bell'), '예고음 ' + log.join(','));
  assert(ticks.every((x) => x.volume === 90), '예고음 크기 ' + ticks.map((x) => x.volume).join(','));
  // 첫 소리(시작 직후) 뒤로는 화면의 초가 바뀌는 순간(정확히 1초 간격)에 맞춰 예약, 마지막 예고음 1초 뒤 종료 알림음
  const dues = entries.map((x) => x.due - endAt);
  assert(JSON.stringify(dues.slice(1)) === JSON.stringify([-5000, -4000, -3000, -2000, -1000, 0]), '예약 시각 ' + JSON.stringify(dues));
  assert(log.filter((x) => x === 'bell').length === 1 && log[log.length - 1] === 'bell', '종료 알림음 ' + log.join(','));
  // 끝난 화면은 닫을 때까지 유지
  assert((await sw.getAttribute('[data-testid=timer-panel]', 'data-status')) === 'finished', '끝난 화면이 사라짐');
  assert(await teacher.isVisible('[data-testid=timer-finished-banner]'), '교사 화면 종료 알림 띠가 없음');
  const played = (await teacher.evaluate(() => (window.__soundPlays || []).length)) - beforeR;
  assert(played === 7, '교사 화면에서 재생된 소리 ' + played);
  await dispatch(app, { type: 'timer/close' });
  await dispatch(app, { type: 'timer/defaults', patch: { timerWarnFrom: 0 } });
});

await check('업데이트: 새 버전 확인 → 내려받기·무결성 검증 (설치 직전까지)', async () => {
  await teacher.click('[data-tab=settings]');
  await teacher.waitForSelector('nav >> text=새 버전', { timeout: 5000 }); // 시작할 때 자동 확인
  await teacher.click('[data-testid=update-check]');
  await until(async () => (await teacher.textContent('[data-testid=update-status]'))?.includes('v99.0.0'), 5000, '새 버전 표시 없음');
  await teacher.screenshot({ path: path.join(shots, '17-teacher-update.png') });
  const r = await app.evaluate(() => globalThis.__ct.updater.install());
  assert(r.ok, JSON.stringify(r));
  const info = await app.evaluate(() => ({ st: globalThis.__ct.ctl.rt.update.status, file: globalThis.__ct.updater.downloadedPath }));
  assert(info.st === 'installing' && fs.readFileSync(info.file).equals(fakeExe), JSON.stringify(info));
  // 파일이 손상된 경우(해시 불일치) 설치하지 않음
  fakeDigest = 'sha256:' + '0'.repeat(64);
  await app.evaluate(() => { globalThis.__ct.ctl.rt.update.status = 'idle'; });
  await app.evaluate(() => globalThis.__ct.updater.check(false));
  const bad = await app.evaluate(() => globalThis.__ct.updater.install());
  assert(!bad.ok && /손상/.test(bad.error), JSON.stringify(bad));
  // 해시(digest)가 없는 릴리스는 내려받기 전에 설치를 거부
  fakeDigest = undefined;
  await app.evaluate(() => { globalThis.__ct.ctl.rt.update.status = 'idle'; });
  await app.evaluate(() => globalThis.__ct.updater.check(false));
  const noHash = await app.evaluate(() => globalThis.__ct.updater.install());
  assert(!noHash.ok && /SHA-256/.test(noHash.error), JSON.stringify(noHash));
  fakeDigest = 'sha256:' + crypto.createHash('sha256').update(fakeExe).digest('hex');
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

const widgetWin = async () => {
  for (const w of app.windows()) if ((await w.title()) === '교실 도구 위젯') return w;
  return null;
};

await check('바탕화면 위젯: 구글 캘린더(iCal) 연결 → 달력·일정, 날씨, 급식, 할 일, 시간표', async () => {
  await teacher.click('[data-tab=widget]');
  await teacher.fill('[data-testid=ical-url]', updBase + '/cal.ics');
  await teacher.click('[data-testid=ical-add]');
  await until(async () => (await teacher.textContent('[data-testid=calendar-list]')).includes('일정 2개'), 8000, '캘린더 연결 안 됨');
  await teacher.fill('[data-testid=ical-url]', updBase + '/private.ics');
  await teacher.locator('input[placeholder="이름 (예: 학교 일정)"]').fill('개인');
  await teacher.click('[data-testid=ical-add]');
  await until(async () => (await app.evaluate(() => globalThis.__ct.ctl.data.widget.calendars.map((c) => c.name).join())) === '학교 일정,개인', 8000, '두 번째 캘린더 연결 안 됨');
  // 학교(급식) 고르기
  await teacher.fill('[data-testid=school-q]', '서울테스트');
  await teacher.click('[data-testid=school-search]');
  await teacher.click('[data-testid=school-pick]');
  // 화면으로 보내는 상태에 캘린더 주소가 없어야 함
  const st = await teacher.evaluate(() => window.api.getState().then((x) => JSON.stringify(x)));
  assert(!st.includes('/cal.ics') && !st.includes('/private.ics'), '교사 화면 상태에 iCal 주소가 들어 있음');
  await teacher.click('[data-testid=widget-toggle]');
  const ww = await until(() => widgetWin(), 5000, '위젯 창이 없음');
  await ww.waitForSelector('[data-testid=widget-board]');
  await until(async () => (await ww.textContent('[data-testid=widget-calendar]')).includes('공문 제출'), 5000, '달력에 구글 일정이 없음');
  await app.evaluate(() => globalThis.__ct.widget.refreshWeather());
  await until(async () => (await ww.textContent('[data-card=weather]')).includes('15°'), 5000, '날씨 없음');
  assert((await ww.textContent('[data-card=weather]')).includes('실외 활동 좋음'), '미세먼지 판단 없음');
  await until(async () => (await ww.textContent('[data-card=meal]')).includes('귀리밥'), 5000, '급식 없음');
  // 할 일
  await ww.fill('[data-testid=todo-input]', '교과서 신청');
  await ww.press('[data-testid=todo-input]', 'Enter');
  await until(async () => (await ww.textContent('[data-card=agenda]')).includes('교과서 신청'), 3000, '할 일 추가 안 됨');
  assert((await ww.textContent('[data-card=agenda]')).includes('학년 협의회'), '이번 주 일정 정리에 구글 일정이 없음');
  // 메모: 제목과 본문을 연달아 고쳐도 둘 다 저장
  await ww.fill('.memo .memo-title >> nth=0', '준비물');
  await ww.fill('.memo .memo-text >> nth=0', '리코더, 색연필');
  await until(async () => (await app.evaluate(() => { const m = globalThis.__ct.ctl.data.widget.memos[0]; return m.title + '|' + m.text; })) === '준비물|리코더, 색연필', 3000, '메모 제목·본문 중 하나가 저장되지 않음');
  // 시간표 고치기
  await ww.dblclick('[data-tt="0-0"]');
  await ww.fill('[data-tt="0-0"] input', '국어');
  await ww.press('[data-tt="0-0"] input', 'Enter');
  await until(async () => (await app.evaluate(() => globalThis.__ct.ctl.data.widget.timetable[0][0])) === '국어', 3000, '시간표 저장 안 됨');
  // 내 일정 추가 (달력 날짜 두 번 누르기)
  const todayKey = await ww.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await ww.dblclick(`[data-date="${todayKey}"]`);
  await ww.fill('[data-testid=add-event] input[type=text]', '학부모 상담');
  await ww.locator('[data-testid=add-event] button', { hasText: '내 일정 (이 PC)' }).click();
  await ww.locator('[data-testid=add-event] button.primary').click();
  await until(async () => (await ww.textContent('[data-testid=widget-calendar]')).includes('학부모 상담'), 3000, '내 일정 추가 안 됨');
  await app.evaluate(() => globalThis.__ct.widget.win.setBounds({ x: 0, y: 0, width: 1600, height: 900 }));
  await sleep(500);
  await ww.screenshot({ path: path.join(shots, '18-widget-board.png') });
});

await check('학생용 위젯: 큰 시계 → 칠판 → 칠판+타이머 → 닫으면 칠판, 시계로 되돌리기 · 구글 일정 없음', async () => {
  await teacher.fill('[data-testid=student-notice]', '내일 준비물: 리코더');
  await teacher.click('[data-testid=student-widget-show]'); // 입력칸을 벗어나며 알림장 저장
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=student-widget][data-main=clock]', { timeout: 5000 });
  await sw.waitForSelector('[data-testid=sw-clock]');
  await until(async () => (await sw.textContent('[data-testid=sw-notice]')).includes('리코더'), 3000, '알림장이 보이지 않음');
  assert((await sw.textContent('[data-testid=sw-meal]')).includes('귀리밥'), '학생 위젯에 급식 없음');
  const all = await sw.textContent('[data-testid=student-widget]');
  assert(!all.includes('공문 제출') && !all.includes('개인 병원') && !all.includes('학부모 상담'), '학생 위젯에 구글·내 일정이 보임');
  await sw.screenshot({ path: path.join(shots, '19-student-widget-clock.png') });
  // 칠판 표시 → 큰 칸에 칠판
  await dispatch(app, { type: 'board/updateDraft', patch: { text: '조용히 책 읽기' } });
  await dispatch(app, { type: 'board/publish' });
  await sw.waitForSelector('[data-testid=student-widget][data-main=board] [data-testid=board-text]', { timeout: 3000 });
  // 타이머 (함께 보기) → 큰 칸에 칠판+타이머
  await dispatch(app, { type: 'timer/start', durationSec: 90, activity: '책 읽기', sound: 'none', volume: 0, mode: 'split' });
  await sw.waitForSelector('[data-testid=student-widget][data-main=split] [data-testid=split-timer]', { timeout: 3000 });
  await sw.screenshot({ path: path.join(shots, '20-student-widget-split.png') });
  await dispatch(app, { type: 'timer/setMode', mode: 'full' });
  await sw.waitForSelector('[data-testid=student-widget][data-main=timer] .st-timer-full', { timeout: 3000 });
  await dispatch(app, { type: 'timer/close' });
  await sw.waitForSelector('[data-testid=student-widget][data-main=board]', { timeout: 3000 });
  await teacher.click('[data-testid=sw-main-clock]');
  await sw.waitForSelector('[data-testid=student-widget][data-main=clock]', { timeout: 3000 });
  await dispatch(app, { type: 'board/updateDraft', patch: { text: '오늘의 할 일\n1. 수학 익힘책 24쪽\n2. 받아쓰기 연습' } });
  await dispatch(app, { type: 'student/base', base: 'board' });
});

await check('학생용 위젯 보일 칸 고르기 (교사용처럼 체크)', async () => {
  await teacher.click('[data-tab=widget]');
  await teacher.click('[data-testid=student-widget-show]');
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=student-widget]');
  const cards = () => sw.$$eval('[data-sw-card]', (els) => els.map((e) => e.getAttribute('data-sw-card')).join(','));
  assert((await cards()) === 'today,notice,calendar,weather,meal,week', await cards());
  for (const id of ['meal', 'notice']) await teacher.click(`[data-sw-check=${id}]`);
  await until(async () => (await cards()) === 'today,calendar,weather,week', 3000, '칸 끄기 반영 안 됨: ');
  assert(await sw.$('.sw-bottom.single'), '아래 칸이 하나일 때 너비를 채우지 않음');
  await sw.screenshot({ path: path.join(shots, '21-student-widget-cards.png') });
  for (const id of ['calendar', 'weather', 'week']) await teacher.click(`[data-sw-check=${id}]`);
  await until(async () => !!(await sw.$('.sw.no-right')), 3000, '오른쪽 칸을 모두 끄면 큰 시계가 넓어지지 않음');
  assert(await sw.$('[data-testid=sw-clock]'), '큰 시계가 사라짐');
  for (const id of ['meal', 'notice', 'calendar', 'weather', 'week']) await teacher.click(`[data-sw-check=${id}]`);
  await until(async () => (await cards()) === 'today,notice,calendar,weather,meal,week', 3000, '다시 켜기 반영 안 됨');
  await dispatch(app, { type: 'student/base', base: 'board' });
});

await check('위젯 탭 시간표 설정: 칸 입력·엑셀 붙여넣기 → 오늘 시간표·학생 위젯 반영, 시계엔 과목 없음', async () => {
  await teacher.click('[data-tab=widget]');
  await teacher.click('[data-testid=tt-paste-toggle]');
  await teacher.fill('[data-testid=tt-paste]', '\t월\t화\t수\t목\t금\n1\t국어\t수학\t사회\t국어\t과학\n2\t수학\t국어\t체육\t음악\t영어\n3\t미술\t미술\t음악\t체육\t창체');
  // 이미 '국어'가 들어 있어 덮어쓰기 확인 창이 뜨므로, 확인 없이 바로 채우기
  const r = await app.evaluate(() => globalThis.__ct.ctl.dispatch({ type: 'widget/timetableAll', table: [['국어', '수학', '미술'], ['수학', '국어', '미술'], ['사회', '체육', '음악'], ['국어', '음악', '체육'], ['과학', '영어', '창체']] }));
  assert(r.ok, JSON.stringify(r));
  await teacher.fill('[data-ttset="0-3"]', '실과');
  await teacher.press('[data-ttset="0-3"]', 'Enter');
  await until(async () => (await app.evaluate(() => globalThis.__ct.ctl.data.widget.timetable[0][3])) === '실과', 3000, '칸 입력 저장 안 됨');
  const dow = new Date().getDay();
  if (dow >= 1 && dow <= 5) {
    const expected = [['국어', '수학', '미술'], ['수학', '국어', '미술'], ['사회', '체육', '음악'], ['국어', '음악', '체육'], ['과학', '영어', '창체']][dow - 1][0];
    assert((await teacher.textContent('[data-testid=today-preview]')).includes(expected), '오늘 시간표 미리보기');
    await dispatch(app, { type: 'student/base', base: 'widget', main: 'clock' });
    const sw = await studentWin(app);
    await sw.waitForSelector('[data-sw-card=today]');
    assert((await sw.textContent('[data-sw-card=today]')).includes(expected), '학생 위젯 오늘 시간표');
    const clock = await sw.textContent('[data-testid=sw-clock]');
    assert(!/국어|수학|사회|과학|미술|음악|체육|영어|창체|실과/.test(clock), '학생 위젯 시계에 과목이 보임: ' + clock);
    await dispatch(app, { type: 'student/base', base: 'board' });
  }
  await teacher.locator('[data-testid=timetable-settings]').screenshot({ path: path.join(shots, '22-teacher-timetable-settings.png') });
});

await check('긴 과목 이름도 잘리지 않음 (학생 위젯 오늘·이번 주 시간표, 교사용 위젯 시간표)', async () => {
  const dow = new Date().getDay();
  const day = dow >= 1 && dow <= 5 ? dow - 1 : 0;
  const long = ['즐거운 생활', '슬기로운 생활 탐구', '안전한 생활과 놀이 활동', '창의적 체험활동 동아리'];
  for (let i = 0; i < long.length; i++) await dispatch(app, { type: 'widget/timetable', day, period: i, value: long[i] });
  const check = (page) =>
    page.$$eval('[data-fit-text]', (els) =>
      els.filter((e) => e.getAttribute('data-fit-text')).map((e) => {
        const sp = e.querySelector('span');
        const a = e.getBoundingClientRect();
        const b = sp.getBoundingClientRect();
        return { t: e.getAttribute('data-fit-text'), ok: sp.textContent === e.getAttribute('data-fit-text') && b.width <= a.width + 1 && b.height <= a.height + 1 && sp.scrollWidth <= e.clientWidth + 1 };
      }),
    );
  await dispatch(app, { type: 'student/base', base: 'widget', main: 'clock' });
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-sw-card=today] [data-fit-text]');
  await sleep(500);
  const rs = await check(sw);
  const bad = rs.filter((r) => !r.ok);
  assert(rs.some((r) => r.t === '안전한 생활과 놀이 활동') && bad.length === 0, '학생 위젯에서 잘린 칸: ' + JSON.stringify(bad));
  for (const sz of [[1280, 720], [1024, 768]]) {
    await app.evaluate(({}, [w, h]) => { const win = globalThis.__ct.student.win; win.setFullScreen(false); win.setContentSize(w, h); }, sz);
    await sleep(500);
    const b2 = (await check(sw)).filter((r) => !r.ok);
    assert(b2.length === 0, `${sz.join('x')}에서 잘린 칸: ` + JSON.stringify(b2));
  }
  await app.evaluate(() => { globalThis.__ct.student.currentDisplayId = null; globalThis.__ct.student.show(true); });
  await sleep(500);
  if (dow >= 1 && dow <= 5) await sw.locator('[data-sw-card=today]').screenshot({ path: path.join(shots, '23-student-today-long.png') });
  const ww = await widgetWin();
  if (ww) {
    const b3 = (await check(ww)).filter((r) => !r.ok);
    assert(b3.length === 0, '교사용 위젯에서 잘린 칸: ' + JSON.stringify(b3));
  }
  await dispatch(app, { type: 'student/base', base: 'board' });
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

// ---------------- 학급임원선거 ----------------
const voteWin = async (app) => {
  for (const w of app.windows()) if ((await w.title()) === '투표') return w;
  return null;
};
async function modalOk(page, pin) {
  await page.waitForSelector('[data-testid=el-modal]');
  if (await page.$('[data-testid=el-modal-check]')) await page.check('[data-testid=el-modal-check]');
  if (pin !== undefined) await page.fill('[data-testid=el-modal-pin]', pin);
  await page.click('[data-testid=el-modal-ok]');
  await sleep(300);
}
async function votePin(vw, pin = '2468') {
  if (!(await vw.$('[data-testid=vote-pinpad]'))) await vw.click('[data-testid=vote-teacher]');
  for (const k of pin) await vw.click(`[data-key="${k}"]`);
  await vw.click('[data-key="확인"]');
  await vw.waitForSelector('[data-testid=vote-admin]');
}
const elState = (app) =>
  app.evaluate(() => {
    const c = globalThis.__ct.ctl;
    const e = c.data.elections.find((x) => x.phase !== 'setup' || x.candidates.length) ?? c.data.elections[0];
    return e ? { id: e.id, phase: e.phase, ballots: e.ballots, abstain: e.abstain, tally: { ...e.tally }, open: !!e.openBallot, cands: e.candidates.map((x) => ({ id: x.id, n: x.number, name: x.name })) } : null;
  });

await check('선거 설정: PIN(해시 저장), 후보 등록, 잘못된 설정 차단, PIN 틀리면 시작 안 됨 → 투표 시작', async () => {
  await setDisplays(app, true);
  await teacher.click('[data-tab=election]');
  await teacher.fill('[data-testid=pin-new]', '2468');
  await teacher.fill('[data-testid=pin-new2]', '2468');
  await teacher.click('[data-testid=pin-save]');
  await sleep(300);
  const pinStored = await app.evaluate(() => JSON.stringify(globalThis.__ct.ctl.data.electionPin));
  assert(pinStored && !pinStored.includes('2468'), 'PIN 저장 형태 ' + pinStored);
  await teacher.click('[data-testid=election-create]');
  await teacher.waitForSelector('[data-testid=election-detail]');
  await teacher.fill('[data-testid=el-title]', '2학기 학급임원선거');
  await teacher.fill('[data-testid=el-voters]', '4');
  await teacher.press('[data-testid=el-voters]', 'Enter');
  for (let i = 0; i < 3; i++) {
    await teacher.selectOption('[data-testid=el-pick]', { index: 1 });
    await teacher.click('[data-testid=el-add]');
    await sleep(150);
  }
  let st = await elState(app);
  assert(st.cands.length === 3 && st.cands.map((x) => x.n).join() === '1,2,3', '후보 ' + JSON.stringify(st.cands));
  // 같은 학생을 다시 후보로 (화면 목록에서는 빠지지만 요청을 직접 보내도 거부)
  const dup = await app.evaluate((_e, id) => {
    const c = globalThis.__ct.ctl;
    const e = c.data.elections.find((x) => x.id === id);
    return c.dispatch({ type: 'election/addCandidate', id, studentId: e.candidates[0].studentId });
  }, st.id);
  assert(!dup.ok, '중복 후보 등록됨');
  // 1인당 선택 수 2 > 선출 1 → 시작 버튼 막힘
  await teacher.fill('[data-testid=el-max]', '2');
  await teacher.press('[data-testid=el-max]', 'Enter');
  await teacher.waitForSelector('[data-testid=el-problems]');
  assert(await teacher.isDisabled('[data-testid=el-start]'), '잘못된 설정인데 시작 가능');
  await teacher.fill('[data-testid=el-max]', '1');
  await teacher.press('[data-testid=el-max]', 'Enter');
  await sleep(200);
  await teacher.click('[data-testid=el-start]');
  await modalOk(teacher, '1111');
  assert((await elState(app)).phase === 'setup', '틀린 PIN으로 시작됨');
  await teacher.click('[data-testid=el-start]');
  await modalOk(teacher, '2468');
  st = await elState(app);
  assert(st.phase === 'voting', '시작 안 됨 ' + st.phase);
  await teacher.screenshot({ path: path.join(shots, '27-teacher-election-voting.png') });
});

await check('투표 화면: 교사 모니터에만 열림 · TV엔 안내만 · 더블클릭·재전송 1회 집계 · 다음 학생에 이전 선택 없음 · 득표가 상태 전달에 없음', async () => {
  await teacher.click('[data-testid=el-show-tv]');
  await teacher.click('[data-testid=el-kiosk]');
  await modalOk(teacher);
  const vw = await until(() => voteWin(app), 8000, '투표 창 없음');
  await vw.waitForSelector('[data-testid=vote-wait]');
  const info = await app.evaluate(() => {
    const v = globalThis.__ct.vote.win;
    const t = globalThis.__ct.teacherWin;
    return { bounds: v.getBounds(), top: v.isAlwaysOnTop(), teacherVisible: t.isVisible() };
  });
  assert(info.bounds.x < 1920 && info.top && !info.teacherVisible, '투표 창 위치·상태 ' + JSON.stringify(info));
  const st0 = await elState(app);
  const c = Object.fromEntries(st0.cands.map((x) => [x.n, x.id]));

  // 1번째 학생: 2번 선택 → 확인 → 최종 제출 더블클릭
  await votePin(vw);
  await vw.click('[data-testid=vote-open-next]');
  await vw.waitForSelector('[data-testid=vote-ballot]');
  const token = (await vw.evaluate(() => window.voteApi.getView())).ballot.token;
  await vw.click('[data-cand="2"]');
  assert(await vw.$('.vote-cand.on[data-cand="2"]'), '선택 표시 없음');
  await vw.screenshot({ path: path.join(shots, '28-vote-ballot.png') });
  await vw.click('[data-testid=vote-next]');
  await vw.waitForSelector('[data-testid=vote-confirm]');
  await vw.dblclick('[data-testid=vote-submit]');
  await vw.waitForSelector('[data-testid=vote-done]');
  // 같은 기회로 다른 후보를 다시 보내도(재전송) 다시 세지 않음
  const re = await vw.evaluate((t) => window.voteApi.submit({ token: t, choices: [], abstain: true }), token);
  assert(re.ok, '재전송 응답 ' + JSON.stringify(re));
  let st = await elState(app);
  assert(st.ballots === 1 && st.abstain === 0 && st.tally[c[2]] === 1 && Object.keys(st.tally).length === 1, '1회 집계 아님 ' + JSON.stringify(st));

  // 투표 중 교사 화면 상태(IPC)에는 득표·토큰이 없음
  const fsTeacher = await teacher.evaluate(() => window.api.getState());
  const te = fsTeacher.data.elections.find((x) => x.id === st.id);
  assert(JSON.stringify(te.tally) === '{}' && te.receipts.length === 0 && !JSON.stringify(fsTeacher).includes(token), '교사 상태에 득표·토큰 포함');
  // TV: 안내·후보·진행 인원만
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=st-election]');
  const tvText = await sw.textContent('[data-testid=st-election]');
  assert(tvText.includes('투표한 학생 1 / 4명') && !/\d+표/.test(tvText) && !tvText.includes('당선'), 'TV 내용 ' + tvText);
  const tvView = await sw.evaluate(() => window.studentApi.getView());
  assert(!/tally|votes/.test(JSON.stringify(tvView)), 'TV 상태에 득표 포함');
  await sw.screenshot({ path: path.join(shots, '29-tv-election-info.png') });

  // 2번째 학생: 이전 선택 흔적 없음 → 기권
  await vw.waitForSelector('[data-testid=vote-wait]', { timeout: 6000 });
  await votePin(vw);
  await vw.click('[data-testid=vote-open-next]');
  await vw.waitForSelector('[data-testid=vote-ballot]');
  assert((await vw.$$('.vote-cand.on')).length === 0, '이전 학생 선택이 남아 있음');
  await vw.click('[data-testid=vote-abstain]');
  await vw.waitForSelector('[data-testid=vote-confirm]');
  await vw.click('[data-testid=vote-submit]');
  await vw.waitForSelector('[data-testid=vote-done]');
  // 3번째 학생: 1번
  await vw.waitForSelector('[data-testid=vote-wait]', { timeout: 6000 });
  await votePin(vw);
  await vw.click('[data-testid=vote-open-next]');
  await vw.waitForSelector('[data-testid=vote-ballot]');
  await vw.click('[data-cand="1"]');
  await vw.click('[data-testid=vote-next]');
  await vw.click('[data-testid=vote-submit]');
  await vw.waitForSelector('[data-testid=vote-done]');
  st = await elState(app);
  assert(st.ballots === 3 && st.abstain === 1 && st.tally[c[1]] === 1 && st.tally[c[2]] === 1, '집계 ' + JSON.stringify(st));
});

await check('투표 화면 보호: 새로고침·닫기 단축키 무시, PIN 없이는 교사 동작 불가, 모니터 연결이 바뀌면 잠그고 열린 기회 취소', async () => {
  const vw = await voteWin(app);
  await vw.waitForSelector('[data-testid=vote-wait]', { timeout: 6000 });
  await vw.evaluate(() => (window.__marker = 1));
  for (const k of [{ keyCode: 'F5' }, { keyCode: 'R', modifiers: ['control'] }, { keyCode: 'W', modifiers: ['control'] }, { keyCode: 'F4', modifiers: ['alt'] }]) {
    await app.evaluate((_e, k) => {
      const wc = globalThis.__ct.vote.win.webContents;
      wc.sendInputEvent({ type: 'keyDown', ...k });
      wc.sendInputEvent({ type: 'keyUp', ...k });
    }, k);
  }
  await sleep(600);
  assert((await vw.evaluate(() => window.__marker)) === 1, '투표 화면이 새로고침됨');
  assert(await app.evaluate(() => !!globalThis.__ct.vote.win && !globalThis.__ct.vote.win.isDestroyed()), '투표 창이 닫힘');
  const noAdmin = await vw.evaluate(() => window.voteApi.admin('next'));
  assert(!noAdmin.ok, 'PIN 없이 다음 투표가 열림');
  // 학생이 선택하던 중 TV 연결이 끊김 → 잠금, 기회 취소
  await votePin(vw);
  await vw.click('[data-testid=vote-open-next]');
  await vw.waitForSelector('[data-testid=vote-ballot]');
  await vw.click('[data-cand="3"]');
  await setDisplays(app, false);
  await vw.waitForSelector('text=잠시 멈춤');
  assert((await vw.$$('.vote-cand')).length === 0, '잠금 화면에 후보 선택이 남음');
  let st = await elState(app);
  assert(!st.open && st.ballots === 3, '열린 기회가 취소되지 않음 ' + JSON.stringify(st));
  await setDisplays(app, true);
  await votePin(vw);
  await vw.click('[data-testid=vote-resume]');
  await vw.click('text=메뉴 닫기');
  await vw.waitForSelector('[data-testid=vote-wait]');
  // 교사 메뉴 → 투표 화면 닫기 → 교사용 창 복귀
  await votePin(vw);
  await vw.click('[data-testid=vote-exit]');
  await until(() => app.evaluate(() => !globalThis.__ct.vote.active && globalThis.__ct.teacherWin.isVisible()), 5000, '교사 창 복귀 안 됨');
});

await check('마감(남은 인원 확인) → 결과 확인 → 동점이면 재투표 필요 → TV 공개 → 동점 후보로 재투표 생성', async () => {
  await teacher.click('[data-testid=el-close]');
  await teacher.waitForSelector('[data-testid=el-modal]');
  const msg = await teacher.textContent('[data-testid=el-modal]');
  assert(msg.includes('아직 1명이 투표하지 않았습니다'), '마감 확인 메시지 ' + msg);
  await modalOk(teacher, '2468');
  await teacher.waitForSelector('[data-testid=el-result]');
  const status = await teacher.getAttribute('[data-testid=el-status]', 'data-status');
  assert(status === 'tie', '동점 판정 ' + status);
  const summary = await teacher.textContent('[data-testid=el-summary]');
  assert(summary.includes('투표한 학생 3명') && summary.includes('기권 1명'), summary);
  await teacher.screenshot({ path: path.join(shots, '30-teacher-election-result.png') });
  // 추가 제출 차단
  const late = await app.evaluate(() => globalThis.__ct.ctl.elections.submit('whatever', [], true));
  assert(!late.ok, '마감 후 제출 접수됨');
  await teacher.click('[data-testid=el-publish]');
  const sw = await studentWin(app);
  await sw.waitForSelector('[data-testid=st-election][data-phase=published]');
  const tv = await sw.textContent('[data-testid=st-election]');
  assert(tv.includes('1표') && tv.includes('동점·재투표') && tv.includes('재투표로 1명') && (await sw.$$('.st-elect-badge.won')).length === 0, 'TV 결과 ' + tv);
  await sw.screenshot({ path: path.join(shots, '31-tv-election-result.png') });
  await teacher.click('[data-testid=el-runoff]');
  await sleep(300);
  const ro = await app.evaluate(() => {
    const c = globalThis.__ct.ctl;
    const r = c.data.elections.find((x) => x.runoff);
    return r ? { seats: r.seats, n: r.candidates.map((x) => x.number).join(), phase: r.phase } : null;
  });
  assert(ro && ro.seats === 1 && ro.n === '1,2' && ro.phase === 'setup', '재투표 ' + JSON.stringify(ro));
  await dispatch(app, { type: 'student/base', base: 'blank' });
});

// 재시작 후 복원
const before = await app.evaluate(() => {
  const c = globalThis.__ct.ctl;
  return { n: c.cls.students.length, board: c.data.boardPublished.text, sched: c.data.schedules.length, fixed: c.cls.seating.fixed.length, confirmed: !!c.cls.seating.confirmed, elections: c.data.elections.map((e) => `${e.phase}:${e.ballots}:${e.abstain}:${JSON.stringify(e.tally)}`).join('|'), pin: !!c.data.electionPin };
});
await app.evaluate(({ app }) => {
  globalThis.__ct.store.flush();
});
await app.close();

await check('앱 재시작 후 데이터 복원', async () => {
  ({ app, teacher } = await launch());
  const after = await app.evaluate(() => {
    const c = globalThis.__ct.ctl;
    return { n: c.cls.students.length, board: c.data.boardPublished.text, sched: c.data.schedules.length, fixed: c.cls.seating.fixed.length, confirmed: !!c.cls.seating.confirmed, elections: c.data.elections.map((e) => `${e.phase}:${e.ballots}:${e.abstain}:${JSON.stringify(e.tally)}`).join('|'), pin: !!c.data.electionPin };
  });
  assert(before.elections.includes('published:3:1'), '재시작 전 선거 상태 ' + before.elections);
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
updServer.close();
console.log(`\n결과: ${passed}개 통과, ${failures.length}개 실패`);
if (failures.length) {
  console.log('실패:', failures.join(', '));
  process.exit(1);
}
