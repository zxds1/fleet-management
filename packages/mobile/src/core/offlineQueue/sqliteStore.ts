// packages/mobile/src/core/offlineQueue/sqliteStore.ts
//
// Durable `QueueStore` backed by SQLite. The native `expo-sqlite` driver is injected as a `DbPort`
// so this module is unit-testable in node with an in-memory fake (Phase 4 screen glue provides the
// real adapter). The schema is intentionally minimal — one row per outbox item, serialised as JSON
// (the body is arbitrary and never contains secrets, C5.3).

import type { OutboxItem, QueueStore } from "./types";

/** Minimal structural shape of an expo-sqlite `SQLiteDatabase` we need. */
export interface DbPort {
  exec(sql: string): void;
  run(sql: string, params: unknown[]): void;
  get<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  queued_at TEXT NOT NULL,
  last_error TEXT
);`;

export function createSqliteStore(db: DbPort): QueueStore {
  db.exec(SCHEMA);

  const rowToItem = (row: Record<string, unknown>): OutboxItem => ({
    id: row.id as string,
    method: row.method as OutboxItem["method"],
    path: row.path as string,
    body: JSON.parse((row.body as string) ?? "null"),
    idempotencyKey: row.idempotency_key as string,
    status: row.status as OutboxItem["status"],
    attempts: (row.attempts as number) ?? 0,
    queuedAt: row.queued_at as string,
    lastError: (row.last_error as string) ?? undefined,
  });

  return {
    async all() {
      const rows = await db.all<Record<string, unknown>>("SELECT * FROM outbox ORDER BY queued_at ASC");
      return rows.map(rowToItem);
    },
    async get(id) {
      const row = await db.get<Record<string, unknown>>("SELECT * FROM outbox WHERE id = ?", [id]);
      return row ? rowToItem(row) : undefined;
    },
    async put(item) {
      db.run(
        `INSERT INTO outbox (id, method, path, body, idempotency_key, status, attempts, queued_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           method=excluded.method, path=excluded.path, body=excluded.body,
           idempotency_key=excluded.idempotency_key, status=excluded.status,
           attempts=excluded.attempts, queued_at=excluded.queued_at, last_error=excluded.last_error`,
        [
          item.id,
          item.method,
          item.path,
          JSON.stringify(item.body),
          item.idempotencyKey,
          item.status,
          item.attempts,
          item.queuedAt,
          item.lastError ?? null,
        ],
      );
    },
    async delete(id) {
      db.run("DELETE FROM outbox WHERE id = ?", [id]);
    },
  };
}
