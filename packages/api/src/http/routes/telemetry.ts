// packages/api/src/http/routes/telemetry.ts
// Traccar position webhook accept (A1.1 / 04 §2). The handler is thin: validate (zod) → resolve
// deviceId → vehicle_id → publish the normalised raw position to the durable Redis Stream
// `traccar:positions` (N2.3). The worker consumes that stream, so this is the ingest entry point
// the rest of the pipeline depends on. No idempotency header (public, unauthenticated ingest); the
// worker de-duplicates on `traccar_position_id` downstream.

import { Router } from "express";
import type { Redis as RedisClient } from "ioredis";
import type { PoolLike } from "@fleet/shared";
import {
  TraccarWebhookSchema,
  normalizeTraccarWebhook,
  TRACCAR_POSITIONS_STREAM,
  ValidationError,
  ServiceUnavailable,
} from "@fleet/shared";
import { asyncHandler } from "../problem";

export interface TelemetryRouterDeps {
  pool: PoolLike;
  redis: RedisClient | null;
}

export function createTelemetryRouter(deps: TelemetryRouterDeps): Router {
  const router = Router();

  router.post(
    "/webhook",
    asyncHandler(async (req, res) => {
      const parsed = TraccarWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Invalid Traccar position",
          parsed.error.issues.map((i) => ({
            field: i.path.join(".") || "body",
            code: i.code,
            message: i.message,
          })),
        );
      }

      const raw = normalizeTraccarWebhook(parsed.data);
      const vehicleId = await resolveVehicleId(deps.pool, String(parsed.data.deviceId));
      if (vehicleId) raw.vehicleId = vehicleId;

      if (!deps.redis) {
        throw new ServiceUnavailable("Ingestion stream unavailable");
      }
      await deps.redis.xadd(TRACCAR_POSITIONS_STREAM, "*", "data", JSON.stringify(raw));

      res.status(202).json({ accepted: true });
    }),
  );

  return router;
}

async function resolveVehicleId(pool: PoolLike, traccarDeviceId: string): Promise<string | null> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query<{ vehicle_id: string }>(
        `SELECT vehicle_id FROM app.vehicles WHERE traccar_device_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [Number(traccarDeviceId)],
      );
      return result.rows[0]?.vehicle_id ?? null;
    } finally {
      client.release?.();
    }
  } catch {
    // Resolution failure must not drop the position — publish without vehicleId; the consumer
    // will skip it and the back-fill poller can reconcile (N2.3).
    return null;
  }
}
