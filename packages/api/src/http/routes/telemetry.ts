// packages/api/src/http/routes/telemetry.ts
// Traccar position webhook accept (A1.1 / 04 §2). The handler is thin: validate (zod) → resolve
// deviceId → vehicle_id → publish the normalised raw position to the durable Redis Stream
// `traccar:positions` (N2.3). The worker consumes that stream, so this is the ingest entry point
// the rest of the pipeline depends on. No idempotency header (public, unauthenticated ingest); the
// worker de-duplicates on `traccar_position_id` downstream.

import { Router } from "express";
import type { Redis as RedisClient } from "ioredis";
import {
  TraccarWebhookSchema,
  PhonePointsSchema,
  PHONE_POINTS,
  normalizeTraccarWebhook,
  normalizePhonePoint,
  TRACCAR_POSITIONS_STREAM,
  ValidationError,
  ServiceUnavailable,
  Forbidden,
} from "@fleet/shared";
import { asyncHandler } from "../problem";
import { parseBody } from "../validate";
import { authenticate } from "../../middleware/authenticate";
import type { PoolLike, Principal } from "@fleet/shared";
import type { Infra } from "../../app/compose";

export interface TelemetryRouterDeps {
  pool: PoolLike;
  redis: RedisClient | null;
  /** Needed only by the authenticated phone ingest (`POST /points`); the webhook stays public. */
  infra: Infra;
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
      if (vehicleId) {
        raw.vehicleId = vehicleId;
        // Keeps /admin/hardware/pending fast and correct even before the worker has drained the
        // stream: pairing state must not depend on downstream consumer lag (A1.1).
        await touchTrackerPing(deps.pool, vehicleId);

        // Write the Traccar device id back on first contact so the provisioning inbox advances.
        const rawDeviceId = Number(parsed.data.deviceId);
        if (Number.isFinite(rawDeviceId) && rawDeviceId > 0) {
          await touchTrackerProvisioning(deps.pool, vehicleId, rawDeviceId);
        }
      }

      // The worker's parseTraccarPosition reads OBD values out of `attributes` (odometer, fuel,
      // ignition) when it writes telemetry.location_updates. Traccar spells fuel level
      // `fuelLevel`, while the parser looks for `fuel`, so both spellings are carried here rather
      // than silently dropping obd_fuel_level_percent.
      const attributes = raw.attributes as Record<string, unknown>;
      if (attributes.fuel == null && attributes.fuelLevel != null) {
        attributes.fuel = attributes.fuelLevel;
      }
      if (attributes.ignition == null && parsed.data.ignition != null) {
        attributes.ignition = parsed.data.ignition;
      }

      if (!deps.redis) {
        throw new ServiceUnavailable("Ingestion stream unavailable");
      }
      await deps.redis.xadd(TRACCAR_POSITIONS_STREAM, "*", "data", JSON.stringify(raw));

      res.status(202).json({ accepted: true });
    }),
  );

  /**
   * Phone-GPS ingest (U-01 / C1.9).
   *
   * Authenticated and attributed: the driver is resolved from the bearer token, the point's vehicle comes
   * from that driver's OPEN shift (never from the body), and the shift id is stamped on every point. A
   * point outside the driver's own open shift is refused, so a stolen token cannot paint the map or move
   * somebody else's rest arithmetic. Published to the SAME `traccar:positions` stream, so the worker,
   * retention and map behaviour are identical to a tracker fix.
   */
  router.post(
    "/points",
    authenticate({ tokens: deps.infra.tokens, sessions: deps.infra.store, strictSessionCheck: deps.infra?.env?.SECURITY_ENFORCE === "always" }),
    asyncHandler(async (req, res) => {
      // parseBody, not a hand-rolled safeParse: it is what every other route uses, and its
      // field_errors convention (uppercased zod code, "(body)" fallback) is the one clients match on.
      const parsed = parseBody(PhonePointsSchema, req);
      const points = [...parsed.points].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
      const now = Date.now();
      const oldest = now - PHONE_POINTS.maxHistorySeconds * 1000;
      if (Date.parse(points[0]!.recorded_at) < oldest) {
        throw new ValidationError(`A phone point may be at most ${PHONE_POINTS.maxHistorySeconds / 60} minutes old`, [
          { field: "points", code: "TOO_OLD", message: "batch older than the allowed window" },
        ]);
      }
      for (let i = 1; i < points.length; i++) {
        const gap = (Date.parse(points[i]!.recorded_at) - Date.parse(points[i - 1]!.recorded_at)) / 1000;
        if (gap < PHONE_POINTS.minIntervalSeconds) {
          throw new ValidationError(`Phone points must be at least ${PHONE_POINTS.minIntervalSeconds}s apart`, [
            { field: `points.${i}.recorded_at`, code: "TOO_DENSE", message: "batch exceeds the sampling floor" },
          ]);
        }
      }

      const principal = (req as { principal?: Principal }).principal as Principal;
      const shift = await openShiftFor(deps.pool, principal.userId);
      if (!shift) throw new Forbidden();          // no open shift => no vehicle to attribute to
      if (!deps.redis) throw new ServiceUnavailable("Ingestion stream unavailable");

      // One pipeline for the whole batch. An awaited xadd per point cost up to PHONE_POINTS.maxPoints
      // serialised round-trips inside the request; pipelined it is a single write.
      const pipe = deps.redis.pipeline();
      for (const point of points) {
        pipe.xadd(
          TRACCAR_POSITIONS_STREAM,
          "*",
          "data",
          JSON.stringify({ ...normalizePhonePoint(point, shift.shiftId), vehicleId: shift.vehicleId }),
        );
      }
      await pipe.exec();
      res.status(202).json({ accepted: points.length, shift_id: shift.shiftId });
    }),
  );

  return router;
}


