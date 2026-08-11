// packages/mobile/src/core/driver/shifts.ts
//
// Shift journeys (1.1 clock-in, 1.4 clock-out, active-shift lookup). Clock-in requires a start
// odometer photo (B1); clock-out requires an end odometer photo. Both go offline-first: evidence is
// uploaded, then the business POST is committed or parked in the outbox. HOS rest-block / odometer -
// decreased / consent violations surface as domain `ApiError`s (C3.3, C4.2, C5.5).

import { z } from "zod"
import { ClockInSchema, ClockOutSchema, type ClockInInput, type ClockOutInput } from "@fleet/shared/mobile"
import { DriverService, type DriverServiceDeps } from "./base"
import { EvidencePhoto, NetworkOfflineError, type SubmitResult } from "./types"

export const ActiveShiftSchema = z.object({
  shift_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  trailer_id: z.string().uuid().nullable().optional(),
  clock_in_at: z.string().datetime(),
})
export type ActiveShift = z.infer<typeof ActiveShiftSchema>

export interface ClockInParams {
  assignment_id: string
  start_odometer_km: number
  start_fuel_gauge: ClockInInput["start_fuel_gauge"]
  consent_version: string
  phone_gps_fallback_enabled?: boolean
}

export interface ClockOutParams {
  shift_id: string
  end_odometer_km: number
  end_fuel_gauge: ClockOutInput["end_fuel_gauge"]
  debrief_notes?: string
}

/**
 * One row of the driver's own shift history (B.7). Mirrors the columns the gateway exposes on
 * `GET /shifts/me`; when that driver-scoped route is not deployed yet we read the locked
 * `GET /shifts/verification-inbox` page (`app.v_shift_verification_inbox`), which carries the same
 * columns for the caller's own shifts.
 */
export const ShiftSummarySchema = z.object({
  shift_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  clock_in_at: z.string().nullable().optional(),
  clock_out_at: z.string().nullable().optional(),
  duration_seconds: z.number().int().nullable().optional(),
  distance_km: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  state: z.string().nullable().optional(),
  verification_status: z.string().nullable().optional(),
})
export type ShiftSummary = z.infer<typeof ShiftSummarySchema>

/** Cursor page envelope shared by every list endpoint (D7). */
const ShiftPageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

export interface ShiftHistoryPage {
  items: ShiftSummary[]
  nextCursor: string | null
}

export class ShiftsService extends DriverService {
  constructor(deps: DriverServiceDeps) {
    super(deps)
  }

  async getActive(): Promise<ActiveShift | null> {
    const res = await this.api.request<unknown>("/shifts/me/active", { method: "GET" })
    if (res == null) return null
    return ActiveShiftSchema.parse(res)
  }

  /**
   * Driver's own shift history (B.7), cursor-paginated. Tries the driver-scoped `GET /shifts/me`
   * first and falls back to the locked `GET /shifts/verification-inbox` (server-side scoped to the
   * caller for a DRIVER principal) so the screen renders against today's gateway. Rows that fail
   * validation are skipped rather than failing the whole page.
   */
  async listHistory(cursor?: string): Promise<ShiftHistoryPage> {
    const qs = new URLSearchParams()
    if (cursor) qs.set("cursor", cursor)
    const suffix = qs.toString() ? `?${qs.toString()}` : ""
    let raw: unknown
    try {
      raw = await this.api.request<unknown>(`/shifts/me${suffix}`, { method: "GET" })
    } catch {
      raw = await this.api.request<unknown>(`/shifts/verification-inbox${suffix}`, { method: "GET" })
    }
    return parseShiftPage(raw)
  }

  async clockIn(params: ClockInParams, photo: EvidencePhoto): Promise<SubmitResult> {
    const mediaId = await this.media.upload(photo, {
      owner_kind: "WORK_LOG",
      retention_class: "WORK_PLAN",
      content_type: "image/jpeg",
      width_px: photo.width,
      height_px: photo.height,
      client_captured_at: photo.createdAt,
    })
    const body = ClockInSchema.parse({
      assignment_id: params.assignment_id,
      start_odometer_km: params.start_odometer_km,
      start_fuel_gauge: params.start_fuel_gauge,
      start_media_object_id: mediaId,
      consent_version: params.consent_version,
      phone_gps_fallback_enabled: params.phone_gps_fallback_enabled ?? false,
    })
    const r = await this.commit("POST", "/shifts/clock-in", body, "Clock-in")
    return this.toResult((r.done as { shift_id: string } | undefined)?.shift_id ?? "", r)
  }

  async clockOut(params: ClockOutParams, photo: EvidencePhoto): Promise<SubmitResult> {
    const mediaId = await this.media.upload(photo, {
      owner_kind: "WORK_LOG",
      retention_class: "WORK_PLAN",
      content_type: "image/jpeg",
      width_px: photo.width,
      height_px: photo.height,
      client_captured_at: photo.createdAt,
    })
    const body = ClockOutSchema.parse({
      shift_id: params.shift_id,
      end_odometer_km: params.end_odometer_km,
      end_fuel_gauge: params.end_fuel_gauge,
      end_media_object_id: mediaId,
      debrief_notes: params.debrief_notes,
    })
    const r = await this.commit("POST", "/shifts/clock-out", body, "Clock-out")
    return this.toResult((r.done as { shift_id: string } | undefined)?.shift_id ?? "", r)
  }
}

/** Tolerant page parser: accepts the cursor envelope or a bare array, skipping unusable rows. */
function parseShiftPage(raw: unknown): ShiftHistoryPage {
  const page = ShiftPageSchema.safeParse(raw)
  const rows = page.success ? page.data.data : Array.isArray(raw) ? raw : []
  const items: ShiftSummary[] = []
  for (const row of rows) {
    const parsed = ShiftSummarySchema.safeParse(row)
    if (parsed.success) items.push(parsed.data)
  }
  return { items, nextCursor: page.success ? page.data.next_cursor : null }
}

export { NetworkOfflineError }
