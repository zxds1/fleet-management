// packages/worker/src/ingest/consumer.ts
// The telemetry ingest consumer (04 §2, §3, §6, §8). Reads Traccar positions from the
// durable Redis Stream `traccar:positions`, applies the retention transform (C5.6/N3), and
// persists retained positions + derived tracker health + off-shift movement ledger. The
// core `processPositions` is dependency-injected so it can be unit-tested with a fake repo.

import type { PoolLike, ConfigClient, EventPublisher } from "@fleet/shared";
import { transaction } from "@fleet/db";
import type { Redis } from "ioredis";
import { logger } from "@fleet/shared";
import { parseTraccarPosition, type TraccarPosition } from "./traccar";
import { decideRetention, type RetentionContext, type RetentionDecision } from "./retention";
import { computeTrackerHealth, OffShiftMovementDetector, type HealthConfig } from "./derive";
import { TelemetryRepository, type InsertLocationRow, type RetentionContextData } from "./repository";

const DEFAULT_RETENTION_BUFFER_MINUTES = 15; // N3.3 default; configurable via system_config.

export interface IngestResult {
  processed: number;
  retained: number;
  discarded: number;
  movements: number;
}

export interface IngestConsumerDeps {
  pool: PoolLike;
  config: ConfigClient;
  redis: Redis | null;
  publisher?: EventPublisher;
  streamName?: string;
  batchSize?: number;
  blockMs?: number;
  bufferMinutes?: number;
}

export class IngestConsumer {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastId = "$";
  private readonly stream: string;
  private readonly batchSize: number;
  private readonly blockMs: number;
  private readonly bufferMinutes: number;

  constructor(private readonly deps: IngestConsumerDeps) {
    this.stream = deps.streamName ?? "traccar:positions";
    this.batchSize = deps.batchSize ?? 100;
    this.blockMs = deps.blockMs ?? 1000;
    this.bufferMinutes = deps.bufferMinutes ?? DEFAULT_RETENTION_BUFFER_MINUTES;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("ingest consumer started", { stream: this.stream });
    if (!this.deps.redis) {
      logger.warn("ingest: Redis unavailable — stream disabled, back-fill poller remains the durability guarantee");
      return;
    }
    this.timer = setInterval(() => void this.poll(), this.blockMs);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.deps.redis) return;
    try {
      const res = (await this.deps.redis.xread("COUNT", this.batchSize, "BLOCK", this.blockMs, "STREAMS", this.stream, this.lastId)) as any;
      if (!res) return;
      for (const [, entries] of res) {
        const positions: TraccarPosition[] = [];
        for (const [id, fields] of entries) {
          this.lastId = id;
          const raw = this.decode(fields);
          if (raw) positions.push(parseTraccarPosition(raw));
        }
        if (positions.length) await this.processPositions(positions);
      }
    } catch (e) {
      logger.error("ingest poll failed", { message: (e as Error).message });
    }
  }

  private decode(fields: string[]): Record<string, unknown> | null {
    // Traccar forwards the position as a JSON string under the `data` field.
    for (let i = 0; i + 1 < fields.length; i += 2) {
      if (fields[i] === "data") {
        try {
          return JSON.parse(fields[i + 1] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** Core pipeline. Dependency-injected for tests; wraps per-vehicle writes in one transaction. */
  async processPositions(positions: TraccarPosition[]): Promise<IngestResult> {
    const result: IngestResult = { processed: positions.length, retained: 0, discarded: 0, movements: 0 };
    const healthCfg = await this.healthConfig();

    const byVehicle = new Map<string, TraccarPosition[]>();
    for (const p of positions) {
      if (!p.vehicleId) continue;
      const arr = byVehicle.get(p.vehicleId) ?? [];
      arr.push(p);
      byVehicle.set(p.vehicleId, arr);
    }

    const now = new Date();
    for (const [vehicleId, vpositions] of byVehicle) {
      const ordered = [...vpositions].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
      const at = ordered[ordered.length - 1]!.recordedAt;
      const ctxData = await this.contextFor(vehicleId, at);
      const ctx: RetentionContext = { ...ctxData, bufferMinutes: this.bufferMinutes };

      const detector = new OffShiftMovementDetector(healthCfg.movingSpeedKph);
      const rows: InsertLocationRow[] = [];
      const movements: { kind: "OFF_SHIFT_MOVEMENT_START" | "OFF_SHIFT_MOVEMENT_END"; occurredAt: Date; durationSeconds?: number }[] = [];
      let prev = null as ReturnType<typeof computeTrackerHealth> | null;

      for (const pos of ordered) {
        const decision: RetentionDecision = decideRetention(pos.recordedAt, ctx);
        if (decision.action === "DISCARD") {
          movements.push(...detector.observe(vehicleId, pos).map((m) => ({ kind: m.kind, occurredAt: m.occurredAt, durationSeconds: m.durationSeconds })));
          result.discarded++;
          continue;
        }
        const shiftId = decision.reason === "SHIFT" || decision.reason === "SHIFT_BUFFER"
          ? await this.shiftIdFor(vehicleId, pos.recordedAt)
          : null;
        rows.push({
          vehicleId,
          shiftId,
          recordedAt: pos.recordedAt,
          latitude: pos.latitude,
          longitude: pos.longitude,
          speedKph: pos.speedKph,
          headingDeg: pos.headingDeg,
          altitudeM: pos.altitudeM,
          ignition: pos.ignition,
          obdOdometerKm: pos.obdOdometerKm,
          obdEngineHours: pos.obdEngineHours,
          obdFuelLevelPercent: pos.obdFuelLevelPercent,
          obdFaultCodes: pos.obdFaultCodes,
          satellites: pos.satellites,
          hdop: pos.hdop,
          traccarPositionId: pos.traccarPositionId,
          traccarDeviceId: pos.traccarDeviceId,
          attributes: pos.attributes,
          retentionReason: decision.reason,
          tenantId: ctxData.tenantId,
        });
        prev = computeTrackerHealth(prev, pos, healthCfg);
        result.retained++;
      }

      const last = ordered[ordered.length - 1]!;
      await transaction(
        this.deps.pool,
        async (tx) => {
          const repo = new TelemetryRepository(tx.client, this.deps.publisher);
        for (const r of rows) await repo.insertLocationUpdate(r);
        if (prev) await repo.upsertTrackerHealth(last.traccarDeviceId, prev);
        if (movements.length) await repo.insertMovementEvents(vehicleId, movements);
        await repo.updateTrailerLastKnown(vehicleId, last.longitude, last.latitude, now);
        },
        { tenantId: ctxData.tenantId },
      );
      result.movements += movements.length;
    }
    return result;
  }

  // Hooks so tests can inject fake repos without a live pool.
  protected async contextFor(vehicleId: string, at: Date): Promise<RetentionContextData> {
    const repo = new TelemetryRepository(await this.client());
    return repo.getRetentionContext(vehicleId, at);
  }

  protected async shiftIdFor(vehicleId: string, at: Date): Promise<string | null> {
    const repo = new TelemetryRepository(await this.client());
    return repo.getShiftIdForWindow(vehicleId, at);
  }

  private async client() {
    return this.deps.pool.connect();
  }

  private async healthConfig(): Promise<HealthConfig> {
    const [offline, speedLimit, moving] = await Promise.all([
      this.deps.config.numeric("tracker.offline_threshold_minutes"),
      this.deps.config.numeric("speed.limit_kph"),
      this.deps.config.numeric("telemetry.moving_speed_kph"),
    ]);
    return { offlineThresholdMinutes: offline, speedLimitKph: speedLimit, movingSpeedKph: moving, now: new Date() };
  }
}
