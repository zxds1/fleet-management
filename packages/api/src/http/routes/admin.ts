// packages/api/src/http/routes/admin.ts
// Admin console surface (A3.7): driver roster, driver creation + approval, device/session revoke.
// Reads use a pooled client and the cursor envelope (D7); writes run through executeWrite so audit +
// idempotency commit atomically with the mutation (D8). Device revoke is keyed by the device primary
// key (the mobile roster exposes `app.driver_devices.id`, never the opaque `device_id_hash`).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal, type UserRow, type DriverDeviceRow, ok } from "@fleet/shared";
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
const CreateDriverSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  full_name: z.string().min(1).max(200),
  password: z.string().min(1),
  licence_number: z.string().max(80).optional(),
  licence_class: z.string().max(40).optional(),
  emergency_contact_name: z.string().max(200).optional(),
  emergency_contact_phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
});

/** Derives the mobile `platform` from the stored push provider (no native `platform` column). */
export function platformOf(pushProvider: string): "ios" | "android" {
  return pushProvider === "apns" ? "ios" : "android";
}

export function toDriverSummary(row: { user: UserRow; driverStatus: string | null; devices: DriverDeviceRow[] }) {
  return {
    user_id: row.user.id,
    email: row.user.email,
    phone: row.user.phone,
    full_name: row.user.full_name ?? null,
    mfa_enrolled: row.user.mfa_enabled,
    status: row.driverStatus ?? (row.user.is_active ? "ACTIVE" : "SUSPENDED"),
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

  // ── Create a driver (PENDING approval) ────────────────────────────────────────────────────
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
          phone: input.phone,
          fullName: input.full_name,
          password: input.password,
          licenceNumber: input.licence_number ?? null,
          licenceClass: input.licence_class ?? null,
          emergencyContactName: input.emergency_contact_name ?? null,
          emergencyContactPhone: input.emergency_contact_phone ?? null,
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "CREATE",
          entity_table: "app.users",
          entity_id: result.value.userId,
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "admin_create_driver",
        });
        return ok({ status: 201, body: { user_id: result.value.userId, status: result.value.status } });
      }),
    ),
  );

  // ── Approve a PENDING driver ──────────────────────────────────────────────────────────────
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
          action: "CONFIG_CHANGE",
          entity_table: "app.drivers",
          entity_id: req.params.id!,
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "admin_approve_driver",
        });
        return ok({ status: 200, body: { approved: true } });
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
