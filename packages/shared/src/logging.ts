// packages/shared/src/logging.ts
// Structured JSON logger with PII/secret redaction (01-shared-kernel.md §9).

const SENSITIVE_RE = /(pin|password|secret|token|apikey|api_key|key)$/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void;
  child(defaultMeta: Record<string, unknown>): Logger;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
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
    private defaultMeta: Record<string, unknown> = {},
  ) {}

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>, err?: unknown): void {
    const entry = redact(
      {
        level,
        msg,
        time: new Date().toISOString(),
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
  child(defaultMeta: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.level, { ...this.defaultMeta, ...defaultMeta });
  }
}

export const logger: Logger = new ConsoleLogger();
