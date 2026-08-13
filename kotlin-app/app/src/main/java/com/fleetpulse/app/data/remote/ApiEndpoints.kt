package com.fleetpulse.app.data.remote

import com.fleetpulse.app.data.Principal
import com.fleetpulse.app.data.RoleCode
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.*

/**
 * Retrofit service interfaces binding to the FleetPulse backend (docs/backend/03-rest-api.md).
 * Paths mirror the route table; request bodies mirror packages/shared/src/schemas/*.
 * All state-changing calls rely on the AuthInterceptor to attach Idempotency-Key.
 */

// ---- Auth ----
@Serializable
data class LoginRequest(
    val email: String? = null,
    val phone: String? = null,
    val password: String,
    val mfa_code: String? = null,
    val device_id_hash: String? = null,
)

@Serializable
data class LoginResponse(
    val access_token: String,
    val refresh_token: String,
    val access_token_expires_at: String? = null,
    val refresh_token_expires_at: String? = null,
    val session_id: String? = null,
    val mfa_required: Boolean = false,
    val mfa_challenge_token: String? = null,
    val user_id: String,
    val email: String? = null,
    val phone: String? = null,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
    val locale: String? = "en",
    val tenant_id: String? = null,
)

@Serializable data class MfaVerifyRequest(val mfa_challenge_token: String, val code: String)
@Serializable data class RefreshRequest(val refresh_token: String)
@Serializable data class SignupRequest(
    val email: String, val password: String, val company_name: String,
    val full_name: String? = null, val phone: String? = null,
)
@Serializable data class ConsentRequest(
    val consent_type: String = "GPS_TRACKING_WORKING_HOURS",
    val policy_version: String, val accepted: Boolean,
)
@Serializable data class DeviceRegisterRequest(
    val device_id_hash: String, val device_label: String? = null, val device_model: String? = null,
    val os_version: String? = null, val app_version: String? = null, val push_token: String? = null,
)
@Serializable data class PasswordResetRequestReq(val email_or_phone: String)
@Serializable data class PasswordResetCompleteReq(val code: String, val new_password: String)

// ---- Shifts ----
@Serializable data class ClockInRequest(
    val assignment_id: String, val start_odometer_km: Long, val start_fuel_gauge: String,
    val start_media_object_id: String, val phone_gps_fallback_enabled: Boolean = false,
    val consent_version: String, val planned_notes: String? = null,
    val work_plan_media_object_ids: List<String>? = null,
)
@Serializable data class ClockOutRequest(
    val shift_id: String, val end_odometer_km: Long, val end_fuel_gauge: String,
    val end_media_object_id: String, val debrief_notes: String? = null,
)

// ---- Fuel ----
@Serializable data class PhotoFirstRefuelRequest(
    val shift_id: String? = null, val vehicle_id: String, val odometer_reading: Long,
    val receipt_media_object_id: String, val odometer_photo_media_object_id: String,
    val fuel_card_last_four: String? = null, val purchased_at: String,
)
@Serializable data class VerifyPurchaseRequest(
    val action: String, val adjusted_litres: Double? = null, val adjusted_amount: String? = null,
    val adjusted_odometer: Long? = null, val rejection_reason: String? = null,
    val admin_notes: String? = null,
)

// ---- Inspections (DVIR) ----
@Serializable data class InspectionItemRequest(
    val template_item_id: String, val result: String, val numeric_value: Double? = null,
    val notes: String? = null, val photo_media_object_id: String? = null,
)
@Serializable data class InspectionSubmitRequest(
    val shift_id: String, val template_id: String, val subject: String, val vehicle_id: String? = null,
    val trailer_id: String? = null, val previous_defects_reviewed: Boolean,
    val signature_name: String, val items: List<InspectionItemRequest>,
)

// ---- Accidents ----
@Serializable data class MaydayRequest(
    val shift_id: String? = null, val vehicle_id: String? = null,
    val position: GeoPointDto, val mayday_reason: String,
)
@Serializable data class AccidentCreateRequest(
    val shift_id: String? = null, val vehicle_id: String? = null, val trailer_id: String? = null,
    val occurred_at: String? = null, val position: GeoPointDto? = null,
    val position_source: String? = null, val driver_statement: String? = null,
    val witness_name: String? = null, val witness_phone: String? = null,
    val third_party_name: String? = null, val third_party_phone: String? = null,
    val third_party_plate: String? = null, val third_party_insurer: String? = null,
    val police_ob_number: String? = null, val insurance_claim_number: String? = null,
)
@Serializable data class GeoPointDto(val latitude: Double, val longitude: Double)
@Serializable data class AccidentMediaRequest(val slot: String, val media_object_id: String)
@Serializable data class EnrollMfaRequest(val password: String)
@Serializable data class StatementImportRequest(
    val provider: String,
    val period_start: String,
    val period_end: String,
    val media_object_id: String,
    val column_mapping: Map<String, String> = emptyMap(),
)

