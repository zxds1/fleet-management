// packages/db/src/migrations.ts
// Idempotent migration runner. Applies *.sql files from a directory in sort order, each
// in its own transaction, recording applied names + a content hash in app.applied_migrations.
// Re-running is a no-op (idempotent, 06 §7). DDL is the authority for table shape.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolLike } from "@fleet/shared";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

async function withClient<T>(pool: PoolLike, fn: (client: import("@fleet/shared").DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release?.();
  }
}

export async function ensureMigrationsTable(pool: PoolLike): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS app`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS app.applied_migrations (
         name text PRIMARY KEY,
         hash text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
  });
}

async function appliedNames(pool: PoolLike): Promise<Set<string>> {
  return withClient(pool, async (client) => {
    const res = await client.query<{ name: string }>(`SELECT name FROM app.applied_migrations`);
    return new Set(res.rows.map((r) => r.name));
  });
}

// FNV-1a — enough to detect a changed migration file.
function hash(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export async function runMigrations(pool: PoolLike, dir: string): Promise<MigrationResult> {
  await ensureMigrationsTable(pool);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = await appliedNames(pool);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(join(dir, file), "utf8");
    await withClient(pool, async (client) => {
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO app.applied_migrations (name, hash) VALUES ($1, $2)`, [file, hash(sql)]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    });
    applied.push(file);
  }

  return { applied, skipped };
}
