// packages/api/src/services/reports.ts
// Read-only reporting services (Pillar 6). Aggregates over the financial tables and the existing
// read-model views; never mutates and always runs on a pooled client (D8 read path). Returns
// Result<T> like every other service so the routers map errors uniformly (08 §1).
//
// Postgres returns numeric/bigint as strings over the wire, so every aggregate is coerced to a JS
// number exactly once, here, rather than leaking `"1234.50"` into the client contract.

import { type DbClient, type Result, ok } from "@fleet/shared";

/** Per-vehicle breakdown inside the fuel-efficiency report. */
export interface FuelEfficiencyVehicleRow {
  vehicle_plate: string | null;
  litres: number;
  cost: number;
  efficiency: number | null;
}

export interface FuelEfficiencyReport {
  total_litres: number;
  total_cost: number;
  avg_efficiency_l_per_100km: number | null;
  total_co2_kg: number;
  per_vehicle: FuelEfficiencyVehicleRow[];
}

export interface AnalyticsReport {
  active_fleet: number;
  open_accidents: number;
  pending_dvir: number;
  expiring_docs: number;
  fuel_spend_30d: number;
  anomalies_open: number;
}

/**
 * Diesel combustion factor. 1 litre of diesel ≈ 2.68 kg CO2 (DEFRA/GHG Protocol stationary factor).
 * Kept as a named constant so the reported figure is auditable rather than a magic number.
 */
const CO2_KG_PER_LITRE = 2.68;

/** Postgres hands numeric/bigint back as text; coerce once at the boundary. */
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export class ReportsService {
  constructor(private readonly client: DbClient) {}

  /**
   * Fleet fuel efficiency (2.6 / B6). Litres and spend come from `app.fuel_purchases` (the receipt
   * of record); the l/100km figure comes from `app.fuel_efficiency_records`, which is the
   * authoritative FULL_TO_FULL baseline. The two are joined per vehicle rather than summed
   * together, because a purchase is not a consumption measurement.
   */
  async fuelEfficiency(): Promise<Result<FuelEfficiencyReport>> {
    const res = await this.client.query<{
      vehicle_id: string | null;
      vehicle_plate: string | null;
      litres: string | null;
      cost: string | null;
      efficiency: string | null;
    }>(
      `WITH purchases AS (
           SELECT fp.vehicle_id,
                  SUM(fp.litres)     AS litres,
                  SUM(fp.total_cost) AS cost
             FROM app.fuel_purchases fp
            WHERE fp.rejected_at IS NULL
            GROUP BY fp.vehicle_id
       ),
       efficiency AS (
           SELECT fe.vehicle_id,
                  -- Distance-weighted, so a long haul is not averaged flat against a short one.
                  CASE WHEN SUM(fe.distance_km) > 0
                       THEN (SUM(fe.litres_consumed) / SUM(fe.distance_km)) * 100
                       END AS l_per_100km
             FROM app.fuel_efficiency_records fe
            GROUP BY fe.vehicle_id
       )
       SELECT v.id                AS vehicle_id,
              v.license_plate     AS vehicle_plate,
              p.litres            AS litres,
              p.cost              AS cost,
              e.l_per_100km       AS efficiency
         FROM purchases p
         LEFT JOIN app.vehicles v ON v.id = p.vehicle_id
         LEFT JOIN efficiency  e ON e.vehicle_id = p.vehicle_id
        ORDER BY v.license_plate ASC NULLS LAST`,
    );

    const perVehicle: FuelEfficiencyVehicleRow[] = res.rows.map((row) => ({
      vehicle_plate: row.vehicle_plate,
      litres: num(row.litres),
      cost: num(row.cost),
      efficiency: row.efficiency != null ? Number(Number(row.efficiency).toFixed(2)) : null,
    }));

    const totalLitres = perVehicle.reduce((sum, row) => sum + row.litres, 0);
    const totalCost = perVehicle.reduce((sum, row) => sum + row.cost, 0);

    // Fleet average is weighted by the litres each vehicle actually burned, so a rarely-used
    // vehicle with a poor figure cannot skew the headline number.
    const weighted = perVehicle.filter((row) => row.efficiency != null && row.litres > 0);
    const weightBase = weighted.reduce((sum, row) => sum + row.litres, 0);
    const avgEfficiency =
      weightBase > 0
        ? Number(
            (weighted.reduce((sum, row) => sum + (row.efficiency as number) * row.litres, 0) / weightBase).toFixed(2),
          )
        : null;

    return ok({
      total_litres: Number(totalLitres.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2)),
      avg_efficiency_l_per_100km: avgEfficiency,
      total_co2_kg: Number((totalLitres * CO2_KG_PER_LITRE).toFixed(2)),
      per_vehicle: perVehicle,
    });
  }

  /**
   * Operational headline counters for the analytics dashboard. Every figure is derived from an
   * existing view or table so this endpoint introduces no new source of truth. One round trip:
   * each counter is an independent scalar subquery.
   */
  async analytics(): Promise<Result<AnalyticsReport>> {
    const res = await this.client.query<{
      active_fleet: string;
      open_accidents: string;
      pending_dvir: string;
      expiring_docs: string;
      fuel_spend_30d: string | null;
      anomalies_open: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.v_vehicle_display_state
           WHERE display_state <> 'QUARANTINED')                       AS active_fleet,
         (SELECT count(*) FROM app.accident_reports
           WHERE status IN ('PENDING','INVESTIGATING'))                AS open_accidents,
         (SELECT count(*) FROM app.v_shift_verification_inbox
           WHERE verification_status = 'PENDING')                      AS pending_dvir,
         (SELECT count(*) FROM app.asset_documents
           WHERE deleted_at IS NULL
             AND superseded_by_id IS NULL
             AND expires_on IS NOT NULL
             AND expires_on >= current_date
             AND expires_on <= (current_date + interval '30 days'))    AS expiring_docs,
         (SELECT COALESCE(SUM(total_cost), 0) FROM app.fuel_purchases
           WHERE rejected_at IS NULL
             AND purchased_at >= (now() - interval '30 days'))         AS fuel_spend_30d,
         (SELECT count(*) FROM app.v_open_anomalies)                   AS anomalies_open`,
    );

    const row = res.rows[0];
    return ok({
      active_fleet: num(row?.active_fleet),
      open_accidents: num(row?.open_accidents),
      pending_dvir: num(row?.pending_dvir),
      expiring_docs: num(row?.expiring_docs),
      fuel_spend_30d: Number(num(row?.fuel_spend_30d).toFixed(2)),
      anomalies_open: num(row?.anomalies_open),
    });
  }
}
