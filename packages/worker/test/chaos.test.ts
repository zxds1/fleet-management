// packages/worker/test/chaos.test.ts
// Fault-injection (chaos) suite for @fleet/worker (audit L7). Exercises the worker's
// resilience contracts under adversarial conditions: network throttling, DB latency,
// Redis failure, external 5xx injection, and a 50-tracker ingest load smoke.
// All external dependencies are mocked so the suite is hermetic and fast; the CI
// `chaos` job additionally provides throwaway PG + Redis services for integration-level
// coverage of the repository paths.

import { fetchWithTimeout, setSleepFn, resetSleepFn, MAX_ATTEMPTS } from "../src/infra/http";
import { BackfillPoller } from "../src/ingest/backfill";
import { IngestConsumer } from "../src/ingest/consumer";
import { parseTraccarPosition } from "../src/ingest/traccar";
import type { Env } from "../src/config/env";
import type { PoolLike } from "@fleet/shared";
import type { RetentionContextData } from "../src/ingest/repository";
import type { Redis } from "ioredis";

const env: Env = {
  NODE_ENV: "test",
  ROLE: "worker",
  DATABASE_URL: "",
  DATABASE_POOL_MAX: 10,
  DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
  REDIS_URL: "",
  REDIS_ENABLED: true,
  VISION_ENABLED: false,
  RECONCILIATION_ENABLED: false,
  GOOGLE_VISION_API_KEY: undefined,
  TRACCAR_BASE_URL: "",
  TRACCAR_USERNAME: "",
  TRACCAR_PASSWORD: "",
  TRACCAR_POLL_MINUTES: 5,
  TRACCAR_LOOKBACK_MINUTES: 30,
  FCM_SERVER_KEY: undefined,
  AFRICAS_TALKING_USERNAME: undefined,
  AFRICAS_TALKING_API_KEY: undefined,
  NOTIFICATION_FROM: "Fleet",
  AWS_REGION: "af-south-1",
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_SESSION_TOKEN: undefined,
  S3_ENDPOINT: undefined,
  S3_FORCE_PATH_STYLE: false,
  S3_MEDIA_BUCKET: "fleet-media",
  OUTBOX_INTERVAL_MS: 1000,
  OUTBOX_BATCH_SIZE: 50,
  OUTBOX_MAX_ATTEMPTS: 5,
  LOCALE_TIMEZONE: "Africa/Nairobi",
  SENTRY_DSN: undefined,
  SENTRY_ENVIRONMENT: undefined,
  RELEASE: undefined,
  HEALTH_PORT: 8082,
  SERVICE_NAME: "fleet-worker",
  LOG_LEVEL: "info",
  RESEND_API_KEY: undefined,
  EMAIL_FROM: "fleet@fleet.internal",
  EMAIL_AUTH_HEADER: "Authorization",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

/** Mock fetch that rejects after `latencyMs` via the AbortController signal (simulates slow/2G). */
function makeSlowFetch(latencyMs: number, calls: { count: number }): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    calls.count++;
    const signal = init?.signal;
    if (signal?.aborted) throw abortError();
    return new Promise((_, reject) => {
      const t = setTimeout(() => reject(abortError()), latencyMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(abortError());
      });
    });
  }) as unknown as typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. NETWORK-THROTTLE — pathologically slow downstream must time out → retry
// ─────────────────────────────────────────────────────────────────────────────

