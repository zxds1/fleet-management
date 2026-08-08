// packages/shared/src/types/principal.ts
import type { PermissionCode, RoleCode } from "./db";

// Attached to the request by the auth middleware (02-auth.md §1).
// Drivers authenticate by phone; admins by email. `phone` is present for drivers,
// `email` for admins — at least one is always set.
export interface Principal {
  userId: string;
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
