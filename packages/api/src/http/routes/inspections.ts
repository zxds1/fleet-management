// packages/api/src/http/routes/inspections.ts
// Inspection (DVIR) route (03 §2.5, 08 §5). The single write carries Idempotency-Key (C5.1) and runs
// through executeWrite so audit + outbox (+ asset quarantine) commit with the mutation (D8). Reads of
// DVIR results would use a pooled client; only submission is implemented here per 03 §2.5. Driver id is
// resolved from the Principal via drivers.user_id.

import { Router, type Request, type Response } from "express";
import { Forbidden, NotFound, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { InspectionSubmitSchema } from "@fleet/shared";
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

export interface InspectionRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createInspectionRouter(deps: InspectionRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  router.post(
    "/",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("inspection:submit")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(InspectionSubmitSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden() as never;
        const result = await svc.inspection.submit(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok)
  // Wire contract is snake_case (openapi `/inspections` → inspection_id, block_shift).
  return {
    status: 201,
    body: { inspection_id: result.value.inspectionId, block_shift: result.value.blockShift },
    resourceId: result.value.inspectionId,
  } as never;
        return result.error as never;
      }),
    ),
  );

  // ── Templates the driver may start (read) ────────────────────────────────────────────────
  router.get(
    "/templates",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("inspection:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.inspectionQuery.listTemplates();
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Own DVIR submissions (read, cursor) ──────────────────────────────────────────────────
  router.get(
    "/me",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("inspection:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const driver = await svc.drivers.findByUserId((req as { principal: Principal }).principal.userId);
        if (!driver) {
          res.status(403).json({ error_code: "FORBIDDEN", status: 403, title: "Forbidden" });
          return;
        }
        const result = await svc.inspectionQuery.listMine(driver.id, { limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Single DVIR detail with per-item results (read) ───────────────────────────────────────
  // Registered after /templates and /me so the literal paths win the match.
  // A driver (inspection:read without the fleet-wide inspection:template_manage) only ever
  // resolves their own submission; anything else 404s.
  router.get(
    "/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("inspection:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const driverId = await ownScopeDriverId(req, svc, "inspection:template_manage");
        const result = await svc.inspectionQuery.getOne(req.params.id!, driverId);
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
