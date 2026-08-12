// packages/shared/src/types/db.ts
// GENERATED FILE — do not edit by hand.
// Source: the applied DDL in db/schema (00-overview.md §5, 06 §7).
// Regenerate with:  npm run db:types      Verify with:  npm run db:types:check

/* eslint-disable */

// ---------------------------------------------------------------- enums
export type AccidentMediaSlot =
  | "FRONT_DAMAGE"
  | "REAR_DAMAGE"
  | "SIDE_DAMAGE"
  | "OTHER_VEHICLE_PLATE"
  | "WITNESS"
  | "ADDITIONAL"
  | "POLICE_ABSTRACT"
  | "INSURANCE_DOCUMENT";

export type AccidentStatus =
  | "PENDING"
  | "INVESTIGATING"
  | "RESOLVED"
  | "CLOSED";

export type AnomalySeverity =
  | "INFO"
  | "WARNING"
  | "CRITICAL";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export type AssetStatus =
  | "AVAILABLE"
  | "IN_USE"
  | "UNDER_MAINTENANCE"
  | "QUARANTINED"
  | "EXTERNAL"
  | "RETIRED";

export type AssignmentStatus =
  | "PLANNED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "OVERRIDE"
  | "VERIFY"
  | "FLAG"
  | "UNLOCK_FOR_CORRECTION"
  | "QUARANTINE"
  | "LIFT_QUARANTINE"
  | "EXPORT"
  | "CONFIG_CHANGE"
  | "DEVICE_REVOKE"
  | "RECOVERY_MODE_ENABLE"
  | "RECOVERY_MODE_DISABLE"
  | "TENANT_CREATE"
  | "MEMBERSHIP_GRANT"
  | "MEMBERSHIP_REVOKE"
  | "INVITATION_CREATE"
  | "SCOPE_ASSIGN";

export type ConsentType =
  | "GPS_TRACKING_WORKING_HOURS"
  | "PHONE_GPS_FALLBACK"
  | "DATA_PROCESSING_NOTICE";

export type ConsumptionMethod =
  | "FULL_TO_FULL"
  | "GAUGE_ESTIMATE";

export type DistanceSource =
  | "ODOMETER"
  | "GPS_AGGREGATE"
  | "UNAVAILABLE";

export type DocumentType =
  | "INSURANCE"
  | "ROAD_TAX"
  | "FITNESS_CERTIFICATE"
  | "SPEED_GOVERNOR_CERTIFICATE"
  | "DRIVING_LICENCE"
  | "MEDICAL_CERTIFICATE"
  | "PSV_BADGE"
  | "REPAIR_COMPLETION"
  | "OTHER";

export type DriverStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "ON_LEAVE"
  | "TERMINATED";

export type TrainingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EXPIRED";

export type BackgroundCheckStatus =
  | "NOT_SUBMITTED"
  | "SUBMITTED"
  | "CLEARED"
  | "FLAGGED"
  | "EXPIRED";

export type DutySegmentSource =
  | "TELEMETRY_INFERRED"
  | "DRIVER_DECLARED"
  | "ADMIN_CORRECTED"
  | "SYSTEM";

export type DutyStatus =
  | "OFF_DUTY"
  | "ON_DUTY_NOT_DRIVING"
  | "DRIVING"
  | "BREAK";

export type ExpenseCategory =
  | "TOLL"
  | "PARKING"
  | "REPAIR"
  | "OTHER";

export type FuelAnomalyType =
  | "POSSIBLE_THEFT_OR_LEAK"
  | "CARD_MISMATCH"
  | "EXPIRED_CARD"
  | "EFFICIENCY_DEVIATION"
  | "ODOMETER_ROLLBACK"
  | "ODOMETER_DIVERGENCE"
  | "GAUGE_OBD_DIVERGENCE"
  | "DUPLICATE_PURCHASE"
  | "PRICE_OUTLIER"
  | "MISSING_GAUGE_EVIDENCE";

export type FuelGaugeLevel =
  | "EMPTY"
  | "QUARTER"
  | "HALF"
  | "THREE_QUARTER"
  | "FULL";

export type FuelRecordPurpose =
  | "SHIFT_START"
  | "SHIFT_END"
  | "REFUEL_BEFORE"
  | "REFUEL_AFTER"
  | "SPOT_CHECK";

export type GeofenceKind =
  | "YARD"
  | "CUSTOMER_SITE"
  | "RESTRICTED_ZONE";

export type HosViolationType =
  | "DAILY_DRIVING_LIMIT"
  | "CONTINUOUS_DRIVING_WITHOUT_BREAK"
  | "DAILY_REST_INSUFFICIENT"
  | "WEEKLY_REST_INSUFFICIENT"
  | "DUTY_PERIOD_EXCEEDED";

export type InspectionInputType =
  | "PASS_FAIL"
  | "NUMERIC";

export type InspectionItemResult =
  | "PASS"
  | "FAIL"
  | "NOT_APPLICABLE";

export type InspectionSeverity =
  | "BLOCKER"
  | "WARNING";

export type InspectionSubject =
  | "VEHICLE"
  | "TRAILER"
  | "TRAILER_SWAP";

export type MaintenanceScheduleStatus =
  | "OK"
  | "DUE_SOON"
  | "OVERDUE";

export type MaintenanceTriggerType =
  | "ODOMETER"
  | "TIME"
  | "ENGINE_HOURS";

export type MediaOwnerKind =
  | "WORK_LOG"
  | "INSPECTION_ITEM"
  | "FUEL_RECORD"
  | "FUEL_PURCHASE"
  | "EXPENSE"
  | "ACCIDENT_REPORT"
  | "ASSET_DOCUMENT"
  | "TRAILER_ASSIGNMENT"
  | "MAINTENANCE_RECORD"
  | "QUARANTINE_EVENT"
  | "STATEMENT_IMPORT";

