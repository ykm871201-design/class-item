// 외부 검토(GPT 등)에 올릴 소스 묶음 만들기: review-bundle/
// 파일마다 경로 머리글과 줄 번호를 붙여, 검토자가 '파일:줄'로 짚을 수 있게 한다.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const out = 'review-bundle';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const pick = (re) => tracked.filter((f) => re.test(f) && !/\.(png|jpg|ico)$/.test(f)).sort();
const groups = [
  { file: '01-shared-core.md', title: '공용 로직 (src/shared) — 순수 함수, 자동 테스트 대상', files: pick(/^src\/shared\//) },
  { file: '02-main-process.md', title: '메인 프로세스·프리로드·빌드 설정', files: [...pick(/^src\/(main|preload)\//), ...pick(/^(package\.json|tsconfig\.json|vitest\.config\.mts|\.github\/workflows\/.*|scripts\/(build|dist-win-linux)\.(mjs|cjs))$/)] },
  { file: '03-renderer.md', title: '화면 (src/renderer) — 교사용·위젯·학생 화면', files: pick(/^src\/renderer\//) },
  { file: '04-tests.md', title: '테스트 (Vitest 단위 테스트, Playwright E2E)', files: [...pick(/^tests\//), ...pick(/^tests-e2e\/run\.mjs$/)] },
];
const lang = (f) => ({ '.ts': 'ts', '.tsx': 'tsx', '.mjs': 'js', '.cjs': 'js', '.css': 'css', '.html': 'html', '.json': 'json', '.yml': 'yaml', '.mts': 'ts' })[path.extname(f)] ?? '';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const header = `> 교실 도구 v${version} (커밋 ${commit}) · 저장소 https://github.com/ykm871201-design/class-item\n> 각 줄 앞의 숫자는 원본 파일의 줄 번호입니다. ‘파일:줄’로 짚어 주세요.\n`;

const parts = [];
// 00: 안내서 + 파일 목록
let guide = fs.readFileSync('docs/REVIEW_GUIDE.md', 'utf8');
guide += '\n\n---\n\n## 부록: 묶음 파일 구성\n\n';
for (const g of groups) {
  guide += `### ${g.file} — ${g.title}\n`;
  for (const f of g.files) guide += `- \`${f}\` (${fs.readFileSync(f, 'utf8').split('\n').length}줄)\n`;
  guide += '\n';
}
fs.writeFileSync(path.join(out, '00-guide.md'), header + '\n' + guide);
parts.push(header + '\n' + guide);

for (const g of groups) {
  let md = `${header}\n# ${g.title}\n\n`;
  for (const f of g.files) {
    const lines = fs.readFileSync(f, 'utf8').replace(/\n$/, '').split('\n');
    const w = String(lines.length).length;
    md += `## \`${f}\`\n\n\`\`\`${lang(f)}\n${lines.map((l, i) => `${String(i + 1).padStart(w, ' ')}| ${l}`).join('\n')}\n\`\`\`\n\n`;
  }
  fs.writeFileSync(path.join(out, g.file), md);
  parts.push(md);
}
fs.writeFileSync(path.join(out, 'classroom-tools-review-all.md'), parts.join('\n\n---\n\n'));
fs.copyFileSync('docs/GPT_REVIEW_PROMPT.md', path.join(out, 'GPT_REVIEW_PROMPT.md'));
for (const f of fs.readdirSync(out)) console.log(`${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0).padStart(5)} KB  ${f}`);
