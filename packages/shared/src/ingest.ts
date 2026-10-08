// packages/shared/src/ingest.ts
// Traccar telemetry webhook contract (04 §2 / A1.1). The @fleet/api webhook accepts a Traccar-decoded
// position and publishes it to the durable Redis Stream `traccar:positions`; the @fleet/worker ingest
// consumer reads that stream and runs `parseTraccarPosition` (worker/src/ingest/traccar.ts) on the
// `data` field. This module is the single source of truth for the public payload shape and the
// normaliser that maps it onto the raw Traccar position the worker already understands, so the two
// processes cannot drift.

import { z } from "zod";

/** Public webhook payload (api/openapi.yaml → /telemetry/webhook). */
export const TraccarWebhookSchema = z.object({
  deviceId: z.union([z.string(), z.number()]),
  lat: z.number(),
  lon: z.number(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  ignition: z.boolean().optional(),
  timestamp: z.string(),
  attributes: z.record(z.unknown()).optional(),
});

export type TraccarWebhookPayload = z.infer<typeof TraccarWebhookSchema>;

/**
 * Hard limits. The batch cap is enforced by `PhonePointsSchema` below (a client cannot widen it by
 * sending a different body); the history window and the sampling floor are enforced by the route,
 * which needs them as numbers.
 */
export const PHONE_POINTS = {
  maxPoints: 60,
  maxHistorySeconds: 300,
  minIntervalSeconds: 10,
} as const;

/**
 * Phone-GPS batch from a driver (U-01 / C1.9).
 *
 * The platform only had ONE ingest, the public Traccar webhook, so `phone_gps_fallback_enabled` on
 * `ClockInSchema` was a flag that changed rest arithmetic with no data behind it: nothing accepted a
 * point from a phone. This is the second, authenticated ingest, for when the vehicle's own tracker is
 * silent. It publishes to the SAME `traccar:positions` stream, so the worker, the retention rules and
 * the map all behave identically — the only difference is provenance, carried in `attributes.source`.
 *
 * Batch size is capped here at PHONE_POINTS.maxPoints; the route additionally bounds how far back a
 * point may be (maxHistorySeconds) and the sampling floor (minIntervalSeconds). A phone battery cannot
 * support a 1 Hz stream and a batch that big would be a way to flood the shared stream from a stolen
 * session.
 */
export const PhonePointsSchema = z.object({
  points: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        /** Device clock, RFC 3339. The route bounds how far back a point may be. */
        recorded_at: z.string().datetime({ offset: true }),
        speed_kph: z.number().nonnegative().max(300).optional(),
        heading_deg: z.number().min(0).max(360).optional(),
        accuracy_m: z.number().nonnegative().max(10_000).optional(),
        /** No GPS fix: the point is kept but flagged so it never counts as driving. */
        is_valid_fix: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(PHONE_POINTS.maxPoints),
});
export type PhonePointsInput = z.infer<typeof PhonePointsSchema>;

/** Provenance marker, read by the worker so a phone point is never mistaken for a tracker fix. */
export const PHONE_POSITION_SOURCE = "PHONE_GPS";

/** Name of the durable Redis Stream the worker consumes (04 §2, N2.3). */
export const TRACCAR_POSITIONS_STREAM = "traccar:positions";

/** Default consumer group for the telemetry ingest stream (04 §2, N2.4). */
export const TRACCAR_POSITIONS_GROUP = "fleet-ingest";

/**
 * Maps the public payload onto the raw Traccar position shape `parseTraccarPosition` expects
 * (worker/src/ingest/traccar.ts): `latitude`/`longitude`/`speed`/`course`/`fixTime` plus an
 * `attributes` bag carrying `ignition`. `vehicleId` is filled in by the api after the
 * `deviceId → vehicle_id` lookup so the consumer can partition by vehicle without a second query.
 */
export function normalizeTraccarWebhook(p: TraccarWebhookPayload): Record<string, unknown> {
  return {
    deviceId: String(p.deviceId),
    latitude: p.lat,
    longitude: p.lon,
    speed: p.speed,
    course: p.heading,
    fixTime: p.timestamp,
    attributes: { ignition: p.ignition, ...(p.attributes ?? {}) },
  };
}

/**
 * Maps one phone point onto the same raw shape `parseTraccarPosition` already understands, so a phone
 * point travels the same worker path as a tracker fix. `attributes.source` is the only provenance
 * marker; the absent `id`/`deviceId` are what `parseTraccarPosition` maps to SQL NULL (a phone point
 * has no Traccar identity, and `traccar_position_id` is what de-duplicates a tracker fix — see
 * location_updates_traccar_dedupe, which excludes NULLs).
 */
export function normalizePhonePoint(p: PhonePointsInput["points"][number], shiftId: string): Record<string, unknown> {
  return {
    id: null,
    deviceId: null,
    latitude: p.latitude,
    longitude: p.longitude,
    speed: p.speed_kph,
    course: p.heading_deg,
    fixTime: p.recorded_at,
    attributes: {
      source: PHONE_POSITION_SOURCE,
      shiftId,
      ...(p.accuracy_m === undefined ? {} : { accuracy: p.accuracy_m }),
      ...(p.is_valid_fix === undefined ? {} : { isValidFix: p.is_valid_fix }),
    },
  };
}
