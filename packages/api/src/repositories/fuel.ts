// packages/api/src/repositories/fuel.ts
// Fuel repositories (07_financial.sql). Parameterised SQL only. Refuels link a before/after gauge
// pair (B3) and are verified/reconciled later; the anomaly scoring is asynchronous (03 §4).

import { BaseRepository } from "@fleet/db";
import type { DbClient } from "@fleet/shared";
import type { FuelCardRow, FuelPurchaseRow, FuelCardStatementRow } from "@fleet/shared";

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
}

export class FuelCardRepository extends BaseRepository<FuelCardRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_cards");
  }
}

export class FuelStatementRepository extends BaseRepository<FuelCardStatementRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_card_statements", { deletedAtColumn: null });
  }
}
