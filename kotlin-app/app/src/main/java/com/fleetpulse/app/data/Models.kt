package com.fleetpulse.app.data

import java.util.UUID

// ---------------------------------------------------------------------------
// Identity & access (mirror db/schema/01_enums.sql app.role_code + backend Principal)
// ---------------------------------------------------------------------------

/** Backend role codes. The app derives its shell from `permissions`, not these strings. */
enum class RoleCode {
    DRIVER, DISPATCHER, FLEET_MANAGER, ADMIN, FINANCE, AUDITOR, SYSTEM_ADMIN
}

/** The active UI shell, derived from the principal's permissions. */
enum class ActiveShell { DRIVER, ADMIN }

/**
 * Mobile principal built ONLY from the trusted login/session response body
 * (packages/api sessionBody). The JWT is never decoded on device.
 */
data class Principal(
    val userId: String,
    val tenantId: String,
    val email: String,
    val phone: String? = null,
    val roles: List<RoleCode> = emptyList(),
    val permissions: Set<String> = emptySet(),
    val locale: String = "en",
    val sessionId: String? = null,
    val deviceIdHash: String? = null,
) {
    fun hasPermission(code: String): Boolean = permissions.contains(code)
    fun hasAnyPermission(codes: Collection<String>): Boolean = codes.any { hasPermission(it) }
    fun isSuspended(): Boolean = hasPermission("account:suspended")
}

object Permission {
    const val SHIFT_CLOCK_IN = "shift:clock_in"
    const val SHIFT_CLOCK_OUT = "shift:clock_out"
    const val SHIFT_VERIFY = "shift:verify"
    const val FUEL_SUBMIT_PURCHASE = "fuel:submit_purchase"
    const val FUEL_VERIFY = "fuel:verify"
    const val FUEL_CLEAR_PAYMENT = "fuel:clear_payment"
    const val INSPECTION_SUBMIT = "inspection:submit"
    const val INSPECTION_REVIEW = "inspection:review"
    const val ACCIDENT_REPORT = "accident:report"
    const val ACCIDENT_ACKNOWLEDGE = "accident:acknowledge"
    const val TRAILER_SWAP = "trailer:swap"
    const val ASSET_READ = "asset:read"
    const val VEHICLE_READ = "vehicle:read"
    const val NOTIFICATION_MANAGE = "notification:manage"
    const val CONFIG_MANAGE = "config:manage"
    const val USER_MANAGE = "user:manage"
    const val DEVICE_REVOKED = "device:revoke"
    const val MFA_MANAGE_OWN = "manage_own_mfa"
}

/** Decide which shells a principal may use. Pure drivers get DRIVER only. */
fun Principal.availableShells(): List<ActiveShell> {
    val driverPerms = listOf(
        Permission.SHIFT_CLOCK_IN, Permission.SHIFT_CLOCK_OUT, Permission.FUEL_SUBMIT_PURCHASE,
        Permission.INSPECTION_SUBMIT, Permission.ACCIDENT_REPORT,
    )
    val adminPerms = listOf(
        Permission.SHIFT_VERIFY, Permission.FUEL_VERIFY, Permission.FUEL_CLEAR_PAYMENT,
        Permission.INSPECTION_REVIEW, Permission.ACCIDENT_ACKNOWLEDGE, Permission.USER_MANAGE,
        Permission.DEVICE_REVOKED, Permission.CONFIG_MANAGE, Permission.NOTIFICATION_MANAGE,
        Permission.VEHICLE_READ, Permission.ASSET_READ,
    )
    val shells = mutableListOf<ActiveShell>()
    if (driverPerms.any { hasPermission(it) } || roles.contains(RoleCode.DRIVER)) shells += ActiveShell.DRIVER
    if (adminPerms.any { hasPermission(it) } || roles.any { it in listOf(RoleCode.ADMIN, RoleCode.FLEET_MANAGER, RoleCode.DISPATCHER, RoleCode.FINANCE, RoleCode.AUDITOR) }) shells += ActiveShell.ADMIN
    if (shells.isEmpty()) shells += ActiveShell.DRIVER
    return shells.distinct()
}

// ---------------------------------------------------------------------------
// Offline queue (docs/backend/03-rest-api.md §8 + apps/driver.md §4)
// ---------------------------------------------------------------------------

enum class QueueStatus { PENDING, INFLIGHT, DONE, FAILED_REVIEW, DISCARDED }

