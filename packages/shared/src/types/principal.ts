// packages/shared/src/types/principal.ts
import type { PermissionCode, RoleCode } from "./db";

// Attached to the request by the auth middleware (02-auth.md §1).
export interface Principal {
  userId: string;
  email: string;
  roles: RoleCode[];
  permissions: Set<PermissionCode>; // precomputed union (N4/C6.2)
  deviceIdHash?: string; // present for the driver PIN path (B12)
  sessionId?: string;
  locale: "en" | "sw";
}

export function hasPermission(p: Principal, code: PermissionCode): boolean {
  return p.permissions.has(code);
}
