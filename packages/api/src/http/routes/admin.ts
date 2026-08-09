// packages/api/src/http/routes/admin.ts
// Admin console surface (A3.7): driver roster + device/session revoke. Reads use a pooled client and
// the cursor envelope (D7); writes run through executeWrite so audit + idempotency commit atomically
// with the mutation (D8). Device revoke is keyed by the device primary key (the mobile roster exposes
// `app.driver_devices.id`, never the opaque `device_id_hash`).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal, type UserRow, type DriverDeviceRow } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withClient } from "../../db/withClient";
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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

  return router;
}
