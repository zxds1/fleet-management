// packages/mobile/src/core/driver/refuel.ts
//
// Refuel journey (B3), photo-first. The driver snaps the receipt and the odometer; the only value
// typed by hand is the odometer reading. Both photos are uploaded first (so a replayed outbox item
// always references durable `media_object_id`s), then `POST /driver/fuel/purchase` carries the
// PhotoFirstRefuelInput. The backend OCRs the receipt and may return an `ocr` preview in the 201
// body; when it does not, the UI simply shows the review step with no parsed values and the driver
// can correct them afterwards via `POST /driver/fuel/correct`.

import { z } from "zod"
import {
  FuelCorrectionSchema,
  PhotoFirstRefuelSchema,
  RefuelSchema,
  type FuelCorrectionInput,
  type PhotoFirstRefuelInput,
  type RefuelInput,
} from "@fleet/shared/mobile"
import { DriverService, type DriverServiceDeps } from "./base"
import { EvidencePhoto, type SubmitResult } from "./types"

/** @deprecated Superseded by the photo-first flow — use {@link PhotoFirstRefuelParams}. */
export interface RefuelParams {
  shift_id: string | null
  vehicle_id: string
  fuel_card_last_four: string
  litres: number
  total_cost: { amount: string; currency?: string }
  odometer_km: number
  purchased_at: string
  supplier_name?: string
}

/** @deprecated Superseded by the photo-first flow (receipt + odometer photo only). */
export interface RefuelEvidence {
  before: EvidencePhoto
  after: EvidencePhoto
  receipt: EvidencePhoto
}

/**
 * Photo-first submission (spec step 6). Zero typed fields beyond `odometer_reading`: amount, litres,
 * date and station are OCR'd from the receipt server-side.
 */
export interface PhotoFirstRefuelParams {
  shift_id: string | null
  vehicle_id: string
  /** The one hand-typed value; must exceed the vehicle's last recorded odometer. */
  odometer_reading: number
  receipt: EvidencePhoto
  odometerPhoto: EvidencePhoto
  fuel_card_last_four?: string
  purchased_at: string
}

/**
 * OCR preview of the receipt. Every field is optional: a low-quality scan may yield only some of
 * them, and `confidence` (0–100) below the review threshold makes the UI warn before saving.
 */
