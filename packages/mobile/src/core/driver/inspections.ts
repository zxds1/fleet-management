// packages/mobile/src/core/driver/inspections.ts
//
// DVIR journey (1.1): submit a vehicle/trailer inspection. Failing items require a photo (the caller
// uploads one photo per failing item and attaches its `media_object_id`). A `block_shift` flag in the
// 201 response tells the UI the vehicle is now grounded. Pure over injected ports.

import { z } from "zod"
import { InspectionSubmitSchema, InspectionItemSchema, type InspectionSubmitInput, type InspectionItemInput } from "@fleet/shared/mobile"
import { DriverService, type DriverServiceDeps } from "./base"
import { EvidencePhoto, type SubmitResult } from "./types"

export interface InspectionParams {
  shift_id: string
  template_id: string
  subject: InspectionSubmitInput["subject"]
  vehicle_id?: string | null
  trailer_id?: string | null
  previous_defects_reviewed: boolean
  signature_name: string
  items: InspectionItemInput[]
}

export interface InspectionEvidence {
  /** Keyed by `template_item_id` for FAIL items that need a photo. */
  photos: Record<string, EvidencePhoto>
}

export const InspectionResultSchema = z.object({
  inspection_id: z.string().uuid(),
  block_shift: z.boolean(),
})
export type InspectionResult = z.infer<typeof InspectionResultSchema>

/** Checklist the driver can start an inspection from (`GET /inspections/templates`). */
export const InspectionTemplateSchema = z
  .object({
    id: z.string().optional(),
    template_id: z.string().optional(),
    label: z.string().optional(),
    name: z.string().optional(),
  })
  .transform((r) => ({ id: r.id ?? r.template_id ?? "", label: r.label ?? r.name ?? "" }))
export type InspectionTemplate = z.infer<typeof InspectionTemplateSchema>

/** One row of the driver's DVIR submissions (B.10) from `GET /inspections/me`. */
export const DvirSummarySchema = z
  .object({
    inspection_id: z.string().uuid(),
    template_label: z.string().nullable().optional(),
    vehicle_id: z.string().uuid().nullable().optional(),
    vehicle_plate: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    submitted_at: z.string().nullable().optional(),
    defect_count: z.number().int().nullable().optional(),
    quarantined: z.boolean().nullable().optional(),
    block_shift: z.boolean().nullable().optional(),
  })
  .transform((r) => ({
    inspection_id: r.inspection_id,
    template_label: r.template_label ?? null,
    vehicle_id: r.vehicle_id ?? null,
    vehicle_plate: r.vehicle_plate ?? null,
    status: r.status ?? "SUBMITTED",
    submitted_at: r.submitted_at ?? undefined,
    defect_count: r.defect_count ?? null,
    quarantined: r.quarantined ?? r.block_shift ?? false,
  }))
export type DvirSummary = z.infer<typeof DvirSummarySchema>

/**
 * Per-item detail row (B.12). Reuses the shared `InspectionItemSchema` result enum so the read model
 * stays in lockstep with the submit contract, and adds the review-side notes / photo count.
 */
export const DvirDetailItemSchema = z
  .object({
    item_id: z.string().optional(),
    template_item_id: z.string().optional(),
    label: z.string().nullable().optional(),
    result: InspectionItemSchema.shape.result.nullable().optional(),
    notes: z.string().nullable().optional(),
    photo_count: z.number().int().nullable().optional(),
    photo_media_object_id: z.string().nullable().optional(),
    blocker: z.boolean().nullable().optional(),
  })
  .transform((r) => ({
    item_id: r.item_id ?? r.template_item_id ?? "",
    label: r.label ?? "",
    // The screen renders PASS / FAIL / NA; the contract's NOT_APPLICABLE maps onto NA.
    result: r.result === "NOT_APPLICABLE" ? "NA" : (r.result ?? null),
    notes: r.notes ?? null,
    photo_count: r.photo_count ?? (r.photo_media_object_id ? 1 : 0),
    blocker: r.blocker ?? false,
  }))
export type DvirDetailItem = z.infer<typeof DvirDetailItemSchema>

export const DvirDetailSchema = z.object({
  inspection_id: z.string().uuid(),
  template_label: z.string().nullable().optional(),
  vehicle_label: z.string().nullable().optional(),
  trailer_label: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  quarantined: z.boolean().nullable().optional(),
  odometer_km: z.number().int().nullable().optional(),
  signature_name: z.string().nullable().optional(),
  items: z.array(DvirDetailItemSchema).nullable().optional(),
})
export type DvirDetail = z.infer<typeof DvirDetailSchema>

const InspectionPageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

/** Accepts the cursor envelope, a bare array, or `{ templates: [...] }` / `{ items: [...] }`. */
function rowsOf(raw: unknown, key?: string): unknown[] {
  const page = InspectionPageSchema.safeParse(raw)
  if (page.success) return page.data.data
  if (Array.isArray(raw)) return raw
  if (key && raw && typeof raw === "object") {
    const v = (raw as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v
  }
  return []
}

export class InspectionsService extends DriverService {
  constructor(deps: DriverServiceDeps) {
    super(deps)
  }

  /** Checklists the driver may start (B.10). Binds to `GET /inspections/templates`. */
  async listTemplates(): Promise<InspectionTemplate[]> {
    const raw = await this.api.request<unknown>("/inspections/templates", { method: "GET" })
    const out: InspectionTemplate[] = []
    for (const row of rowsOf(raw, "templates")) {
      const parsed = InspectionTemplateSchema.safeParse(row)
      if (parsed.success && parsed.data.id && parsed.data.label) out.push(parsed.data)
    }
    return out
  }

  /** The driver's recent submissions with review status (B.10). Binds to `GET /inspections/me`. */
  async listSubmissions(): Promise<DvirSummary[]> {
    const raw = await this.api.request<unknown>("/inspections/me", { method: "GET" })
    const out: DvirSummary[] = []
    for (const row of rowsOf(raw, "inspections")) {
      const parsed = DvirSummarySchema.safeParse(row)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }

  /** Read-only DVIR detail with per-item results, notes and photo counts (B.12). */
  async getOne(inspectionId: string): Promise<DvirDetail> {
    const raw = await this.api.request<unknown>(`/inspections/${inspectionId}`, { method: "GET" })
    return DvirDetailSchema.parse(raw)
  }

  async submit(params: InspectionParams, evidence: InspectionEvidence): Promise<SubmitResult & { blockShift?: boolean }> {
    const items = await Promise.all(
      params.items.map(async (it) => {
        const failPhoto = it.result === "FAIL" ? evidence.photos[it.template_item_id] : undefined
        if (failPhoto) {
          const id = await this.media.upload(failPhoto, {
            owner_kind: "INSPECTION_ITEM",
            retention_class: "INSPECTION",
            content_type: "image/jpeg",
            width_px: failPhoto.width,
            height_px: failPhoto.height,
            client_captured_at: failPhoto.createdAt,
          })
          return { ...it, photo_media_object_id: id }
        }
        return it
      }),
    )

    const body = InspectionSubmitSchema.parse({
      shift_id: params.shift_id,
      template_id: params.template_id,
      subject: params.subject,
      vehicle_id: params.vehicle_id,
      trailer_id: params.trailer_id,
      previous_defects_reviewed: params.previous_defects_reviewed,
      signature_name: params.signature_name,
      items,
    })

    const r = await this.commit("POST", "/inspections", body, "DVIR")
    const result = r.done as InspectionResult | undefined
    return {
      ...this.toResult(result?.inspection_id ?? "", r),
      blockShift: result?.block_shift,
    }
  }
}

export { z }