enum class QueuePayloadType {
    CLOCK_IN, CLOCK_OUT, REFUEL_PURCHASE, DVIR_SUBMISSION,
    ACCIDENT_REPORT, MAYDAY_ALERT, TRAILER_SWAP, EXPENSE, VEHICLE_ISSUE
}

data class OfflineQueueItem(
    val id: String = UUID.randomUUID().toString(),
    val idempotencyKey: String = UUID.randomUUID().toString(),
    val payloadType: QueuePayloadType,
    val method: String,            // "POST" / "PATCH" / "PUT"
    val path: String,              // e.g. "/shifts/clock-in"
    val summary: String,
    val bodyJson: String,
    val timestamp: Long = System.currentTimeMillis(),
    val attempts: Int = 0,
    val status: QueueStatus = QueueStatus.PENDING,
    val lastErrorCode: String? = null,
    val lastErrorMessage: String? = null,
)

// ---------------------------------------------------------------------------
// Vehicle (mirror app.vehicle_display_state precedence in v_vehicle_display_state)
// ---------------------------------------------------------------------------

enum class VehicleDisplayState {
    QUARANTINED, OFFLINE, HOS_ALERT, SPEEDING, MOVING, IDLING, PARKED;

    /** Highest precedence wins (docs/backend 01 enums N5). */
    companion object {
        fun precedence(): List<VehicleDisplayState> = entries.toList()
    }
}

enum class AssetStatus { AVAILABLE, IN_USE, UNDER_MAINTENANCE, QUARANTINED, EXTERNAL, RETIRED }
enum class VehicleClass { TRACTOR, RIGID, VAN, PICKUP }

data class Vehicle(
    val id: String,
    val plateNumber: String,
    val model: String,
    val vehicleClass: VehicleClass = VehicleClass.RIGID,
    val assetStatus: AssetStatus = AssetStatus.AVAILABLE,
    val displayState: VehicleDisplayState = VehicleDisplayState.PARKED,
    val odometerKm: Long = 0,
    val fuelLevelPct: Int? = null,
    val currentDriverName: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val locationName: String? = null,
    val speedKph: Double? = null,
    val hosAlert: Boolean = false,
)

// ---------------------------------------------------------------------------
// Shift (app.shift_state: OPEN / PENDING_CLOSEOUT / CLOSED)
// ---------------------------------------------------------------------------

enum class ShiftState { OPEN, PENDING_CLOSEOUT, CLOSED }
enum class FuelGaugeLevel { EMPTY, QUARTER, HALF, THREE_QUARTER, FULL }

data class DriverShift(
    val id: String,
    val vehicleId: String?,
    val assignmentId: String? = null,
    val clockInAt: Long? = null,
    val clockOutAt: Long? = null,
    val startOdometerKm: Long? = null,
    val endOdometerKm: Long? = null,
    val startFuelGauge: FuelGaugeLevel? = null,
    val endFuelGauge: FuelGaugeLevel? = null,
    val startPhotoMediaId: String? = null,
    val endPhotoMediaId: String? = null,
    val state: ShiftState = ShiftState.OPEN,
    val verificationStatus: String? = null,
    val todayAnomaliesCount: Int = 0,
    val disclaimer: String? = null,
)

// ---------------------------------------------------------------------------
// Fuel (photo-first refuel, apps/driver.md §3)
// ---------------------------------------------------------------------------

enum class FuelPendingBadge { AUTO, REVIEW, FLAGGED }
enum class ApprovalStatus { PENDING, APPROVED, REJECTED }

data class RefuelPurchase(
    val id: String,
    val vehicleId: String?,
    val vehiclePlate: String? = null,
    val driverName: String? = null,
    val stationName: String? = null,
    val receiptDate: String? = null,
    val amountSpent: Double? = null,
    val litersPumped: Double? = null,
    val odometerKm: Long? = null,
    val distanceSinceLastRefuelKm: Double? = null,
    val costPerKm: Double? = null,
    val confidenceScore: Double? = null,
    val badge: FuelPendingBadge = FuelPendingBadge.REVIEW,
    val receiptMediaId: String? = null,
    val odometerPhotoMediaId: String? = null,
    val driverCorrected: Boolean = false,
    val approvalStatus: ApprovalStatus = ApprovalStatus.PENDING,
)

// ---------------------------------------------------------------------------
// DVIR / Inspection
// ---------------------------------------------------------------------------

