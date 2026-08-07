// packages/db/src/pool.ts
// Real pg-backed PoolLike. `connect()` checks out a pooled client that satisfies the
// shared DbClient contract (query + optional release). This is the only place @fleet/db
// touches the pg driver.

import { Pool as PgPool, type PoolClient } from "pg";
import type { DbClient, PoolLike } from "@fleet/shared";

export interface PoolConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionString?: string;
  max?: number;
  statementTimeoutMs?: number;
  idleTimeoutMillis?: number;
}

export type FleetPool = PoolLike & { end(): Promise<void> };

export function createPool(config: PoolConfig = {}): FleetPool {
  const pgPool = new PgPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionString: config.connectionString,
    max: config.max ?? 10,
    statement_timeout: config.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 10_000,
  });

  return {
    async connect(): Promise<DbClient> {
      const client: PoolClient = await pgPool.connect();
      // PoolClient has `query` + `release`; the cast is safe for our minimal surface.
      return client as unknown as DbClient;
    },
    async end(): Promise<void> {
      await pgPool.end();
    },
  };
}
