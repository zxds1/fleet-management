// packages/mobile/src/core/admin.ts
//
// Admin (operations console) core services. Pure over injected `ApiClient` + `SocketClient` so the
// slice is unit-testable in node without Metro/native. Each service binds to the frozen
// `api/openapi.yaml` endpoints (and the shared `RealtimeChannels`) and never redefines server shapes
// — response *view* DTOs are declared locally only because the openapi exposes them as opaque
// `CursorPage` payloads. Socket handlers convert gateway payloads into typed local state.
//
// No secrets are logged (C5.3). The previously-pending device/session revoke + driver roster endpoints
// are now part of the locked contract (api/openapi.yaml): `GET /drivers`, `POST /devices/{deviceId}/revoke`,
// `POST /sessions/revoke`. `SecurityService` binds to them directly.

import { z } from "zod";
import { ApiClient } from "./apiClient";
import { SocketClient } from "./socket";
import {
  RealtimeChannels,
  type RealtimeChannel,
  HardwarePairSchema,
  HardwarePairResultSchema,
  HardwareTrackerStatusSchema,
  FuelPendingRowSchema,
  FuelPendingResponseSchema,
  VerifyPurchaseSchema,
  type HardwarePairInput,
  type HardwarePairResult,
  type HardwareTrackerStatus,
  type FuelPendingRow,
} from "@fleet/shared/mobile";

// Re-exported so admin screens have a single import surface for these contracts.
export type { HardwarePairInput, HardwarePairResult, HardwareTrackerStatus, FuelPendingRow };
export { FuelPendingRowSchema, VerifyPurchaseSchema };
import { AnomalySchema, type Anomaly } from "./driver/feed";
import { AnalyticsService } from "./analytics";

// Hierarchical analytics (company → invited admin → vehicle/driver) lives in `./analytics.ts`; it is
// re-exported here so admin screens keep a single import surface.
export {
  AnalyticsService,
  AnalyticsKpisSchema,
  ManagerSummarySchema,
  VehicleAnalyticsSchema,
  DriverAnalyticsSchema,
  CompanyAnalyticsSchema,
  ManagerAnalyticsSchema,
  flattenKpis,
  resolveViewerRole,
} from "./analytics";
export type {
  AnalyticsKpis,
  ManagerSummary,
  VehicleAnalytics,
  DriverAnalytics,
  CompanyAnalytics,
  ManagerAnalytics,
  AnalyticsView,
  ViewerRole,
} from "./analytics";

export type DisplayState =
  | "QUARANTINED"
  | "OFFLINE"
  | "HOS_ALERT"
  | "SPEEDING"
  | "MOVING"
  | "IDLING"
  | "PARKED";

/** PG numerics arrive as strings over REST and the map view returns null for a vehicle with no GPS
 * fix; accept both so a single un-fixed vehicle never drops the whole snapshot. */
const NumericLike = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

export const VehicleStateSchema = z.object({
  vehicle_id: z.string().uuid(),
  display_state: z.enum(["QUARANTINED", "OFFLINE", "HOS_ALERT", "SPEEDING", "MOVING", "IDLING", "PARKED"]),
  latitude: NumericLike,
  longitude: NumericLike,
  driver_name: z.string().nullable().optional(),
  next_eligible_clock_in_at: z.string().datetime().nullable().optional(),
});
export type VehicleState = z.infer<typeof VehicleStateSchema>;

export const VehicleStatesResponseSchema = z.object({
  vehicles: z.array(VehicleStateSchema),
});

export const AccidentEventSchema = z.object({
  accident_id: z.string().uuid(),
  occurred_at: z.string().datetime().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  tier: z.number().int().min(1).max(4).optional(),
  acknowledged: z.boolean().optional(),
  acknowledged_by: z.string().nullable().optional(),
});
export type AccidentEvent = z.infer<typeof AccidentEventSchema>;

/**
 * `GET /accidents/{id}` detail view. Extends the list row with the fields the console detail screen
 * needs. `media.slot` mirrors `AccidentMediaSchema` in `@fleet/shared` (packages/shared/src/schemas/
 * accidents.ts) so the gallery slots stay in lockstep with the upload contract.
 */
export const AccidentMediaRefSchema = z.object({
  slot: z.string(),
  url: z.string(),
});
export type AccidentMediaRef = z.infer<typeof AccidentMediaRefSchema>;

export const AccidentDetailSchema = AccidentEventSchema.extend({
  description: z.string().nullable().optional(),
  mayday: z.boolean().nullable().optional(),
  media: z.array(AccidentMediaRefSchema).nullable().optional(),
  escalationTier: z.number().int().nullable().optional(),
});
export type AccidentDetail = z.infer<typeof AccidentDetailSchema>;

export const FuelReconcileRowSchema = z.object({
  fuel_purchase_id: z.string().uuid().nullable(),
  purchased_at: z.string().datetime().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  litres: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  total_cost: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  currency: z.string().default("KES"),
  odometer_km: z.number().int().nullable().optional(),
  fuel_card_last_four: z.string().nullable().optional(),
  receipt_media_object_id: z.string().uuid().nullable().optional(),
  gauge_before_percent: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  gauge_after_percent: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  admin_verified: z.boolean().nullable().optional(),
  rejected_at: z.string().datetime().nullable().optional(),
  worst_open_severity: z.string().nullable().optional(),
  open_anomalies: z.string().nullable().optional(),
});
export type FuelReconcileRow = z.infer<typeof FuelReconcileRowSchema>;


/** Admin corrections applied at verify time (`PUT /admin/fuel/verify/{id}`). */
export interface FuelAdminOverrides {
  adjusted_amount?: number;
  adjusted_litres?: number;
  adjusted_odometer?: number;
  admin_notes?: string;
}

/**
 * `GET /vehicles` / `GET /vehicles/{id}` row (`app.vehicles`, Pillar 4). Only the columns the
 * console actually renders are declared; everything else is passed through untouched by the API.
 */
export const VehicleRecordSchema = z.object({
  id: z.string().uuid(),
  license_plate: z.string(),
  vehicle_class: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  is_operational: z.boolean().nullable().optional(),
  non_operational_reason: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  ownership_type: z.string().nullable().optional(),
  current_odometer_km: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  current_odometer_at: z.string().nullable().optional(),
  engine_hours: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  fuel_tank_capacity_litres: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  notes: z.string().nullable().optional(),
})
export type VehicleRecord = z.infer<typeof VehicleRecordSchema>

/**
 * `POST /vehicles` body — admin creates a vehicle (a "car") so there is something to assign to
 * onboarded drivers / managers. Only the fields the console actually collects are declared; the
 * server fills the rest (status defaults to AVAILABLE, tenant is bound to the caller).
 */
