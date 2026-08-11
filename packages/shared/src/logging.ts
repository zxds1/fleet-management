// packages/shared/src/logging.ts
// Structured JSON logger with PII/secret redaction (01-shared-kernel.md §9).

const SENSITIVE_RE = /(pin|password|secret|token|apikey|api_key|key|authorization|cookie|set-cookie|email|phone|ssn|passwordhash)([\s_-]*(value|hash|token))?$/i;

/**
 * Deploy-anchoring (audit #8): read once at module load so every emitted log carries the
 * release/build that produced it. Any of GIT_SHA / RELEASE / BUILD_SHA is accepted; GIT_SHA wins.
 */
const BUILD_SHA = process.env.GIT_SHA ?? process.env.BUILD_SHA ?? undefined;
const RELEASE = process.env.RELEASE ?? BUILD_SHA ?? undefined;

export const deployContext: { release?: string; build_sha?: string } = {
  ...(RELEASE ? { release: RELEASE } : {}),
  ...(BUILD_SHA ? { build_sha: BUILD_SHA } : {}),
};

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured context attached to every derived logger. `service_name` is mandatory so that
 * every emitted entry carries its origin (Layer 2 observability). The remaining fields are optional
 * trace/flow correlation metadata.
 */
export interface LogContext {
  service_name: string;
  trace_id?: string;
  session_id?: string;
  user_cohort?: string;
  flow_step?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void;
  child(defaultMeta: LogContext): Logger;
}

export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_RE.test(k)) out[k] = "[redacted]";
    else out[k] = redact(v, seen);
  }
  return out;
}

export class ConsoleLogger implements Logger {
  constructor(
    private level: LogLevel = "info",
    private defaultMeta: Record<string, unknown> = { service_name: "unknown" },
    private serviceName: string = "unknown",
  ) {
    if (!defaultMeta.service_name) defaultMeta.service_name = this.serviceName;
    else this.serviceName = String(defaultMeta.service_name);
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>, err?: unknown): void {
    const entry = redact(
      {
        level,
        msg,
        time: new Date().toISOString(),
        service_name: this.serviceName,
        ...deployContext,
        ...this.defaultMeta,
        ...(meta ?? {}),
        ...(err ? { error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err } : {}),
      },
      new WeakSet(),
    );
    process.stdout.write(JSON.stringify(entry) + "\n");
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (this.level === "debug") this.log("debug", msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    if (this.level !== "error") this.log("info", msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log("warn", msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.log("error", msg, meta, err);
  }
  child(defaultMeta: LogContext): Logger {
    return new ConsoleLogger(this.level, { ...this.defaultMeta, ...defaultMeta }, defaultMeta.service_name ?? this.serviceName);
  }
}

/**
 * Redacts secrets/PII from a single free-text string (e.g. an error message) by masking common
 * credential patterns. Use before persisting free-text into the audit store (db/errorEvents) so
 * passwords/keys/SQL don't leak into app.error_events.
 */
export function redactString(input: string): string {
  if (!input) return input;
  return input
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .replace(/(authorization|token|api[_-]?key|secret|apikey)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/postgres:\/\/[^:@\s]+:[^@\s]+@/g, "postgres://[redacted]:[redacted]@")
    .replace(/redis:\/\/:[^@\s]+@/g, "redis://:[redacted]@")
    .replace(/([A-Za-z0-9+/]{40,})/g, "[redacted]");
}

export const logger: Logger = new ConsoleLogger();
