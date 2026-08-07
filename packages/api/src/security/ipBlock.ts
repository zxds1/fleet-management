// packages/api/src/security/ipBlock.ts
// IP blocking (security.md S-3): defends against DDoS / credential-stuffing / scanner abuse. Tracks
// abusive responses (401/403/429) per IP in a sliding window and auto-blocks the IP once the
// threshold is exceeded; also supports a manual blocklist. Redis-backed in production, in-memory
// otherwise. When `enabled` is false it is a pass-through. Health probes excluded.

import type { RequestHandler } from "express";
import type { Redis as RedisClient } from "ioredis";
import { logger } from "@fleet/shared";
import { IpBlocked } from "./errors";

export interface IpBlockerOptions {
  threshold?: number;
  windowMs?: number;
  blockTtlSeconds?: number;
}

export interface IpBlocker {
  middleware(): RequestHandler;
  block(ip: string, ttlSeconds?: number): Promise<void>;
  isBlocked(ip: string): Promise<boolean>;
}

const ABUSE_STATUSES = new Set([401, 403, 429]);

function isHealth(path: string | undefined): boolean {
  return path === "/healthz" || path === "/readyz" || path === "/health/deep";
}

export function createIpBlocker(
  redis: RedisClient | null,
  enabled: boolean,
  opts: IpBlockerOptions = {},
): IpBlocker {
  const threshold = opts.threshold ?? 100;
  const windowMs = opts.windowMs ?? 600_000;
  const blockTtl = opts.blockTtlSeconds ?? 3600;
  const memBlocked = new Map<string, number>();
  const memAbuse = new Map<string, { bucket: number; count: number }>();

  async function blocked(ip: string): Promise<boolean> {
    if (redis) {
      if (await redis.get(`security:blocked:${ip}`)) return true;
      return (await redis.sismember("security:blocklist", ip)) === 1;
    }
    const exp = memBlocked.get(ip);
    return !!exp && exp > Date.now();
  }

  async function setBlock(ip: string): Promise<void> {
    if (redis) {
      await redis.set(`security:blocked:${ip}`, "1", "EX", blockTtl);
    } else {
      memBlocked.set(ip, Date.now() + blockTtl * 1000);
    }
    logger.warn("ip auto-blocked", { ip });
  }

  async function track(ip: string): Promise<void> {
    const bucket = Math.floor(Date.now() / windowMs);
    let count: number;
    if (redis) {
      const k = `security:abuse:${ip}:${bucket}`;
      count = await redis.incr(k);
      if (count === 1) await redis.pexpire(k, windowMs);
    } else {
      const rec = memAbuse.get(ip);
      if (!rec || rec.bucket !== bucket) memAbuse.set(ip, { bucket, count: 0 });
      const r = memAbuse.get(ip)!;
      r.count += 1;
      count = r.count;
    }
    if (count >= threshold) await setBlock(ip);
  }

  return {
    async block(ip, ttlSeconds) {
      const ttl = ttlSeconds ?? blockTtl;
      if (redis) {
        await redis.set(`security:blocked:${ip}`, "1", "EX", ttl);
        await redis.sadd("security:blocklist", ip);
      } else {
        memBlocked.set(ip, Date.now() + ttl * 1000);
      }
    },
    isBlocked(ip) {
      return blocked(ip);
    },
    middleware() {
      return (req, res, next) => {
        if (!enabled) return next();
        const ip = (req.ip ?? "unknown").toString();
        if (isHealth(req.path)) return next();
        blocked(ip)
          .then((b) => {
            if (b) return next(new IpBlocked());
            res.once("finish", () => {
              if (ABUSE_STATUSES.has(res.statusCode)) track(ip).catch(() => undefined);
            });
            next();
          })
          .catch((e) => {
            logger.warn("ip block error", { message: (e as Error).message });
            next();
          });
      };
    },
  };
}
