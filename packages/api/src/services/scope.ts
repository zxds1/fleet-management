// packages/api/src/services/scope.ts
// Hierarchical read scope for the analytics surface (14_tenancy.sql).
//
// RLS already fences every query to `app.current_tenant_id`, which answers "which company?". This
// answers the narrower question RLS cannot: "which slice of that company may THIS principal see?".
// The two are layered — the resolved scope is applied as an explicit `IN (...)` on top of RLS, so a
// FLEET_MANAGER cannot widen their view even if the GUC were ever mis-bound.
//
// The scope is derived exclusively from the verified Principal (roles) plus the server-side
// assignment table. Nothing here is influenced by a request body, header or query string.

import type { DbClient, Principal } from "@fleet/shared";
import { isSystemAdmin } from "@fleet/shared";

/**
 * A resolved read scope.
 *
 * `null` on a dimension means UNRESTRICTED for that dimension (every vehicle / every driver in the
 * tenant), while an EMPTY ARRAY means "nothing" — a manager with no assignments legitimately sees
 * no data. That distinction is the whole point of the nullable type: collapsing the two would
 * silently promote an unassigned manager to company-wide visibility.
 */
export interface ResolvedScope {
  tenant_id: string;
  vehicle_ids: string[] | null;
  driver_ids: string[] | null;
  /** True when the caller sees the whole company (ADMIN, or the cross-tenant SYSTEM_ADMIN). */
  isCompanyAdmin: boolean;
}

/**
 * Maps raw `app.manager_assignments` rows to a ResolvedScope — the SINGLE source of truth for the
 * "null = unrestricted, [] = nothing" rule. `resolveScope` (the live query), `scopeOfManager` (the
 * analytics drill-down) and `managerSummaries` (the company roll-up) must ALL go through this so the
 * three paths can never disagree on what an unassigned or single-axis manager may see.
 *
 * The rule for "no assignments": judged on `res.rows.length` (any row, even one with a null subject),
 * NOT on whether the aggregated id arrays are non-empty. That keeps a manager holding only
 * null-subject rows consistent across every path instead of flipping from `[]` (nothing) in one to
 * `null` (everything) in another.
 */
export function scopeFromAssignmentRows(
  tenantId: string,
  rows: { vehicle_id: string | null; driver_id: string | null }[],
): ResolvedScope {
  if (rows.length === 0) {
    // An unscoped manager sees NOTHING, never the whole company (fail closed).
    return { tenant_id: tenantId, vehicle_ids: [], driver_ids: [], isCompanyAdmin: false };
  }
  const vehicles = rows.map((r) => r.vehicle_id).filter((v): v is string => v !== null);
  const drivers = rows.map((r) => r.driver_id).filter((v): v is string => v !== null);
  // A manager scoped on one axis only inherits the other axis in full: the assignment expressed
  // "these vehicles, any driver" (or vice versa), so the un-set axis stays `null` (unrestricted).
  return {
    tenant_id: tenantId,
    vehicle_ids: vehicles.length > 0 ? vehicles : null,
    driver_ids: drivers.length > 0 ? drivers : null,
    isCompanyAdmin: false,
  };
}

/**
 * Resolves what `principal` may read.
 *
 *  - SYSTEM_ADMIN   → everything, across tenants (RLS bypass is applied separately, at the client).
 *  - ADMIN          → the whole tenant: both dimensions unrestricted, `isCompanyAdmin`.
 *  - FLEET_MANAGER  → the union of their `app.manager_assignments` rows (via scopeFromAssignmentRows).
 *  - DRIVER         → their own driver row only.
 *  - anything else  → nothing.
 */
export async function resolveScope(client: DbClient, principal: Principal): Promise<ResolvedScope> {
  const tenant_id = principal.tenantId;

  if (isSystemAdmin(principal)) {
    return { tenant_id, vehicle_ids: null, driver_ids: null, isCompanyAdmin: true };
  }

  if (principal.roles.includes("ADMIN")) {
    return { tenant_id, vehicle_ids: null, driver_ids: null, isCompanyAdmin: true };
  }

  if (principal.roles.includes("FLEET_MANAGER")) {
    const res = await client.query<{ vehicle_id: string | null; driver_id: string | null }>(
      `SELECT vehicle_id, driver_id
          FROM app.manager_assignments
         WHERE user_id = $1 AND tenant_id = $2`,
      [principal.userId, tenant_id],
    );
    return scopeFromAssignmentRows(tenant_id, res.rows);
  }

  if (principal.roles.includes("DRIVER")) {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM app.drivers
        WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [principal.userId, tenant_id],
    );
    const driverId = res.rows[0]?.id;
    return {
      tenant_id,
      // A driver's vehicle view follows the shifts they actually drove, which the queries derive
      // from `driver_ids`; pinning a vehicle list here would hide co-driven vehicles.
      vehicle_ids: null,
      driver_ids: driverId ? [driverId] : [],
      isCompanyAdmin: false,
    };
  }

  return { tenant_id, vehicle_ids: [], driver_ids: [], isCompanyAdmin: false };
}
