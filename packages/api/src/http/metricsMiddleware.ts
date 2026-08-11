// packages/api/src/http/metricsMiddleware.ts
// Records per-request HTTP latency and error counts to the Prometheus metrics collector
// (09-observability-ci.md §1). Mounted after requestContext (so requestId exists) and
// before routers, so the timer captures the full handler duration including DB/Redis I/O.

import type { RequestHandler } from "express";
import { httpRequestDurationM, httpRequestsTotalM, errorsTotalM } from "@fleet/shared";

const HEALTH_PATHS = new Set(["/healthz", "/readyz", "/health/deep", "/metrics"]);

function routeOf(path: string): string {
  const trimmed = path.replace(/\/api\/v\d+/, "");
  if (trimmed.startsWith("/telemetry/webhook")) return "/telemetry/webhook";
  if (trimmed.startsWith("/auth")) return "/auth/*";
  if (trimmed.startsWith("/shifts")) return "/shifts/*";
  if (trimmed.startsWith("/fuel")) return "/fuel/*";
  if (trimmed.startsWith("/vehicles")) return "/vehicles/*";
  if (trimmed.startsWith("/accidents")) return "/accidents/*";
  if (trimmed.startsWith("/inspections")) return "/inspections/*";
  if (trimmed.startsWith("/trailer")) return "/trailer/*";
  if (trimmed.startsWith("/media")) return "/media/*";
  if (trimmed.startsWith("/analytics")) return "/analytics/*";
  if (trimmed.startsWith("/reports")) return "/reports/*";
  if (trimmed.startsWith("/admin")) return "/admin/*";
  if (trimmed.startsWith("/maintenance")) return "/maintenance/*";
  if (trimmed.startsWith("/training")) return "/training/*";
  if (trimmed.startsWith("/notifications")) return "/notifications/*";
  if (trimmed.startsWith("/onboarding")) return "/onboarding/*";
  if (trimmed.startsWith("/privacy")) return "/privacy/*";
  if (trimmed.startsWith("/settings")) return "/settings/*";
  if (trimmed.startsWith("/driver/fuel")) return "/driver/fuel/*";
  if (trimmed.startsWith("/hardware")) return "/hardware/*";
  if (trimmed.startsWith("/reconciliation")) return "/reconciliation/*";
  if (trimmed.startsWith("/insights")) return "/insights/*";
  if (trimmed.startsWith("/dashboard")) return "/dashboard/*";
  return "other";
}

export function metricsMiddleware(): RequestHandler {
  const duration = httpRequestDurationM();
  const requests = httpRequestsTotalM();
  const errors = errorsTotalM();
  return (req, res, next) => {
    if (HEALTH_PATHS.has(req.path)) {
      next();
      return;
    }
    const route = routeOf(req.path);
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels: Record<string, string> = {
        method: req.method,
        route,
        status: String(res.statusCode),
      };
      duration.observe(labels, elapsedSeconds);
      requests.inc(labels);
      if (res.statusCode >= 500) {
        const errorCode = res.getHeader("x-error-code") as string | undefined;
        errors.inc({ error_code: errorCode ?? "UNKNOWN", route }, 1);
      }
    });
    next();
  };
}
