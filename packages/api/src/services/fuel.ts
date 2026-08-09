// packages/api/src/services/fuel.ts
// Fuel domain (03 §2.3, 03 §4). `submitRefuel` creates the purchase with its mandatory gauge pair
// and queues async OCR + anomaly scoring; `verifyPurchase` is the Fleet Manager / Finance review.
// Every rule returns a Result with a frozen `error_code` (08 §1); DB constraints are the authority.

import {
  err,
  Forbidden,
  NotFound,
  ok,
  type Result,
  type Tx,
  ValidationError,
  violation,
} from "@fleet/shared";
import type { RefuelInput, VerifyPurchaseInput } from "@fleet/shared";
import type { FuelCardRow, FuelPurchaseRow } from "@fleet/shared";
import { FuelCardRepository, FuelPurchaseRepository } from "../repositories/fuel";
import { FuelRecordRepository } from "../repositories/shifts";
import type { Actor } from "./shift";

export interface RefuelOutcome {
  fuelPurchaseId: string;
  openAnomalies: string[];
}

export class FuelService {
  constructor(
    private readonly purchases: FuelPurchaseRepository,
    private readonly fuelRecords: FuelRecordRepository,
  ) {}

  async submitRefuel(tx: Tx, driverId: string, input: RefuelInput, actor: Actor): Promise<Result<RefuelOutcome>> {
    // DB enforces the gauge pair (fuel_purchases_driver_entry_has_gauge_pair); pre-check for a clean code.
    if (!input.before_fuel_record_id || !input.after_fuel_record_id) {
      return err(violation("MISSING_GAUGE_PAIR", "Missing gauge pair", "A driver refuel requires before + after gauge records (B3)."));
    }

    const purchase = await this.purchases.insert({
      shift_id: input.shift_id,
      vehicle_id: input.vehicle_id,
      driver_id: driverId,
      entry_source: "DRIVER",
      fuel_card_id: input.fuel_card_id ?? null,
      fuel_card_last_four: input.fuel_card_last_four,
      supplier_name: input.supplier_name ?? null,
      litres: String(input.litres),
      total_cost: input.total_cost.amount,
      currency: input.total_cost.currency,
      odometer_km: input.odometer_km,
      purchased_at: input.purchased_at,
      receipt_media_object_id: input.receipt_media_object_id,
      before_fuel_record_id: input.before_fuel_record_id,
      after_fuel_record_id: input.after_fuel_record_id,
    });

    tx.audit({
      action: "CREATE",
      entity_table: "app.fuel_purchases",
      entity_id: purchase.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/fuel/refuel",
      http_method: "POST",
    });
    // Anomaly scoring + OCR are asynchronous (03 §4); the worker reads this outbox event.
    tx.registerOutbox({
      event_type: "fuel.ocr",
      aggregate_type: "fuel_purchase",
      aggregate_id: purchase.id,
      payload: { driverId, vehicleId: input.vehicle_id },
    });

    return ok({ fuelPurchaseId: purchase.id, openAnomalies: [] });
  }

  async verifyPurchase(
    tx: Tx,
    purchaseId: string,
    input: VerifyPurchaseInput,
    actor: Actor,
  ): Promise<Result<{ fuelPurchaseId: string; status: string }>> {
    const purchase = await this.purchases.getById(purchaseId);
    if (!purchase) return err(new NotFound("Fuel purchase not found"));

    if (input.action === "VERIFY") {
      const patch: Partial<FuelPurchaseRow> = {
        admin_verified: true,
        verified_by: actor.userId,
        verified_at: new Date().toISOString(),
      };
      if (input.adjusted_litres != null) {
        patch.adjustments = { litres: input.adjusted_litres } as unknown as FuelPurchaseRow["adjustments"];
      }
      await this.purchases.update(purchase.id, patch);
    } else if (input.action === "REJECT") {
      if (!input.rejection_reason) {
        return err(new ValidationError("Rejection reason required", [
          { field: "rejection_reason", code: "REQUIRED", message: "Rejecting a purchase requires a reason." },
        ]));
      }
      await this.purchases.update(purchase.id, {
        rejected_at: new Date().toISOString(),
        rejected_by: actor.userId,
        rejection_reason: input.rejection_reason,
      });
    } else {
      // CLEAR_PAYMENT (FINANCE, C6.1): only after verification.
      if (!purchase.admin_verified) return err(new Forbidden("Purchase must be verified before clearance (C6.1)."));
      await this.purchases.update(purchase.id, {
        cleared_for_payment_at: new Date().toISOString(),
        cleared_by: actor.userId,
      });
    }

    tx.audit({
      action: input.action === "VERIFY" ? "VERIFY" : input.action === "REJECT" ? "FLAG" : "EXPORT",
      entity_table: "app.fuel_purchases",
      entity_id: purchase.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/fuel/purchases/{id}/verify",
      http_method: "POST",
    });
    return ok({ fuelPurchaseId: purchase.id, status: input.action });
  }
}

export interface FuelCardInput {
  label: string;
  lastFour: string;
  provider: string;
  isPooled: boolean;
  assignedVehicleId?: string | null;
}

export class FuelCardService {
  constructor(private readonly cards: FuelCardRepository) {}