export const VehicleCreateSchema = z.object({
  license_plate: z.string().min(1).max(20),
  vehicle_class: z.string().max(40).optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  ownership_type: z.string().max(40).optional(),
  fuel_tank_capacity_litres: z.union([z.string(), z.number()]).transform((v) => (v === "" || v == null ? undefined : Number(v))).optional(),
  notes: z.string().max(2000).optional(),
})
export type VehicleCreateInput = z.infer<typeof VehicleCreateSchema>

/**
 * Admin/manager (fleet-manager) roster. Powers the admin-management screen: lists every admin in the
 * company plus, for each, the vehicles/drivers currently assigned to them. Binds to
 * `GET /admin/managers` (defined contract — see packages/mobile/BACKEND_TODO.md). All fields optional
 * so a partially-implemented backend still renders.
 */
export const AdminSummarySchema = z.object({
  user_id: z.string().uuid().optional(),
  email: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  roles: z.array(z.string()).nullish(),
  status: z.string().nullable().optional(),
  assigned_vehicle_ids: z.array(z.string()).nullish(),
  assigned_driver_ids: z.array(z.string()).nullish(),
}).passthrough()
export type AdminSummary = z.infer<typeof AdminSummarySchema>

export const AdminRosterSchema = z.object({
  managers: z.array(AdminSummarySchema).nullish(),
})
export type AdminRoster = z.infer<typeof AdminRosterSchema>

/** `POST /admin/managers/{id}/assign` body — assign vehicles + drivers to an admin/manager. */
export const AssignAdminsInputSchema = z.object({
  vehicle_ids: z.array(z.string()).default([]),
  driver_ids: z.array(z.string()).default([]),
})
export type AssignAdminsInput = z.infer<typeof AssignAdminsInputSchema>

/**
 * `POST /vehicles/{id}/assign` body — assign drivers/cars to a vehicle. The phrase "admin assigns
 * cars and drivers to cars" maps to linking drivers and other vehicles to a given vehicle
 * (e.g. trailers, connected units). Drives are optional so the endpoint is reusable.
 */
export const AssignVehicleInputSchema = z.object({
  driver_ids: z.array(z.string()).default([]),
  vehicle_ids: z.array(z.string()).default([]),
})
export type AssignVehicleInput = z.infer<typeof AssignVehicleInputSchema>

/** `GET /maintenance` row (`MaintenanceListRow`). `cost` arrives as numeric text from PG. */
export const MaintenanceRowSchema = z.object({
  id: z.string().uuid(),
  vehicle_plate: z.string().nullable().optional(),
  task_name: z.string(),
  performed_at: z.string(),
  odometer_km: z.number().int().nullable().optional(),
  cost: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  vendor: z.string().nullable().optional(),
})
export type MaintenanceRow = z.infer<typeof MaintenanceRowSchema>

/** `POST /maintenance/work-orders` body. Exactly one of vehicle_id / trailer_id (DB CHECK). */
export const WorkOrderSchema = z.object({
  vehicle_id: z.string().uuid().optional(),
  trailer_id: z.string().uuid().optional(),
  task_code: z.string().min(1).max(80),
  performed_at: z.string(),
  odometer_km: z.number().int().min(0).optional(),
  vendor: z.string().max(200).optional(),
  cost: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  notes: z.string().max(2000).optional(),
})
export type WorkOrderInput = z.infer<typeof WorkOrderSchema>

/** `GET /training/lessons` row — lesson joined to its parent course. */
export const TrainingLessonSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  course_code: z.string().nullable().optional(),
  course_title: z.string().nullable().optional(),
  is_mandatory: z.boolean().nullable().optional(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  order_index: z.number().int().default(0),
})
export type TrainingLesson = z.infer<typeof TrainingLessonSchema>

/** `GET /training/roster` row — one enrolment per driver/lesson pair. */
export const TrainingRosterRowSchema = z.object({
  id: z.string().uuid(),
  driver_id: z.string().uuid().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  lesson_id: z.string().uuid().nullable().optional(),
  lesson_title: z.string().nullable().optional(),
  course_title: z.string().nullable().optional(),
  status: z.string(),
  quiz_score: z.number().int().nullable().optional(),
  completed_at: z.string().nullable().optional(),
})
export type TrainingRosterRow = z.infer<typeof TrainingRosterRowSchema>

/** `GET /reports/analytics` — headline operational counters. */
export const AnalyticsReportSchema = z.object({
  active_fleet: z.number(),
  open_accidents: z.number(),
  pending_dvir: z.number(),
  expiring_docs: z.number(),
  fuel_spend_30d: z.number(),
  anomalies_open: z.number(),
})
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>

/** `GET /reports/fuel-efficiency` — fleet totals plus the per-vehicle breakdown. */
export const FuelEfficiencyVehicleSchema = z.object({
  vehicle_plate: z.string().nullable(),
  litres: z.number(),
  cost: z.number(),
  efficiency: z.number().nullable(),
})
export type FuelEfficiencyVehicle = z.infer<typeof FuelEfficiencyVehicleSchema>

export const FuelEfficiencyReportSchema = z.object({
  total_litres: z.number(),
  total_cost: z.number(),
  avg_efficiency_l_per_100km: z.number().nullable(),
  total_co2_kg: z.number(),
  per_vehicle: z.array(FuelEfficiencyVehicleSchema).default([]),
})
export type FuelEfficiencyReport = z.infer<typeof FuelEfficiencyReportSchema>

/** `GET /admin/settings/triggers` row. `value` is typed by `value_type` at runtime. */
export const TriggerSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  value_type: z.string(),
  description: z.string().default(""),
})
export type TriggerSetting = z.infer<typeof TriggerSettingSchema>

/** `GET /notifications` row (`NotificationInboxRow`). `status` doubles as the read marker. */
export const AdminNotificationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string().default(""),
  priority: z.string().default("NORMAL"),
  status: z.string().default("QUEUED"),
  created_at: z.string(),
  payload: z.unknown().optional(),
})
export type AdminNotification = z.infer<typeof AdminNotificationSchema>

/** `PUT /admin/users/me` body — the admin's own editable profile fields. */
export const UpdateProfileSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
  locale: z.enum(["en", "sw"]).optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export const AdminProfileSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
})
export type AdminProfile = z.infer<typeof AdminProfileSchema>

/**
 * `GET /anomalies/{id}` detail view (C.14). Extends the shared feed `AnomalySchema` with the
 * additive detail columns the server projects (`AnomalyDetailRow` in api/services/queries.ts):
 * the linked entity, the resolved asset/driver labels, the recommended action and the raw
 * per-domain `signal` payload the sensor timeline is rendered from.
 */
