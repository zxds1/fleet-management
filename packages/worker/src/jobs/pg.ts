// packages/worker/src/jobs/pg.ts
// Postgres implementations of the job repository contracts. All parameterised; identifiers are
// code constants (06 §2). Some joins assume columns validated against the live schema; runtime
// correctness against :5444 is covered by the integration pass (PROGRESS).

import type { DbClient, ConfigClient, NotificationRow as DbNotificationRow } from "@fleet/shared";
import { transaction } from "@fleet/db";
import type {
  NotificationRepository,
  NotificationRow,
  NotificationChannel,
  NotificationPriority,
} from "./notifications";
import type { EscalationRepository, EscalationTimerRow } from "./escalation";
import type { FuelAnomalyRepository, FuelPurchaseFacts } from "./fuel-anomaly";

const DEFAULT_TANK_CAPACITY_L = 400; // fallback when no per-vehicle tank capacity is recorded.

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly client: DbClient) {}

  async nextBatch(limit: number): Promise<NotificationRow[]> {
    const res = await this.client.query<NotificationRow>(
      `SELECT id, template_code AS "templateCode", recipient_user_id AS "recipientUserId",
              recipient_address AS "recipientAddress", channel, priority, locale, title, body,
              payload, incident_kind AS "incidentKind", incident_id AS "incidentId", dedupe_key AS "dedupeKey"
         FROM app.notifications
        WHERE status = 'QUEUED'
        ORDER BY queued_at
        LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return res.rows;
  }

  async countSmsInWindow(incidentId: string, since: Date): Promise<number> {
    const res = await this.client.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM app.notifications
       WHERE incident_id = $1 AND channel = 'SMS' AND sent_at >= $2`,
      [incidentId, since],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  async markSent(id: string, provider: string | undefined, messageId: string | undefined, deliveredAt: Date): Promise<void> {
    await this.client.query(
      `UPDATE app.notifications SET status='SENT', sent_at=now(), delivered_at=$2, provider=$3, provider_message_id=$4 WHERE id=$1`,
      [id, deliveredAt, provider ?? null, messageId ?? null],
    );
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.client.query(
      `UPDATE app.notifications SET status='FAILED', failed_at=now(), failure_reason=$2 WHERE id=$1`,
      [id, reason],
    );
  }

  async markSuppressed(id: string, reason: string): Promise<void> {
    await this.client.query(
      `UPDATE app.notifications SET status='SUPPRESSED_DND', suppressed_reason=$2 WHERE id=$1`,
      [id, reason],
    );
  }
}

/** Inserts a notification row (used by escalation + outbox handlers). Returns the stored row so
 * callers can publish it to the real-time gateway (07 §3/§5). */
export async function enqueueNotification(
  client: DbClient,
  input: { recipientUserId: string | null; channel: NotificationChannel; priority: NotificationPriority; title: string; body: string; incidentKind?: string | null; incidentId?: string | null; templateCode?: string | null },
): Promise<DbNotificationRow> {
  const res = await client.query<DbNotificationRow>(
    `INSERT INTO app.notifications (recipient_user_id, channel, priority, title, body, incident_kind, incident_id, template_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [input.recipientUserId, input.channel, input.priority, input.title, input.body, input.incidentKind ?? null, input.incidentId ?? null, input.templateCode ?? null],
  );
  return res.rows[0] as DbNotificationRow;
}

export class PgEscalationRepository implements EscalationRepository {
  constructor(private readonly client: DbClient, private readonly config: ConfigClient) {}

  async dueTimers(now: Date): Promise<EscalationTimerRow[]> {
    const res = await this.client.query<EscalationTimerRow>(
      `SELECT id, incident_kind AS "incidentKind", incident_id AS "incidentId", tier
         FROM app.escalation_timers WHERE fires_at <= $1 AND fired_at IS NULL AND cancelled_at IS NULL`,
      [now],
    );
    return res.rows;
  }

  async rosterFor(incidentKind: string, tier: number): Promise<string | null> {
    const res = await this.client.query<{ user_id: string }>(
      `SELECT user_id FROM app.on_call_roster
       WHERE incident_kind = $1 AND escalation_tier = $2 AND is_active = true
         AND (effective_to IS NULL OR effective_to > now()) ORDER BY effective_from DESC LIMIT 1`,
      [incidentKind, tier],
    );
    return res.rows[0]?.user_id ?? null;
  }

  async headOfOperations(): Promise<string | null> {
    return this.config.string("escalation.head_of_operations_user_id");
  }

  async markFired(id: string, at: Date): Promise<void> {
    await this.client.query(`UPDATE app.escalation_timers SET fired_at=$2 WHERE id=$1`, [id, at]);
  }

  async enqueueNotification(
    input: { recipientUserId: string | null; title: string; body: string; incidentKind: string; incidentId: string },
    priority: "HIGH" | "CRITICAL",
  ): Promise<void> {
    await enqueueNotification(this.client, { ...input, channel: "PUSH", priority });
  }

  async armNextTier(timer: EscalationTimerRow, inMinutes: number, at: Date): Promise<void> {
    await this.client.query(
      `INSERT INTO app.escalation_timers (incident_kind, incident_id, tier, fires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (incident_kind, incident_id, tier) DO NOTHING`,
      [timer.incidentKind, timer.incidentId, timer.tier + 1, new Date(at.getTime() + inMinutes * 60_000)],
    );
  }

  async markAccidentEscalated(incidentId: string, at: Date, escalatedTo: string): Promise<void> {
    await this.client.query(
      `UPDATE app.accident_reports SET escalated_at=$2, escalated_to=$3 WHERE id=$1`,
      [incidentId, at, escalatedTo],
    );
  }
}

export class PgFuelAnomalyRepository implements FuelAnomalyRepository {
  constructor(private readonly pool: Parameters<typeof transaction>[0]) {}

  async unprocessed(limit: number): Promise<FuelPurchaseFacts[]> {
    return transaction(this.pool, async (tx) => {
      const res = await tx.client.query<{
        id: string;
        vehicle_id: string;
        litres: number;
        purchased_at: Date;
        odometer_km: number;
        card_is_pooled: boolean;
        card_assigned_vehicle_id: string | null;
        tank_capacity_l: number;
        before_gauge_pct: number | null;
        after_gauge_pct: number | null;
        baseline_lper100: number | null;
        actual_lper100: number | null;
        unit_price: number;
        price_30d_mean: number | null;
        card_expires_on: Date | null;
      }>(
        `SELECT p.id, p.vehicle_id, p.litres, p.purchased_at, p.odometer_km,
                COALESCE(c.is_pooled, false) AS card_is_pooled,
                c.assigned_vehicle_id AS card_assigned_vehicle_id,
                $2::numeric AS tank_capacity_l,
                br.gauge_percent AS before_gauge_pct, ar.gauge_percent AS after_gauge_pct,
                (SELECT l_per_100km FROM app.fuel_efficiency_records r
                   WHERE r.vehicle_id = p.vehicle_id ORDER BY r.computed_at DESC LIMIT 1) AS baseline_lper100,
                (p.total_cost / NULLIF(p.litres,0)) AS actual_lper100,
                p.unit_price,
                (SELECT avg(p2.unit_price) FROM app.fuel_purchases p2
                   WHERE p2.vehicle_id = p.vehicle_id AND p2.purchased_at >= p.purchased_at - interval '30 days'
                     AND p2.id <> p.id) AS price_30d_mean,
                c.expires_on AS card_expires_on
           FROM app.fuel_purchases p
           LEFT JOIN app.fuel_cards c ON c.id = p.fuel_card_id
           LEFT JOIN app.fuel_records br ON br.id = p.before_fuel_record_id
           LEFT JOIN app.fuel_records ar ON ar.id = p.after_fuel_record_id
          WHERE p.ocr_status <> 'FAILED'
          LIMIT $1`,
        [limit, DEFAULT_TANK_CAPACITY_L],
      );
      return res.rows.map((r) => ({
        id: r.id,
        vehicleId: r.vehicle_id,
        litres: Number(r.litres),
        purchasedAt: r.purchased_at,
        odometerKm: Number(r.odometer_km),
        cardIsPooled: r.card_is_pooled,
        cardAssignedVehicleId: r.card_assigned_vehicle_id,
        tankCapacityL: Number(r.tank_capacity_l),
        beforeGaugePct: r.before_gauge_pct != null ? Number(r.before_gauge_pct) : null,
        afterGaugePct: r.after_gauge_pct != null ? Number(r.after_gauge_pct) : null,
        baselineLper100: r.baseline_lper100 != null ? Number(r.baseline_lper100) : null,
        actualLper100: r.actual_lper100 != null ? Number(r.actual_lper100) : null,
        unitPrice: Number(r.unit_price),
        price30dMean: r.price_30d_mean != null ? Number(r.price_30d_mean) : null,
        cardExpiresOn: r.card_expires_on,
      }));
    });
  }

  async insertAnomalies(purchaseId: string, anomalies: import("./fuel-anomaly").DetectedAnomaly[]): Promise<void> {
    await transaction(this.pool, async (tx) => {
      for (const a of anomalies) {
        await tx.client.query(
          `INSERT INTO app.fuel_purchase_anomalies
             (fuel_purchase_id, vehicle_id, anomaly_type, severity, expected_value, actual_value, deviation_percent, threshold_percent, detail)
           SELECT $1, p.vehicle_id, $2, $3, $4, $5, $6, $7, $8
             FROM app.fuel_purchases p WHERE p.id = $1
           ON CONFLICT (fuel_purchase_id, anomaly_type) WHERE fuel_purchase_id IS NOT NULL AND resolved_at IS NULL DO NOTHING`,
          [purchaseId, a.type, a.severity, a.expectedValue, a.actualValue, a.deviationPercent, a.thresholdPercent, JSON.stringify({})],
        );
      }
    });
  }

  async markProcessed(purchaseId: string): Promise<void> {
    await transaction(this.pool, async (tx) =>
      tx.client.query(`UPDATE app.fuel_purchases SET ocr_status = CASE WHEN ocr_status='PENDING' THEN 'PROCESSED' ELSE ocr_status END WHERE id=$1`, [purchaseId]),
    );
  }
}
