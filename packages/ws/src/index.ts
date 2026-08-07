// packages/ws/src/index.ts
// Process entrypoint for the Socket.IO gateway (07-websocket-gateway.md). Builds the collaborators
// (pool, Redis, ConfigClient, token verifier, read repositories, event bus), attaches the gateway to
// a Socket.IO server, and owns graceful shutdown. The gateway holds no system of record (07 §1).
// Sentry is initialised at boot and uncaught errors are reported before exit (C5.7).

import { createServer, type Server as HttpServer } from "http";
import { Server } from "socket.io";
import { logger, initErrorReporter, reportError, flushTelemetry } from "@fleet/shared";
import { createPool, PgConfigClient, type FleetPool } from "@fleet/db";
import { loadEnv, type Env } from "./config/env";
import { createRedis, type RedisBundle } from "./config/redis";
import { verifyAccessToken, principalFromClaims } from "./security/tokens";
import { AccountStatusRepository } from "./repositories/identity";
import { DriverRepository, NotificationRepository, OnCallRepository, VehicleStateRepository } from "./repositories/views";
import { RedisEventBus, MemoryEventBus, type EventBus } from "./pubsub";
import { attachGateway, type GatewayDeps } from "./gateway";

export interface WsProcess {
  httpServer: HttpServer;
  io: Server;
  deps: GatewayDeps;
  close(): Promise<void>;
}

export async function bootstrap(environment: Env = loadEnv()): Promise<WsProcess> {
  const pool: FleetPool = createPool({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    statementTimeoutMs: environment.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  const redis: RedisBundle = createRedis(environment);
  const config = new PgConfigClient(pool, redis.cache);

  // One dedicated pooled client for the gateway's read-only recomputations (07 §3).
  const readClient = await pool.connect();

  const accountStatus = new AccountStatusRepository(readClient);
  const vehicleRepo = new VehicleStateRepository(readClient);
  const notifRepo = new NotificationRepository(readClient);
  const onCallRepo = new OnCallRepository(readClient);
  const driverRepo = new DriverRepository(readClient);

  const bus: EventBus = environment.REDIS_ENABLED ? new RedisEventBus(environment.REDIS_URL) : new MemoryEventBus();

  const deps: GatewayDeps = {
    env: environment,
    verifyToken: (token) => principalFromClaims(verifyAccessToken(token, environment)),
    store: redis.sessions,
    config,
    accountStatus,
    vehicleSnapshot: () => vehicleRepo.snapshot(),
    notificationsFor: (userId) => notifRepo.unread(userId),
    isAccidentOnCall: (userId) => onCallRepo.isAccidentOnCall(userId),
    driverContext: (userId) => driverRepo.activeContext(userId),
    driverVehicleState: (vehicleId) => driverRepo.vehicleState(vehicleId),
    driverShiftState: (shiftId) => driverRepo.shiftState(shiftId),
    bus,
  };

  const httpServer = createServer(async (_req, res) => {
    if (_req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (_req.url === "/readyz") {
      const checks: Record<string, boolean> = {};
      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          checks.postgres = true;
        } finally {
          client.release?.();
        }
      } catch {
        checks.postgres = false;
      }
      checks.redis = redis.client !== null;
      const ok = Object.values(checks).every(Boolean);
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ok ? "ready" : "degraded", checks }));
      return;
    }
    res.writeHead(200);
    res.end("fleet-ws");
  });

  const io = new Server(httpServer, { cors: { origin: false } });
  attachGateway(io, deps);

  return {
    httpServer,
    io,
    deps,
    async close() {
      io.close();
      await bus.close().catch(() => undefined);
      await redis.close().catch(() => undefined);
      readClient.release?.();
      await pool.end().catch(() => undefined);
    },
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  initErrorReporter({
    SENTRY_DSN: env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
    RELEASE: env.RELEASE,
    SERVICE_NAME: env.SERVICE_NAME,
    NODE_ENV: env.NODE_ENV,
  });
  const proc = await bootstrap(env);
  proc.httpServer.listen(env.WS_PORT, () => {
    logger.info("fleet-ws listening", { port: env.WS_PORT });
  });

  const shutdown = (signal: string) => {
    logger.info("fleet-ws shutting down", { signal });
    void proc.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.error("fleet-ws uncaught exception", { message: (err as Error).message, stack: (err as Error).stack });
    reportError(err, { route: "uncaught" });
    void flushTelemetry().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("fleet-ws unhandled rejection", { message: err.message, stack: err.stack });
    reportError(err, { route: "unhandledRejection" });
    void flushTelemetry().finally(() => process.exit(1));
  });
}

// Run only when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    logger.error("fleet-ws failed to start", { message: (err as Error).message });
    process.exit(1);
  });
}
