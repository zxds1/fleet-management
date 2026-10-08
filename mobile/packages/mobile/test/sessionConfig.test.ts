import { describe, it, expect } from 'vitest';
import { ConfigClient } from '@fleet/shared';
import { SessionService, type SecretStore } from '../src/core/session';

describe('SessionService reads thresholds from ConfigClient (the real system_config keys)', () => {
  const mem = (): SecretStore => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) }; };
  it('a server-set 12h window expires sooner than the 24h default', async () => {
    let t = 1_000_000; const config = new ConfigClient(); const s = new SessionService({ secrets: mem(), sha256: async (x) => x, now: () => t, config });
    await s.saveTokens({ access_token: 'a', refresh_token: 'r' }); t += 13 * 3_600_000;
    expect((await s.checkAuthCeiling()).ok).toBe(true);
    config.update({ 'auth.device_offline_max_hours': 12 }); expect((await s.checkAuthCeiling()).ok).toBe(false);
  });
  it('the PIN lock duration follows config', async () => {
    let t = 5_000_000; const config = new ConfigClient(); config.update({ 'auth.offline_pin_lockout_minutes': 30 }); const s = new SessionService({ secrets: mem(), sha256: async (x) => x, now: () => t, config });
    await s.setPin('1234'); let r; for (let i = 0; i < 5; i++) r = await s.verifyPin('0000');
    expect(r).toMatchObject({ reason: 'LOCKED', lockedUntil: t + 30 * 60_000 });
  });
});
