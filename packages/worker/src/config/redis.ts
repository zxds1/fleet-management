// packages/worker/src/config/redis.ts
// Redis wiring for @fleet/worker: the ConfigClient cache (00 §6) and the raw client
// the ingest consumer uses for XREAD on `traccar:positions` (04 §2). A Redis outage
// degrades to the DB/ConfigClient defaults and (for ingest) to the back-fill poller
// as the durability guarantee (R-109).

import Redis, { type Redis as RedisClient } from "ioredis";
import { logger } from "@fleet/shared";
import type { Cache } from "@fleet/db";
import type { Env } from "./env";

export interface RedisBundle {
  client: RedisClient | null;
  cache: Cache;
  close(): Promise<void>;
}

const memoryStore = new Map<string, { value: string; expiresAt: number }>();

/**
 * TLS enforcement for Redis. `rediss://` enables TLS with certificate verification
 * (rejectUnauthorized: true). In production (or SECURITY_ENFORCE=always) a plaintext
 * `redis://` URL is rejected at boot (fail-closed) so cache traffic is never sent in the
 * clear (security Layer 3). Dev uses plaintext redis:// localhost.
 */
function resolveRedisTls(url: string): { tls: { rejectUnauthorized: boolean } } | undefined {
  if (url.startsWith("rediss://")) return { tls: { rejectUnauthorized: true } };
  const mode = (process.env.SECURITY_ENFORCE ?? "production").toLowerCase();
  const enforce = mode === "always" || (mode !== "off" && process.env.NODE_ENV === "production");
  if (enforce && url.startsWith("redis://")) {
    throw new Error(
      "Refusing to start with a plaintext REDIS_URL in production. Use rediss:// to encrypt " +
        "the connection (security Layer 3).",
    );
  }
  return undefined;
}

export function createRedis(env: Env): RedisBundle {
  if (!env.REDIS_ENABLED) return memoryBundle();

  const client = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    ...resolveRedisTls(env.REDIS_URL),
  });
  client.on("error", (err) => logger.warn("worker redis error", { message: err.message }));

  const cache: Cache = {
    async get(key) {
      try {
        return await client.get(key);
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        if (ttlSeconds) await client.set(key, value, "EX", ttlSeconds);
        else await client.set(key, value);
      } catch {
        /* best effort */
      }
    },
    async del(key) {
      try {
        await client.del(key);
      } catch {
        /* best effort */
      }
    },
  };

  return {
    client,
    cache,
    async close() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export function memoryBundle(): RedisBundle {
  const cache: Cache = {
    async get(key) {
      const hit = memoryStore.get(key);
      if (!hit) return null;
      if (hit.expiresAt < Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSeconds = 30) {
      memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      memoryStore.delete(key);
    },
  };
  return { client: null, cache, async close() {} };
}