enum class InspectionSubject { VEHICLE, TRAILER, TRAILER_SWAP }
enum class InspectionItemResult { PASS, FAIL, NOT_APPLICABLE }
enum class InspectionSeverity { BLOCKER, WARNING }

data class InspectionItem(
    val templateItemId: String,
    val label: String,
    val category: String = "",
    val result: InspectionItemResult,
    val severity: InspectionSeverity = InspectionSeverity.WARNING,
    val numericValue: Double? = null,
    val notes: String? = null,
    val photoMediaId: String? = null,
)

data class InspectionReport(
    val id: String,
    val vehicleId: String?,
    val driverName: String?,
    val createdAt: Long,
    val subject: InspectionSubject = InspectionSubject.VEHICLE,
    val overallStatus: String, // PASS / FAIL / FLAGGED / RESOLVED
    val defectCount: Int,
    val previousDefectsReviewed: Boolean = true,
    val signatureName: String = "",
    val items: List<InspectionItem> = emptyList(),
    val templateId: String? = null,
    val shiftId: String? = null,
)

// ---------------------------------------------------------------------------
// Accidents / Mayday
// ---------------------------------------------------------------------------

enum class AccidentStatus { PENDING, INVESTIGATING, RESOLVED, CLOSED }
enum class AccidentMediaSlot {
    FRONT_DAMAGE, REAR_DAMAGE, SIDE_DAMAGE, OTHER_VEHICLE_PLATE,
    WITNESS, ADDITIONAL, POLICE_ABSTRACT, INSURANCE_DOCUMENT
}

data class AccidentReport(
    val id: String,
    val vehicleId: String?,
    val driverName: String? = null,
    val createdAt: Long,
    val isMayday: Boolean = false,
    val status: AccidentStatus = AccidentStatus.PENDING,
    val tierLevel: Int = 0,
    val position: GeoPoint? = null,
    val locationName: String? = null,
    val driverStatement: String? = null,
    val mediaSlots: List<AccidentMediaSlot> = emptyList(),
    val acknowledged: Boolean = false,
    val escalationArmed: Boolean = false,
    val telemetryAvailable: Boolean = true,
)

data class GeoPoint(val latitude: Double, val longitude: Double)

// ---------------------------------------------------------------------------
// Anomalies / Notifications / HOS
// ---------------------------------------------------------------------------

enum class AnomalyDomain { FUEL, HOS, ACCIDENT, MAINTENANCE, SECURITY, EFFICIENCY }
enum class AnomalySeverity { INFO, WARNING, CRITICAL }

data class AnomalyItem(
    val id: String,
    val domain: AnomalyDomain,
    val title: String,
    val detail: String,
    val createdAt: Long,
    val vehicleId: String? = null,
    val severity: AnomalySeverity = AnomalySeverity.WARNING,
)

enum class NotificationPriority { LOW, NORMAL, HIGH, CRITICAL }
enum class NotificationChannel { PUSH, SMS, EMAIL, IN_APP }

data class NotificationItem(
    val id: String,
    val title: String,
    val message: String,
    val createdAt: Long,
    val isRead: Boolean = false,
    val priority: NotificationPriority = NotificationPriority.NORMAL,
    val channel: NotificationChannel = NotificationChannel.IN_APP,
)

data class HosState(
    val drivingMinutesToday: Int = 0,
    val dailyLimitMinutes: Int = 660,
    val restBlocked: Boolean = false,
    val nextEligibleClockInAt: Long? = null,
)

// ---------------------------------------------------------------------------
// Admin-supporting models
// ---------------------------------------------------------------------------

data class DriverRosterItem(
    val id: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val mfaEnrolled: Boolean = false,
    val status: String = "ACTIVE", // ACTIVE / SUSPENDED / ON_LEAVE / TERMINATED / ONBOARDING
    val assignedVehicleId: String? = null,
    val activeSessionsCount: Int = 0,
)

data class DocumentItem(
    val id: String,
    val title: String,
    val docType: String, // INSURANCE / ROAD_TAX / FITNESS_CERTIFICATE / DRIVING_LICENCE / ...
    val ownerName: String,
    val expiresOn: String? = null,
    val daysUntilExpiry: Int? = null,
)

/** Tracker status board row from GET /admin/hardware/pending. Liveness: PENDING/ONLINE/OFFLINE/LOST. */
enum class TrackerLiveness { PENDING, ONLINE, OFFLINE, LOST }

