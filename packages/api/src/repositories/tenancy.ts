// packages/api/src/repositories/tenancy.ts
// Tenancy repositories (14_tenancy.sql). Parameterised SQL only; no business rules (06 §2).
//
// Two of these run BEFORE a tenant context exists:
//   * TenantRepository.findById / UserTenantRepository.findPrimaryTenantId are called during login,
//     when there is no principal yet. They read app.tenants / app.user_tenants, and app.user_tenants
//     is RLS-protected — so the login path binds the resolved tenant only afterwards. The lookup
//     itself is by primary key on a global identity table, which is why it is safe.
//
// Everything else takes an explicit tenantId and repeats it as `AND tenant_id = $n` even though RLS
// already constrains the rows. That redundancy is deliberate (defence in depth): if a connection is
// ever borrowed without the GUC applied, the query still cannot cross a tenant boundary.

import { BaseRepository } from "@fleet/db";
import type {
  DbClient,
  InvitationRow,
  ManagerAssignmentRow,
  RoleCode,
  TenantRow,
  UserRow,
} from "@fleet/shared";
import { BOOTSTRAP_TENANT_ID } from "@fleet/shared";

export class TenantRepository extends BaseRepository<TenantRow> {
  constructor(client: DbClient) {
    super(client, "app.tenants");
  }

  async findBySlug(slug: string): Promise<TenantRow | null> {
    const res = await this.client.query<TenantRow>(
      `SELECT * FROM app.tenants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [slug],
    );
    return res.rows[0] ?? null;
  }

  async create(input: {
    name: string;
    slug: string;
    status?: string;
    subscriptionTier?: string;
    maxVehicles?: number;
    maxDrivers?: number;
  }): Promise<TenantRow> {
    const res = await this.client.query<TenantRow>(
      `INSERT INTO app.tenants (name, slug, status, subscription_tier, max_vehicles, max_drivers)
       VALUES ($1, $2, COALESCE($3, 'TRIAL')::app.tenant_status,
               COALESCE($4, 'BASIC')::app.subscription_tier,
               COALESCE($5, 25), COALESCE($6, 50))
       RETURNING *`,
      [
        input.name,
        input.slug,
        input.status ?? null,
        input.subscriptionTier ?? null,
        input.maxVehicles ?? null,
        input.maxDrivers ?? null,
      ],
    );
    return res.rows[0] as TenantRow;
  }

  /** Quota check (app.tenants.max_vehicles / max_drivers) used before onboarding an asset. */
  async counts(tenantId: string): Promise<{ vehicles: number; drivers: number }> {
    const res = await this.client.query<{ vehicles: string; drivers: string }>(
      `SELECT (SELECT count(*) FROM app.vehicles WHERE tenant_id = $1 AND deleted_at IS NULL) AS vehicles,
              (SELECT count(*) FROM app.drivers  WHERE tenant_id = $1 AND deleted_at IS NULL) AS drivers`,
      [tenantId],
    );
    const row = res.rows[0];
    return { vehicles: Number(row?.vehicles ?? 0), drivers: Number(row?.drivers ?? 0) };
  }
}

export class UserTenantRepository {
  constructor(private readonly client: DbClient) {}

  /**
   * The tenant a user belongs to. Called during login, before any tenant GUC is set, so it must be
   * resilient: a user with no membership row (a legacy account, or a SYSTEM_ADMIN) resolves to the
   * bootstrap tenant, which is where every pre-tenancy row was back-filled.
   */
  async findPrimaryTenantId(userId: string): Promise<string> {
    const res = await this.client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM app.user_tenants
        WHERE user_id = $1
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1`,
      [userId],
    );
    return res.rows[0]?.tenant_id ?? BOOTSTRAP_TENANT_ID;
  }

