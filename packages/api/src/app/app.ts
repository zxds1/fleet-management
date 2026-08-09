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
import { createAdminRouter } from "../http/routes/admin";
import { createOnboardingRouter } from "../http/routes/onboarding";
import { createVehicleRouter } from "../http/routes/vehicles";
import { createVehicleIssueRouter } from "../http/routes/vehicleIssue";
import { createMaintenanceRouter } from "../http/routes/maintenance";
import { createTrainingRouter } from "../http/routes/training";
import { createReportsRouter } from "../http/routes/reports";
import { createSettingsRouter } from "../http/routes/settings";
import { createNotificationRouter } from "../http/routes/notifications";
import { createTelemetryRouter } from "../http/routes/telemetry";
import { readiness, deepHealth } from "./health";
import type { Container } from "./container";
import { safeJson } from "../security/bodyParser";
import { securityHeaders } from "../security/headers";
import { corsMiddleware } from "../security/cors";
import { createRateLimiter } from "../security/rateLimit";
import { createIpBlocker } from "../security/ipBlock";
import { webhookAuth } from "../security/webhookAuth";

export function createApp(container: Container): Express {
  const app = express();
  const base = container.env.API_BASE_PATH;

  app.use(helmet());
  app.use(requestContext());

  // Edge / abuse protection (security.md S-3). Enforcement is gated by SECURITY_ENFORCE so tests/dev
  // are never throttled; it activates in production (or "always"). The webhook HMAC is opt-in via
  // WEBHOOK_SECRET.
  const secure = container.env.SECURITY_ENFORCE === "always" || (container.env.SECURITY_ENFORCE === "production" && container.env.NODE_ENV === "production");
  if (container.env.TRUST_PROXY) app.set("trust proxy", true);
  app.use(safeJson());
  app.use(securityHeaders());
  app.use(corsMiddleware(container.env.ALLOWED_ORIGINS));

  const rateLimiter = createRateLimiter(container.redis.client, secure);
  const ipBlocker = createIpBlocker(container.redis.client, secure, {
    threshold: container.env.IP_BLOCK_THRESHOLD,
    windowMs: container.env.IP_BLOCK_WINDOW_SECONDS * 1000,
    blockTtlSeconds: container.env.IP_BLOCK_TTL_SECONDS,
  });
  app.use(rateLimiter.middleware({ scope: "global", max: container.env.RATE_LIMIT_GLOBAL_PER_MINUTE }));
  app.use(ipBlocker.middleware());

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

  app.use(`${base}/auth`, rateLimiter.middleware({ scope: "auth", max: container.env.RATE_LIMIT_AUTH_PER_MINUTE }));
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

  app.use(`${base}/media`, rateLimiter.middleware({ scope: "media", max: container.env.RATE_LIMIT_MEDIA_PER_MINUTE }));
  app.use(`${base}/media`, createMediaRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  // Driver onboarding + background check. Mounted at the literal `${base}/drivers/me` BEFORE the
  // admin router (which owns `${base}/drivers` and `${base}/drivers/:id`), so the "me" segment can
  // never be captured as an `:id`. Express matches mounts in registration order.
  app.use(`${base}/drivers/me`, createOnboardingRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  // Admin console surface (A3.7): driver roster + device/session revoke.
  // Mounted at the API base so paths match the locked contract: /drivers, /devices/{deviceId}/revoke,
  // /sessions/revoke.
  app.use(`${base}`, createAdminRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}`, createInsightsRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  // Vehicle master data (Pillar 4). The router declares absolute `/vehicles` paths internally, so
  // it mounts at the API base rather than at `${base}/vehicles` (which would double the prefix).
  app.use(`${base}`, createVehicleRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  // Driver-reported vehicle issues (spec `report_vehicle_issue`). Also declares absolute
  // `/vehicles/{vehicleId}/issues` paths, so it mounts at the API base alongside the vehicle router.
  app.use(`${base}`, createVehicleIssueRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/maintenance`, createMaintenanceRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/training`, createTrainingRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/reports`, createReportsRouter({
    pool: container.pool,
    infra: container.infra,
  }));

  // Admin trigger thresholds (C2.4): GET/PUT `${base}/admin/settings/triggers`.
  app.use(`${base}/admin/settings`, createSettingsRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  app.use(`${base}/notifications`, createNotificationRouter({
    pool: container.pool,
    idempotency: container.idempotency,
    releaseClaim: container.releaseClaim,
    infra: container.infra,
  }));

  // Public Traccar webhook accept (A1.1) — no auth/idempotency; front of the ingest pipeline.
  // Hardened: rate-limited + HMAC-verified when WEBHOOK_SECRET is set (security.md S-1).
  app.use(`${base}/telemetry`, rateLimiter.middleware({ scope: "telemetry", max: container.env.RATE_LIMIT_TELEMETRY_PER_MINUTE }));
  app.use(`${base}/telemetry`, webhookAuth(container.env.WEBHOOK_SECRET));
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
