// packages/worker/src/ingest/repository.ts
// Persistence for the ingest pipeline (04). Every query is parameterised ($1,$2,…);
// identifiers are code constants, never request input (06 §2 / 00 §4). Geometry is bound
// as ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography using the correct bound indices.

import type { DbClient, EventPublisher } from "@fleet/shared";
import { RealtimeChannels } from "@fleet/shared";
import type { RetentionWindow } from "./retention";
import type { TrackerHealthSnapshot } from "./derive";

export interface RetentionContextData {
  shiftWindow: RetentionWindow | null;
  recoveryModeActive: boolean;
  openAccident: boolean;
}

export interface InsertLocationRow {
  vehicleId: string;
  shiftId: string | null;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  ignition: boolean | null;
  obdOdometerKm: number | null;
  obdEngineHours: number | null;
  obdFuelLevelPercent: number | null;
  obdFaultCodes: string[] | null;
  satellites: number | null;
  hdop: number | null;
  traccarPositionId: number;
  traccarDeviceId: number;
  attributes: Record<string, unknown>;
  retentionReason: string;
}

export class TelemetryRepository {
  constructor(
    private readonly client: DbClient,
    private readonly publisher?: EventPublisher,
  ) {}

  /** Map a Traccar device id to our internal vehicle id (Traccar is authoritative for devices). */
  async resolveVehicleId(traccarDeviceId: number): Promise<string | null> {
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.vehicles WHERE traccar_device_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [traccarDeviceId],
    );
    return res.rows[0]?.id ?? null;
  }

  /** Resolve the retention context: covering shift window + forced-retention flags (C5.6/N3). */
  async getRetentionContext(vehicleId: string, at: Date): Promise<RetentionContextData> {
    const res = await this.client.query<{
      shift: [Date, Date | null] | null;
      recovery_active: boolean;
      accident_open: boolean;
    }>(
      `SELECT
         (SELECT (s.clock_in_at, s.clock_out_at)::record FROM app.shifts s
            WHERE s.vehicle_id = $1 AND s.clock_in_at <= $2
              AND (s.clock_out_at IS NULL OR s.clock_out_at >= $2)
            ORDER BY s.clock_in_at DESC LIMIT 1) AS shift,
         EXISTS(SELECT 1 FROM app.recovery_modes r
            WHERE r.vehicle_id = $1 AND r.disabled_at IS NULL
              AND r.enabled_at <= $2 AND r.expires_at >= $2) AS recovery_active,
         EXISTS(SELECT 1 FROM app.accident_reports a
            WHERE a.vehicle_id = $1 AND a.status IN ('PENDING','INVESTIGATING')) AS accident_open`,
      [vehicleId, at],
    );
    const row = res.rows[0];
    let shiftWindow: RetentionWindow | null = null;
    if (row?.shift) {
      const [clockInAt, clockOutAt] = row.shift;
      shiftWindow = { start: clockInAt, end: clockOutAt ?? at };
    }
    return { shiftWindow, recoveryModeActive: row?.recovery_active ?? false, openAccident: row?.accident_open ?? false };
  }

  async insertLocationUpdate(row: InsertLocationRow): Promise<void> {
    await this.client.query(
      `INSERT INTO telemetry.location_updates (
         vehicle_id, shift_id, recorded_at, position, latitude, longitude,
         speed_kph, heading_deg, altitude_m, ignition,
         obd_odometer_km, obd_engine_hours, obd_fuel_level_percent, obd_fault_codes,
         satellites, hdop, is_valid_fix, traccar_position_id, traccar_device_id, attributes, retention_reason
       ) VALUES (
         $1,$2,$3,
         ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
         $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,$18,$19,$20,$21
       )`,
      [
        row.vehicleId,
        row.shiftId,
        row.recordedAt,
        row.longitude,
        row.latitude,
        row.latitude,
        row.longitude,
        row.speedKph,
        row.headingDeg,
        row.altitudeM,
        row.ignition,
        row.obdOdometerKm,
        row.obdEngineHours,
        row.obdFuelLevelPercent,
        row.obdFaultCodes,
        row.satellites,
        row.hdop,
        row.traccarPositionId,
        row.traccarDeviceId,
        row.attributes,
        row.retentionReason,
      ],
    );
  }

  async getShiftIdForWindow(vehicleId: string, at: Date): Promise<string | null> {
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.shifts s WHERE s.vehicle_id = $1 AND s.clock_in_at <= $2
         AND (s.clock_out_at IS NULL OR s.clock_out_at >= $2) ORDER BY s.clock_in_at DESC LIMIT 1`,
      [vehicleId, at],
    );
    return res.rows[0]?.id ?? null;
  }

  async upsertTrackerHealth(traccarDeviceId: number, snap: TrackerHealthSnapshot): Promise<void> {
    await this.client.query(
      `INSERT INTO app.tracker_health (
         vehicle_id, traccar_device_id, last_position_at, last_heartbeat_at,
         last_ignition, last_speed_kph, last_position, is_online, offline_since, display_state
       ) VALUES ($1,$2,$3,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,$10)
       ON CONFLICT (vehicle_id) DO UPDATE SET
         traccar_device_id = EXCLUDED.traccar_device_id,
         last_position_at = EXCLUDED.last_position_at,
         last_heartbeat_at = EXCLUDED.last_heartbeat_at,
         last_ignition = EXCLUDED.last_ignition,
         last_speed_kph = EXCLUDED.last_speed_kph,
         last_position = EXCLUDED.last_position,
         is_online = EXCLUDED.is_online,
         offline_since = EXCLUDED.offline_since,
         display_state = EXCLUDED.display_state,
         updated_at = now()`,
      [
        snap.vehicleId,
        traccarDeviceId,
        snap.lastPositionAt,
        snap.lastIgnition,
        snap.lastSpeedKph,
        snap.lastLongitude,
        snap.lastLatitude,
        snap.isOnline,
        snap.offlineSince,
        snap.displayState,
      ],
    );
    // Real-time: tracker health drives the derived vehicle display state (07 §3/§5).
    await this.publisher?.publish(RealtimeChannels.vehicleStates, { vehicleId: snap.vehicleId });
  }

  async insertMovementEvents(
    vehicleId: string,
    events: { kind: "OFF_SHIFT_MOVEMENT_START" | "OFF_SHIFT_MOVEMENT_END"; occurredAt: Date; durationSeconds?: number }[],
  ): Promise<void> {
    for (const ev of events) {
      await this.client.query(
        `INSERT INTO app.vehicle_movement_events (vehicle_id, event_type, occurred_at, duration_seconds)
         VALUES ($1,$2,$3,$4)`,
        [vehicleId, ev.kind, ev.occurredAt, ev.durationSeconds ?? null],
      );
    }
  }

  /** Trailers without GPS inherit the position of the tractor pulling them (4.5). */
  async updateTrailerLastKnown(vehicleId: string, longitude: number, latitude: number, at: Date): Promise<void> {
    await this.client.query(
      `INSERT INTO app.trailer_last_known_location (trailer_id, via_vehicle_id, position, recorded_at, updated_at)
       SELECT ta.trailer_id, $1, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, now()
       FROM app.trailer_assignments ta WHERE ta.vehicle_id = $1 AND ta.unassigned_at IS NULL
       ON CONFLICT (trailer_id) DO UPDATE SET
         via_vehicle_id = EXCLUDED.via_vehicle_id, position = EXCLUDED.position,
         recorded_at = EXCLUDED.recorded_at, updated_at = now()`,
      [vehicleId, longitude, latitude, at],
    );
  }
}
