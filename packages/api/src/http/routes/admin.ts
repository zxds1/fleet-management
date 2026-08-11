// packages/api/src/http/routes/admin.ts
// Admin console surface (A3.7): driver roster + device/session revoke. Reads use a pooled client and
// the cursor envelope (D7); writes run through executeWrite so audit + idempotency commit atomically
// with the mutation (D8). Device revoke is keyed by the device primary key (the mobile roster exposes
// `app.driver_devices.id`, never the opaque `device_id_hash`).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal, type UserRow, type DriverDeviceRow } from "@fleet/shared";
import { VerifyPurchaseSchema, Forbidden } from "@fleet/shared";
import {
  AssignAdminsSchema,
  AssignScopeSchema,
  InviteUserSchema,
  ListUsersQuerySchema,
  RevokeRoleSchema,
} from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withClient, withTenantClient, tenantContextOf } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const RevokeSessionsSchema = z.object({ user_id: z.string().uuid().nullable().optional() });

const RoleCodeSchema = z.enum(["DRIVER", "DISPATCHER", "FLEET_MANAGER", "ADMIN", "FINANCE", "AUDITOR"]);

const CreateDriverSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: z.string().min(1).nullable().optional(),
  roles: z.array(RoleCodeSchema).nonempty().optional(),
});

/** The caller's own editable profile fields (`PUT /admin/users/me`, admin_profile_settings). */
const UpdateOwnProfileSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
  locale: z.enum(["en", "sw"]).optional(),
});

/** Derives the mobile `platform` from the stored push provider (no native `platform` column). */
export function platformOf(pushProvider: string): "ios" | "android" {
  return pushProvider === "apns" ? "ios" : "android";
}

export function toDriverSummary(row: { user: UserRow; devices: DriverDeviceRow[] }) {
  return {
    user_id: row.user.id,
    email: row.user.email,
    full_name: row.user.full_name ?? null,
    mfa_enrolled: row.user.mfa_enabled,
    status: row.user.is_active ? "ACTIVE" : "SUSPENDED",
    last_login_at: row.user.last_login_at ?? null,
    devices: (row.devices ?? []).map((d) => ({
      device_id: d.id,
      platform: platformOf(d.push_provider),
      last_seen_at: d.last_seen_online_at ?? null,
    })),
  };
}

