// packages/worker/test/email.transport.test.ts
// Email transport (N9 / A1.8): degrades to a logged no-op when no RESEND_API_KEY is configured, and
// performs a real JSON POST to Resend (Bearer auth) when one is set.

import { emailTransport } from "../src/jobs/transports";
import type { Env } from "../src/config/env";

const row = {
  id: "n1",
  templateCode: null,
  recipientUserId: null,
  recipientAddress: "ops@fleet.co.ke",
  channel: "EMAIL" as const,
  priority: "NORMAL" as const,
  locale: "en",
  title: "Document expiring",
  body: "Insurance expires in 7 days.",
  payload: {},
  incidentKind: null,
  incidentId: null,
  dedupeKey: null,
};

const baseEnv: Env = {
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
  EMAIL_API_URL: undefined,
  EMAIL_API_KEY: undefined,
  RESEND_API_KEY: undefined,
  EMAIL_FROM: "fleet@fleet.internal",
  EMAIL_AUTH_HEADER: "Authorization",
};

describe("emailTransport", () => {
  it("skips (no-op) when no RESEND_API_KEY is configured", async () => {
    const t = emailTransport(baseEnv);
    const res = await t.send(row);
    expect(res.status).toBe("SENT");
    expect(res.provider).toBe("email-skip");
  });

  it("POSTs to Resend with Bearer auth and reports SENT on 2xx", async () => {
    const calls: RequestInit[] = [];
    const fetchMock = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const prev = global.fetch;
    global.fetch = fetchMock;
    try {
      const t = emailTransport({ ...baseEnv, RESEND_API_KEY: "re_key123" });
      const res = await t.send(row);
      expect(res.status).toBe("SENT");
      expect(res.provider).toBe("EMAIL");
      const init = calls[0]!;
      expect(JSON.parse(String(init.body)).to).toBe("ops@fleet.co.ke");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer re_key123",
        "Content-Type": "application/json",
      });
      // fetchWithTimeout wires a per-call AbortController signal for the bounded timeout.
      expect(init.signal).toBeDefined();
    } finally {
      global.fetch = prev;
    }
  });

  it("reports FAILED when Resend returns an error status", async () => {
    const fetchMock = (async () => new Response(null, { status: 502 })) as unknown as typeof fetch;
    const prev = global.fetch;
    global.fetch = fetchMock;
    try {
      const t = emailTransport({ ...baseEnv, RESEND_API_KEY: "re_key123" });
      const res = await t.send(row);
      expect(res.status).toBe("FAILED");
    } finally {
      global.fetch = prev;
    }
  });
});
