// packages/api/src/repositories/fuel.ts
// Fuel repositories (07_financial.sql). Parameterised SQL only. Refuels link a before/after gauge
// pair (B3) and are verified/reconciled later; the anomaly scoring is asynchronous (03 §4).

import { BaseRepository } from "@fleet/db";
import type { DbClient } from "@fleet/shared";
import type { FuelCardRow, FuelPurchaseRow, FuelCardStatementRow } from "@fleet/shared";

/** Mobile/admin read model for a fuel purchase (03 §2.3). */
export interface FuelPurchaseDetailRow {
  purchase_id: string;
  purchased_at: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  litres: string | null;
  total_cost_amount: string | null;
  currency: string;
  supplier_name: string | null;
  odometer_km: number | null;
  reconciliation_status: string;
  rejection_reason: string | null;
}

/**
 * Derives the reconciliation status the mobile/admin clients display. Kept in SQL so the same
 * ordering of precedence (rejected → cleared → verified → pending) applies to every read.
 */
const RECONCILIATION_STATUS_SQL = `CASE
    WHEN p.rejected_at IS NOT NULL            THEN 'REJECTED'
    WHEN p.cleared_for_payment_at IS NOT NULL THEN 'CLEARED'
    WHEN p.admin_verified                     THEN 'VERIFIED'
    ELSE 'PENDING'
  END`;

const PURCHASE_SELECT_SQL = `SELECT p.id                  AS purchase_id,
          p.purchased_at        AS purchased_at,
          p.vehicle_id          AS vehicle_id,
          v.license_plate       AS vehicle_plate,
          p.litres              AS litres,
          p.total_cost          AS total_cost_amount,
          p.currency            AS currency,
          p.supplier_name       AS supplier_name,
          p.odometer_km         AS odometer_km,
          ${RECONCILIATION_STATUS_SQL} AS reconciliation_status,
          p.rejection_reason    AS rejection_reason
     FROM app.fuel_purchases p
     LEFT JOIN app.vehicles v ON v.id = p.vehicle_id`;

export class FuelPurchaseRepository extends BaseRepository<FuelPurchaseRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_purchases", { deletedAtColumn: null });
  }

  async listUnverified(limit: number): Promise<FuelPurchaseRow[]> {
    const res = await this.client.query<FuelPurchaseRow>(
      `SELECT * FROM app.fuel_purchases
        WHERE admin_verified = false AND rejected_at IS NULL
        ORDER BY purchased_at DESC
        LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  /**
   * Driver-owned purchases, keyset paginated on (purchased_at, id). Always scoped to the caller's
   * driver id so a driver can never read another driver's rows (06 §2).
   */
  async listByDriver(
    driverId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<FuelPurchaseDetailRow[]> {
    const params: unknown[] = [driverId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (p.purchased_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<FuelPurchaseDetailRow>(
      `${PURCHASE_SELECT_SQL}
        WHERE p.driver_id = $1 ${keyset}
        ORDER BY p.purchased_at DESC, p.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /**
   * Single purchase detail (admin purchase detail screen). `driverId` narrows it to that driver's
   * own purchase so a driver with `fuel:read` cannot read another driver's receipt (C6.2).
   */
  async getDetailById(purchaseId: string, driverId?: string): Promise<FuelPurchaseDetailRow | null> {
    const params: unknown[] = [purchaseId];
    let scope = "";
    if (driverId) {
      params.push(driverId);
      scope = ` AND p.driver_id = $${params.length}::uuid`;
    }
    const res = await this.client.query<FuelPurchaseDetailRow>(
      `${PURCHASE_SELECT_SQL} WHERE p.id = $1::uuid${scope} LIMIT 1`,
      params,
    );
    return res.rows[0] ?? null;
  }
}

/**
 * Cards a driver may select (U-05). `POST /fuel/cards` was the only fuel-card route and it is a CREATE
 * behind `fuel:card_manage`, which DRIVER does not hold — so the app had nothing to put in a picker.
 * `card_last_four` and `notes` are deliberately NOT returned: the picker shows a label and provider, and
 * the driver still types the four digits they are asked for on the refuel form.
 */
export interface FuelCardOptionRow {
  id: string;
  label: string;
  provider: string;
  is_pooled: boolean;
  assigned_vehicle_id: string | null;
  status: string;
}

export class FuelCardRepository extends BaseRepository<FuelCardRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_cards");
  }

  /**
   * Active cards, optionally narrowed to one vehicle (its dedicated card plus every pooled card).
   * A dedicated card belonging to a DIFFERENT vehicle is never returned.
   */
  async listSelectable(vehicleId?: string | null): Promise<FuelCardOptionRow[]> {
    const res = await this.client.query<FuelCardOptionRow>(
      `SELECT id::text            AS id,
              label,
              provider,
              is_pooled,
              assigned_vehicle_id::text AS assigned_vehicle_id,
              status
         FROM app.fuel_cards
        WHERE status = 'ACTIVE'
          AND ($1::uuid IS NULL OR is_pooled = true OR assigned_vehicle_id = $1::uuid)
        ORDER BY is_pooled DESC, label ASC
        LIMIT 100`,
      [vehicleId ?? null],
    );
    return res.rows;
  }
}

export class FuelStatementRepository extends BaseRepository<FuelCardStatementRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_card_statements", { deletedAtColumn: null });
  }
}
