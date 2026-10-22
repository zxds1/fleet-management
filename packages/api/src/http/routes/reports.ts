// packages/api/src/http/routes/reports.ts
// Reporting routes (Pillar 6). The fuel-efficiency report is a read-only aggregate over existing
// tables and views, so it uses a pooled client (D8 read path) and emits RFC7807 via
// result.error.toProblem(). It is not paginated: it returns a single summary object.
//
// `GET /reports/analytics` is intentionally NOT declared here. `analytics.ts`'s `company()` route
// (mounted at both /analytics and /reports) is the canonical handler: its response spreads the flat
// `legacyCounters()` at the top level, so the mobile `AnalyticsReportSchema` parses unchanged, and it
// is scope-aware (a FLEET_MANAGER's dashboard shows their slice, not the whole company — see
// services/analytics.ts). Declaring /analytics here too double-registered the path and shadowed the
// scoped view (the first `app.use` mount wins in Express).

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
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
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

  return router;
}
