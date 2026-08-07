// packages/ws/src/config/env.ts
// Typed process configuration for the Socket.IO gateway (07-websocket-gateway.md). Mirrors the api
// env shape so the same JWT signing key + Redis invalidate sessions across both processes (02 §6).
// Real secrets come from the platform secret store (00-overview.md §6).

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WS_PORT: z.coerce.number().int().positive().default(8081),

  DATABASE_URL: z.string().min(1).default("postgresql://postgres:pg_local_dev@localhost:5444/fleet"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  // A3.7 — HS256, current + previous key for a 24 h rotation overlap (02 §1). Shared with @fleet/api.
  JWT_SECRET: z.string().min(16).default("dev-only-insecure-jwt-secret-change-me"),
  JWT_SECRET_PREVIOUS: z.string().optional(),
  JWT_KID: z.string().default("k1"),
  JWT_KID_PREVIOUS: z.string().default("k0"),
  JWT_ISSUER: z.string().default("fleet-api"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().optional(),
  SERVICE_NAME: z.string().default("fleet-ws"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test hook — resets the memoised env. */
export function resetEnv(): void {
  cached = null;
}
