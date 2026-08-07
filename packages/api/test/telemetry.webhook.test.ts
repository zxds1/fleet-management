// packages/api/test/telemetry.webhook.test.ts
// P0 verification: the Traccar webhook accept endpoint validates the payload, resolves the
// deviceId → vehicle_id, and XADDs the normalised position to the `traccar:positions` stream.
import { createApp } from "../src/app/app";
import { env } from "../src/config/env";
import type { Container } from "../src/app/container";
import type { Redis as RedisClient } from "ioredis";

function makeClient(overrides: Partial<Container> = {}): Container {
  const base = {
    env: env(),
    pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }), close: async () => undefined } as never,
    redis: { client: null, cache: { get: async () => null, set: async () => undefined, del: async () => undefined }, sessions: {} as never, close: async () => undefined },
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

function fakePool(rows: { vehicle_id?: string }[] = []) {
  return {
    connect: async () => ({ query: async () => ({ rows, rowCount: rows.length }), release: () => undefined }),
    end: async () => undefined,
  };
}

function xaddSpy() {
  const calls: [string, string, string, string][] = [];
  const client = {
    xadd: async (stream: string, _id: string, field: string, value: string) => {
      calls.push([stream, _id, field, value]);
      return "1-0";
    },
  } as unknown as RedisClient;
  return { client, calls };
}

describe("POST /api/v1/telemetry/webhook", () => {
  it("202 + XADDs a normalised position resolving vehicleId", async () => {
    const { client, calls } = xaddSpy();
    const container = makeClient({
      redis: { client, cache: { get: async () => null, set: async () => undefined, del: async () => undefined }, sessions: {} as never, close: async () => undefined },
      pool: fakePool([{ vehicle_id: "veh-9" }]),
    } as Partial<Container>);
    const app = createApp(container);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: "123",
          lat: -1.2,
          lon: 36.8,
          speed: 40,
          heading: 90,
          ignition: true,
          timestamp: "2026-08-06T10:00:00Z",
        }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { accepted: boolean };
      expect(body.accepted).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]![0]).toBe("traccar:positions");
      expect(calls[0]![2]).toBe("data");
      const published = JSON.parse(calls[0]![3]);
      expect(published.vehicleId).toBe("veh-9");
      expect(published.latitude).toBe(-1.2);
      expect(published.course).toBe(90);
      expect(published.attributes.ignition).toBe(true);
    } finally {
      await new Promise<void>((r) => {
        const s = server as unknown as { closeAllConnections?: () => void };
        if (typeof s.closeAllConnections === "function") s.closeAllConnections();
        server.close(() => r());
      });
    }
  });

  it("400 on a malformed payload", async () => {
    const { client } = xaddSpy();
    const container = makeClient({
      redis: { client, cache: { get: async () => null, set: async () => undefined, del: async () => undefined }, sessions: {} as never, close: async () => undefined },
    } as Partial<Container>);
    const app = createApp(container);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: 1 }),
      });
      expect(res.status).toBe(400);
    } finally {
      await new Promise<void>((r) => {
        const s = server as unknown as { closeAllConnections?: () => void };
        if (typeof s.closeAllConnections === "function") s.closeAllConnections();
        server.close(() => r());
      });
    }
  });

  it("503 when the ingestion stream (Redis) is unavailable", async () => {
    const container = makeClient(); // redis.client = null
    const app = createApp(container);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/telemetry/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: "1", lat: 1, lon: 2, timestamp: "2026-08-06T10:00:00Z" }),
      });
      expect(res.status).toBe(503);
    } finally {
      await new Promise<void>((r) => {
        const s = server as unknown as { closeAllConnections?: () => void };
        if (typeof s.closeAllConnections === "function") s.closeAllConnections();
        server.close(() => r());
      });
    }
  });
});
