import { describe, it, expect, vi } from 'vitest';
import { securityVerdict } from '../src/core/security';
import { DrainScheduler, type DrainOutcome } from '../src/core/drainScheduler';
import { SessionService, type SecretStore } from '../src/core/session';
import { OfflineQueue } from '../src/core/offlineQueue';
import { MemoryQueueStore } from '../src/core/memoryQueueStore';

const base = { rooted: false, hooked: false, debugged: false, requirePinning: false, pinsConfigured: true, dev: false };
describe('tamper verdict', () => {
  it.each([['rooted', 'ROOTED'], ['hooked', 'HOOKED'], ['debugged', 'DEBUGGED']] as const)('release builds refuse %s devices', (k, reason) => expect(securityVerdict({ ...base, [k]: true })).toEqual({ ok: false, reason }));
  it('dev builds tolerate them so engineers can work', () => expect(securityVerdict({ ...base, rooted: true, hooked: true, debugged: true, dev: true }).ok).toBe(true));
  it('a clean device passes; missing pins fail closed only when required', () => { expect(securityVerdict(base).ok).toBe(true); expect(securityVerdict({ ...base, requirePinning: true, pinsConfigured: false })).toEqual({ ok: false, reason: 'PINNING_NOT_CONFIGURED' }); expect(securityVerdict({ ...base, pinsConfigured: false }).ok).toBe(true); });
  it('root outranks the missing-pin reason', () => expect(securityVerdict({ ...base, rooted: true, requirePinning: true, pinsConfigured: false })).toEqual({ ok: false, reason: 'ROOTED' }));
});

describe('DrainScheduler', () => {
  function setup(results: DrainOutcome[]) {
    const timers: { fn: () => void; ms: number; id: number }[] = []; let id = 0; const drain = vi.fn(async () => ({ stoppedBecause: results.shift() ?? 'EMPTY' }));
    const s = new DrainScheduler({ drain, setTimer: (fn, ms) => { const t = { fn, ms, id: ++id }; timers.push(t); return t.id; }, clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); }, random: () => 0.5, baseMs: 1000, maxMs: 8000 });
    return { s, drain, timers };
  }
  it('backs off exponentially (1s, 2s, 4s, 8s, 8s...) with a reset on success', async () => {
    const { s, drain, timers } = setup(['BACKOFF', 'BACKOFF', 'BACKOFF', 'BACKOFF', 'BACKOFF', 'EMPTY']);
    const delays: number[] = []; await s.kick();
    for (let i = 0; i < 5; i++) { delays.push(timers[0]!.ms); const t = timers.shift()!; t.fn(); await Promise.resolve(); await Promise.resolve(); }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]); expect(drain).toHaveBeenCalledTimes(6); expect(s.retries).toBe(0);
  });
  it('jitter stays within +/-25%', () => { const lo = new DrainScheduler({ drain: async () => ({ stoppedBecause: 'EMPTY' }), random: () => 0, baseMs: 1000 }); const hi = new DrainScheduler({ drain: async () => ({ stoppedBecause: 'EMPTY' }), random: () => 1, baseMs: 1000 }); expect(lo.delayFor(0)).toBe(750); expect(hi.delayFor(0)).toBe(1250); });
  it('OFFLINE also retries; AUTH and BUSY do not', async () => {
    const a = setup(['OFFLINE']); await a.s.kick(); expect(a.s.scheduled).toBe(true);
    const b = setup(['AUTH']); await b.s.kick(); expect(b.s.scheduled).toBe(false);
    const c = setup(['BUSY']); await c.s.kick(); expect(c.s.scheduled).toBe(false);
  });
  it('a manual kick cancels the pending timer instead of stacking another', async () => { const { s, timers } = setup(['BACKOFF', 'BACKOFF']); await s.kick(); expect(timers).toHaveLength(1); await s.kick(); expect(timers).toHaveLength(1); });
  it('stop() cancels everything and later kicks do nothing', async () => { const { s, drain, timers } = setup(['BACKOFF']); await s.kick(); s.stop(); expect(timers).toHaveLength(0); await s.kick(); expect(drain).toHaveBeenCalledTimes(1); });
  it('end to end with the real queue: a 503 then a 201 delivers exactly once', async () => {
    const store = new MemoryQueueStore(); const seq = [503, 201]; const sent: number[] = [];
    const q = new OfflineQueue({ store, authCeilingOk: async () => true, sleep: async () => {}, send: async () => { const status = seq.shift()!; sent.push(status); return { status, body: {} }; } });
    await q.enqueue('POST', '/a', {}); const timers: (() => void)[] = []; const s = new DrainScheduler({ drain: () => q.drain(), setTimer: (fn) => (timers.push(fn), 1), random: () => 0.5 });
    await s.kick(); expect(timers).toHaveLength(1); timers[0]!(); await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual([503, 201]); expect(await store.list(['PENDING'])).toHaveLength(0);
  });
  it('records the server response on DONE writes (used to surface refuel anomalies)', async () => {
    const store = new MemoryQueueStore(); const q = new OfflineQueue({ store, authCeilingOk: async () => true, send: async () => ({ status: 201, body: { fuel_purchase_id: 'p', open_anomalies: ['GAUGE_DELTA_HIGH'] } }) });
    const id = await q.enqueue('POST', '/fuel/refuel', {}); await q.drain(); expect((await q.getItem(id))?.response).toEqual({ fuel_purchase_id: 'p', open_anomalies: ['GAUGE_DELTA_HIGH'] });
  });
});

describe('session hardening', () => {
  const mem = (): SecretStore & { dump: () => Record<string, string> } => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k), dump: () => Object.fromEntries(m) }; };
  it('a device clock moved backwards is treated as expired, not as extra offline time', async () => {
    let t = 10_000_000; const s = new SessionService({ secrets: mem(), sha256: async (x) => x, now: () => t }); await s.saveTokens({ access_token: 'a', refresh_token: 'r' });
    t -= 3_600_000; expect(await s.checkAuthCeiling()).toEqual({ ok: false, reason: 'OFFLINE_AUTH_EXPIRED' });
  });
  it('the stored PIN hash is salted: the same PIN on two installs hashes differently, and the plain PIN is never stored', async () => {
    const [a, b] = [mem(), mem()]; let n = 0; const mk = (sec: SecretStore) => new SessionService({ secrets: sec, sha256: async (x) => `H(${x})`, randomSalt: () => `salt${++n}` });
    await mk(a).setPin('1234'); await mk(b).setPin('1234');
    expect(a.dump().pin_hash).not.toBe(b.dump().pin_hash); expect(JSON.stringify(a.dump())).not.toContain('"1234"');
    expect(a.dump().pin_hash).toBe('H(salt1:1234)');
  });
  it('verifyPin still works with the salt, and a wipe removes the salt too', async () => {
    let t = 1; const sec = mem(); const s = new SessionService({ secrets: sec, sha256: async (x) => x, now: () => t, randomSalt: () => 'S' }); await s.setPin('1234'); expect((await s.verifyPin('1234')).ok).toBe(true);
    for (let i = 0; i < 10; i++) { await s.verifyPin('0000'); t += 16 * 60_000; } expect(sec.dump().pin_salt).toBeUndefined(); expect(sec.dump().pin_hash).toBeUndefined();
  });
});
