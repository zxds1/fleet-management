// packages/worker/src/config/env.ts
// Typed process configuration for @fleet/worker (05-workers.md, 04-telemetry-ingest.md).
// Secrets (DB/Redis/Traccar/FCM/Africa's Talking) come from the platform secret store
// and are mounted as env; tunable thresholds live in app.system_config (C2.4).

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ROLE: z.enum(["worker", "ingest"]).default("worker"),

  DATABASE_URL: z.string().min(1).default("postgresql://postgres:pg_local_dev@localhost:5444/fleet"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  // Traccar REST (back-fill poller, 04 §4) and Redis Stream source (04 §2).
  TRACCAR_BASE_URL: z.string().default("http://localhost:8082"),
  TRACCAR_USERNAME: z.string().default("admin"),
  TRACCAR_PASSWORD: z.string().default("admin"),
  TRACCAR_POLL_MINUTES: z.coerce.number().int().positive().default(5),
  TRACCAR_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(30),

  // Notification adapters (N9 / A1.8). When absent the sender degrades to a no-op log.
  FCM_SERVER_KEY: z.string().optional(),
  AFRICAS_TALKING_USERNAME: z.string().optional(),
  AFRICAS_TALKING_API_KEY: z.string().optional(),
  NOTIFICATION_FROM: z.string().default("Fleet"),

  // Outbox / scheduler tuning.
  OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  LOCALE_TIMEZONE: z.string().default("Africa/Nairobi"),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().optional(),
  HEALTH_PORT: z.coerce.number().int().positive().default(8082),
  SERVICE_NAME: z.string().default("fleet-worker"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker environment configuration: ${detail}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnv(): void {
  cached = null;
}