  async link(userId: string, tenantId: string, isPrimary = true): Promise<void> {
    await this.client.query(
      `INSERT INTO app.user_tenants (user_id, tenant_id, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [userId, tenantId, isPrimary],
    );
  }

  /** Membership check used before any admin action targets another user. */
  async isMember(userId: string, tenantId: string): Promise<boolean> {
    const res = await this.client.query(
      `SELECT 1 FROM app.user_tenants WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
      [userId, tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export interface TenantUserSummary {
  user: UserRow;
  roles: RoleCode[];
  vehicle_ids: string[];
  driver_ids: string[];
}

export class InvitationRepository extends BaseRepository<InvitationRow> {
  constructor(client: DbClient) {
    super(client, "app.invitations", { deletedAtColumn: null });
  }

  async create(input: {
    tenantId: string;
    email: string;
    roleCode: RoleCode;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<InvitationRow> {
    // Re-inviting the same address supersedes the outstanding invitation rather than colliding on
    // the `invitations_pending_unique` partial index.
    await this.client.query(
      `UPDATE app.invitations
          SET revoked_at = now()
        WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [input.tenantId, input.email],
    );
    const res = await this.client.query<InvitationRow>(
      `INSERT INTO app.invitations (tenant_id, email, role_code, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.tenantId, input.email, input.roleCode, input.invitedBy, input.expiresAt],
    );
    return res.rows[0] as InvitationRow;
  }

  /**
   * Looks up a live invitation by token. Runs on the UNAUTHENTICATED accept path, so it cannot be
   * tenant-filtered — the token itself is the capability, and the row's tenant_id is what the
   * caller then trusts.
   */
  async findLiveByToken(token: string): Promise<InvitationRow | null> {
    const res = await this.client.query<InvitationRow>(
      `SELECT * FROM app.invitations
        WHERE token = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [token],
    );
    return res.rows[0] ?? null;
  }

  async markAccepted(invitationId: string, userId: string): Promise<void> {
    await this.client.query(
      `UPDATE app.invitations
          SET accepted_at = now(), accepted_user_id = $2
        WHERE id = $1 AND accepted_at IS NULL`,
      [invitationId, userId],
    );
  }

  async listPending(tenantId: string): Promise<InvitationRow[]> {
    // Explicit column list — the single-use `token` is the activation credential and must travel
    // ONLY by email (see the accept-invite contract), never in the pending-invitations response.
    const res = await this.client.query<InvitationRow>(
      `SELECT id, tenant_id, email, role_code, status, invited_by, expires_at, created_at
         FROM app.invitations
        WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return res.rows;
  }
}

export class ManagerAssignmentRepository extends BaseRepository<ManagerAssignmentRow> {
  constructor(client: DbClient) {
    super(client, "app.manager_assignments", { deletedAtColumn: null });
  }

  /**
   * Replaces the manager's scope for one dimension. `ids` is the complete desired set: rows not in
   * it are deleted, so an empty array clears the scope (= tenant-wide visibility).
   */
  async replaceVehicles(input: {
    tenantId: string;
    userId: string;
    vehicleIds: string[];
    assignedBy: string;
  }): Promise<void> {
    await this.client.query(
      `DELETE FROM app.manager_assignments
        WHERE tenant_id = $1 AND user_id = $2 AND vehicle_id IS NOT NULL
          AND NOT (vehicle_id = ANY($3::uuid[]))`,
      [input.tenantId, input.userId, input.vehicleIds],
    );
    if (input.vehicleIds.length === 0) return;
    // The vehicle subquery is tenant-filtered, so an id belonging to another tenant is silently
    // dropped rather than creating a cross-tenant assignment.
    await this.client.query(
      `INSERT INTO app.manager_assignments (tenant_id, user_id, vehicle_id, assigned_by)
       SELECT $1, $2, v.id, $4
         FROM app.vehicles v
        WHERE v.id = ANY($3::uuid[]) AND v.tenant_id = $1 AND v.deleted_at IS NULL
       ON CONFLICT (user_id, vehicle_id) WHERE vehicle_id IS NOT NULL DO NOTHING`,
      [input.tenantId, input.userId, input.vehicleIds, input.assignedBy],
    );
  }

  async replaceDrivers(input: {
    tenantId: string;
    userId: string;
    driverIds: string[];
    assignedBy: string;
  }): Promise<void> {
    // Both statements resolve the caller's ids through the same tenant-scoped subquery, which
    // matches on `drivers.id` OR `drivers.user_id`. The admin roster picker is seeded from
    // GET /drivers (keyed by users.id) while this column references app.drivers(id), so accepting
    // either identifier is what lets the mobile payload write through unchanged. Resolving in BOTH
    // the DELETE and the INSERT is essential: filtering the DELETE on the raw input would treat a
    // user_id as "not currently assigned" and wipe the row the INSERT is about to re-create.
    await this.client.query(
      `DELETE FROM app.manager_assignments ma
        WHERE ma.tenant_id = $1 AND ma.user_id = $2 AND ma.driver_id IS NOT NULL
          AND ma.driver_id NOT IN (
            SELECT d.id FROM app.drivers d
             WHERE (d.id = ANY($3::uuid[]) OR d.user_id = ANY($3::uuid[]))
               AND d.tenant_id = $1 AND d.deleted_at IS NULL
          )`,
      [input.tenantId, input.userId, input.driverIds],
    );
    if (input.driverIds.length === 0) return;
    await this.client.query(
      `INSERT INTO app.manager_assignments (tenant_id, user_id, driver_id, assigned_by)
       SELECT $1, $2, d.id, $4
         FROM app.drivers d
        WHERE (d.id = ANY($3::uuid[]) OR d.user_id = ANY($3::uuid[]))
          AND d.tenant_id = $1 AND d.deleted_at IS NULL
       ON CONFLICT (user_id, driver_id) WHERE driver_id IS NOT NULL DO NOTHING`,
      [input.tenantId, input.userId, input.driverIds, input.assignedBy],
    );
  }

  async listForUser(tenantId: string, userId: string): Promise<ManagerAssignmentRow[]> {
    const res = await this.client.query<ManagerAssignmentRow>(
      `SELECT * FROM app.manager_assignments
         WHERE tenant_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
      [tenantId, userId],
    );
    return res.rows;
  }

  /**
   * Resolves a desired set of vehicle/driver ids against the caller's tenant, matching the picker
   * semantics used elsewhere (driver ids may be `drivers.id` OR `drivers.user_id`). These back the
   * cross-tenant REJECT guard in `TenancyService.assign`, so the admin-assignment path shares the
   * same 409 behaviour as `POST /vehicles/{id}/assign` instead of silently dropping foreign ids.
   */
  async filterVehicleIdsInTenant(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.vehicles
         WHERE id = ANY($2::uuid[]) AND tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    return res.rows.map((r) => r.id);
  }

  async filterDriverIdsInTenant(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.drivers
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND (id = ANY($2::uuid[]) OR user_id = ANY($2::uuid[]))`,
      [tenantId, ids],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Widens every manager already scoped to `vehicleId` so the vehicles linked to it are in scope
   * too (`POST /vehicles/{id}/assign`). Whoever owns the tractor therefore also sees its trailers.
   *
   * Deliberately ADDITIVE: it never deletes, because the rows it touches belong to other managers
   * and a vehicle-level call must not silently rewrite an unrelated manager's scope. Managers with
   * no rows at all are untouched — in this model that already means tenant-wide visibility.
   */
  async linkVehiclesToVehicleOperators(input: {
    tenantId: string;
    vehicleId: string;
    linkedVehicleIds: string[];
    assignedBy: string;
  }): Promise<void> {
    if (input.linkedVehicleIds.length === 0) return;
    await this.client.query(
      `INSERT INTO app.manager_assignments (tenant_id, user_id, vehicle_id, assigned_by)
       SELECT DISTINCT $1, owner.user_id, v.id, $4
         FROM app.manager_assignments owner
         JOIN app.vehicles v
           ON v.id = ANY($3::uuid[]) AND v.tenant_id = $1 AND v.deleted_at IS NULL
        WHERE owner.tenant_id = $1 AND owner.vehicle_id = $2
       ON CONFLICT (user_id, vehicle_id) WHERE vehicle_id IS NOT NULL DO NOTHING`,
      [input.tenantId, input.vehicleId, input.linkedVehicleIds, input.assignedBy],
    );
  }
}

/** Read model for GET /admin/users: the tenant's users with their roles and assignment scope. */
export class TenantUserRepository {
  constructor(private readonly client: DbClient) {}

  async listUsers(input: {
    tenantId: string;
    roleCode?: RoleCode;
    status?: "ACTIVE" | "SUSPENDED";
    limit: number;
  }): Promise<TenantUserSummary[]> {
    const res = await this.client.query<
      Pick<
        UserRow,
        "id" | "email" | "full_name" | "phone" | "is_active" | "mfa_enabled" | "locale" | "created_at" | "updated_at" | "last_login_at"
      > & { role_codes: RoleCode[] | null; vehicle_ids: string[] | null; driver_ids: string[] | null }
    >(
      // Deliberately an explicit column list — never `u.*`. app.users carries `password_hash` and
      // `mfa_secret_encrypted`, which must never leave the response (a low-priv `user:read` holder,
      // e.g. AUDITOR, reaches this endpoint).
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.mfa_enabled, u.locale,
              u.created_at, u.updated_at, u.last_login_at,
              (SELECT array_agg(ur.role_code ORDER BY ur.role_code)
                 FROM app.user_roles ur WHERE ur.user_id = u.id) AS role_codes,
              (SELECT array_agg(ma.vehicle_id)
                 FROM app.manager_assignments ma
                WHERE ma.user_id = u.id AND ma.tenant_id = $1 AND ma.vehicle_id IS NOT NULL) AS vehicle_ids,
              (SELECT array_agg(ma.driver_id)
                 FROM app.manager_assignments ma
                WHERE ma.user_id = u.id AND ma.tenant_id = $1 AND ma.driver_id IS NOT NULL) AS driver_ids
         FROM app.users u
         JOIN app.user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
        WHERE u.deleted_at IS NULL
          AND ($2::app.role_code IS NULL
               OR EXISTS (SELECT 1 FROM app.user_roles ur2
                           WHERE ur2.user_id = u.id AND ur2.role_code = $2::app.role_code))
          AND ($3::boolean IS NULL OR u.is_active = $3::boolean)
        ORDER BY u.email ASC
        LIMIT $4`,
      [
        input.tenantId,
        input.roleCode ?? null,
        input.status === undefined ? null : input.status === "ACTIVE",
        input.limit,
      ],
    );

    return res.rows.map((row) => {
      const { role_codes, vehicle_ids, driver_ids, ...user } = row;
      return {
        user: user as UserRow,
        roles: role_codes ?? [],
        vehicle_ids: (vehicle_ids ?? []).filter((v): v is string => v !== null),
        driver_ids: (driver_ids ?? []).filter((v): v is string => v !== null),
      };
    });
  }
}

/** Role grant/revoke inside one tenant (user_roles.granted_by is the acting Admin). */
export class UserRoleRepository {
  constructor(private readonly client: DbClient) {}

  async grant(userId: string, roleCode: RoleCode, grantedBy: string): Promise<void> {
    await this.client.query(
      `INSERT INTO app.user_roles (user_id, role_code, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_code) DO NOTHING`,
      [userId, roleCode, grantedBy],
    );
  }

  async revoke(userId: string, roleCode: RoleCode): Promise<number> {
    const res = await this.client.query(
      `DELETE FROM app.user_roles WHERE user_id = $1 AND role_code = $2`,
      [userId, roleCode],
    );
    return res.rowCount ?? 0;
  }
}