export const AnomalyDetailSchema = AnomalySchema.extend({
  kind: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  recommended_action: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  linked_asset: z.string().nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  location_text: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  signal: z.unknown().optional(),
  resolution_note: z.string().nullable().optional(),
})
export type AnomalyDetail = z.infer<typeof AnomalyDetailSchema>

export const StatementImportSchema = z.object({
  provider: z.string().min(1),
  period_start: z.string(),
  period_end: z.string(),
  media_object_id: z.string().uuid(),
  column_mapping: z.record(z.string(), z.string()).optional(),
});

export const DocumentRowSchema = z.object({
  document_id: z.string().uuid().optional(),
  document_type: z.string().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  subject_name: z.string().nullable().optional(),
  // `app.asset_documents.expires_on` is a PG `date` (YYYY-MM-DD), not a timestamp.
  expires_on: z.string().nullable(),
  days_remaining: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable(),
});
export type DocumentRow = z.infer<typeof DocumentRowSchema>;

/** `GET /documents/{id}` detail view — the expiring row plus the resolved subject / linked asset. */
export const DocumentDetailSchema = DocumentRowSchema.extend({
  subject_name: z.string().nullable().optional(),
  linked_asset: z.string().nullable().optional(),
  renewal_note: z.string().nullable().optional(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const VerificationRowSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  operational_date: z.string().nullable().optional(),
  verification_status: z.enum(["PENDING", "VERIFIED", "FLAGGED"]).nullable().optional(),
  state: z.enum(["OPEN", "PENDING_CLOSEOUT", "CLOSED"]).nullable().optional(),
  driver_name: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  clock_in_at: z.string().datetime().nullable().optional(),
  clock_out_at: z.string().datetime().nullable().optional(),
  shift_duration_seconds: z.number().int().nullable().optional(),
  blocking_failures: z.string().nullable().optional(),
  warning_failures: z.string().nullable().optional(),
  /** Total failed DVIR items for the shift, when the view projects it (spec `dvir_review_queue`). */
  defect_count: z.union([z.string(), z.number()]).transform((v) => Number(v)).nullable().optional(),
  open_anomalies: z.string().nullable().optional(),
  flag_reason: z.string().nullable().optional(),
});
export type VerificationRow = z.infer<typeof VerificationRowSchema>;

export const MfaEnrollSchema = z.object({
  provisioning_uri: z.string().url(),
  secret_encrypted_preview: z.string().optional(),
  recovery_codes: z.array(z.string()),
});
export type MfaEnroll = z.infer<typeof MfaEnrollSchema>;

export const DeviceSummarySchema = z.object({
  device_id: z.string(),
  platform: z.enum(["ios", "android"]),
  last_seen_at: z.string().datetime().nullable().optional(),
});
export type DeviceSummary = z.infer<typeof DeviceSummarySchema>;

export const DriverSummarySchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  mfa_enrolled: z.boolean(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "ON_LEAVE", "TERMINATED"]),
  last_login_at: z.string().datetime().nullable().optional(),
  devices: z.array(DeviceSummarySchema).optional(),
});
export type DriverSummary = z.infer<typeof DriverSummarySchema>;

/** `GET /drivers/{id}` detail view — the roster row plus RBAC roles/permissions (`last_login_at`
 * already lives on the summary). */
export const DriverDetailSchema = DriverSummarySchema.extend({
  roles: z.array(z.string()).nullable().optional(),
  permissions: z.array(z.string()).nullable().optional(),
});
export type DriverDetail = z.infer<typeof DriverDetailSchema>;

/** `POST /drivers` (A3.7): admin creates a driver account (PENDING approval). */
export const CreateDriverSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/),
  full_name: z.string().min(1).max(200),
  password: z.string().min(1),
  licence_number: z.string().max(40).optional(),
  licence_class: z.string().max(20).optional(),
  emergency_contact_name: z.string().max(200).optional(),
  emergency_contact_phone: z.string().max(40).optional(),
});
export type CreateDriverInput = z.infer<typeof CreateDriverSchema>;

export const CreateDriverResponseSchema = z.object({
  user_id: z.string().uuid(),
  status: z.literal("PENDING"),
});
export type CreateDriverResponse = z.infer<typeof CreateDriverResponseSchema>;

/** Admin driver roster (A3.7). Binds to `GET /drivers` (locked contract). */
export class DriverRosterService {
  drivers: DriverSummary[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(status?: "ACTIVE" | "SUSPENDED"): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    const path = `/drivers${qs.toString() ? `?${qs.toString()}` : ""}`;
    const page = await this.api.request<unknown>(path, { method: "GET" });
    const parsed = PageSchema(DriverSummarySchema).safeParse(page);
    if (parsed.success) {
      this.drivers = parsed.data.data;
      this.emit();
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor };
    }
    return { hasMore: false, nextCursor: null };
  }

  /** Single driver (A3.7). Binds to `GET /drivers/{id}`; falls back to the loaded roster row. */
  async getOne(userId: string): Promise<DriverDetail | undefined> {
    const cached = this.drivers.find((d) => d.user_id === userId);
    try {
      const res = await this.api.request<unknown>(`/drivers/${userId}`, { method: "GET" });
      const parsed = DriverDetailSchema.safeParse(res);
      if (parsed.success) return parsed.data;
    } catch {
      // Detail endpoint unavailable/offline — fall through to the cached roster row.
    }
    return cached;
  }

  /** Creates a driver (PENDING approval). Binds to `POST /drivers` (A3.7). */
  async createDriver(input: CreateDriverInput): Promise<CreateDriverResponse> {
    const body = CreateDriverSchema.parse(input)
    const res = await this.api.request<unknown>("/drivers", { method: "POST", body })
    return CreateDriverResponseSchema.parse(res)
  }

  /** Approves a PENDING driver so they can sign in. Binds to `POST /drivers/{id}/approve` (A3.7). */
  async approveDriver(userId: string): Promise<{ approved: boolean }> {
    return this.api.request<{ approved: boolean }>(`/drivers/${userId}/approve`, { method: "POST", body: {} })
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable(), has_more: z.boolean() });

export type AdminListener = () => void;

/** Dashboard aggregates the live map + counts (N5 precedence drives the map pin colour). */
export class DashboardService {
  vehicles: VehicleState[] = [];
  accidents: AccidentEvent[] = [];
  /** Fed by the DVIR review + document services so the dashboard can summarise them. */
  pendingDvirCount = 0;
  expiringDocsCount = 0;
  connected = false;

  private listeners = new Set<AdminListener>();
  private unsubs: Array<() => void> = [];

  constructor(private readonly api: ApiClient, private readonly socket: SocketClient) {}

