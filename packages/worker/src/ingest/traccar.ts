// packages/worker/src/ingest/traccar.ts
// Traccar position contract. Traccar decodes trackers and forwards each position to
// the durable Redis Stream `traccar:positions` (N2.3) or (fallback) the REST API
// polled by the back-fill (04 §4). Both paths yield this normalised shape.

export interface TraccarPosition {
  /**
   * Traccar's own position id, or NULL for a position that did not come from Traccar (a phone-GPS
   * point). NULL rather than 0/NaN: telemetry.location_updates.traccar_position_id is bigint and
   * rejects 'NaN', and location_updates_traccar_dedupe is a partial unique index that only applies
   * WHERE traccar_position_id IS NOT NULL — so a phone point is stored, not de-duplicated, and never
   * rejected by the column type.
   */
  traccarPositionId: number | null;
  /** Traccar device id, or NULL for a phone point (which has no device). */
  traccarDeviceId: number | null;
  vehicleId: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  ignition: boolean | null;
  obdOdometerKm: number | null;
  obdFuelLevelPercent: number | null;
  obdEngineHours: number | null;
  obdFaultCodes: string[] | null;
  satellites: number | null;
  hdop: number | null;
  /**
   * False only when the sender said so (`attributes.isValidFix: false`, i.e. a phone with no GPS fix).
   * Stored in location_updates.is_valid_fix so the point is kept for the trail but never counts as
   * driving. Absent means true — a Traccar fix is a fix.
   */
  isValidFix: boolean;
  attributes: Record<string, unknown>;
}

/**
 * Traccar ids arrive as numbers, numeric strings or (for a phone point) null/absent. Anything that is
 * not a finite number becomes NULL: `Number(null)` is 0 and `Number(undefined)` is NaN, and both are
 * worse than an honest NULL — 0 would overwrite app.tracker_health.traccar_device_id and NaN is
 * rejected outright by the bigint column.
 */
function toNullableId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse one raw Traccar position object (as returned by REST / carried on the stream). */
export function parseTraccarPosition(raw: Record<string, unknown>): TraccarPosition {
  const attrs = (raw.attributes as Record<string, unknown>) ?? {};
  return {
    traccarPositionId: toNullableId(raw.id ?? raw.traccarPositionId),
    traccarDeviceId: toNullableId(raw.deviceId ?? raw.traccarDeviceId),
    vehicleId: String(raw.vehicleId ?? attrs.vehicleId ?? ""),
    recordedAt: raw.fixTime ? new Date(String(raw.fixTime)) : new Date(String(raw.serverTime ?? raw.deviceTime)),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    speedKph: raw.speed != null ? Number(raw.speed) : (attrs.speed != null ? Number(attrs.speed) : null),
    headingDeg: raw.course != null ? Number(raw.course) : (attrs.course != null ? Number(attrs.course) : null),
    altitudeM: raw.altitude != null ? Number(raw.altitude) : (attrs.altitude != null ? Number(attrs.altitude) : null),
    ignition: (attrs.ignition as boolean | null) ?? null,
    obdOdometerKm: attrs.odometer != null ? Number(attrs.odometer) : null,
    obdFuelLevelPercent: attrs.fuel != null ? Number(attrs.fuel) : null,
    obdEngineHours: attrs.engineHours != null ? Number(attrs.engineHours) : null,
    obdFaultCodes: Array.isArray(attrs.faultCodes) ? (attrs.faultCodes as unknown[]).map(String) : null,
    satellites: raw.satellites != null ? Number(raw.satellites) : (attrs.satellites != null ? Number(attrs.satellites) : null),
    hdop: raw.hdop != null ? Number(raw.hdop) : (attrs.hdop != null ? Number(attrs.hdop) : null),
    isValidFix: attrs.isValidFix !== false,
    attributes: attrs,
  };
}
