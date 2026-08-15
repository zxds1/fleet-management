/**
 * Domain models — direct TypeScript port of kotlin-app/.../data/Models.kt.
 * Kept 1:1 with the Kotlin enums/data classes so the Expo app mirrors the
 * backend contract (packages/shared schemas) exactly.
 */

export type RoleCode =
  | "DRIVER"
  | "DISPATCHER"
  | "FLEET_MANAGER"
  | "ADMIN"
  | "FINANCE"
  | "AUDITOR"
  | "SYSTEM_ADMIN";

export type ActiveShell = "DRIVER" | "ADMIN";

export interface Principal {
  userId: string;
  tenantId: string;
  email: string;
  phone?: string | null;
  displayName?: string | null;
  roleName?: string | null;
  roles: RoleCode[];
  permissions: Set<string>;
  locale: string;
  sessionId?: string | null;
  deviceIdHash?: string | null;
}

/**
 * Permission codes — mirror the backend's actual `app.role_permissions` union
 * (packages/api .../middleware/requirePermission). Kept 1:1 so the Expo client's
 * permission gating matches what the server enforces.
 */
export const Permission = {
  SHIFT_CLOCK_IN: "shift:clock_in",
  SHIFT_CLOCK_OUT: "shift:clock_out",
  SHIFT_READ_OWN: "shift:read_own",
  SHIFT_READ_ALL: "shift:read_all",
  SHIFT_VERIFY: "shift:verify",
  SHIFT_FORCE_CLOSE: "shift:force_close",

  FUEL_ENTER: "fuel:enter",
  FUEL_SUBMIT_PURCHASE: "fuel:submit_purchase",
  FUEL_READ: "fuel:read",
  FUEL_VERIFY: "fuel:verify",
  FUEL_RECONCILE: "fuel:reconcile",
  FUEL_CARD_MANAGE: "fuel:card_manage",
  FUEL_ADJUST: "fuel:adjust",

  INSPECTION_SUBMIT: "inspection:submit",
  INSPECTION_READ: "inspection:read",
  INSPECTION_TEMPLATE_MANAGE: "inspection:template_manage",

  ACCIDENT_REPORT: "accident:report",
  ACCIDENT_READ: "accident:read",
  ACCIDENT_ACKNOWLEDGE: "accident:acknowledge",
  ACCIDENT_UPDATE: "accident:update",

  TRAILER_READ: "trailer:read",
  TRAILER_SWAP: "trailer:swap",

  ASSET_READ: "asset:read",
  ASSET_CREATE: "asset:create",
  ASSET_UPDATE: "asset:update",

  REPORT_READ: "report:read",
  ANOMALY_READ: "anomaly:read",

  DOCUMENT_READ: "document:read",
  DOCUMENT_MANAGE: "document:manage",

  NOTIFICATION_READ: "notification:read",
  NOTIFICATION_MANAGE: "notification:manage",

  TRAINING_READ: "training:read",
  TRAINING_REVIEW: "training:review",
  TRAINING_COMPLETE: "training:complete",

  MAINTENANCE_READ: "maintenance:read",
  MAINTENANCE_RECORD: "maintenance:record",

  USER_READ: "user:read",
  USER_MANAGE: "user:manage",

  DEVICE_REVOKED: "device:revoke",

  PRIVACY_REQUEST_OWN: "privacy:request_own",
  PRIVACY_VIEW_REQUESTS_TENANT: "privacy:view_requests_tenant",

  MFA_MANAGE_OWN: "MANAGE_OWN_MFA",

  VEHICLE_REPORT: "vehicle:report",
} as const;

export function hasPermission(p: Principal | null, code: string): boolean {
  return !!p && p.permissions.has(code);
}

