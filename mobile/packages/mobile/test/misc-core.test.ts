import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../src/core/apiClient';
import { uploadMedia } from '../src/core/media';
import { decodeJwt } from '../src/core/jwt';
import { MemoryQueueStore } from '../src/core/memoryQueueStore';
import { AppError, ClientProblemError, parseProblem, NetworkError, SERVER_ERROR_CODES, CLIENT_ERROR_CODES } from '@fleet/shared';
import { ERROR_CATALOG, classifyResponse, describeError } from '../src/core/errors';
import { queryKeysForPath, substituteTokens, substitutePath, OfflineQueue } from '../src/core/offlineQueue';
import { ttl, QUERY_TTL, PERSIST_MAX_AGE } from '../src/core/queryConfig';
import { SessionService, type SecretStore } from '../src/core/session';
import { parseDeepLink, targetFromNotification } from '../src/core/deepLinks';
import { z } from 'zod';

const jres = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const mem = (): SecretStore => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) }; };

describe('errors', () => {
  it('parseProblem tolerates anything', () => { for (const b of [null, undefined, 'x', 5, [], {}]) expect(parseProblem(500, b).error_code).toBe('UNKNOWN'); });
  it('parseProblem keeps RFC7807 fields', () => { const e = parseProblem(422, { error_code: 'VALIDATION_ERROR', title: 'T', detail: 'D', instance: 'req-1', field_errors: [{ field: 'f', code: 'c', message: 'm' }] }); expect(e).toMatchObject({ status: 422, title: 'T', detail: 'D', instance: 'req-1' }); expect(e.field_errors).toHaveLength(1); });
  it('AppError message prefers detail, then title', () => { expect(new ClientProblemError(400, 'X', 'Title', 'Detail').message).toBe('Detail'); expect(new ClientProblemError(400, 'X', 'Title').message).toBe('Title'); });
  it('NetworkError carries its cause', () => { const c = new Error('dns'); expect((new NetworkError(c)).cause).toBe(c); });
  it('unknown codes get a safe retry fallback', () => expect(describeError('???')).toEqual({ key: 'errors.UNKNOWN', action: 'RETRY' }));
  it('every catalog entry points at its own key', () => { for (const [c, v] of Object.entries(ERROR_CATALOG)) expect(v.key).toBe(`errors.${c}`); });
  it('the catalogue is the backend catalogue plus the three local-only codes, and nothing else', () => {
    // Every code the server can send has copy and exactly one action...
    for (const c of SERVER_ERROR_CODES) expect(ERROR_CATALOG[c], `server code ${c} has no copy`).toBeTruthy();
    // ...and nothing in the catalogue is a code the server cannot send.
    for (const c of Object.keys(ERROR_CATALOG)) expect([...SERVER_ERROR_CODES, ...CLIENT_ERROR_CODES]).toContain(c);
  });
  it('codes that were invented in the earlier draft are gone', () => {
    for (const c of ['DEVICE_UNKNOWN', 'GAUGE_DELTA_HIGH', 'FUEL_PRICE_SPIKE', 'BLOCKER_DEFECT']) {
      expect(SERVER_ERROR_CODES).not.toContain(c);
      expect(ERROR_CATALOG[c]).toBeUndefined();
    }
  });
  it.each([[200, undefined, 'DONE'], [204, undefined, 'DONE'], [401, undefined, 'REFRESH_AUTH'], [408, undefined, 'RETRY_LATER'], [429, 'RATE_LIMITED', 'RETRY_LATER'], [500, undefined, 'RETRY_LATER'], [502, undefined, 'RETRY_LATER'],
    [400, 'VALIDATION_ERROR', 'FAILED_REVIEW'], [403, 'FORBIDDEN', 'FAILED_REVIEW'], [404, undefined, 'FAILED_REVIEW'], [409, 'SHIFT_ALREADY_OPEN', 'FAILED_REVIEW'], [409, 'IDEMPOTENCY_INFLIGHT', 'INFLIGHT_RETRY'], [422, 'IDEMPOTENCY_CONFLICT', 'DISCARD']] as const)
    ('classifyResponse(%s,%s) = %s', (s, c, o) => expect(classifyResponse(s, c)).toBe(o));
});

