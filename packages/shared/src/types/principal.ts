// packages/shared/src/types/principal.ts
import type { PermissionCode, RoleCode } from "./db";

// Attached to the request by the auth middleware (02-auth.md §1).
// Drivers authenticate by phone; admins by email. `phone` is present for drivers,
// `email` for admins — at least one is always set.
export interface Principal {
  userId: string;
  /**
   * Owning tenant, resolved at login from app.user_tenants and carried in the JWT `tid` claim
   * (14_tenancy.sql). It is NEVER read from a request body, header or query string: every
   * tenant-scoped query and every `SET LOCAL app.current_tenant_id` derives from this field.
   * A SYSTEM_ADMIN carries the bootstrap tenant here and bypasses RLS via `isSystemAdmin`.
   */
  tenantId: string;
  email: string;
  phone?: string;
  roles: RoleCode[];
  permissions: Set<PermissionCode>; // precomputed union (N4/C6.2)
  deviceIdHash?: string; // present when a device is registered (push); not used for authz
  sessionId?: string;
  locale: "en" | "sw";
}

export function hasPermission(p: Principal, code: PermissionCode): boolean {
  return p.permissions.has(code);
}

/**
 * Cross-tenant platform operator. This is the ONLY thing that may relax tenant isolation, and it
 * is derived from the verified JWT roles — never from a request field.
 */
export function isSystemAdmin(p: Pick<Principal, "roles">): boolean {
  return p.roles.includes("SYSTEM_ADMIN");
}