  bindSocket(): void {
    this.connected = this.socket.status === "connected";
    this.unsubs.push(
      this.socket.onStatusChange((status) => {
        this.connected = status === "connected";
        this.emit();
      }),
    );
    this.unsubs.push(
      this.socket.on(RealtimeChannels.vehicleStates as RealtimeChannel, (payload) => {
        // The gateway emits the bare snapshot array (07 §5); accept the object envelope too.
        const parsed = VehicleStatesResponseSchema.safeParse(
          Array.isArray(payload) ? { vehicles: payload } : payload,
        );
        if (parsed.success) {
          this.vehicles = parsed.data.vehicles;
          this.emit();
        }
      }),
    );
    this.unsubs.push(
      this.socket.on(RealtimeChannels.accidentLive as RealtimeChannel, (payload) => {
        const parsed = AccidentEventSchema.safeParse(payload);
        if (parsed?.success) {
          this.accidents = [
            parsed.data,
            ...this.accidents.filter((a) => a.accident_id !== parsed.data.accident_id),
          ];
          this.emit();
        }
      }),
    );
    this.unsubs.push(
      this.socket.on(RealtimeChannels.notifications as RealtimeChannel, () => this.emit()),
    );
  }

  /** REST snapshot for the live map (prod uses the websocket stream instead). */
  async loadVehicles(): Promise<void> {
    const res = await this.api.request<unknown>("/dashboard/vehicle-states", { method: "GET" });
    const parsed = VehicleStatesResponseSchema.safeParse(res);
    if (parsed.success) {
      this.vehicles = parsed.data.vehicles;
      this.emit();
    }
  }

