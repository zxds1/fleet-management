// packages/mobile/src/core/driver/feed.ts
//
// Driver inboxes: notifications (socket `notifications`), open anomalies (REST `/anomalies`), and the
// driver's own vehicle live state (socket `driver:vehicle`, with a REST snapshot fallback from
// `/dashboard/vehicle-states`). Pure over injected `ApiClient` + `SocketClient`; emits change events
// so the React layer can re-render on pushes (D-3, 07). No secrets logged (C5.3).

import { z } from "zod"
import { ApiClient } from "../apiClient"
import { SocketClient } from "../socket"
import { RealtimeChannels, type RealtimeChannel } from "@fleet/shared/mobile"

export type AnomalyDomain = "FUEL" | "HOS" | "ACCIDENT" | "MAINTENANCE" | "SECURITY"

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.string().default("GENERIC"),
  title: z.string(),
  body: z.string().default(""),
  created_at: z.string().datetime(),
  read: z.boolean().default(false),
})
export type Notification = z.infer<typeof NotificationSchema>

export const AnomalySchema = z.object({
  id: z.string().uuid(),
  domain: z.enum(["FUEL", "HOS", "ACCIDENT", "MAINTENANCE", "SECURITY"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  title: z.string(),
  body: z.string().default(""),
  created_at: z.string().datetime(),
  evidence_url: z.string().url().optional(),
})
export type Anomaly = z.infer<typeof AnomalySchema>

/** PG numerics arrive as strings over REST and as raw view columns over the socket; accept both
 * (and null, which a vehicle with no GPS fix legitimately has) so a row is never silently dropped. */
const NumericLike = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })

export const VehicleStateSchema = z.object({
  vehicle_id: z.string().uuid(),
  display_state: z.enum(["QUARANTINED", "OFFLINE", "HOS_ALERT", "SPEEDING", "MOVING", "IDLING", "PARKED"]),
  latitude: NumericLike,
  longitude: NumericLike,
  driver_name: z.string().nullable().optional(),
  next_eligible_clock_in_at: z.string().datetime().nullable().optional(),
  // Telemetry (all optional — older gateways/payloads still parse). The gateway pushes the raw
  // `app.v_vehicle_display_state` row, which names the plate `license_plate`.
  plate: z.string().nullable().optional(),
  license_plate: z.string().nullable().optional(),
  fuel_level_pct: NumericLike,
  def_level_pct: NumericLike,
  odometer_km: NumericLike,
  engine_hours: NumericLike,
  battery_volts: NumericLike,
  estimated_range_km: NumericLike,
  trailer: z
    .object({
      code: z.string().nullable().optional(),
      load_kg: NumericLike,
      temp_c: NumericLike,
    })
    .nullable()
    .optional(),
  upcoming_service: z
    .array(z.object({ label: z.string(), due_in_km: NumericLike }))
    .nullable()
    .optional(),
})
export type VehicleState = z.infer<typeof VehicleStateSchema>

