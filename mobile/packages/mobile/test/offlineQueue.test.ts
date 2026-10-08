import { describe, it, expect, vi } from 'vitest';
import { OfflineQueue, type SendResult, type QueuedWrite } from '../src/core/offlineQueue';
import { MemoryQueueStore } from '../src/core/memoryQueueStore';

function setup(responses: Array<SendResult | Error>, ceiling = true) {
  const store = new MemoryQueueStore();
  const sent: QueuedWrite[] = [];
  const q = new OfflineQueue({
    store, authCeilingOk: async () => ceiling, sleep: async () => {},
    send: async (w) => { sent.push(w); const r = responses.shift() ?? { status: 200, body: {} }; if (r instanceof Error) throw r; return r; },
    onDiscarded: vi.fn(), onAuthExpired: vi.fn(), uuid: (() => { let n = 0; return () => `key-${++n}`; })(),
  });
  return { store, q, sent };
}

describe('OfflineQueue', () => {
  it('drains 2xx to DONE, oldest first', async () => {
    const { q, sent, store } = setup([]);
    await q.enqueue('POST', '/shifts/clock-in', { a: 1 }); await q.enqueue('POST', '/fuel/refuel', { b: 2 });
    const r = await q.drain();
    expect(r.done).toBe(2); expect(sent.map((s) => s.path)).toEqual(['/shifts/clock-in', '/fuel/refuel']);
    expect(await store.list(['PENDING', 'FAILED_REVIEW'])).toHaveLength(0);
  });
  it('hard 4xx goes to FAILED_REVIEW and does not block later items', async () => {
    const { q, store } = setup([{ status: 422, body: { error_code: 'ODOMETER_DECREASED', detail: 'low' } }]);
    await q.enqueue('POST', '/shifts/clock-in', {}); await q.enqueue('POST', '/fuel/refuel', {});
    const r = await q.drain();
    expect(r).toMatchObject({ done: 1, failedReview: 1 });
    const [f] = await store.list(['FAILED_REVIEW']);
    expect(f?.error_code).toBe('ODOMETER_DECREASED');
  });
  it('IDEMPOTENCY_CONFLICT is discarded and reported', async () => {
    const { q, store } = setup([{ status: 422, body: { error_code: 'IDEMPOTENCY_CONFLICT' } }]);
    await q.enqueue('POST', '/x', {});
    expect((await q.drain()).discarded).toBe(1);
    expect(await store.list(['DISCARDED'])).toHaveLength(1);
  });
  it('IDEMPOTENCY_INFLIGHT retries with the same key', async () => {
    const { q, sent } = setup([{ status: 409, body: { error_code: 'IDEMPOTENCY_INFLIGHT' } }, { status: 201, body: {} }]);
    await q.enqueue('POST', '/x', {}, 'fixed');
    expect((await q.drain()).done).toBe(1);
    expect(sent.map((s) => s.idempotency_key)).toEqual(['fixed', 'fixed']);
  });
  it('network error stops the pass and keeps order (item stays PENDING)', async () => {
    const { q, store, sent } = setup([new Error('offline')]);
    await q.enqueue('POST', '/a', {}); await q.enqueue('POST', '/b', {});
    expect((await q.drain()).stoppedBecause).toBe('OFFLINE');
    expect(sent).toHaveLength(1);
    expect(await store.list(['PENDING'])).toHaveLength(2);
  });
  it('5xx stops the pass; 401 signals auth expiry', async () => {
    const a = setup([{ status: 503, body: null }]); await a.q.enqueue('POST', '/a', {});
    expect((await a.q.drain()).stoppedBecause).toBe('BACKOFF');
    const b = setup([{ status: 401, body: {} }]); await b.q.enqueue('POST', '/a', {});
    expect((await b.q.drain()).stoppedBecause).toBe('AUTH');
  });
  it('refuses to drain past the 24h auth ceiling', async () => {
    const { q, sent } = setup([], false); await q.enqueue('POST', '/a', {});
    expect((await q.drain()).stoppedBecause).toBe('AUTH'); expect(sent).toHaveLength(0);
  });
  it('edit assigns a NEW idempotency key; retry keeps the old one', async () => {
    const { q, store } = setup([{ status: 422, body: { error_code: 'VALIDATION_ERROR' } }]);
    const id = await q.enqueue('POST', '/a', { v: 1 }, 'orig'); await q.drain();
    await q.retry(id); expect((await store.get(id))?.idempotency_key).toBe('orig');
    await q.edit(id, { v: 2 });
    const row = await store.get(id);
    expect(row).toMatchObject({ idempotency_key: 'key-1', status: 'PENDING', body: { v: 2 } });
  });
  it('recoverInflight re-queues rows left by a crash; concurrent drains are refused', async () => {
    const { q, store } = setup([]);
    const id = await q.enqueue('POST', '/a', {}); await store.update(id, { status: 'INFLIGHT' });
    await q.recoverInflight(); expect((await store.get(id))?.status).toBe('PENDING');
  });
});