  get counts(): {
    active: number;
    quarantined: number;
    offline: number;
    openAccidents: number;
    maydayActive: number;
    pendingDvir: number;
    expiringDocs: number;
  } {
    let active = 0;
    let quarantined = 0;
    let offline = 0;
    for (const v of this.vehicles) {
      if (v.display_state === "QUARANTINED") quarantined++;
      else if (v.display_state === "OFFLINE") offline++;
      else active++;
    }
    return {
      active,
      quarantined,
      offline,
      openAccidents: this.accidents.length,
      maydayActive: this.accidents.filter((a) => (a.tier ?? 4) <= 1 || a.acknowledged === false).length,
      pendingDvir: this.pendingDvirCount,
      expiringDocs: this.expiringDocsCount,
    };
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Gateway missing endpoint (KNOWN-GAP): list open accidents. Feed from `accident:live` pushes. */
export class AccidentConsoleService {
  accidents: AccidentEvent[] = [];
  private listeners = new Set<AdminListener>();
  private unsubs: Array<() => void> = [];

  constructor(private readonly api: ApiClient, private readonly socket: SocketClient) {}

  bindSocket(): void {
    this.unsubs.push(
      this.socket.on(RealtimeChannels.accidentLive as RealtimeChannel, (payload) => {
        const parsed = AccidentEventSchema.safeParse(payload);
        if (parsed?.success) {
          this.accidents = [parsed.data, ...this.accidents.filter((a) => a.accident_id !== parsed.data.accident_id)];
          this.emit();
        }
      }),
    );
  }

  /** Single accident (C.7). Binds to `GET /accidents/{id}`; falls back to the live-feed row. */
  async getOne(accidentId: string): Promise<AccidentDetail | undefined> {
    const cached = this.accidents.find((a) => a.accident_id === accidentId);
    try {
      const res = await this.api.request<unknown>(`/accidents/${accidentId}`, { method: "GET" });
      const parsed = AccidentDetailSchema.safeParse(res);
      if (parsed.success) return { ...cached, ...parsed.data };
    } catch {
      // Detail endpoint unavailable/offline — fall through to the socket-fed row.
    }
    return cached;
  }

  /** Frozen telemetry hash-chain verification (C3.4). */
  async verifyChain(accidentId: string): Promise<{ allValid: boolean; rows: number }> {
    const res = await this.api.getObject<{ all_valid: boolean; rows: Array<{ sequence: number; is_valid: boolean }> }>(
      `/accidents/${accidentId}/telemetry/verify`,
    );
    return { allValid: res.all_valid, rows: res.rows.length };
  }

  acknowledge(accidentId: string): void {
    this.accidents = this.accidents.map((a) =>
      a.accident_id === accidentId ? { ...a, acknowledged: true } : a,
    );
    this.emit();
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Anomaly feed (fuel/hos/accident/maintenance/security). Admin can filter by domain. */
export class AnomalyService {
  anomalies: Anomaly[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(domains?: string[]): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    if (domains?.length) qs.set("domains", domains.join(","));
    const path = `/anomalies${qs.toString() ? `?${qs.toString()}` : ""}`;
    const page = await this.api.request<unknown>(path, { method: "GET" });
    const parsed = PageSchema(AnomalySchema).safeParse(page);
    if (parsed.success) {
      this.anomalies = parsed.data.data;
      this.emit();
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor };
    }
    return { hasMore: false, nextCursor: null };
  }

  /**
   * Single anomaly (C.14). `GET /anomalies/{id}` returns a superset of the feed row (linked entity,
   * recommended action, sensor `signal` payload), so the detail endpoint is always preferred and
   * the cached feed row is only a fallback for offline/unavailable.
   */
  async getOne(anomalyId: string): Promise<AnomalyDetail | undefined> {
    const cached = this.anomalies.find((a) => a.id === anomalyId);
    try {
      const res = await this.api.request<unknown>(`/anomalies/${anomalyId}`, { method: "GET" });
      const parsed = AnomalyDetailSchema.safeParse(res);
      if (parsed.success) return { ...cached, ...parsed.data };
    } catch {
      // Detail endpoint unavailable/offline — fall through to the cached feed row.
    }
    return cached;
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Expiring documents (3.5 / B8). */
export class DocumentService {
  documents: DocumentRow[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(withinDays = 30): Promise<void> {
    const page = await this.api.request<unknown>(`/documents/expiring?within_days=${withinDays}`, { method: "GET" });
    const parsed = PageSchema(DocumentRowSchema).safeParse(page);
    if (parsed.success) {
      this.documents = parsed.data.data;
      this.emit();
    }
  }

  /** Single document (C.16). Binds to `GET /documents/{id}`; falls back to the expiring row. */
  async getOne(documentId: string): Promise<DocumentDetail | undefined> {
    const cached = this.documents.find((d) => d.document_id === documentId);
    try {
      const res = await this.api.request<unknown>(`/documents/${documentId}`, { method: "GET" });
      const parsed = DocumentDetailSchema.safeParse(res);
      if (parsed.success) return { ...cached, ...parsed.data };
    } catch {
      // Detail endpoint unavailable/offline — fall through to the cached expiring row.
    }
    return cached;
  }

  /**
   * Records the admin's renewal note against a document. Binds to
   * `POST /documents/{id}/renewal-note` (document:manage), which writes `app.asset_documents.notes`.
   * The cached row is patched optimistically so the detail screen re-renders without a refetch.
   */
  async renewalNote(documentId: string, note: string): Promise<DocumentDetail> {
    const res = await this.api.send<unknown>("POST", `/documents/${documentId}/renewal-note`, { note })
    const parsed = DocumentDetailSchema.safeParse(res)
    const cached = this.documents.find((d) => d.document_id === documentId)
    const merged: DocumentDetail = parsed.success
      ? { ...cached, ...parsed.data }
      : { ...(cached ?? { expires_on: null, days_remaining: null }), renewal_note: note }
    this.documents = this.documents.map((d) => (d.document_id === documentId ? { ...d, ...merged } : d))
    this.emit()
    return merged
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Fuel reconciliation inbox + verify/adjust/reject + statement import (A1.9, 2.5). */
export class FuelReconcileService {
  rows: FuelReconcileRow[] = [];
  /** Photo-first review queue (`GET /admin/fuel/pending`), kept separate from `rows`. */
  pending: FuelPendingRow[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(unverifiedOnly = true): Promise<void> {
    const page = await this.api.request<unknown>(
      `/fuel/reconciliation-inbox?unverified_only=${unverifiedOnly}`,
      { method: "GET" },
    );
    const parsed = PageSchema(FuelReconcileRowSchema).safeParse(page);
    if (parsed.success) {
      this.rows = parsed.data.data;
      this.emit();
    }
  }

  /**
   * Photo-first pending queue (A1.4). Binds to `GET /admin/fuel/pending`, which returns a
   * `{ purchases: [...] }` envelope; a bare array and `{ data: [...] }` are accepted too so an
   * older gateway still parses. Rows that fail validation are dropped individually rather than
   * voiding the whole queue.
   */
  async loadPending(): Promise<FuelPendingRow[]> {
    const res = await this.api.request<unknown>("/admin/fuel/pending", { method: "GET" });
    const envelope = res as { purchases?: unknown[]; data?: unknown[] } | null;
    const raw: unknown[] = Array.isArray(res)
      ? res
      : Array.isArray(envelope?.purchases)
        ? envelope.purchases
        : Array.isArray(envelope?.data)
          ? envelope.data
          : [];
    const rows: FuelPendingRow[] = [];
    for (const item of raw) {
      const parsed = FuelPendingRowSchema.safeParse(item);
      if (parsed.success) rows.push(parsed.data);
    }
    this.pending = rows;
    this.emit();
    return rows;
  }

  /** Pending row by id, from the loaded queue (the list payload is the detail payload). */
  getPending(purchaseId: string): FuelPendingRow | undefined {
    return this.pending.find((r) => r.fuel_purchase_id === purchaseId);
  }

  /**
   * Displayable URI for a `media_object_id`. The pending payload references receipt/odometer photos
   * by id only, so the app resolves them against the media read endpoint.
   */
  mediaUri(mediaObjectId: string | null | undefined): string | null {
    if (!mediaObjectId) return null;
    return `${this.api.baseUrl}/media/${mediaObjectId}`;
  }

  /**
   * Single purchase (C.11). The detail payload equals the inbox row, so `FuelReconcileRow` is
   * reused: prefer the loaded row, else bind to `GET /fuel/purchases/{id}`.
   */
  async getOne(purchaseId: string): Promise<FuelReconcileRow | undefined> {
    const cached = this.rows.find((r) => r.fuel_purchase_id === purchaseId);
    if (cached) return cached;
    try {
      const res = await this.api.request<unknown>(`/fuel/purchases/${purchaseId}`, { method: "GET" });
      const parsed = FuelReconcileRowSchema.safeParse(res);
      if (parsed.success) return parsed.data;
    } catch {
      // Detail endpoint unavailable/offline.
    }
    return undefined;
  }

  /**
   * Verify / reject / clear a purchase.
   *
   * Photo-first reviews (anything carrying an admin override, or a row already loaded into the
   * `pending` queue) go to `PUT /admin/fuel/verify/{id}` so the adjusted amount/liters/odometer and
   * `admin_notes` are persisted. Everything else keeps the legacy statement-inbox binding
   * `POST /fuel/purchases/{id}/verify`, which does not accept those fields.
   */
  async verify(
    purchaseId: string,
    body: z.infer<typeof VerifyPurchaseSchema>,
    overrides?: FuelAdminOverrides,
  ): Promise<void> {
    const merged: z.infer<typeof VerifyPurchaseSchema> = { ...body, ...(overrides ?? {}) };
    const hasOverride =
      merged.adjusted_amount !== undefined ||
      merged.adjusted_litres !== undefined ||
      merged.adjusted_odometer !== undefined ||
      merged.admin_notes !== undefined;
    const isPending = this.pending.some((r) => r.fuel_purchase_id === purchaseId);

    if (hasOverride || isPending) {
      await this.api.send("PUT", `/admin/fuel/verify/${purchaseId}`, merged);
    } else {
      await this.api.send("POST", `/fuel/purchases/${purchaseId}/verify`, merged);
    }

    const verified = merged.action === "VERIFY";
    this.rows = this.rows.map((r) =>
      r.fuel_purchase_id === purchaseId ? { ...r, admin_verified: verified } : r,
    );
    // A decided row leaves the photo-first queue.
    this.pending = this.pending.filter((r) => r.fuel_purchase_id !== purchaseId);
    this.emit();
  }

  async importStatement(body: z.infer<typeof StatementImportSchema>): Promise<{ statementId: string }> {
    const res = await this.api.send<{ statement_id: string }>("POST", "/reconciliation/statements", body);
    return { statementId: res.statement_id };
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * Tracker / hardware provisioning (A1.1, N2.3). Binds to `POST /admin/hardware/pair` and
 * `GET /admin/hardware/pending`. Stateless apart from the polled tracker list.
 */
export class HardwareService {
  trackers: HardwareTrackerStatus[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  /**
   * Pairs a tracker to a vehicle and returns the installer SMS command. Re-calling with the same
   * IMEI is the "resend command" path — the endpoint is idempotent on (vehicleId, trackerImei).
   */
  async pair(input: HardwarePairInput): Promise<HardwarePairResult> {
    const body = HardwarePairSchema.parse(input);
    const res = await this.api.send<unknown>("POST", "/admin/hardware/pair", body);
    return HardwarePairResultSchema.parse(res);
  }

  /**
   * Tracker roster for the status board. Accepts `{ trackers: [...] }` (the contract) as well as a
   * bare array. Individually invalid rows are dropped so one bad record cannot blank the board.
   */
  async listPending(): Promise<HardwareTrackerStatus[]> {
    const res = await this.api.request<unknown>("/admin/hardware/pending", { method: "GET" });
    const raw: unknown[] = Array.isArray(res)
      ? res
      : Array.isArray((res as { trackers?: unknown[] } | null)?.trackers)
        ? ((res as { trackers: unknown[] }).trackers)
        : [];
    const rows: HardwareTrackerStatus[] = [];
    for (const item of raw) {
      const parsed = HardwareTrackerStatusSchema.safeParse(item);
      if (parsed.success) rows.push(parsed.data);
    }
    this.trackers = rows;
    this.emit();
    return rows;
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Shift / DVIR verification inbox + verify/flag (2.7, B18). */
export class VerificationService {
  rows: VerificationRow[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(opts: { verificationStatus?: string; state?: string; operationalDate?: string } = {}): Promise<void> {
    const qs = new URLSearchParams();
    if (opts.verificationStatus) qs.set("verification_status", opts.verificationStatus);
    if (opts.state) qs.set("state", opts.state);
    if (opts.operationalDate) qs.set("operational_date", opts.operationalDate);
    const path = `/shifts/verification-inbox${qs.toString() ? `?${qs.toString()}` : ""}`;
    const page = await this.api.request<unknown>(path, { method: "GET" });
    const parsed = PageSchema(VerificationRowSchema).safeParse(page);
    if (parsed.success) {
      this.rows = parsed.data.data;
      this.emit();
    }
  }

  /**
   * Single shift verification (C.9). The detail payload equals the inbox row, so `VerificationRow`
   * is reused: prefer the loaded row, else bind to `GET /shifts/{shiftId}/verification`.
   */
  async getOne(shiftId: string): Promise<VerificationRow | undefined> {
    const cached = this.rows.find((r) => r.shift_id === shiftId);
    if (cached) return cached;
    try {
      const res = await this.api.request<unknown>(`/shifts/${shiftId}/verification`, { method: "GET" });
      const parsed = VerificationRowSchema.safeParse(res);
      if (parsed.success) return parsed.data;
    } catch {
      // Detail endpoint unavailable/offline.
    }
    return undefined;
  }

  async verify(shiftId: string, body: { action: "VERIFY" | "FLAG"; flagReason?: string; correctedEndOdometerKm?: number }): Promise<void> {
    await this.api.send("POST", `/shifts/${shiftId}/verify`, body);
    this.rows = this.rows.map((r) =>
      r.shift_id === shiftId
        ? { ...r, verification_status: body.action === "VERIFY" ? "VERIFIED" : "FLAGGED", flag_reason: body.flagReason ?? r.flag_reason }
        : r,
    );
    this.emit();
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Driver security: MFA enrollment (D-12) + device/session revoke (locked contract). */
export class SecurityService {
  constructor(private readonly api: ApiClient) {}

  /** Begin TOTP enrolment for a driver (A3.7). Admin-supplied password is the caller's own. */
  async enrollDriverMfa(password: string): Promise<MfaEnroll> {
    const res = await this.api.send<MfaEnroll>("POST", "/auth/mfa/enroll", { password });
    return MfaEnrollSchema.parse(res);
  }

  /** Revoke a device (forces re-auth). Binds to `POST /devices/{deviceId}/revoke`. */
  async revokeDevice(deviceId: string): Promise<void> {
    await this.api.send("POST", `/devices/${deviceId}/revoke`, {});
  }

  /** Force a global sign-out for a user. Binds to `POST /sessions/revoke`. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.api.send("POST", `/sessions/revoke`, { user_id: userId });
  }

  async suspend(userId: string): Promise<void> {
    await this.api.send("POST", `/admin/users/${userId}/suspend`, {});
  }

  async reinstate(userId: string): Promise<void> {
    await this.api.send("POST", `/admin/users/${userId}/reinstate`, {});
  }

  /**
   * Updates the *calling* admin's own profile. Binds to `PUT /admin/users/me` (user:manage), which
   * writes `app.users.full_name / phone / locale`. The target is always the resolved principal, so
   * this can never be used to edit another user.
   */
  async updateProfile(input: UpdateProfileInput): Promise<AdminProfile> {
    const body = UpdateProfileSchema.parse(input);
    const res = await this.api.send<unknown>("PUT", "/admin/users/me", body);
    return AdminProfileSchema.parse(res);
  }

  /** Reads the *calling* admin's own profile. Binds to `GET /admin/users/me`. */
  async getProfile(): Promise<AdminProfile> {
    const res = await this.api.request<unknown>("/admin/users/me", { method: "GET" });
    return AdminProfileSchema.parse(res);
  }
}

/** Vehicle master data (Pillar 4). Binds to `GET/POST /vehicles` + `GET/PATCH /vehicles/{id}`. */
export class VehicleService {
  vehicles: VehicleRecord[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(limit = 50): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const page = await this.api.request<unknown>(`/vehicles?limit=${limit}`, { method: "GET" });
    const parsed = PageSchema(VehicleRecordSchema).safeParse(page);
    if (parsed.success) {
      this.vehicles = parsed.data.data;
      this.emit();
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor };
    }
    return { hasMore: false, nextCursor: null };
  }

  /** Single vehicle. Prefers `GET /vehicles/{id}`, falling back to the loaded list row. */
  async getOne(vehicleId: string): Promise<VehicleRecord | undefined> {
    const cached = this.vehicles.find((v) => v.id === vehicleId);
    try {
      const res = await this.api.request<unknown>(`/vehicles/${vehicleId}`, { method: "GET" });
      const parsed = VehicleRecordSchema.safeParse(res);
      if (parsed.success) return { ...cached, ...parsed.data };
    } catch {
      // Detail endpoint unavailable/offline — fall through to the cached list row.
    }
    return cached;
  }

  async update(vehicleId: string, input: Partial<Pick<VehicleRecord, "status" | "is_operational" | "notes">>): Promise<VehicleRecord | undefined> {
    const res = await this.api.send<unknown>("PATCH", `/vehicles/${vehicleId}`, input);
    const parsed = VehicleRecordSchema.safeParse(res);
    if (parsed.success) {
      this.vehicles = this.vehicles.map((v) => (v.id === vehicleId ? parsed.data : v));
      this.emit();
      return parsed.data;
    }
    return undefined;
  }

  /** Admin creates a vehicle (a "car") so it can be assigned to drivers / managers. Binds to `POST /vehicles`. */
  async createVehicle(input: VehicleCreateInput): Promise<VehicleRecord> {
    const body = VehicleCreateSchema.parse(input)
    const res = await this.api.send<unknown>("POST", "/vehicles", body)
    const parsed = VehicleRecordSchema.safeParse(res)
    if (parsed.success) {
      this.vehicles = [parsed.data, ...this.vehicles]
      this.emit()
      return parsed.data
    }
    return { id: "00000000-0000-0000-0000-000000000000", ...body } as VehicleRecord
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * Admin / fleet-manager roster + assignment (the "admins assign tasks to admins" surface). Lists
 * every admin in the company and lets an ADMIN assign vehicles + drivers to each one via the
 * assignment dropdowns. Binds to `GET /admin/managers` and `POST /admin/managers/{id}/assign`
 * (contract defined in packages/mobile/BACKEND_TODO.md — the backend agent implements these).
 *
 * Parsing is tolerant: a partially-implemented backend yields `managers: []` and the screen renders
 * an empty state rather than throwing.
 */
export class AdminRosterService {
  managers: AdminSummary[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(): Promise<AdminRoster> {
    const res = await this.api.request<unknown>("/admin/managers", { method: "GET" });
    const parsed = AdminRosterSchema.safeParse(res);
    this.managers = parsed.success ? (parsed.data.managers ?? []) : [];
    this.emit();
    return { managers: this.managers };
  }

  /** Assign (replace) the vehicle + driver sets for one admin/manager. */
  async assign(adminId: string, input: AssignAdminsInput): Promise<void> {
    const body = AssignAdminsInputSchema.parse(input)
    await this.api.send("POST", `/admin/managers/${encodeURIComponent(adminId)}/assign`, body)
    this.managers = this.managers.map((m) =>
      m.user_id === adminId
        ? { ...m, assigned_vehicle_ids: body.vehicle_ids, assigned_driver_ids: body.driver_ids }
        : m,
    )
    this.emit()
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * Vehicle ↔ driver / vehicle linkage ("admin assigns cars and drivers to cars"). Binds to
 * `POST /vehicles/{id}/assign` (contract in packages/mobile/BACKEND_TODO.md).
 */
export class AssignmentService {
  constructor(private readonly api: ApiClient) {}

  /** Assign drivers and/or linked vehicles to a vehicle. Replaces the current set. */
  async assignVehicle(vehicleId: string, input: AssignVehicleInput): Promise<void> {
    const body = AssignVehicleInputSchema.parse(input)
    await this.api.send("POST", `/vehicles/${encodeURIComponent(vehicleId)}/assign`, body)
  }
}

/** Maintenance history + work-order recording (Pillar 3). `GET /maintenance`, `POST /maintenance/work-orders`. */
export class MaintenanceService {
  rows: MaintenanceRow[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(limit = 50): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const page = await this.api.request<unknown>(`/maintenance?limit=${limit}`, { method: "GET" });
    const parsed = PageSchema(MaintenanceRowSchema).safeParse(page);
    if (parsed.success) {
      this.rows = parsed.data.data;
      this.emit();
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor };
    }
    return { hasMore: false, nextCursor: null };
  }

  async getOne(recordId: string): Promise<MaintenanceRow | undefined> {
    const cached = this.rows.find((r) => r.id === recordId);
    if (cached) return cached;
    try {
      const res = await this.api.request<unknown>(`/maintenance/${recordId}`, { method: "GET" });
      const parsed = MaintenanceRowSchema.safeParse(res);
      if (parsed.success) return parsed.data;
    } catch {
      // Detail endpoint unavailable/offline.
    }
    return undefined;
  }

  /** Records a completed work order and refreshes the list so the new row appears. */
  async createWorkOrder(input: WorkOrderInput): Promise<{ id: string }> {
    const body = WorkOrderSchema.parse(input);
    const res = await this.api.send<{ id: string }>("POST", "/maintenance/work-orders", body);
    await this.load().catch(() => undefined);
    return { id: res.id };
  }

  /**
   * Queue-status counters for the stat cards. `app.maintenance_records` is a completion log, so
   * "overdue"/"due" are derived from how long ago the last service for the plate was recorded and
   * "in shop" from records dated in the future (a scheduled/open booking).
   */
  get counts(): { due: number; overdue: number; inShop: number } {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let due = 0;
    let overdue = 0;
    let inShop = 0;
    for (const r of this.rows) {
      const at = Date.parse(r.performed_at);
      if (!Number.isFinite(at)) continue;
      if (at > now) inShop++;
      else if (now - at > 180 * DAY) overdue++;
      else if (now - at > 150 * DAY) due++;
    }
    return { due, overdue, inShop };
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Training/LMS catalogue + manager roster (Phase 3). `GET /training/lessons`, `GET /training/roster`. */
export class TrainingService {
  lessons: TrainingLesson[] = [];
  roster: TrainingRosterRow[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async loadLessons(limit = 100): Promise<void> {
    const page = await this.api.request<unknown>(`/training/lessons?limit=${limit}`, { method: "GET" });
    const parsed = PageSchema(TrainingLessonSchema).safeParse(page);
    if (parsed.success) {
      this.lessons = parsed.data.data;
      this.emit();
    }
  }

  async loadRoster(limit = 200): Promise<void> {
    const page = await this.api.request<unknown>(`/training/roster?limit=${limit}`, { method: "GET" });
    const parsed = PageSchema(TrainingRosterRowSchema).safeParse(page);
    if (parsed.success) {
      this.roster = parsed.data.data;
      this.emit();
    }
  }

  /** Loads both halves of the review screen; either may fail independently without blocking. */
  async load(): Promise<void> {
    await Promise.all([this.loadLessons().catch(() => undefined), this.loadRoster().catch(() => undefined)]);
  }

  async getLesson(lessonId: string): Promise<TrainingLesson | undefined> {
    const cached = this.lessons.find((l) => l.id === lessonId);
    if (cached) return cached;
    try {
      const res = await this.api.request<unknown>(`/training/lessons/${lessonId}`, { method: "GET" });
      const parsed = TrainingLessonSchema.safeParse(res);
      if (parsed.success) return parsed.data;
    } catch {
      // Detail endpoint unavailable/offline.
    }
    return undefined;
  }

  /** Marks the *calling* driver's enrolment complete (`training:complete`). */
  async completeLesson(lessonId: string, quizScore?: number): Promise<void> {
    await this.api.send("POST", `/training/lessons/${lessonId}/complete`, quizScore != null ? { quiz_score: quizScore } : {});
    await this.loadRoster().catch(() => undefined);
  }

  /** Completion ratio (0–1) per lesson id, derived from the roster enrolments. */
  completionFor(lessonId: string): { completed: number; total: number; ratio: number } {
    const rows = this.roster.filter((r) => r.lesson_id === lessonId);
    const completed = rows.filter((r) => r.status === "COMPLETED").length;
    const total = rows.length;
    return { completed, total, ratio: total > 0 ? completed / total : 0 };
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Reporting aggregates (Pillar 6). `GET /reports/analytics`, `GET /reports/fuel-efficiency`. */
export class ReportsService {
  analytics: AnalyticsReport | null = null;
  fuelEfficiency: FuelEfficiencyReport | null = null;
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async loadAnalytics(): Promise<AnalyticsReport | null> {
    const res = await this.api.request<unknown>("/reports/analytics", { method: "GET" });
    const parsed = AnalyticsReportSchema.safeParse(res);
    if (parsed.success) {
      this.analytics = parsed.data;
      this.emit();
      return parsed.data;
    }
    return null;
  }

  async loadFuelEfficiency(): Promise<FuelEfficiencyReport | null> {
    const res = await this.api.request<unknown>("/reports/fuel-efficiency", { method: "GET" });
    const parsed = FuelEfficiencyReportSchema.safeParse(res);
    if (parsed.success) {
      this.fuelEfficiency = parsed.data;
      this.emit();
      return parsed.data;
    }
    return null;
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Admin trigger thresholds (C2.4). `GET/PUT /admin/settings/triggers`. */
export class SettingsService {
  triggers: TriggerSetting[] = [];
  private listeners = new Set<AdminListener>();

  constructor(private readonly api: ApiClient) {}

  async load(): Promise<TriggerSetting[]> {
    const res = await this.api.request<unknown>("/admin/settings/triggers", { method: "GET" });
    const parsed = z.object({ data: z.array(TriggerSettingSchema) }).safeParse(res);
    if (parsed.success) {
      this.triggers = parsed.data.data;
      this.emit();
      return parsed.data.data;
    }
    return [];
  }

  /** `PUT /admin/settings/triggers` updates exactly one key, so the screen calls this per change. */
  async updateTrigger(key: string, value: unknown): Promise<TriggerSetting | undefined> {
    const res = await this.api.send<unknown>("PUT", "/admin/settings/triggers", { key, value });
    const parsed = TriggerSettingSchema.safeParse(res);
    if (parsed.success) {
      this.triggers = this.triggers.map((t) => (t.key === key ? parsed.data : t));
      this.emit();
      return parsed.data;
    }
    return undefined;
  }

  /** Applies a batch of changes key-by-key, collecting per-key failures rather than aborting. */
  async saveAll(changes: Record<string, unknown>): Promise<{ saved: string[]; failed: Array<{ key: string; message: string }> }> {
    const saved: string[] = [];
    const failed: Array<{ key: string; message: string }> = [];
    for (const [key, value] of Object.entries(changes)) {
      try {
        await this.updateTrigger(key, value);
        saved.push(key);
      } catch (e) {
        failed.push({ key, message: (e as Error).message });
      }
    }
    return { saved, failed };
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * Admin notification inbox (C6.4). REST snapshot from `GET /notifications` plus live appends from
 * the `notifications` realtime channel, so the feed stays current without polling.
 */
export class NotificationService {
  notifications: AdminNotification[] = [];
  private listeners = new Set<AdminListener>();
  private unsubs: Array<() => void> = [];

  constructor(private readonly api: ApiClient, private readonly socket: SocketClient) {}

  bindSocket(): void {
    this.unsubs.push(
      this.socket.on(RealtimeChannels.notifications as RealtimeChannel, (payload) => {
        // The gateway emits an array (snapshot + live fan-out, 07 §3/§5); accept a bare row and
        // the `{ userId, notification }` envelope too.
        const raw = (payload as { notification?: unknown })?.notification ?? payload;
        const rows = Array.isArray(raw) ? raw : [raw];
        let changed = false;
        for (const row of rows) {
          const parsed = AdminNotificationSchema.safeParse(row);
          if (!parsed.success) continue;
          this.notifications = [parsed.data, ...this.notifications.filter((n) => n.id !== parsed.data.id)];
          changed = true;
        }
        if (changed) this.emit();
      }),
    );
  }

  async load(limit = 50): Promise<{ hasMore: boolean; nextCursor: string | null }> {
    const page = await this.api.request<unknown>(`/notifications?limit=${limit}`, { method: "GET" });
    const parsed = PageSchema(AdminNotificationSchema).safeParse(page);
    if (parsed.success) {
      this.notifications = parsed.data.data;
      this.emit();
      return { hasMore: parsed.data.has_more, nextCursor: parsed.data.next_cursor };
    }
    return { hasMore: false, nextCursor: null };
  }

  /** Acknowledges one notification. `DELIVERED` is the server's read marker (C6.4). */
  async markRead(notificationId: string): Promise<void> {
    await this.api.send("POST", `/notifications/${notificationId}/read`, {});
    this.notifications = this.notifications.map((n) =>
      n.id === notificationId ? { ...n, status: "DELIVERED" } : n,
    );
    this.emit();
  }

  /** Marks every currently-unread notification as read (C6.4 "mark all read"). */
  async markAllRead(): Promise<void> {
    const pending = this.notifications.filter((n) => NotificationService.isUnread(n));
    await Promise.all(pending.map((n) => this.markRead(n.id).catch(() => undefined)));
  }

  /** A notification counts as unread until the server marks it DELIVERED. */
  static isUnread(n: AdminNotification): boolean {
    return n.status !== "DELIVERED";
  }

  get unreadCount(): number {
    return this.notifications.filter((n) => NotificationService.isUnread(n)).length;
  }

  onChange(cb: AdminListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

export interface AdminServices {
  dashboard: DashboardService
  accidents: AccidentConsoleService
  anomalies: AnomalyService
  documents: DocumentService
  fuel: FuelReconcileService
  hardware: HardwareService
  verification: VerificationService
  security: SecurityService
  drivers: DriverRosterService
  vehicles: VehicleService
  adminRoster: AdminRosterService
  assignments: AssignmentService
  maintenance: MaintenanceService
  training: TrainingService
  reports: ReportsService
  /** Hierarchical drill-down analytics (company → manager → vehicle/driver). */
  analytics: AnalyticsService
  settings: SettingsService
  notifications: NotificationService
}

export function createAdminServices(api: ApiClient, socket: SocketClient): AdminServices {
  return {
    dashboard: new DashboardService(api, socket),
    accidents: new AccidentConsoleService(api, socket),
    anomalies: new AnomalyService(api),
    documents: new DocumentService(api),
    fuel: new FuelReconcileService(api),
    hardware: new HardwareService(api),
    verification: new VerificationService(api),
    security: new SecurityService(api),
    drivers: new DriverRosterService(api),
    vehicles: new VehicleService(api),
    adminRoster: new AdminRosterService(api),
    assignments: new AssignmentService(api),
    maintenance: new MaintenanceService(api),
    training: new TrainingService(api),
    reports: new ReportsService(api),
    analytics: new AnalyticsService(api),
    settings: new SettingsService(api),
    notifications: new NotificationService(api, socket),
  };
}
