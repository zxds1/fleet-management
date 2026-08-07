// packages/api/src/app/container.ts
// Wires the process-wide collaborators (pool, Redis bundle, config client, token signer, AES-GCM
// box, idempotency service) and exposes the per-domain router dependencies. Repositories + services
// are request-scoped (see compose.ts) so each write shares one transaction.

import { createPool, type Cache, type FleetPool, PgConfigClient, PgIdempotencyService } from "@fleet/db";
import type { ConfigClient, IdempotencyService } from "@fleet/shared";
import { env as loadEnv, type Env } from "../config/env";
import { createRedis, type RedisBundle } from "../config/redis";
import { TokenService } from "../security/tokens";
import { SecretBox } from "../security/crypto";
import { EnvMediaPresigner } from "../media/presigner";
import type { Infra } from "./compose";

export interface Container {
  env: Env;
  pool: FleetPool;
  redis: RedisBundle;
  config: ConfigClient;
  idempotency: IdempotencyService;
  tokens: TokenService;
  secretBox: SecretBox;
  infra: Infra;
  releaseClaim(subject: string, key: string): Promise<void>;
  close(): Promise<void>;
}

export function buildContainer(environment: Env = loadEnv()): Container {
  const pool = createPool({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    statementTimeoutMs: environment.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  const redis: RedisBundle = createRedis(environment);
  const config: ConfigClient = new PgConfigClient(pool, redis.cache as Cache | undefined);
  const idempotency: IdempotencyService = new PgIdempotencyService(pool);
  const tokens = new TokenService(environment);
  const secretBox = new SecretBox(environment.MFA_ENCRYPTION_KEY);
  const presigner = new EnvMediaPresigner(environment);

  const infra: Infra = { env: environment, tokens, secretBox, config, store: redis.sessions, presigner };

  const releaseClaim = async (subject: string, key: string): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query(
        `DELETE FROM app.idempotency_keys WHERE user_id = $1 AND idempotency_key = $2 AND state = 'IN_PROGRESS'`,
        [subject, key],
      );
    } finally {
      client.release?.();
    }
  };

  return {
    env: environment,
    pool,
    redis,
    config,
    idempotency,
    tokens,
    secretBox,
    infra,
    releaseClaim,
    async close() {
      await redis.close();
      await pool.end();
    },
  };
}
