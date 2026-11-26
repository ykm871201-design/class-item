// 선거 관리 PIN: 평문은 저장하지 않고 솔트+scrypt 해시만 저장한다.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_RULE = /^\d{4,8}$/;

export function hashPin(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(pin, salt, 32).toString('hex') };
}

export function verifyPin(pin: unknown, stored: { salt: string; hash: string } | null): boolean {
  if (!stored || typeof pin !== 'string' || !PIN_RULE.test(pin)) return false;
  try {
    const a = scryptSync(pin, stored.salt, 32);
    const b = Buffer.from(stored.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 틀린 PIN을 여러 번 넣으면 잠시 막는다 (학생이 숫자를 차례로 눌러 보는 것 방지) */
export class PinGuard {
  private fails = 0;
  private lockedUntil = 0;
  constructor(private readonly now: () => number, private readonly maxFails = 5, private readonly lockMs = 60_000) {}

  check(pin: unknown, stored: { salt: string; hash: string } | null): { ok: true } | { ok: false; error: string } {
    const now = this.now();
    if (!stored) return { ok: false, error: '먼저 선거 관리 PIN을 정해 주세요.' };
    if (now < this.lockedUntil) return { ok: false, error: `PIN을 여러 번 틀려 ${Math.ceil((this.lockedUntil - now) / 1000)}초 동안 입력할 수 없습니다.` };
    if (verifyPin(pin, stored)) {
      this.fails = 0;
      return { ok: true };
    }
    this.fails += 1;
    if (this.fails >= this.maxFails) {
      this.fails = 0;
      this.lockedUntil = now + this.lockMs;
      return { ok: false, error: `PIN이 맞지 않습니다. ${Math.round(this.lockMs / 1000)}초 동안 입력할 수 없습니다.` };
    }
    return { ok: false, error: `PIN이 맞지 않습니다. (${this.maxFails - this.fails}번 더 틀리면 잠시 잠깁니다)` };
  }
}
