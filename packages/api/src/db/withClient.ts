// packages/api/src/db/withClient.ts
// Read-path helpers. `withClient` checks out a pooled client for a query that does not mutate
// state and always returns it. State-changing work uses transaction() from @fleet/db (D8).
//
// `withTenantClient` is the tenant-aware form and is what every authenticated read must use:
// it opens a transaction so `SET LOCAL app.current_tenant_id` actually applies (SET LOCAL outside
// a transaction block is a silent no-op, which would leave RLS with a NULL tenant and return zero
// rows), binds the tenant, runs the read, and always ROLLBACKs — a read never commits, and the
// rollback is what discards the GUC before the connection returns to the pool.

import type { DbClient, PoolLike, Principal } from "@fleet/shared";
import { isSystemAdmin } from "@fleet/shared";
import { applyTenantContext } from "@fleet/db";

export async function withClient<T>(pool: PoolLike, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release?.();
  }
}

/** Tenant binding for a read. Mirrors what the write path derives from the same Principal. */
export interface ReadTenantContext {
  tenantId: string;
  isSystemAdmin?: boolean;
}

/** Derives the DB tenant context from a verified Principal. The tenant is never request-supplied. */
export function tenantContextOf(principal: Pick<Principal, "tenantId" | "roles">): ReadTenantContext {
  return { tenantId: principal.tenantId, isSystemAdmin: isSystemAdmin(principal) };
}

/**
 * Runs a read with RLS bound to `ctx.tenantId`. Always rolls back, so the SET LOCAL cannot leak
 * onto the pooled connection.
 */
export async function withTenantClient<T>(
  pool: PoolLike,
  ctx: ReadTenantContext,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyTenantContext(client, ctx);
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release?.();
  }
}
