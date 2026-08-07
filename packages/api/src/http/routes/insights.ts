// packages/api/src/http/routes/insights.ts
// Read-only insights routes (03 §2.7): the unified open-anomaly feed, expiring asset documents, and
// the live vehicle display-state snapshot. Per the openapi contract these GETs carry no auth/idempotency
// (they are polling/snapshot endpoints). They use a pooled client (D8 read path) and keyset pagination
// (D7). The anomaly/document responses are CursorPage envelopes; the dashboard is a full snapshot.

import { Router } from "express";
import { z } from "zod";
import { type PoolLike } from "@fleet/shared";
import { asyncHandler } from "../problem";
import { parseQuery } from "../validate";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const AnomalyQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  domains: z.array(z.enum(["FUEL", "HOS", "ACCIDENT", "MAINTENANCE", "SECURITY"])).optional(),
});
const DocumentQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  within_days: z.coerce.number().int().min(0).max(3650).default(30),
});

export interface InsightsRouterDeps {
  pool: PoolLike;
  infra: Infra;
}

export function createInsightsRouter(deps: InsightsRouterDeps): Router {
  const router = Router();
  const { pool, infra } = deps;

  // ── Unified open-anomaly feed ────────────────────────────────────────────────────────────
  router.get(
    "/anomalies",
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(AnomalyQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.anomaly.feed({ domains: query.domains, limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Expiring asset documents ──────────────────────────────────────────────────────────────
  router.get(
    "/documents/expiring",
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(DocumentQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.document.expiring({ withinDays: query.within_days, limit: query.limit, cursor: query.cursor });
        if (!result.ok) {
          res.status(422).json({ error_code: result.error.error_code, status: 422, title: result.error.title });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── Live vehicle display-state snapshot (N5) ───────────────────────────────────────────────
  router.get(
    "/dashboard/vehicle-states",
    asyncHandler((_req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.dashboard.vehicleStates();
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
