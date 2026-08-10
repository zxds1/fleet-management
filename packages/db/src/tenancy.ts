// packages/db/src/tenancy.ts
// Binds a database session to one tenant (db/schema/14_tenancy.sql).
//
// The `tenant_isolation` RLS policy reads two GUCs:
//   app.current_tenant_id  → the tenant whose rows this session may touch
//   app.current_role       → 'SYSTEM_ADMIN' bypasses isolation entirely
//
// Both are set with SET LOCAL, so they are scoped to the surrounding transaction and are
// discarded on COMMIT/ROLLBACK. That matters for a pooled connection: a leaked GUC would hand the
// next borrower of that connection another tenant's visibility. SET LOCAL makes that impossible.
//
// On the read path (no explicit transaction) the caller must open one — see `withTenantClient` in
// the API — because SET LOCAL outside a transaction block is a no-op and would silently leave RLS
// with a NULL tenant, i.e. zero rows.
//
// SET LOCAL does not accept bind parameters, so `set_config(name, value, is_local => true)` is
// used instead: it is the parameterised equivalent and keeps the value off the SQL string.

import type { DbClient } from "@fleet/shared";
import { ROLE_GUC, SYSTEM_ADMIN_ROLE, TENANT_GUC, assertTenantId } from "@fleet/shared";

export interface TenantContext {
  tenantId: string;
  /** True only for a verified SYSTEM_ADMIN principal; enables the RLS bypass. */
  isSystemAdmin?: boolean;
}

/**
 * Applies the tenant context to `client` for the remainder of the current transaction.
 * Must be called AFTER BEGIN and BEFORE any domain query.
 */
export async function applyTenantContext(client: DbClient, ctx: TenantContext): Promise<void> {
  const tenantId = assertTenantId(ctx.tenantId);
  await client.query(`SELECT set_config($1, $2, true)`, [TENANT_GUC, tenantId]);
  await client.query(`SELECT set_config($1, $2, true)`, [
    ROLE_GUC,
    ctx.isSystemAdmin ? SYSTEM_ADMIN_ROLE : "",
  ]);
}

/**
 * Clears the tenant context. Only needed on a connection that is being returned to the pool
 * outside a transaction; inside one, COMMIT/ROLLBACK already discards the SET LOCAL.
 */
export async function clearTenantContext(client: DbClient): Promise<void> {
  await client.query(`SELECT set_config($1, '', true)`, [TENANT_GUC]);
  await client.query(`SELECT set_config($1, '', true)`, [ROLE_GUC]);
}
