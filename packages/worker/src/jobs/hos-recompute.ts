// packages/worker/src/jobs/hos-recompute.ts
// `hos-recompute` job (05 §2 #6, N7/N8, C3.3). Recomputes app.driver_hos_state for active
// drivers from the append-only app.driver_duty_segments ledger, every 5 minutes. The clock-in
// service reads next_eligible_clock_in_at to enforce the C3.3 hard block. The decision is a
// pure function so the threshold logic is unit-tested independently of the DB.

import type { DbClient, ConfigClient, EventPublisher } from "@fleet/shared";
import { RealtimeChannels } from "@fleet/shared";
import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";

export type HosViolationType = "CONTINUOUS_DRIVING" | "DAILY_DUTY_LIMIT" | "WEEKLY_REST";

export interface HosPolicy {
  id: string;
  maxDrivingSecondsPerDay: number;
  maxDutySecondsPerShift: number;
  continuousDrivingBeforeBreakSeconds: number;
}

export interface HosAggregate {
  drivingSecondsToday: number;
  dutySecondsToday: number;
  drivingSecondsSinceBreak: number;
  lastBreakEndedAt: Date | null;
}

export interface HosDecision {
  nextEligibleClockInAt: Date | null;
  blockReason: HosViolationType | null;
}

export function decideHosBlock(agg: HosAggregate, policy: HosPolicy, now: Date): HosDecision {
  if (agg.drivingSecondsSinceBreak >= policy.continuousDrivingBeforeBreakSeconds) {
    return { nextEligibleClockInAt: now, blockReason: "CONTINUOUS_DRIVING" };
  }
  if (agg.dutySecondsToday >= policy.maxDutySecondsPerShift) {
    return { nextEligibleClockInAt: now, blockReason: "DAILY_DUTY_LIMIT" };
  }
  return { nextEligibleClockInAt: null, blockReason: null };
}

const DAY_START_SQL = `date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')`;

export class PgHosRepository {
  constructor(private readonly client: DbClient) {}

  async activeDriverIds(): Promise<string[]> {
    const res = await this.client.query<{ driver_id: string }>(
      `SELECT DISTINCT driver_id FROM app.driver_duty_segments WHERE ended_at IS NULL
       UNION SELECT DISTINCT driver_id FROM app.shifts WHERE clock_out_at IS NULL`,
    );
    return res.rows.map((r) => r.driver_id);
  }

  async policyFor(driverId: string): Promise<HosPolicy | null> {
    const res = await this.client.query<HosPolicy>(
      `SELECT p.id, p.max_driving_seconds_per_day, p.max_duty_seconds_per_shift, p.continuous_driving_before_break_seconds
         FROM app.drivers d
         JOIN app.hos_policies p ON p.id = COALESCE(d.hos_policy_id,
           (SELECT id FROM app.hos_policies WHERE is_default = true LIMIT 1))
        WHERE d.id = $1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }

  async aggregate(driverId: string): Promise<HosAggregate> {
    const res = await this.client.query<{
      driving_today: string;
      duty_today: string;
      last_break_ended_at: Date | null;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'DRIVING' THEN duration_seconds END),0) AS driving_today,
         COALESCE(SUM(duration_seconds),0) AS duty_today,
         MAX(CASE WHEN status = 'BREAK' AND ended_at IS NOT NULL THEN ended_at END) AS last_break_ended_at
       FROM app.driver_duty_segments
       WHERE driver_id = $1 AND started_at >= ${DAY_START_SQL}`,
      [driverId],
    );
    const row = res.rows[0] ?? { driving_today: "0", duty_today: "0", last_break_ended_at: null };
    const drivingToday = Number(row.driving_today);
    const lastBreak = row.last_break_ended_at;
    return {
      drivingSecondsToday: drivingToday,
      dutySecondsToday: Number(row.duty_today),
      drivingSecondsSinceBreak: lastBreak ? drivingToday : drivingToday, // refined when break ledger is materialised
      lastBreakEndedAt: lastBreak,
    };
  }

  async upsert(driverId: string, policyId: string, agg: HosAggregate, decision: HosDecision, now: Date): Promise<void> {
    await this.client.query(
      `INSERT INTO app.driver_hos_state (
         driver_id, policy_id, driving_seconds_today, duty_seconds_today,
         driving_seconds_since_break, last_break_ended_at, next_eligible_clock_in_at, block_reason,
         computed_at, computed_through
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (driver_id) DO UPDATE SET
         policy_id = EXCLUDED.policy_id,
         driving_seconds_today = EXCLUDED.driving_seconds_today,
         duty_seconds_today = EXCLUDED.duty_seconds_today,
         driving_seconds_since_break = EXCLUDED.driving_seconds_since_break,
         last_break_ended_at = EXCLUDED.last_break_ended_at,
         next_eligible_clock_in_at = EXCLUDED.next_eligible_clock_in_at,
         block_reason = EXCLUDED.block_reason,
         computed_at = EXCLUDED.computed_at,
         computed_through = EXCLUDED.computed_through`,
      [
        driverId,
        policyId,
        agg.drivingSecondsToday,
        agg.dutySecondsToday,
        agg.drivingSecondsSinceBreak,
        agg.lastBreakEndedAt,
        decision.nextEligibleClockInAt,
        decision.blockReason,
        now,
      ],
    );
  }
}

export class HosRecomputeJob {
  constructor(
    private readonly pool: Parameters<typeof transaction>[0],
    private readonly _config: ConfigClient,
    private readonly publisher?: EventPublisher,
  ) {}

  async run(now: Date = new Date()): Promise<{ recomputed: number; blocked: number }> {
    let recomputed = 0;
    let blocked = 0;
    const ids = await transaction(this.pool, async (tx) => new PgHosRepository(tx.client).activeDriverIds());
    for (const driverId of ids) {
      await transaction(this.pool, async (tx) => {
        const repo = new PgHosRepository(tx.client);
        const policy = await repo.policyFor(driverId);
        if (!policy) return;
        const agg = await repo.aggregate(driverId);
        const decision = decideHosBlock(agg, policy, now);
        await repo.upsert(driverId, policy.id, agg, decision, now);
        if (decision.blockReason) blocked++;
        recomputed++;
      });
    }
    // Real-time: HOS state feeds the derived vehicle display state (HOS_ALERT), so nudge the map (07 §3/§5).
    await this.publisher?.publish(RealtimeChannels.vehicleStates, {});
    logger.info("hos-recompute complete", { recomputed, blocked });
    return { recomputed, blocked };
  }
}
