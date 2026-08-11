// packages/api/src/services/tenancy.ts
// Tenant provisioning + RBAC administration (14_tenancy.sql).
//
// The invariant every method here upholds: the tenant comes from the CALLER's Principal, never
// from the request. An ADMIN can only invite into, assign within, and revoke inside their own
// tenant. Cross-tenant reach is reserved for SYSTEM_ADMIN, which is checked explicitly.

import {
  ConflictError,
  Forbidden,
  NotFound,
  ValidationError,
  err,
  ok,
  logger,
  type AdminSummary,
  type DbClient,
  type Result,
  type RoleCode,
  type InvitationRow,
} from "@fleet/shared";
import { applyTenantContext } from "@fleet/db";
import { argon2idHasher } from "../security/passwords";
import type {
  InvitationRepository,
  ManagerAssignmentRepository,
  TenantRepository,
  TenantUserRepository,
  TenantUserSummary,
  UserRoleRepository,
  UserTenantRepository,
} from "../repositories/tenancy";
import type { UserRepository } from "../repositories/identity";
import type { EmailService } from "./email";

/** Roles an ADMIN may hand out through the invite flow. SYSTEM_ADMIN is deliberately excluded. */
const INVITABLE_ROLES: ReadonlySet<string> = new Set(["FLEET_MANAGER", "ADMIN"]);

/** Roles that make a user an "admin/manager" for the `GET /admin/managers` roster. */
const MANAGER_ROLES: ReadonlySet<string> = new Set(["FLEET_MANAGER", "ADMIN", "SYSTEM_ADMIN"]);

/**
 * Projects a `TenantUserSummary` onto the mobile `AdminSummary` field names
 * (packages/mobile/src/core/admin.ts). `status` is derived from `users.is_active`, which is the
 * same derivation the driver roster uses, so the two admin surfaces agree.
 */
export function toAdminSummary(row: TenantUserSummary): AdminSummary {
  return {
    user_id: row.user.id,
    email: row.user.email ?? null,
    full_name: row.user.full_name ?? null,
    roles: row.roles,
    status: row.user.is_active ? "ACTIVE" : "SUSPENDED",
    assigned_vehicle_ids: row.vehicle_ids,
    assigned_driver_ids: row.driver_ids,
  };
}

/**
 * Turns a company name into a slug candidate: lowercase, alphanumerics and dashes only, collapsed
 * and trimmed. `app.tenants.slug` is CHECKed against `^[a-z0-9][a-z0-9-]{1,62}$`, so the result is
 * padded when a name degenerates to fewer than two characters (e.g. a purely non-latin name).
 */
export function slugifyCompanyName(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base.length >= 2 ? base : `company-${base}`.replace(/-+$/, "");
}

export interface SignupResult {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  roleCode: RoleCode;
}


export interface InviteResult {
  invitationId: string;
  email: string;
  roleCode: RoleCode;
  expiresAt: Date;
  /** Absolute URL containing the single-use token, delivered to the invitee by email. */
  acceptUrl: string;
}

export interface AcceptInviteResult {
  userId: string;
  tenantId: string;
  roleCode: RoleCode;
}

