// packages/db/src/tx.ts
// Concrete Tx: buffers audit + outbox entries until the transaction runner flushes
// them just before COMMIT (D8). Repositories run their SQL through `client`.

import type { AuditInput, DbClient, OutboxEventInput, Tx } from "@fleet/shared";

export class PgTx implements Tx {
  public readonly outboxEvents: OutboxEventInput[] = [];
  public readonly auditEntries: AuditInput[] = [];

  constructor(public readonly client: DbClient) {}

  registerOutbox(ev: OutboxEventInput): void {
    this.outboxEvents.push(ev);
  }

  audit(input: AuditInput): void {
    this.auditEntries.push(input);
  }
}
