// packages/worker/src/ingest/derive.ts
// Derived state computed from retained positions (04 §6, §8): per-vehicle tracker health
// and the privacy-preserving off-shift movement ledger (C5.6/N3). Both are pure/testable;
// the consumer supplies inputs and persists the results through the repository.

import type { TraccarPosition } from "./traccar";

export type DisplayState = "OFFLINE" | "SPEEDING" | "MOVING" | "IDLING" | "PARKED";

export interface TrackerHealthSnapshot {
  vehicleId: string;
  isOnline: boolean;
  offlineSince: Date | null;
  lastPositionAt: Date;
  lastIgnition: boolean | null;
  lastSpeedKph: number | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  displayState: DisplayState;
}

export interface HealthConfig {
  offlineThresholdMinutes: number;
  speedLimitKph: number;
  movingSpeedKph: number;
  now: Date;
}

/** Recompute tracker health for a vehicle from its latest position. */
export function computeTrackerHealth(prev: TrackerHealthSnapshot | null, pos: TraccarPosition, cfg: HealthConfig): TrackerHealthSnapshot {
  const isOnline = pos.recordedAt.getTime() >= cfg.now.getTime() - cfg.offlineThresholdMinutes * 60_000;
  const speed = pos.speedKph ?? 0;
  const ignition = pos.ignition ?? false;

  let displayState: DisplayState;
  if (!isOnline) displayState = "OFFLINE";
  else if (speed > cfg.speedLimitKph) displayState = "SPEEDING";
  else if (speed > cfg.movingSpeedKph || ignition) displayState = "MOVING";
  else if (ignition) displayState = "MOVING";
  else displayState = "IDLING";

  // A vehicle that is online but stationary and ignition-off is PARKED (N5).
  if (isOnline && speed <= cfg.movingSpeedKph && !ignition) displayState = "PARKED";

  return {
    vehicleId: pos.vehicleId,
    isOnline,
    offlineSince: isOnline ? null : (prev?.offlineSince ?? pos.recordedAt),
    lastPositionAt: pos.recordedAt,
    lastIgnition: ignition,
    lastSpeedKph: pos.speedKph,
    lastLatitude: pos.latitude,
    lastLongitude: pos.longitude,
    displayState,
  };
}

export type MovementEventKind = "OFF_SHIFT_MOVEMENT_START" | "OFF_SHIFT_MOVEMENT_END";

export interface MovementEvent {
  kind: MovementEventKind;
  vehicleId: string;
  occurredAt: Date;
  durationSeconds?: number;
}

/**
 * Stateful detector: given that a position was OFF-SHIFT (discarded by the retention
 * transform), emit a timestamp-only movement ledger entry when the vehicle begins/ends
 * moving. Coordinates are never stored (C5.6). Speed above `movingSpeedKph` or ignition ON
 * counts as moving (A1.2).
 */
export class OffShiftMovementDetector {
  private startedAt: Date | null = null;

  constructor(private readonly movingSpeedKph: number) {}

  observe(vehicleId: string, pos: TraccarPosition): MovementEvent[] {
    const moving = (pos.speedKph ?? 0) > this.movingSpeedKph || (pos.ignition ?? false);
    const events: MovementEvent[] = [];

    if (moving && this.startedAt === null) {
      this.startedAt = pos.recordedAt;
      events.push({ kind: "OFF_SHIFT_MOVEMENT_START", vehicleId, occurredAt: pos.recordedAt });
    } else if (!moving && this.startedAt !== null) {
      events.push({
        kind: "OFF_SHIFT_MOVEMENT_END",
        vehicleId,
        occurredAt: pos.recordedAt,
        durationSeconds: Math.max(0, Math.round((pos.recordedAt.getTime() - this.startedAt.getTime()) / 1000)),
      });
      this.startedAt = null;
    }
    return events;
  }

  /** Force-close an open movement window (e.g. at consumer shutdown). */
  flush(vehicleId: string, at: Date): MovementEvent[] {
    if (this.startedAt === null) return [];
    const end = {
      kind: "OFF_SHIFT_MOVEMENT_END" as const,
      vehicleId,
      occurredAt: at,
      durationSeconds: Math.max(0, Math.round((at.getTime() - this.startedAt.getTime()) / 1000)),
    };
    this.startedAt = null;
    return [end];
  }
}
