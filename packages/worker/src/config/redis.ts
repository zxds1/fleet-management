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

export function createRedis(env: Env): RedisBundle {
  if (!env.REDIS_ENABLED) return memoryBundle();

  const client = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
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
