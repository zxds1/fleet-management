// packages/mobile/src/core/analytics.ts
//
// Hierarchical analytics slice (company → invited admin/manager → vehicle | driver). Pure over the
// injected `ApiClient` so it is unit-testable in node without Metro/native, mirroring the other
// admin services in `core/admin.ts`.
//
// Binds to the analytics contract:
//   GET /analytics/company      — company-wide KPIs + the invited-admin (manager) roster
//   GET /analytics/manager/{id} — one manager's scoped KPIs + their vehicles/drivers
//   GET /analytics/vehicle/{id} — one vehicle
//   GET /analytics/driver/{id}  — one driver
//   GET /analytics/me           — the calling principal's own analytics (driver self-view)
//
// EVERY field is optional. The backend is being built in parallel and keeps names aligned to the
// mobile schema "where possible", so parsing is deliberately tolerant: a renamed or absent field
// degrades that one cell to "—" instead of voiding the whole screen. Numerics are accepted as
// strings too because PG numerics arrive as text over REST.

import { z } from "zod"
import { ApiClient } from "./apiClient"

/** PG numerics arrive as strings over REST; nulls are legitimate "no data yet". */
const Num = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  })

const Str = z.union([z.string(), z.null()]).optional()

/**
 * The KPI block every level of the hierarchy carries. The company/manager levels report the roll-up
 * (`vehicles`/`drivers` counts); leaf levels typically omit those two.
 */
export const AnalyticsKpisSchema = z
  .object({
    vehicles: Num,
    drivers: Num,
    distanceKm: Num,
    fuelCost: Num,
    anomalies: Num,
    utilisationPct: Num,
    shifts: Num,
  })
  .partial()
  .passthrough()
export type AnalyticsKpis = z.infer<typeof AnalyticsKpisSchema>

/** One invited admin (fleet manager) on `GET /analytics/company`. */
export const ManagerSummarySchema = z
  .object({
    user_id: Str,
    full_name: Str,
    email: Str,
    assignedVehicleIds: z.array(z.string()).nullish(),
    assignedDriverIds: z.array(z.string()).nullish(),
    kpis: AnalyticsKpisSchema.nullish(),
  })
  .passthrough()
export type ManagerSummary = z.infer<typeof ManagerSummarySchema>

/** One vehicle row under a manager (or the payload of `GET /analytics/vehicle/{id}`). */
export const VehicleAnalyticsSchema = z
  .object({
    vehicle_id: Str,
    plate: Str,
    distanceKm: Num,
    fuelCost: Num,
    utilisationPct: Num,
    anomalies: Num,
    kpis: AnalyticsKpisSchema.nullish(),
  })
  .passthrough()
export type VehicleAnalytics = z.infer<typeof VehicleAnalyticsSchema>

/** One driver row under a manager (or the payload of `GET /analytics/driver/{id}` / `/me`). */
export const DriverAnalyticsSchema = z
  .object({
    driver_id: Str,
    name: Str,
    distanceKm: Num,
    shifts: Num,
    anomalies: Num,
    fuelCost: Num,
    utilisationPct: Num,
    kpis: AnalyticsKpisSchema.nullish(),
  })
  .passthrough()
export type DriverAnalytics = z.infer<typeof DriverAnalyticsSchema>

/** `GET /analytics/company`. Top-level KPIs are accepted both nested under `kpis` and inline. */
export const CompanyAnalyticsSchema = z
  .object({
    company_id: Str,
    companyName: Str,
    kpis: AnalyticsKpisSchema.nullish(),
    vehicles: Num,
    drivers: Num,
    distanceKm: Num,
    fuelCost: Num,
    anomalies: Num,
    utilisationPct: Num,
    managers: z.array(ManagerSummarySchema).nullish(),
  })
  .passthrough()
export type CompanyAnalytics = z.infer<typeof CompanyAnalyticsSchema>

/** `GET /analytics/manager/{id}` — the manager's scoped roll-up plus their two rosters. */
export const ManagerAnalyticsSchema = z
  .object({
    user_id: Str,
    full_name: Str,
    email: Str,
    kpis: AnalyticsKpisSchema.nullish(),
    vehicles: z.array(VehicleAnalyticsSchema).nullish(),
    drivers: z.array(DriverAnalyticsSchema).nullish(),
  })
  .passthrough()
export type ManagerAnalytics = z.infer<typeof ManagerAnalyticsSchema>

/** Utilisation series for the simple bar visual (replaces the mocked heatmap). Optional. */
export const AnalyticsSeriesPointSchema = z.object({ label: Str, value: Num }).passthrough()
export type AnalyticsSeriesPoint = z.infer<typeof AnalyticsSeriesPointSchema>

/**
 * Normalises "KPIs may be nested under `kpis` or inlined on the root" into one flat block, so the
 * screen reads a single shape regardless of which the backend settles on.
 *
 * The input is intentionally loose: `ManagerAnalytics` reuses the names `vehicles`/`drivers` for its
 * *rosters* (arrays), while the KPI block uses them for *counts* (numbers). An inline value is
 * therefore only adopted when it is actually numeric, and an array falls back to its length — so a
 * manager payload that omits `kpis.vehicles` still shows the right count.
 */
