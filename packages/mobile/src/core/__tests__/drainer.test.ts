// packages/mobile/src/core/__tests__/drainer.test.ts
import { Drainer } from "../offlineQueue/drainer";
import { OfflineQueue } from "../offlineQueue";
import { createMapStore } from "../offlineQueue/store";
import { ApiClient, ApiError } from "../apiClient";
import { fromServer } from "../error";

function fakeApi(behaviour: (method: string, path: string) => void) {
  return {
    async send(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string) {
      behaviour(method, path);
      return { ok: true };
    },
  } as unknown as ApiClient;
}

function throwApi(code: string) {
  return {
    async send() {
      throw new ApiError(fromServer({ error_code: code, message: code }));
    },
  } as unknown as ApiClient;
}

describe("Drainer", () => {
  it("replays pending items and marks them done", async () => {
    const store = createMapStore(new Map());
    const queue = new OfflineQueue(store);
    const sent: string[] = [];
    const drainer = new Drainer({
      queue,
      api: fakeApi((_m, path) => sent.push(path)),
      isOnline: () => true,
      pollMs: 1_000_000,
    });
    await queue.enqueue({ method: "POST", path: "/shifts/clock-in", body: { a: 1 } });
    await drainer.cycle();

    expect(sent).toEqual(["/shifts/clock-in"]);
    expect((await queue.counts()).total).toBe(0);
  });

  it("discards DUPLICATE on replay (D-7)", async () => {
    const store = createMapStore(new Map());
    const queue = new OfflineQueue(store);
    const resolved: string[] = [];
    const drainer = new Drainer({
      queue,
      api: throwApi("DUPLICATE"),
      isOnline: () => true,
      pollMs: 1_000_000,
      onItemResolved: (_i, o) => resolved.push(o),
    });
    await queue.enqueue({ method: "POST", path: "/x", body: {} });
    await drainer.cycle();

    expect(resolved).toContain("discarded");
    expect((await queue.counts()).total).toBe(0);
  });

  it("moves hard domain errors to FAILED_REVIEW", async () => {
    const store = createMapStore(new Map());
    const queue = new OfflineQueue(store);
    const drainer = new Drainer({ queue, api: throwApi("ODOMETER_DECREASED"), isOnline: () => true, pollMs: 1_000_000 });
    await queue.enqueue({ method: "POST", path: "/x", body: {} });
    await drainer.cycle();
    expect((await queue.counts()).failedReview).toBe(1);
  });

  it("does not replay while offline", async () => {
    const store = createMapStore(new Map());
    const queue = new OfflineQueue(store);
    const sent: string[] = [];
    const drainer = new Drainer({ queue, api: fakeApi((_m, p) => sent.push(p)), isOnline: () => false, pollMs: 1_000_000 });
    await queue.enqueue({ method: "POST", path: "/x", body: {} });
    await drainer.cycle();
    expect(sent).toHaveLength(0);
  });

  it("stops on a fatal reauth code and calls onReauth", async () => {
    const store = createMapStore(new Map());
    const queue = new OfflineQueue(store);
    const reauths: string[] = [];
    const drainer = new Drainer({
      queue,
      api: throwApi("UNAUTHENTICATED"),
      isOnline: () => true,
      pollMs: 1_000_000,
      onReauth: (c) => reauths.push(c),
    });
    await queue.enqueue({ method: "POST", path: "/x", body: {} });
    await drainer.cycle();
    expect(reauths).toContain("UNAUTHENTICATED");
  });
});
