import { newId } from './uuid';
import { ValidationError } from '@fleet/shared';
import type { ConfigClient, RoleCode } from '@fleet/shared';

/** Port over expo-secure-store (Rule 6: secrets live only here). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}
export interface SessionDeps {
  secrets: SecretStore;
  sha256: (s: string) => Promise<string>;
  /** Per-install random value mixed into the PIN hash so a stolen hash cannot be matched against a table of all 10,000 PINs. */
  randomSalt?: () => string;
  now?: () => number;
  config?: ConfigClient;          // server-driven thresholds; the numbers below are only fallbacks
  authWindowHours?: number;
  lockAfter?: number; wipeAfter?: number; lockMinutes?: number;
}
const K = { access: 'access_token', refresh: 'refresh_token', lastAuth: 'last_auth_at', offlineUntil: 'offline_until', pinHash: 'pin_hash', pinSalt: 'pin_salt', pinFails: 'pin_fails', pinLockedUntil: 'pin_locked_until', roles: 'roles', biometric: 'biometric_on', consentV: 'consent_version', consentAt: 'consent_at' };

export type PinResult =
  | { ok: true }
  | { ok: false; reason: 'WRONG'; attemptsLeftBeforeLock: number }
  | { ok: false; reason: 'LOCKED'; lockedUntil: number }
  | { ok: false; reason: 'WIPED' }
  | { ok: false; reason: 'NO_PIN' };

export class SessionService {
  private accessInMemory: string | null = null;  // access token never touches disk
  constructor(private readonly d: SessionDeps) {}
  private now() { return (this.d.now ?? Date.now)(); }
  // B-02 (needs confirmation): PIN rules come from `auth.offline_pin_lockout_attempts` (5),
  // `auth.offline_pin_wipe_attempts` (10) and `auth.offline_pin_lockout_minutes` (15).
  private get lockAfter() { return this.d.config?.numeric('auth.offline_pin_lockout_attempts') ?? this.d.lockAfter ?? 5; }
  private get wipeAfter() { return this.d.config?.numeric('auth.offline_pin_wipe_attempts') ?? this.d.wipeAfter ?? 10; }
  private get lockMs() { return (this.d.config?.numeric('auth.offline_pin_lockout_minutes') ?? this.d.lockMinutes ?? 15) * 60_000; }

  /**
   * C-14/B-03 resolved: refresh tokens ARE rotated on every refresh (`SessionService.refresh`), and
   * every successful online exchange restarts the offline window. `POST /auth/devices/refresh` also
   * hands back the server's own `offline_until` (from `auth.device_offline_max_hours`), which is
   * authoritative when present; the local counter below is the stricter fallback for the case where
   * the device was never registered.
   */
  async saveTokens(t: { access_token: string; refresh_token: string; roles?: readonly RoleCode[]; offline_until?: string }) {
    this.accessInMemory = t.access_token;
    await this.d.secrets.set(K.refresh, t.refresh_token);
    await this.d.secrets.set(K.lastAuth, String(this.now()));   // the ceiling restarts only after a successful online auth
    if (t.offline_until) await this.d.secrets.set(K.offlineUntil, t.offline_until);
    if (t.roles) await this.d.secrets.set(K.roles, JSON.stringify(t.roles));
  }
  getAccessToken() { return Promise.resolve(this.accessInMemory); }
  getRefreshToken() { return this.d.secrets.get(K.refresh); }
  async roles(): Promise<string[]> { const r = await this.d.secrets.get(K.roles); return r ? (JSON.parse(r) as string[]) : []; }