export class TenancyService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly invitations: InvitationRepository,
    private readonly userTenants: UserTenantRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly assignments: ManagerAssignmentRepository,
    private readonly tenantUsers: TenantUserRepository,
    private readonly users: UserRepository,
    private readonly email: EmailService,
    /** Base URL of the web console used to build the invitation accept link. */
    private readonly acceptBaseUrl: string,
  ) {}

  /**
   * `POST /auth/signup`. Unauthenticated self-service onboarding.
   *
   * Creates the company (app.tenants, TRIAL/BASIC) and its first member in one transaction, then
   * grants that member a TENANT-SCOPED ADMIN role — the company super-admin. It is deliberately NOT
   * SYSTEM_ADMIN: the account sees its own company in full and can invite further ADMIN /
   * FLEET_MANAGER users, but it has no cross-tenant reach.
   *
   * `user_roles.granted_by` is the new user's own id, because there is no prior actor to attribute
   * the grant to — the signup itself is the authorisation, and the audit entry records the request.
   *
   * `client` is the in-flight transaction. Signup is unauthenticated, so the write path binds RLS to
   * the BOOTSTRAP tenant by default — but `app.user_tenants` (and every tenancy table) is FORCE RLS,
   * so the membership/role INSERTs would be rejected by the `tenant_isolation` WITH CHECK. After the
   * tenant row exists we re-bind the GUC to the NEW tenant so those rows pass the check.
   */
  async signup(input: {
    companyName: string;
    email: string;
    password: string;
    fullName?: string;
  }, client?: DbClient): Promise<Result<SignupResult>> {
    const email = input.email.trim().toLowerCase();

    // A global address collision means the person already has an account; signing up again would
    // silently create a second company around the same identity, so it is a conflict.
    const existing = await this.users.findByEmail(email);
    if (existing) {
      return err(
        new ConflictError(
          "USER_ALREADY_EXISTS",
          "Account already exists",
          "An account with that email already exists — sign in instead",
        ),
      );
    }

    const slug = await this.allocateSlug(slugifyCompanyName(input.companyName));
    const tenant = await this.tenants.create({
      name: input.companyName.trim(),
      slug,
      status: "TRIAL",
      subscriptionTier: "BASIC",
    });

    // Re-bind RLS to the brand-new tenant for the remaining writes in this transaction (membership
    // + role). Without this the BOOTSTRAP-tenant GUC fails the tenant_isolation WITH CHECK.
    if (client) {
      await applyTenantContext(client, { tenantId: tenant.id });
    }

    // Same hasher the invite-acceptance path uses, so both entry points produce identical credentials.
    const passwordHash = await argon2idHasher.hash(input.password);
    const created = await this.users.insert({
      email,
      password_hash: passwordHash,
      full_name: input.fullName ?? email.split("@")[0] ?? email,
      is_active: true,
    });

    await this.userTenants.link(created.id, tenant.id, true);
    await this.userRoles.grant(created.id, "ADMIN", created.id);

    return ok({ userId: created.id, tenantId: tenant.id, tenantSlug: tenant.slug, roleCode: "ADMIN" });
  }

  /**
   * Finds a free slug by appending `-2`, `-3`, … to the candidate. Bounded so a pathological name
   * cannot spin: after the attempts are exhausted it falls back to a random suffix, which the
   * unique index still guards.
   */
  private async allocateSlug(candidate: string): Promise<string> {
    if (!(await this.tenants.findBySlug(candidate))) return candidate;
    for (let n = 2; n <= 50; n += 1) {
      const next = `${candidate.slice(0, 58)}-${n}`;
      if (!(await this.tenants.findBySlug(next))) return next;
    }
    return `${candidate.slice(0, 54)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * `POST /admin/users/invite`. Creates a pending invitation inside the CALLER's tenant and returns

   * the activation token. No user row is created yet — that happens on acceptance, so an unclaimed
   * invite leaves no half-provisioned account behind.
   */
  async invite(input: {
    tenantId: string;
    email: string;
    roleCode: RoleCode;
    invitedBy: string;
    ttlDays?: number;
  }): Promise<Result<InviteResult>> {
    if (!INVITABLE_ROLES.has(input.roleCode)) {
      return err(new Forbidden(`Role ${input.roleCode} cannot be granted by invitation`));
    }

    const email = input.email.trim().toLowerCase();

    // An address already attached to this tenant is a conflict, not a second invite.
    const existing = await this.users.findByEmail(email);
    if (existing && (await this.userTenants.isMember(existing.id, input.tenantId))) {
      return err(new ConflictError("USER_ALREADY_IN_TENANT", "User already exists", "That email already belongs to a user in this tenant"));
    }

    const expiresAt = new Date(Date.now() + (input.ttlDays ?? 7) * 24 * 60 * 60 * 1000);
    const invitation = await this.invitations.create({
      tenantId: input.tenantId,
      email,
      roleCode: input.roleCode,
      invitedBy: input.invitedBy,
      expiresAt,
    });

    // The token is the activation credential — it travels ONLY in the email, never in the API
    // response. A mail outage must not roll back the invitation, so failures are swallowed here.
    const tenant = await this.tenants.getById(input.tenantId);
    const acceptUrl = `${this.acceptBaseUrl.replace(/\/$/, "")}/accept-invite?token=${invitation.token}`;
    await this.email
      .sendInvitation({
        to: email,
        tenantName: tenant?.name ?? "your company",
        roleCode: input.roleCode,
        acceptUrl,
        expiresAt,
      })
      .catch((e) => logger.warn("tenancy.invite email send failed (invitation still created)", { service_name: "api", tenantId: input.tenantId, message: (e as Error).message }));

    return ok({
      invitationId: invitation.id,
      email,
      roleCode: input.roleCode,
      expiresAt,
      acceptUrl,
    });
  }

  /**
   * `POST /auth/accept-invite`. Unauthenticated — the token IS the credential.
   *
   * The created user is bound to `invitation.tenant_id`, and the role is granted with
   * `granted_by = invitation.invited_by`, so the audit trail names the human who authorised it.
   */
  async acceptInvite(input: {
    token: string;
    password: string;
    fullName?: string;
  }): Promise<Result<AcceptInviteResult>> {
    const invitation = await this.invitations.findLiveByToken(input.token);
    if (!invitation) return err(new NotFound("Invitation not found, already used, or expired"));

    const email = String(invitation.email).toLowerCase();
    const passwordHash = await argon2idHasher.hash(input.password);

    // The address may already exist globally (the same person working for two fleets). Reuse the
    // account and add the tenant membership rather than colliding on users_email_unique.
    const existing = await this.users.findByEmail(email);
    let userId: string;
    if (existing) {
      userId = existing.id;
      if (await this.userTenants.isMember(userId, invitation.tenant_id)) {
        return err(new ConflictError("USER_ALREADY_IN_TENANT", "User already exists", "That email already belongs to a user in this tenant"));
      }
    } else {
      const created = await this.users.insert({
        email,
        password_hash: passwordHash,
        full_name: input.fullName ?? email.split("@")[0] ?? email,
        is_active: true,
      });
      userId = created.id;
    }

    await this.userTenants.link(userId, invitation.tenant_id, !existing);
    await this.userRoles.grant(
      userId,
      invitation.role_code,
      invitation.invited_by ?? userId,
    );
    await this.invitations.markAccepted(invitation.id, userId);

    return ok({ userId, tenantId: invitation.tenant_id, roleCode: invitation.role_code });
  }

  /** `POST /admin/users/{id}/roles/revoke`. Scoped to the caller's tenant. */
  async revokeRole(input: {
    tenantId: string;
    userId: string;
    roleCode: RoleCode;
    actorUserId: string;
  }): Promise<Result<{ revoked: boolean }>> {
    if (!(await this.userTenants.isMember(input.userId, input.tenantId))) {
      return err(new NotFound("User not found in this tenant"));
    }
    // Removing your own ADMIN role would lock you out of the console mid-request.
    if (input.userId === input.actorUserId && input.roleCode === "ADMIN") {
      return err(new ValidationError("You cannot revoke your own ADMIN role"));
    }
    const removed = await this.userRoles.revoke(input.userId, input.roleCode);
    return ok({ revoked: removed > 0 });
  }

  /**
   * `POST /admin/users/{id}/assign`. Replaces the manager's vehicle/driver scope. Every referenced
   * id is tenant-checked first and a cross-tenant id is rejected with 409, so this path shares the
   * same IDOR guard as `POST /vehicles/{id}/assign` rather than silently dropping the foreign id.
   */
  async assign(input: {
    tenantId: string;
    userId: string;
    vehicleIds?: string[];
    driverIds?: string[];
    actorUserId: string;
  }): Promise<Result<{ vehicle_ids: string[]; driver_ids: string[] }>> {
    if (!(await this.userTenants.isMember(input.userId, input.tenantId))) {
      return err(new NotFound("User not found in this tenant"));
    }

    // Cross-tenant ids are REJECTED rather than silently dropped, so the admin-assignment path
    // shares the same 409 guard as `POST /vehicles/{id}/assign` (the repos' INSERT...SELECT would
    // otherwise just omit a foreign id and return a misleading 204).
    if (input.vehicleIds !== undefined) {
      const resolved = await this.assignments.filterVehicleIdsInTenant(
        input.tenantId,
        input.vehicleIds,
      );
      if (resolved.length !== new Set(input.vehicleIds).size) {
        return err(
          new ConflictError(
            "VEHICLE_NOT_IN_TENANT",
            "Unknown vehicle",
            "One or more vehicle_ids do not belong to this company",
          ),
        );
      }
    }
    if (input.driverIds !== undefined) {
      const resolved = await this.assignments.filterDriverIdsInTenant(
        input.tenantId,
        input.driverIds,
      );
      if (resolved.length !== new Set(input.driverIds).size) {
        return err(
          new ConflictError(
            "DRIVER_NOT_IN_TENANT",
            "Unknown driver",
            "One or more driver_ids do not belong to this company",
          ),
        );
      }
    }

    if (input.vehicleIds !== undefined) {
      await this.assignments.replaceVehicles({
        tenantId: input.tenantId,
        userId: input.userId,
        vehicleIds: input.vehicleIds,
        assignedBy: input.actorUserId,
      });
    }
    if (input.driverIds !== undefined) {
      await this.assignments.replaceDrivers({
        tenantId: input.tenantId,
        userId: input.userId,
        driverIds: input.driverIds,
        assignedBy: input.actorUserId,
      });
    }

    const rows = await this.assignments.listForUser(input.tenantId, input.userId);
    return ok({
      vehicle_ids: rows.map((r) => r.vehicle_id).filter((v): v is string => v !== null),
      driver_ids: rows.map((r) => r.driver_id).filter((v): v is string => v !== null),
    });
  }

  /** `GET /admin/users`. Users of the caller's tenant with roles and assignment scope. */
  async listUsers(input: {
    tenantId: string;
    roleCode?: RoleCode;
    status?: "ACTIVE" | "SUSPENDED";
    limit: number;
  }): Promise<Result<TenantUserSummary[]>> {
    const rows = await this.tenantUsers.listUsers(input);
    return ok(rows);
  }

  /**
   * `GET /admin/managers`. The admin/manager roster the mobile management screen renders: every
   * ADMIN and FLEET_MANAGER in the caller's tenant, each with the vehicle/driver scope currently
   * recorded in app.manager_assignments.
   *
   * A FLEET_MANAGER sees ONLY themselves. That mirrors the self-scoping the analytics surface
   * already applies, and it is enforced here rather than in the screen, because the mobile role
   * gating is presentational only.
   */
  async listManagers(input: {
    tenantId: string;
    callerUserId: string;
    /** Roles of the CALLER, used to decide between the full roster and the self-only view. */
    callerRoles: readonly RoleCode[];
    limit?: number;
  }): Promise<Result<AdminSummary[]>> {
    const rows = await this.tenantUsers.listUsers({
      tenantId: input.tenantId,
      limit: input.limit ?? 200,
    });

    const privileged = input.callerRoles.some((r) => r === "ADMIN" || r === "SYSTEM_ADMIN");
    const managers = rows
      .filter((row) => row.roles.some((r) => MANAGER_ROLES.has(r)))
      .filter((row) => privileged || row.user.id === input.callerUserId)
      .map(toAdminSummary);

    return ok(managers);
  }


  /** Pending invitations for the caller's tenant (console surface for re-sending). */
  async listPendingInvitations(tenantId: string): Promise<Result<InvitationRow[]>> {
    return ok(await this.invitations.listPending(tenantId));
  }

  /** Subscription quota gate (app.tenants.max_vehicles / max_drivers). */
  async withinQuota(tenantId: string, kind: "vehicle" | "driver"): Promise<Result<boolean>> {
    const tenant = await this.tenants.getById(tenantId);
    if (!tenant) return err(new NotFound("Tenant not found"));
    const counts = await this.tenants.counts(tenantId);
    return ok(
      kind === "vehicle" ? counts.vehicles < tenant.max_vehicles : counts.drivers < tenant.max_drivers,
    );
  }
}