/** Decide which shells a principal may use (mirror availableShells()). */
export function availableShells(p: Principal | null): ActiveShell[] {
  if (!p) return ["DRIVER"];
  const driverPerms = [
    Permission.SHIFT_CLOCK_IN,
    Permission.SHIFT_CLOCK_OUT,
    Permission.FUEL_SUBMIT_PURCHASE,
    Permission.INSPECTION_SUBMIT,
    Permission.ACCIDENT_REPORT,
    Permission.VEHICLE_REPORT,
    Permission.TRAINING_COMPLETE,
  ];
  const adminPerms = [
    Permission.SHIFT_VERIFY,
    Permission.SHIFT_READ_ALL,
    Permission.FUEL_VERIFY,
    Permission.FUEL_RECONCILE,
    Permission.INSPECTION_TEMPLATE_MANAGE,
    Permission.ACCIDENT_UPDATE,
    Permission.ACCIDENT_ACKNOWLEDGE,
    Permission.USER_MANAGE,
    Permission.DEVICE_REVOKED,
    Permission.ASSET_UPDATE,
    Permission.REPORT_READ,
    Permission.DOCUMENT_MANAGE,
    Permission.ANOMALY_READ,
    Permission.NOTIFICATION_MANAGE,
    Permission.PRIVACY_VIEW_REQUESTS_TENANT,
  ];
  const shells: ActiveShell[] = [];
  if (driverPerms.some((c) => hasPermission(p, c)) || p.roles.includes("DRIVER")) {
    shells.push("DRIVER");
  }
  if (
    adminPerms.some((c) => hasPermission(p, c)) ||
    p.roles.some((r) =>
      ["ADMIN", "FLEET_MANAGER", "DISPATCHER", "FINANCE", "AUDITOR"].includes(r),
    )
  ) {
    shells.push("ADMIN");
  }
  if (shells.length === 0) shells.push("DRIVER");
  return Array.from(new Set(shells));
}

// ---- Offline queue ----
export type QueueStatus = "PENDING" | "INFLIGHT" | "DONE" | "FAILED_REVIEW" | "DISCARDED";
export type QueuePayloadType =
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "REFUEL_PURCHASE"
  | "DVIR_SUBMISSION"
  | "ACCIDENT_REPORT"
  | "MAYDAY_ALERT"
  | "TRAILER_SWAP"
  | "EXPENSE"
  | "VEHICLE_ISSUE";

export interface OfflineQueueItem {
  id: string;
  idempotencyKey: string;
  payloadType: QueuePayloadType;
  method: string;
  path: string;
  summary: string;
  bodyJson: string;
  timestamp: number;
  attempts: number;
  status: QueueStatus;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

// ---- Vehicle ----
export type VehicleDisplayState =
  | "QUARANTINED"
  | "OFFLINE"
  | "HOS_ALERT"
  | "SPEEDING"
  | "MOVING"
  | "IDLING"
  | "PARKED";
export type AssetStatus =
  | "AVAILABLE"
  | "IN_USE"
  | "UNDER_MAINTENANCE"
  | "QUARANTINED"
  | "EXTERNAL"
  | "RETIRED";
export type VehicleClass = "TRACTOR" | "RIGID" | "VAN" | "PICKUP";

export interface Vehicle {
  id: string;
  plateNumber: string;
  model: string;
  vehicleClass: VehicleClass;
  assetStatus: AssetStatus;
  displayState: VehicleDisplayState;
  odometerKm: number;
  fuelLevelPct?: number | null;
  currentDriverName?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationName?: string | null;
  speedKph?: number | null;
  hosAlert: boolean;
}

// ---- Shift ----
export type ShiftState = "OPEN" | "PENDING_CLOSEOUT" | "CLOSED";
export type FuelGaugeLevel = "EMPTY" | "QUARTER" | "HALF" | "THREE_QUARTER" | "FULL";

export interface DriverShift {
  id: string;
  vehicleId?: string | null;
  assignmentId?: string | null;
  clockInAt?: number | null;
  clockOutAt?: number | null;
  startOdometerKm?: number | null;
  endOdometerKm?: number | null;
  startFuelGauge?: FuelGaugeLevel | null;
  endFuelGauge?: FuelGaugeLevel | null;
  startPhotoMediaId?: string | null;
  endPhotoMediaId?: string | null;
  state: ShiftState;
  verificationStatus?: string | null;
  todayAnomaliesCount: number;
  disclaimer?: string | null;
}

// ---- Fuel ----
export type FuelPendingBadge = "AUTO" | "REVIEW" | "FLAGGED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RefuelPurchase {
  id: string;
  vehicleId?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  stationName?: string | null;
  receiptDate?: string | null;
  amountSpent?: number | null;
  litersPumped?: number | null;
  odometerKm?: number | null;
  distanceSinceLastRefuelKm?: number | null;
  costPerKm?: number | null;
  confidenceScore?: number | null;
  badge: FuelPendingBadge;
  receiptMediaId?: string | null;
  odometerPhotoMediaId?: string | null;
  driverCorrected: boolean;
  approvalStatus: ApprovalStatus;
}

// ---- DVIR / Inspection ----
export type InspectionSubject = "VEHICLE" | "TRAILER" | "TRAILER_SWAP";
export type InspectionItemResult = "PASS" | "FAIL" | "NOT_APPLICABLE";
export type InspectionSeverity = "BLOCKER" | "WARNING";

