// packages/api/src/config/env.ts
// Typed process configuration. Real secrets (JWT key, S3/KMS, DB/Redis URLs) come from the
// platform secret store and are mounted as env (00-overview.md §6); system_config holds only
// tunable thresholds (C2.4) and never a secret.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  API_BASE_PATH: z.string().default("/api/v1"),

  DATABASE_URL: z.string().min(1).default("postgresql://postgres:pg_local_dev@localhost:5444/fleet"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  // A3.7 — HS256, current + previous key for a 24 h rotation overlap (02 §1).
  JWT_SECRET: z.string().min(16).default("dev-only-insecure-jwt-secret-change-me"),
  JWT_SECRET_PREVIOUS: z.string().optional(),
  JWT_KID: z.string().default("k1"),
  JWT_KID_PREVIOUS: z.string().default("k0"),
  JWT_ISSUER: z.string().default("fleet-api"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min (02 §1)
  MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300), // 5 min (02 §2)
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // AES-GCM data key for users.mfa_secret_encrypted (02 §3). 32 bytes, base64.
  MFA_ENCRYPTION_KEY: z.string().default(Buffer.alloc(32, 7).toString("base64")),

  // D5 — private buckets, 60 s presigned PUT, separate Object-Locked accident bucket.
  AWS_REGION: z.string().default("af-south-1"),
  S3_MEDIA_BUCKET: z.string().default("fleet-media-local"),
  S3_ACCIDENT_BUCKET: z.string().default("fleet-accident-evidence-local"),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  MEDIA_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // AWS SigV4 signing credentials for the presigned PUT (D5). Real secrets, mounted from the
  // platform secret store (00 §6); optional so dev boxes without S3 degrade to the canonical endpoint.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  RELEASE: z.string().optional(),
  SERVICE_NAME: z.string().default("fleet-api"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Login throttling (02 §9 / M4).
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
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
