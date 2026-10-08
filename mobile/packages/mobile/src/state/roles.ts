import type { PermissionCode, Principal, RoleCode } from '@fleet/shared';
import { can } from '@fleet/shared';

/**
 * Role and permission helpers with NO other imports.
 *
 * This exists so `push.ts` can read the active role without importing the store: the store pulls in
 * services, which pull in push, and a cycle there would be a runtime trap rather than a compile error.
 * The authoritative values live in the store; this file only defines the shape and the pure logic.
 */

export const ADMIN_ROLES: readonly string[] = ['ADMIN', 'FLEET_MANAGER', 'DISPATCHER', 'FINANCE', 'AUDITOR', 'SYSTEM_ADMIN'];

/** The two shipped experiences. Presentation only — never an authorisation input. */
export type Role = 'DRIVER' | 'ADMIN';

/** Key the chosen experience is persisted under, so it survives a relaunch (ledger B-11). */
export const ROLE_KEY = 'active_role';

/** The experience to open for a set of roles, or null when the choice must be made by the person. */
export function initialRoleFor(roles: readonly string[]): Role | null {
  const admin = roles.some((r) => ADMIN_ROLES.includes(r));
  const driver = roles.includes('DRIVER');
  if (admin && driver) return null;
  return admin ? 'ADMIN' : driver ? 'DRIVER' : null;
}

/** Whether the chosen experience is still valid for the roles the session actually has. */
export function isRoleAllowed(role: Role, roles: readonly string[]): boolean {
  return role === 'DRIVER' ? roles.includes('DRIVER') : roles.some((r) => ADMIN_ROLES.includes(r));
}

/** UI gate for a control, using the permission the endpoint's `requirePermission` enforces. */
export const useCan = (principal: Principal | null, code: PermissionCode): boolean => can(principal, code);

export type { PermissionCode, Principal, RoleCode };