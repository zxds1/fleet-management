/**
 * Role and permission model, mirrored from `fleet-management/packages/shared/src/types/db.ts`
 * (generated from `db/schema` + `db/seed/01_seed.sql`) and
 * `packages/api/src/middleware/requirePermission.ts`.
 *
 * Authorisation on the server is the UNION of every role's grants (`requirePermission` passes when
 * `codes.some(...)`), so the client mirrors that: `can()` is a strict set lookup against the
 * `permissions` array the login/refresh response returns in its body (the trusted response, not the
 * decoded token — see the `sessionBody` in `packages/api/src/http/routes/auth.ts`).
 */
import { z } from 'zod';

export const RoleCode = z.enum([
  'DRIVER',
  'DISPATCHER',
  'FLEET_MANAGER',
  'ADMIN',
  'FINANCE',
  'AUDITOR',
  'SYSTEM_ADMIN',
]);
export type RoleCode = z.infer<typeof RoleCode>;

export const PermissionCode = z.enum([
  'accident:acknowledge',
  'accident:close',
  'accident:read',
  'accident:report',
  'accident:update',
  'asset:create',
  'asset:lift_quarantine',
  'asset:quarantine',
  'asset:read',
  'asset:update',
  'assignment:create',
  'assignment:read',
  'assignment:update',
  'audit:read',
  'config:manage',
  'config:read',
  'device:revoke',
  'document:manage',
  'document:read',
  'expense:approve',
  'expense:read',
  'expense:submit',
  'fuel:adjust',
  'fuel:card_manage',
  'fuel:clear_payment',
  'fuel:read',
  'fuel:reconcile',
  'fuel:record_gauge',
  'fuel:submit_purchase',
  'fuel:verify',
  'geofence:manage',
  'geofence:read',
  'hos:override',
  'hos:read',
  'inspection:read',
  'inspection:submit',
  'inspection:template_manage',
  'maintenance:manage',
  'maintenance:read',
  'maintenance:record',
  'manage_own_mfa',
  'revoke_device',
  'notification:manage',
  'payroll:export',
  'recovery:manage',
  'report:export',
  'report:read',
  'role:manage',
  'shift:clock_in',
  'shift:clock_out',
  'shift:flag',
  'shift:force_close',
  'shift:read_all',
  'shift:read_own',
  'shift:unlock',
  'shift:verify',
  'telemetry:read_history',
  'telemetry:read_live',
  'trailer:swap',
  'user:manage',
  'user:read',
  'anomaly:read',
  'notification:read',
  'training:read',
  'training:manage',
  'training:complete',
  'training:review',
  'onboarding:read',
  'onboarding:submit',
  'onboarding:review',
  'vehicle:report',
  'privacy:request_own',
  'privacy:view_requests_tenant',
]);
export type PermissionCode = z.infer<typeof PermissionCode>;

export const PERMISSION_CODES = PermissionCode.options;

/**
 * What the app knows about the signed-in person. Built from the login / MFA-verify / refresh
 * response body, never from an unverified token.
 */
export interface Principal {
  user_id: string;
  tenant_id: string | null;
  email: string | null;
  phone: string | null;
  roles: readonly RoleCode[];
  locale: 'en' | 'sw';
  session_id: string | null;
  /**
   * The server's precomputed permission union. `null` means the response did not carry it, in which
   * case the client shows the control and lets the endpoint's 403 decide rather than hiding
   * something the person is allowed to do. When the list IS present the check is strict.
   */
  permissions: ReadonlySet<string> | null;
}

export function can(p: Principal | null, code: PermissionCode): boolean {
  if (!p) return false;
  return p.permissions === null ? true : p.permissions.has(code);
}

/** True when the person holds every one of the codes (the server accepts "any of", so use with care). */
export function canAll(p: Principal | null, codes: readonly PermissionCode[]): boolean {
  return codes.every((c) => can(p, c));
}

export interface SessionIdentityBody {
  user_id: string;
  tenant_id?: string | null;
  email?: string | null;
  phone?: string | null;
  roles?: unknown;
  permissions?: unknown;
  locale?: unknown;
  session_id?: string | null;
}

/** Builds the app's Principal from the trusted session body the API returns. */
export function principalFromSessionBody(
  body: SessionIdentityBody | null | undefined,
  fallbackRoles: readonly string[] = [],
): Principal | null {
  if (!body || typeof body.user_id !== 'string' || body.user_id.length === 0) return null;
  const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is RoleCode => typeof r === 'string') : [];
  const permissions = Array.isArray(body.permissions)
    ? new Set(body.permissions.filter((x): x is string => typeof x === 'string'))
    : null;
  return {
    user_id: body.user_id,
    tenant_id: typeof body.tenant_id === 'string' ? body.tenant_id : null,
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    roles: roles.length ? roles : (fallbackRoles as RoleCode[]),
    locale: body.locale === 'sw' ? 'sw' : 'en',
    session_id: typeof body.session_id === 'string' ? body.session_id : null,
    permissions,
  };
}

/**
 * Access-token claims (mirrors `AccessTokenClaims` in `packages/api/src/security/tokens.ts`). The
 * app does NOT authorise from these; they are read only for the channel scope and the queue owner.
 */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  tid: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  sid: string;
  locale: 'en' | 'sw';
  /** device_id_hash (the driver PIN offline path, B12). */
  dev?: string;
  iat?: number;
  exp?: number;
}