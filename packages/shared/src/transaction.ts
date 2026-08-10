// packages/shared/src/transaction.ts
// Single-transaction-per-write primitive (D8). The outbox + audit are staged on the
// Tx and flushed just before COMMIT, so side effects are never lost if the process
// crashes between commit and dispatch (01-shared-kernel.md §4).

import { AppError } from "./errors";

// Minimal surface of a pg Pool / PoolClient we depend on. Keeps @fleet/shared free
// of a hard pg dependency; the real client satisfies this structurally.
export interface DbClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  // Present on a checked-out pooled client so the transaction runner can return it.
  release?(): void;
}

export interface OutboxEventInput {
  event_type: string;
  aggregate_type: string;
  aggregate_id?: string;
  payload: Record<string, unknown>;
  priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  available_at?: Date;
}

export interface AuditInput {
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "LOGIN"
    | "LOGIN_FAILED"
    | "LOGOUT"
    | "OVERRIDE"
    | "VERIFY"
    | "FLAG"
    | "UNLOCK_FOR_CORRECTION"
    | "QUARANTINE"
    | "LIFT_QUARANTINE"
    | "EXPORT"
    | "CONFIG_CHANGE"
    | "DEVICE_REVOKE"
    | "RECOVERY_MODE_ENABLE"
    | "RECOVERY_MODE_DISABLE"
    | "TENANT_CREATE"
    | "MEMBERSHIP_GRANT"
    | "MEMBERSHIP_REVOKE"
    | "INVITATION_CREATE"
    | "SCOPE_ASSIGN";
  entity_table: string;
  entity_schema?: string;
  entity_id?: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  changed_fields?: string[];
  reason?: string;
  endpoint?: string;
  http_method?: string;
  http_status?: number;
  // Stamped by the audit interceptor from the Principal + request (02 §1).
  actor_user_id?: string;
  actor_email?: string;
  actor_role_codes?: string[];
  on_behalf_of_driver_id?: string;
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
}

// Staged entries, flushed by the platform-provided transaction runner.
export interface Tx {
  client: DbClient;
  registerOutbox(ev: OutboxEventInput): void;
  audit(input: AuditInput): void;
}

export interface PoolLike {
  connect(): Promise<DbClient>;
}

export class TransactionError extends AppError {
  readonly httpStatus = 500;
  readonly error_code = "TRANSACTION_FAILED";
  constructor(detail: string, cause?: unknown) {
    super({ title: "Transaction failed", detail, cause });
  }
}

/**
 * Tenant binding for a transaction (14_tenancy.sql). When present, the runner issues
 * `SET LOCAL app.current_tenant_id` / `app.current_role` right after BEGIN so every statement is
 * covered by the `tenant_isolation` RLS policy.
 */
export interface TenantContextInput {
  tenantId: string;
  isSystemAdmin?: boolean;
}

// The real implementation lives in @fleet/db (opens BEGIN, applies the tenant GUCs, runs fn,
// flushes audit + outbox, COMMIT; rolls back on throw). Declared here as the contract.
export async function transaction<T>(
  pool: PoolLike,
  fn: (tx: Tx) => Promise<T>,
  tenant?: TenantContextInput,
): Promise<T> {
  throw new TransactionError("transaction() not bound; import the implementation from @fleet/db");
}
