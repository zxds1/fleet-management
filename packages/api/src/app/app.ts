// packages/api/src/app/app.ts
// Express composition (03 §1). Order matters: correlation id → security headers → body parsing →
// routers → RFC7807 problem handler (D7). Auth routes live under API_BASE_PATH. Health endpoints are
// deliberately outside the auth boundary.

import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import { requestContext } from "../http/requestContext";
import { problemHandler } from "../http/problem";
import { asyncHandler } from "../http/problem";
import { createAuthRouter } from "../http/routes/auth";
import { createShiftRouter } from "../http/routes/shifts";
import { createFuelRouter, createReconciliationRouter } from "../http/routes/fuel";
import { createAccidentRouter } from "../http/routes/accidents";
import { createInspectionRouter } from "../http/routes/inspections";
import { createTrailerRouter } from "../http/routes/trailer";
import { createMediaRouter } from "../http/routes/media";
import { createInsightsRouter } from "../http/routes/insights";
import { createTelemetryRouter } from "../http/routes/telemetry";
import { readiness, deepHealth } from "./health";
import type { Container } from "./container";

export function createApp(container: Container): Express {
  const app = express();
  const base = container.env.API_BASE_PATH;

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestContext());

  // Liveness / readiness / deep probes (09 §1/§2). Deep checks inspect replication lag, outbox
  // backlog and last ingest position age; each degrades independently.
  app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get(
    "/readyz",
    asyncHandler(async (_req: Request, res: Response) => {
      const result = await readiness(container.pool, container.infra.presigner);
      res.status(result.status === "ok" ? 200 : 503).json(result);
    }),
  );
  app.get(
    "/health/deep",
    asyncHandler(async (_req: Request, res: Response) => {
      const result = await deepHealth(container.pool);
      res.status(result.status === "ok" ? 200 : 503).json(result);
    }),
  );

  app.use(`${base}/auth`, createAuthRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/shifts`, createShiftRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/fuel`, createFuelRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/reconciliation`, createReconciliationRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/accidents`, createAccidentRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/inspections`, createInspectionRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/trailer`, createTrailerRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/media`, createMediaRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}`, createInsightsRouter({
    pool: container.pool,
    infra: container.infra,
  }));

  // Public Traccar webhook accept (A1.1) — no auth/idempotency; front of the ingest pipeline.
  app.use(`${base}/telemetry`, createTelemetryRouter({
    pool: container.pool,
    redis: container.redis.client,
  }));

  // Unknown route → 404 problem.
  app.use((req, res) => {
    res.status(404).type("application/problem+json").json({
      type: "https://docs.fleet.internal/problems/not_found",
      title: "Not found",
      status: 404,
      detail: `No route for ${req.method} ${req.path}`,
      instance: req.requestId,
      error_code: "NOT_FOUND",
    });
  });

  app.use(problemHandler());
  return app;
}
