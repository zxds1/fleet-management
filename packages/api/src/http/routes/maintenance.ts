// packages/api/src/http/routes/maintenance.ts
// Maintenance records + work orders (Pillar 3, 08_safety.sql). Reads use a pooled client and emit
// RFC7807 via result.error.toProblem(); the write runs through executeWrite so the audit entry, the
// outbox event and the idempotency completion all commit in one transaction (D8).
//
// Route-order rule: the literal `/work-orders` path is registered before `/:id`, otherwise `:id`
// would swallow it.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { withClient } from "../../db/withClient";
import { CursorQuerySchema } from "../pagination";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

/**
 * Exactly one of vehicle_id / trailer_id, mirroring the
 * maintenance_records_exactly_one_asset CHECK. Enforced here so the common case is a 400 with a
 * field error; the service repeats the rule as a 422 for callers that bypass the shape.
 */
const WorkOrderCreateSchema = z
  .object({
    vehicle_id: z.string().uuid().optional(),
    trailer_id: z.string().uuid().optional(),
    task_code: z.string().min(1).max(80),
    performed_at: z.string().datetime({ offset: true }),
    odometer_km: z.number().int().min(0).max(9_999_999).optional(),
    vendor: z.string().max(200).optional(),
    cost: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Boolean(v.vehicle_id) !== Boolean(v.trailer_id), {
    message: "Provide exactly one of vehicle_id or trailer_id",
    path: ["vehicle_id"],
  });

export interface MaintenanceRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createMaintenanceRouter(deps: MaintenanceRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Maintenance history (cursor) ─────────────────────────────────────────────────────────
  router.get(
    "/",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("maintenance:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.maintenance.list({ limit: query.limit, cursor: query.cursor ?? null });
        if (!result.ok) {
          res
            .status(result.error.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...result.error.toProblem(), instance: req.requestId });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Record a completed work order ────────────────────────────────────────────────────────
  // Declared before `/:id` so the literal path is not shadowed.
  router.post(
    "/work-orders",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("maintenance:record")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(WorkOrderCreateSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.maintenance.createWorkOrder(tx, input, { userId: principal.userId });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "CREATE",
          entity_table: "app.maintenance_records",
          entity_id: result.value.id,
          actor_user_id: principal.userId,
          new_value: input,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 201, body: result.value, resourceId: result.value.id } as never;
      }),
    ),
  );

  // ── Single maintenance record ────────────────────────────────────────────────────────────
  router.get(
    "/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("maintenance:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.maintenance.getOne(req.params.id!);
        if (!result.ok) {
          res
            .status(result.error.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...result.error.toProblem(), instance: req.requestId });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
