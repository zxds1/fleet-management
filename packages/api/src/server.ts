// packages/api/src/server.ts
// Bootstrap for @fleet/api (03 §1, 09 §1). Builds the container, mounts the Express app, and starts
// listening. SIGTERM/SIGINT drain the pool cleanly so in-flight transactions can finish. Sentry is
// initialised at boot and uncaught errors are reported + flushed before exit (C5.7).

import { logger, initErrorReporter, reportError, flushTelemetry } from "@fleet/shared";
import { buildContainer } from "./app/container";
import { createApp } from "./app/app";

export function start(): void {
  const container = buildContainer();
  initErrorReporter({
    SENTRY_DSN: container.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: container.env.SENTRY_ENVIRONMENT,
    RELEASE: container.env.RELEASE,
    SERVICE_NAME: container.env.SERVICE_NAME,
    NODE_ENV: container.env.NODE_ENV,
  });

  const app = createApp(container);

  const server = app.listen(container.env.PORT, () => {
    logger.info("fleet-api listening", { port: container.env.PORT, base: container.env.API_BASE_PATH });
  });

  const shutdown = async (signal: string) => {
    logger.info("shutdown signal", { signal });
    server.close();
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