const AnomalyPageSchema = z.object({
  data: z.array(AnomalySchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

/**
 * Expiring document row for the driver Documents screen (B.19). Binds to the locked
 * `GET /documents/expiring?within_days=…`, which the gateway scopes to the caller's own assets.
 */
export const DocSummarySchema = z
  .object({
    document_id: z.string().optional(),
    document_type: z.string().nullable().optional(),
    subject_id: z.string().nullable().optional(),
    subject_name: z.string().nullable().optional(),
    expires_on: z.string().nullable().optional(),
    days_remaining: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  })
  .transform((r) => ({
    document_id: r.document_id ?? r.subject_id ?? "",
    document_type: r.document_type ?? null,
    subject_name: r.subject_name ?? null,
    subject_ref: r.subject_id ?? null,
    expires_on: r.expires_on ?? null,
    days_remaining: r.days_remaining ?? null,
  }))
export type DocSummary = z.infer<typeof DocSummarySchema>

const DocPageSchema = z.object({
  data: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
})

export type FeedListener = () => void

export class FeedService {
  notifications: Notification[] = []
  anomalies: Anomaly[] = []
  vehicle: VehicleState | null = null
  /** Latest expiring-documents snapshot (B.19). */
  documents: DocSummary[] = []
  connected = false

  private listeners = new Set<FeedListener>()
  private unsubs: Array<() => void> = []

  constructor(private readonly api: ApiClient, private readonly socket: SocketClient) {}

  /** Subscribe to the driver realtime channels. Call once after the socket connects. */
  bindSocket(): void {
    this.connected = this.socket.status === "connected"
    this.unsubs.push(
      this.socket.onStatusChange((status) => {
        this.connected = status === "connected"
        this.emit()
      }),
    )
    this.unsubs.push(
      this.socket.on(RealtimeChannels.notifications as RealtimeChannel, (payload) => {
        // The gateway emits an array (snapshot + live fan-out, 07 §3/§5); accept a bare row and
        // the { userId, notification } envelope too.
        const raw = (payload as { notification?: unknown })?.notification ?? payload
        const rows = Array.isArray(raw) ? raw : [raw]
        let changed = false
        for (const row of rows) {
          const parsed = NotificationSchema.safeParse(row)
          if (!parsed.success) continue
          this.notifications = [parsed.data, ...this.notifications.filter((n) => n.id !== parsed.data.id)]
          changed = true
        }
        if (changed) this.emit()
      }),
    )
    this.unsubs.push(
      this.socket.on(RealtimeChannels.driverVehicle as RealtimeChannel, (payload) => {
        const parsed = VehicleStateSchema.safeParse(payload)
        if (parsed.success) {
          const data = { ...parsed.data, plate: parsed.data.plate ?? parsed.data.license_plate ?? null }
          this.vehicle = data
          this.emit()
        }
      }),
    )
    this.unsubs.push(
      this.socket.on(RealtimeChannels.driverAccident as RealtimeChannel, () => this.emit()),
    )
    this.unsubs.push(
      this.socket.on(RealtimeChannels.driverShift as RealtimeChannel, () => this.emit()),
    )
  }

  /** REST snapshot of the open-anomaly feed (cursor-paginated). */
  async loadAnomalies(domains?: AnomalyDomain[]): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const qs = new URLSearchParams()
    if (domains?.length) qs.set("domains", domains.join(","))
    const path = `/anomalies${qs.toString() ? `?${qs.toString()}` : ""}`
    const page = await this.api.request<unknown>(path, { method: "GET" })
    const parsed = AnomalyPageSchema.safeParse(page)
    if (parsed.success) {
      // Replace (inbox shows the latest open set); a real pager would append on "load more".
      this.anomalies = parsed.data.data
      this.emit()
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor }
    }
    return { hasMore: false, nextCursor: null }
  }

  /** REST snapshot fallback for the driver's own vehicle (admin map endpoint, filtered client-side). */
  async loadVehicleState(vehicleId: string | undefined): Promise<void> {
    if (!vehicleId) return
    const page = await this.api.request<{ vehicles: unknown[] }>("/dashboard/vehicle-states", { method: "GET" })
    const match = page?.vehicles?.find((v) => (v as { vehicle_id?: string })?.vehicle_id === vehicleId)
    const parsed = match ? VehicleStateSchema.safeParse(match) : null
    if (parsed?.success) {
      this.vehicle = { ...parsed.data, plate: parsed.data.plate ?? parsed.data.license_plate ?? null }
      this.emit()
    }
  }

  /** Expiring documents for the driver's own assets (B.19), locked `GET /documents/expiring`. */
  async listDocuments(withinDays = 30): Promise<DocSummary[]> {
    const raw = await this.api.request<unknown>(`/documents/expiring?within_days=${withinDays}`, { method: "GET" })
    const page = DocPageSchema.safeParse(raw)
    const rows = page.success ? page.data.data : Array.isArray(raw) ? raw : []
    const out: DocSummary[] = []
    for (const row of rows) {
      const parsed = DocSummarySchema.safeParse(row)
      if (parsed.success && parsed.data.document_id) out.push(parsed.data)
    }
    this.documents = out
    this.emit()
    return out
  }

  markRead(id: string): void {
    this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
    this.emit()
  }

  markAllRead(): void {
    this.notifications = this.notifications.map((n) => ({ ...n, read: true }))
    this.emit()
  }

  get unreadCount(): number {
    return this.notifications.filter((n) => !n.read).length
  }

  /** Register a change listener (used by the React layer to re-render on pushes). */
  onChange(cb: FeedListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  dispose(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.listeners.clear()
  }

  private emit(): void {
    for (const l of [...this.listeners]) l()
  }
}
