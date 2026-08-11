import { SentryReactNative, type SentryReactNativeOptions } from "@sentry/react-native";

export interface SentryErrorContext {
  code?: string;
  route?: string;
  requestId?: string;
  principalId?: string;
  message?: string;
}

let sentryReady = false;

/**
 * Initialises Sentry crash reporting (C5.7). Safe to call when no DSN is configured —
 * it becomes a no-op so test/demo builds without a DSN never crash.
 *
 * The DSN is read from `expo-constants` (populated from `app.json` at build time),
 * falling back to the `SENTRY_DSN` environment variable for local dev.
 */
export function initSentry(): void {
  if (sentryReady) return;
  const dsn = readDsn();
  if (!dsn) return;
  const release = readRelease();
  const environment = readEnvironment();
  try {
    SentryReactNative.init({
      dsn,
      release,
      environment,
      tracesSampleRate: 0,
      _experiments: { nativeClassificationsReportEnabled: true },
    } as SentryReactNativeOptions);
    sentryReady = true;
  } catch {
    /* Sentry initialisation must never break app boot */
  }
}

export function isSentryReady(): boolean {
  return sentryReady;
}

/**
 * Captures an exception to Sentry, tagged by the app's `error_code` (the grouping key,
 * 09 §1) and the principal id (no PII). No-op when Sentry is uninitialised.
 * Mirrors the `@fleet/shared` telemetry reporter contract for the mobile layer.
 */
export function captureException(err: unknown, ctx: SentryErrorContext = {}): void {
  if (!sentryReady) return;
  const tags: Record<string, string> = {};
  if (ctx.code) tags.error_code = ctx.code;
  if (ctx.route) tags.route = ctx.route;
  try {
    SentryReactNative.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags,
      user: ctx.principalId ? { id: ctx.principalId } : undefined,
      extra: { requestId: ctx.requestId, message: ctx.message },
    });
  } catch {
    /* capture must never throw */
  }
}

/** Drains buffered Sentry events before app exit (no-op when uninitialised). */
export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  if (!sentryReady) return true;
  try {
    await SentryReactNative.flush(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

function readDsn(): string | undefined {
  if (typeof process !== "undefined" && process.env?.SENTRY_DSN) return process.env.SENTRY_DSN;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    const dsn = Constants?.manifest?.extra?.sentryDsn ?? Constants?.expoConfig?.extra?.sentryDsn;
    if (dsn) return dsn;
  } catch {
    /* expo-constants may be absent in node test env */
  }
  return undefined;
}

function readRelease(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    return Constants?.manifest?.version ?? Constants?.expoConfig?.version ?? "0.0.0";
  } catch {
    return undefined;
  }
}

function readEnvironment(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    const env = Constants?.manifest?.extra?.environment ?? Constants?.expoConfig?.extra?.environment;
    if (typeof env === "string") return env;
  } catch {
    /* fall through */
  }
  return process?.env?.NODE_ENV ?? "development";
}
