/**
 * Dashboard / insights / notification read models.
 *
 * Every projection here is taken from the SQL in `packages/api/src/services/queries.ts` and
 * `repositories/notifications.ts` — not from the app's earlier guesses, which used `anomaly_id`,
 * `description`, `asset_name`, `expires_at` and `days_until_expiry`, none of which the server sends.
 */
import { z } from 'zod';
import { AnomalyDomain, AnomalySeverity, N5_ORDER } from '../types';

const looseNum = z.union([z.string(), z.number()]).transform((v) => (v === null || v === '' ? null : Number(v))).nullable().optional();

// ── live map ─────────────────────────────────────────────────────────────────────────────────

/** `GET /dashboard/vehicle-states` (`VehicleState` in `DashboardQuery.vehicleStates`). */
export const VehicleStateRowSchema = z.object({
  vehicle_id: z.string().uuid(),
  display_state: z.enum(N5_ORDER),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  driver_name: z.string().nullable(),
  next_eligible_clock_in_at: z.string().nullable(),
  plate: z.string().nullable(),
  odometer_km: looseNum,
  engine_hours: looseNum,
  vehicle_class: z.string().nullable(),
  asset_status: z.string().nullable(),
  is_online: z.boolean().nullable(),
  last_position_at: z.string().nullable(),
  last_speed_kph: looseNum,
});
export type VehicleStateRow = z.infer<typeof VehicleStateRowSchema>;

export const VehicleStatesSchema = z.object({ vehicles: z.array(VehicleStateRowSchema) });

// ── anomalies ─────────────────────────────────────────────────────────────────────────────────

export const ANOMALY_DOMAINS = AnomalyDomain.options;

/** One row of `GET /anomalies` (`AnomalyRow` — the raw `app.v_open_anomalies` projection). */
export const AnomalyRowSchema = z.object({
  domain: z.string(),
  id: z.string().uuid(),
  severity: z.string(),
  kind: z.string(),
  vehicle_id: z.string().uuid().nullable(),
  driver_id: z.string().uuid().nullable(),
  detected_at: z.string(),
  detail: z.unknown().nullable(),
});
export type AnomalyRow = z.infer<typeof AnomalyRowSchema>;

/**
 * `GET /anomalies/{id}` (`AnomalyDetailRow`). Severity is already mapped to
 * LOW/MEDIUM/HIGH/CRITICAL by the server, and `signal` carries the whole per-domain `detail` bag.
 */
export const AnomalyDetailSchema = z
  .object({
    id: z.string().uuid(),
    domain: z.string(),
    severity: AnomalySeverity,
    title: z.string(),
    body: z.string(),
    created_at: z.string(),
    kind: z.string(),
    status: z.string(),
    recommended_action: z.string().nullable(),
    linked_entity_type: z.string().nullable(),
    linked_entity_id: z.string().uuid().nullable(),
    linked_asset: z.string().nullable(),
    vehicle_id: z.string().uuid().nullable(),
    vehicle_plate: z.string().nullable(),
    driver_id: z.string().uuid().nullable(),
    driver_name: z.string().nullable(),
    location_text: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    signal: z.unknown().nullable(),
  })
  .passthrough();
export type AnomalyDetail = z.infer<typeof AnomalyDetailSchema>;

/**
 * `GET /reports/analytics` (`AnalyticsReport`). This is the ONLY endpoint that returns exact counts,
 * which is why the admin overview reads it instead of the size of a page. `report:read` is held by
 * ADMIN and FLEET_MANAGER. It is not paginated and has no date filter.
 */
export const AnalyticsReportSchema = z.object({
  active_fleet: z.number().int().nonnegative(),
  open_accidents: z.number().int().nonnegative(),
  pending_dvir: z.number().int().nonnegative(),
  expiring_docs: z.number().int().nonnegative(),
  fuel_spend_30d: z.number().nonnegative(),
  anomalies_open: z.number().int().nonnegative(),
});
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;

// ── hierarchical analytics ──────────────────────────────────────────────────────────────────────

/** Headline KPIs shared by every analytics node (company, manager, vehicle, driver). */
export const AnalyticsKpisSchema = z.object({
  vehicles: z.number(),
  drivers: z.number(),
  distanceKm: z.number(),
  fuelCost: z.number(),
  anomalies: z.number(),
});
export type AnalyticsKpis = z.infer<typeof AnalyticsKpisSchema>;

/** One row of the per-vehicle breakdown inside `GET /analytics/vehicle/:id` or `/analytics/manager/:id`. */
export const VehicleAnalyticsSchema = z.object({
  vehicle_id: z.string().uuid(),
  plate: z.string().nullable(),
  distanceKm: z.number(),
  fuelCost: z.number(),
  utilisationPct: z.number(),
  anomalies: z.number(),
});
export type VehicleAnalytics = z.infer<typeof VehicleAnalyticsSchema>;