describe('apiClient extras', () => {
  const mk = (f: any, over: any = {}) => new ApiClient({ baseUrl: 'http://x', getAccessToken: async () => 'tok', refreshAccessToken: async () => null, fetchImpl: f, uuid: () => 'U', ...over });
  it('encodes query values and skips undefined/null', () => expect(mk(null).buildUrl('/a', { q: 'a b&c', n: 1, x: undefined, y: null, ok: true })).toBe('http://x/a?q=a%20b%26c&n=1&ok=true'));
  it('auth:false sends no Authorization header', async () => { const f = vi.fn(async () => jres(200, {})); await mk(f).post('/login', { auth: false, body: {} }); expect((f.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined(); });
  it('PUT carries an idempotency key; GET does not set Content-Type without a body', async () => {
    const f = vi.fn(async () => jres(204)); const c = mk(f); await c.put('/p', { body: { a: 1 } }); await c.get('/g');
    expect((f.mock.calls[0] as any)[1].headers['Idempotency-Key']).toBe('U'); expect((f.mock.calls[1] as any)[1].headers['Content-Type']).toBeUndefined();
  });
  it('a caller-supplied idempotency key wins', async () => { const f = vi.fn(async () => jres(200, {})); await mk(f).post('/a', { body: {}, idempotencyKey: 'mine' }); expect((f.mock.calls[0] as any)[1].headers['Idempotency-Key']).toBe('mine'); });
  it('non-JSON error bodies still become an AppError', async () => { const e: any = await mk(async () => new Response('<html>', { status: 502 })).get('/a').catch((x) => x); expect(e).toBeInstanceOf(AppError); expect(e.status).toBe(502); });
  it('validates the response with the supplied zod schema', async () => { const c = mk(async () => jres(200, { n: 1 })); expect(await c.get('/a', { schema: z.object({ n: z.number() }) })).toEqual({ n: 1 }); });
  it('does not refresh when auth is false', async () => { const r = vi.fn(async () => 'x'); await mk(async () => jres(401, { error_code: 'UNAUTHENTICATED' }), { refreshAccessToken: r }).post('/login', { auth: false, body: {} }).catch(() => null); expect(r).not.toHaveBeenCalled(); });
  /**
   * E-06: `GET /media/{id}` answers 302 to a short-lived presigned GET, so the reader follows the
   * redirect once WITH the bearer token and hands the object-storage URL on. The token must never be
   * part of the URL the image loader gets.
   */
  describe('media read follows the 302 (E-06)', () => {
    const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://s3.example/obj?sig=abc' } });
    it('returns the Location header and sends Authorization on the request', async () => {
      const f = vi.fn(async () => redirect());
      expect(await mk(f).resolveMediaUrl('/media/abc')).toBe('https://s3.example/obj?sig=abc');
      expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer tok');
      expect((f.mock.calls[0] as any)[1].redirect).toBe('manual');
    });
    it('refreshes once on a 401 and retries', async () => {
      let token = 'stale'; const r = vi.fn(async () => (token = 'fresh')); let n = 0;
      const f = vi.fn(async () => (n++ === 0 ? jres(401, { error_code: 'UNAUTHENTICATED' }) : redirect()));
      const c = new ApiClient({ baseUrl: 'http://x', getAccessToken: async () => token, refreshAccessToken: r, fetchImpl: f as any });
      expect(await c.resolveMediaUrl('/media/abc')).toBe('https://s3.example/obj?sig=abc');
      expect(r).toHaveBeenCalledTimes(1);
      expect((f.mock.calls[1] as any)[1].headers.Authorization).toBe('Bearer fresh');
    });
    it('a 302 with no Location is an error, not a silent blank image', async () => {
      await expect(mk(async () => new Response(null, { status: 302 })).resolveMediaUrl('/media/abc')).rejects.toThrow('MEDIA_REDIRECT_MISSING');
    });
    it('a non-2xx becomes the server error, and a dead network becomes a NetworkError (so it queues)', async () => {
      await expect(mk(async () => jres(502, { error_code: 'SERVICE_UNAVAILABLE' })).resolveMediaUrl('/media/a')).rejects.toMatchObject({ error_code: 'SERVICE_UNAVAILABLE' });
      await expect(mk(async () => { throw new Error('dns'); }).resolveMediaUrl('/media/a')).rejects.toBeInstanceOf(NetworkError);
    });
  });
});

describe('media upload', () => {
  const api = (body: any) => ({ post: async () => body }) as unknown as ApiClient;
  const presign = { media_object_id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', upload_url: 'https://s3.example/x', expires_in_seconds: 60, method: 'PUT' as const };
  it('PUTs raw bytes with the declared content type and returns the id', async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 })); const id = await uploadMedia(api(presign), new Blob(['x']), { owner_kind: 'WORK_LOG', retention_class: 'WORK_PLAN', content_type: 'image/jpeg' }, f as any);
    expect(id).toBe(presign.media_object_id); expect((f.mock.calls[0] as any)[1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });
  });
  it('a failed PUT throws so the caller can re-presign', async () => { await expect(uploadMedia(api(presign), new Blob(['x']), { owner_kind: 'WORK_LOG', retention_class: 'WORK_PLAN', content_type: 'image/jpeg' }, (async () => new Response(null, { status: 403 })) as any)).rejects.toThrow('S3_UPLOAD_FAILED_403'); });
});

