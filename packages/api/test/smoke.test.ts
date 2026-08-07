// packages/api/test/smoke.test.ts
import { createApp } from "../src/app/app";
import { env } from "../src/config/env";
import type { Container } from "../src/app/container";

function fakeContainer(): Container {
  // Only /healthz is exercised here, so the pool/redis collaborators are inert stubs.
  return {
    env: env(),
    pool: { connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }) },
    redis: { client: null, cache: { get: async () => null, set: async () => undefined, del: async () => undefined }, sessions: {} as never, close: async () => undefined },
    config: { numeric: async () => 0, string: async () => null, boolean: async () => false } as never,
    idempotency: {} as never,
    tokens: {} as never,
    secretBox: {} as never,
    infra: {} as never,
    releaseClaim: async () => undefined,
    close: async () => undefined,
  } as unknown as Container;
}

describe("@fleet/api app", () => {
  it("boots and serves /healthz", async () => {
    const app = createApp(fakeContainer());
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    } finally {
      await new Promise<void>((r) => {
        const s = server as unknown as { closeAllConnections?: () => void };
        if (typeof s.closeAllConnections === "function") s.closeAllConnections();
        server.close(() => r());
      });
    }
  });
});
