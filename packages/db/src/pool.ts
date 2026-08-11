// packages/db/src/pool.ts
// Real pg-backed PoolLike. `connect()` checks out a pooled client that satisfies the
// shared DbClient contract (query + optional release). This is the only place @fleet/db
// touches the pg driver.

import { Pool as PgPool, type PoolClient, type PoolConfig as PgPoolConfig } from "pg";
import type { DbClient, PoolLike } from "@fleet/shared";

/**
 * TLS enforcement for the DB connection. In production (or when SECURITY_ENFORCE=always) a
 * plaintext `postgresql://` URL is rejected at boot (fail-closed): secrets must travel over an
 * encrypted channel. `postgresql+ssl://` (treated as a TLS request) or any URL carrying
 * `sslmode=require`/`verify-full` enables `ssl: { rejectUnauthorized: true }`.
 */
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
  /**
   * Raw `options` string appended to every new connection's startup (pg's `options` param),
   * e.g. `'-c app.current_role=SYSTEM_ADMIN'`. Used by the worker pool so background jobs
   * (OCR, stale-shift sweeps, outbox relay, escalations) run as RLS-bypassing tenants: those
   * jobs scan the whole dataset and never set `app.current_tenant_id`, so FORCE RLS would
   * otherwise reduce them to zero rows once 14_tenancy.sql is applied.
   */
  options?: string;
  /** Enables TLS with certificate verification (pg `ssl: { rejectUnauthorized: true }`). */
  ssl?: boolean;
}

export type FleetPool = PoolLike & { end(): Promise<void> };

/** SECURITY-ENFORCE for the DB: "always" = force TLS check in any NODE_ENV; "production" =
 *  only when NODE_ENV=production (default); "off" = never enforce. Dev uses plaintext localhost. */
function dbEnforceTls(): boolean {
  const mode = (process.env.SECURITY_ENFORCE ?? "production").toLowerCase();
  if (mode === "off") return false;
  if (mode === "always") return true;
  return process.env.NODE_ENV === "production";
}

function resolveDbSsl(connectionString: string | undefined, explicitSsl: boolean | undefined): PgPoolConfig["ssl"] {
  if (explicitSsl === true) return { rejectUnauthorized: true };
  const url = connectionString ?? "";
  const wantsSsl = url.startsWith("postgresql+ssl://") || /sslmode=(require|verify-full|verify-ca)/i.test(url);
  if (wantsSsl) return { rejectUnauthorized: true };

  if (dbEnforceTls() && url.startsWith("postgresql://")) {
    // Fail-closed: plaintext Postgres in production is never allowed.
    throw new Error(
      "Refusing to start with a plaintext DATABASE_URL in production. Use postgresql+ssl:// " +
        "or a URL with sslmode=require to encrypt the connection (security Layer 3).",
    );
  }
  return undefined;
}

export function createPool(config: PoolConfig = {}): FleetPool {
  // Normalise postgresql+ssl:// to a scheme pg understands while preserving the TLS intent.
  const connectionString = config.connectionString?.replace(/^postgresql\+ssl:\/\//, "postgresql://");
  const ssl = resolveDbSsl(connectionString, config.ssl);

  const pgPool = new PgPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionString,
    max: config.max ?? 10,
    statement_timeout: config.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 10_000,
    options: config.options,
    ssl,
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
