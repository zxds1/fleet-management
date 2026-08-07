// packages/worker/src/index.ts
// @fleet/worker entrypoint. One image, two modes (00 §3): `--role ingest` runs the Traccar
// telemetry consumer + back-fill poller (04); `--role worker` (default) runs the outbox relay
// and the scheduled job registry (05). Graceful shutdown on SIGINT/SIGTERM. Sentry is initialised
// at boot and uncaught errors are reported before exit (C5.7).

import { logger, initErrorReporter, reportError, flushTelemetry } from "@fleet/shared";
import { bootInfra, type WorkerInfra } from "./infra";
import { env } from "./config/env";
import { startHealthServer } from "./health";
import { IngestConsumer } from "./ingest/consumer";
import { BackfillPoller } from "./ingest/backfill";
import { createOutboxRelay, registerHandlers, type RelayInfra } from "./outbox/relay";
import { buildSchedule, JobScheduler } from "./jobs/scheduler";
import { EnvMediaPresigner } from "./media/presigner";
import type { VisionAdapter } from "./jobs/ocr";
import type { CsvParser, StatementLine } from "./jobs/reconciliation";

const NoopVision: VisionAdapter = {
  async analyse() {
    return { litres: null, totalCost: null, confidence: null };
  },
};

const NoopParser: CsvParser = {
  parse(): StatementLine[] {
    return [];
  },
};

function parseRole(argv: string[]): "worker" | "ingest" {
  const i = argv.indexOf("--role");
  if (i >= 0 && argv[i + 1] === "ingest") return "ingest";
  if (argv.includes("ingest")) return "ingest";
  return "worker";
}

async function main(): Promise<void> {
  const e = env();
  const role = parseRole(process.argv);
  initErrorReporter({
    SENTRY_DSN: e.SENTRY_DSN,
    SENTRY_ENVIRONMENT: e.SENTRY_ENVIRONMENT,
    RELEASE: e.RELEASE,
    SERVICE_NAME: e.SERVICE_NAME,
    NODE_ENV: e.NODE_ENV,
  });
  logger.info("worker booting", { role, nodeEnv: e.NODE_ENV });

  const infra = await bootInfra({ ...e, ROLE: role });
  const health = startHealthServer(e.HEALTH_PORT, infra.pool, infra.redis);
  const shutdown = async () => {
    logger.info("worker shutting down");
    await health.close();
    await infra.shutdown();
    await flushTelemetry();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("uncaughtException", (err) => {
    logger.error("worker uncaught exception", { message: (err as Error).message, stack: (err as Error).stack });
    reportError(err, { route: "uncaught" });
    void flushTelemetry().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("worker unhandled rejection", { message: err.message, stack: err.stack });
    reportError(err, { route: "unhandledRejection" });
    void flushTelemetry().finally(() => process.exit(1));
  });

  if (role === "ingest") {
    const consumer = new IngestConsumer({ pool: infra.pool, config: infra.config, redis: infra.redis.client });
    const backfill = new BackfillPoller({
      baseUrl: e.TRACCAR_BASE_URL,
      username: e.TRACCAR_USERNAME,
      password: e.TRACCAR_PASSWORD,
      lookbackMinutes: e.TRACCAR_LOOKBACK_MINUTES,
      pollMinutes: e.TRACCAR_POLL_MINUTES,
      onPositions: (positions) => consumer.processPositions(positions),
    });
    await consumer.start();
    await backfill.start();
    await new Promise<void>(() => {}); // run forever until signal
    return;
  }

  const relayInfra: RelayInfra = {
    pool: infra.pool,
    config: infra.config,
    env: e,
    vision: NoopVision,
    parser: NoopParser,
    publisher: infra.publisher,
  };
  const relay = createOutboxRelay(infra.pool, e);
  registerHandlers(relay, relayInfra);
  relay.start();

  const presigner = new EnvMediaPresigner(e);
  const scheduler = new JobScheduler(buildSchedule(infra.pool, infra.config, e, NoopVision, infra.publisher, presigner));
  scheduler.start();

  await new Promise<void>(() => {});
}

if (require.main === module) {
  main().catch((e) => {
    logger.error("worker fatal", { message: (e as Error).message, stack: (e as Error).stack });
    process.exit(1);
  });
}
