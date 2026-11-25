// 사용자 데이터 경로(%APPDATA%\ClassroomTools)에 JSON으로 저장 — 원자적 쓰기 + 백업
// - 읽을 때: JSON 문법뿐 아니라 구조(버전·학급)가 맞는지 확인하고, 깨졌으면 보관한 뒤 백업에서 복원
// - 쓸 때: 정상으로 확인된 본 파일만 백업으로 올린다 (깨진 파일이 정상 백업을 덮어쓰지 않게)
// - 쓰기에 실패하면 내용을 잃지 않고 다시 시도하며, 상태를 알린다
import fs from 'node:fs';
import path from 'node:path';
import type { AppData } from '../shared/types';
import { defaultData, isUsableData, normalizeData } from '../shared/defaults';

export interface StoreStatus {
  ok: boolean;
  error?: string;
  lastSavedAt?: number;
}

export class Store {
  readonly file: string;
  readonly backup: string;
  private timer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = 2000;
  private pending: AppData | null = null;
  /** 지금 본 파일이 정상으로 확인되었는지 (아니면 저장할 때 백업으로 올리지 않음) */
  private mainGood = false;
  loadWarning: string | null = null;
  status: StoreStatus = { ok: true };
  onStatus: ((s: StoreStatus) => void) | null = null;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'classroom-data.json');
    this.backup = path.join(dir, 'classroom-data.backup.json');
  }

  private quarantine(f: string): void {
    try {
      fs.copyFileSync(f, f + '.broken-' + Date.now());
    } catch {
      /* ignore */
    }
  }

  /** 파일을 읽어 구조가 맞으면 원본 데이터를, 아니면 null */
  private read(f: string): unknown | null {
    if (!fs.existsSync(f)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (isUsableData(raw)) return raw;
    } catch {
      /* 아래에서 깨진 파일로 처리 */
    }
    this.quarantine(f);
    return undefined;
  }

  load(): AppData {
    const mainExists = fs.existsSync(this.file);
    const main = this.read(this.file);
    if (main) {
      this.mainGood = true;
      return normalizeData(main);
    }
    const backup = this.read(this.backup);
    this.mainGood = false;
    if (backup) {
      this.loadWarning = mainExists ? '저장 파일이 손상되어 백업 파일에서 복원했습니다. (손상된 파일은 같은 폴더에 보관했습니다)' : '저장 파일이 없어 백업 파일에서 복원했습니다.';
      return normalizeData(backup);
    }
    if (mainExists || fs.existsSync(this.backup)) this.loadWarning = '저장 파일과 백업이 모두 손상되어 새로 시작합니다. (손상된 파일은 같은 폴더에 보관했습니다)';
    return defaultData();
  }

  /** 변경 후 짧게 모아서 저장 */
  save(data: AppData): void {
    this.pending = data;
    if (this.timer || this.retryTimer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }

  /** 지금 바로 저장. 성공하면 true */
  flush(): boolean {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.pending) return this.status.ok;
    const snapshot = this.pending;
    const json = JSON.stringify(snapshot, null, 1);
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, json, 'utf8');
      if (this.mainGood && fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.backup);
        } catch {
          /* 백업 실패는 저장을 막지 않음 */
        }
      }
      fs.renameSync(tmp, this.file);
      this.mainGood = true;
      if (this.pending === snapshot) this.pending = null; // 성공한 내용만 비움
      this.retryDelay = 2000;
      this.setStatus({ ok: true, lastSavedAt: Date.now() });
      return true;
    } catch (e: any) {
      const reason = e?.code === 'ENOSPC' ? '디스크 공간이 부족합니다' : e?.code === 'EACCES' || e?.code === 'EPERM' || e?.code === 'EBUSY' ? '파일이 잠겨 있거나 권한이 없습니다' : String(e?.message ?? e);
      this.setStatus({ ok: false, error: `데이터를 저장하지 못했습니다 (${reason}). 잠시 뒤 다시 시도합니다.`, lastSavedAt: this.status.lastSavedAt });
      // 내용(pending)은 그대로 두고 다시 시도
      this.retryTimer = setTimeout(() => this.flush(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      return false;
    }
  }

  private setStatus(s: StoreStatus): void {
    const changed = s.ok !== this.status.ok || s.error !== this.status.error;
    this.status = s;
    if (changed) this.onStatus?.(s);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }
}