// ---- Media ----
@Serializable data class MediaUploadRequest(
    val owner_kind: String, val retention_class: String, val content_type: String,
    val width_px: Int? = null, val height_px: Int? = null, val client_captured_at: String? = null,
)
@Serializable data class MediaUploadResponse(
    val mediaObjectId: String, val uploadUrl: String, val method: String = "PUT",
)

// ---- Vehicle issues ----
@Serializable data class VehicleIssueRequest(
    val vehicle_id: String, val category: String, val description: String, val severity: String,
)

// ---- Verification / review ----
@Serializable data class VerifyShiftRequest(
    val action: String, val flag_reason: String? = null, val corrected_end_odometer_km: Long? = null,
)

// ---- Paged envelope ----
@Serializable data class CursorPage<T>(val data: List<T>, val next_cursor: String? = null, val has_more: Boolean = false)

interface AuthApi {
    @POST("/auth/login") suspend fun login(@Body body: LoginRequest): Response<LoginResponse>
    @POST("/auth/mfa/verify") suspend fun mfaVerify(@Body body: MfaVerifyRequest): Response<LoginResponse>
    @POST("/auth/refresh") suspend fun refresh(@Body body: RefreshRequest): Response<LoginResponse>
    @POST("/auth/signup") suspend fun signup(@Body body: SignupRequest): Response<LoginResponse>
    @POST("/auth/logout") suspend fun logout(): Response<Unit>
    @POST("/auth/consent") suspend fun consent(@Body body: ConsentRequest): Response<Map<String, Any?>>
    @GET("/me/consent") suspend fun consentStatus(): Response<Map<String, Any?>>
    @POST("/auth/devices") suspend fun registerDevice(@Body body: DeviceRegisterRequest): Response<Map<String, Any?>>
    @POST("/auth/devices/pin") suspend fun setPin(): Response<Map<String, Any?>>
    @POST("/auth/mfa/enroll") suspend fun enrollMfa(@Body body: EnrollMfaRequest): Response<Map<String, Any?>>
    @POST("/admin/users/{id}/revoke-sessions") suspend fun revokeSessions(@Path("id") id: String, @Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @POST("/auth/password-reset/request") suspend fun resetRequest(@Body body: PasswordResetRequestReq): Response<Map<String, Any?>>
    @POST("/auth/password-reset/{id}/complete") suspend fun resetComplete(@Path("id") id: String, @Body body: PasswordResetCompleteReq): Response<Map<String, Any?>>
    @POST("/auth/change-password") suspend fun changePassword(@Body body: AuthChangePasswordRequest): Response<Map<String, Any?>>
}

@Serializable data class AuthChangePasswordRequest(val current_password: String, val new_password: String)

interface ShiftsApi {
    @POST("/shifts/clock-in") suspend fun clockIn(@Body body: ClockInRequest): Response<Map<String, Any?>>
    @POST("/shifts/clock-out") suspend fun clockOut(@Body body: ClockOutRequest): Response<Map<String, Any?>>
    @GET("/shifts/me/active") suspend fun active(): Response<Map<String, Any?>?>
    @GET("/shifts/verification-inbox") suspend fun verificationInbox(@Query("cursor") cursor: String? = null): Response<CursorPage<Map<String, Any?>>>
    @POST("/shifts/{id}/verify") suspend fun verify(@Path("id") id: String, @Body body: VerifyShiftRequest): Response<Map<String, Any?>>
}

interface FuelApi {
    @POST("/driver/fuel/purchase") suspend fun photoFirstRefuel(@Body body: PhotoFirstRefuelRequest): Response<Map<String, Any?>>
    @GET("/fuel/reconciliation-inbox") suspend fun reconciliationInbox(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @POST("/fuel/purchases/{id}/verify") suspend fun verify(@Path("id") id: String, @Body body: VerifyPurchaseRequest): Response<Map<String, Any?>>
    @POST("/reconciliation/statements") suspend fun importStatement(@Body body: StatementImportRequest): Response<Map<String, Any?>>
}

interface InspectionsApi {
    @POST("/inspections") suspend fun submit(@Body body: InspectionSubmitRequest): Response<Map<String, Any?>>
    @GET("/inspections") suspend fun adminList(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @GET("/inspections/templates") suspend fun templates(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @GET("/inspections/me") suspend fun mine(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
}

interface AccidentsApi {
    @POST("/accidents/mayday") suspend fun mayday(@Body body: MaydayRequest): Response<Map<String, Any?>>
    @POST("/accidents") suspend fun create(@Body body: AccidentCreateRequest): Response<Map<String, Any?>>
    @POST("/accidents/{id}/media") suspend fun attachMedia(@Path("id") id: String, @Body body: AccidentMediaRequest): Response<Map<String, Any?>>
    @GET("/accidents/me") suspend fun listMine(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @POST("/accidents/{id}/acknowledge") suspend fun acknowledge(@Path("id") id: String): Response<Map<String, Any?>>
}

interface MediaApi {
    @POST("/media/upload-url") suspend fun uploadUrl(@Body body: MediaUploadRequest): Response<MediaUploadResponse>
}

@Serializable data class VehicleStatesResponse(val vehicles: List<Map<String, Any?>> = emptyList())

interface DashboardApi {
    @GET("/dashboard/vehicle-states") suspend fun vehicleStates(): Response<VehicleStatesResponse>
    @GET("/anomalies") suspend fun anomalies(@Query("cursor") cursor: String? = null): Response<CursorPage<Map<String, Any?>>>
    @GET("/notifications") suspend fun notifications(@Query("cursor") cursor: String? = null): Response<CursorPage<Map<String, Any?>>>
    @GET("/documents/expiring") suspend fun expiringDocs(@Query("cursor") cursor: String? = null): Response<CursorPage<Map<String, Any?>>>
    @GET("/documents/{id}") suspend fun document(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/documents/{id}/renewal-note") suspend fun renewalNote(@Path("id") id: String, @Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @POST("/admin/users/{id}/suspend") suspend fun suspendUser(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/admin/users/{id}/reinstate") suspend fun reinstateUser(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/drivers") suspend fun createDriver(@Body body: CreateDriverRequest): Response<Map<String, Any?>>
    @POST("/drivers/{id}/approve") suspend fun approveDriver(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/admin/users/invite") suspend fun inviteUser(@Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @GET("/admin/users") suspend fun listUsers(@Query("cursor") cursor: String? = null): Response<List<Map<String, Any?>>>
    @GET("/admin/managers") suspend fun listManagers(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @GET("/drivers") suspend fun driverRoster(): Response<Map<String, Any?>>
    @GET("/admin/hardware/pending") suspend fun hardwarePending(): Response<Map<String, Any?>>
    @GET("/training/lessons") suspend fun training(): Response<Map<String, Any?>>
    @GET("/training/roster") suspend fun trainingRoster(): Response<Map<String, Any?>>
    @POST("/training/lessons/{id}/complete") suspend fun completeLesson(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/admin/hardware/pair") suspend fun pairHardware(@Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @DELETE("/admin/hardware/{vehicleId}/tracker") suspend fun unpairHardware(@Path("vehicleId") vehicleId: String): Response<HardwareUnpairResponse>
    @PUT("/admin/settings/triggers") suspend fun updateTriggers(@Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @GET("/me") suspend fun me(): Response<Map<String, Any?>>
    @PUT("/admin/users/me") suspend fun updateOwnProfile(@Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @POST("/admin/managers/{userId}/assign") suspend fun managerAssign(@Path("userId") userId: String, @Body body: ManagerAssignRequest): Response<Map<String, Any?>>
    @POST("/admin/users/{userId}/roles/revoke") suspend fun revokeRole(@Path("userId") userId: String, @Body body: Map<String, Any?>): Response<Map<String, Any?>>
}

@Serializable data class ManagerAssignRequest(
    val vehicle_ids: List<String> = emptyList(),
    val driver_ids: List<String> = emptyList(),
)

@Serializable data class CreateDriverRequest(
    val email: String,
    val full_name: String,
    val phone: String? = null,
    val roles: List<String> = emptyList(),
)

interface NotificationsApi {
    @POST("/notifications/{id}/read") suspend fun markRead(@Path("id") id: String): Response<Unit>
    @POST("/notifications/read-all") suspend fun markAllRead(): Response<Unit>
}

interface VehicleIssueApi {
    @POST("/vehicles/{vehicleId}/issues") suspend fun report(@Path("vehicleId") vehicleId: String, @Body body: Map<String, Any?>): Response<Map<String, Any?>>
    @GET("/vehicles/{vehicleId}/issues") suspend fun list(@Path("vehicleId") vehicleId: String, @Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
}

@Serializable data class HardwareUnpairResponse(
    val success: Boolean = true,
    val message: String = "",
    val vehicleId: String = "",
    val trackerImei: String? = null,
)

interface AnalyticsApi {
    @GET("/analytics/company") suspend fun company(): Response<Map<String, Any?>>
}

// ---- Vehicle master data ----
@Serializable data class VehicleCreateRequest(
    val license_plate: String,
    val vehicle_class: String,
    val make: String? = null,
    val model: String? = null,
    val year: Int? = null,
    val ownership_type: String = "OWNED",
    val fuel_tank_capacity_litres: Double? = null,
)
@Serializable data class VehicleUpdateRequest(
    val license_plate: String? = null,
    val make: String? = null,
    val model: String? = null,
    val year: Int? = null,
    val status: String? = null,
    val is_operational: Boolean? = null,
    val notes: String? = null,
)
@Serializable data class VehicleAssignRequest(
    val driver_ids: List<String>? = null,
    val vehicle_ids: List<String>? = null,
)

interface VehicleApi {
    @GET("/vehicles") suspend fun list(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @GET("/vehicles/{id}") suspend fun get(@Path("id") id: String): Response<Map<String, Any?>>
    @POST("/vehicles") suspend fun create(@Body body: VehicleCreateRequest): Response<Map<String, Any?>>
    @PATCH("/vehicles/{id}") suspend fun update(@Path("id") id: String, @Body body: VehicleUpdateRequest): Response<Map<String, Any?>>
    @POST("/vehicles/{id}/assign") suspend fun assign(@Path("id") id: String, @Body body: VehicleAssignRequest): Response<Map<String, Any?>>
}

// ---- Trailer ----
@Serializable data class TrailerSwapRequest(
    val trailer_id: String,
    val vehicle_id: String? = null,
    val action: String? = null,
    val odometer_km: Long? = null,
)
@Serializable data class TrailerSwapResponse(
    val trailer_assignment_id: String? = null,
    val dropped_trailer_id: String? = null,
    val created_trailer_id: String? = null,
)

interface TrailerApi {
    @POST("/trailer/swap") suspend fun swap(@Body body: TrailerSwapRequest): Response<TrailerSwapResponse>
    @GET("/trailer/assignments") suspend fun assignments(): Response<Map<String, Any?>>
}

// ---- Maintenance ----
@Serializable data class WorkOrderRequest(
    val vehicle_id: String? = null,
    val trailer_id: String? = null,
    val task_code: String,
    val performed_at: String,
    val odometer_km: Int? = null,
    val vendor: String? = null,
    val cost: Double? = null,
    val currency: String? = null,
    val notes: String? = null,
)

interface MaintenanceApi {
    @GET("/maintenance") suspend fun list(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @POST("/maintenance/work-orders") suspend fun createWorkOrder(@Body body: WorkOrderRequest): Response<Map<String, Any?>>
    @GET("/maintenance/{id}") suspend fun get(@Path("id") id: String): Response<Map<String, Any?>>
}

// ---- Privacy / DSAR ----
@Serializable data class PrivacyExportRequest(val notes: String? = null)
@Serializable data class PrivacyDeletionRequest(val reason: String? = null)

interface PrivacyApi {
    @POST("/privacy/export-request") suspend fun exportRequest(@Body body: PrivacyExportRequest): Response<Map<String, Any?>>
    @POST("/privacy/deletion-request") suspend fun deletionRequest(@Body body: PrivacyDeletionRequest): Response<Map<String, Any?>>
    @GET("/privacy/export-request") suspend fun listOwn(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
    @GET("/privacy/export-request/{id}/download") suspend fun downloadUrl(@Path("id") id: String): Response<Map<String, Any?>>
    @GET("/privacy/requests") suspend fun listTenant(@Query("cursor") cursor: String? = null): Response<Map<String, Any?>>
}

/** Builds a [Principal] from a trusted LoginResponse (mirror Expo `toPrincipal`). */
fun LoginResponse.toPrincipal(): Principal {
    val roles = roles.mapNotNull { runCatching { RoleCode.valueOf(it) }.getOrNull() }
    val tenant = tenant_id ?: "00000000-0000-0000-0000-000000000000"
    return Principal(
        userId = user_id, tenantId = tenant, email = email ?: "", phone = phone,
        roles = roles, permissions = permissions.toSet(), locale = locale ?: "en",
        sessionId = session_id,
    )
}