describe('jwt', () => {
  const tok = (c: object) => `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.s`;
  it('reads sub/email/name/exp', () => expect(decodeJwt(tok({ sub: 'u', email: 'a@b.c', name: 'N', exp: 9 }))).toMatchObject({ sub: 'u', email: 'a@b.c', name: 'N', exp: 9 }));
  it('handles unicode names', () => expect(decodeJwt(tok({ name: 'Wanjiru Mūthoni' }))?.name).toBe('Wanjiru Mūthoni'));
  it.each(['', 'a', 'a.b', 'a.!!!.c', 'a..c'])('rejects malformed token %j', (t) => expect(decodeJwt(t)).toBeNull());
  it('rejects a payload that is not an object', () => expect(decodeJwt(tok('str' as any))).toBeNull());
});

describe('queue helpers', () => {
  it.each([['/shifts/clock-in', [['shift-active']]], ['/shifts/clock-out', [['shift-active']]], ['/driver/fuel/purchase', [['fuel-history'], ['admin-fuel-pending']]], ['/fuel/refuel', [['fuel-history'], ['admin-fuel-pending']]], ['/inspections', [['dvir-queue'], ['dvir-list']]], ['/accidents/mayday', [['accidents']]], ['/trailer/swap', [['shift-active'], ['vehicle-states']]], ['/media/upload-url', []]])
    ('queryKeysForPath(%s)', (p, k) => expect(queryKeysForPath(p as string)).toEqual(k));
  it('substituteTokens walks nested arrays/objects and leaves other values alone', () => {
    expect(substituteTokens({ a: 'T1', b: ['T2', 'x', 3, null], c: { d: 'T1' } }, { T1: 'one', T2: 'two' })).toEqual({ a: 'one', b: ['two', 'x', 3, null], c: { d: 'one' } });
  });
  it('substitutePath replaces every occurrence', () => expect(substitutePath('/a/T/b/T', { T: 'id' })).toBe('/a/id/b/id'));
  it('memory store: list filters/orders, update/remove/clear behave', async () => {
    const s = new MemoryQueueStore(); const mk = (status: any) => s.insert({ idempotency_key: 'k', method: 'POST', path: '/', body: {}, status, attempts: 0, uploads: [], produces: null, needs: [], response: null, error_code: null, error_message: null, created_at: 0, updated_at: 0 });
    const a = await mk('PENDING'); const b = await mk('DONE'); const c = await mk('PENDING');
    expect((await s.list(['PENDING'])).map((r) => r.id)).toEqual([a, c]); await s.update(b, { status: 'PENDING' }); expect(await s.list(['PENDING'])).toHaveLength(3);
    await s.remove(a); expect(await s.get(a)).toBeNull(); await s.setRef('t', 'v'); expect(await s.getRefs()).toEqual({ t: 'v' }); await s.clear(); expect(await s.list(['PENDING'])).toHaveLength(0); expect(await s.getRefs()).toEqual({});
  });
});

