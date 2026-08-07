// packages/worker/src/infra.ts
// Builds the shared infrastructure every worker mode depends on: the pg pool, the
// Redis bundle (stream consumer + config cache), and the typed ConfigClient (C2.4).

import { createPool, PgConfigClient } from "@fleet/db";
import type { PoolLike, ConfigClient, EventPublisher } from "@fleet/shared";
import { logger, redisPublisher } from "@fleet/shared";
import { env, type Env } from "./config/env";
import { createRedis, type RedisBundle } from "./config/redis";

export interface WorkerInfra {
  env: Env;
  pool: PoolLike;
  redis: RedisBundle;
  config: ConfigClient;
  /** Publishes real-time events to the @fleet/ws gateway (07 §3/§5). */
  publisher: EventPublisher;
  shutdown(): Promise<void>;
}

export async function bootInfra(e: Env = env()): Promise<WorkerInfra> {
  const pool: PoolLike = createPool({
    connectionString: e.DATABASE_URL,
    max: e.DATABASE_POOL_MAX,
    statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  const redis = createRedis(e);
  const config = new PgConfigClient(pool, redis.cache);
  const publisher = redisPublisher(redis.client);

  logger.info("worker infra ready", { role: e.ROLE, redis: redis.client !== null });

  return {
    env: e,
    pool,
    redis,
    config,
    publisher,
    async shutdown() {
      await redis.close();
      await (pool as { end?: () => Promise<void> }).end?.();
    },
  };
}