export interface AdminRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Driver roster (read, cursor) ──────────────────────────────────────────────────────────
  router.get(
    "/drivers",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const rawStatus = req.query.status as string | undefined;
        const status = rawStatus === "SUSPENDED" || rawStatus === "ACTIVE" ? rawStatus : undefined;
        const result = await svc.admin.listDrivers({
          status,
          cursor: query.cursor ?? null,
          limit: query.limit,
        });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json({
          data: result.value.data.map(toDriverSummary),
          next_cursor: result.value.nextCursor,
          has_more: result.value.hasMore,
        });
      }),
    ),
  );

  // ── Driver detail (read): roster shape + RBAC union + devices ─────────────────────────────
  router.get(
    "/drivers/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.admin.getDriver(req.params.id!);
        if (!result.ok) {
          const problem = { ...result.error.toProblem(), instance: req.requestId };
          res.status(result.error.httpStatus).type("application/problem+json").json(problem);
          return;
        }
        res.status(200).json({
          ...toDriverSummary(result.value),
          roles: result.value.roles,
          permissions: result.value.permissions,
        });
      }),
    ),
  );

  // ── Create / invite a driver ───────────────────────────────────────────────────────────────
  router.post(
    "/drivers",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(CreateDriverSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.createDriver({
          email: input.email,
          fullName: input.full_name,
          phone: input.phone ?? null,
          ...(input.roles ? { roles: [...input.roles] } : {}),
          createdBy: principal.userId,
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "CREATE",
          entity_table: "app.users",
          entity_id: result.value.id,
          actor_user_id: principal.userId,
          new_value: { email: result.value.email, full_name: result.value.full_name },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "DRIVER_CREATE",
        });
        return {
          status: 201,
          body: { user_id: result.value.id, email: result.value.email, status: "PENDING" },
          resourceId: result.value.id,
        } as never;
      }),
    ),
  );

  // ── Approve a pending driver ───────────────────────────────────────────────────────────────
  router.post(
    "/drivers/:id/approve",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.approveDriver(req.params.id!);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.users",
          entity_id: req.params.id!,
          actor_user_id: principal.userId,
          changed_fields: ["is_active"],
          new_value: { is_active: true },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "DRIVER_APPROVE",
        });
        return { status: 200, body: { user_id: result.value.id, status: "ACTIVE" } } as never;
      }),
    ),
  );

  // ── The caller's own profile (A3.7 admin_profile_settings) ─────────────────────────────────
  // Declared before `/admin/users/:id/*` so the literal "me" segment can never be captured as an
  // `:id`. The target is always the resolved principal, so this cannot read another user.
  router.get(
    "/admin/users/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = (req as { principal: Principal }).principal;
        const svc = makeServices(client, infra);
        const result = await svc.admin.getOwnProfile(principal.userId);
        if (!result.ok) {
          const problem = { ...result.error.toProblem(), instance: req.requestId };
          res.status(result.error.httpStatus).type("application/problem+json").json(problem);
          return;
        }
        res.status(200).json({
          user_id: result.value.id,
          email: result.value.email,
          full_name: result.value.full_name,
          phone: result.value.phone,
          locale: result.value.locale,
        });
      }),
    ),
  );

  // ── Update the caller's own profile ────────────────────────────────────────────────────────
  router.put(
    "/admin/users/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(UpdateOwnProfileSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.updateOwnProfile(principal.userId, {
          ...(input.full_name !== undefined ? { full_name: input.full_name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.users",
          entity_id: principal.userId,
          actor_user_id: principal.userId,
          changed_fields: Object.keys(input),
          new_value: input,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "PROFILE_UPDATE",
        });
        return {
          status: 200,
          body: {
            user_id: result.value.id,
            email: result.value.email,
            full_name: result.value.full_name,
            phone: result.value.phone,
            locale: result.value.locale,
          },
          resourceId: result.value.id,
        } as never;
      }),
    ),
  );

  // ── Suspend a user (also drops live sessions) ──────────────────────────────────────────────
  router.post(
    "/admin/users/:id/suspend",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.suspendUser(req.params.id!);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.users",
          entity_id: req.params.id!,
          actor_user_id: principal.userId,
          changed_fields: ["is_active"],
          new_value: { is_active: false },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "USER_SUSPEND",
        });
        return { status: 200, body: { user_id: result.value.id, status: "SUSPENDED" } } as never;
      }),
    ),
  );

  // ── Reinstate a suspended user ─────────────────────────────────────────────────────────────
  router.post(
    "/admin/users/:id/reinstate",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.reinstateUser(req.params.id!);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.users",
          entity_id: req.params.id!,
          actor_user_id: principal.userId,
          changed_fields: ["is_active"],
          new_value: { is_active: true },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "USER_REINSTATE",
        });
        return { status: 200, body: { user_id: result.value.id, status: "ACTIVE" } } as never;
      }),
    ),
  );

  // ── Revoke a device (forces re-auth) ───────────────────────────────────────────────────────
  router.post(
    "/devices/:deviceId/revoke",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("device:revoke")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.revokeDevice(req.params.deviceId!, principal.userId);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "DEVICE_REVOKE",
          entity_table: "app.driver_devices",
          entity_id: req.params.deviceId!,
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 204, body: null } as never;
      }),
    ),
  );

  // ── Force global sign-out for a user ────────────────────────────────────────────────────────
  router.post(
    "/sessions/revoke",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(RevokeSessionsSchema, req);
        const targetUserId = input.user_id ?? principal.userId;
        const svc = makeServices(tx.client, infra);
        const result = await svc.admin.revokeSessions(targetUserId);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "LOGOUT",
          entity_table: "app.user_sessions",
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "revoke_all_sessions",
        });
        return { status: 204, body: null } as never;
      }),
    ),
  );

  // ── Photo-first fuel review queue (2.7, A1.4) ─────────────────────────────────────────────
  router.get(
    "/admin/fuel/pending",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("fuel:read")),
    asyncHandler((req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.fuelQuery.pendingReview({ limit: query.limit, tenantId: principal.tenantId });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  // ── Verify / adjust / reject / clear a purchase ────────────────────────────────────────────
  // PUT mirror of POST /fuel/purchases/{id}/verify, carrying the photo-first adjustments.
  router.put(
    "/admin/fuel/verify/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("fuel:verify")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(VerifyPurchaseSchema, req);
        // The photo-first `adjusted_*` fields rewrite settled monetary values, which the
        // permission model treats as a strictly higher authority than plain verification.
        const adjusts =
          input.adjusted_amount != null ||
          input.adjusted_litres != null ||
          input.adjusted_odometer != null;
        if (adjusts && !principal.permissions.has(asPerm("fuel:adjust"))) {
          throw new Forbidden("Adjusting fuel figures requires fuel:adjust");
        }
        const svc = makeServices(tx.client, infra);
        const result = await svc.fuel.verifyPurchase(tx, req.params.id!, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) return { status: 200, body: result.value } as never;
        return result.error as never;
      }),
    ),
  );

  // ── Tenancy: list users in the caller's tenant (14_tenancy.sql) ──────────────────────────
  router.get(
    "/admin/users",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(ListUsersQuerySchema, req);
        const principal = req.principal as Principal;
        const svc = makeServices(client, infra);
        const result = await svc.tenancy.listUsers({ tenantId: principal.tenantId, roleCode: query.role_code, status: query.status, limit: 100 });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Tenancy: list pending invitations (14_tenancy.sql) ──────────────────────────────────
  router.get(
    "/admin/invitations",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = req.principal as Principal;
        const svc = makeServices(client, infra);
        const result = await svc.tenancy.listPendingInvitations(principal.tenantId);
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json({ data: result.value });
      }),
    ),
  );

  // ── Tenancy: invite a user into the caller's tenant (14_tenancy.sql) ────────────────────
  router.post(
    "/admin/users/invite",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(InviteUserSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.invite({
          tenantId: principal.tenantId,
          email: input.email,
          roleCode: input.role_code,
          invitedBy: principal.userId,
        });
        if (!result.ok) return result.error as never;
        // The activation token lives only in the email sent by TenancyService; the HTTP response
        // deliberately omits `acceptUrl` so the capability never leaks through the API surface.
        const { acceptUrl, ...safe } = result.value;
        void acceptUrl;
        return { status: 201, body: safe } as never;
      }),
    ),
  );

  // ── Tenancy: revoke a role from a user in the caller's tenant (14_tenancy.sql) ──────────
  router.post(
    "/admin/users/:userId/roles/revoke",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(RevokeRoleSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.revokeRole({
          tenantId: principal.tenantId,
          userId: req.params.userId!,
          roleCode: input.role_code,
          actorUserId: principal.userId,
        });
        if (!result.ok) return result.error as never;
        return { status: 204, body: null } as never;
      }),
    ),
  );

  // ── Tenancy: assign a manager to vehicles/drivers (14_tenancy.sql) ─────────────────────
  router.post(
    "/admin/users/:userId/assign",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(AssignScopeSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.assign({
          tenantId: principal.tenantId,
          userId: req.params.userId!,
          vehicleIds: input.vehicle_ids,
          driverIds: input.driver_ids,
          actorUserId: principal.userId,
        });
        if (!result.ok) return result.error as never;
        return { status: 204, body: null } as never;
      }),
    ),
  );

  // ── Admin/manager roster for the mobile management screen ─────────────────────────────────
  // GET /admin/managers → { managers: AdminSummary[] }. A projection of the same read model that
  // backs GET /admin/users, narrowed to ADMIN/FLEET_MANAGER and renamed to the field names the
  // mobile AdminSummarySchema reads. A FLEET_MANAGER sees only themselves (enforced in the
  // service, since the mobile role gating is presentational only).
  router.get(
    "/admin/managers",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:read")),
    asyncHandler((req, res) => {
      const principal = req.principal as Principal;
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.tenancy.listManagers({
          tenantId: principal.tenantId,
          callerUserId: principal.userId,
          callerRoles: principal.roles,
        });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json({ managers: result.value });
      });
    }),
  );

  // ── Replace one manager's vehicle + driver scope ───────────────────────────────────────────
  // POST /admin/managers/{userId}/assign. The same operation as /admin/users/{userId}/assign and
  // it delegates to the identical service call; this path exists because it is what the mobile
  // management screen binds to. Both arrays are REPLACE (the client sends the full desired set),
  // and svc.tenancy.assign rejects a target outside the caller's tenant, which is the IDOR guard.
  router.post(
    "/admin/managers/:userId/assign",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("user:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(AssignAdminsSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.assign({
          tenantId: principal.tenantId,
          userId: req.params.userId!,
          vehicleIds: input.vehicle_ids,
          driverIds: input.driver_ids,
          actorUserId: principal.userId,
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "SCOPE_ASSIGN",
          entity_table: "app.manager_assignments",
          entity_id: req.params.userId!,
          actor_user_id: principal.userId,
          new_value: { vehicle_ids: input.vehicle_ids, driver_ids: input.driver_ids },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 204, body: null } as never;
      }),
    ),
  );

  return router;
}