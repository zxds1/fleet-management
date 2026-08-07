// packages/db/src/config.ts
// ConfigClient bound to app.system_config (C2.4). The authoritative DDL stores the value as
// `jsonb` plus a `value_type` discriminator ('number'|'string'|'boolean'|'json'|'array'), so the
// client reads `value` and coerces. Results are cached in the supplied Cache (Redis in
// production) with a short TTL, falling back to CONFIG_DEFAULTS when the row is absent.
// No magic numbers in code — every threshold funnels through here (01 §7).

import type {
  BooleanConfigKey,
  ConfigClient,
  NumericConfigKey,
  PoolLike,
  StringConfigKey,
} from "@fleet/shared";
import { CONFIG_DEFAULTS } from "@fleet/shared";

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del?(key: string): Promise<void>;
}

export interface ConfigClientOptions {
  cacheTtlSeconds?: number;
}

const SELECT = `
  SELECT value, value_type
  FROM app.system_config
  WHERE key = $1`;

export class PgConfigClient implements ConfigClient {
  private readonly cacheTtl: number;

  constructor(
    private readonly pool: PoolLike,
    private readonly cache?: Cache,
    opts: ConfigClientOptions = {},
  ) {
    this.cacheTtl = opts.cacheTtlSeconds ?? 30;
  }

  async numeric(key: NumericConfigKey, defaultOverride?: number): Promise<number> {
    const v = await this.read(key);
    if (v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
    return defaultOverride ?? (CONFIG_DEFAULTS[key] as number | undefined) ?? 0;
  }

  async string(key: StringConfigKey, defaultOverride?: string | null): Promise<string | null> {
    const v = await this.read(key);
    if (v !== null) return v;
    return defaultOverride ?? (CONFIG_DEFAULTS[key] as string | undefined) ?? null;
  }

  async boolean(key: BooleanConfigKey, defaultOverride?: boolean): Promise<boolean> {
    const v = await this.read(key);
    if (v !== null) return v === "true" || v === "t" || v === "1";
    return defaultOverride ?? (CONFIG_DEFAULTS[key] as boolean | undefined) ?? false;
  }

  /** Invalidate a cached key after an admin write-through (01 §7). */
  async invalidate(key: string): Promise<void> {
    await this.cache?.del?.(`config:${key}`);
  }

  private async read(key: string): Promise<string | null> {
    const cacheKey = `config:${key}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached !== null) return cached;
    }
    const client = await this.pool.connect();
    try {
      const res = await client.query<{ value: unknown; value_type: string }>(SELECT, [key]);
      const row = res.rows[0];
      if (!row) return null;
      const raw = normalise(row.value, row.value_type);
      if (raw === null) return null;
      if (this.cache) await this.cache.set(cacheKey, raw, this.cacheTtl);
      return raw;
    } finally {
      client.release?.();
    }
  }
}

/** jsonb value + value_type -> the canonical string form the accessors coerce from. */
function normalise(value: unknown, valueType: string): string | null {
  if (value === null || value === undefined) return null;
  if (valueType === "json" || valueType === "array") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
