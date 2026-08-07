// packages/api/src/security/rateLimit.ts
// Sliding/fixed-window rate limiter (security.md S-3): per-IP counters, per-scope limits, Redis-backed
// in production and in-memory when Redis is unavailable (degrades open, never blocks the API). When
// `enabled` is false (non-production by default) it is a pass-through so local/test traffic is never
// throttled. Health probes are excluded.

import type { RequestHandler } from "express";
import type { Redis as RedisClient } from "ioredis";
import { logger } from "@fleet/shared";
import { TooManyRequests } from "./errors";

export interface RateLimitOptions {
  scope?: string;
  max?: number;
  windowMs?: number;
}

export interface RateLimiter {
  middleware(opts?: RateLimitOptions): RequestHandler;
}

const DEFAULT_WINDOW_MS = 60_000;

function isHealth(path: string | undefined): boolean {
  return path === "/healthz" || path === "/readyz" || path === "/health/deep";
}

export function createRateLimiter(redis: RedisClient | null, enabled: boolean): RateLimiter {
  const mem = new Map<string, { bucket: number; count: number }>();

  async function hit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<{ allowed: boolean; remaining: number; reset: number }> {
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    if (redis) {
      const k = `${key}:${bucket}`;
      const count = await redis.incr(k);
      if (count === 1) await redis.pexpire(k, windowMs);
      return { allowed: count <= max, remaining: Math.max(0, max - count), reset: windowMs - (now % windowMs) };
    }
    const rec = mem.get(key);
    if (!rec || rec.bucket !== bucket) mem.set(key, { bucket, count: 0 });
    const r = mem.get(key)!;
    r.count += 1;
    return { allowed: r.count <= max, remaining: Math.max(0, max - r.count), reset: windowMs - (now % windowMs) };
  }

  return {
    middleware(opts: RateLimitOptions = {}) {
      const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
      const max = opts.max ?? 120;
      const scope = opts.scope ?? "global";
      return (req, res, next) => {
        if (!enabled) return next();
        if (isHealth(req.path)) return next();
        const ip = (req.ip ?? "unknown").toString();
        const key = `ratelimit:${scope}:${ip}`;
        hit(key, windowMs, max)
          .then(({ allowed, remaining, reset }) => {
            res.setHeader("X-RateLimit-Limit", String(max));
            res.setHeader("X-RateLimit-Remaining", String(remaining));
            res.setHeader("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
            if (!allowed) {
              res.setHeader("Retry-After", String(Math.ceil(reset / 1000)));
              return next(new TooManyRequests());
            }
            next();
          })
          .catch((e) => {
            logger.warn("rate limit error", { message: (e as Error).message });
            next(); // fail open on backend error
          });
      };
    },
  };
}
