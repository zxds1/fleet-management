// packages/shared/src/schemas/tenancy.ts
// Request validators for the multi-tenant admin surface (14_tenancy.sql). Mirrors
// api/openapi.yaml; the contract test fails the build if the two diverge.
//
// Note what is deliberately ABSENT from every schema here: a tenant id. The tenant is always
// taken from the authenticated Principal (JWT `tid`), never from the request, so a caller cannot
// invite into — or assign across — another tenant by crafting a body.

import { z } from "zod";

/**
 * `POST /admin/users/invite`. An ADMIN provisions a manager into their OWN tenant; the invitation
 * row carries the inviter's tenant and that is what binds the accepted account.
 */
export const InviteUserSchema = z.object({
  email: z.string().email().max(320),
  role_code: z.enum(["FLEET_MANAGER", "ADMIN"]),
  /** Optional display name pre-filled on the created account. */
  full_name: z.string().min(1).max(200).optional(),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

/**
 * `POST /auth/accept-invite`. Unauthenticated: the single-use token IS the credential. The new
 * user is created inside the inviting tenant and the role is granted with
 * `user_roles.granted_by = invitations.invited_by`.
 */
export const AcceptInviteSchema = z.object({
  token: z.string().uuid(),
  password: z.string().min(12).max(200),
  full_name: z.string().min(1).max(200).optional(),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

/** `POST /admin/users/{id}/roles/revoke`. Removes one role from a user in the caller's tenant. */
export const RevokeRoleSchema = z.object({
  role_code: z.enum(["DRIVER", "DISPATCHER", "FLEET_MANAGER", "ADMIN", "FINANCE", "AUDITOR"]),
});
export type RevokeRoleInput = z.infer<typeof RevokeRoleSchema>;

/**
 * `POST /admin/users/{id}/assign`. Replaces the manager's vehicle/driver scope. An empty array
 * clears that dimension; omitting a key leaves it untouched.
 */
export const AssignScopeSchema = z
  .object({
    vehicle_ids: z.array(z.string().uuid()).max(500).optional(),
    driver_ids: z.array(z.string().uuid()).max(500).optional(),
  })
  .refine((v) => v.vehicle_ids !== undefined || v.driver_ids !== undefined, {
    message: "Provide vehicle_ids, driver_ids, or both",
  });
export type AssignScopeInput = z.infer<typeof AssignScopeSchema>;

/** `GET /admin/users` filter. Cursor pagination is handled by the shared cursor envelope (D7). */
export const ListUsersQuerySchema = z.object({
  role_code: z
    .enum(["DRIVER", "DISPATCHER", "FLEET_MANAGER", "ADMIN", "FINANCE", "AUDITOR", "SYSTEM_ADMIN"])
    .optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/**
 * `POST /auth/signup`. Unauthenticated self-service onboarding: creates a company (tenant) and its
 * FIRST member, who becomes a tenant-scoped ADMIN — the company super-admin. That ADMIN sees the
 * whole company and can invite further ADMIN / FLEET_MANAGER users through the normal invite flow.
 *
 * Note there is no `role_code` and no tenant id here: the role is fixed to ADMIN by the server and
 * the tenant is the one it just created, so signup can never be used to join an existing company.
 */
export const SignupSchema = z.object({
  company_name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  password: z.string().min(12).max(200),
  full_name: z.string().min(1).max(200).optional(),
});
export type SignupInput = z.infer<typeof SignupSchema>;

/** Tenant registry write, restricted to SYSTEM_ADMIN. */
export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  subscription_tier: z.enum(["BASIC", "PROFESSIONAL", "ENTERPRISE"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL", "EXPIRED"]).optional(),
  max_vehicles: z.number().int().positive().max(1_000_000).optional(),
  max_drivers: z.number().int().positive().max(1_000_000).optional(),
});
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

/** Response shape for an outstanding invitation (`app.invitations`). Mirrors api/openapi.yaml. */
export const InvitationSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  email: z.string().email(),
  role_code: z.enum(["DRIVER", "DISPATCHER", "FLEET_MANAGER", "ADMIN", "FINANCE", "AUDITOR", "SYSTEM_ADMIN"]),
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]),
  invited_by: z.string().uuid().nullable().optional(),
  expires_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

/** Response shape for `GET /admin/users` (tenant members with roles + scope). Mirrors api/openapi.yaml. */
export const TenantUserSummarySchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  roles: z.array(z.string()),
  assigned_vehicle_ids: z.array(z.string().uuid()).optional(),
  assigned_driver_ids: z.array(z.string().uuid()).optional(),
});
export type TenantUserSummary = z.infer<typeof TenantUserSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Scope-aware analytics (`/analytics/*`, aliased at `/reports/*`).
//
// Every response below is already narrowed to what the CALLER may see. The scope is derived from
// the Principal (roles + app.manager_assignments), never from the request, so the same URL returns
// company-wide figures to an ADMIN and only the assigned slice to a FLEET_MANAGER.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Common date-range filter for every analytics GET. Defaults to the trailing 30 days. */
export const AnalyticsRangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsRangeQuery = z.infer<typeof AnalyticsRangeQuerySchema>;

/** Headline counters shared by every analytics node (company, manager, vehicle, driver). */
export const AnalyticsKpisSchema = z.object({
  vehicles: z.number(),
  drivers: z.number(),
  distanceKm: z.number(),
  fuelCost: z.number(),
  anomalies: z.number(),
});
export type AnalyticsKpis = z.infer<typeof AnalyticsKpisSchema>;

/** One manager row inside `GET /analytics/company`, with the scope that produced its KPIs. */
export const ManagerAnalyticsSummarySchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  /** `null` = unrestricted on that dimension (the manager sees the whole company). */
  assignedVehicleIds: z.array(z.string().uuid()).nullable(),
  assignedDriverIds: z.array(z.string().uuid()).nullable(),
  kpis: AnalyticsKpisSchema,
});
export type ManagerAnalyticsSummary = z.infer<typeof ManagerAnalyticsSummarySchema>;