export type NotificationChannel =
  | "PUSH"
  | "SMS"
  | "EMAIL"
  | "IN_APP";

export type NotificationPriority =
  | "LOW"
  | "NORMAL"
  | "HIGH"
  | "CRITICAL";

export type NotificationStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "SUPPRESSED_DND";

export type OcrStatus =
  | "PENDING"
  | "SUCCEEDED_VISION"
  | "SUCCEEDED_TESSERACT"
  | "FAILED"
  | "SKIPPED";

export type OwnershipType =
  | "OWNED"
  | "LEASED"
  | "SUBCONTRACTOR";

export type MediaQuarantineStatus =
  | "quarantine"
  | "clean"
  | "quarantined_virus";

export type QuarantineReason =
  | "ACCIDENT"
  | "FAILED_INSPECTION"
  | "MAINTENANCE_OVERDUE"
  | "DOCUMENT_EXPIRED"
  | "MANUAL";

export type PrivacyRequestType =
  | "EXPORT"
  | "DELETION";

export type PrivacyRequestStatus =
  | "PENDING"
  | "PROCESSING"
  | "READY"
  | "DOWNLOADED"
  | "COMPLETED"
  | "FAILED";

export type ReconciliationMatchStatus =
  | "UNMATCHED"
  | "MATCHED"
  | "AMBIGUOUS"
  | "MANUALLY_MATCHED"
  | "DISPUTED";

export type RetentionClass =
  | "WORK_PLAN"
  | "INSPECTION"
  | "FUEL_RECEIPT"
  | "FUEL_DASHBOARD"
  | "EXPENSE_RECEIPT"
  | "ACCIDENT"
  | "ASSET_DOCUMENT"
  | "MAINTENANCE"
  | "STATEMENT_IMPORT"
  | "TRAILER_SWAP";

export type RoleCode =
  | "DRIVER"
  | "DISPATCHER"
  | "FLEET_MANAGER"
  | "ADMIN"
  | "FINANCE"
  | "AUDITOR"
  | "SYSTEM_ADMIN";

/** app.tenant_status (14_tenancy.sql). */
export type TenantStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "TRIAL"
  | "EXPIRED";

/** app.subscription_tier (14_tenancy.sql). */
export type SubscriptionTier =
  | "BASIC"
  | "PROFESSIONAL"
  | "ENTERPRISE";

export type ShiftEventSource =
  | "DRIVER"
  | "ADMIN_OVERRIDE"
  | "AUTO_GEOFENCE"
  | "SYSTEM_VEHICLE_SWAP";

export type ShiftState =
  | "OPEN"
  | "PENDING_CLOSEOUT"
  | "CLOSED";

export type ShiftVerificationStatus =
  | "PENDING"
  | "VERIFIED"
  | "FLAGGED";

export type StatementSource =
  | "TYPED"
  | "VOICE_TO_TEXT"
  | "NOT_PROVIDED";

export type TrackerReliability =
  | "FULL"
  | "PARTIAL"
  | "NONE";

export type TrailerType =
  | "DRY_VAN"
  | "REEFER"
  | "FLATBED"
  | "LOWBOY"
  | "TANKER"
  | "CURTAIN_SIDE"
  | "OTHER";

export type VehicleClass =
  | "TRACTOR"
  | "RIGID"
  | "VAN"
  | "PICKUP";

export type VehicleDisplayState =
  | "QUARANTINED"
  | "OFFLINE"
  | "HOS_ALERT"
  | "SPEEDING"
  | "MOVING"
  | "IDLING"
  | "PARKED";

export type VehicleIssueCategory =
  | "MECHANICAL"
  | "ELECTRICAL"
  | "TYRE"
  | "BODY"
  | "OTHER";

export type VehicleIssueSeverity =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

export type VehicleIssueStatus =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "RESOLVED"
  | "DISMISSED";

// ------------------------------------------------- permission codes (N4)
// Generated from app.permissions so a missing grant is a compile error (02 §5).
export type PermissionCode =
  | "accident:acknowledge"
  | "accident:close"
  | "accident:read"
  | "accident:report"
  | "accident:update"
  | "asset:create"
  | "asset:lift_quarantine"
  | "asset:quarantine"
  | "asset:read"
  | "asset:update"
  | "assignment:create"
  | "assignment:read"
  | "assignment:update"
  | "audit:read"
  | "config:manage"
  | "config:read"
  | "device:revoke"
  | "document:manage"
  | "document:read"
  | "expense:approve"
  | "expense:read"
  | "expense:submit"
  | "fuel:adjust"
  | "fuel:card_manage"
  | "fuel:clear_payment"
  | "fuel:read"
  | "fuel:reconcile"
  | "fuel:record_gauge"
  | "fuel:submit_purchase"
  | "fuel:verify"
  | "geofence:manage"
  | "geofence:read"
  | "hos:override"
  | "hos:read"
  | "inspection:read"
  | "inspection:submit"
  | "inspection:template_manage"
  | "maintenance:manage"
  | "maintenance:read"
  | "maintenance:record"
  | "manage_own_mfa"
  | "revoke_device"
  | "notification:manage"
  | "payroll:export"
  | "recovery:manage"
  | "report:export"
  | "report:read"
  | "role:manage"
  | "shift:clock_in"
  | "shift:clock_out"
  | "shift:flag"
  | "shift:force_close"
  | "shift:read_all"
  | "shift:read_own"
  | "shift:unlock"
  | "shift:verify"
  | "telemetry:read_history"
  | "telemetry:read_live"
  | "trailer:swap"
  | "user:manage"
  | "user:read"
  | "anomaly:read"
  | "notification:read"
  | "training:read"
  | "training:manage"
  | "training:complete"
  | "training:review"
   | "onboarding:read"
   | "onboarding:submit"
   | "onboarding:review"
   | "vehicle:report"
   | "privacy:request_own"
   | "privacy:view_requests_tenant";