describe('OfflineQueue extras', () => {
  const T = 'aaaaaaaa-0000-4000-8000-000000000009';
  const mkq = (send: any, upload?: any, extra: any = {}) => { const store = new MemoryQueueStore(); const q = new OfflineQueue({ store, send, uploadStaged: upload, authCeilingOk: async () => true, sleep: async () => {}, ...extra }); return { store, q }; };
  const up = { token: T, uri: 'file:///x', content_type: 'image/jpeg', owner_kind: 'WORK_LOG', retention_class: 'WORK_PLAN' } as const;
  it('an upload that the server rejects (4xx) fails review with the server code', async () => { const { q, store } = mkq(async () => ({ status: 201, body: {} }), async () => ({ status: 422, body: { error_code: 'VALIDATION_ERROR' } })); await q.enqueue('POST', '/a', { m: T }, 'k', { uploads: [up] }); expect((await q.drain()).failedReview).toBe(1); expect((await store.list(['FAILED_REVIEW']))[0]?.error_code).toBe('VALIDATION_ERROR'); });
  it('an upload 5xx pauses the queue (retry later)', async () => { const { q } = mkq(async () => ({ status: 201, body: {} }), async () => ({ status: 503 })); await q.enqueue('POST', '/a', { m: T }, 'k', { uploads: [up] }); expect((await q.drain()).stoppedBecause).toBe('BACKOFF'); });
  it('staged uploads without an uploader fail review instead of sending a placeholder', async () => { const { q, store } = mkq(async () => ({ status: 201, body: {} })); await q.enqueue('POST', '/a', { m: T }, 'k', { uploads: [up] }); await q.drain(); expect((await store.list(['FAILED_REVIEW']))[0]?.error_code).toBe('UPLOAD_UNAVAILABLE'); });
  it('a 2xx upload without an id is treated as a failure', async () => { const { q } = mkq(async () => ({ status: 201, body: {} }), async () => ({ status: 201 })); await q.enqueue('POST', '/a', { m: T }, 'k', { uploads: [up] }); expect((await q.drain()).failedReview).toBe(1); });
  it('gives up after repeated IDEMPOTENCY_INFLIGHT and leaves the item pending', async () => { let n = 0; const { q, store } = mkq(async () => (n++, { status: 409, body: { error_code: 'IDEMPOTENCY_INFLIGHT' } })); await q.enqueue('POST', '/a', {}); expect((await q.drain()).stoppedBecause).toBe('BACKOFF'); expect(n).toBe(6); expect(await store.list(['PENDING'])).toHaveLength(1); });
  it('onDiscarded/onDone callbacks fire; onAuthExpired fires on 401', async () => {
    const done = vi.fn(); const disc = vi.fn(); const expired = vi.fn(); const seq = [{ status: 201, body: {} }, { status: 422, body: { error_code: 'IDEMPOTENCY_CONFLICT' } }, { status: 401, body: {} }];
    const { q } = mkq(async () => seq.shift(), undefined, { onDone: done, onDiscarded: disc, onAuthExpired: expired }); for (let i = 0; i < 3; i++) await q.enqueue('POST', `/p${i}`, {}); await q.drain();
    expect(done).toHaveBeenCalledTimes(1); expect(disc).toHaveBeenCalledTimes(1); expect(expired).toHaveBeenCalledTimes(1);
  });
  it('a second drain while one runs reports BUSY', async () => { let release!: () => void; const gate = new Promise<void>((r) => (release = r)); const { q } = mkq(async () => { await gate; return { status: 201, body: {} }; }); await q.enqueue('POST', '/a', {}); const first = q.drain(); await Promise.resolve(); expect((await q.drain()).stoppedBecause).toBe('BUSY'); release(); await first; });
  it('outbox lists pending + failed, discard removes, clearAll empties', async () => {
    const { q, store } = mkq(async () => ({ status: 422, body: { error_code: 'VALIDATION_ERROR' } })); const a = await q.enqueue('POST', '/a', {}); await q.enqueue('POST', '/b', {}); await q.drain();
    expect((await q.outbox()).map((r) => r.status)).toEqual(['FAILED_REVIEW', 'FAILED_REVIEW']); await q.discard(a); expect(await q.outbox()).toHaveLength(1); await q.clearAll(); expect(await store.list(['FAILED_REVIEW'])).toHaveLength(0);
  });
  it('a fresh key is generated when none is given', async () => { const { q, store } = mkq(async () => ({ status: 201, body: {} }), undefined, { uuid: () => 'gen-1' }); const id = await q.enqueue('POST', '/a', {}); expect((await store.get(id))?.idempotency_key).toBe('gen-1'); });
});

