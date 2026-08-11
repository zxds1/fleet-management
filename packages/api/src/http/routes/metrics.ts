// packages/api/src/http/routes/metrics.ts
// Prometheus metrics endpoint (09-observability-ci.md §1). Exposes the app-level
// metrics registered in @fleet/shared/src/metrics.ts. Deliberately mounted OUTSIDE auth
// and rate limiting — Prometheus/Grafana Cloud scrapes this unauthenticated on a
// private network or with a sidecar TLS/mTLS policy configured at the ingress layer.

import type { RequestHandler } from "express";
import { appMetrics, logger } from "@fleet/shared";

export function metricsHandler(): RequestHandler {
  return async (_req, res) => {
    if (!appMetrics.isInitialised()) {
      res.status(503).type("text/plain").send("metrics not initialised");
      return;
    }
    try {
      res.setHeader("Content-Type", appMetrics.contentType());
      res.status(200).send(await appMetrics.render());
    } catch (e) {
      logger.error("metrics render error", { message: (e as Error).message });
      res.status(500).type("text/plain").send("metrics render error");
    }
  };
}
