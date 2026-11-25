// 업데이트: GitHub Releases의 최신 설치 파일을 내려받아 조용히 설치한 뒤 앱을 다시 실행한다.
// 인터넷이 없거나 실패해도 앱 사용에는 영향이 없다.
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Controller } from './controller';
import { compareVersions } from '../shared/version';

export const UPDATE_REPO = 'ykm871201-design/class-item';
const API_URL = process.env.CT_UPDATE_API || `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

interface Asset {
  name: string;
  size: number;
  url: string;
  digest?: string;
}

export class Updater {
  private asset: Asset | null = null;
  private busy = false;
  downloadedPath: string | null = null;

  constructor(
    private ctl: Controller,
    private log: (msg: string) => void,
    private quitForInstall: () => void,
  ) {}

  private set(patch: Partial<Controller['rt']['update']>, broadcast = true): void {
    this.ctl.rt.update = { ...this.ctl.rt.update, ...patch };
    if (broadcast) this.ctl.changed(false);
  }

  /** 최신 버전 확인. silent면 실패해도 오류를 표시하지 않음 */
  async check(silent = false): Promise<void> {
    if (this.busy) return;
    const st = this.ctl.rt.update.status;
    if (st === 'downloading' || st === 'installing') return;
    this.set({ status: 'checking', error: undefined });
    try {
      const res = await net.fetch(API_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ClassroomTools-Updater' } });
      if (!res.ok) throw new Error(res.status === 404 ? '배포된 버전을 찾을 수 없습니다.' : `서버 응답 오류 (${res.status})`);
      const rel = (await res.json()) as any;
      const latest = String(rel.tag_name ?? '').replace(/^v/, '');
      const a = (rel.assets ?? []).find((x: any) => /\.exe$/i.test(x.name) && /setup/i.test(x.name));
      this.asset = a ? { name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest } : null;
      const newer = compareVersions(latest, app.getVersion()) > 0;
      this.set({
        status: newer && this.asset ? 'available' : 'latest',
        latest,
        publishedAt: rel.published_at,
        notes: String(rel.body ?? '').slice(0, 1500),
        checkedAt: Date.now(),
      });
      this.log(`업데이트 확인: 현재 ${app.getVersion()}, 최신 ${latest}${newer ? ' (새 버전 있음)' : ''}`);
    } catch (e: any) {
      const msg = e?.message?.includes('net::') ? '인터넷에 연결할 수 없습니다.' : e?.message ?? String(e);
      this.log(`업데이트 확인 실패: ${msg}`);
      this.set(silent ? { status: 'idle', checkedAt: Date.now() } : { status: 'error', error: `업데이트를 확인하지 못했습니다: ${msg}`, checkedAt: Date.now() });
    }
  }

  /** 새 버전 설치 파일을 내려받아 검증한 뒤 설치 (설치하면 앱이 잠시 종료되었다가 다시 실행됨) */
  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.busy) return { ok: false, error: '이미 진행 중입니다.' };
    if (this.ctl.rt.update.status !== 'available' || !this.asset) return { ok: false, error: '설치할 새 버전이 없습니다. 먼저 업데이트를 확인해 주세요.' };
    if (process.platform !== 'win32' && !process.env.CT_UPDATE_NO_INSTALL) return { ok: false, error: 'Windows에서만 자동 업데이트할 수 있습니다.' };
    this.busy = true;
    const asset = this.asset;
    try {
      const dir = path.join(app.getPath('temp'), 'ClassroomTools-Update');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, asset.name);
      this.set({ status: 'downloading', progress: 0, error: undefined });
      this.log(`업데이트 다운로드 시작: ${asset.name}`);
      const res = await net.fetch(asset.url, { headers: { 'User-Agent': 'ClassroomTools-Updater' } });
      if (!res.ok || !res.body) throw new Error(`다운로드 실패 (${res.status})`);
      const total = Number(res.headers.get('content-length')) || asset.size;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(file);
      const reader = res.body.getReader();
      let got = 0;
      let lastSent = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        hash.update(value);
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (now - lastSent > 250) {
          lastSent = now;
          this.set({ progress: total ? got / total : 0 });
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (asset.size && got !== asset.size) throw new Error(`파일 크기가 맞지 않습니다 (${got}/${asset.size}).`);
      const sha = hash.digest('hex');
      if (asset.digest && asset.digest.startsWith('sha256:') && asset.digest.slice(7) !== sha) throw new Error('내려받은 파일이 손상되었습니다 (검증 실패).');
      this.downloadedPath = file;
      this.set({ status: 'installing', progress: 1 });
      this.log(`업데이트 파일 검증 완료 (sha256 ${sha.slice(0, 12)}…), 설치 시작`);
      if (process.env.CT_UPDATE_NO_INSTALL) return { ok: true }; // 테스트용: 실제 설치는 하지 않음
      // NSIS 조용한 설치(/S) 후 앱 다시 실행(--force-run). 설치 중 기존 앱은 종료된다.
      const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => this.quitForInstall(), 1500);
      return { ok: true };
    } catch (e: any) {
      const msg = e?.message?.includes('net::') ? '인터넷 연결이 끊겼습니다.' : e?.message ?? String(e);
      this.log(`업데이트 실패: ${msg}`);
      this.set({ status: 'available', error: `업데이트하지 못했습니다: ${msg}`, progress: undefined });
      return { ok: false, error: msg };
    } finally {
      this.busy = false;
    }
  }
}
