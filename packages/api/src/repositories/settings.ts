// packages/api/src/repositories/settings.ts
// System configuration repository (03_platform_core.sql). `app.system_config` is the single store
// for every runtime-tunable threshold (C2.4) — there are no magic numbers in code. The key is the
// primary key and is always supplied from a code-side allow-list, never interpolated from request
// input (00 §4 invariant 1). Sensitive values are redacted by the service, not here.

import { BaseRepository } from "@fleet/db";
import type { DbClient, SystemConfigRow } from "@fleet/shared";

export class SettingsRepository extends BaseRepository<SystemConfigRow> {
  constructor(client: DbClient) {
    // Keyed by `key`, not `id`, and never soft-deleted (hard delete is trigger-rejected).
    super(client, "app.system_config", { idColumn: "key", deletedAtColumn: null });
  }

  /** Reads the configured trigger keys in one round trip. Unknown keys simply do not come back. */
  async findByKeys(keys: readonly string[]): Promise<SystemConfigRow[]> {
    const res = await this.client.query<SystemConfigRow>(
      `SELECT key, value, value_type, description, min_value, max_value, unit, is_sensitive, phase,
              updated_by, updated_at
         FROM app.system_config
        WHERE key = ANY($1::text[])
        ORDER BY key ASC`,
      [keys as string[]],
    );
    return res.rows;
  }

  async findByKey(key: string): Promise<SystemConfigRow | null> {
    const res = await this.client.query<SystemConfigRow>(
      `SELECT * FROM app.system_config WHERE key = $1::text LIMIT 1`,
      [key],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Updates one config value. The value is passed as jsonb text so any of the five value_types
   * (number/string/boolean/json/array) round-trips without a per-type branch in SQL.
   */
  async updateValue(key: string, value: string, actorId: string): Promise<SystemConfigRow | null> {
    const res = await this.client.query<SystemConfigRow>(
      `UPDATE app.system_config
          SET value      = $2::jsonb,
              updated_by = $3::uuid,
              updated_at = now()
        WHERE key = $1::text
        RETURNING *`,
      [key, value, actorId],
    );
    return res.rows[0] ?? null;
  }
}