describe("chaos: network throttle (04 §4 / D8)", () => {
  beforeEach(() => setSleepFn(async () => undefined));
  afterEach(() => resetSleepFn());

  it("retries on timeout and eventually fails after MAX_ATTEMPTS", async () => {
    const calls = { count: 0 };
    const prev = global.fetch;
    global.fetch = makeSlowFetch(500, calls);
    try {
      await expect(fetchWithTimeout("http://slow.local/api", {}, 100, MAX_ATTEMPTS)).rejects.toThrow();
      expect(calls.count).toBe(MAX_ATTEMPTS);
    } finally {
      global.fetch = prev;
    }
  });

  it("succeeds once the downstream responds before the timeout", async () => {
    const calls = { count: 0 };
    const prev = global.fetch;
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.count++;
      if (calls.count < 3) {
        return new Promise((_, reject) => {
          setTimeout(() => reject(abortError()), 500);
          init?.signal?.addEventListener("abort", () => reject(abortError()));
        });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await expect(fetchWithTimeout("http://slow.local/api", {}, 100, MAX_ATTEMPTS)).resolves.toBeTruthy();
      expect(calls.count).toBe(3);
    } finally {
      global.fetch = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DB-LATENCY — slow queries must not stall the worker loop indefinitely
// ─────────────────────────────────────────────────────────────────────────────

describe("chaos: DB latency (04 §3)", () => {
  it("consumer.start() does not throw when DB is unreachable", async () => {
    const failingPool = {
      connect: async () => {
        throw new Error("ECONNREFUSED 5432");
      },
    };

    const consumer = new IngestConsumer({
      pool: failingPool as unknown as PoolLike,
      config: { numeric: async () => 15 } as any,
      redis: null,
    });

    await expect(consumer.start()).resolves.toBeUndefined();
  });

  it("processPositions propagates DB errors for dead-letter handling", async () => {
    const failingPool = {
      connect: async () => {
        throw new Error("ECONNREFUSED 5432");
      },
    };

    const consumer = new IngestConsumer({
      pool: failingPool as unknown as PoolLike,
      config: { numeric: async () => 15, string: async () => null, boolean: async () => false } as any,
      redis: null,
    });

    const pos = parseTraccarPosition({
      id: 1, deviceId: 5, vehicleId: "v1",
      fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8, speed: 10, attributes: {},
    });

    // DB error must propagate (not be swallowed) so processEntry can dead-letter it.
    await expect(consumer.processPositions([pos])).rejects.toThrow("ECONNREFUSED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REDIS-FAILURE — Redis unavailable degrades gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe("chaos: Redis failure (04 §2 / R-109)", () => {
  it("consumer.start() handles BUSYGROUP (group exists on restart) without throwing", async () => {
    class BusyRedis {
      async xgroup() { throw new Error("BUSYGROUP Consumer Group name already exists"); }
      async xreadgroup() { return []; }
      async xack() { return 1; }
      async incr() { return 1; }
      async pexpire() { return 1; }
      async del() { return 1; }
    }
    const consumer = new IngestConsumer({
      pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }) } as unknown as PoolLike,
      config: { numeric: async () => 15 } as any,
      redis: new BusyRedis() as unknown as Redis,
    });
    await expect(consumer.start()).resolves.toBeUndefined();
    consumer.stop();
  });

  it("consumer degrades to DB-only when Redis is null (R-109)", async () => {
    const consumer = new IngestConsumer({
      pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }) } as unknown as PoolLike,
      config: { numeric: async () => 15 } as any,
      redis: null,
    });
    // start() logs a warning and returns early when Redis is absent.
    await expect(consumer.start()).resolves.toBeUndefined();
    consumer.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXTERNAL-5XX INJECTION — transient 5xx retries, non-transient does not
// ─────────────────────────────────────────────────────────────────────────────

describe("chaos: external 5xx injection (N9 / A1.8)", () => {
  beforeEach(() => setSleepFn(async () => undefined));
  afterEach(() => resetSleepFn());

  it("retries on 503 and fails after MAX_ATTEMPTS", async () => {
    const calls: number[] = [];
    const prev = global.fetch;
    global.fetch = (async () => {
      calls.push(1);
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;
    try {
      await expect(fetchWithTimeout("https://fcm.googleapis.com/fcm/send", {}, 100, MAX_ATTEMPTS)).rejects.toThrow();
      expect(calls.length).toBe(MAX_ATTEMPTS);
    } finally {
      global.fetch = prev;
    }
  });

  it("does NOT retry on 400 (caller error)", async () => {
    const calls: number[] = [];
    const prev = global.fetch;
    global.fetch = (async () => {
      calls.push(1);
      return new Response(null, { status: 400 });
    }) as unknown as typeof fetch;
    try {
      await expect(fetchWithTimeout("https://fcm.googleapis.com/fcm/send", {}, 100, MAX_ATTEMPTS)).rejects.toThrow();
      expect(calls.length).toBe(1);
    } finally {
      global.fetch = prev;
    }
  });

  it("does NOT retry on 403 (auth error)", async () => {
    const calls: number[] = [];
    const prev = global.fetch;
    global.fetch = (async () => {
      calls.push(1);
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;
    try {
      await expect(fetchWithTimeout("https://fcm.googleapis.com/fcm/send", {}, 100, MAX_ATTEMPTS)).rejects.toThrow();
      expect(calls.length).toBe(1);
    } finally {
      global.fetch = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 50-TRACKER INGEST LOAD SMOKE — 50 concurrent tracker connections
// ─────────────────────────────────────────────────────────────────────────────

class LoadTestConsumer extends IngestConsumer {
  constructor() {
    super({
      pool: {
        connect: async () => ({
          query: async () => ({ rows: [], rowCount: 0 }),
          release: () => undefined,
        }),
      } as unknown as PoolLike,
      config: { numeric: async () => 15, string: async () => null, boolean: async () => false } as any,
      redis: null,
    });
  }
  protected async contextFor(): Promise<RetentionContextData> {
    return {
      shiftWindow: { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T18:00:00Z") },
      recoveryModeActive: false,
      openAccident: false,
      tenantId: "00000000-0000-0000-0000-000000000001",
    };
  }
  protected async shiftIdFor() {
    return null;
  }
}

describe("chaos: 50-tracker ingest load smoke (04 §1)", () => {
  it("processes 50 concurrent positions without crashing", async () => {
    const c = new LoadTestConsumer();
    const positions = [];
    for (let i = 0; i < 50; i++) {
      positions.push(
        parseTraccarPosition({
          id: i,
          deviceId: 5,
          vehicleId: `v${i}`,
          fixTime: "2026-01-01T12:00:00Z",
          latitude: -1.2,
          longitude: 36.8,
          speed: 10,
          attributes: {},
        }),
      );
    }

    const res = await c.processPositions(positions);
    expect(res.processed).toBe(50);
    expect(res.retained).toBe(50);
  });

  it("backfill poller survives a flaky Traccar (503 then 200)", async () => {
    let attempt = 0;
    const fetchImpl = async () => {
      attempt++;
      if (attempt === 1) return { ok: false, status: 503, json: async () => [] };
      return { ok: true, status: 200, json: async () => [] };
    };
    const poller = new BackfillPoller({
      baseUrl: "http://traccar.local",
      username: "admin",
      password: "admin",
      lookbackMinutes: 30,
      pollMinutes: 5,
      breakerTimeoutMs: 200,
      fetchImpl,
      onPositions: async () => {},
    });
    // First call: 503 → caught, returns 0. Second call: 200 → returns 0 (empty payload).
    expect(await poller.runOnce()).toBe(0);
    expect(await poller.runOnce()).toBe(0);
  });
});
