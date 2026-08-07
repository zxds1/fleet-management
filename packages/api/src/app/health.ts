// packages/api/src/app/health.ts
// Health probes (09-observability-ci.md §2). Readiness: PG connect + S3 reachability (api). Deep:
// replication lag, outbox backlog, last ingest position age (04). Each check degrades independently
// so one struggling subsystem doesn't fail the whole probe.

import type { FleetPool } from "@fleet/db";
import type { MediaPresigner } from "../media/presigner";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
  latencyMs?: number;
}

export interface DeepHealth {
  status: "ok" | "degraded";
  checks: HealthCheck[];
}

interface DbClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

async function scalar(pool: DbClient, sql: string, params: unknown[] = []): Promise<number | null> {
  const res = await pool.query<{ value: number }>(sql, params);
  const row = res.rows[0];
  return row ? row.value : null;
}

/** Liveness — process is up. */
export function liveness(): { status: "ok" } {
  return { status: "ok" };
}

/**
 * Readiness (09 §2): PG connect + S3 reachability. The S3 check is skipped (ok=true, detail) when
 * the presigner is not configured so a dev box without S3 still reports ready.
 */
export async function readiness(pool: FleetPool, presigner?: MediaPresigner): Promise<DeepHealth> {
  const checks: HealthCheck[] = [];

  try {
    const pg = await timed(async () => {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release?.();
      }
    });
    checks.push({ name: "postgres", ok: true, latencyMs: pg.ms });
  } catch (e) {
    checks.push({ name: "postgres", ok: false, detail: (e as Error).message });
  }

  if (presigner) {
    try {
      const s3 = await timed(() => presigner.ping());
      checks.push({
        name: "s3",
        ok: s3.value,
        latencyMs: s3.ms,
        detail: s3.value ? undefined : "unreachable or not configured",
      });
    } catch (e) {
      checks.push({ name: "s3", ok: false, detail: (e as Error).message });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { status: ok ? "ok" : "degraded", checks };
}

/**
 * Deep probe (09 §2): replication lag, outbox backlog, last ingest position age. Each query is
 * isolated in try/catch so a missing table / replica-less primary degrades the single check rather
 * than the whole probe.
 */
export async function deepHealth(pool: FleetPool): Promise<DeepHealth> {
  const checks: HealthCheck[] = [];

  const lag = await runCheck(pool, "replication_lag_seconds", async (db) => {
    const v = await scalar(
      db,
      `SELECT COALESCE(extract(epoch FROM now() - pg_last_xact_replay_timestamp()), 0)::int AS value`,
    );
    return v ?? 0;
  });
  checks.push(lag);

  const backlog = await runCheck(pool, "outbox_backlog", async (db) => {
    const v = await scalar(
      db,
      `SELECT count(*)::int AS value FROM app.outbox_events WHERE status <> 'PROCESSED'`,
    );
    return v ?? 0;
  });
  checks.push(backlog);

  const ingestAge = await runCheck(pool, "last_ingest_age_seconds", async (db) => {
    const v = await scalar(
      db,
      `SELECT COALESCE(extract(epoch FROM now() - max(received_at)), -1)::int AS value
         FROM app.location_updates`,
    );
    return v ?? -1;
  });
  checks.push(ingestAge);

  // Deep is degraded only when a check errored (not when a metric is merely non-zero).
  const ok = checks.every((c) => c.ok);
  return { status: ok ? "ok" : "degraded", checks };
}

async function runCheck(
  pool: FleetPool,
  name: string,
  fn: (db: DbClient) => Promise<number>,
): Promise<HealthCheck> {
  try {
    const client = await pool.connect();
    try {
      const t = await timed(() => fn(client as DbClient));
      return { name, ok: true, detail: String(t.value), latencyMs: t.ms };
    } finally {
      client.release?.();
    }
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message };
  }
}
