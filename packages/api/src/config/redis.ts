// packages/api/src/config/redis.ts
// Redis wiring: the ConfigClient cache (00 §6, 30 s TTL) and the concurrent-session store
// (A1.6 / 02 §6 — `user:{userId}:sessions` sorted set, member = session_id, score = expires_at).
// A Redis outage must never take the API down: every call degrades to the DB path (R-109).

import Redis, { type Redis as RedisClient } from "ioredis";
import { logger } from "@fleet/shared";
import type { Cache } from "@fleet/db";
import type { Env } from "./env";

export interface SessionStore {
  /** Adds a session and evicts the oldest when the cap is exceeded. Returns evicted session ids. */
  add(userId: string, sessionId: string, expiresAt: Date, maxSessions: number): Promise<string[]>;
  remove(userId: string, sessionId: string): Promise<void>;
  removeAll(userId: string): Promise<string[]>;
  has(userId: string, sessionId: string): Promise<boolean>;
  count(userId: string): Promise<number>;
  /** False when Redis is unavailable, so callers can fall back to app.user_sessions. */
  readonly available: boolean;
}

export interface RedisBundle {
  client: RedisClient | null;
  cache: Cache;
  sessions: SessionStore;
  close(): Promise<void>;
}

const sessionKey = (userId: string) => `user:${userId}:sessions`;

/**
 * TLS enforcement for Redis. `rediss://` enables TLS with certificate verification
 * (rejectUnauthorized: true). In production (or SECURITY_ENFORCE=always) a plaintext
 * `redis://` URL is rejected at boot (fail-closed) so session/cache traffic is never
 * sent in the clear (security Layer 3). Dev uses plaintext redis:// localhost.
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
  client.on("error", (err) => logger.warn("redis error", { message: err.message }));

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
        /* cache write is best effort */
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

  const sessions: SessionStore = {
    get available() {
      return client.status === "ready";
    },
    async add(userId, sessionId, expiresAt, maxSessions) {
      try {
        const key = sessionKey(userId);
        await client.zremrangebyscore(key, "-inf", Date.now());
        await client.zadd(key, expiresAt.getTime(), sessionId);
        const overflow = (await client.zcard(key)) - maxSessions;
        if (overflow <= 0) return [];
        const evicted = await client.zrange(key, 0, overflow - 1);
        if (evicted.length > 0) await client.zrem(key, ...evicted);
        return evicted.filter((id) => id !== sessionId);
      } catch (e) {
        logger.warn("session store add degraded", { message: (e as Error).message });
        return [];
      }
    },
    async remove(userId, sessionId) {
      try {
        await client.zrem(sessionKey(userId), sessionId);
      } catch {
        /* best effort */
      }
    },
    async removeAll(userId) {
      try {
        const key = sessionKey(userId);
        const members = await client.zrange(key, 0, -1);
        await client.del(key);
        return members;
      } catch {
        return [];
      }
    },
    async has(userId, sessionId) {
      try {
        return (await client.zscore(sessionKey(userId), sessionId)) !== null;
      } catch {
        return true; // degrade open; app.user_sessions remains the audit source (02 §6)
      }
    },
    async count(userId) {
      try {
        return await client.zcard(sessionKey(userId));
      } catch {
        return 0;
      }
    },
  };

  return {
    client,
    cache,
    sessions,
    async close() {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

/** In-process stand-in used by tests and by `REDIS_ENABLED=false` dev boxes. */
export function memoryBundle(): RedisBundle {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const sets = new Map<string, Map<string, number>>();

  const cache: Cache = {
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSeconds = 30) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      store.delete(key);
    },
  };

  const sessions: SessionStore = {
    available: true,
    async add(userId, sessionId, expiresAt, maxSessions) {
      const set = sets.get(userId) ?? new Map<string, number>();
      for (const [id, score] of set) if (score < Date.now()) set.delete(id);
      set.set(sessionId, expiresAt.getTime());
      sets.set(userId, set);
      const overflow = set.size - maxSessions;
      if (overflow <= 0) return [];
      const oldest = [...set.entries()].sort((a, b) => a[1] - b[1]).slice(0, overflow);
      for (const [id] of oldest) set.delete(id);
      return oldest.map(([id]) => id).filter((id) => id !== sessionId);
    },
    async remove(userId, sessionId) {
      sets.get(userId)?.delete(sessionId);
    },
    async removeAll(userId) {
      const members = [...(sets.get(userId)?.keys() ?? [])];
      sets.delete(userId);
      return members;
    },
    async has(userId, sessionId) {
      return sets.get(userId)?.has(sessionId) ?? false;
    },
    async count(userId) {
      return sets.get(userId)?.size ?? 0;
    },
  };

  return { client: null, cache, sessions, async close() {} };
}
