// packages/worker/test/backfill.resilience.test.ts
// Resilience of the Traccar REST back-fill poller (04 §4): a failing / hung downstream must not
// stall or hammer the poll loop. A hung call aborts at the bounded timeout and surfaces as a
// retryable failure (runOnce returns 0, so the next poll retries), and after repeated failures the
// circuit breaker OPENS and fails fast — the underlying REST call is no longer invoked.

import { BackfillPoller, type FetchImpl } from "../src/ingest/backfill";
import { TransportTimeoutError } from "../src/infra/http";

function poller(fetchImpl: FetchImpl) {
  return new BackfillPoller({
    baseUrl: "http://traccar.local",
    username: "admin",
    password: "admin",
    lookbackMinutes: 30,
    pollMinutes: 5,
    breakerTimeoutMs: 100,
    fetchImpl,
    onPositions: async () => {},
  });
}

describe("BackfillPoller resilience", () => {
  it("treats a timed-out call as a retryable no-op (returns 0)", async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new TransportTimeoutError("http://traccar.local/api/positions", 100);
    };
    const seen = await poller(fetchImpl).runOnce();
    expect(seen).toBe(0);
  });

  it("opens the breaker after repeated failures and stops calling the downstream", async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls++;
      return { ok: false, status: 503, json: async () => [] };
    };
    const p = poller(fetchImpl);
    for (let i = 0; i < 10; i++) await p.runOnce();
    // Breaker opens after the volume threshold; subsequent runs short-circuit without a REST call.
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(calls).toBeLessThan(10);
  });

  it("returns the position count on a healthy response", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, deviceId: 5, vehicleId: "v1", fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8, speed: 10, attributes: {} }],
    });
    const seen = await poller(fetchImpl).runOnce();
    expect(seen).toBe(1);
  });
});