data class HardwareDevice(
    val deviceId: String,            // backend imei
    val vehiclePlate: String? = null,
    val brand: String? = null,
    val status: TrackerLiveness = TrackerLiveness.PENDING,
    val pairedAt: Long? = null,
    val lastPing: Long? = null,
    val vehicleId: String? = null,
)

data class TrainingLesson(
    val id: String,
    val title: String,
    val category: String,
    val durationMinutes: Int,
    val progressPct: Int = 0,
    val isCompleted: Boolean = false,
)

data class GeofenceZone(
    val id: String,
    val name: String,
    val centerLat: Double,
    val centerLng: Double,
    val radiusMeters: Double,
    val zoneKind: String = "YARD", // YARD / CUSTOMER_SITE / RESTRICTED_ZONE
)

data class TrailerAssignment(
    val trailerId: String,
    val vehicleId: String? = null,
    val vehiclePlate: String? = null,
    val hookedAt: String? = null,
)

data class VehicleIssue(
    val id: String,
    val vehicleId: String,
    val category: String,
    val description: String,
    val severity: AnomalySeverity = AnomalySeverity.WARNING,
    val reportedAt: Long,
    val resolved: Boolean = false,
)

/**
 * Admin KPI dashboard from GET /analytics/company. Mirrors packages/shared CompanyAnalyticsSchema:
 * the flat headline counters (active_fleet, open_accidents, …) are carried alongside the hierarchical
 * tenant roll-up. The app renders the flat counters; the per-manager roll-up is available for drill-down.
 */
data class AdminDashboard(
    val tenantId: String = "",
    val from: String = "",
    val to: String = "",
    val activeFleet: Int = 0,
    val openAccidents: Int = 0,
    val pendingDvir: Int = 0,
    val expiringDocs: Int = 0,
    val fuelSpend30d: Double = 0.0,
    val anomaliesOpen: Int = 0,
    val kpis: AnalyticsKpis = AnalyticsKpis(),
    val managers: List<ManagerKpis> = emptyList(),
)

data class AnalyticsKpis(
    val vehicles: Int = 0,
    val drivers: Int = 0,
    val distanceKm: Double = 0.0,
    val fuelCost: Double = 0.0,
    val anomalies: Int = 0,
)

data class ManagerKpis(
    val userId: String = "",
    val fullName: String? = null,
    val email: String = "",
    val kpis: AnalyticsKpis = AnalyticsKpis(),
)

/** A tenant user in the admin management console (GET /admin/users → toDriverSummary shape). */
data class ManagerSummary(
    val id: String,
    val email: String,
    val fullName: String? = null,
    val status: String = "ACTIVE",
    val roles: List<String> = emptyList(),
)

/** Tenant-wide user row from GET /admin/users (Pillar 5). Carries roles + assignment scope. */
data class TenantUser(
    val id: String,
    val email: String? = null,
    val fullName: String? = null,
    val phone: String? = null,
    val mfaEnrolled: Boolean = false,
    val status: String = "ACTIVE",
    val roles: List<String> = emptyList(),
    val vehicleIds: List<String> = emptyList(),
    val driverIds: List<String> = emptyList(),
)

/** Vehicle master record from GET /vehicles (Pillar 4). Distinct from the live [Vehicle] display state. */
data class VehicleMaster(
    val id: String,
    val plateNumber: String,
    val vehicleClass: String = "RIGID",
    val make: String? = null,
    val model: String? = null,
    val year: Int? = null,
    val ownershipType: String? = null,
    val status: String = "AVAILABLE",
    val isOperational: Boolean = true,
    val notes: String? = null,
)

/** Maintenance record / work order from GET /maintenance (Pillar 3). */
data class MaintenanceRecord(
    val id: String,
    val assetId: String? = null,
    val assetKind: String = "VEHICLE",
    val taskCode: String = "",
    val performedAt: Long = 0,
    val odometerKm: Int? = null,
    val vendor: String? = null,
    val cost: Double? = null,
    val currency: String? = null,
    val notes: String? = null,
)

/** Data Subject Access Request (DSAR) from GET /privacy/requests or /privacy/export-request. */
data class PrivacyRequest(
    val id: String,
    val requestType: String = "EXPORT", // EXPORT / DELETION
    val status: String = "PENDING",
    val requesterEmail: String? = null,
    val createdAt: Long = 0,
    val downloadUrl: String? = null,
)
