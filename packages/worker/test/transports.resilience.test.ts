// packages/worker/test/transports.resilience.test.ts
// Resilience of the notification transports (N9 / A1.8): a hung downstream call must abort at the
// bounded timeout, and a failing downstream must trip the circuit breaker so the worker fails fast
// instead of hammering it. Both surface as a retryable FAILED result handled by the outbox path.

import { emailTransport, fcmTransport } from "../src/jobs/transports";
import { fetchWithTimeout, TransportTimeoutError, TransportHttpError, setSleepFn, resetSleepFn } from "../src/infra/http";
import type { Env } from "../src/config/env";
import type { NotificationRow } from "../src/jobs/notifications";
import { createServer } from "http";

const env: Env = {
  NODE_ENV: "test",
  ROLE: "worker",
  DATABASE_URL: "",
  DATABASE_POOL_MAX: 10,
  DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
  REDIS_URL: "",
  REDIS_ENABLED: true,
  TRACCAR_BASE_URL: "",
  TRACCAR_USERNAME: "",
  TRACCAR_PASSWORD: "",
  TRACCAR_POLL_MINUTES: 5,
  TRACCAR_LOOKBACK_MINUTES: 30,
  FCM_SERVER_KEY: "key",
  AFRICAS_TALKING_USERNAME: "u",
  AFRICAS_TALKING_API_KEY: "k",
  NOTIFICATION_FROM: "Fleet",
  AWS_REGION: "af-south-1",
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_SESSION_TOKEN: undefined,
  S3_ENDPOINT: undefined,
  S3_FORCE_PATH_STYLE: false,
  S3_MEDIA_BUCKET: "fleet-media",
  VISION_ENABLED: false,
  RECONCILIATION_ENABLED: false,
  GOOGLE_VISION_API_KEY: undefined,
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
  RESEND_API_KEY: "key123",
  EMAIL_FROM: "fleet@fleet.internal",
  EMAIL_AUTH_HEADER: "Authorization",
};

const row: NotificationRow = {
  id: "n1",
  templateCode: null,
  recipientUserId: null,
  recipientAddress: "ops@fleet.co.ke",
  channel: "EMAIL",
  priority: "NORMAL",
  locale: "en",
  title: "Document expiring",
  body: "Insurance expires in 7 days.",
  payload: {},
  incidentKind: null,
  incidentId: null,
  dedupeKey: null,
};

describe("fetchWithTimeout", () => {
  beforeEach(() => setSleepFn(async () => undefined));
  afterEach(() => resetSleepFn());

  it("aborts a hung downstream at the timeout", async () => {
    // Accept the connection but never send a response — the fetch must time out, not hang.
    const server = createServer((_req, res) => res.socket?.on("data", () => {}));
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };
    try {
      await expect(fetchWithTimeout(`http://127.0.0.1:${port}/slow`, { method: "POST" }, 100)).rejects.toBeInstanceOf(TransportTimeoutError);
    } finally {
      server.close();
    }
  });

  it("throws TransportHttpError on a 5xx so the breaker trips", async () => {
    const calls: number[] = [];
    const prev = global.fetch;
    global.fetch = (async (_u: string) => {
      calls.push(1);
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;
    try {
      await expect(fetchWithTimeout("https://mail.example/send")).rejects.toBeInstanceOf(TransportHttpError);
      expect(calls).toHaveLength(3);
    } finally {
      global.fetch = prev;
    }
  });
});

describe("emailTransport circuit breaker", () => {
  beforeEach(() => setSleepFn(async () => undefined));
  afterEach(() => resetSleepFn());

  it("trips the breaker after consecutive failures and fails fast", async () => {
    let calls = 0;
    const prev = global.fetch;
    global.fetch = (async () => {
      calls++;
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;
    try {
      const t = emailTransport(env);
      const results = [];
      for (let i = 0; i < 8; i++) results.push(await t.send(row));
      // Every attempt is retryable (surfaces to the outbox path via markFailed).
      expect(results.every((r) => r.status === "FAILED")).toBe(true);
      // The breaker wraps fetchWithTimeout which now retries 3× internally; 5 fire()
      // calls (each 3 fetches) trip the breaker, then the remaining 3 fail fast.
      expect(calls).toBeGreaterThanOrEqual(15);
      expect(calls).toBeLessThan(24);
      expect(results.some((r) => r.failureReason === "EMAIL 503")).toBe(true);
      expect(results.some((r) => r.failureReason === "Breaker is open")).toBe(true);
    } finally {
      global.fetch = prev;
    }
  });
});

describe("fcmTransport circuit breaker", () => {
  beforeEach(() => setSleepFn(async () => undefined));
  afterEach(() => resetSleepFn());

  it("preserves the legacy `FCM <status>` failure reason on 5xx", async () => {
    const prev = global.fetch;
    global.fetch = (async () => new Response(null, { status: 502 })) as unknown as typeof fetch;
    try {
      const res = await fcmTransport(env).send({ ...row, channel: "PUSH", recipientAddress: "abc" });
      expect(res.status).toBe("FAILED");
      expect(res.failureReason).toBe("FCM 502");
    } finally {
      global.fetch = prev;
    }
  });
});
