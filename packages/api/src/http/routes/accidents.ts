// packages/api/src/http/routes/accidents.ts
// Accident routes (03 §2.4, 08 §3). State-changing routes carry Idempotency-Key (C5.1) and run
// through executeWrite so audit + outbox (+ escalation timer) commit with the mutation (D8). The
// mayday path is the B17 escape hatch — GPS + reason only, immediate escalation, no photos. Reads
// use a pooled client. Driver id is resolved from the Principal via drivers.user_id.

import { Router, type Request, type Response } from "express";
import { Forbidden, NotFound, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { AccidentCreateSchema, AccidentMediaSchema, MaydaySchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withClient } from "../../db/withClient";
import { ownScopeDriverId } from "../ownScope";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

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
        if (!driver) return new Forbidden() as never;
        const result = await svc.accident.mayday(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          // Wire contract is snake_case (openapi `/accidents/mayday` → accident_id).
          const { accidentId, escalatedAt } = result.value;
          return {
            status: 201,
            body: { accident_id: accidentId, escalated_at: escalatedAt ?? null },
            resourceId: accidentId,
          } as never;
        }
        return result.error as never;
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
        if (!driver) return new Forbidden() as never;
        const result = await svc.accident.create(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          // Wire contract is snake_case (openapi `/accidents` → accident_id).
          const { accidentId } = result.value;
          return { status: 201, body: { accident_id: accidentId }, resourceId: accidentId } as never;
        }
        return result.error as never;
      }),
    ),
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
        if (result.ok) return { status: 204, body: {} } as never;
        return result.error as never;
      }),
    ),
  );

  // ── Own reports (read, cursor) ──────────────────────────────────────────────────────────
  router.get(
    "/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.findByUserId((req as { principal: Principal }).principal.userId);
        if (!driver) {
          res.status(403).json({ error_code: "FORBIDDEN", status: 403, title: "Forbidden" });
          return;
        }
        const result = await svc.accidentQuery.listMine(driver.id, { limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Verify telemetry hash chain (read) ──────────────────────────────────────────────────
  router.get(
    "/:id/telemetry/verify",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("accident:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.accidentQuery.verifyChain(req.params.id!);
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
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
          return { status: 200, body: { accident_id: accidentId, acknowledged_at: acknowledgedAt } } as never;
        }
        return result.error as never;
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
        const driverId = await ownScopeDriverId(req, svc, "accident:update");
        const result = await svc.accidentQuery.getOne(req.params.id!, driverId);
        if (!result.ok) {
          const status = result.error instanceof NotFound ? 404 : 422;
          res.status(status).json({ error_code: result.error.error_code, status, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
