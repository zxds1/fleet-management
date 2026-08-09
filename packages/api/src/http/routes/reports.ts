// packages/api/src/http/routes/reports.ts
// Reporting routes (Pillar 6). Both endpoints are read-only aggregates over existing tables and
// views, so they use a pooled client (D8 read path) and emit RFC7807 via result.error.toProblem().
// Neither is paginated: each returns a single summary object.

import { Router } from "express";
import { type PermissionCode, type PoolLike } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface ReportsRouterDeps {
  pool: PoolLike;
  infra: Infra;
}

export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const router = Router();
  const { pool, infra } = deps;

  // ── Fleet fuel efficiency ────────────────────────────────────────────────────────────────
  router.get(
    "/fuel-efficiency",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("report:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.report.fuelEfficiency();
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

  // ── Operational analytics counters ───────────────────────────────────────────────────────
  router.get(
    "/analytics",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("report:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.report.analytics();
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
