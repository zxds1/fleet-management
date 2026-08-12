// packages/api/src/server.ts
// Bootstrap for @fleet/api (03 §1, 09 §1). Builds the container, mounts the Express app, and starts
// listening. SIGTERM/SIGINT drain the pool cleanly so in-flight transactions can finish. Sentry is
// initialised at boot and uncaught errors are reported + flushed before exit (C5.7).

import { logger, initErrorReporter, reportError, flushTelemetry, metrics, consoleMetricSink, deployContext, startMetrics, initTracing, shutdownTracing } from "@fleet/shared";
import { buildContainer } from "./app/container";
import { createApp } from "./app/app";

export function start(): void {
  const container = buildContainer();

  // Fail-closed: refuse to boot in production (or when edge enforcement is on) if the signing
  // secrets are still the well-known insecure dev defaults. A leaked default key would let an
  // attacker forge tokens (Security Layer 2/3).
  const insecureJwt = container.env.JWT_SECRET === "dev-only-insecure-jwt-secret-change-me";
  const insecureMfa = container.env.MFA_ENCRYPTION_KEY === Buffer.alloc(32, 7).toString("base64");
  const mustEnforce = container.env.SECURITY_ENFORCE === "always" || container.env.NODE_ENV === "production";
  if (mustEnforce && (insecureJwt || insecureMfa || !container.env.JWT_SECRET)) {
    throw new Error(
      "Refusing to boot: JWT_SECRET / MFA_ENCRYPTION_KEY use the insecure dev default or are unset. " +
        "Set real secrets via the platform secret store before running in production.",
    );
  }

  initTracing(container.env.SERVICE_NAME);

  initErrorReporter({
    SENTRY_DSN: container.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: container.env.SENTRY_ENVIRONMENT,
    RELEASE: container.env.RELEASE,
    SERVICE_NAME: container.env.SERVICE_NAME,
    NODE_ENV: container.env.NODE_ENV,
  });

  // Emit in-process metrics to the structured log sink (CloudWatch Logs) and flush on an interval.
  metrics.setSink(consoleMetricSink);
  const metricFlush = setInterval(() => metrics.flush(), 15_000);
  if (typeof (metricFlush as { unref?: () => void }).unref === "function") {
    (metricFlush as { unref: () => void }).unref();
  }

  const app = createApp(container);

  const server = app.listen(container.env.PORT, () => {
    logger.info("fleet-api listening", { port: container.env.PORT, base: container.env.API_BASE_PATH });
  });
  startMetrics(server);
  logger.info("service started", { ...deployContext, service: "api" });

  const shutdown = async (signal: string) => {
    logger.info("shutdown signal", { signal });
    server.close();
    await shutdownTracing();
    await flushTelemetry();
    await container.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.error("uncaught exception", { message: (err as Error).message, stack: (err as Error).stack });
    reportError(err, { route: "uncaught" });
    void flushTelemetry().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("unhandled rejection", { message: err.message, stack: err.stack });
    reportError(err, { route: "unhandledRejection" });
    void flushTelemetry().finally(() => process.exit(1));
  });
}

if (require.main === module) {
  start();
}
