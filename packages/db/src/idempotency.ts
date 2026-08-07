// packages/db/src/idempotency.ts
// IdempotencyService bound to app.idempotency_keys (C5.1 / D4). Column names follow the
// authoritative DDL in db/schema/03_platform_core.sql:
//   PRIMARY KEY (user_id, idempotency_key), state, response_status, response_body, resource_id.
//
// start() inserts IN_PROGRESS and returns NEW; a completed key returns REPLAY with the cached
// response; a still-in-flight key throws IdempotencyInFlight (409); a completed key whose request
// hash differs throws IdempotencyConflict (422). complete() writes inside the caller's
// transaction (D8) so the cached response commits atomically with the write.

import type {
  CachedResponse,
  DbClient,
  IdempotencyCompleteInput,
  IdempotencyService,
  IdempotencyStartInput,
  IdempotencyStartResult,
  PoolLike,
  Tx,
} from "@fleet/shared";
import { IdempotencyConflict, IdempotencyInFlight } from "@fleet/shared";

// Atomic claim: the row is inserted only if the (user_id, idempotency_key) pair is unused.
const CLAIM = `
  INSERT INTO app.idempotency_keys (user_id, idempotency_key, endpoint, request_hash, state, created_at)
  VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now())
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING idempotency_key`;

const SELECT = `
  SELECT state, response_status, response_body, resource_id, request_hash
  FROM app.idempotency_keys
  WHERE user_id = $1 AND idempotency_key = $2`;

const COMPLETE = `
  UPDATE app.idempotency_keys
  SET state = $1, response_status = $2, response_body = $3::jsonb, resource_id = $4, completed_at = now()
  WHERE user_id = $5 AND idempotency_key = $6`;

interface KeyRow {
  state: string;
  response_status: number | null;
  response_body: unknown;
  resource_id: string | null;
  request_hash: string;
}

export class PgIdempotencyService implements IdempotencyService {
  constructor(private readonly pool: PoolLike) {}

  async start(input: IdempotencyStartInput): Promise<IdempotencyStartResult> {
    return this.withClient(async (client) => {
      const claimed = await client.query<{ idempotency_key: string }>(CLAIM, [
        input.userId,
        input.key,
        input.endpoint,
        input.requestHash,
      ]);
      if ((claimed.rowCount ?? claimed.rows.length) > 0) return { status: "NEW" };

      const res = await client.query<KeyRow>(SELECT, [input.userId, input.key]);
      const row = res.rows[0];
      if (!row) return { status: "NEW" }; // vanished (expired sweep) — treat as a fresh attempt
      if (row.request_hash !== input.requestHash) throw new IdempotencyConflict();
      if (row.state === "IN_PROGRESS") throw new IdempotencyInFlight();

      const response: CachedResponse = {
        httpStatus: row.response_status ?? 200,
        body: row.response_body,
        ...(row.resource_id ? { resourceId: row.resource_id } : {}),
      };
      return { status: "REPLAY", response };
    });
  }

  async complete(input: IdempotencyCompleteInput, tx: Tx): Promise<void> {
    await tx.client.query(COMPLETE, [
      input.state,
      input.httpStatus,
      input.body === undefined ? null : JSON.stringify(input.body),
      input.resourceId ?? null,
      input.userId,
      input.key,
    ]);
  }

  private async withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release?.();
    }
  }
}