export const PERMISSION_CODES: readonly PermissionCode[] = [
  "accident:acknowledge",
  "accident:close",
  "accident:read",
  "accident:report",
  "accident:update",
  "asset:create",
  "asset:lift_quarantine",
  "asset:quarantine",
  "asset:read",
  "asset:update",
  "assignment:create",
  "assignment:read",
  "assignment:update",
  "audit:read",
  "config:manage",
  "config:read",
  "device:revoke",
  "document:manage",
  "document:read",
  "expense:approve",
  "expense:read",
  "expense:submit",
  "fuel:adjust",
  "fuel:card_manage",
  "fuel:clear_payment",
  "fuel:read",
  "fuel:reconcile",
  "fuel:record_gauge",
  "fuel:submit_purchase",
  "fuel:verify",
  "geofence:manage",
  "geofence:read",
  "hos:override",
  "hos:read",
  "inspection:read",
  "inspection:submit",
  "inspection:template_manage",
  "maintenance:manage",
  "maintenance:read",
  "maintenance:record",
  "manage_own_mfa",
  "revoke_device",
  "notification:manage",
  "payroll:export",
  "recovery:manage",
  "report:export",
  "report:read",
  "role:manage",
  "shift:clock_in",
  "shift:clock_out",
  "shift:flag",
  "shift:force_close",
  "shift:read_all",
  "shift:read_own",
  "shift:unlock",
  "shift:verify",
  "telemetry:read_history",
  "telemetry:read_live",
  "trailer:swap",
  "user:manage",
  "user:read",
  "anomaly:read",
  "notification:read",
  "training:read",
  "training:manage",
  "training:complete",
  "training:review",
   "onboarding:read",
   "onboarding:submit",
   "onboarding:review",
   "vehicle:report",
   "privacy:request_own",
   "privacy:view_requests_tenant",
] as const;

// ----------------------------------------------------------- row types
/** app.accident_media */
export interface AccidentMediaRow {
  tenant_id: string;
  id: string;
  report_id: string;
  slot: AccidentMediaSlot;
  media_object_id: string;
  uploaded_by: string | null;
  uploaded_at: string;
  sha256: Buffer | null;
}