/** One row of the per-driver breakdown inside `GET /analytics/driver/:id` or `/analytics/manager/:id`. */
export const DriverAnalyticsSchema = z.object({
  driver_id: z.string().uuid(),
  name: z.string().nullable(),
  distanceKm: z.number(),
  shifts: z.number(),
  anomalies: z.number(),
});
export type DriverAnalytics = z.infer<typeof DriverAnalyticsSchema>;

/** One FLEET_MANAGER row inside `GET /analytics/company`, with its own assignment scope. */
export const ManagerAnalyticsSummarySchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  assignedVehicleIds: z.array(z.string().uuid()).nullable(),
  assignedDriverIds: z.array(z.string().uuid()).nullable(),
  kpis: AnalyticsKpisSchema,
});
export type ManagerAnalyticsSummary = z.infer<typeof ManagerAnalyticsSummarySchema>;

/**
 * `GET /analytics/company`: company roll-up plus per-manager breakdown. The flat legacy counters
 * (active_fleet, fuel_spend_30d, …) are included alongside so `GET /reports/analytics` parses this
 * body unchanged via `AnalyticsReportSchema`.
 */
export const CompanyAnalyticsSchema = AnalyticsReportSchema.extend({
  tenant_id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  kpis: AnalyticsKpisSchema,
  managers: z.array(ManagerAnalyticsSummarySchema),
});
export type CompanyAnalytics = z.infer<typeof CompanyAnalyticsSchema>;

/** `GET /analytics/manager/:id`: one manager's scope, expanded per vehicle and per driver. */
export const ManagerAnalyticsSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  from: z.string(),
  to: z.string(),
  assignedVehicleIds: z.array(z.string().uuid()).nullable(),
  assignedDriverIds: z.array(z.string().uuid()).nullable(),
  kpis: AnalyticsKpisSchema,
  vehicles: z.array(VehicleAnalyticsSchema),
  drivers: z.array(DriverAnalyticsSchema),
});
export type ManagerAnalytics = z.infer<typeof ManagerAnalyticsSchema>;

/** `GET /analytics/vehicle/:id`. */
export const VehicleAnalyticsDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  vehicle: VehicleAnalyticsSchema,
  kpis: AnalyticsKpisSchema,
});
export type VehicleAnalyticsDetail = z.infer<typeof VehicleAnalyticsDetailSchema>;

/** `GET /analytics/driver/:id` and `GET /analytics/me`. */
export const DriverAnalyticsDetailSchema = z.object({
  from: z.string(),
  to: z.string(),
  driver: DriverAnalyticsSchema,
  kpis: AnalyticsKpisSchema,
});
export type DriverAnalyticsDetail = z.infer<typeof DriverAnalyticsDetailSchema>;

// ── documents ─────────────────────────────────────────────────────────────────────────────────

/** One row of `GET /documents/expiring` (`DocumentSummaryRow`). */
export const DocumentSummarySchema = z.object({
  document_id: z.string().uuid(),
  document_type: z.string().nullable(),
  document_number: z.string().nullable(),
  is_blocking: z.boolean(),
  expires_on: z.string().nullable(),
  days_remaining: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  subject_id: z.string().uuid().nullable(),
  subject_type: z.string().nullable(),
  linked_asset: z.string().nullable(),
  subject_name: z.string().nullable(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

/** `GET /documents/{id}` (`DocumentDetailRow`). */
export const DocumentDetailSchema = DocumentSummarySchema.extend({
  issuer: z.string().nullable().optional(),
  issued_on: z.string().nullable().optional(),
  verified_at: z.string().nullable().optional(),
  renewal_note: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  scan_media_id: z.string().uuid().nullable().optional(),
  metadata: z.array(z.object({ key: z.string(), value: z.string().nullable() })).default([]),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const DocumentRenewalNoteSchema = z.object({ note: z.string().min(1).max(2000) });

// ── notifications ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /notifications` rows are `app.notifications`. There is no `read_at`: read state is the
 * `status` column (QUEUED | SENT | DELIVERED | READ | FAILED | SUPPRESSED), and the payload is
 * `payload` (jsonb), not `data_json`.
 */
export const NotificationStatus = z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED']);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

export const NotificationChannel = z.enum(['PUSH', 'SMS', 'EMAIL', 'IN_APP']);

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  template_code: z.string().nullable(),
  recipient_user_id: z.string().uuid().nullable(),
  channel: NotificationChannel,
  priority: z.string(),
  locale: z.string(),
  title: z.string(),
  body: z.string(),
  payload: z.unknown().nullable(),
  incident_kind: z.string().nullable(),
  incident_id: z.string().uuid().nullable(),
  status: NotificationStatus,
  queued_at: z.string(),
  sent_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** Unread = anything not yet READ (this is exactly the gateway's own snapshot filter). */
export const isUnread = (n: Pick<Notification, 'status'>): boolean => n.status !== 'READ' && n.status !== 'FAILED' && n.status !== 'SUPPRESSED';

/**
 * The deep-link payload inside `payload`. The backend does not normalise this (S-04 remains open):
 * the app accepts `{ entity, id }` and validates the id as a UUID before navigating.
 */
export const NotificationDeepLinkSchema = z.object({
  entity: z.string(),
  id: z.string().uuid().optional(),
});