export function flattenKpis(source: Record<string, unknown> | null | undefined): AnalyticsKpis {
  const root = (source ?? {}) as Record<string, unknown>
  const nested = (root.kpis ?? {}) as Record<string, unknown>

  /** A count may arrive as a number, a numeric string, or (inline) as the roster array itself. */
  const count = (key: string): number | null => {
    const fromNested = numeric(nested[key])
    if (fromNested !== null) return fromNested
    const inline = root[key]
    if (Array.isArray(inline)) return inline.length
    return numeric(inline)
  }
  const metric = (key: string): number | null => numeric(nested[key]) ?? numeric(root[key])

  return {
    vehicles: count("vehicles"),
    drivers: count("drivers"),
    distanceKm: metric("distanceKm"),
    fuelCost: metric("fuelCost"),
    anomalies: metric("anomalies"),
    utilisationPct: metric("utilisationPct"),
    shifts: metric("shifts"),
  }
}

/** Coerces an unknown JSON value to a finite number, or null when it is not one. */
function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export type AnalyticsListener = () => void

/** Which level of the hierarchy a screen is showing. */
export type AnalyticsView = "company" | "manager" | "vehicle" | "driver"

/** The analytics scope a signed-in user is entitled to. */
export type ViewerRole = "admin" | "manager" | "driver"

/**
 * Resolves the viewer's analytics scope from the principal's roles. ADMIN wins over FLEET_MANAGER
 * (an admin who also holds a manager role still sees the company view); anything else — including a
 * principal with no recognised role — is treated as a driver, i.e. the most restrictive scope.
 *
 * This is UI gating only: the server independently scopes every `/analytics/*` response, so a
 * mis-resolved role can never leak another user's numbers.
 */
export function resolveViewerRole(roles: readonly string[] | undefined): ViewerRole {
  const set = new Set((roles ?? []).map((r) => r.toUpperCase()))
  if (set.has("ADMIN") || set.has("SUPER_ADMIN") || set.has("OWNER")) return "admin"
  if (set.has("FLEET_MANAGER") || set.has("MANAGER")) return "manager"
  return "driver"
}

/**
 * Hierarchical analytics reader. Every method issues one GET and validates the response; a payload
 * the schema cannot parse resolves to `null` (rather than throwing) so a partially-implemented
 * backend surfaces an empty state instead of an error screen. Transport failures still throw so the
 * screen can render `ErrorState` with a retry.
 */
export class AnalyticsService {
  company: CompanyAnalytics | null = null
  manager: ManagerAnalytics | null = null
  vehicle: VehicleAnalytics | null = null
  driver: DriverAnalytics | null = null

  private listeners = new Set<AnalyticsListener>()

  constructor(private readonly api: ApiClient) {}

  /** Company-wide roll-up + the invited-admin roster (ADMIN scope). */
  async getCompany(): Promise<CompanyAnalytics | null> {
    const res = await this.api.request<unknown>("/analytics/company", { method: "GET" })
    const parsed = CompanyAnalyticsSchema.safeParse(res)
    this.company = parsed.success ? parsed.data : null
    this.emit()
    return this.company
  }

  /** One invited admin's scoped analytics (their vehicles + drivers). */
  async getManager(userId: string): Promise<ManagerAnalytics | null> {
    const res = await this.api.request<unknown>(`/analytics/manager/${encodeURIComponent(userId)}`, {
      method: "GET",
    })
    const parsed = ManagerAnalyticsSchema.safeParse(res)
    this.manager = parsed.success ? parsed.data : null
    this.emit()
    return this.manager
  }

  /** Per-vehicle leaf. The API returns an envelope `{from, to, vehicle, kpis}`; unwrap `vehicle`. */
  async getVehicle(vehicleId: string): Promise<VehicleAnalytics | null> {
    const res = await this.api.request<unknown>(`/analytics/vehicle/${encodeURIComponent(vehicleId)}`, {
      method: "GET",
    })
    const envelope = (res as { vehicle?: unknown })?.vehicle ?? res
    const parsed = VehicleAnalyticsSchema.safeParse(envelope)
    this.vehicle = parsed.success ? parsed.data : null
    this.emit()
    return this.vehicle
  }

  /** Per-driver leaf (admin/manager view of someone else). Unwrap the `driver` envelope key. */
  async getDriver(driverId: string): Promise<DriverAnalytics | null> {
    const res = await this.api.request<unknown>(`/analytics/driver/${encodeURIComponent(driverId)}`, {
      method: "GET",
    })
    const envelope = (res as { driver?: unknown })?.driver ?? res
    const parsed = DriverAnalyticsSchema.safeParse(envelope)
    this.driver = parsed.success ? parsed.data : null
    this.emit()
    return this.driver
  }

  /**
   * The calling principal's own analytics. This is the ONLY analytics call a DRIVER makes — the
   * server scopes it to the bearer token, so a driver can never read another person's numbers.
   * Unwrap the `driver` envelope key (a non-driver gets the company view instead).
   */
  async getMine(): Promise<DriverAnalytics | null> {
    const res = await this.api.request<unknown>("/analytics/me", { method: "GET" })
    const inner = res as { driver?: unknown }
    const envelope = inner?.driver ?? res
    const parsed = DriverAnalyticsSchema.safeParse(envelope)
    this.driver = parsed.success ? parsed.data : null
    this.emit()
    return this.driver
  }

  onChange(cb: AnalyticsListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  dispose(): void {
    this.listeners.clear()
  }

  private emit(): void {
    for (const l of [...this.listeners]) l()
  }
}
