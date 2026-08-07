// packages/api/test/security.test.ts
// Verifies the backend security controls (security.md S-1/S-3): rate limiting + IP blocking on the
// telemetry ingress, webhook HMAC, safe JSON parsing (prototype pollution + depth), and security
// headers. Enforcement is forced on via SECURITY_ENFORCE=always so the controls are exercised even
// though the default is production-only.

import { createApp } from "../src/app/app";
import { env } from "../src/config/env";
import type { Container } from "../src/app/container";
import { createHmac } from "node:crypto";

function makeClient(overrides: Partial<Container> = {}): Container {
  const base = {
    env: env(),
    pool: {
      connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }),
      close: async () => undefined,
    } as never,
    redis: {
      client: null,
      cache: { get: async () => null, set: async () => undefined, del: async () => undefined },
      sessions: {} as never,
      close: async () => undefined,
    },
    config: { numeric: async () => 0, string: async () => null, boolean: async () => false } as never,
    idempotency: {} as never,
    tokens: {} as never,
    secretBox: {} as never,
    infra: {} as never,
    releaseClaim: async () => undefined,
    close: async () => undefined,
  };
  return { ...base, ...overrides } as unknown as Container;
}

function withEnv(extra: Record<string, unknown>): any {
  return { ...env(), ...extra };
}

async function listen(app: ReturnType<typeof createApp>) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        const s = server as unknown as { closeAllConnections?: () => void };
        if (typeof s.closeAllConnections === "function") s.closeAllConnections();
        server.close(() => r());
      }),
  };
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("rate limiting + IP blocking", () => {
  it("rate limits the telemetry webhook after the per-minute cap", async () => {
    const container = makeClient({
      env: withEnv({ SECURITY_ENFORCE: "always", RATE_LIMIT_TELEMETRY_PER_MINUTE: 3 }),
    });
    const { port, close } = await listen(createApp(container));
    try {
      const results: number[] = [];
      // Send more than the cap so the limiter is guaranteed to engage even if a
      // prior test left the shared in-memory window partially consumed.
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ lat: 1 }),
        });
        results.push(res.status);
      }
      // The limiter must only engage after the per-minute cap (3) is exceeded, so
      // the first rate-limited (429) response cannot appear before the 4th request.
      const first429 = results.indexOf(429);
      expect(first429).toBeGreaterThanOrEqual(3);
      // And it must actually engage.
      expect(results.filter((r) => r === 429).length).toBeGreaterThanOrEqual(2);
      // Every non-rate-limited response is a validation (400) rejection, never a pass-through.
      const nonLimited = results.filter((r) => r !== 429);
      expect(nonLimited).toEqual(nonLimited.map(() => 400));
    } finally {
      await close();
    }
  });

  it("auto-blocks an IP after repeated abuse (401s)", async () => {
    const container = makeClient({
      env: withEnv({ SECURITY_ENFORCE: "always", IP_BLOCK_THRESHOLD: 2 }),
    });
    const { port, close } = await listen(createApp(container));
    try {
      const get = () =>
        fetch(`http://127.0.0.1:${port}/api/v1/shifts/me/active`, { headers: JSON_HEADERS });
      expect((await get()).status).toBe(401);
      expect((await get()).status).toBe(401);
      expect((await get()).status).toBe(403); // blocked
    } finally {
      await close();
    }
  });
});

describe("telemetry webhook HMAC (S-1)", () => {
  const secret = "s3cr3t";
  const body = JSON.stringify({ deviceId: "1", lat: 1, lon: 2, timestamp: "2026-08-06T10:00:00Z" });

  async function post(port: number, headers: Record<string, string>) {
    return fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...headers },
      body,
    });
  }

  it("accepts a valid signature (auth passes; downstream 503 since redis is null in test)", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always", WEBHOOK_SECRET: secret }) });
    const { port, close } = await listen(createApp(container));
    try {
      const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
      const res = await post(port, { "x-signature": sig, "x-timestamp": Date.now().toString() });
      expect(res.status).not.toBe(401);
    } finally {
      await close();
    }
  });

  it("rejects an invalid signature", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always", WEBHOOK_SECRET: secret }) });
    const { port, close } = await listen(createApp(container));
    try {
      const res = await post(port, { "x-signature": "sha256=deadbeef", "x-timestamp": Date.now().toString() });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("rejects when signature/timestamp are missing", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always", WEBHOOK_SECRET: secret }) });
    const { port, close } = await listen(createApp(container));
    try {
      const res = await post(port, {});
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });
});

describe("safe JSON body parsing", () => {
  it("rejects prototype-pollution payloads", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always" }) });
    const { port, close } = await listen(createApp(container));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ "__proto__": { x: 1 }, deviceId: "1" }),
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it("rejects over-deep payloads", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always" }) });
    const { port, close } = await listen(createApp(container));
    try {
      let deep: unknown = { a: 1 };
      for (let i = 0; i < 20; i++) deep = { nested: deep };
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(deep),
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });
});

describe("security headers", () => {
  it("sets hardening headers on responses", async () => {
    const container = makeClient({ env: withEnv({ SECURITY_ENFORCE: "always" }) });
    const { port, close } = await listen(createApp(container));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ lat: 1 }),
      });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    } finally {
      await close();
    }
  });
});