/** app.accident_reports */
export interface AccidentReportRow {
  tenant_id: string;
  id: string;
  shift_id: string | null;
  driver_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  reported_at: string;
  occurred_at: string | null;
  is_mayday: boolean;
  mayday_reason: string | null;
  was_off_shift: boolean;
  reported_position: string | null;
  reported_latitude: string | null;
  reported_longitude: string | null;
  position_source: string | null;
  driver_statement: string | null;
  statement_source: StatementSource;
  witness_name: string | null;
  witness_phone: string | null;
  third_party_name: string | null;
  third_party_phone: string | null;
  third_party_plate: string | null;
  third_party_insurer: string | null;
  police_ob_number: string | null;
  insurance_claim_number: string | null;
  status: AccidentStatus;
  telemetry_available: boolean;
  telemetry_frozen_at: string | null;
  telemetry_point_count: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  escalated_at: string | null;
  escalated_to: string | null;
  investigating_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  resolution_notes: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

/** app.accident_telemetry */
export interface AccidentTelemetryRow {
  id: string;
  report_id: string;
  sequence: number;
  recorded_at: string;
  latitude: string;
  longitude: string;
  position: string;
  speed_kph: string | null;
  heading_deg: string | null;
  ignition: boolean | null;
  obd_attributes: unknown;
  source_location_id: string | null;
  frozen_at: string;
  prev_hash: Buffer | null;
  row_hash: Buffer;
}

/** app.asset_documents */
export interface AssetDocumentRow {
  tenant_id: string;
  id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  document_type: DocumentType;
  document_number: string | null;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  media_object_id: string | null;
  is_blocking: boolean;
  superseded_by_id: string | null;
  uploaded_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.assignments */
export interface AssignmentRow {
  tenant_id: string;
  id: string;
  assigned_date: string;
  driver_id: string;
  vehicle_id: string;
  trailer_id: string | null;
  status: AssignmentStatus;
  notes: string | null;
  created_by: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** app.driver_devices */
export interface DriverDeviceRow {
  id: string;
  user_id: string;
  device_id_hash: string;
  device_label: string | null;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  push_token: string | null;
  push_provider: string;
  push_token_updated_at: string | null;
  biometric_enrolled: boolean;
  pin_set_at: string | null;
  refresh_token_hash: string | null;
  refresh_token_expires_at: string | null;
  offline_window_expires_at: string | null;
  offline_pin_failures: number;
  offline_locked_until: string | null;
  last_seen_online_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** app.driver_duty_segments */
export interface DriverDutySegmentRow {
  tenant_id: string;
  id: string;
  driver_id: string;
  shift_id: string | null;
  vehicle_id: string | null;
  status: DutyStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  source: DutySegmentSource;
  is_inferred: boolean;
  confirmed_by_driver_at: string | null;
  reclassified_from: DutyStatus | null;
  corrected_by: string | null;
  corrected_at: string | null;
  notes: string | null;
  created_at: string;
}

/** app.driver_hos_state */
export interface DriverHosStateRow {
  tenant_id: string;
  driver_id: string;
  policy_id: string;
  driving_seconds_today: number;
  duty_seconds_today: number;
  driving_seconds_since_break: number;
  last_break_ended_at: string | null;
  last_off_duty_started_at: string | null;
  last_off_duty_seconds: number | null;
  weekly_rest_satisfied: boolean;
  weekly_rest_last_completed_at: string | null;
  next_eligible_clock_in_at: string | null;
  block_reason: HosViolationType | null;
  warning_sent_at: string | null;
  limit_reached_at: string | null;
  computed_at: string;
  computed_through: string;
}

/** app.driver_onboarding */
export interface DriverOnboardingRow {
  id: string;
  driver_id: string;
  full_name: string | null;
  licence_number: string | null;
  licence_class: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address_json: unknown | null;
  ssn_encrypted: string | null;
  dob: string | null;
  previous_addresses_json: unknown | null;
  background_check_status: BackgroundCheckStatus;
  background_check_submitted_at: string | null;
  background_check_cleared_at: string | null;
  consent_given: boolean;
  consent_at: string | null;
  assigned_vehicle_id: string | null;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.drivers */
export interface DriverRow {
  tenant_id: string;
  id: string;
  user_id: string;
  employee_number: string | null;
  licence_number: string;
  licence_class: string | null;
  licence_expiry: string | null;
  medical_certificate_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  hos_policy_id: string | null;
  hos_override_reason: string | null;
  hos_override_by: string | null;
  hos_override_at: string | null;
  status: DriverStatus;
  status_changed_at: string;
  hired_on: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.escalation_timers */
export interface EscalationTimerRow {
  tenant_id: string;
  id: string;
  incident_kind: string;
  incident_id: string;
  tier: number;
  fires_at: string;
  fired_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
}

/** app.expenses */
export interface ExpenseRow {
  tenant_id: string;
  id: string;
  shift_id: string | null;
  vehicle_id: string;
  driver_id: string;
  category: ExpenseCategory;
  amount: string;
  currency: string;
  incurred_at: string;
  supplier_name: string | null;
  notes: string | null;
  receipt_media_object_id: string;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  high_value_alert_sent_at: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

/** app.fuel_card_statement_lines */
export interface FuelCardStatementLineRow {
  tenant_id: string;
  id: string;
  statement_id: string;
  line_number: number;
  transaction_at: string;
  card_last_four: string;
  amount: string;
  currency: string;
  litres: string | null;
  station_name: string | null;
  raw_row: unknown;
  match_status: ReconciliationMatchStatus;
  matched_purchase_id: string | null;
  matched_by: string | null;
  matched_at: string | null;
  match_notes: string | null;
}

/** app.fuel_card_statements */
export interface FuelCardStatementRow {
  tenant_id: string;
  id: string;
  provider: string;
  period_start: string;
  period_end: string;
  media_object_id: string;
  column_mapping: unknown;
  row_count: number;
  matched_count: number;
  unmatched_count: number;
  uploaded_by: string;
  uploaded_at: string;
  processed_at: string | null;
}

/** app.fuel_cards */
export interface FuelCardRow {
  tenant_id: string;
  id: string;
  label: string;
  last_four: string;
  provider: string;
  is_pooled: boolean;
  assigned_vehicle_id: string | null;
  credit_limit: string | null;
  currency: string;
  expires_on: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.fuel_efficiency_records */
export interface FuelEfficiencyRecordRow {
  tenant_id: string;
  id: string;
  shift_id: string;
  vehicle_id: string;
  distance_km: string;
  litres_consumed: string;
  method: ConsumptionMethod;
  is_approximate: boolean;
  l_per_100km: string | null;
  baseline_l_per_100km: string | null;
  baseline_scope: string | null;
  deviation_percent: string | null;
  fuel_cost: string | null;
  currency: string;
  cost_per_km: string | null;
  computed_at: string;
}

/** app.fuel_purchase_anomalies */
export interface FuelPurchaseAnomalyRow {
  tenant_id: string;
  id: string;
  fuel_purchase_id: string | null;
  shift_id: string | null;
  vehicle_id: string;
  driver_id: string | null;
  anomaly_type: FuelAnomalyType;
  severity: AnomalySeverity;
  expected_value: string | null;
  actual_value: string | null;
  deviation_percent: string | null;
  threshold_percent: string | null;
  detail: unknown;
  detected_at: string;
  detected_by: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_action: string | null;
  resolution_notes: string | null;
}

/** app.fuel_purchases */
export interface FuelPurchaseRow {
  tenant_id: string;
  id: string;
  shift_id: string | null;
  vehicle_id: string;
  driver_id: string | null;
  entry_source: string;
  fuel_card_id: string | null;
  fuel_card_last_four: string;
  supplier_name: string | null;
  litres: string;
  total_cost: string;
  currency: string;
  unit_price: string | null;
  odometer_km: number;
  purchased_at: string;
  receipt_media_object_id: string;
  before_fuel_record_id: string | null;
  after_fuel_record_id: string | null;
  ocr_status: OcrStatus;
  ocr_litres: string | null;
  ocr_total_cost: string | null;
  ocr_confidence: string | null;
  ocr_raw: unknown | null;
  ocr_processed_at: string | null;
  admin_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  adjustments: unknown;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  cleared_for_payment_at: string | null;
  cleared_by: string | null;
  client_uuid: string | null;
  created_at: string;
  updated_at: string;
}

/** app.fuel_records */
export interface FuelRecordRow {
  tenant_id: string;
  id: string;
  shift_id: string;
  vehicle_id: string;
  driver_id: string;
  purpose: FuelRecordPurpose;
  media_object_id: string;
  odometer_km: number;
  gauge_level: FuelGaugeLevel;
  gauge_percent: string | null;
  obd_fuel_level_percent: string | null;
  obd_odometer_km: number | null;
  adjusted_gauge_level: FuelGaugeLevel | null;
  adjusted_odometer_km: number | null;
  adjusted_by: string | null;
  adjusted_at: string | null;
  adjustment_reason: string | null;
  captured_at: string;
  client_uuid: string | null;
  created_at: string;
}

/** app.geofences */
export interface GeofenceRow {
  tenant_id: string;
  id: string;
  name: string;
  kind: GeofenceKind;
  boundary: string;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.hos_policies */
export interface HosPolicyRow {
  id: string;
  name: string;
  is_default: boolean;
  max_driving_seconds_per_day: number;
  max_duty_seconds_per_shift: number;
  duty_warning_seconds: number;
  continuous_driving_before_break_seconds: number;
  min_break_seconds: number;
  min_daily_rest_seconds: number;
  min_weekly_rest_seconds: number;
  weekly_window_days: number;
  warning_lead_seconds: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** app.hos_violations */
export interface HosViolationRow {
  tenant_id: string;
  id: string;
  driver_id: string;
  shift_id: string | null;
  policy_id: string;
  violation_type: HosViolationType;
  threshold_seconds: number;
  actual_seconds: number;
  occurred_at: string;
  detected_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  notes: string | null;
}

/** app.idempotency_keys */
export interface IdempotencyKeyRow {
  user_id: string;
  idempotency_key: string;
  endpoint: string;
  request_hash: string;
  state: string;
  response_status: number | null;
  response_body: unknown | null;
  resource_id: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
}

/** app.inspection_item_photos */
export interface InspectionItemPhotoRow {
  id: string;
  inspection_item_id: string;
  media_object_id: string;
  created_at: string;
}

/** app.inspection_items */
export interface InspectionItemRow {
  id: string;
  inspection_id: string;
  template_item_id: string;
  item_code: string;
  label_snapshot: string;
  severity_snapshot: InspectionSeverity;
  result: InspectionItemResult;
  numeric_value: string | null;
  notes: string | null;
}

/** app.inspection_template_items */
export interface InspectionTemplateItemRow {
  id: string;
  template_id: string;
  code: string;
  label_en: string;
  label_sw: string;
  severity: InspectionSeverity;
  input_type: InspectionInputType;
  unit: string | null;
  min_value: string | null;
  max_value: string | null;
  is_required: boolean;
  sequence: number;
}

/** app.inspection_templates */
export interface InspectionTemplateRow {
  id: string;
  code: string;
  name: string;
  subject: InspectionSubject;
  vehicle_class: VehicleClass | null;
  trailer_type: TrailerType | null;
  version: number;
  is_active: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** app.inspections */
export interface InspectionRow {
  tenant_id: string;
  id: string;
  shift_id: string;
  template_id: string;
  template_version: number;
  subject: InspectionSubject;
  vehicle_id: string | null;
  trailer_id: string | null;
  performed_by_driver_id: string;
  performed_at: string;
  has_blocking_failure: boolean;
  has_warning_failure: boolean;
  previous_defects_reviewed: boolean;
  signature_name: string;
  signed_at: string;
  client_uuid: string | null;
  created_at: string;
}

/** app.maintenance_records */
export interface MaintenanceRecordRow {
  tenant_id: string;
  id: string;
  schedule_id: string | null;
  task_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  performed_at: string;
  odometer_km: number | null;
  engine_hours: string | null;
  vendor: string | null;
  cost: string | null;
  currency: string;
  parts_used: string | null;
  downtime_days: string | null;
  invoice_media_object_id: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

/** app.maintenance_schedules */
export interface MaintenanceScheduleRow {
  tenant_id: string;
  id: string;
  task_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  last_performed_at: string | null;
  last_performed_odometer_km: number | null;
  last_performed_engine_hours: string | null;
  next_due_odometer_km: number | null;
  next_due_on: string | null;
  next_due_engine_hours: string | null;
  status: MaintenanceScheduleStatus;
  overdue_by_km: number | null;
  overdue_by_days: number | null;
  alert_sent_at: string | null;
  evaluated_at: string;
}

/** app.training_courses */
export interface TrainingCourseRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  is_mandatory: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.training_lessons */
export interface TrainingLessonRow {
  id: string;
  course_id: string;
  code: string;
  title: string;
  description: string | null;
  content_url: string | null;
  duration_minutes: number | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.training_enrollments */
export interface TrainingEnrollmentRow {
  id: string;
  driver_id: string;
  lesson_id: string;
  status: TrainingStatus;
  completed_at: string | null;
  quiz_score: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.maintenance_tasks */
export interface MaintenanceTaskRow {
  id: string;
  code: string;
  name: string;
  applies_to: string;
  vehicle_class: VehicleClass | null;
  trailer_type: TrailerType | null;
  trigger_type: MaintenanceTriggerType;
  interval_km: number | null;
  interval_days: number | null;
  interval_engine_hours: string | null;
  auto_quarantine_enabled: boolean;
  auto_quarantine_overdue_km: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** app.media_objects */
export interface MediaObjectRow {
  tenant_id: string;
  id: string;
  bucket: string;
  object_key: string;
  content_type: string;
  size_bytes: string | null;
  sha256: Buffer | null;
  retention_class: RetentionClass;
  retain_until: string;
  legal_hold: boolean;
  object_lock_applied: boolean;
  owner_kind: MediaOwnerKind;
  owner_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  client_captured_at: string | null;
  exif_stripped: boolean;
  width_px: number | null;
  height_px: number | null;
  checksum_verified_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
}

/** app.mfa_recovery_codes */
export interface MfaRecoveryCodeRow {
  id: string;
  user_id: string;
  code_hash: string;
  used_at: string | null;
  created_at: string;
}

/** app.notification_templates */
export interface NotificationTemplateRow {
  code: string;
  description: string;
  default_priority: NotificationPriority;
  default_channels: NotificationChannel[];
  title_en: string;
  body_en: string;
  title_sw: string | null;
  body_sw: string | null;
  breaks_quiet_hours: boolean;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** app.notifications */
export interface NotificationRow {
  tenant_id: string;
  id: string;
  template_code: string | null;
  recipient_user_id: string | null;
  recipient_address: string | null;
  channel: NotificationChannel;
  priority: NotificationPriority;
  locale: string;
  title: string;
  body: string;
  payload: unknown;
  incident_kind: string | null;
  incident_id: string | null;
  dedupe_key: string | null;
  status: NotificationStatus;
  attempts: number;
  provider: string | null;
  provider_message_id: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  suppressed_reason: string | null;
}

/** app.on_call_roster */
export interface OnCallRosterRow {
  tenant_id: string;
  id: string;
  user_id: string;
  incident_kind: string;
  escalation_tier: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

/** app.outbox_events */
export interface OutboxEventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  priority: NotificationPriority;
  occurred_at: string;
  available_at: string;
  published_at: string | null;
  attempts: number;
  last_error: string | null;
  dead_lettered_at: string | null;
}

/** app.payroll_exports */
export interface PayrollExportRow {
  tenant_id: string;
  id: string;
  period_start: string;
  period_end: string;
  media_object_id: string | null;
  row_count: number;
  included_shift_ids: string[];
  sha256: Buffer | null;
  generated_by: string;
  generated_at: string;
}

/** app.permissions */
export interface PermissionRow {
  code: string;
  description: string;
  phase: number;
}

/** app.privacy_requests (15_privacy_requests.sql) */
export interface PrivacyRequestRow {
  tenant_id: string;
  id: string;
  user_id: string;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  created_at: string;
  completed_at: string | null;
  download_token: string | null;
  file_key: string | null;
  file_size_bytes: string | null;
  notes: string | null;
}

/** app.quarantine_events */
export interface QuarantineEventRow {
  tenant_id: string;
  id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  reason: QuarantineReason;
  reason_notes: string | null;
  source_accident_id: string | null;
  source_inspection_id: string | null;
  source_schedule_id: string | null;
  triggered_by_system: boolean;
  triggered_by_user_id: string | null;
  quarantined_at: string;
  requires_repair_document: boolean;
  lift_document_media_object_id: string | null;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_reason: string | null;
}

/** app.recovery_modes */
export interface RecoveryModeRow {
  tenant_id: string;
  id: string;
  vehicle_id: string;
  reason: string;
  enabled_by: string;
  enabled_at: string;
  expires_at: string;
  disabled_by: string | null;
  disabled_at: string | null;
}

/** app.role_permissions */
export interface RolePermissionRow {
  role_code: RoleCode;
  permission_code: string;
}

/** app.roles */
export interface RoleRow {
  code: RoleCode;
  name: string;
  description: string;
  requires_mfa: boolean;
  created_at: string;
}

/** app.shifts */
export interface ShiftRow {
  tenant_id: string;
  id: string;
  driver_id: string;
  vehicle_id: string;
  assigned_trailer_id: string | null;
  assignment_id: string | null;
  clock_in_at: string;
  clock_in_source: ShiftEventSource;
  clock_out_at: string | null;
  clock_out_source: ShiftEventSource | null;
  clock_out_by: string | null;
  operational_date: string | null;
  start_odometer_km: number;
  end_odometer_km: number | null;
  start_fuel_gauge: FuelGaugeLevel | null;
  end_fuel_gauge: FuelGaugeLevel | null;
  shift_duration_seconds: number | null;
  driving_duration_seconds: number | null;
  idle_duration_seconds: number | null;
  total_distance_km: string | null;
  distance_source: DistanceSource;
  tracker_reliability: TrackerReliability;
  excluded_gap_seconds: number;
  started_with_tracker_offline: boolean;
  phone_gps_fallback_enabled: boolean;
  state: ShiftState;
  closeout_missing: unknown;
  is_overrun: boolean;
  overrun_warned_at: string | null;
  overrun_at: string | null;
  verification_status: ShiftVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  flag_reason: string | null;
  locked_at: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
  unlock_count: number;
  corrected_at: string | null;
  corrected_by: string | null;
  correction_reason: string | null;
  previous_shift_id: string | null;
  client_uuid: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** app.system_config */
export interface SystemConfigRow {
  key: string;
  value: unknown;
  value_type: string;
  description: string;
  min_value: string | null;
  max_value: string | null;
  unit: string | null;
  is_sensitive: boolean;
  phase: number;
  updated_by: string | null;
  updated_at: string;
}

/** app.tracker_health */
export interface TrackerHealthRow {
  tenant_id: string;
  vehicle_id: string;
  traccar_device_id: number | null;
  last_position_at: string | null;
  last_heartbeat_at: string | null;
  last_ignition: boolean | null;
  last_speed_kph: string | null;
  last_position: string | null;
  is_online: boolean;
  offline_since: string | null;
  consecutive_missed_windows: number;
  offline_alert_sent_at: string | null;
  updated_at: string;
}

/** app.trailer_assignments */
export interface TrailerAssignmentRow {
  tenant_id: string;
  id: string;
  trailer_id: string;
  vehicle_id: string;
  shift_id: string | null;
  assigned_at: string;
  assigned_by_driver_id: string | null;
  hook_media_object_id: string | null;
  hook_inspection_id: string | null;
  unassigned_at: string | null;
  unassigned_by_driver_id: string | null;
  drop_media_object_id: string | null;
  drop_location: string | null;
  is_active: boolean | null;
  created_at: string;
}

/** app.trailer_last_known_location */
export interface TrailerLastKnownLocationRow {
  tenant_id: string;
  trailer_id: string;
  via_vehicle_id: string | null;
  position: string;
  recorded_at: string;
  address_cached: string | null;
  address_cached_at: string | null;
  updated_at: string;
}

/** app.trailers */
export interface TrailerRow {
  tenant_id: string;
  id: string;
  license_plate: string;
  trailer_type: TrailerType;
  length_ft: string | null;
  capacity_weight_kg: number | null;
  ownership_type: OwnershipType;
  has_gps_tracker: boolean;
  tracker_imei: string | null;
  traccar_device_id: number | null;
  status: AssetStatus;
  is_operational: boolean;
  non_operational_reason: string | null;
  current_vehicle_id: string | null;
  reefer_target_temp_min_c: string | null;
  reefer_target_temp_max_c: string | null;
  is_external: boolean;
  created_by_driver_id: string | null;
  merged_into_trailer_id: string | null;
  merged_at: string | null;
  merged_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.user_consents */
export interface UserConsentRow {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  policy_version: string;
  accepted_at: string;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_id_hash: string | null;
}

/** app.user_roles */
export interface UserRoleRow {
  user_id: string;
  role_code: RoleCode;
  granted_by: string | null;
  granted_at: string;
}

/** app.user_sessions */
export interface UserSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  ip_address: string | null;
  user_agent: string | null;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_seen_at: string;
}

/** app.users */
export interface UserRow {
  id: string;
  email: string | null;
  password_hash: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
  mfa_enabled: boolean;
  mfa_secret_encrypted: Buffer | null;
  mfa_enrolled_at: string | null;
  dnd_start_local: string | null;
  dnd_end_local: string | null;
  locale: string;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  password_changed_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.v_dispatchable_trailers */
export interface DispatchableTrailersViewRow {
  id: string | null;
  license_plate: string | null;
  trailer_type: TrailerType | null;
  length_ft: string | null;
  capacity_weight_kg: number | null;
  reefer_target_temp_min_c: string | null;
  reefer_target_temp_max_c: string | null;
}

/** app.v_dispatchable_vehicles */
export interface DispatchableVehiclesViewRow {
  id: string | null;
  license_plate: string | null;
  vehicle_class: VehicleClass | null;
  make: string | null;
  model: string | null;
  fuel_tank_capacity_litres: string | null;
  current_odometer_km: number | null;
  home_geofence_id: string | null;
  tracker_imei: string | null;
  tracker_online: boolean | null;
}

/** app.v_driver_hos_summary */
export interface DriverHosSummaryViewRow {
  driver_id: string | null;
  driver_name: string | null;
  driver_status: DriverStatus | null;
  policy_name: string | null;
  max_driving_seconds_per_day: number | null;
  continuous_driving_before_break_seconds: number | null;
  min_break_seconds: number | null;
  driving_seconds_today: number | null;
  duty_seconds_today: number | null;
  driving_seconds_since_break: number | null;
  last_break_ended_at: string | null;
  next_eligible_clock_in_at: string | null;
  block_reason: HosViolationType | null;
  weekly_rest_satisfied: boolean | null;
  is_rest_blocked: boolean | null;
  driving_seconds_remaining: number | null;
  computed_at: string | null;
}

/** app.v_fuel_reconciliation_inbox */
export interface FuelReconciliationInboxViewRow {
  fuel_purchase_id: string | null;
  purchased_at: string | null;
  entry_source: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  fuel_tank_capacity_litres: string | null;
  driver_name: string | null;
  litres: string | null;
  total_cost: string | null;
  currency: string;
  unit_price: string | null;
  odometer_km: number | null;
  fuel_card_last_four: string | null;
  fuel_card_label: string | null;
  fuel_card_pooled: boolean | null;
  fuel_card_expires_on: string | null;
  receipt_media_object_id: string | null;
  ocr_status: OcrStatus | null;
  ocr_litres: string | null;
  ocr_total_cost: string | null;
  ocr_confidence: string | null;
  gauge_before_percent: string | null;
  gauge_after_percent: string | null;
  gauge_delta_percent: string | null;
  expected_gauge_rise_percent: string | null;
  admin_verified: boolean | null;
  rejected_at: string | null;
  cleared_for_payment_at: string | null;
  open_anomalies: string | null;
  worst_open_severity: string | null;
}

/** app.v_monthly_fuel_report */
export interface MonthlyFuelReportViewRow {
  vehicle_id: string | null;
  license_plate: string | null;
  month_start: string | null;
  total_litres_purchased: string | null;
  total_cost: string | null;
  currency: string | null;
  average_cost_per_litre: string | null;
  total_km_driven: string | null;
  average_l_per_100km: string | null;
  cost_per_km: string | null;
  shift_count: string | null;
}

/** app.v_open_anomalies */
export interface OpenAnomaliesViewRow {
  domain: string | null;
  id: string | null;
  severity: string | null;
  kind: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  detected_at: string | null;
  detail: unknown | null;
}

/** app.v_payroll_export */
export interface PayrollExportViewRow {
  driver: string | null;
  employee_number: string | null;
  vehicle: string | null;
  shift_date: string | null;
  total_hours: string | null;
  driving_hours: string | null;
  total_km: string | null;
  verified: boolean | null;
  flagged: boolean | null;
  tracker_reliability: TrackerReliability | null;
  shift_id: string | null;
}

/** app.v_shift_verification_inbox */
export interface ShiftVerificationInboxViewRow {
  shift_id: string | null;
  operational_date: string | null;
  verification_status: ShiftVerificationStatus | null;
  state: ShiftState | null;
  is_overrun: boolean | null;
  tracker_reliability: TrackerReliability | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  trailer_plate: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_out_source: ShiftEventSource | null;
  shift_duration_seconds: number | null;
  driving_duration_seconds: number | null;
  total_distance_km: string | null;
  distance_source: DistanceSource | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  blocking_failures: string | null;
  warning_failures: string | null;
  fuel_purchase_count: string | null;
  open_anomalies: string | null;
  pending_expenses: string | null;
  closeout_missing: unknown | null;
  flag_reason: string | null;
  locked_at: string | null;
}

/** app.v_vehicle_display_state */
export interface VehicleDisplayStateViewRow {
  vehicle_id: string | null;
  license_plate: string | null;
  vehicle_class: VehicleClass | null;
  asset_status: AssetStatus | null;
  is_operational: boolean | null;
  shift_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  last_position: string | null;
  latitude: number | null;
  longitude: number | null;
  last_position_at: string | null;
  last_speed_kph: string | null;
  last_ignition: boolean | null;
  is_online: boolean | null;
  next_eligible_clock_in_at: string | null;
  limit_reached_at: string | null;
  warning_sent_at: string | null;
  display_state: VehicleDisplayState | null;
  /** Owning tenant (14_tenancy.sql); used to scope the real-time feed per tenant. */
  tenant_id: string | null;
}

/** app.vehicle_issues */
export interface VehicleIssueRow {
  id: string;
  vehicle_id: string;
  reported_by_driver_id: string;
  shift_id: string | null;
  category: VehicleIssueCategory;
  severity: VehicleIssueSeverity;
  description: string;
  photo_media_object_id: string | null;
  status: VehicleIssueStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.vehicle_movement_events */
export interface VehicleMovementEventRow {
  tenant_id: string;
  id: string;
  vehicle_id: string;
  event_type: string;
  occurred_at: string;
  detected_at: string;
  duration_seconds: number | null;
  alert_sent_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  notes: string | null;
}

/** app.vehicles */
export interface VehicleRow {
  tenant_id: string;
  id: string;
  license_plate: string;
  vehicle_class: VehicleClass;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership_type: OwnershipType;
  fuel_tank_capacity_litres: string;
  current_odometer_km: number;
  current_odometer_at: string | null;
  engine_hours: string | null;
  tracker_imei: string | null;
  traccar_device_id: number | null;
  tracker_provisioned_at: string | null;
  home_geofence_id: string | null;
  status: AssetStatus;
  is_operational: boolean;
  non_operational_reason: string | null;
  current_driver_id: string | null;
  baseline_l_per_100km: string | null;
  baseline_sample_size: number;
  baseline_scope: string;
  baseline_computed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** app.work_log_photos */
export interface WorkLogPhotoRow {
  id: string;
  work_log_id: string;
  media_object_id: string;
  sequence: number;
  created_at: string;
}

/** app.work_logs */
export interface WorkLogRow {
  tenant_id: string;
  id: string;
  shift_id: string;
  planned_notes: string | null;
  debrief_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** audit.audit_logs */
export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role_codes: string[];
  on_behalf_of_driver_id: string | null;
  action: AuditAction;
  entity_schema: string;
  entity_table: string;
  entity_id: string | null;
  old_value: unknown | null;
  new_value: unknown | null;
  changed_fields: string[] | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  endpoint: string | null;
  http_method: string | null;
  http_status: number | null;
}

/** telemetry.location_summaries */
export interface LocationSummaryRow {
  tenant_id: string;
  vehicle_id: string;
  bucket_start: string;
  bucket_seconds: number;
  shift_id: string | null;
  point_count: number;
  avg_speed_kph: string | null;
  max_speed_kph: string | null;
  distance_km: string;
  ignition_on_seconds: number;
  moving_seconds: number;
  idle_seconds: number;
  start_position: string | null;
  end_position: string | null;
  created_at: string;
}

/** telemetry.location_updates */
export interface LocationUpdateRow {
  tenant_id: string;
  id: string;
  vehicle_id: string;
  shift_id: string | null;
  recorded_at: string;
  received_at: string;
  position: string;
  latitude: string;
  longitude: string;
  speed_kph: string | null;
  heading_deg: string | null;
  altitude_m: string | null;
  ignition: boolean | null;
  obd_odometer_km: number | null;
  obd_engine_hours: string | null;
  obd_fuel_level_percent: string | null;
  obd_fault_codes: string[] | null;
  satellites: number | null;
  hdop: string | null;
  is_valid_fix: boolean;
  traccar_position_id: string | null;
  traccar_device_id: number | null;
  attributes: unknown;
  retention_reason: string;
}

// ---------------------------------------------------------------- tenancy (14_tenancy.sql)

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subscription_tier: SubscriptionTier;
  max_vehicles: number;
  max_drivers: number;
  settings: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role_code: RoleCode;
  invited_by: string | null;
  token: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface UserTenantRow {
  user_id: string;
  tenant_id: string;
  is_primary: boolean;
  created_at: string;
}

export interface ManagerAssignmentRow {
  id: string;
  tenant_id: string;
  user_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  assigned_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- password reset (16_password_reset.sql)

export type PasswordResetStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "COMPLETED"
  | "EXPIRED"
  | "REVOKED";

/** app.password_reset_codes */
export interface PasswordResetCodeRow {
  id: string;
  tenant_id: string;
  user_id: string;
  approver_user_id: string | null;
  channel: "email" | "email_sms";
  code_hash: string | null;
  status: PasswordResetStatus;
  requested_at: string;
  expires_at: string;
  approved_by: string | null;
  approved_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
}