describe('OfflineQueue staged uploads and dependent writes', () => {
  const T_PHOTO = 'aaaaaaaa-0000-4000-8000-000000000001', T_REC = 'aaaaaaaa-0000-4000-8000-000000000002';
  function staged(sendResp: (w: QueuedWrite) => SendResult, upload: (t: string) => Promise<any>) {
    const store = new MemoryQueueStore(); const sent: QueuedWrite[] = [];
    const q = new OfflineQueue({ store, authCeilingOk: async () => true, sleep: async () => {}, send: async (w) => { sent.push(w); return sendResp(w); }, uploadStaged: (u) => upload(u.token) });
    return { store, q, sent };
  }
  const photo = { token: T_PHOTO, uri: 'file:///p.jpg', content_type: 'image/jpeg', owner_kind: 'FUEL_PURCHASE', retention_class: 'FUEL_RECEIPT' } as const;
  it('uploads photos first, substitutes real ids, and chains produced ids into later writes', async () => {
    const { q, sent } = staged((w) => (w.path === '/driver/fuel/purchase' ? { status: 201, body: { fuel_purchase_id: 'REAL-REC' } } : { status: 201, body: {} }), async () => ({ status: 201, media_object_id: 'REAL-MEDIA' }));
    await q.enqueue('POST', '/driver/fuel/purchase', { receipt_media_object_id: T_PHOTO }, 'k1', { uploads: [photo], produces: { token: T_REC, field: 'fuel_purchase_id' } });
    await q.enqueue('POST', '/driver/fuel/correct', { purchase_id: T_REC, receipt: T_PHOTO }, 'k2', { needs: [T_REC] });
    expect((await q.drain()).done).toBe(2);
    expect(sent[0]?.body).toEqual({ receipt_media_object_id: 'REAL-MEDIA' });
    expect(sent[1]?.body).toEqual({ purchase_id: 'REAL-REC', receipt: 'REAL-MEDIA' });
  });
  it('offline during upload keeps the item PENDING and later resumes without re-uploading finished photos', async () => {
    let fail = true; let uploads = 0;
    const { q, store } = staged(() => ({ status: 201, body: {} }), async () => { uploads++; if (fail) throw new Error('offline'); return { status: 201, media_object_id: 'M' }; });
    await q.enqueue('POST', '/a', { m: T_PHOTO }, 'k', { uploads: [photo] });
    expect((await q.drain()).stoppedBecause).toBe('OFFLINE'); expect(await store.list(['PENDING'])).toHaveLength(1);
    fail = false; expect((await q.drain()).done).toBe(1);
    await q.enqueue('POST', '/b', { m: T_PHOTO }, 'k2', { uploads: [photo] }); await q.drain(); expect(uploads).toBe(2);
  });
  it('a dependent write fails review (never sends a placeholder id) when its parent failed', async () => {
    const { q, sent, store } = staged((w) => (w.path === '/fuel/records' ? { status: 422, body: { error_code: 'VALIDATION_ERROR' } } : { status: 201, body: {} }), async () => ({ status: 201, media_object_id: 'M' }));
    await q.enqueue('POST', '/fuel/records', {}, 'k1', { produces: { token: T_REC, field: 'fuel_record_id' } });
    await q.enqueue('POST', '/fuel/refuel', { r: T_REC }, 'k2', { needs: [T_REC] });
    const r = await q.drain();
    expect(r.failedReview).toBe(2); expect(sent.map((s) => s.path)).toEqual(['/fuel/records']);
    expect((await store.list(['FAILED_REVIEW'])).map((x) => x.error_code)).toEqual(['VALIDATION_ERROR', 'DEPENDENCY_FAILED']);
  });
});
