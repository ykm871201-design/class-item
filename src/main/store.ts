// 사용자 데이터 경로(%APPDATA%\교실 도구)에 JSON으로 저장 — 원자적 쓰기 + 백업
import fs from 'node:fs';
import path from 'node:path';
import type { AppData } from '../shared/types';
import { defaultData, normalizeData } from '../shared/defaults';

export class Store {
  readonly file: string;
  readonly backup: string;
  private timer: NodeJS.Timeout | null = null;
  private pending: AppData | null = null;
  loadWarning: string | null = null;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'classroom-data.json');
    this.backup = path.join(dir, 'classroom-data.backup.json');
  }

  load(): AppData {
    for (const f of [this.file, this.backup]) {
      try {
        if (!fs.existsSync(f)) continue;
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (f === this.backup) this.loadWarning = '저장 파일을 읽을 수 없어 백업 파일에서 복원했습니다.';
        return normalizeData(raw);
      } catch (e) {
        this.loadWarning = '저장 파일이 손상되어 백업에서 복원을 시도했습니다.';
        try {
          fs.copyFileSync(f, f + '.broken-' + Date.now());
        } catch {
          /* ignore */
        }
      }
    }
    if (this.loadWarning && !fs.existsSync(this.backup)) this.loadWarning = '저장 파일이 손상되어 새로 시작합니다. (손상된 파일은 같은 폴더에 보관했습니다)';
    return defaultData();
  }

  /** 변경 후 짧게 모아서 저장 */
  save(data: AppData): void {
    this.pending = data;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const json = JSON.stringify(this.pending, null, 1);
    this.pending = null;
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, json, 'utf8');
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.backup);
        } catch {
          /* ignore */
        }
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('save failed', e);
    }
  }
}
