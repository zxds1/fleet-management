import { describe, it, expect } from 'vitest';
import { SessionService, type SecretStore } from '../src/core/session';
import { InspectionSchema, InspectionSubmitStrictSchema } from '@fleet/shared';

const mem = (): SecretStore => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) }; };
const make = () => { let t = 1_000_000; const s = new SessionService({ secrets: mem(), sha256: async (x) => 'h' + x, now: () => t }); return { s, adv: (ms: number) => (t += ms) }; };
const H = 3_600_000;

describe('SessionService', () => {
  it('24h auth ceiling', async () => {
    const { s, adv } = make();
    expect((await s.checkAuthCeiling()).ok).toBe(false);   // never authed
    await s.saveTokens({ access_token: 'a', refresh_token: 'r' });
    expect((await s.checkAuthCeiling()).ok).toBe(true);
    adv(23 * H); expect((await s.checkAuthCeiling()).ok).toBe(true);
    adv(2 * H); expect(await s.checkAuthCeiling()).toEqual({ ok: false, reason: 'OFFLINE_AUTH_EXPIRED' });
  });
  it('PIN: 5 fails lock 15 min, unlock after, 10 fails wipe and force online login', async () => {
    const { s, adv } = make();
    await s.saveTokens({ access_token: 'a', refresh_token: 'r' }); await s.setPin('1234');
    for (let i = 0; i < 4; i++) expect((await s.verifyPin('0000')).ok).toBe(false);
    expect(await s.verifyPin('0000')).toMatchObject({ reason: 'LOCKED' });
    expect(await s.verifyPin('1234')).toMatchObject({ reason: 'LOCKED' });   // even the right PIN is refused while locked
    adv(16 * 60_000); expect((await s.verifyPin('1234')).ok).toBe(true);
    await s.setPin('1234');
    for (let i = 0; i < 4; i++) await s.verifyPin('0000');
    await s.verifyPin('0000'); adv(16 * 60_000);
    for (let i = 0; i < 4; i++) await s.verifyPin('0000');
    expect(await s.verifyPin('0000')).toEqual({ ok: false, reason: 'WIPED' });
    expect((await s.checkAuthCeiling()).ok).toBe(false);
    expect(await s.verifyPin('1234')).toMatchObject({ reason: 'NO_PIN' });
  });
  it('signOut clears everything; access token is never persisted', async () => {
    const { s } = make(); await s.saveTokens({ access_token: 'a', refresh_token: 'r', roles: ['DRIVER'] });
    expect(await s.getAccessToken()).toBe('a'); await s.signOut();
    expect(await s.getAccessToken()).toBeNull(); expect(await s.getRefreshToken()).toBeNull();
  });
});
describe('schemas', () => {
  it('DVIR: the wire schema accepts a bare FAIL, and the strict mirror rejects it (the server service rule)', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const body = { shift_id: id, template_id: id, subject: 'VEHICLE', vehicle_id: id, trailer_id: null, previous_defects_reviewed: true, signature_name: 'A', items: [{ template_item_id: id, result: 'FAIL' }] };
    // InspectionSubmitSchema mirrors the backend's zod schema exactly: no refine.
    expect(InspectionSchema.safeParse(body).success).toBe(true);
    // InspectionSubmitStrictSchema adds the rule enforced in services/inspections.ts, so the driver
    // finds out before the round trip: a FAIL needs a note AND a photo.
    expect(InspectionSubmitStrictSchema.safeParse(body).success).toBe(false);
  });
});