export const RefuelOcrSchema = z
  .object({
    amount: z.union([z.string(), z.number()]).nullable().optional(),
    liters: z.union([z.string(), z.number()]).nullable().optional(),
    litres: z.union([z.string(), z.number()]).nullable().optional(),
    date: z.string().nullable().optional(),
    station: z.string().nullable().optional(),
    confidence: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .transform((r) => ({
    amount: r.amount === null || r.amount === undefined ? undefined : String(r.amount),
    liters: numeric(r.liters ?? r.litres),
    date: r.date ?? undefined,
    station: r.station ?? undefined,
    confidence: numeric(r.confidence),
  }))
export type RefuelOcr = z.infer<typeof RefuelOcrSchema>

/** 201 body of `POST /driver/fuel/purchase`; the `ocr` preview is optional by design. */const PhotoFirstResultSchema = z.object({
  fuel_purchase_id: z.string().optional(),
  purchase_id: z.string().optional(),
  id: z.string().optional(),
  ocr: z.unknown().optional(),
  ocr_result: z.unknown().optional(),
  open_anomalies: z.array(z.string()).optional(),
})

export type PhotoFirstRefuelResult = SubmitResult & {  fuelPurchaseId: string
  ocr?: RefuelOcr
  anomalies?: string[]
}

function numeric(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Body of `GET /driver/fuel/purchase/:id/ocr`. `status` is the `app.ocr_status` enum. */
const OcrPollSchema = z.object({
  status: z.string(),
  ocr: z.unknown().nullable().optional(),
})

export const RefuelResultSchema = z.object({
  fuel_purchase_id: z.string().uuid(),
  open_anomalies: z.array(z.string()),
})
export type RefuelResult = z.infer<typeof RefuelResultSchema>

/**
 * One row of the driver's own fuel history (B.9). Mirrors `GET /fuel/refuel/me`; when that
 * driver-scoped route is not deployed we read the locked `GET /fuel/reconciliation-inbox`
 * (`app.v_fuel_reconciliation_inbox`), whose rows carry the same columns for the caller.
 */
export const PurchaseSummarySchema = z
  .object({
    purchase_id: z.string().uuid().optional(),
    fuel_purchase_id: z.string().uuid().nullable().optional(),
    purchased_at: z.string().nullable().optional(),
    vehicle_plate: z.string().nullable().optional(),
    litres: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
    total_cost: z
      .union([z.string(), z.number(), z.object({ amount: z.union([z.string(), z.number()]) })])
      .nullable()
      .optional(),
    currency: z.string().nullable().optional(),
    odometer_km: z.number().int().nullable().optional(),
    supplier_name: z.string().nullable().optional(),
    reconciliation_status: z.string().nullable().optional(),
    admin_verified: z.boolean().nullable().optional(),
    rejected_at: z.string().nullable().optional(),
    rejection_reason: z.string().nullable().optional(),
  })
  .transform((r) => ({
    purchase_id: r.purchase_id ?? r.fuel_purchase_id ?? "",
    purchased_at: r.purchased_at ?? undefined,
    vehicle_plate: r.vehicle_plate ?? null,
    litres: r.litres ?? null,
    total_cost: { amount: readAmount(r.total_cost) },
    currency: r.currency ?? "KES",
    odometer_km: r.odometer_km ?? null,
    supplier_name: r.supplier_name ?? null,
    reconciliation_status: r.reconciliation_status ?? derivedStatus(r.admin_verified, r.rejected_at),
    rejection_reason: r.rejection_reason ?? null,
  }))
export type PurchaseSummary = z.infer<typeof PurchaseSummarySchema>

const PurchasePageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

function readAmount(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === "object" && "amount" in (v as Record<string, unknown>)) {
    return String((v as { amount: string | number }).amount)
  }
  return String(v)
}

/** The inbox view exposes `admin_verified` / `rejected_at` rather than a status string. */
function derivedStatus(verified?: boolean | null, rejectedAt?: string | null): string {
  if (rejectedAt) return "REJECTED"
  if (verified) return "VERIFIED"
  return "PENDING"
}

export class RefuelService extends DriverService {
  constructor(deps: DriverServiceDeps) {
    super(deps)
  }

  /**
   * Driver's own purchases with their reconciliation status (B.9). Tries the driver-scoped
   * `GET /fuel/refuel/me`, falling back to the locked `GET /fuel/reconciliation-inbox`.
   */
  async listHistory(): Promise<PurchaseSummary[]> {
    let raw: unknown
    try {
      raw = await this.api.request<unknown>("/fuel/refuel/me", { method: "GET" })
    } catch {
      raw = await this.api.request<unknown>("/fuel/reconciliation-inbox?unverified_only=false", { method: "GET" })
    }
    const page = PurchasePageSchema.safeParse(raw)
    const rows = page.success ? page.data.data : Array.isArray(raw) ? raw : []
    const items: PurchaseSummary[] = []
    for (const row of rows) {
      const parsed = PurchaseSummarySchema.safeParse(row)
      if (parsed.success && parsed.data.purchase_id) items.push(parsed.data)
    }
    return items
  }

  /**
   * Photo-first refuel (spec steps 2–6). Uploads the receipt and the odometer photo first, then
   * posts `PhotoFirstRefuelInput` to `/driver/fuel/purchase`. `onOcrResult` fires as soon as the
   * 201 body yields a parsed receipt so the caller can render the review step without awaiting a
   * second round-trip; when the backend defers OCR the callback simply never fires and the review
   * step opens empty (the driver corrects the fields via {@link correct}).
   */
  async submitPhotoFirst(
    params: PhotoFirstRefuelParams,
    onOcrResult?: (ocr: RefuelOcr) => void,
  ): Promise<PhotoFirstRefuelResult> {
    const [receiptId, odometerMediaId] = await Promise.all([
      this.media.upload(params.receipt, {
        owner_kind: "FUEL_PURCHASE",
        retention_class: "FUEL_RECEIPT",
        content_type: "image/jpeg",
        width_px: params.receipt.width || undefined,
        height_px: params.receipt.height || undefined,
        client_captured_at: params.receipt.createdAt,
      }),
      this.media.upload(params.odometerPhoto, {
        // No dedicated FUEL_ODOMETER owner/retention pair exists in the media contract; the
        // odometer shot belongs to the fuel record and is retained on the dashboard-photo class.
        owner_kind: "FUEL_RECORD",
        retention_class: "FUEL_DASHBOARD",
        content_type: "image/jpeg",
        width_px: params.odometerPhoto.width || undefined,
        height_px: params.odometerPhoto.height || undefined,
        client_captured_at: params.odometerPhoto.createdAt,
      }),
    ])

    const body = PhotoFirstRefuelSchema.parse({
      shift_id: params.shift_id,
      vehicle_id: params.vehicle_id,
      odometer_reading: params.odometer_reading,
      receipt_media_object_id: receiptId,
      odometer_photo_media_object_id: odometerMediaId,
      fuel_card_last_four: params.fuel_card_last_four,
      purchased_at: params.purchased_at,
    } satisfies PhotoFirstRefuelInput)

    const r = await this.commit("POST", "/driver/fuel/purchase", body, "Refuel")
    const parsed = PhotoFirstResultSchema.safeParse(r.done)
    const data = parsed.success ? parsed.data : undefined
    const fuelPurchaseId = data?.fuel_purchase_id ?? data?.purchase_id ?? data?.id ?? ""

    // The 201 body may carry an OCR preview, but the backend runs OCR asynchronously, so normally
    // it does not. Accept it when present; otherwise the caller polls `pollOcr`.
    const rawOcr = data?.ocr ?? data?.ocr_result
    let ocr: RefuelOcr | undefined
    if (rawOcr && typeof rawOcr === "object") {
      const o = RefuelOcrSchema.safeParse(rawOcr)
      if (o.success) {
        ocr = o.data
        onOcrResult?.(o.data)
      }
    }

    return { ...this.toResult(fuelPurchaseId, r), fuelPurchaseId, ocr, anomalies: data?.open_anomalies }
  }

  /**
   * Poll `GET /driver/fuel/purchase/:id/ocr` until the extraction reaches a terminal state
   * (A1.4 step 5). OCR is queued for a background worker, so the review screen cannot render
   * until this resolves. Returns `undefined` when the attempt budget runs out — the review step
   * then opens with empty fields, which the driver can still fill in via the edit pencils.
   */
  async pollOcr(
    purchaseId: string,
    opts: { attempts?: number; intervalMs?: number; signal?: { cancelled: boolean } } = {},
  ): Promise<RefuelOcr | undefined> {
    const attempts = opts.attempts ?? 10
    const intervalMs = opts.intervalMs ?? 1500
    for (let i = 0; i < attempts; i++) {
      if (opts.signal?.cancelled) return undefined
      try {
        const res = await this.api.request<unknown>(`/driver/fuel/purchase/${purchaseId}/ocr`, { method: "GET" })
        const body = OcrPollSchema.safeParse(res)
        if (body.success && body.data.status !== "PENDING") {
          if (!body.data.ocr) return undefined
          const o = RefuelOcrSchema.safeParse(body.data.ocr)
          return o.success ? o.data : undefined
        }
      } catch {
        // Transient read failure — keep polling until the budget is spent.
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return undefined
  }

  /**
   * Driver correction of an OCR'd field (spec step 7). Posted separately from the purchase so the
   * original machine-read values stay auditable alongside what the driver says they should be.
   * `purchase_id` is stamped from the argument, so callers pass only the corrected fields.
   */
  async correct(
    purchaseId: string,
    correction: Omit<FuelCorrectionInput, "purchase_id">,
  ): Promise<SubmitResult> {
    const body = FuelCorrectionSchema.parse({ ...correction, purchase_id: purchaseId })
    const r = await this.commit("POST", "/driver/fuel/correct", body, "Refuel correction")
    return this.toResult(purchaseId, r)
  }

  /** @deprecated Legacy litres/cost refuel (B3). Use {@link submitPhotoFirst}. */
  async submit(params: RefuelParams, evidence: RefuelEvidence): Promise<SubmitResult & { anomalies?: string[] }> {
    const [beforeId, afterId, receiptId] = await Promise.all([
      this.media.upload(evidence.before, {
        owner_kind: "FUEL_RECORD",
        retention_class: "FUEL_RECEIPT",
        content_type: "image/jpeg",
        width_px: evidence.before.width,
        height_px: evidence.before.height,
        client_captured_at: evidence.before.createdAt,
      }),
      this.media.upload(evidence.after, {
        owner_kind: "FUEL_RECORD",
        retention_class: "FUEL_RECEIPT",
        content_type: "image/jpeg",
        width_px: evidence.after.width,
        height_px: evidence.after.height,
        client_captured_at: evidence.after.createdAt,
      }),
      this.media.upload(evidence.receipt, {
        owner_kind: "FUEL_PURCHASE",
        retention_class: "FUEL_RECEIPT",
        content_type: "image/jpeg",
        width_px: evidence.receipt.width,
        height_px: evidence.receipt.height,
        client_captured_at: evidence.receipt.createdAt,
      }),
    ])

    const body = RefuelSchema.parse({
      shift_id: params.shift_id,
      vehicle_id: params.vehicle_id,
      fuel_card_last_four: params.fuel_card_last_four,
      litres: params.litres,
      total_cost: { amount: params.total_cost.amount, currency: params.total_cost.currency ?? "KES" },
      odometer_km: params.odometer_km,
      purchased_at: params.purchased_at,
      before_fuel_record_id: beforeId,
      after_fuel_record_id: afterId,
      receipt_media_object_id: receiptId,
      supplier_name: params.supplier_name,
    } satisfies RefuelInput)

    const r = await this.commit("POST", "/fuel/refuel", body, "Refuel")
    const result = r.done as RefuelResult | undefined
    return {
      ...this.toResult(result?.fuel_purchase_id ?? "", r),
      anomalies: result?.open_anomalies,
    }
  }
}