  /**
   * Offline work is allowed inside the server's `auth.device_offline_max_hours` (24 h) window, and
   * for at most 24 h after the last successful online auth. A clock moved backwards counts as expired.
   */
  async checkAuthCeiling(): Promise<{ ok: boolean; reason?: 'OFFLINE_AUTH_EXPIRED' }> {
    const last = Number((await this.d.secrets.get(K.lastAuth)) ?? 0);
    if (!last) return { ok: false, reason: 'OFFLINE_AUTH_EXPIRED' };
    const hours = (this.now() - last) / 3_600_000;
    if (hours < 0) return { ok: false, reason: 'OFFLINE_AUTH_EXPIRED' };   // clock went backwards: tampering, not extra time
    const serverUntil = await this.d.secrets.get(K.offlineUntil);
    const serverMs = serverUntil ? new Date(serverUntil).getTime() : NaN;
    const limitMs = Number.isFinite(serverMs)
      ? Math.min(serverMs, last + (this.d.config?.numeric('auth.device_offline_max_hours') ?? this.d.authWindowHours ?? 24) * 3_600_000)
      : last + (this.d.config?.numeric('auth.device_offline_max_hours') ?? this.d.authWindowHours ?? 24) * 3_600_000;
    return this.now() > limitMs ? { ok: false, reason: 'OFFLINE_AUTH_EXPIRED' } : { ok: true };
  }

  async setConsent(version: string) { await this.d.secrets.set(K.consentV, version); await this.d.secrets.set(K.consentAt, new Date(this.now()).toISOString()); }
  async getConsent(): Promise<{ version: string; at: string } | null> {
    const [v, a] = [await this.d.secrets.get(K.consentV), await this.d.secrets.get(K.consentAt)]; return v && a ? { version: v, at: a } : null;
  }
  async hasPin() { return !!(await this.d.secrets.get(K.pinHash)); }
  async biometricEnabled() { return (await this.d.secrets.get(K.biometric)) === '1'; }
  /** Rule 5: biometric only unlocks the local session. It is never sent to the server. */
  setBiometricEnabled(on: boolean) { return on ? this.d.secrets.set(K.biometric, '1') : this.d.secrets.del(K.biometric); }

  async setPin(pin: string) {
    if (!/^\d{4}$/.test(pin)) throw new ValidationError('PIN must be 4 digits', [{ field: 'pin', code: 'PATTERN', message: 'PIN must be 4 digits' }]);
    const salt = (this.d.randomSalt ?? newId)(); await this.d.secrets.set(K.pinSalt, salt);
    await this.d.secrets.set(K.pinHash, await this.d.sha256(`${salt}:${pin}`));
    await this.d.secrets.del(K.pinFails); await this.d.secrets.del(K.pinLockedUntil);
  }

  /** 5 wrong PINs lock for 15 min; 10 wipe the PIN and force online login. */
  async verifyPin(pin: string): Promise<PinResult> {
    const stored = await this.d.secrets.get(K.pinHash);
    if (!stored) return { ok: false, reason: 'NO_PIN' };
    const lockedUntil = Number((await this.d.secrets.get(K.pinLockedUntil)) ?? 0);
    if (lockedUntil > this.now()) return { ok: false, reason: 'LOCKED', lockedUntil };
    const salt = (await this.d.secrets.get(K.pinSalt)) ?? '';
    if ((await this.d.sha256(`${salt}:${pin}`)) === stored) {
      await this.d.secrets.del(K.pinFails); await this.d.secrets.del(K.pinLockedUntil);
      return { ok: true };
    }
    const fails = Number((await this.d.secrets.get(K.pinFails)) ?? 0) + 1;
    await this.d.secrets.set(K.pinFails, String(fails));
    if (fails >= this.wipeAfter) {
      await this.d.secrets.del(K.pinHash); await this.d.secrets.del(K.pinSalt); await this.d.secrets.del(K.pinFails); await this.d.secrets.del(K.pinLockedUntil);
      await this.d.secrets.del(K.lastAuth);   // forces online login
      return { ok: false, reason: 'WIPED' };
    }
    if (fails % this.lockAfter === 0) {
      const until = this.now() + this.lockMs;
      await this.d.secrets.set(K.pinLockedUntil, String(until));
      return { ok: false, reason: 'LOCKED', lockedUntil: until };
    }
    return { ok: false, reason: 'WRONG', attemptsLeftBeforeLock: this.lockAfter - (fails % this.lockAfter) };
  }

  async signOut() {
    this.accessInMemory = null;
    for (const k of Object.values(K)) await this.d.secrets.del(k);
  }
}
