// packages/worker/src/health.ts
// Liveness / readiness probes for @fleet/worker (09-observability-ci.md §2). The worker holds the
// system of record only through its pool; readiness checks PG connect + Redis ping. Exposed via a
// tiny HTTP server so k8s can restart/roll based on it.

import { createServer, type Server } from "http";
import type { PoolLike } from "@fleet/shared";
import type { RedisBundle } from "./config/redis";

export interface HealthBundle {
  server: Server;
  close(): Promise<void>;
}

export function startHealthServer(port: number, pool: PoolLike, redis: RedisBundle): HealthBundle {
  const server = createServer(async (_req, res) => {
    if (_req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (_req.url === "/readyz") {
      const checks: Record<string, boolean> = {};
      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          checks.postgres = true;
        } finally {
          client.release?.();
        }
      } catch {
        checks.postgres = false;
      }
      checks.redis = redis.client !== null;
      const ok = Object.values(checks).every(Boolean);
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ok ? "ready" : "degraded", checks }));
      return;
    }
    res.writeHead(200);
    res.end("fleet-worker");
  });

  server.listen(port);
  return {
    server,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
