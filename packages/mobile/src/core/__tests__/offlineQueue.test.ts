// packages/mobile/src/core/__tests__/offlineQueue.test.ts
import { OfflineQueue } from "../offlineQueue";
import { createMapStore } from "../offlineQueue/store";
import { countItems } from "../offlineQueue/types";

function makeNow(ms: number): () => string {
  return () => new Date(ms).toISOString();
}

describe("OfflineQueue", () => {
  it("enqueues with a frozen idempotency key and PENDING status", async () => {
    const store = createMapStore(new Map());
    const q = new OfflineQueue(store);
    const item = await q.enqueue({ method: "POST", path: "/shifts/clock-in", body: { a: 1 } });
    expect(item.status).toBe("PENDING");
    expect(item.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(await q.counts()).toMatchObject({ pending: 1, total: 1 });
  });

  it("discards duplicates (D-7 discard disposition)", async () => {
    const store = createMapStore(new Map());
    const q = new OfflineQueue(store);
    const item = await q.enqueue({ method: "POST", path: "/x", body: {} });
    const res = await q.markFailed(item, "DUPLICATE");
    expect(res).toBe("discarded");
    expect(await q.counts()).toMatchObject({ total: 0 });
  });

  it("moves hard domain errors to FAILED_REVIEW", async () => {
    const store = createMapStore(new Map());
    const q = new OfflineQueue(store);
    const item = await q.enqueue({ method: "POST", path: "/x", body: {} });
    const res = await q.markFailed(item, "ODOMETER_DECREASED");
    expect(res).toBe("failed_review");
    expect(await q.counts()).toMatchObject({ failedReview: 1 });
  });

  it("keeps transient errors PENDING with bumped attempts", async () => {
    const store = createMapStore(new Map());
    const q = new OfflineQueue(store);
    const item = await q.enqueue({ method: "POST", path: "/x", body: {} });
    const res = await q.markFailed(item, "RATE_LIMITED");
    expect(res).toBe("retry");
    const stored = (await q.list())[0]!;
    expect(stored.status).toBe("PENDING");
    expect(stored.attempts).toBe(1);
  });

  it("triggers the 24h offline ceiling", async () => {
    const store = createMapStore(new Map());
    const q = new OfflineQueue(store);
    const now = 1_000_000_000_000;
    await q.enqueue({ method: "POST", path: "/x", body: {}, now: makeNow(now - 25 * 3600 * 1000) });
    expect(await q.exceedsOfflineCeiling(24, () => now)).toBe(true);
    expect(await q.exceedsOfflineCeiling(24, () => now - 3600 * 1000)).toBe(false);
  });

  it("countItems tallies each status", () => {
    const counts = countItems([
      { status: "PENDING" } as never,
      { status: "PENDING" } as never,
      { status: "FAILED_REVIEW" } as never,
      { status: "DONE" } as never,
    ]);
    expect(counts).toMatchObject({ pending: 2, failedReview: 1, done: 1, total: 4 });
  });
});
