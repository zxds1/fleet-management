// packages/mobile/src/core/driver/vehicleIssue.ts
//
// Driver "report vehicle issue" journey (spec `report_vehicle_issue`). This is deliberately NOT the
// accident path: a defect report never escalates to the on-call roster and never freezes telemetry,
// so it posts to `POST /vehicles/{vehicleId}/issues` rather than `/accidents`.
//
// Like the other journey services it extends `DriverService`, so an optional evidence photo is
// uploaded through `MediaService` *first* and only the resulting `media_object_id` travels in the
// business POST. That ordering is what makes the offline outbox safe: a queued item already carries
// a valid media id, so the Drainer can replay it verbatim (C5.1 idempotent replay).
//
// The response schema below is a *view* schema local to the mobile client: it describes what the
// gateway returns today and is tolerant on everything the screen can render as "—".

import { z } from "zod"
import {
  VehicleIssueCreateSchema,
  type VehicleIssueCategoryInput,
  type VehicleIssueSeverityInput,
} from "@fleet/shared/mobile"
import { DriverService, type DriverServiceDeps } from "./base"
import { EvidencePhoto, type SubmitResult } from "./types"

/** Category picker values, in the order the screen renders them. */
export const VEHICLE_ISSUE_CATEGORIES: readonly VehicleIssueCategoryInput[] = [
  "MECHANICAL",
  "ELECTRICAL",
  "TYRE",
  "BODY",
  "OTHER",
] as const

/** Severity chips, low → high. */
export const VEHICLE_ISSUE_SEVERITIES: readonly VehicleIssueSeverityInput[] = ["LOW", "MEDIUM", "HIGH"] as const

export type VehicleIssueCategory = VehicleIssueCategoryInput
export type VehicleIssueSeverity = VehicleIssueSeverityInput

/** Screen-level payload; the photo (when present) is uploaded before the business POST. */
export interface VehicleIssueReportParams {
  category: VehicleIssueCategory
  severity: VehicleIssueSeverity
  description: string
  shift_id?: string | null
  /** Optional evidence photo. Unlike a DVIR FAIL item, evidence is never mandatory here. */
  photo?: EvidencePhoto | null
}

/** `POST /vehicles/{vehicleId}/issues` 201 body. Tolerant: only the id is relied upon. */
export const VehicleIssueResultSchema = z
  .object({
    issue_id: z.string(),
    vehicle_id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .transform((r) => ({
    issue_id: r.issue_id,
    vehicle_id: r.vehicle_id ?? null,
    status: r.status ?? "OPEN",
    severity: r.severity ?? "LOW",
    created_at: r.created_at ?? null,
  }))
export type VehicleIssueResult = z.infer<typeof VehicleIssueResultSchema>

/** One row of `GET /vehicles/{vehicleId}/issues`, used by the (future) issue history list. */
export const VehicleIssueSummarySchema = z
  .object({
    id: z.string(),
    vehicle_id: z.string().nullable().optional(),
    vehicle_plate: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    photo_media_object_id: z.string().nullable().optional(),
    reported_by_name: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .transform((r) => ({
    id: r.id,
    vehicle_id: r.vehicle_id ?? null,
    vehicle_plate: r.vehicle_plate ?? null,
    category: r.category ?? "OTHER",
    severity: r.severity ?? "LOW",
    status: r.status ?? "OPEN",
    description: r.description ?? "",
    photo_media_object_id: r.photo_media_object_id ?? null,
    reported_by_name: r.reported_by_name ?? null,
    created_at: r.created_at ?? null,
  }))
export type VehicleIssueSummary = z.infer<typeof VehicleIssueSummarySchema>

const VehicleIssuePageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

export class VehicleIssueService extends DriverService {
  constructor(deps: DriverServiceDeps) {
    super(deps)
  }

  /**
   * Report a defect against the driver's active vehicle. When a photo is supplied it is uploaded
   * first so the queued/committed body carries a server-side media id; a failed upload surfaces to
   * the caller rather than silently dropping the evidence.
   */
  async report(vehicleId: string, params: VehicleIssueReportParams): Promise<SubmitResult> {
    let mediaId: string | undefined
    if (params.photo) {
      // `app.media_objects` has no VEHICLE_ISSUE owner kind: a defect report is triaged into a
      // maintenance work order, so the photo is registered under the MAINTENANCE retention class
      // rather than inventing a new enum value (additive-migration policy, N10).
      mediaId = await this.media.upload(params.photo, {
        owner_kind: "MAINTENANCE_RECORD",
        retention_class: "MAINTENANCE",
        content_type: "image/jpeg",
        width_px: params.photo.width,
        height_px: params.photo.height,
        client_captured_at: params.photo.createdAt,
      })
    }

    const body = VehicleIssueCreateSchema.parse({
      category: params.category,
      severity: params.severity,
      description: params.description,
      shift_id: params.shift_id ?? null,
      photo_media_object_id: mediaId ?? null,
    })

    const r = await this.commit("POST", `/vehicles/${vehicleId}/issues`, body, "Vehicle issue report")
    const done = VehicleIssueResultSchema.safeParse(r.done)
    return this.toResult(done.success ? done.data.issue_id : "", r)
  }

  /** Issues already raised against a vehicle (newest first). Read-only; never queued. */
  async listForVehicle(vehicleId: string): Promise<VehicleIssueSummary[]> {
    const raw = await this.api.request<unknown>(`/vehicles/${vehicleId}/issues`, { method: "GET" })
    const page = VehicleIssuePageSchema.safeParse(raw)
    const rows = page.success ? page.data.data : Array.isArray(raw) ? raw : []
    const out: VehicleIssueSummary[] = []
    for (const row of rows) {
      const parsed = VehicleIssueSummarySchema.safeParse(row)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }
}
