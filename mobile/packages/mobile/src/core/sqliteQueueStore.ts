import * as SQLite from 'expo-sqlite';
import type { QueuedWrite, QueueStatus, QueueStore } from './offlineQueue';
import { RESET_AFTER_DAYS } from './policy';

type Row = Omit<QueuedWrite, 'body' | 'uploads' | 'produces' | 'needs' | 'response'> & { body: string; uploads: string; produces: string | null; needs: string; response: string | null };
const hydrate = (r: Row): QueuedWrite => ({ ...r, body: JSON.parse(r.body), uploads: JSON.parse(r.uploads), produces: r.produces ? JSON.parse(r.produces) : null, needs: JSON.parse(r.needs), response: r.response ? JSON.parse(r.response) : null });
const JSON_COLS = new Set(['body', 'uploads', 'produces', 'needs', 'response']);

export async function openSqliteQueueStore(): Promise<QueueStore> {
  const db = await SQLite.openDatabaseAsync('helix_queue.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA user_version = 1;   -- schema version marker; bump and add a migration before changing any column
    CREATE TABLE IF NOT EXISTS offline_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      method TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      uploads TEXT NOT NULL DEFAULT '[]', produces TEXT, needs TEXT NOT NULL DEFAULT '[]', response TEXT,
      error_code TEXT, error_message TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON offline_queue(status, id);
    CREATE TABLE IF NOT EXISTS queue_refs (token TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  // A-05: an install that was never opened for months must not come back to an Outbox full of writes that
  // were already delivered (or rejected) long ago, so anything older than the reset window is dropped.
  // DONE / DISCARDED rows are the ones that pile up; PENDING and FAILED_REVIEW rows are kept so a real
  // unsent write is never silently destroyed.
  const cutoff = Date.now() - RESET_AFTER_DAYS * 86_400_000;
  await db.runAsync(`DELETE FROM offline_queue WHERE updated_at < ? AND status IN ('DONE', 'DISCARDED')`, [cutoff]);
  return {
    async insert(w) {
      const r = await db.runAsync(
        `INSERT INTO offline_queue (idempotency_key, method, path, body, status, attempts, uploads, produces, needs, response, error_code, error_message, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [w.idempotency_key, w.method, w.path, JSON.stringify(w.body), w.status, w.attempts, JSON.stringify(w.uploads), w.produces ? JSON.stringify(w.produces) : null, JSON.stringify(w.needs), w.response == null ? null : JSON.stringify(w.response), w.error_code, w.error_message, w.created_at, w.updated_at]);
      return r.lastInsertRowId;
    },
    async get(id) { const r = await db.getFirstAsync<Row>('SELECT * FROM offline_queue WHERE id = ?', [id]); return r ? hydrate(r) : null; },
    async list(s: QueueStatus[]) {
      const rows = await db.getAllAsync<Row>(`SELECT * FROM offline_queue WHERE status IN (${s.map(() => '?').join(',')}) ORDER BY id ASC`, s);
      return rows.map(hydrate);
    },
    async update(id, p) {
      const cols = Object.keys(p) as (keyof typeof p)[];
      if (!cols.length) return;
      const vals = cols.map((c) => (JSON_COLS.has(c) ? (p[c] == null ? null : JSON.stringify(p[c])) : (p[c] as string | number | null)));
      await db.runAsync(`UPDATE offline_queue SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...vals, id]);
    },
    async remove(id) { await db.runAsync('DELETE FROM offline_queue WHERE id = ?', [id]); },
    async clear() { await db.runAsync('DELETE FROM offline_queue'); await db.runAsync('DELETE FROM queue_refs'); },
    async getRefs() { const rows = await db.getAllAsync<{ token: string; value: string }>('SELECT token, value FROM queue_refs'); return Object.fromEntries(rows.map((r) => [r.token, r.value])); },
    async setRef(token, value) { await db.runAsync('INSERT OR REPLACE INTO queue_refs (token, value) VALUES (?, ?)', [token, value]); },
  };
}