/**
 * Best-effort liveness stamp for the provisioning inbox; never fails the ingest.
 *
 * Throttled to one write per vehicle per minute: positions arrive at high frequency and the ping
 * only needs minute-level resolution for the health view, so unconditionally writing every position
 * would turn the hot ingest path into a per-device UPDATE storm (A1.1).
 */
const lastPingWrite = new Map<string, number>();
async function touchTrackerPing(pool: PoolLike, vehicleId: string): Promise<void> {
  const now = Date.now();
  const last = lastPingWrite.get(vehicleId) ?? 0;
  if (now - last < 60_000) return;
  lastPingWrite.set(vehicleId, now);
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE app.vehicles SET tracker_last_ping_at = now() WHERE id = $1`,
        [vehicleId],
      );
    } finally {
      client.release?.();
    }
  } catch {
    // A position must never be dropped because a bookkeeping update failed.
  }
}

/**
 * Writes the Traccar device id back to app.vehicles on first contact so the provisioning inbox
 * advances from PENDING to ONLINE without waiting for the worker to drain the stream.
 *
 * Throttled per vehicle: only the first position after a NULL -> non-NULL transition writes.
 */
const lastProvisionWrite = new Map<string, number>();
async function touchTrackerProvisioning(pool: PoolLike, vehicleId: string, traccarDeviceId: number): Promise<void> {
  const now = Date.now();
  const last = lastProvisionWrite.get(vehicleId) ?? 0;
  if (now - last < 60_000) return;
  lastProvisionWrite.set(vehicleId, now);
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE app.vehicles
            SET traccar_device_id     = $1,
                tracker_provisioned_at = now(),
                updated_at             = now()
          WHERE id = $2
            AND traccar_device_id IS NULL`,
        [traccarDeviceId, vehicleId],
      );
    } finally {
      client.release?.();
    }
  } catch {
    // Provisioning stamp must never drop the position.
  }
}

/**
 * The caller's own OPEN shift, which is the ONLY source of the vehicle a phone point may be attributed to.
 * A point outside the caller's own shift is refused, so a stolen token cannot paint the map or move
 * somebody else's rest arithmetic. Any failure returns null, i.e. the batch is refused rather than
 * accepted un-attributed.
 */
async function openShiftFor(pool: PoolLike, userId: string): Promise<{ shiftId: string; vehicleId: string } | null> {
  try {
    const client = await pool.connect();
    try {
      const r = await client.query<{ shift_id: string; vehicle_id: string }>(
        `SELECT s.id::text AS shift_id, s.vehicle_id::text AS vehicle_id
           FROM app.shifts s
           JOIN app.drivers d ON d.id = s.driver_id
          WHERE d.user_id = $1::uuid AND s.state = 'OPEN'
          ORDER BY s.clock_in_at DESC
          LIMIT 1`,
        [userId],
      );
      const row = r.rows[0];
      return row ? { shiftId: row.shift_id, vehicleId: row.vehicle_id } : null;
    } finally {
      client.release?.();
    }
  } catch {
    return null;
  }
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
