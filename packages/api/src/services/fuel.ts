// packages/api/src/services/fuel.ts
// Fuel domain (03 §2.3, 03 §4). The driver entry point is photo-first (A1.4)
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
import type {
  FuelCorrectionInput,
  PhotoFirstRefuelInput,
  VerifyPurchaseInput,
} from "@fleet/shared";
import type { FuelCardRow, FuelPurchaseRow } from "@fleet/shared";
import { FuelCardRepository, FuelPurchaseRepository } from "../repositories/fuel";
import { FuelRecordRepository } from "../repositories/shifts";
import type { Actor } from "./shift";

/** pg returns numeric as a string; NULL and unparseable both collapse to null. */
function numeric(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface RefuelOutcome {
  fuelPurchaseId: string;
  openAnomalies: string[];
}

/**
 * Photo-first capture (A1.4). The driver only supplies the two photographs and an odometer
 * reading; litres / amount / station / receipt date arrive from the OCR worker.
 *
 * Two DB realities shape the INSERT below (07_financial.sql, as amended by migration 12):
 *  - `litres` and `total_cost` are NOT NULL, so the as-captured values live in the new
 *    `liters_pumped` / `amount_spent` columns and the legacy pair is seeded with 0 until an
 *    Admin verifies. Migration 12 widens the litres CHECK to `>= 0` and regenerates `unit_price`
 *    over `NULLIF(litres,0)` so that seed is legal and does not divide by zero.
 *  - `fuel_purchases_driver_entry_has_gauge_pair` forbids a DRIVER row without the B3 gauge pair,
 *    which photo-first deliberately does not collect. Rather than laundering the row through the
 *    privileged `ADMIN` back-entry branch, migration 12 adds a dedicated `DRIVER_PHOTO`
 *    entry_source whose own constraint requires the receipt + odometer photo pair instead.
 */
export interface PhotoFirstOutcome {
  fuelPurchaseId: string;
}

export class FuelService {
  constructor(
    private readonly purchases: FuelPurchaseRepository,
    private readonly fuelRecords: FuelRecordRepository,
  ) {}

  /** POST /driver/fuel/purchase (A1.4). Queues OCR by leaving ocr_status='PENDING'. */
  async submitPhotoFirst(
    tx: Tx,
    driverId: string,
    input: PhotoFirstRefuelInput,
    actor: Actor,
  ): Promise<Result<PhotoFirstOutcome>> {
    // The client supplies vehicle_id/shift_id, so neither can be trusted: without this check any
    // driver could attribute a purchase (and its cost) to another crew's vehicle or shift.
    // A shift, when given, must be the driver's own AND cover the stated vehicle; with no shift we
    // fall back to a live (non-cancelled) assignment of that vehicle to this driver.
    const link = input.shift_id
      ? await tx.client.query<{ ok: boolean }>(
          `SELECT true AS ok FROM app.shifts
             WHERE id = $1 AND driver_id = $2 AND vehicle_id = $3`,
          [input.shift_id, driverId, input.vehicle_id],
        )
      : await tx.client.query<{ ok: boolean }>(
          `SELECT true AS ok FROM app.assignments
             WHERE driver_id = $1 AND vehicle_id = $2 AND status <> 'CANCELLED'
               AND assigned_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date - 1
             LIMIT 1`,
          [driverId, input.vehicle_id],
        );
    if (!link.rows[0]) {
      return err(new Forbidden("Vehicle is not assigned to you for this shift"));
    }

    const res = await tx.client.query<{ id: string }>(
      `INSERT INTO app.fuel_purchases (
         shift_id, vehicle_id, driver_id, entry_source,
         fuel_card_last_four, litres, total_cost, odometer_km, purchased_at,
         receipt_media_object_id, pump_photo_media_object_id, odometer_photo_media_object_id,
         amount_spent, liters_pumped, ocr_status
       ) VALUES ($1,$2,$3,'DRIVER_PHOTO',$4,0,0,$5,$6,$7,$8,$9,NULL,NULL,'PENDING')
       RETURNING id`,
      [
        input.shift_id,
        input.vehicle_id,
        driverId,
        input.fuel_card_last_four ?? "0000",
        input.odometer_reading,
        input.purchased_at,
        input.receipt_media_object_id,
        // A1.4 v2: the pump photograph is the required capture; the odometer
        // gauge photo is the legacy optional one.
        input.pump_photo_media_object_id,
        input.odometer_photo_media_object_id ?? null,
      ],
    );
    const id = res.rows[0]!.id;

    tx.audit({
      action: "CREATE",
      entity_table: "app.fuel_purchases",
      entity_id: id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/driver/fuel/purchase",
      http_method: "POST",
    });
    // The worker's OCR job polls ocr_status='PENDING'; the outbox event wakes the relay early.
    tx.registerOutbox({
      event_type: "fuel.ocr",
      aggregate_type: "fuel_purchase",
      aggregate_id: id,
      payload: { driverId, vehicleId: input.vehicle_id, photoFirst: true },
    });

    return ok({ fuelPurchaseId: id });
  }

  /**
   * POST /driver/fuel/correct (A1.4). The driver overrides what OCR read. Only the supplied
   * fields move; `driver_corrected` freezes the row against a late OCR write-back, and when the
   * driver supplies the whole OCR-derived set the extraction is recorded as MANUAL.
   */
  async applyCorrection(
    tx: Tx,
    driverId: string,
    input: FuelCorrectionInput,
    actor: Actor,
  ): Promise<Result<{ fuelPurchaseId: string; pricePerLiter: number | null }>> {
    const existing = await tx.client.query<{
      id: string;
      driver_id: string | null;
      admin_verified: boolean;
      rejected_at: Date | null;
      amount_spent: string | null;
      liters_pumped: string | null;
    }>(
      `SELECT id, driver_id, admin_verified, rejected_at, amount_spent, liters_pumped
         FROM app.fuel_purchases WHERE id = $1`,
      [input.purchase_id],
    );
    const row = existing.rows[0];
    if (!row) return err(new NotFound("Fuel purchase not found"));
    // A driver may only correct their own capture, and only before Admin verification (C6.1).
    if (row.driver_id !== driverId) return err(new Forbidden("Not your fuel purchase"));
    if (row.admin_verified) {
      return err(violation("ALREADY_VERIFIED", "Already verified", "A verified purchase can only be adjusted by an Admin (C6.1)."));
    }
    // A rejected purchase has already been adjudicated: leaving it writable would let the driver
    // rewrite the very figures the rejection was based on (C6.1).
    if (row.rejected_at) {
      return err(violation("ALREADY_REJECTED", "Already rejected", "A rejected purchase can no longer be corrected; contact an Admin."));
    }

    // Resolve the post-correction amount/litres so price_per_liter stays consistent with them.
    const amount = input.corrected_amount ?? numeric(row.amount_spent);
    const liters = input.corrected_liters ?? numeric(row.liters_pumped);
    const pricePerLiter = amount != null && liters != null && liters > 0
      ? Math.round((amount / liters) * 100) / 100
      : null;

    // MANUAL only when the driver keyed every OCR-derived field themselves.
    const fullyManual =
      input.corrected_amount != null &&
      input.corrected_liters != null &&
      input.corrected_date != null &&
      input.corrected_station != null;

    const changed: string[] = [];
    if (input.corrected_amount != null) changed.push("amount_spent");
    if (input.corrected_liters != null) changed.push("liters_pumped");
    if (input.corrected_date != null) changed.push("receipt_date");
    if (input.corrected_station != null) changed.push("station_name");
    if (input.corrected_odometer != null) changed.push("odometer_km");

    await tx.client.query(
      `UPDATE app.fuel_purchases
          SET amount_spent     = COALESCE($1, amount_spent),
              liters_pumped    = COALESCE($2, liters_pumped),
              receipt_date     = COALESCE($3::date, receipt_date),
              station_name     = COALESCE($4, station_name),
              odometer_km      = COALESCE($5, odometer_km),
              price_per_liter  = COALESCE($6, price_per_liter),
              ocr_method       = CASE WHEN $7 THEN 'MANUAL' ELSE ocr_method END,
              driver_corrected = true,
              updated_at       = now()
        WHERE id = $8`,
      [
        input.corrected_amount ?? null,
        input.corrected_liters ?? null,
        input.corrected_date ?? null,
        input.corrected_station ?? null,
        input.corrected_odometer ?? null,
        pricePerLiter,
        fullyManual,
        row.id,
      ],
    );

    tx.audit({
      action: "UPDATE",
      entity_table: "app.fuel_purchases",
      entity_id: row.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      changed_fields: changed,
      reason: "driver_ocr_correction",
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/driver/fuel/correct",
      http_method: "POST",
    });

    return ok({ fuelPurchaseId: row.id, pricePerLiter });
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

      // Photo-first adjustments (A1.4). Written straight to SQL because these columns are
      // outside the legacy FuelPurchaseRow patch surface, and price_per_liter must be recomputed
      // from whichever of amount/litres the Admin has just settled on. On VERIFY the settled
      // amount/litres are also promoted to the authoritative `total_cost` / `litres` columns so the
      // downstream reconciliation/statements read the final, verified figures (F5) — not the raw
      // OCR capture.
      if (
        input.adjusted_amount != null ||
        input.adjusted_litres != null ||
        input.adjusted_odometer != null ||
        input.admin_notes != null
      ) {
        const amount = numeric(input.adjusted_amount) ?? numeric((purchase as { amount_spent?: string | null }).amount_spent);
        const litres = numeric(input.adjusted_litres) ?? numeric((purchase as { liters_pumped?: string | null }).liters_pumped);
        const pricePerLiter = amount != null && litres != null && litres > 0
          ? Math.round((amount / litres) * 100) / 100
          : null;

        await tx.client.query(
          `UPDATE app.fuel_purchases
              SET amount_spent    = COALESCE($1, amount_spent),
                  liters_pumped   = COALESCE($2, liters_pumped),
                  odometer_km     = COALESCE($3, odometer_km),
                  price_per_liter = COALESCE($4, price_per_liter),
                  total_cost      = COALESCE($7, total_cost),
                  litres          = COALESCE($8, litres),
                  adjustments     = adjustments || $5::jsonb,
                  updated_at      = now()
            WHERE id = $6`,
          [
            input.adjusted_amount ?? null,
            input.adjusted_litres ?? null,
            input.adjusted_odometer ?? null,
            pricePerLiter,
            JSON.stringify({
              ...(input.adjusted_amount != null ? { amount: input.adjusted_amount } : {}),
              ...(input.adjusted_litres != null ? { litres: input.adjusted_litres } : {}),
              ...(input.adjusted_odometer != null ? { odometer_km: input.adjusted_odometer } : {}),
              ...(input.admin_notes != null ? { admin_notes: input.admin_notes } : {}),
            }),
            purchase.id,
            input.adjusted_amount != null ? String(input.adjusted_amount) : null,
            input.adjusted_litres != null ? String(input.adjusted_litres) : null,
          ],
        );
      }
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

import type { DbClient } from "@fleet/shared";
import { FuelStatementRepository } from "../repositories/fuel";
import { OCR_CONFIDENCE_THRESHOLD, FuelPurchaseRowSchema, type FuelPurchaseSummary } from "@fleet/shared";
import { buildPage, decodeCursor, MAX_PAGE_LIMIT, resolveSortColumn } from "../http/pagination";

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

const INBOX_SORT = { purchased_at: "fp.purchased_at" } as const;

/**
 * The ONE projection every fuel read surface returns (M6). `total_cost` / `litres` are the
 * canonical names; the photo-first capture columns (`amount_spent` / `liters_pumped`) are the
 * fallback for a purchase that has not been verified yet — the database seeds `litres` /
 * `total_cost` with 0 until an Admin settles them, and the column comments state that the
 * promoted pair stays authoritative once it is set.
 */
const FUEL_PURCHASE_PROJECTION = (thresholdParam: number) => `
       fp.id                                   AS fuel_purchase_id,
       fp.purchased_at,
       fp.receipt_date,
       fp.station_name,
       fp.vehicle_id,
       v.vehicle_plate,
       fp.driver_id,
       v.driver_name,
       COALESCE(NULLIF(fp.total_cost, 0), fp.amount_spent)  AS total_cost,
       COALESCE(NULLIF(fp.litres, 0), fp.liters_pumped)     AS litres,
       fp.currency,
       fp.unit_price,
       fp.odometer_km,
       fp.ocr_status,
       fp.ocr_method,
       fp.ocr_raw                              AS ocr_raw_data,
       fp.ocr_confidence,
       fp.driver_corrected,
       v.gauge_before_percent,
       v.gauge_after_percent,
       fp.receipt_media_object_id,
       fp.pump_photo_media_object_id,
       fp.odometer_photo_media_object_id,
       fp.admin_verified,
       fp.rejected_at,
       fp.cleared_for_payment_at,
       v.open_anomalies,
       v.worst_open_severity,
       (fp.odometer_km - prev.odometer_km)     AS distance_since_last_refuel,
       CASE WHEN prev.odometer_km IS NOT NULL
             AND fp.odometer_km IS NOT NULL
             AND (fp.odometer_km - prev.odometer_km) > 0
             AND COALESCE(NULLIF(fp.total_cost, 0), fp.amount_spent) IS NOT NULL
            THEN round(COALESCE(NULLIF(fp.total_cost, 0), fp.amount_spent)
                       / (fp.odometer_km - prev.odometer_km), 2)
       END                                    AS cost_per_km,
       CASE
         WHEN a.open_severe > 0 THEN 'FLAGGED'
         WHEN fp.driver_corrected = false AND fp.ocr_confidence >= $${thresholdParam} THEN 'AUTO'
         ELSE 'REVIEW'
       END                                    AS badge`;

/**
 * The joins every fuel read surface needs: the reporting view (vehicle plate, driver name, gauge
 * percentages, anomaly counters) and the two lateral lookups (the previous refuel on the same
 * vehicle, and the open-severe anomaly count that drives the triage badge).
 */
const FUEL_PURCHASE_JOINS = `
      JOIN app.v_fuel_reconciliation_inbox v ON v.fuel_purchase_id = fp.id
      -- Baseline = the most recent earlier refuel on the same vehicle, verified or not, so the
      -- distance is measured against the real previous fill-up.
      LEFT JOIN LATERAL (
             SELECT prev_fp.odometer_km
               FROM app.fuel_purchases prev_fp
              WHERE prev_fp.vehicle_id = fp.vehicle_id
                AND prev_fp.purchased_at < fp.purchased_at
                AND prev_fp.rejected_at IS NULL
                AND prev_fp.odometer_km IS NOT NULL
              ORDER BY prev_fp.purchased_at DESC
              LIMIT 1
          ) prev ON true
      LEFT JOIN LATERAL (
             SELECT count(*)::int AS open_severe
               FROM app.fuel_purchase_anomalies fa
              WHERE fa.fuel_purchase_id = fp.id
                AND fa.resolved_at IS NULL
                AND fa.severity IN ('CRITICAL','HIGH')
          ) a ON true`;

export class FuelQuery {
  constructor(private readonly client: DbClient) {}

  /**
   * Cursor page over the fuel purchases awaiting reconciliation (03 §2.3, D7). Returns the
   * canonical fuel purchase row — the same shape `GET /admin/fuel/pending` returns (M6).
   */
  async reconciliationInbox(opts: {
    vehicleId?: string;
    verified?: boolean;
    sort?: string;
    limit: number;
    cursor?: string;
  }): Promise<Result<{ data: FuelPurchaseSummary[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const sortColumn = resolveSortColumn(INBOX_SORT, opts.sort, "purchased_at");
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.vehicleId) {
      params.push(opts.vehicleId);
      where.push(`fp.vehicle_id = $${params.length}`);
    }
    if (opts.verified === true) {
      where.push(`fp.admin_verified = true`);
    } else if (opts.verified === false) {
      where.push(`fp.admin_verified = false AND fp.rejected_at IS NULL`);
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(fp.purchased_at, fp.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(OCR_CONFIDENCE_THRESHOLD);
    const thresholdParam = params.length;

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const res = await this.client.query<Record<string, unknown>>(
      `SELECT ${FUEL_PURCHASE_PROJECTION(thresholdParam)}
         FROM app.fuel_purchases fp
         ${FUEL_PURCHASE_JOINS}
         ${whereSql}
        ORDER BY ${sortColumn} DESC, fp.id DESC
        LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const page = buildPage(
      res.rows.map((row) => FuelPurchaseRowSchema.parse(row)),
      limit,
      (row) => ({
        sort: String(row.purchased_at ?? ""),
        id: row.fuel_purchase_id ?? "",
      }),
    );
    return ok(page);
  }

  /**
   * GET /admin/fuel/pending (2.7, A1.4). Photo-first review queue: each unverified purchase with
   * the distance and cost-per-km implied by the previous refuel on the same vehicle, plus a triage
   * badge. Returns the canonical fuel purchase row — the same shape `GET /fuel/reconciliation-inbox`
   * returns (M6).
   *
   *  FLAGGED — an unresolved CRITICAL/HIGH anomaly is attached.
   *  AUTO    — OCR read it cleanly (confidence >= OCR_CONFIDENCE_THRESHOLD) and the driver did not override it.
   *  REVIEW  — everything else; a human decides.
   */
  async pendingReview(opts: { limit: number; tenantId: string }): Promise<Result<{ purchases: FuelPurchaseSummary[] }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const res = await this.client.query<Record<string, unknown>>(
      // The page is selected FIRST (bounded by the partial index on unverified purchases), then the
      // odometer baseline is looked up per row. Computing the baseline with a window function over
      // the whole unverified set instead would (a) defeat the LIMIT by forcing a full scan+sort and
      // (b) silently use the previous *pending* purchase as the baseline, which is wrong whenever
      // the preceding refuel was already verified — i.e. in the normal case.
      // Tenant-scoped explicitly (defence in depth on top of RLS): a fuel purchase and its vehicle
      // both carry the tenant, so the queue can never surface another company's receipts.
      `WITH pending AS (
         SELECT fp.*
           FROM app.fuel_purchases fp
          WHERE fp.tenant_id = $3 AND fp.admin_verified = false AND fp.rejected_at IS NULL
          ORDER BY fp.purchased_at DESC
          LIMIT $1
       )
       SELECT ${FUEL_PURCHASE_PROJECTION(2)}
         FROM pending fp
         ${FUEL_PURCHASE_JOINS}
        ORDER BY fp.purchased_at DESC`,
      [limit, OCR_CONFIDENCE_THRESHOLD, opts.tenantId],
    );
    // Parsed through the shared schema so PG's numeric-as-string columns are normalised to numbers
    // exactly once, server-side, and the emitted payload is provably the shape the client parses.
    return ok({ purchases: res.rows.map((row) => FuelPurchaseRowSchema.parse(row)) });
  }

  /**
   * GET /driver/fuel/purchase/:id/ocr (A1.4 step 5). The driver's review screen polls this after
   * submitting, because OCR runs asynchronously in the worker and cannot be returned by the POST.
   * Scoped to the calling driver's own purchase; `status` lets the client stop polling.
   */
  async ocrPreview(
    purchaseId: string,
    driverId: string,
  ): Promise<Result<{ status: string; ocr: OcrPreview | null }>> {
    const res = await this.client.query<{
      driver_id: string | null;
      ocr_status: string;
      amount_spent: string | null;
      liters_pumped: string | null;
      receipt_date: string | null;
      station_name: string | null;
      ocr_confidence: string | null;
    }>(
      `SELECT driver_id, ocr_status, amount_spent, liters_pumped,
              receipt_date, station_name, ocr_confidence
         FROM app.fuel_purchases WHERE id = $1`,
      [purchaseId],
    );
    const row = res.rows[0];
    if (!row) return err(new NotFound("Fuel purchase not found"));
    if (row.driver_id !== driverId) return err(new Forbidden("Not your fuel purchase"));

    return ok({
      status: row.ocr_status,
      ocr:
        row.ocr_status === "PENDING"
          ? null
          : {
              amount: row.amount_spent,
              liters: row.liters_pumped,
              date: row.receipt_date,
              station: row.station_name,
              // 0–1 as stored (numeric(4,3)); the client compares against the shared threshold.
              confidence: row.ocr_confidence === null ? null : Number(row.ocr_confidence),
            },
    });
  }
}

/** OCR values as read back for the driver's review step. */
export interface OcrPreview {
  amount: string | null;
  liters: string | null;
  date: string | null;
  station: string | null;
  confidence: number | null;
}

/**
 * One row of the photo-first admin review queue. Re-exported from `@fleet/shared` so the SQL
 * projection above and the mobile client that parses it are typed by ONE definition — renaming a
 * column alias here is then a compile error rather than a silently empty inbox.
 */
export type { FuelPendingRow } from "@fleet/shared";

