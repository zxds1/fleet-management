// packages/api/src/http/routes/shifts.ts
// Shift routes (03 §2.2). All state-changing routes carry Idempotency-Key (C5.1) and run through
// executeWrite so audit + outbox commit with the mutation (D8). Reads use a pooled client. The
// driver id is resolved from the Principal via drivers.user_id.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Forbidden, NotFound, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { ClockInSchema, ClockOutSchema, VerifyShiftSchema } from "@fleet/shared";
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

const InboxQuerySchema = CursorQuerySchema.extend({
  verification_status: z.enum(["PENDING", "VERIFIED", "FLAGGED"]).optional(),
  state: z.enum(["OPEN", "PENDING_CLOSEOUT", "CLOSED"]).optional(),
  operational_date: z.string().date().optional(),
  sort: z.enum(["clock_out_at", "operational_date", "verification_status"]).optional(),
});
const ForceCloseSchema = z.object({ reason: z.string().max(500).optional() });

export interface ShiftRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

export function createShiftRouter(deps: ShiftRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Clock-in ───────────────────────────────────────────────────────────────────────────
  router.post(
    "/clock-in",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:clock_in")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ClockInSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden() as never;
        const result = await svc.shift.clockIn(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          tx.audit({
            action: "CREATE",
            entity_table: "app.shifts",
            entity_id: result.value.shiftId,
            actor_user_id: principal.userId,
            request_id: req.requestId,
            ip_address: ip(req),
            user_agent: ua(req),
            endpoint: req.path,
            http_method: req.method,
          });
          // Wire contract is snake_case (openapi `/shifts/clock-in`).
          return {
            status: 201,
            body: {
              shift_id: result.value.shiftId,
              clock_in_at: result.value.clockInAt,
              disclaimer: result.value.disclaimer,
            },
            resourceId: result.value.shiftId,
          } as never;
        }
        return result.error as never;
      }),
    ),
  );

  // ── Clock-out ───────────────────────────────────────────────────────────────────────────
  router.post(
    "/clock-out",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:clock_out")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ClockOutSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden() as never;
        const result = await svc.shift.clockOut(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          tx.audit({
            action: "UPDATE",
            entity_table: "app.shifts",
            entity_id: input.shift_id,
            actor_user_id: principal.userId,
            request_id: req.requestId,
            ip_address: ip(req),
            user_agent: ua(req),
            endpoint: req.path,
            http_method: req.method,
          });
          // Wire contract is snake_case (openapi `/shifts/clock-out`).
          return { status: 200, body: { shift_id: result.value.shiftId } } as never;
        }
        return result.error as never;
      }),
    ),
  );

  // ── Active shift (read) ──────────────────────────────────────────────────────────────────
  router.get(
    "/me/active",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:read_own")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.findByUserId((req as { principal: Principal }).principal.userId);
        if (!driver) {
          res.status(403).json({ error_code: "FORBIDDEN", status: 403, title: "Forbidden" });
          return;
        }
        const shift = await svc.shift.getActive(driver.id);
        // Contract (openapi `/shifts/me/active`): a bare, nullable ActiveShift — not an envelope.
        // `app.shifts` names the key `id` and the trailer `assigned_trailer_id`, so project them
        // onto the contract's `shift_id` / `trailer_id`.
        res.status(200).json(
          shift
            ? {
                shift_id: shift.id,
                vehicle_id: shift.vehicle_id,
                trailer_id: shift.assigned_trailer_id,
                clock_in_at: shift.clock_in_at,
              }
            : null,
        );
      }),
    ),
  );

  // ── Verification inbox (read, cursor) ─────────────────────────────────────────────────────
  router.get(
    "/verification-inbox",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:read_all")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(InboxQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.shiftQuery.verificationInbox({
          verificationStatus: query.verification_status,
          state: query.state,
          operationalDate: query.operational_date,
          sort: query.sort,
          limit: query.limit,
          cursor: query.cursor,
        });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Own shift history (read, cursor) ──────────────────────────────────────────────────────
  router.get(
    "/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:read_own")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.findByUserId((req as { principal: Principal }).principal.userId);
        if (!driver) {
          res.status(403).json({ error_code: "FORBIDDEN", status: 403, title: "Forbidden" });
          return;
        }
        const result = await svc.shiftQuery.listHistory(driver.id, { limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Verification detail for one shift (read) ───────────────────────────────────────────────
  router.get(
    "/:id/verification",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:read_all")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.shiftQuery.getVerification(req.params.id!);
        if (!result.ok) {
          const status = result.error instanceof NotFound ? 404 : 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Verify / flag ────────────────────────────────────────────────────────────────────────
  router.post(
    "/:id/verify",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:verify")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(VerifyShiftSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.shift.verify(tx, req.params.id!, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          tx.audit({
            action: "VERIFY",
            entity_table: "app.shifts",
            entity_id: req.params.id!,
            actor_user_id: principal.userId,
            request_id: req.requestId,
            ip_address: ip(req),
            user_agent: ua(req),
            endpoint: req.path,
            http_method: req.method,
            reason: input.action,
          });
          // Wire contract is snake_case (openapi `/shifts/{id}/verify`).
          return { status: 200, body: { shift_id: result.value.shiftId, status: result.value.status } } as never;
        }
        return result.error as never;
      }),
    ),
  );

  // ── Force-close (admin override) ──────────────────────────────────────────────────────────
  router.post(
    "/:id/force-close",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("shift:force_close")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ForceCloseSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.shift.forceClose(tx, req.params.id!, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        }, input.reason ?? "");
        if (result.ok) {
          tx.audit({
            action: "OVERRIDE",
            entity_table: "app.shifts",
            entity_id: req.params.id!,
            actor_user_id: principal.userId,
            request_id: req.requestId,
            ip_address: ip(req),
            user_agent: ua(req),
            endpoint: req.path,
            http_method: req.method,
            reason: input.reason ?? "Admin force-close (N6/C3.8)",
          });
          // Wire contract is snake_case (openapi `/shifts/{id}/force-close`).
          return { status: 200, body: { shift_id: result.value.shiftId } } as never;
        }
        return result.error as never;
      }),
    ),
  );

  return router;
}
