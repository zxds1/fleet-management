// packages/db/src/transaction.ts
// Real transaction runner (D8). Opens BEGIN, runs fn(tx), flushes the staged audit +
// outbox rows, then COMMIT. On throw: ROLLBACK, wrap in TransactionError, and always
// release the client. The shared stub is replaced by this implementation at runtime.
//
// Target tables are the authoritative DDL ones: audit.audit_logs (append-only, yearly
// partitions, C6.5) and app.outbox_events (D8).

import type { PoolLike, TransactionError, Tx } from "@fleet/shared";
import { TransactionError as SharedTransactionError } from "@fleet/shared";
import { PgTx } from "./tx";

const INSERT_AUDIT = `
  INSERT INTO audit.audit_logs
    (occurred_at, actor_user_id, actor_email, actor_role_codes, on_behalf_of_driver_id,
     action, entity_schema, entity_table, entity_id,
     old_value, new_value, changed_fields,
     reason, ip_address, user_agent, request_id, endpoint, http_method, http_status)
  VALUES (now(), $1, $2, COALESCE($3::text[], '{}'), $4,
          $5, COALESCE($6, 'app'), $7, $8,
          $9::jsonb, $10::jsonb, $11::text[],
          $12, $13, $14, $15, $16, $17, $18)`;

const INSERT_OUTBOX = `
  INSERT INTO app.outbox_events
    (event_type, aggregate_type, aggregate_id, payload, priority, occurred_at, available_at)
  VALUES ($1, $2, $3, $4::jsonb, $5, now(), COALESCE($6, now()))`;

export async function transaction<T>(pool: PoolLike, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = new PgTx(client);
    const result = await fn(tx);

    for (const a of tx.auditEntries) {
      await client.query(INSERT_AUDIT, [
        a.actor_user_id ?? null,
        a.actor_email ?? null,
        a.actor_role_codes ?? null,
        a.on_behalf_of_driver_id ?? null,
        a.action,
        a.entity_schema ?? null,
        a.entity_table,
        a.entity_id ?? null,
        a.old_value == null ? null : JSON.stringify(a.old_value),
        a.new_value == null ? null : JSON.stringify(a.new_value),
        a.changed_fields ?? null,
        a.reason ?? null,
        a.ip_address ?? null,
        a.user_agent ?? null,
        a.request_id ?? null,
        a.endpoint ?? null,
        a.http_method ?? null,
        a.http_status ?? null,
      ]);
    }

    for (const ev of tx.outboxEvents) {
      await client.query(INSERT_OUTBOX, [
        ev.event_type,
        ev.aggregate_type,
        ev.aggregate_id ?? null,
        ev.payload == null ? "{}" : JSON.stringify(ev.payload),
        ev.priority ?? "NORMAL",
        ev.available_at ?? null,
      ]);
    }

    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (e instanceof SharedTransactionError) throw e;
    if (e instanceof Error) throw new SharedTransactionError(e.message, e);
    throw new SharedTransactionError("transaction failed", e);
  } finally {
    client.release?.();
  }
}

export type { TransactionError };