/** Per-vehicle breakdown row. `utilisationPct` = share of days in range with a shift. */
export const VehicleAnalyticsSchema = z.object({
  vehicle_id: z.string().uuid(),
  plate: z.string().nullable(),
  distanceKm: z.number(),
  fuelCost: z.number(),
  utilisationPct: z.number(),
  anomalies: z.number(),
});
export type VehicleAnalytics = z.infer<typeof VehicleAnalyticsSchema>;

/** Per-driver breakdown row. */
export const DriverAnalyticsSchema = z.object({
  driver_id: z.string().uuid(),
  name: z.string().nullable(),
  distanceKm: z.number(),
  shifts: z.number(),
  anomalies: z.number(),
});
export type DriverAnalytics = z.infer<typeof DriverAnalyticsSchema>;

/**
 * `GET /analytics/company`. The company roll-up plus one row per FLEET_MANAGER. The legacy
 * `/reports/analytics` counters (active_fleet, fuel_spend_30d, …) are carried alongside so the
 * existing mobile `AnalyticsReportSchema` parses this body unchanged.
 */
export const CompanyAnalyticsSchema = z.object({
  tenant_id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  kpis: AnalyticsKpisSchema,
  managers: z.array(ManagerAnalyticsSummarySchema),
  // Flat mirror of the mobile AnalyticsReportSchema (packages/mobile/src/core/admin.ts).
  active_fleet: z.number(),
  open_accidents: z.number(),
  pending_dvir: z.number(),
  expiring_docs: z.number(),
  fuel_spend_30d: z.number(),
  anomalies_open: z.number(),
});
export type CompanyAnalytics = z.infer<typeof CompanyAnalyticsSchema>;

/** `GET /analytics/manager/{userId}`. One manager's slice, expanded per vehicle and per driver. */
export const ManagerAnalyticsSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  from: z.string(),
  to: z.string(),
  assignedVehicleIds: z.array(z.string().uuid()).nullable(),
  assignedDriverIds: z.array(z.string().uuid()).nullable(),
  kpis: AnalyticsKpisSchema,
  vehicles: z.array(VehicleAnalyticsSchema),
  drivers: z.array(DriverAnalyticsSchema),
});
export type ManagerAnalytics = z.infer<typeof ManagerAnalyticsSchema>;

/** `GET /analytics/vehicle/{vehicleId}`. */
export const VehicleAnalyticsDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  vehicle: VehicleAnalyticsSchema,
  kpis: AnalyticsKpisSchema,
});
export type VehicleAnalyticsDetail = z.infer<typeof VehicleAnalyticsDetailSchema>;

/** `GET /analytics/driver/{driverId}` and `GET /analytics/me`. */
export const DriverAnalyticsDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  driver: DriverAnalyticsSchema,
  kpis: AnalyticsKpisSchema,
});
export type DriverAnalyticsDetail = z.infer<typeof DriverAnalyticsDetailSchema>;
