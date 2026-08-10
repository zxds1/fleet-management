// packages/api/src/http/routes/vehicles.ts
// Vehicle master data (Pillar 4). Read list/detail + create + update. Mutations run through
// executeWrite (audit + idempotency); reads use a tenant-scoped pooled client. Reuses the shared
// VehicleRow read model (app.vehicles) and the tenant-aware VehicleService in services/vehicles.ts.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { withTenantClient, tenantContextOf } from "../../db/withClient";
import { CursorQuerySchema, decodeCursor, type Cursor } from "../pagination";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;
const asPrincipal = (req: Request) => (req as { principal?: Principal }).principal as Principal;

const VehicleCreateSchema = z.object({
  license_plate: z.string().min(1).max(20),
  vehicle_class: z.enum(["TRACTOR", "RIGID", "VAN", "PICKUP"]),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  ownership_type: z.enum(["OWNED", "LEASED", "EXTERNAL"]).default("OWNED"),
  fuel_tank_capacity_litres: z.number().positive().optional(),
});

const VehicleUpdateSchema = z.object({
  license_plate: z.string().min(1).max(20).optional(),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE", "QUARANTINED", "RETIRED", "EXTERNAL"]).optional(),
  is_operational: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

const AssignVehicleSchema = z.object({
  driver_ids: z.array(z.string().uuid()).max(500).optional(),
  vehicle_ids: z.array(z.string().uuid()).max(500).optional(),
});

export interface VehicleRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createVehicleRouter(deps: VehicleRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Vehicle list (cursor) ─────────────────────────────────────────────────────────────
  router.get(
    "/vehicles",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("asset:read")),
    asyncHandler((req, res) => {
      const principal = asPrincipal(req);
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const cursor: Cursor | null = query.cursor ? decodeCursor(query.cursor) : null;
        const result = await svc.vehicle.list({ tenantId: principal.tenantId, limit: query.limit, cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  // ── Single vehicle ───────────────────────────────────────────────────────────────────
  router.get(
    "/vehicles/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("asset:read")),
    asyncHandler((req, res) => {
      const principal = asPrincipal(req);
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.vehicle.get(principal.tenantId, req.params.id!);
        if (!result.ok) {
          const status = result.error.httpStatus ?? 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  // ── Create ──────────────────────────────────────────────────────────────────────────
  router.post(
    "/vehicles",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("asset:create")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as { userId: string; tenantId: string };
        const input = parseBody(VehicleCreateSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.vehicle.create({
          tenantId: principal.tenantId,
          licensePlate: input.license_plate,
          vehicleClass: input.vehicle_class,
          make: input.make,
          model: input.model,
          year: input.year,
          ownershipType: input.ownership_type,
          fuelTankCapacityLitres: input.fuel_tank_capacity_litres,
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "CREATE",
          entity_table: "app.vehicles",
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

  // ── Update ──────────────────────────────────────────────────────────────────────────
  router.patch(
    "/vehicles/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("asset:update")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as { userId: string; tenantId: string };
        const input = parseBody(VehicleUpdateSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.vehicle.update({
          tenantId: principal.tenantId,
          vehicleId: req.params.id!,
          status: input.status,
          isOperational: input.is_operational,
          notes: input.notes,
        });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.vehicles",
          entity_id: req.params.id!,
          actor_user_id: principal.userId,
          changed_fields: Object.keys(input),
          new_value: input,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 200, body: result.value } as never;
      }),
    ),
  );

  // ── Assign drivers / linked vehicles (REPLACE semantics) ──────────────────────────────
  router.post(
    "/vehicles/:id/assign",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("asset:update")),
    asyncHandler((req, res) => {
      const principal = asPrincipal(req);
      return withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const input = parseBody(AssignVehicleSchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.vehicle.assign({
          tenantId: principal.tenantId,
          vehicleId: req.params.id!,
          driverIds: input.driver_ids ?? [],
          vehicleIds: input.vehicle_ids ?? [],
          actorUserId: principal.userId,
        });
        if (!result.ok) {
          const status = result.error.httpStatus ?? 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  return router;
}
