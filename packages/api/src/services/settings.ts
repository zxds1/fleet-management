// packages/api/src/services/settings.ts
// Admin trigger/threshold settings (C2.4). `app.system_config` is the single store for every
// runtime-tunable value in the platform, so this service is deliberately narrow: it exposes only
// the curated TRIGGER_KEYS allow-list, never the whole table. That allow-list is code, not request
// input, which keeps the SQL identifier-free (00 §4 invariant 1) and stops an admin editing an
// unrelated retention or security key through the triggers screen.
//
// Returns Result<T> and never throws for a domain rule (08 §1).

import { type Result, type Tx, ok, err, NotFound, violation } from "@fleet/shared";
import type { SettingsRepository } from "../repositories/settings";

/**
 * The trigger keys surfaced on the admin triggers screen. Adding a key here is the only way to
 * make it readable/writable through this endpoint.
 */
export const TRIGGER_KEYS = [
  "accident.ack_timeout_minutes",
  "anomaly.speed_threshold_kph",
  "dvir.defect_quarantine",
  "fuel.anomaly_threshold",
  "speed.limit_kph",
  "fuel.anomaly_gauge_deviation_pct",
  "maintenance.auto_quarantine_enabled",
] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];

export interface TriggerSetting {
  key: string;
  value: unknown;
  value_type: string;
  description: string;
}

const TRIGGER_KEY_SET: ReadonlySet<string> = new Set<string>(TRIGGER_KEYS);

export function isTriggerKey(key: string): key is TriggerKey {
  return TRIGGER_KEY_SET.has(key);
}

/**
 * Sensitive values are redacted in API responses by contract (see the column comment on
 * app.system_config.is_sensitive), so never let one reach the wire.
 */
const REDACTED = "***";

export class SettingsService {
  constructor(private readonly settings: SettingsRepository) {}

  /**
   * Reads the trigger allow-list. Keys that are not seeded yet are simply absent from the result
   * rather than being reported as an error — the screen renders what exists.
   */
  async listTriggers(): Promise<Result<{ data: TriggerSetting[] }>> {
    const rows = await this.settings.findByKeys(TRIGGER_KEYS);
    return ok({
      data: rows.map((row) => ({
        key: row.key,
        value: row.is_sensitive ? REDACTED : row.value,
        value_type: row.value_type,
        description: row.description,
      })),
    });
  }

  /**
   * Updates a single trigger value. The key must be in the allow-list, the row must already exist
   * (this endpoint tunes thresholds, it does not create config), and the value must satisfy the
   * row's declared value_type and min/max bounds so the DB CHECKs never surface as a 500.
   */
  async updateTrigger(
    tx: Tx,
    input: { key: string; value: unknown },
    actor: { userId: string },
  ): Promise<Result<TriggerSetting>> {
    if (!isTriggerKey(input.key)) {
      return err(
        violation(
          "CONFIG_KEY_NOT_ALLOWED",
          "Configuration key not editable",
          `"${input.key}" is not one of the editable trigger keys.`,
        ),
      );
    }

    const existing = await this.settings.findByKey(input.key);
    if (!existing) return err(new NotFound(`Configuration key "${input.key}" is not defined`));

    const typeCheck = validateValue(existing.value_type, input.value);
    if (!typeCheck.ok) {
      return err(
        violation("CONFIG_VALUE_INVALID", "Configuration value invalid", typeCheck.detail, [
          { field: "value", code: "INVALID_TYPE", message: typeCheck.detail },
        ]),
      );
    }

    const bounds = checkBounds(existing.min_value, existing.max_value, input.value);
    if (!bounds.ok) {
      return err(
        violation("CONFIG_VALUE_OUT_OF_RANGE", "Configuration value out of range", bounds.detail, [
          { field: "value", code: "OUT_OF_RANGE", message: bounds.detail },
        ]),
      );
    }

    const row = await this.settings.updateValue(input.key, JSON.stringify(input.value), actor.userId);
    if (!row) return err(new NotFound(`Configuration key "${input.key}" is not defined`));

    tx.registerOutbox({
      event_type: "config.trigger.updated",
      aggregate_type: "system_config",
      aggregate_id: row.key,
      payload: { key: row.key, value: row.is_sensitive ? REDACTED : row.value },
    });

    return ok({
      key: row.key,
      value: row.is_sensitive ? REDACTED : row.value,
      value_type: row.value_type,
      description: row.description,
    });
  }
}

/** Mirrors the app.system_config value_type CHECK so a bad type is a 422, not a DB error. */
export function validateValue(valueType: string, value: unknown): { ok: true } | { ok: false; detail: string } {
  switch (valueType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, detail: "Expected a finite number." };
    case "string":
      return typeof value === "string" ? { ok: true } : { ok: false, detail: "Expected a string." };
    case "boolean":
      return typeof value === "boolean" ? { ok: true } : { ok: false, detail: "Expected a boolean." };
    case "array":
      return Array.isArray(value) ? { ok: true } : { ok: false, detail: "Expected an array." };
    case "json":
      return value !== undefined ? { ok: true } : { ok: false, detail: "Expected a JSON value." };
    default:
      return { ok: false, detail: `Unsupported value_type "${valueType}".` };
  }
}

/** min_value/max_value are numeric columns and only constrain numeric settings. */
export function checkBounds(
  min: string | null,
  max: string | null,
  value: unknown,
): { ok: true } | { ok: false; detail: string } {
  if (typeof value !== "number") return { ok: true };
  if (min != null && value < Number(min)) return { ok: false, detail: `Value must be >= ${min}.` };
  if (max != null && value > Number(max)) return { ok: false, detail: `Value must be <= ${max}.` };
  return { ok: true };
}
