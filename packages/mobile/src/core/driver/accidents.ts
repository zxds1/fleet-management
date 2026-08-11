// packages/mobile/src/core/driver/accidents.ts
//
// Accident journey (3.1 + B17). Two surfaces:
//   • `mayday` — critical safety escape hatch: fire GPS + reason, bypass ALL evidence (B17). Idempotent.
//   • `report` — full report; scene photos attach afterward via `attachMedia` (one mandatory FRONT
//     photo per 3.1). Offline-first: evidence uploads then the business POST is committed or queued.

import { z } from "zod"
import {
  MaydaySchema,
  AccidentCreateSchema,
  AccidentMediaSchema,
  type MaydayInput,
  type AccidentCreateInput,
  type AccidentMediaInput,
} from "@fleet/shared/mobile"
import { DriverService, type DriverServiceDeps } from "./base"
import { EvidencePhoto, type SubmitResult } from "./types"

export interface MaydayParams {
  shift_id?: string | null
  vehicle_id?: string | null
  position: MaydayInput["position"]
  mayday_reason: string
}

export interface AccidentReportParams {
  shift_id?: string | null
  vehicle_id?: string | null
  trailer_id?: string | null
  occurred_at?: string | null
  position?: AccidentCreateInput["position"]
  driver_statement?: string
  witness_name?: string
  witness_phone?: string
  third_party_plate?: string
}

export const MaydayResultSchema = z.object({
  accident_id: z.string().uuid(),
  escalated_at: z.string().datetime(),
})
export type MaydayResult = z.infer<typeof MaydayResultSchema>

/** One row of the driver's own accident reports (B.14) from `GET /accidents/me`. */
export const AccidentSummarySchema = z
  .object({
    accident_id: z.string().uuid(),
    reference: z.string().nullable().optional(),
    occurred_at: z.string().nullable().optional(),
    location_label: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    mayday: z.boolean().nullable().optional(),
    escalation_tier: z.number().int().nullable().optional(),
    tier: z.number().int().nullable().optional(),
  })
  .transform((r) => ({
    accident_id: r.accident_id,
    reference: r.reference ?? null,
    occurred_at: r.occurred_at ?? undefined,
    location_label: r.location_label ?? null,
    severity: r.severity ?? null,
    status: r.status ?? "REPORTED",
    mayday: r.mayday ?? false,
    escalation_tier: r.escalation_tier ?? r.tier ?? null,
  }))
export type AccidentSummary = z.infer<typeof AccidentSummarySchema>

/** Media reference on the detail view; `slot` mirrors `AccidentMediaSchema` (shared contract). */
export const AccidentMediaRefSchema = z
  .object({
    media_id: z.string().optional(),
    media_object_id: z.string().optional(),
    slot: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    pending: z.boolean().nullable().optional(),
  })
  .transform((r) => ({
    media_id: r.media_id ?? r.media_object_id ?? "",
    kind: r.kind ?? "PHOTO",
    pending: r.pending ?? false,
  }))
export type AccidentMediaRef = z.infer<typeof AccidentMediaRefSchema>

/** `GET /accidents/{id}` read model for the driver detail screen (B.15). */
export const AccidentDetailSchema = z.object({
  accident_id: z.string().uuid(),
  reference: z.string().nullable().optional(),
  occurred_at: z.string().nullable().optional(),
  reported_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  mayday: z.boolean().nullable().optional(),
  description: z.string().nullable().optional(),
  driver_statement: z.string().nullable().optional(),
  location_label: z.string().nullable().optional(),
  vehicle_label: z.string().nullable().optional(),
  escalation_tier: z.number().int().nullable().optional(),
  acknowledged_by: z.string().nullable().optional(),
  seconds_to_escalation: z.number().nullable().optional(),
  chain_valid: z.boolean().nullable().optional(),
  media: z.array(AccidentMediaRefSchema).nullable().optional(),
  can_acknowledge: z.boolean().nullable().optional(),
})
export type AccidentDetail = z.infer<typeof AccidentDetailSchema>

const AccidentPageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

export class AccidentsService extends DriverService {
  constructor(deps: DriverServiceDeps) {
    super(deps)
  }

  /** The driver's own reports with status / MAYDAY / escalation tier (B.14). */
  async listMine(): Promise<AccidentSummary[]> {
    const raw = await this.api.request<unknown>("/accidents/me", { method: "GET" })
    const page = AccidentPageSchema.safeParse(raw)
    const rows = page.success ? page.data.data : Array.isArray(raw) ? raw : []
    const out: AccidentSummary[] = []
    for (const row of rows) {
      const parsed = AccidentSummarySchema.safeParse(row)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }

  /** Read-only accident detail incl. media gallery + escalation state (B.15). */
  async getOne(accidentId: string): Promise<AccidentDetail> {
    const raw = await this.api.request<unknown>(`/accidents/${accidentId}`, { method: "GET" })
    return AccidentDetailSchema.parse(raw)
  }

  /** Acknowledge an escalation as the on-call/responsible driver (B.15). Idempotent (C5.1). */
  async acknowledge(accidentId: string): Promise<SubmitResult> {
    const r = await this.commit("POST", `/accidents/${accidentId}/acknowledge`, {}, "Accident acknowledge")
    return this.toResult(accidentId, r)
  }

  async mayday(params: MaydayParams): Promise<SubmitResult> {
    const body = MaydaySchema.parse({
      shift_id: params.shift_id ?? null,
      vehicle_id: params.vehicle_id ?? null,
      position: params.position,
      mayday_reason: params.mayday_reason,
    })
    const r = await this.commit("POST", "/accidents/mayday", body, "Mayday")
    return this.toResult((r.done as MaydayResult | undefined)?.accident_id ?? "", r)
  }

  async report(params: AccidentReportParams): Promise<SubmitResult> {
    const body = AccidentCreateSchema.parse({
      shift_id: params.shift_id ?? null,
      vehicle_id: params.vehicle_id,
      trailer_id: params.trailer_id,
      occurred_at: params.occurred_at,
      position: params.position,
      driver_statement: params.driver_statement,
      witness_name: params.witness_name,
      witness_phone: params.witness_phone,
      third_party_plate: params.third_party_plate,
    })
    const r = await this.commit("POST", "/accidents", body, "Accident report")
    return this.toResult((r.done as { accident_id: string } | undefined)?.accident_id ?? "", r)
  }

  async attachMedia(accidentId: string, slot: AccidentMediaInput["slot"], photo: EvidencePhoto): Promise<SubmitResult> {
    const mediaId = await this.media.upload(photo, {
      owner_kind: "ACCIDENT_REPORT",
      retention_class: "ACCIDENT",
      content_type: "image/jpeg",
      width_px: photo.width,
      height_px: photo.height,
      client_captured_at: photo.createdAt,
    })
    const body = AccidentMediaSchema.parse({ slot, media_object_id: mediaId })
    const r = await this.commit("POST", `/accidents/${accidentId}/media`, body, "Accident photo")
    return this.toResult(accidentId, r)
  }
}

export { z }