describe('session extras', () => {
  const mk = () => { let t = 1_000_000; return { s: new SessionService({ secrets: mem(), sha256: async (x) => `h${x}`, now: () => t }), adv: (ms: number) => (t += ms) }; };
  it('consent version is stored with a timestamp', async () => { const { s } = mk(); expect(await s.getConsent()).toBeNull(); await s.setConsent('2026-01-01'); expect(await s.getConsent()).toMatchObject({ version: '2026-01-01' }); });
  it('biometric flag toggles and signOut clears it', async () => { const { s } = mk(); expect(await s.biometricEnabled()).toBe(false); await s.setBiometricEnabled(true); expect(await s.biometricEnabled()).toBe(true); await s.signOut(); expect(await s.biometricEnabled()).toBe(false); });
  it.each(['123', '12345', 'abcd', '', '12 4'])('setPin rejects %j', async (p) => { await expect(mk().s.setPin(p)).rejects.toMatchObject({ error_code: 'VALIDATION_ERROR' }); });
  it('hasPin reflects setPin; roles round-trip', async () => { const { s } = mk(); expect(await s.hasPin()).toBe(false); await s.setPin('1234'); expect(await s.hasPin()).toBe(true); await s.saveTokens({ access_token: 'a', refresh_token: 'r', roles: ['ADMIN', 'DRIVER'] }); expect(await s.roles()).toEqual(['ADMIN', 'DRIVER']); });
  it('verifyPin without a PIN says NO_PIN; the attempts-left count counts down', async () => {
    const { s } = mk(); expect(await s.verifyPin('1111')).toMatchObject({ reason: 'NO_PIN' }); await s.setPin('1234');
    expect(await s.verifyPin('0000')).toMatchObject({ reason: 'WRONG', attemptsLeftBeforeLock: 4 }); expect(await s.verifyPin('0000')).toMatchObject({ attemptsLeftBeforeLock: 3 });
  });
  it('a correct PIN resets the failure counter', async () => { const { s } = mk(); await s.setPin('1234'); await s.verifyPin('0'); await s.verifyPin('0'); expect((await s.verifyPin('1234')).ok).toBe(true); expect(await s.verifyPin('0')).toMatchObject({ attemptsLeftBeforeLock: 4 }); });
  it('setPin clears an earlier lock', async () => { const { s } = mk(); await s.setPin('1234'); for (let i = 0; i < 5; i++) await s.verifyPin('0'); await s.setPin('4321'); expect((await s.verifyPin('4321')).ok).toBe(true); });
});

describe('deep links extras', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it.each([['helix://outbox', 'DRIVER', true], ['helix://outbox', 'ADMIN', false], [`helix://vehicle/${id}`, 'ADMIN', true], [`helix://vehicle/${id}`, 'DRIVER', false], [`helix://fuel/${id}`, 'ADMIN', true], [`helix://fuel/${id}`, 'DRIVER', false], ['helix://', 'ADMIN', false], ['FLEET://notifications', 'ADMIN', false], [' helix://notifications', 'ADMIN', false]] as const)
    ('%s as %s -> %s', (u, r, ok) => expect(!!parseDeepLink(u, r)).toBe(ok));
  it('overlong URLs and non-strings are dropped', () => { expect(parseDeepLink('helix://notifications/' + 'a'.repeat(300), 'ADMIN')).toBeNull(); expect(parseDeepLink(5 as any, 'ADMIN')).toBeNull(); });
  it('push payload variants', () => { expect(targetFromNotification({ entity: 'notifications' }, 'ADMIN')?.screen).toBe('Notifications'); expect(targetFromNotification({ entity: 5, id }, 'ADMIN')).toBeNull(); expect(targetFromNotification(null, 'ADMIN')).toBeNull(); expect(targetFromNotification({ entity: 'dvir', id }, 'DRIVER')).toBeNull(); });
});

describe('query TTL table', () => {
  it('matches the documented per-domain values', () => { expect(QUERY_TTL['vehicle-states']).toEqual({ staleTime: 10_000, gcTime: 3_600_000 }); expect(QUERY_TTL.drivers?.staleTime).toBe(300_000); expect(ttl('notifications').gcTime).toBe(300_000); });
  it('unknown domains get a safe default; persisted cache lives at most 7 days', () => { expect(ttl('whatever')).toEqual({ staleTime: 30_000, gcTime: 300_000 }); expect(PERSIST_MAX_AGE).toBe(7 * 24 * 3_600_000); });
});
