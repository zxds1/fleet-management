import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiClient } from '../src/core/apiClient';
import { OfflineQueue } from '../src/core/offlineQueue';
import { MemoryQueueStore } from '../src/core/memoryQueueStore';
import { uploadMedia } from '../src/core/media';
import { AppError } from '@fleet/shared';

/**
 * A small in-process API that implements the backend's documented semantics: Idempotency-Key replay (same body -> cached,
 * different body -> 422 IDEMPOTENCY_CONFLICT), odometer rule, token refresh, presigned PUT. The real app code talks to it over real HTTP.
 */
type Cached = { status: number; body: string; reqBody: string };
function makeServer() {
  const cache = new Map<string, Cached>(); const log: string[] = []; let lastOdo = 1000; let accessValid = 'tok1'; let refreshes = 0; const uploaded: string[] = [];
  const srv = http.createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const raw = Buffer.concat(chunks).toString(); const url = req.url ?? ''; const send = (s: number, b?: unknown) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(b === undefined ? undefined : JSON.stringify(b)); };
      log.push(`${req.method} ${url}`);
      if (req.method === 'PUT' && url.startsWith('/s3/')) { uploaded.push(url); res.writeHead(200); res.end(); return; }
      if (url === '/api/v1/auth/refresh') { refreshes++; accessValid = 'tok2'; return send(200, { access_token: 'tok2', refresh_token: 'r2', roles: ['DRIVER'] }); }
      if ((req.headers.authorization ?? '') !== `Bearer ${accessValid}`) return send(401, { error_code: 'UNAUTHENTICATED', title: 'no' });
      if (url === '/api/v1/media/upload-url') return send(201, { media_object_id: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', upload_url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/s3/obj`, expires_in_seconds: 60, method: 'PUT' });
      const key = String(req.headers['idempotency-key'] ?? ''); const prior = cache.get(key);
      if (prior) return prior.reqBody === raw ? send(prior.status, JSON.parse(prior.body)) : send(422, { error_code: 'IDEMPOTENCY_CONFLICT' });
      let out: [number, unknown];
      if (url === '/api/v1/shifts/clock-in') { const b = JSON.parse(raw); out = b.start_odometer_km < lastOdo ? [422, { error_code: 'ODOMETER_DECREASED', detail: 'low' }] : (lastOdo = b.start_odometer_km, [201, { shift_id: 's1' }]); }
      else if (url === '/api/v1/fuel/refuel') out = [201, { fuel_purchase_id: 'p1', open_anomalies: [] }];
      else out = [404, { error_code: 'NOT_FOUND' }];
      cache.set(key, { status: out[0], body: JSON.stringify(out[1]), reqBody: raw }); send(out[0], out[1]);
    });
  });
  return { srv, log, uploaded, get refreshes() { return refreshes; }, setValid(t: string) { accessValid = t; } };
}
let S: ReturnType<typeof makeServer>; let base = '';
beforeAll(async () => { S = makeServer(); await new Promise<void>((r) => S.srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(S.srv.address() as AddressInfo).port}/api/v1`; });
afterAll(() => S.srv.close());

const clientWith = (token: () => string) => { let t = token(); return new ApiClient({ baseUrl: base, getAccessToken: async () => t, refreshAccessToken: async () => { const r = await fetch(`${base}/auth/refresh`, { method: 'POST' }); t = (await r.json()).access_token; return t; } }); };

describe('integration (real HTTP against a semantics-faithful mock)', () => {
  it('replaying the same Idempotency-Key with the same body returns the cached result once', async () => {
    S.setValid('tok1'); const api = clientWith(() => 'tok1'); const body = { start_odometer_km: 1500 };
    const a = await api.post<{ shift_id: string }>('/shifts/clock-in', { body, idempotencyKey: 'K1' });
    const b = await api.post<{ shift_id: string }>('/shifts/clock-in', { body, idempotencyKey: 'K1' });
    expect(a).toEqual(b);
    await expect(api.post('/shifts/clock-in', { body: { start_odometer_km: 1600 }, idempotencyKey: 'K1' })).rejects.toMatchObject({ error_code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('401 triggers exactly one refresh and the call succeeds with the new token', async () => {
    S.setValid('tok2'); const before = S.refreshes; const api = clientWith(() => 'stale');
    await expect(api.post('/fuel/refuel', { body: {} })).resolves.toMatchObject({ fuel_purchase_id: 'p1' });
    expect(S.refreshes - before).toBe(1);
  });
  it('odometer decrease surfaces as FAILED_REVIEW in the queue; fixing it via edit() (new key) then succeeds', async () => {
    S.setValid('tok2'); const store = new MemoryQueueStore();
    const send = async (w: any) => { const r = await fetch(base + w.path, { method: w.method, headers: { Authorization: 'Bearer tok2', 'Content-Type': 'application/json', 'Idempotency-Key': w.idempotency_key }, body: JSON.stringify(w.body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const q = new OfflineQueue({ store, send, authCeilingOk: async () => true, sleep: async () => {} });
    const id = await q.enqueue('POST', '/shifts/clock-in', { start_odometer_km: 10 });
    expect((await q.drain()).failedReview).toBe(1);
    expect((await store.get(id))?.error_code).toBe('ODOMETER_DECREASED');
    await q.edit(id, { start_odometer_km: 5000 });
    expect((await q.drain()).done).toBe(1);
  });
  it('a crash after the server accepted but before the app recorded DONE is harmless: replay returns the cached 201', async () => {
    S.setValid('tok2'); const store = new MemoryQueueStore(); let calls = 0;
    const send = async (w: any) => { calls++; const r = await fetch(base + w.path, { method: w.method, headers: { Authorization: 'Bearer tok2', 'Content-Type': 'application/json', 'Idempotency-Key': w.idempotency_key }, body: JSON.stringify(w.body) }); return { status: r.status, body: await r.json() }; };
    const q = new OfflineQueue({ store, send, authCeilingOk: async () => true, sleep: async () => {} });
    const id = await q.enqueue('POST', '/fuel/refuel', { litres: 5 }, 'CRASH-KEY');
    await send((await store.get(id))!);                       // server processed it...
    await store.update(id, { status: 'INFLIGHT' });           // ...then the app died mid-flight
    await q.recoverInflight(); expect((await q.drain()).done).toBe(1); expect(calls).toBe(2);
  });
  it('media goes presign -> PUT bytes to the object URL (never through the API)', async () => {
    S.setValid('tok1'); const api = clientWith(() => 'tok1'); const before = S.uploaded.length;
    const mid = await uploadMedia(api, new Blob(['abc']), { owner_kind: 'WORK_LOG', retention_class: 'WORK_PLAN', content_type: 'image/jpeg' });
    expect(mid).toMatch(/^3f2b/); expect(S.uploaded.length - before).toBe(1);
  });
  it('AppError carries error_code from a real 4xx body', async () => {
    S.setValid('tok1'); const api = clientWith(() => 'tok1');
    const e: any = await api.post('/nope', { body: {} }).catch((x: unknown) => x); expect(e).toBeInstanceOf(AppError); expect(e.error_code).toBe('NOT_FOUND');
  });
});
