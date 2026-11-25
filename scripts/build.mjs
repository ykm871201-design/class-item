// esbuild로 메인·프리로드·화면 코드를 dist/에 번들
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/renderer', { recursive: true });
for (const f of ['teacher.html', 'student.html', 'styles.css']) fs.copyFileSync(path.join('src/renderer', f), path.join('dist/renderer', f));

const common = { bundle: true, sourcemap: !prod, minify: prod, logLevel: 'info', target: 'chrome120' };
const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron'], target: 'node20' },
  { ...common, entryPoints: ['src/preload/teacher.ts'], outfile: 'dist/preload-teacher.js', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/preload/student.ts'], outfile: 'dist/preload-student.js', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/renderer/teacher/index.tsx'], outfile: 'dist/renderer/teacher.js', platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' } },
  { ...common, entryPoints: ['src/renderer/student/index.tsx'], outfile: 'dist/renderer/student.js', platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' } },
];
if (watch) {
  for (const c of configs) (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
