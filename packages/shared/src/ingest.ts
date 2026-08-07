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

/** Name of the durable Redis Stream the worker consumes (04 §2, N2.3). */
export const TRACCAR_POSITIONS_STREAM = "traccar:positions";

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