export interface InspectionItem {
  templateItemId: string;
  label: string;
  category?: string;
  result: InspectionItemResult;
  severity?: InspectionSeverity;
  numericValue?: number | null;
  notes?: string | null;
  photoMediaId?: string | null;
}

export interface InspectionReport {
  id: string;
  vehicleId?: string | null;
  driverName?: string | null;
  createdAt: number;
  subject: InspectionSubject;
  overallStatus: string;
  defectCount: number;
  previousDefectsReviewed?: boolean;
  signatureName?: string;
  items: InspectionItem[];
  templateId?: string | null;
  shiftId?: string | null;
}

// ---- Accidents / Mayday ----
export type AccidentStatus = "PENDING" | "INVESTIGATING" | "RESOLVED" | "CLOSED";
export type AccidentMediaSlot =
  | "FRONT_DAMAGE"
  | "REAR_DAMAGE"
  | "SIDE_DAMAGE"
  | "OTHER_VEHICLE_PLATE"
  | "WITNESS"
  | "ADDITIONAL"
  | "POLICE_ABSTRACT"
  | "INSURANCE_DOCUMENT";

export interface AccidentReport {
  id: string;
  vehicleId?: string | null;
  driverName?: string | null;
  createdAt: number;
  isMayday: boolean;
  status: AccidentStatus;
  tierLevel: number;
  position?: { latitude: number; longitude: number } | null;
  locationName?: string | null;
  driverStatement?: string | null;
  mediaSlots: AccidentMediaSlot[];
  acknowledged: boolean;
  escalationArmed: boolean;
  telemetryAvailable: boolean;
}

// ---- Anomalies / Notifications / HOS ----
export type AnomalyDomain =
  | "FUEL"
  | "HOS"
  | "ACCIDENT"
  | "MAINTENANCE"
  | "SECURITY"
  | "EFFICIENCY";
export type AnomalySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AnomalyItem {
  id: string;
  domain: AnomalyDomain;
  title: string;
  detail: string;
  createdAt: number;
  vehicleId?: string | null;
  severity: AnomalySeverity;
}

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type NotificationChannel = "PUSH" | "SMS" | "EMAIL" | "IN_APP";

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  isRead: boolean;
  priority: NotificationPriority;
  channel: NotificationChannel;
}

export interface HosState {
  drivingMinutesToday: number;
  dailyLimitMinutes: number;
  restBlocked: boolean;
  nextEligibleClockInAt?: number | null;
}

// ---- Admin-supporting models ----
export interface DriverRosterItem {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  mfaEnrolled: boolean;
  status: string;
  assignedVehicleId?: string | null;
  activeSessionsCount: number;
}

export interface DocumentItem {
  id: string;
  title: string;
  docType: string;
  ownerName: string;
  expiresOn?: string | null;
  daysUntilExpiry?: number | null;
}

export type TrackerLiveness = "PENDING" | "ONLINE" | "OFFLINE" | "LOST";
export interface HardwareDevice {
  deviceId: string;
  vehiclePlate?: string | null;
  brand?: string | null;
  status: TrackerLiveness;
  pairedAt?: number | null;
  lastPing?: number | null;
  vehicleId?: string | null;
}

export interface TrainingLesson {
  id: string;
  title: string;
  category: string;
  durationMinutes: number;
  progressPct: number;
  isCompleted: boolean;
}

export interface GeofenceZone {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  zoneKind: string;
}

export interface TrailerAssignment {
  trailerId: string;
  vehicleId?: string | null;
  vehiclePlate?: string | null;
  hookedAt?: string | null;
}

export interface VehicleIssue {
  id: string;
  vehicleId: string;
  category: string;
  description: string;
  severity: AnomalySeverity;
  reportedAt: number;
  resolved: boolean;
}

export interface AdminDashboard {
  tenantId: string;
  activeFleet: number;
  openAccidents: number;
  pendingDvir: number;
  expiringDocs: number;
  fuelSpend30d: number;
  anomaliesOpen: number;
}

export interface VehicleMaster {
  id: string;
  plateNumber: string;
  vehicleClass: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  ownershipType?: string | null;
  status: string;
  isOperational: boolean;
  notes?: string | null;
}

export interface MaintenanceRecord {
  id: string;
  assetId?: string | null;
  assetKind: string;
  taskCode: string;
  performedAt: number;
  odometerKm?: number | null;
  vendor?: string | null;
  cost?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export interface PrivacyRequest {
  id: string;
  requestType: string;
  status: string;
  requesterEmail?: string | null;
  createdAt: number;
  downloadUrl?: string | null;
}

export interface TenantUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
  mfaEnrolled: boolean;
  status: string;
  roles: string[];
  vehicleIds: string[];
  driverIds: string[];
}

