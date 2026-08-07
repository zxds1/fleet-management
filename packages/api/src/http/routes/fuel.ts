// packages/api/src/http/routes/fuel.ts
// Fuel + reconciliation routes (03 §2.3, 03 §4). State-changing routes carry Idempotency-Key
// (C5.1) and run through executeWrite so audit + outbox commit with the mutation (D8). The fuel
// anomaly scoring is asynchronous — `submitRefuel` only queues `fuel.ocr` (03 §4).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Forbidden, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { RefuelSchema, VerifyPurchaseSchema } from "@fleet/shared";
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

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

const CardCreateSchema = z.object({
  label: z.string().min(1).max(80),
  last_four: z.string().regex(/^\d{4}$/),
  provider: z.string().min(1).max(40),
  is_pooled: z.boolean(),
  assigned_vehicle_id: z.string().uuid().nullable().optional(),
});
const StatementSchema = z.object({
  provider: z.string().min(1).max(40),
  period_start: z.string().date(),
  period_end: z.string().date(),
  media_object_id: z.string().uuid(),
  column_mapping: z.record(z.string()),
});
const InboxQuerySchema = CursorQuerySchema.extend({
  vehicle_id: z.string().uuid().optional(),
  verified: z.enum(["true", "false"]).optional(),
});

export interface FuelRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createFuelRouter(deps: FuelRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Submit a refuel (driver) ────────────────────────────────────────────────────────────
  router.post(
    "/refuel",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("fuel:enter")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(RefuelSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden() as never;
        const result = await svc.fuel.submitRefuel(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) return { status: 201, body: result.value, resourceId: result.value.fuelPurchaseId } as never;
        return result.error as never;
      }),
    ),
  );

  // ── Verify / reject / clear a purchase (Fleet Mgr / Finance) ──────────────────────────────
  router.post(
    "/purchases/:id/verify",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("fuel:verify")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(VerifyPurchaseSchema, req);
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

  // ── Create a fuel card (C2.1/C2.2) ───────────────────────────────────────────────────────
  router.post(
    "/cards",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("fuel:card_manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(CardCreateSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.fuelCard.create(
          tx,
          { label: input.label, lastFour: input.last_four, provider: input.provider, isPooled: input.is_pooled, assignedVehicleId: input.assigned_vehicle_id ?? null },
          { userId: principal.userId, email: principal.email, roles: principal.roles },
        );
        if (result.ok) return { status: 201, body: result.value, resourceId: result.value.fuelCardId } as never;
        return result.error as never;
      }),
    ),
  );

  // ── Reconciliation inbox (read, cursor) ────────────────────────────────────────────────────
  router.get(
    "/reconciliation-inbox",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("fuel:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(InboxQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.fuelQuery.reconciliationInbox({
          vehicleId: query.vehicle_id,
          verified: query.verified === "true" ? true : query.verified === "false" ? false : undefined,
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

  return router;
}

export function createReconciliationRouter(deps: FuelRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  router.post(
    "/statements",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("fuel:reconcile")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(StatementSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.reconciliation.importStatement(
          tx,
          {
            provider: input.provider,
            periodStart: input.period_start,
            periodEnd: input.period_end,
            mediaObjectId: input.media_object_id,
            columnMapping: input.column_mapping,
          },
          { userId: principal.userId, email: principal.email, roles: principal.roles },
        );
        if (result.ok) return { status: 201, body: result.value, resourceId: result.value.statementId } as never;
        return result.error as never;
      }),
    ),
  );

  return router;
}
