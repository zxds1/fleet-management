// packages/api/src/http/routes/accidents.ts
// Accident routes (03 §2.4, 08 §3). State-changing routes carry Idempotency-Key (C5.1) and run
// through executeWrite so audit + outbox (+ escalation timer) commit with the mutation (D8). The
// mayday path is the B17 escape hatch — GPS + reason only, immediate escalation, no photos. Reads
// use a pooled client. Driver id is resolved from the Principal via drivers.user_id.
//
// Read scope follows the same model as the other read routes (ownScope.ts): a caller holding only
// `accident:read` sees their own reports, while `accident:update` is the fleet-wide marker used by
// `GET /accidents/{id}`. `GET /accidents/me?own_scope=false` and `GET /accidents` both serve the
// tenant-wide list to such a caller.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Forbidden, NotFound, err, ok, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { AccidentCreateSchema, AccidentMediaSchema, MaydaySchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, problemResponse } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withClient, withTenantClient, tenantContextOf } from "../../db/withClient";
import { ownScopeDriverId } from "../ownScope";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

/** The fleet-wide accident permission — the same marker `GET /accidents/{id}` uses. */
const FLEET_WIDE_ACCIDENT_PERMISSION = "accident:update";

const AccidentListQuerySchema = CursorQuerySchema.extend({
  own_scope: z.enum(["true", "false"]).optional(),
});

export interface AccidentRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createAccidentRouter(deps: AccidentRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Mayday (B17 escape hatch) ──────────────────────────────────────────────────────────
  router.post(
    "/mayday",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:report")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(MaydaySchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return err(new Forbidden());
        const result = await svc.accident.mayday(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          // Wire contract is snake_case (openapi `/accidents/mayday` → accident_id).
          const { accidentId, escalatedAt } = result.value;
          return ok({
            status: 201,
            body: { accident_id: accidentId, escalated_at: escalatedAt ?? null },
            resourceId: accidentId,
          });
        }
        return err(result.error);
      }),
    ),
  );

  // ── Create a report (evidence follows) ─────────────────────────────────────────────────
  router.post(
    "/",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:report")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(AccidentCreateSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return err(new Forbidden());
        const result = await svc.accident.create(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          // Wire contract is snake_case (openapi `/accidents` → accident_id).
          const { accidentId } = result.value;
          return ok({ status: 201, body: { accident_id: accidentId }, resourceId: accidentId });
        }
        return err(result.error);
      }),
    ),
  );

  // ── Tenant-wide accident list (fleet-wide permission only) ─────────────────────────────
  router.get(
    "/",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler(async (req, res) => {
      const principal = (req as { principal: Principal }).principal;
      if (!principal.permissions.has(asPerm(FLEET_WIDE_ACCIDENT_PERMISSION))) {
        problemResponse(res, new Forbidden("Requires accident:update"), req.requestId);
        return;
      }
      await withTenantClient(pool, tenantContextOf(principal), async (client) => {
        const query = parseQuery(AccidentListQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.accidentQuery.listTenant(principal.tenantId, {
          limit: query.limit,
          cursor: query.cursor,
        });
        if (!result.ok) {
          problemResponse(res, result.error, req.requestId);
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  // ── Attach media (append-only) ─────────────────────────────────────────────────────────
  router.post(
    "/:id/media",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:report")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(AccidentMediaSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.accident.attachMedia(tx, req.params.id!, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        // A 204 has no body, and the client parses this response as a map — so the attached media
        // ids are returned in a well-formed document.
        if (result.ok) {
          return ok({
            status: 201,
            body: {
              accident_media_id: result.value.accident_media_id,
              media_object_id: result.value.media_object_id,
              slot: result.value.slot,
            },
            resourceId: result.value.accident_media_id,
          });
        }
        return err(result.error);
      }),
    ),
  );

  // ── Own reports (read, cursor) ──────────────────────────────────────────────────────────
  // `own_scope=false` asks for the tenant-wide list, which only a caller holding the fleet-wide
  // accident permission may see. The tenant always comes from the verified Principal.
  router.get(
    "/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler(async (req, res) => {
      const principal = (req as { principal: Principal }).principal;
      const query = parseQuery(AccidentListQuerySchema, req);
      if (query.own_scope === "false") {
        if (!principal.permissions.has(asPerm(FLEET_WIDE_ACCIDENT_PERMISSION))) {
          problemResponse(res, new Forbidden("Requires accident:update"), req.requestId);
          return;
        }
        await withTenantClient(pool, tenantContextOf(principal), async (client) => {
          const svc = makeServices(client, infra);
          const result = await svc.accidentQuery.listTenant(principal.tenantId, {
            limit: query.limit,
            cursor: query.cursor,
          });
          if (!result.ok) {
            problemResponse(res, result.error, req.requestId);
            return;
          }
          res.status(200).json(result.value);
        });
      }
      await withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) {
          problemResponse(res, new Forbidden(), req.requestId);
          return;
        }
        const result = await svc.accidentQuery.listMine(driver.id, { limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          problemResponse(res, result.error, req.requestId);
          return;
        }
        res.status(200).json(result.value);
      });
    }),
  );

  // ── Verify telemetry hash chain (read) ──────────────────────────────────────────────────
  // OWN-SCOPED, exactly like `GET /:id` below: `fn_verify_accident_chain` takes only the report id,
  // so without resolving the accident own-scoped first, a DRIVER holding accident:read could verify —
  // and existence-probe — any accident id in the tenant. `accident:update` is the scope-lift.
  router.get(
    "/:id/telemetry/verify",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, FLEET_WIDE_ACCIDENT_PERMISSION);
        const owned = await svc.accidentQuery.getOne(req.params.id!, driverId);
        if (!owned.ok) {
          problemResponse(res, owned.error, req.requestId);
          return;
        }
        const result = await svc.accidentQuery.verifyChain(req.params.id!);
        if (!result.ok) {
          problemResponse(res, result.error, req.requestId);
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Acknowledge (cancels escalation) ─────────────────────────────────────────────────────
  router.post(
    "/:id/acknowledge",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:acknowledge")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.accident.acknowledge(tx, req.params.id!, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          const { accidentId, acknowledgedAt } = result.value;
          return ok({ status: 200, body: { accident_id: accidentId, acknowledged_at: acknowledgedAt } });
        }
        return err(result.error);
      }),
    ),
  );

  // ── Single accident detail (read; driver + admin) ────────────────────────────────────────
  // Registered after /me and /:id/telemetry/verify so the literal paths win the match.
  // A driver (accident:read without the fleet-wide accident:update) only ever resolves their own
  // report; anything else 404s rather than leaking another driver's incident.
  router.get(
    "/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, FLEET_WIDE_ACCIDENT_PERMISSION);
        const result = await svc.accidentQuery.getOne(req.params.id!, driverId);
        if (!result.ok) {
          problemResponse(res, result.error, req.requestId);
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
