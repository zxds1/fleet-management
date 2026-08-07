// packages/worker/src/ingest/traccar.ts
// Traccar position contract. Traccar decodes trackers and forwards each position to
// the durable Redis Stream `traccar:positions` (N2.3) or (fallback) the REST API
// polled by the back-fill (04 §4). Both paths yield this normalised shape.

export interface TraccarPosition {
  traccarPositionId: number;
  traccarDeviceId: number;
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
  attributes: Record<string, unknown>;
}

/** Parse one raw Traccar position object (as returned by REST / carried on the stream). */
export function parseTraccarPosition(raw: Record<string, unknown>): TraccarPosition {
  const deviceId = raw.deviceId ?? raw.traccarDeviceId;
  const id = raw.id ?? raw.traccarPositionId;
  const attrs = (raw.attributes as Record<string, unknown>) ?? {};
  return {
    traccarPositionId: Number(id),
    traccarDeviceId: Number(deviceId),
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
    attributes: attrs,
  };
}