  async create(tx: Tx, input: FuelCardInput, actor: Actor): Promise<Result<{ fuelCardId: string }>> {
    const card = await this.cards.insert({
      label: input.label,
      last_four: input.lastFour,
      provider: input.provider,
      is_pooled: input.isPooled,
      assigned_vehicle_id: input.assignedVehicleId ?? null,
    } as unknown as Partial<FuelCardRow>);

    tx.audit({
      action: "CREATE",
      entity_table: "app.fuel_cards",
      entity_id: card.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/fuel/cards",
      http_method: "POST",
    });
    return ok({ fuelCardId: card.id });
  }
}

import type { DbClient, FuelReconciliationInboxViewRow } from "@fleet/shared";
import { FuelStatementRepository } from "../repositories/fuel";
import type { FuelPurchaseDetailRow } from "../repositories/fuel";
import type { CursorPage } from "../http/pagination";
import { buildPage, decodeCursor, MAX_PAGE_LIMIT, resolveSortColumn } from "../http/pagination";

/** Wire shape for a fuel purchase: `total_cost` is a money object, matching the mobile read model. */
export interface FuelPurchaseView {
  purchase_id: string;
  purchased_at: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  litres: string | null;
  total_cost: { amount: string | null; currency: string };
  supplier_name: string | null;
  odometer_km: number | null;
  reconciliation_status: string;
  rejection_reason: string | null;
}

function toPurchaseView(row: FuelPurchaseDetailRow): FuelPurchaseView {
  return {
    purchase_id: row.purchase_id,
    purchased_at: row.purchased_at,
    vehicle_id: row.vehicle_id,
    vehicle_plate: row.vehicle_plate,
    litres: row.litres,
    total_cost: { amount: row.total_cost_amount, currency: row.currency },
    supplier_name: row.supplier_name,
    odometer_km: row.odometer_km,
    reconciliation_status: row.reconciliation_status,
    rejection_reason: row.rejection_reason,
  };
}

export interface StatementInput {
  provider: string;
  periodStart: string;
  periodEnd: string;
  mediaObjectId: string;
  columnMapping: Record<string, unknown>;
}

export class ReconciliationService {
  constructor(private readonly statements: FuelStatementRepository) {}

  async importStatement(tx: Tx, input: StatementInput, actor: Actor): Promise<Result<{ statementId: string }>> {
    const statement = await this.statements.insert({
      provider: input.provider,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      media_object_id: input.mediaObjectId,
      column_mapping: input.columnMapping as unknown as Record<string, never>,
      uploaded_by: actor.userId,
    });

    tx.audit({
      action: "CREATE",
      entity_table: "app.fuel_card_statements",
      entity_id: statement.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/reconciliation/statements",
      http_method: "POST",
    });
    // CSV parse + matching is performed by the worker (A1.9).
    tx.registerOutbox({
      event_type: "reconciliation.statement",
      aggregate_type: "fuel_card_statement",
      aggregate_id: statement.id,
      payload: { uploadedBy: actor.userId },
    });
    return ok({ statementId: statement.id });
  }
}

const INBOX_SORT = { purchased_at: "purchased_at" } as const;

export class FuelQuery {
  constructor(
    private readonly client: DbClient,
    private readonly purchases?: FuelPurchaseRepository,
  ) {}

  private get purchaseRepo(): FuelPurchaseRepository {
    return this.purchases ?? new FuelPurchaseRepository(this.client);
  }

  /** Cursor page over the caller's own fuel purchases (03 §2.3, D7). */
  async listMyPurchases(
    driverId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<Result<CursorPage<FuelPurchaseView>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor);
    const rows = await this.purchaseRepo.listByDriver(driverId, {
      limit: limit + 1,
      cursorSort: cursor?.sort,
      cursorId: cursor?.id,
    });
    const page = buildPage(rows, limit, (row) => ({ sort: String(row.purchased_at ?? ""), id: row.purchase_id }));
    return ok({ ...page, data: page.data.map(toPurchaseView) });
  }

  /** Single purchase detail; NotFound when the id is unknown. */
  async getPurchase(purchaseId: string, driverId?: string): Promise<Result<FuelPurchaseView>> {
    const row = await this.purchaseRepo.getDetailById(purchaseId, driverId);
    if (!row) return err(new NotFound("Fuel purchase not found"));
    return ok(toPurchaseView(row));
  }

  /** Cursor page over `v_fuel_reconciliation_inbox` (03 §2.3, D7). */
  async reconciliationInbox(opts: {
    vehicleId?: string;
    verified?: boolean;
    sort?: string;
    limit: number;
    cursor?: string;
  }): Promise<Result<{ data: FuelReconciliationInboxViewRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const sortColumn = resolveSortColumn(INBOX_SORT, opts.sort, "purchased_at");
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.vehicleId) {
      params.push(opts.vehicleId);
      where.push(`vehicle_id = $${params.length}`);
    }
    if (opts.verified === true) {
      where.push(`admin_verified = true`);
    } else if (opts.verified === false) {
      where.push(`admin_verified = false AND rejected_at IS NULL`);
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(purchased_at, fuel_purchase_id) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const res = await this.client.query<FuelReconciliationInboxViewRow>(
      `SELECT * FROM app.v_fuel_reconciliation_inbox ${whereSql}
       ORDER BY ${sortColumn} DESC, fuel_purchase_id DESC
       LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const page = buildPage(res.rows, limit, (row) => ({
      sort: String(row.purchased_at ?? ""),
      id: row.fuel_purchase_id ?? "",
    }));
    return ok(page);
  }
}

