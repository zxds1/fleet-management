package com.fleetpulse.app.data.repo

import android.content.Context
import android.location.Location
import com.fleetpulse.app.data.*
import com.fleetpulse.app.data.local.*
import com.fleetpulse.app.data.remote.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.UUID

/**
 * Single source of truth for the app. Replaces the hardcoded stub. All data originates from the
 * backend; initial state is empty + loading. Owns the offline queue drainer and the retrofit client.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class FleetRepository(private val context: Context) {
    private val db = AppDatabase.get(context)
    private val sessionPrefs = SessionPrefs(context)
    private val json: Json = appJson
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val okHttp = createOkHttpClient()
    private val retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(okHttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    private val authApi = retrofit.create(AuthApi::class.java)
    private val shiftsApi = retrofit.create(ShiftsApi::class.java)
    private val fuelApi = retrofit.create(FuelApi::class.java)
    private val inspectionsApi = retrofit.create(InspectionsApi::class.java)
    private val accidentsApi = retrofit.create(AccidentsApi::class.java)
    private val mediaApi = retrofit.create(MediaApi::class.java)
    private val dashboardApi = retrofit.create(DashboardApi::class.java)
    private val notificationsApi = retrofit.create(NotificationsApi::class.java)
    private val vehicleIssueApi = retrofit.create(VehicleIssueApi::class.java)
    private val analyticsApi = retrofit.create(AnalyticsApi::class.java)
    private val vehicleApi = retrofit.create(VehicleApi::class.java)
    private val trailerApi = retrofit.create(TrailerApi::class.java)
    private val maintenanceApi = retrofit.create(MaintenanceApi::class.java)
    private val privacyApi = retrofit.create(PrivacyApi::class.java)

    // ---- Auth / session state ----
    private val _principal = MutableStateFlow<Principal?>(null)
    val principal: StateFlow<Principal?> = _principal.asStateFlow()

    private val _authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _activeShell = MutableStateFlow<ActiveShell?>(null)
    val activeShell: StateFlow<ActiveShell?> = _activeShell.asStateFlow()

    private val _isNetworkConnected = MutableStateFlow(true)
    val isNetworkConnected: StateFlow<Boolean> = _isNetworkConnected.asStateFlow()

    private val _isOfflinePinLocked = MutableStateFlow(false)
    val isOfflinePinLocked: StateFlow<Boolean> = _isOfflinePinLocked.asStateFlow()

    private val _consentVersion = MutableStateFlow("2024.1")

    // ---- Domain data (empty until loaded) ----
    private val _vehicles = MutableStateFlow<List<Vehicle>>(emptyList())
    val vehicles = _vehicles.asStateFlow()
    private val _activeShift = MutableStateFlow<DriverShift?>(null)
    val activeShift = _activeShift.asStateFlow()
    private val _shiftsHistory = MutableStateFlow<List<DriverShift>>(emptyList())
    val shiftsHistory = _shiftsHistory.asStateFlow()
    private val _refuelPurchases = MutableStateFlow<List<RefuelPurchase>>(emptyList())
    val refuelPurchases = _refuelPurchases.asStateFlow()
    private val _dvirReports = MutableStateFlow<List<InspectionReport>>(emptyList())
    val dvirReports = _dvirReports.asStateFlow()
    private val _accidentReports = MutableStateFlow<List<AccidentReport>>(emptyList())
    val accidentReports = _accidentReports.asStateFlow()
    private val _anomalies = MutableStateFlow<List<AnomalyItem>>(emptyList())
    val anomalies = _anomalies.asStateFlow()
    private val _notifications = MutableStateFlow<List<NotificationItem>>(emptyList())
    val notifications = _notifications.asStateFlow()
    private val _driverRoster = MutableStateFlow<List<DriverRosterItem>>(emptyList())
    val driverRoster = _driverRoster.asStateFlow()
    private val _tenantUsers = MutableStateFlow<List<TenantUser>>(emptyList())
    val tenantUsers = _tenantUsers.asStateFlow()
    private val _tenantManagers = MutableStateFlow<List<ManagerSummary>>(emptyList())
    val tenantManagers = _tenantManagers.asStateFlow()
    private val _documents = MutableStateFlow<List<DocumentItem>>(emptyList())
    val documents = _documents.asStateFlow()
    private val _hardwareDevices = MutableStateFlow<List<HardwareDevice>>(emptyList())
    val hardwareDevices = _hardwareDevices.asStateFlow()
    private val _adminDashboard = MutableStateFlow<AdminDashboard?>(null)
    val adminDashboard = _adminDashboard.asStateFlow()
    private val _trainingLessons = MutableStateFlow<List<TrainingLesson>>(emptyList())
    val trainingLessons = _trainingLessons.asStateFlow()
    private val _trailerAssignments = MutableStateFlow<List<TrailerAssignment>>(emptyList())
    val trailerAssignments = _trailerAssignments.asStateFlow()
    private val _vehicleIssues = MutableStateFlow<List<VehicleIssue>>(emptyList())
    val vehicleIssues = _vehicleIssues.asStateFlow()
    private val _vehicleMaster = MutableStateFlow<List<VehicleMaster>>(emptyList())
    val vehicleMaster = _vehicleMaster.asStateFlow()
    private val _maintenanceRecords = MutableStateFlow<List<MaintenanceRecord>>(emptyList())
    val maintenanceRecords = _maintenanceRecords.asStateFlow()
    private val _privacyRequests = MutableStateFlow<List<PrivacyRequest>>(emptyList())
    val privacyRequests = _privacyRequests.asStateFlow()
    private val _hosState = MutableStateFlow(HosState())
    val hosState = _hosState.asStateFlow()

    // ---- Offline queue ----
    private val _queueItems = MutableStateFlow<List<OfflineQueueItem>>(emptyList())
    val queueItems = _queueItems.asStateFlow()
    private val _isDraining = MutableStateFlow(false)
    val isDraining = _isDraining.asStateFlow()

    // Triplet of last known location for clock-in/out + mayday
    private val _lastLocation = MutableStateFlow<Location?>(null)
    val lastLocation = _lastLocation.asStateFlow()

    init {
        scope.launch { restoreSession() }
        scope.launch { refreshQueueState() }
        scope.launch { startDrainer() }
    }

    // ====================================================================
    // AUTH
    // ====================================================================
    sealed interface AuthState {
        object Unauthenticated : AuthState
        object NeedsMfa : AuthState
        object NeedsConsent : AuthState
        object Authenticated : AuthState
        data class Error(val code: String, val message: String?) : AuthState
    }

    private var pendingChallengeToken: String? = null

    suspend fun restoreSession() {
        val principalJson = sessionPrefs.getPrincipalJson() ?: return
        val access = sessionPrefs.getAccessToken()
        val refresh = sessionPrefs.getRefreshToken()
        if (access == null || refresh == null) return
        SessionHolder.set(access)
        _principal.value = runCatching { json.decodeFromString<Principal?>(principalJson) }.getOrNull()
        _activeShell.value = _principal.value?.availableShells()?.firstOrNull()
        _authState.value = AuthState.Authenticated
        refreshPrincipalIfNeeded()
        loadAll()
    }

    /** Full login: returns Unit on success; sets AuthState to NeedsMfa / NeedsConsent / Error. */
    suspend fun login(identifier: String, password: String): Result<Unit> = withContext(Dispatchers.IO) {
        val isPhone = Regex("^\\+?[1-9]\\d{6,14}$").matches(identifier.trim())
        val body = if (isPhone) LoginRequest(phone = identifier.trim(), password = password)
        else LoginRequest(email = identifier.trim(), password = password)
        try {
            val res = authApi.login(body)
            if (!res.isSuccessful) {
                val err = ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null)
                if (err.errorCode == "MFA_REQUIRED") {
                    _authState.value = AuthState.NeedsMfa
                    return@withContext Result.failure(err)
                }
                _authState.value = AuthState.Error(err.errorCode, err.detail)
                return@withContext Result.failure(err)
            }
            val login = res.body()!!
            if (login.mfa_required) {
                pendingChallengeToken = login.mfa_challenge_token
                _authState.value = AuthState.NeedsMfa
                return@withContext Result.failure(AppException("MFA_REQUIRED"))
            }
            applyAuth(login)
            Result.success(Unit)
        } catch (e: Exception) {
            _authState.value = AuthState.Error("NETWORK_UNAVAILABLE", e.message)
            Result.failure(e)
        }
    }

    suspend fun verifyMfa(code: String): Result<Unit> = withContext(Dispatchers.IO) {
        val token = pendingChallengeToken ?: return@withContext Result.failure(AppException("UNAUTHENTICATED"))
        try {
            val res = authApi.mfaVerify(MfaVerifyRequest(token, code))
            if (!res.isSuccessful) {
                val err = ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null)
                return@withContext Result.failure(err)
            }
            applyAuth(res.body()!!)
            Result.success(Unit)
        } catch (e: Exception) { Result.failure(e) }
    }

    private suspend fun applyAuth(login: LoginResponse) {
        val principal = login.toPrincipal()
        SessionHolder.set(login.access_token)
        _principal.value = principal
        val shells = principal.availableShells()
        _activeShell.value = shells.firstOrNull()
        sessionPrefs.saveSession(login.access_token, login.refresh_token, json.encodeToString(principal), principal.deviceIdHash)
        _authState.value = AuthState.Authenticated
        // Consent gate (C5.5): drivers must accept the backend's required consent version before shift.
        if (principal.roles.contains(RoleCode.DRIVER)) {
            val status = runCatching { authApi.consentStatus().body() }.getOrNull()
            val requiredVersion = (status?.get("required_version") as? String) ?: _consentVersion.value
            val consented = (status?.get("consented") as? Boolean) ?: false
            val currentVersion = sessionPrefs.getConsentVersion()
            if (!consented || currentVersion != requiredVersion) {
                _consentVersion.value = requiredVersion
                _authState.value = AuthState.NeedsConsent
            }
        }
        loadAll()
        if (principal.availableShells().contains(ActiveShell.DRIVER)) startDriverPolling()
    }

    suspend fun acceptConsent(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = authApi.consent(ConsentRequest(policy_version = _consentVersion.value, accepted = true))
            if (res.isSuccessful) {
                sessionPrefs.saveConsent(_consentVersion.value)
                _authState.value = AuthState.Authenticated
                Result.success(Unit)
            } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    private suspend fun refreshPrincipalIfNeeded() {
        // Access token is short-lived (15m). On next authed call the server returns UNAUTHENTICATED
        // and the drainer/loaders call this to rotate via the opaque refresh token.
        val refresh = sessionPrefs.getRefreshToken() ?: return
        try {
            val res = authApi.refresh(RefreshRequest(refresh))
            if (res.isSuccessful && res.body() != null) {
                applyAuthSilently(res.body()!!)
            }
        } catch (_: Exception) { /* offline: keep current token */ }
    }

    private fun applyAuthSilently(login: LoginResponse) {
        val principal = login.toPrincipal()
        SessionHolder.set(login.access_token)
        _principal.value = principal
        sessionPrefs.saveSession(login.access_token, login.refresh_token, json.encodeToString(principal), principal.deviceIdHash)
    }

    suspend fun signupAdmin(email: String, password: String, company: String, fullName: String? = null): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val res = authApi.signup(SignupRequest(email = email, password = password, company_name = company, full_name = fullName))
                if (res.isSuccessful) {
                    // Server signs the new admin in; continue into MFA gate.
                    val login = res.body()!!
                    if (login.mfa_required) { pendingChallengeToken = login.mfa_challenge_token; _authState.value = AuthState.NeedsMfa }
                    else applyAuth(login)
                    Result.success(Unit)
                } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            } catch (e: Exception) { Result.failure(e) }
        }

    suspend fun logout() {
        withContext(Dispatchers.IO) {
            runCatching { authApi.logout() }
            sessionPrefs.clear()
            db.queueDao().clearAll()
            db.draftDao().let { /* drafts kept across logout intentionally? clear for safety */ }
        }
        SessionHolder.set(null)
        _principal.value = null
        _activeShell.value = null
        _authState.value = AuthState.Unauthenticated
        clearDomainState()
    }

    fun setActiveShell(shell: ActiveShell) { _activeShell.value = shell }

    /**
     * Password reset step 1 (mirror Expo `session.requestPasswordReset`). The backend emails/SMSes a
     * code (or routes to an admin for approval) and returns a `reset_id` + redacted contact hint. The
     * response NEVER contains the code. Returns the reset id used by [completePasswordReset].
     */
    suspend fun requestPasswordReset(identifier: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val res = authApi.resetRequest(PasswordResetRequestReq(email_or_phone = identifier.trim()))
            if (res.isSuccessful) {
                val id = res.body()?.get("reset_id")?.toString()
                if (id.isNullOrBlank()) Result.failure(AppException("VALIDATION_ERROR"))
                else Result.success(id)
            } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /**
     * Password reset step 2 (mirror Expo `session.completePasswordReset`). The reset id + code ARE the
     * credential; anonymous call. The backend applies the new password and revokes all sessions, so the
     * user must sign in again afterwards.
     */
    suspend fun completePasswordReset(resetId: String, code: String, newPassword: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val res = authApi.resetComplete(resetId, PasswordResetCompleteReq(code = code, new_password = newPassword))
                if (res.isSuccessful) Result.success(Unit)
                else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            } catch (e: Exception) { Result.failure(e) }
        }

    // ====================================================================
    // NETWORK / LOCATION
    // ====================================================================
    fun setNetworkConnected(connected: Boolean) {
        _isNetworkConnected.value = connected
        if (connected) scope.launch { drainQueue() }
    }
    fun setLanguage(lang: String) {
        _principal.value = _principal.value?.copy(locale = lang)
    }
    fun reportLocation(loc: Location) { _lastLocation.value = loc }

    // ====================================================================
    // DATA LOADING (driver + admin)
    // ====================================================================
    private suspend fun loadAll() {
        loadActiveShift()
        loadVehicleStates()
        loadNotifications()
        loadAnomalies()
        loadRefuelInbox()
        loadDvirInbox()
        loadAccidents()
        loadExpiringDocs()
        loadDriverRoster()
        loadHardware()
        loadTraining()
        loadTrailerAssignments()
    }

    private suspend fun loadActiveShift() = safe {
        val res = shiftsApi.active()
        if (res.isSuccessful && res.body() != null) _activeShift.value = mapShift(res.body()!!)
    }
    private suspend fun loadVehicleStates() = safe {
        val res = dashboardApi.vehicleStates()
        if (res.isSuccessful) {
            val body = res.body()
            val list = body?.vehicles ?: (body as? Map<*, *>)?.let { (it["vehicles"] as? List<*>) } ?: emptyList()
            _vehicles.value = list.filterIsInstance<Map<String, Any?>>().map { mapVehicle(it) }
        }
    }
    private suspend fun loadNotifications() = safe {
        val res = dashboardApi.notifications()
        if (res.isSuccessful) _notifications.value = (res.body()?.data ?: emptyList()).map { mapNotification(it) }
    }
    private suspend fun loadAnomalies() = safe {
        val res = dashboardApi.anomalies()
        if (res.isSuccessful) _anomalies.value = (res.body()?.data ?: emptyList()).map { mapAnomaly(it) }
    }
    private suspend fun loadRefuelInbox() = safe {
        val res = fuelApi.reconciliationInbox()
        if (res.isSuccessful) _refuelPurchases.value = mapReconcile(res.body())
    }
    private suspend fun loadDvirInbox() = safe {
        // Admin review inbox: GET /inspections returns the tenant-wide DVIR list (cursor envelope
        // matches the driver's own /inspections/me shape, so the same mapper applies).
        val res = inspectionsApi.adminList()
        if (res.isSuccessful) _dvirReports.value = mapInspectionList(res.body())
    }
    private suspend fun loadAccidents() = safe {
        val res = accidentsApi.listMine()
        if (res.isSuccessful && res.body() != null) _accidentReports.value = mapAccidentList(res.body()!!)
    }
    private suspend fun loadExpiringDocs() = safe {
        val res = dashboardApi.expiringDocs()
        if (res.isSuccessful) _documents.value = (res.body()?.data ?: emptyList()).map { mapDocument(it) }
    }
    private suspend fun loadDriverRoster() = safe { /* admin-scoped; filled by admin loader */ }
    private suspend fun loadHardware() = safe { /* admin-scoped */ }
    private suspend fun loadTraining() = safe { /* training list endpoint; best-effort */ }
    private suspend fun loadTrailerAssignments() = safe { /* trailer endpoint; best-effort */ }

    private suspend inline fun safe(block: suspend () -> Unit) {
        try { block() } catch (_: Exception) { /* never crash a screen on a failed fetch */ }
    }

    // ====================================================================
    // OFFLINE QUEUE + DRAINER (docs/backend/03-rest-api.md §8)
    // ====================================================================
    private suspend fun refreshQueueState() {
        _queueItems.value = db.queueDao().getAll().map { it.toDomain() }
    }

    private fun OfflineQueueItem.toRoom() = RoomQueueItem(
        id = id, idempotencyKey = idempotencyKey, payloadType = payloadType.name, method = method,
        path = path, summary = summary, bodyJson = bodyJson, timestamp = timestamp, attempts = attempts,
        status = status.name, lastErrorCode = lastErrorCode, lastErrorMessage = lastErrorMessage,
    )
    private fun RoomQueueItem.toDomain() = OfflineQueueItem(
        id = id, idempotencyKey = idempotencyKey, payloadType = runCatching { QueuePayloadType.valueOf(payloadType) }.getOrDefault(QueuePayloadType.CLOCK_IN),
        method = method, path = path, summary = summary, bodyJson = bodyJson, timestamp = timestamp,
        attempts = attempts, status = runCatching { QueueStatus.valueOf(status) }.getOrDefault(QueueStatus.PENDING),
        lastErrorCode = lastErrorCode, lastErrorMessage = lastErrorMessage,
    )

    fun enqueue(payloadType: QueuePayloadType, method: String, path: String, summary: String, bodyJson: String) {
        scope.launch {
            val item = OfflineQueueItem(
                payloadType = payloadType, method = method, path = path, summary = summary, bodyJson = bodyJson,
            )
            db.queueDao().upsert(item.toRoom())
            refreshQueueState()
            if (_isNetworkConnected.value) drainQueue()
        }
    }

    /** Serial drainer. Replays each PENDING item with its SAME Idempotency-Key (C5.1). */
    private suspend fun startDrainer() {
        // periodic flush on connectivity handled by setNetworkConnected; this keeps the loop alive.
    }

    /** Driver realtime: per mobile.ts the driver polls (no socket). Refresh vehicle states + active shift. */
    fun startDriverPolling() {
        scope.launch {
            while (isActive) {
                safe { dashboardApi.vehicleStates().takeIf { it.isSuccessful }?.body()?.let { b ->
                    val list = b.vehicles ?: (b as? Map<*, *>)?.let { (it["vehicles"] as? List<*>) } ?: emptyList()
                    _vehicles.value = list.filterIsInstance<Map<String, Any?>>().map { mapVehicle(it) }
                } }
                safe { shiftsApi.active().takeIf { it.isSuccessful }?.body()?.let { _activeShift.value = mapShift(it) } }
                delay(15_000)
            }
        }
    }

    suspend fun drainQueue() {
        if (_isDraining.value) return
        _isDraining.value = true
        try {
            while (_isNetworkConnected.value) {
                val item = db.queueDao().nextPending() ?: break
                db.queueDao().updateStatus(item.id, "INFLIGHT", item.attempts, null, null)
                _queueItems.value = db.queueDao().getAll().map { it.toDomain() }
                try {
                    val sent = sendQueued(item)
                    if (sent) {
                        db.queueDao().updateStatus(item.id, "DONE", item.attempts + 1, null, null)
                    } else {
                        db.queueDao().updateStatus(item.id, "PENDING", item.attempts + 1, null, null)
                        break // wait for next connectivity event / backoff
                    }
                } catch (e: AppException) {
                    handleQueuedError(item, e)
                } catch (e: Exception) {
                    db.queueDao().updateStatus(item.id, "PENDING", item.attempts + 1, "NETWORK_UNAVAILABLE", e.message)
                    break
                }
                refreshQueueState()
            }
        } finally {
            _isDraining.value = false
            refreshQueueState()
        }
    }

    private suspend fun sendQueued(item: RoomQueueItem): Boolean {
        val req = Request.Builder()
            .url(BuildConfig.API_BASE_URL + item.path)
            .method(item.method, item.bodyJson.toRequestBody("application/json".toMediaType()))
            .header("Idempotency-Key", item.idempotencyKey)
            .header("Authorization", "Bearer ${SessionHolder.get()}")
            .header("content-type", "application/json")
            .build()
        val resp = okHttp.newCall(req).execute()
        if (resp.isSuccessful) return true
        val err = ErrorParser.parse(resp.code, resp.body?.stringOrNull(), null)
        throw err
    }

    private suspend fun handleQueuedError(item: RoomQueueItem, e: AppException) {
        when {
            e.shouldDiscard -> {
                db.queueDao().updateStatus(item.id, "DISCARDED", item.attempts + 1, e.errorCode, e.detail)
                // toast: silently discarded duplicate
            }
            e.isTransient -> db.queueDao().updateStatus(item.id, "PENDING", item.attempts + 1, e.errorCode, e.detail)
            else -> db.queueDao().updateStatus(item.id, "FAILED_REVIEW", item.attempts + 1, e.errorCode, e.detail)
        }
    }

    fun retryQueueItem(id: String) {
        scope.launch {
            val item = db.queueDao().getAll().find { it.id == id } ?: return@launch
            if (item.status == "FAILED_REVIEW" || item.status == "PENDING") {
                db.queueDao().updateStatus(item.id, "PENDING", item.attempts, null, null)
                refreshQueueState()
                drainQueue()
            }
        }
    }

    fun discardQueueItem(id: String) {
        scope.launch { db.queueDao().delete(id); refreshQueueState() }
    }

    // ====================================================================
    // BUSINESS ACTIONS (driver) — enqueue offline-first
    // ====================================================================
    fun clockIn(assignmentId: String, odometerKm: Long, gauge: String, mediaObjectId: String, photoFallback: Boolean = false) {
        val body = ClockInRequest(
            assignment_id = assignmentId, start_odometer_km = odometerKm, start_fuel_gauge = gauge,
            start_media_object_id = mediaObjectId, phone_gps_fallback_enabled = photoFallback,
            consent_version = _consentVersion.value,
        )
        enqueue(QueuePayloadType.CLOCK_IN, "POST", "/shifts/clock-in",
            "Clock-In ($odometerKm km)", json.encodeToString(body))
    }

    fun clockOut(shiftId: String, odometerKm: Long, gauge: String, mediaObjectId: String) {
        val body = ClockOutRequest(shift_id = shiftId, end_odometer_km = odometerKm, end_fuel_gauge = gauge, end_media_object_id = mediaObjectId)
        enqueue(QueuePayloadType.CLOCK_OUT, "POST", "/shifts/clock-out",
            "Clock-Out ($odometerKm km)", json.encodeToString(body))
    }

    fun submitRefuel(vehicleId: String, shiftId: String?, odometerReading: Long, receiptMediaId: String, odometerPhotoMediaId: String, purchasedAt: String, cardLast4: String? = null) {
        val body = PhotoFirstRefuelRequest(
            shift_id = shiftId, vehicle_id = vehicleId, odometer_reading = odometerReading,
            receipt_media_object_id = receiptMediaId, odometer_photo_media_object_id = odometerPhotoMediaId,
            fuel_card_last_four = cardLast4, purchased_at = purchasedAt,
        )
        enqueue(QueuePayloadType.REFUEL_PURCHASE, "POST", "/driver/fuel/purchase",
            "Refuel purchase", json.encodeToString(body))
    }

    fun submitDvir(shiftId: String, templateId: String, subject: String, vehicleId: String?, items: List<InspectionItem>, signatureName: String) {
        val req = InspectionSubmitRequest(
            shift_id = shiftId, template_id = templateId, subject = subject, vehicle_id = vehicleId,
            previous_defects_reviewed = true, signature_name = signatureName,
            items = items.map { InspectionItemRequest(it.templateItemId, it.result.name, it.numericValue, it.notes, it.photoMediaId) },
        )
        enqueue(QueuePayloadType.DVIR_SUBMISSION, "POST", "/inspections",
            "DVIR Inspection", json.encodeToString(req))
    }

    fun triggerMayday(shiftId: String?, vehicleId: String?, reason: String) {
        val loc = _lastLocation.value
        val body = MaydayRequest(
            shift_id = shiftId, vehicle_id = vehicleId,
            position = GeoPointDto(loc?.latitude ?: 0.0, loc?.longitude ?: 0.0), mayday_reason = reason,
        )
        enqueue(QueuePayloadType.MAYDAY_ALERT, "POST", "/accidents/mayday",
            "EMERGENCY MAYDAY", json.encodeToString(body))
    }

    /**
     * Report a vehicle issue. Enqueues to `/vehicles/{vehicleId}/issues` (backend vehicleIssue router). Offline-first.
     */
    /**
     * Mark a training lesson complete (best-effort). POSTs to `/training/lessons/{id}/complete` and
     * flips the local lesson to completed on success.
     */
    suspend fun completeTrainingLesson(id: String) = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(BuildConfig.API_BASE_URL + "/training/lessons/$id/complete")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .header("Authorization", "Bearer ${SessionHolder.get()}").build()
            okHttp.newCall(req).execute().use { }
        } catch (_: Exception) { /* offline: keep local state */ }
        _trainingLessons.value = _trainingLessons.value.map { if (it.id == id) it.copy(isCompleted = true, progressPct = 100) else it }
    }

    fun reportVehicleIssue(vehicleId: String, category: String, description: String, severity: String) {
        val body = mapOf(
            "category" to category,
            "description" to description,
            "severity" to severity,
        )
        enqueue(QueuePayloadType.VEHICLE_ISSUE, "POST", "/vehicles/$vehicleId/issues",
            "Vehicle issue report", json.encodeToString(body))
    }

    /**
     * Resolve the assignment id required by Clock-In. Tries the backend's `/drivers/me/assignment`;
     * returns null if unavailable (offline or no assignment yet). The Clock-In screen leaves a TODO
     * and blocks submission without it — no endpoint is invented beyond this best-effort read.
     */
    suspend fun fetchMyAssignment(): String? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(BuildConfig.API_BASE_URL + "/drivers/me/assignment")
                .get().header("Authorization", "Bearer ${SessionHolder.get()}").build()
            val resp = okHttp.newCall(req).execute()
            if (resp.isSuccessful) {
                val map = json.decodeFromString<Map<String, Any?>>(resp.body?.stringOrNull() ?: "{}")
                (map["assignment_id"] ?: map["id"])?.toString()
            } else null
        } catch (_: Exception) { null }
    }

    fun reportAccident(shiftId: String?, vehicleId: String?, statement: String?, loc: GeoPoint? = null) {
        val body = AccidentCreateRequest(shift_id = shiftId, vehicle_id = vehicleId, driver_statement = statement,
            position = loc?.let { GeoPointDto(it.latitude, it.longitude) })
        enqueue(QueuePayloadType.ACCIDENT_REPORT, "POST", "/accidents",
            "Accident report", json.encodeToString(body))
    }

    /** Presigned media upload (§9). Returns the media_object_id or throws. */
    suspend fun uploadMedia(ownerKind: String, retentionClass: String, contentType: String, bytes: ByteArray, width: Int? = null, height: Int? = null): String? = withContext(Dispatchers.IO) {
        try {
            val req = MediaUploadRequest(owner_kind = ownerKind, retention_class = retentionClass, content_type = contentType, width_px = width, height_px = height)
            val res = mediaApi.uploadUrl(req)
            if (!res.isSuccessful) return@withContext null
            val up = res.body()!!
            val put = Request.Builder().url(up.uploadUrl).put(bytes.toRequestBody(contentType.toMediaType()))
                .header("content-type", contentType).build()
            val putRes = okHttp.newCall(put).execute()
            if (putRes.isSuccessful) up.mediaObjectId else null
        } catch (_: Exception) { null }
    }

    // ====================================================================
    // ADMIN REAL-TIME APPLIERS (pushed by SocketClient; no-op on empty)
    // ====================================================================
    fun applyVehicleStates(rows: List<Map<String, Any?>>) {
        if (rows.isEmpty()) return
        _vehicles.value = rows.map { mapVehicle(it) }
    }
    fun applyNotifications(rows: List<Map<String, Any?>>) {
        if (rows.isEmpty()) return
        _notifications.value = rows.map { mapNotification(it) }
    }
    fun applyAccidentLive(row: Map<String, Any?>) {
        val report = mapAccident(row)
        val current = _accidentReports.value.toMutableList()
        val idx = current.indexOfFirst { it.id == report.id }
        if (idx >= 0) current[idx] = report else current.add(0, report)
        _accidentReports.value = current
    }
    private fun mapAccident(m: Map<String, Any?>): AccidentReport = AccidentReport(
        id = (m["id"] ?: m["accident_id"]).toString(),
        vehicleId = m["vehicle_id"]?.toString(),
        driverName = (m["driver_name"] ?: m["driver_id"]?.toString())?.toString(),
        createdAt = (m["reported_at"] as? String)?.let { parseIso(it) }
            ?: (m["created_at"] as? String)?.let { parseIso(it) }
            ?: (m["created_at"] as? Number)?.toLong() ?: 0,
        isMayday = m["is_mayday"] as? Boolean ?: false,
        status = runCatching { AccidentStatus.valueOf((m["status"] ?: "PENDING").toString()) }.getOrDefault(AccidentStatus.PENDING),
        tierLevel = (m["tier_level"] as? Number)?.toInt() ?: 0,
        position = (m["position"] as? Map<*, *>)?.let { p ->
            GeoPoint((p["latitude"] as? Number)?.toDouble() ?: 0.0, (p["longitude"] as? Number)?.toDouble() ?: 0.0)
        } ?: run {
            val lat = (m["reported_latitude"] as? Number)?.toDouble()
            val lng = (m["reported_longitude"] as? Number)?.toDouble()
            if (lat != null && lng != null) GeoPoint(lat, lng) else null
        },
        driverStatement = m["driver_statement"]?.toString(),
        acknowledged = m["acknowledged"] as? Boolean ?: false,
        escalationArmed = m["escalation_armed"] as? Boolean ?: false,
    )

    /** HTTP polling fallback for admin realtime (docs/backend/07 §5), used when socket is down. */
    suspend fun pollAdminRealtime() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.vehicleStates()
            if (res.isSuccessful) {
                val body = res.body()
                val list = body?.vehicles ?: (body as? Map<*, *>)?.let { (it["vehicles"] as? List<*>) } ?: emptyList()
                _vehicles.value = list.filterIsInstance<Map<String, Any?>>().map { mapVehicle(it) }
            }
        }
        safe { val res = dashboardApi.notifications(); if (res.isSuccessful) _notifications.value = (res.body()?.data ?: emptyList()).map { mapNotification(it) } }
    }

    // ---- admin data loaders (admin-scoped; best-effort from existing endpoints) ----
    suspend fun loadAccidentReports() = withContext(Dispatchers.IO) {
        safe {
            val res = accidentsApi.listMine()
            if (res.isSuccessful && res.body() != null) _accidentReports.value = mapAccidentList(res.body()!!)
        }
    }
    suspend fun loadDriverRosterData() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.driverRoster()
            if (res.isSuccessful && res.body() != null) _driverRoster.value = mapRoster(res.body()!!)
        }
    }
    suspend fun loadHardwareData() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.hardwarePending()
            if (res.isSuccessful && res.body() != null) _hardwareDevices.value = mapHardware(res.body()!!)
        }
    }
    suspend fun loadTrainingData() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.training()
            if (res.isSuccessful && res.body() != null) _trainingLessons.value = mapTraining(res.body()!!)
        }
    }
    suspend fun completeTrainingLesson(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.completeLesson(id)
            if (res.isSuccessful) { loadTrainingData(); Result.success(Unit) }
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun loadVehicleIssues() = withContext(Dispatchers.IO) {
        safe {
            // No fleet-wide issues endpoint; aggregate per-vehicle issues (GET /vehicles/{id}/issues).
            val all = _vehicles.value.flatMap { v ->
                runCatching { vehicleIssueApi.list(v.id).body() }.getOrNull()
                    ?.let { (it["data"] as? List<*>) ?: (it["issues"] as? List<*>) ?: emptyList() }
                    ?.mapNotNull { it as? Map<String, Any?>> }
                    ?.map { mapIssue(it, v.id) } ?: emptyList()
            }
            _vehicleIssues.value = all
        }
    }

    suspend fun loadVehicleMaster() = withContext(Dispatchers.IO) {
        safe {
            val res = vehicleApi.list()
            if (res.isSuccessful && res.body() != null) _vehicleMaster.value = mapVehicleMasterList(res.body()!!)
        }
    }
    suspend fun loadMaintenance() = withContext(Dispatchers.IO) {
        safe {
            val res = maintenanceApi.list()
            if (res.isSuccessful && res.body() != null) _maintenanceRecords.value = mapMaintenanceList(res.body()!!)
        }
    }
    /** Tenant-wide DSAR requests for the admin privacy console (GET /privacy/requests). */
    suspend fun loadPrivacyRequests() = withContext(Dispatchers.IO) {
        safe {
            val res = privacyApi.listTenant()
            if (res.isSuccessful && res.body() != null) _privacyRequests.value = mapPrivacyList(res.body()!!)
        }
    }

    private fun mapVehicleMasterList(body: Map<String, Any?>): List<VehicleMaster> {
        val list = (body["data"] as? List<*>) ?: (body["vehicles"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            VehicleMaster(
                id = it["id"].toString(),
                plateNumber = (it["license_plate"] ?: it["plate"] ?: "?").toString(),
                vehicleClass = (it["vehicle_class"] ?: it["vehicleClass"] ?: "RIGID").toString(),
                make = it["make"]?.toString(),
                model = it["model"]?.toString(),
                year = (it["year"] as? Number)?.toInt(),
                ownershipType = it["ownership_type"]?.toString(),
                status = (it["status"] ?: "AVAILABLE").toString(),
                isOperational = (it["is_operational"] as? Boolean) ?: true,
                notes = it["notes"]?.toString(),
            )
        }
    }
    private fun mapMaintenanceList(body: Map<String, Any?>): List<MaintenanceRecord> {
        val list = (body["data"] as? List<*>) ?: (body["records"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            val assetId = it["vehicle_id"]?.toString() ?: it["trailer_id"]?.toString()
            MaintenanceRecord(
                id = it["id"].toString(),
                assetId = assetId,
                assetKind = if (it["trailer_id"] != null) "TRAILER" else "VEHICLE",
                taskCode = (it["task_code"] ?: "?").toString(),
                performedAt = (it["performed_at"] ?: it["performedAt"])?.toString()?.let { s -> parseIso(s) } ?: 0,
                odometerKm = (it["odometer_km"] as? Number)?.toInt(),
                vendor = it["vendor"]?.toString(),
                cost = (it["cost"] as? Number)?.toDouble(),
                currency = it["currency"]?.toString(),
                notes = it["notes"]?.toString(),
            )
        }
    }
    private fun mapPrivacyList(body: Map<String, Any?>): List<PrivacyRequest> {
        val list = (body["data"] as? List<*>) ?: (body["requests"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            PrivacyRequest(
                id = it["id"].toString(),
                requestType = (it["request_type"] ?: it["requestType"] ?: "EXPORT").toString(),
                status = (it["status"] ?: "PENDING").toString(),
                requesterEmail = it["email"]?.toString() ?: it["requester_email"]?.toString(),
                createdAt = (it["created_at"] ?: it["createdAt"])?.toString()?.let { s -> parseIso(s) } ?: 0,
                downloadUrl = it["download_url"]?.toString() ?: it["downloadUrl"]?.toString(),
            )
        }
    }

    private fun mapAccidentList(body: Map<String, Any?>): List<AccidentReport> {
        val list = (body["data"] as? List<*>) ?: (body["accidents"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map { mapAccident(it) }
    }
    private fun mapRoster(body: Map<String, Any?>): List<DriverRosterItem> {
        val list = (body["data"] as? List<*>) ?: (body["drivers"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            DriverRosterItem(
                id = it["user_id"].toString(), name = (it["full_name"] ?: it["name"] ?: "?").toString(),
                phone = it["phone"]?.toString(), email = it["email"]?.toString(),
                mfaEnrolled = it["mfa_enrolled"] as? Boolean ?: false,
                status = (it["status"] ?: "ACTIVE").toString(),
                assignedVehicleId = it["assigned_vehicle_id"]?.toString(),
                activeSessionsCount = (it["active_sessions"] as? Number)?.toInt() ?: 0,
            )
        }
    }
    private fun mapHardware(body: Map<String, Any?>): List<HardwareDevice> {
        val list = (body["trackers"] as? List<*>) ?: (body["data"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            HardwareDevice(
                deviceId = it["imei"].toString(),
                vehiclePlate = it["vehiclePlate"]?.toString(),
                brand = it["brand"]?.toString(),
                status = runCatching { TrackerLiveness.valueOf((it["status"] ?: "PENDING").toString()) }.getOrDefault(TrackerLiveness.PENDING),
                pairedAt = (it["pairedAt"] as? String)?.let { s -> parseIso(s) },
                lastPing = (it["lastPing"] as? String)?.let { s -> parseIso(s) },
                vehicleId = it["vehicleId"]?.toString(),
            )
        }
    }
    private fun mapTraining(body: Map<String, Any?>): List<TrainingLesson> {
        val list = (body["data"] as? List<*>) ?: (body["lessons"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            TrainingLesson(
                id = it["id"].toString(), title = (it["title"] ?: "?").toString(),
                category = (it["course_code"] ?: it["course_title"] ?: "").toString(),
                durationMinutes = (it["duration_minutes"] as? Number)?.toInt() ?: 0,
                progressPct = (it["progress_pct"] as? Number)?.toInt() ?: 0,
                isCompleted = it["is_mandatory"] as? Boolean ?: false,
            )
        }
    }
    private fun mapIssue(row: Map<String, Any?>, fallbackVehicleId: String): VehicleIssue {
        return VehicleIssue(
            id = row["issue_id"].toString(), vehicleId = (row["vehicle_id"] ?: fallbackVehicleId).toString(),
            category = (row["category"] ?: "?").toString(), description = (row["description"] ?: "").toString(),
            severity = runCatching { AnomalySeverity.valueOf((row["severity"] ?: "WARNING").toString()) }.getOrDefault(AnomalySeverity.WARNING),
            reportedAt = (row["reported_at"] as? String)?.let { s -> parseIso(s) } ?: 0,
            resolved = row["resolved"] as? Boolean ?: false,
        )
    }

    // ---- public refresh helpers (wrappers over private loaders) ----
    fun refreshDvirInbox() { scope.launch { loadDvirInbox() } }

    /**
     * Import a fuel statement CSV. Per the backend contract the file is first uploaded as a
     * STATEMENT_IMPORT media object (presigned S3 PUT), then POSTed to /reconciliation/statements
     * with its media_object_id plus the required provider/period/column_mapping fields.
     */
    suspend fun importStatement(fileName: String, csvBytes: ByteArray, provider: String = "generic"): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val mediaId = uploadMedia("STATEMENT_IMPORT", "STATEMENT_IMPORT", "text/csv", csvBytes) ?: return@withContext Result.failure(AppException("MEDIA_QUARANTINED"))
            val today = java.time.LocalDate.now().toString()
            val req = StatementImportRequest(
                provider = provider,
                period_start = today,
                period_end = today,
                media_object_id = mediaId,
                column_mapping = emptyMap(),
            )
            val res = fuelApi.importStatement(req)
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun enrollDriverMfa(password: String, driverId: String): Result<MfaEnrollResult> = withContext(Dispatchers.IO) {
        try {
            val res = authApi.enrollMfa(EnrollMfaRequest(password = password))
            if (res.isSuccessful && res.body() != null) {
                val b = res.body()!!
                Result.success(MfaEnrollResult(b["otpauth_uri"]?.toString() ?: "", (b["recovery_codes"] as? List<*>)?.map { it.toString() } ?: emptyList()))
            } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun revokeDriverSessions(driverId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = authApi.revokeSessions(driverId, mapOf("reason" to "admin_revoked"))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /**
     * Pair a physical tracker to a vehicle (POST /admin/hardware/pair). Returns the installer SMS
     * command the backend computed (brand → SET,/SERVER, form) so the admin can text it to the SIM.
     */
    suspend fun pairTracker(
        vehicleId: String,
        trackerImei: String,
        trackerBrand: String,
        trackerSimNumber: String? = null,
    ): Result<PairResult> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.pairHardware(
                mapOf(
                    "vehicleId" to vehicleId,
                    "trackerImei" to trackerImei,
                    "trackerBrand" to trackerBrand,
                    "trackerSimNumber" to (trackerSimNumber ?: ""),
                ),
            )
            if (res.isSuccessful && res.body() != null) {
                val b = res.body()!!
                Result.success(
                    PairResult(
                        success = b["success"] as? Boolean ?: true,
                        message = b["message"]?.toString() ?: "",
                        smsCommand = b["smsCommand"]?.toString(),
                        simNumber = b["simNumber"]?.toString(),
                    ),
                )
            } else {
                Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    data class PairResult(
        val success: Boolean,
        val message: String,
        val smsCommand: String? = null,
        val simNumber: String? = null,
    )

    /** Unpair a tracker from a vehicle (DELETE /admin/hardware/{vehicleId}/tracker). Idempotent on the backend. */
    suspend fun unpairTracker(vehicleId: String): Result<PairResult> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.unpairHardware(vehicleId)
            if (res.isSuccessful && res.body() != null) {
                val b = res.body()!!
                Result.success(PairResult(success = b.success, message = b.message))
            } else {
                Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── Vehicle master (Pillar 4) ───────────────────────────────────────────────────────────────
    suspend fun createVehicle(req: VehicleCreateRequest): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = vehicleApi.create(req)
            if (res.isSuccessful) { loadVehicleMaster(); Result.success(Unit) }
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun updateVehicle(id: String, req: VehicleUpdateRequest): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = vehicleApi.update(id, req)
            if (res.isSuccessful) { loadVehicleMaster(); Result.success(Unit) }
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun assignVehicle(id: String, driverIds: List<String> = emptyList(), vehicleIds: List<String> = emptyList()): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = vehicleApi.assign(id, VehicleAssignRequest(driver_ids = driverIds, vehicle_ids = vehicleIds))
            if (res.isSuccessful) { loadVehicleMaster(); Result.success(Unit) }
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── Trailer swap (hook / drop) ───────────────────────────────────────────────────────────────
    suspend fun swapTrailer(trailerId: String, vehicleId: String? = null, odometerKm: Long? = null): Result<TrailerSwapResponse> = withContext(Dispatchers.IO) {
        try {
            val res = trailerApi.swap(TrailerSwapRequest(trailer_id = trailerId, vehicle_id = vehicleId, odometer_km = odometerKm))
            if (res.isSuccessful && res.body() != null) Result.success(res.body()!!)
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── Maintenance work order (Pillar 3) ─────────────────────────────────────────────────────────
    suspend fun createWorkOrder(req: WorkOrderRequest): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = maintenanceApi.createWorkOrder(req)
            if (res.isSuccessful) { loadMaintenance(); Result.success(Unit) }
            else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── Privacy / DSAR ────────────────────────────────────────────────────────────────────────────
    suspend fun requestDataExport(notes: String? = null): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = privacyApi.exportRequest(PrivacyExportRequest(notes))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun requestDataDeletion(reason: String? = null): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = privacyApi.deletionRequest(PrivacyDeletionRequest(reason))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── Document renewal notes (docs/08_safety.sql) ───────────────────────────────────────────────
    suspend fun addDocumentRenewalNote(id: String, note: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.renewalNote(id, mapOf("note" to note))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ── User lifecycle (admin console) ──────────────────────────────────────────────────────────
    suspend fun suspendUser(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.suspendUser(id)
            if (res.isSuccessful) { loadDriverRosterData(); Result.success(Unit) } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun reinstateUser(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.reinstateUser(id)
            if (res.isSuccessful) { loadDriverRosterData(); Result.success(Unit) } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun inviteUser(email: String, roleCode: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.inviteUser(mapOf("email" to email, "role_code" to roleCode))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun approveDriver(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.approveDriver(id)
            if (res.isSuccessful) { loadDriverRosterData(); Result.success(Unit) } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /** Invite/create a driver (POST /drivers). Refreshes the roster on success. */
    suspend fun createDriver(email: String, fullName: String, phone: String? = null, roles: List<String> = listOf("DRIVER")): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.createDriver(CreateDriverRequest(email = email, full_name = fullName, phone = phone, roles = roles))
            if (res.isSuccessful) { loadDriverRosterData(); Result.success(Unit) } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /** Assign a manager's vehicle + driver scope (POST /admin/managers/{userId}/assign). */
    suspend fun assignManagerScope(userId: String, vehicleIds: List<String> = emptyList(), driverIds: List<String> = emptyList()): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.managerAssign(userId, ManagerAssignRequest(vehicle_ids = vehicleIds, driver_ids = driverIds))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /** Revoke a role from a tenant user (POST /admin/users/{userId}/roles/revoke). */
    suspend fun revokeRole(userId: String, roleCode: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = dashboardApi.revokeRole(userId, mapOf("role_code" to roleCode))
            if (res.isSuccessful) { loadTenantUsers(); Result.success(Unit) } else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /** Tenant-wide user list (GET /admin/users) for the admin management console. */
    suspend fun loadTenantUsers() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.listUsers()
            if (res.isSuccessful && res.body() != null) _tenantUsers.value = mapTenantUsers(res.body()!!)
        }
    }
    /** Manager roster (GET /admin/managers) for scope assignment. */
    suspend fun loadTenantManagers() = withContext(Dispatchers.IO) {
        safe {
            val res = dashboardApi.listManagers()
            if (res.isSuccessful && res.body() != null) _tenantManagers.value = mapManagers(res.body()!!)
        }
    }

    private fun mapManagers(body: Map<String, Any?>): List<ManagerSummary> {
        val list = (body["managers"] as? List<*>) ?: (body["data"] as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            ManagerSummary(
                id = (it["user_id"] ?: it["id"])?.toString() ?: "",
                email = it["email"]?.toString() ?: "",
                fullName = it["full_name"]?.toString(),
                status = (it["status"] ?: "ACTIVE").toString(),
                roles = (it["roles"] as? List<*>)?.map { r -> r.toString() } ?: emptyList(),
            )
        }
    }

    private fun mapTenantUsers(body: List<Map<String, Any?>>): List<TenantUser> {
        return body.mapNotNull { it as? Map<String, Any?> }.map {
            TenantUser(
                id = (it["id"] ?: it["user_id"])?.toString() ?: "",
                email = it["email"]?.toString(),
                fullName = it["full_name"]?.toString(),
                phone = it["phone"]?.toString(),
                mfaEnrolled = (it["mfa_enabled"] as? Boolean) ?: false,
                status = if ((it["is_active"] as? Boolean) != false) "ACTIVE" else "SUSPENDED",
                roles = (it["role_codes"] as? List<*>)?.map { r -> r.toString() } ?: emptyList(),
                vehicleIds = (it["vehicle_ids"] as? List<*>)?.map { v -> v.toString() } ?: emptyList(),
                driverIds = (it["driver_ids"] as? List<*>)?.map { d -> d.toString() } ?: emptyList(),
            )
        }
    }

    // ── Self profile (admin_profile_settings) ────────────────────────────────────────────────────
    suspend fun changePassword(current: String, newPassword: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = authApi.changePassword(AuthChangePasswordRequest(current, newPassword))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }
    suspend fun updateOwnProfile(fullName: String? = null, phone: String? = null, locale: String? = null): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val body = buildMap<String, Any?> {
                if (fullName != null) put("full_name", fullName)
                if (phone != null) put("phone", phone)
                if (locale != null) put("locale", locale)
            }
            val res = dashboardApi.updateOwnProfile(body)
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    /**
     * Admin KPI dashboard from GET /analytics/company. Mirrors packages/shared CompanyAnalyticsSchema:
     * flat headline counters plus the hierarchical kpis/managers roll-up.
     */
    suspend fun loadAdminDashboard(): Result<AdminDashboard> = withContext(Dispatchers.IO) {
        try {
            val res = analyticsApi.company()
            if (!res.isSuccessful) return@withContext Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            val b = res.body() ?: return@withContext Result.failure(IllegalStateException("empty dashboard"))
            val kpis = b["kpis"] as? Map<*, *> ?: emptyMap<String, Any?>()
            val managers = (b["managers"] as? List<*>)?.mapNotNull { m ->
                (m as? Map<*, *>)?.let {
                    ManagerKpis(
                        userId = it["user_id"]?.toString() ?: "",
                        fullName = it["full_name"]?.toString(),
                        email = it["email"]?.toString() ?: "",
                        kpis = mapKpis(it["kpis"] as? Map<*, *>),
                    )
                }
            } ?: emptyList()
            Result.success(
                AdminDashboard(
                    tenantId = b["tenant_id"]?.toString() ?: "",
                    from = b["from"]?.toString() ?: "",
                    to = b["to"]?.toString() ?: "",
                    activeFleet = (b["active_fleet"] as? Number)?.toInt() ?: 0,
                    openAccidents = (b["open_accidents"] as? Number)?.toInt() ?: 0,
                    pendingDvir = (b["pending_dvir"] as? Number)?.toInt() ?: 0,
                    expiringDocs = (b["expiring_docs"] as? Number)?.toInt() ?: 0,
                    fuelSpend30d = (b["fuel_spend_30d"] as? Number)?.toDouble() ?: 0.0,
                    anomaliesOpen = (b["anomalies_open"] as? Number)?.toInt() ?: 0,
                    kpis = mapKpis(kpis),
                    managers = managers,
                ).also { _adminDashboard.value = it },
            )
        } catch (e: Exception) { Result.failure(e) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun mapKpis(raw: Map<*, *>?): AnalyticsKpis {
        if (raw == null) return AnalyticsKpis()
        return AnalyticsKpis(
            vehicles = (raw["vehicles"] as? Number)?.toInt() ?: 0,
            drivers = (raw["drivers"] as? Number)?.toInt() ?: 0,
            distanceKm = (raw["distanceKm"] as? Number)?.toDouble() ?: 0.0,
            fuelCost = (raw["fuelCost"] as? Number)?.toDouble() ?: 0.0,
            anomalies = (raw["anomalies"] as? Number)?.toInt() ?: 0,
        )
    }

    /**
     * Update admin trigger thresholds. The backend exposes one key per PUT to /admin/settings/triggers
     * (TRIGGER_KEYS allow-list), so we issue two writes: speed limit + fuel anomaly threshold.
     */
    suspend fun updateTriggers(speedKph: Int, fuelPct: Int): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val speedRes = dashboardApi.updateTriggers(mapOf("key" to "speed.limit_kph", "value" to speedKph))
            if (!speedRes.isSuccessful) return@withContext Result.failure(ErrorParser.parse(speedRes.code(), speedRes.errorBody().stringOrNull(), null))
            val fuelRes = dashboardApi.updateTriggers(mapOf("key" to "fuel.anomaly_threshold", "value" to fuelPct))
            if (fuelRes.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(fuelRes.code(), fuelRes.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    data class MfaEnrollResult(val otpauthUri: String, val recoveryCodes: List<String>)

    // ---- admin actions ----
    suspend fun verifyPurchase(purchaseId: String, action: String, adjustedLitres: Double? = null, adjustedAmount: String? = null, rejectionReason: String? = null): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val res = fuelApi.verify(purchaseId, VerifyPurchaseRequest(action, adjustedLitres, adjustedAmount, rejectionReason = rejectionReason))
                if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
            } catch (e: Exception) { Result.failure(e) }
        }

    suspend fun verifyShift(shiftId: String, action: String, flagReason: String? = null): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = shiftsApi.verify(shiftId, VerifyShiftRequest(action, flagReason))
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun acknowledgeAccident(accidentId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = accidentsApi.acknowledge(accidentId)
            if (res.isSuccessful) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun markNotificationRead(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val res = notificationsApi.markRead(id)
            if (res.isSuccessful || res.code() == 204) Result.success(Unit) else Result.failure(ErrorParser.parse(res.code(), res.errorBody().stringOrNull(), null))
        } catch (e: Exception) { Result.failure(e) }
    }

    // ====================================================================
    // MAPPERS (backend row → domain model). Tolerant: missing fields → safe defaults.
    // ====================================================================
    private fun mapShift(m: Map<String, Any?>): DriverShift = DriverShift(
        id = m["shift_id"]?.toString() ?: m["id"].toString(),
        vehicleId = m["vehicle_id"]?.toString(), assignmentId = m["assignment_id"]?.toString(),
        clockInAt = (m["clock_in_at"] as? String)?.let { parseIso(it) },
        clockOutAt = (m["clock_out_at"] as? String)?.let { parseIso(it) },
        startOdometerKm = (m["start_odometer_km"] as? Number)?.toLong(),
        endOdometerKm = (m["end_odometer_km"] as? Number)?.toLong(),
        state = when (m["state"]) { "OPEN" -> ShiftState.OPEN; "PENDING_CLOSEOUT" -> ShiftState.PENDING_CLOSEOUT; else -> ShiftState.CLOSED },
        verificationStatus = m["verification_status"]?.toString(),
    )
    private fun mapVehicle(m: Map<String, Any?>): Vehicle = Vehicle(
        id = m["vehicle_id"].toString(),
        plateNumber = (m["plate"] ?: m["plate_number"] ?: m["license_plate"] ?: "?").toString(),
        model = (m["model"] ?: m["vehicle_class"] ?: "").toString(),
        displayState = parseDisplayState(m["display_state"]?.toString()),
        odometerKm = (m["odometer_km"] as? Number)?.toLong() ?: 0,
        fuelLevelPct = (m["fuel_level_pct"] as? Number)?.toInt(),
        currentDriverName = m["driver_name"]?.toString(),
        lat = (m["latitude"] as? Number)?.toDouble() ?: (m["lat"] as? Number)?.toDouble(),
        lng = (m["longitude"] as? Number)?.toDouble() ?: (m["lng"] as? Number)?.toDouble(),
        locationName = m["location_name"]?.toString(),
        speedKph = (m["last_speed_kph"] as? Number)?.toDouble() ?: (m["speed_kph"] as? Number)?.toDouble(),
        hosAlert = m["hos_alert"] as? Boolean ?: false,
    )
    private fun parseDisplayState(s: String?): VehicleDisplayState = runCatching { VehicleDisplayState.valueOf(s ?: "PARKED") }.getOrDefault(VehicleDisplayState.PARKED)
    private fun mapNotification(m: Map<String, Any?>): NotificationItem = NotificationItem(
        id = m["id"].toString(), title = (m["title"] ?: "Notification").toString(),
        message = (m["body"] ?: m["message"] ?: "").toString(), createdAt = (m["created_at"] as? String)?.let { parseIso(it) } ?: 0,
        isRead = (m["status"]?.toString() ?: "DELIVERED") == "DELIVERED",
    )
    private fun mapAnomaly(m: Map<String, Any?>): AnomalyItem = AnomalyItem(
        id = m["anomaly_id"].toString(), domain = runCatching { AnomalyDomain.valueOf((m["domain"] ?: "SECURITY").toString()) }.getOrDefault(AnomalyDomain.SECURITY),
        title = (m["title"] ?: "Anomaly").toString(), detail = (m["detail"] ?: "").toString(),
        createdAt = (m["created_at"] as? String)?.let { parseIso(it) } ?: 0, vehicleId = m["vehicle_id"]?.toString(),
        severity = runCatching { AnomalySeverity.valueOf((m["severity"] ?: "WARNING").toString()) }.getOrDefault(AnomalySeverity.WARNING),
    )
    private fun mapReconcile(body: Map<String, Any?>?): List<RefuelPurchase> {
        val list = (body?.get("purchases") as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            RefuelPurchase(
                id = it["fuel_purchase_id"].toString(), vehicleId = it["vehicle_id"]?.toString(),
                vehiclePlate = it["vehicle_plate"]?.toString(), driverName = it["driver_name"]?.toString(),
                stationName = it["station_name"]?.toString(), amountSpent = (it["amount_spent"] as? Number)?.toDouble(),
                litersPumped = (it["liters_pumped"] as? Number)?.toDouble(), odometerKm = (it["odometer_km"] as? Number)?.toLong(),
                distanceSinceLastRefuelKm = (it["distance_since_last_refuel"] as? Number)?.toDouble(),
                costPerKm = (it["cost_per_km"] as? Number)?.toDouble(), confidenceScore = (it["confidence_score"] as? Number)?.toDouble(),
                badge = runCatching { FuelPendingBadge.valueOf((it["badge"] ?: "REVIEW").toString()) }.getOrDefault(FuelPendingBadge.REVIEW),
                receiptMediaId = it["receipt_media_object_id"]?.toString(), odometerPhotoMediaId = it["odometer_photo_media_object_id"]?.toString(),
                driverCorrected = it["driver_corrected"] as? Boolean ?: false,
            )
        }
    }
    private fun mapInspectionList(body: Map<String, Any?>?): List<InspectionReport> {
        val list = (body?.get("data") as? List<*>) ?: (body?.get("inspections") as? List<*>) ?: return emptyList()
        return list.mapNotNull { it as? Map<String, Any?> }.map {
            InspectionReport(
                id = it["inspection_id"].toString(), vehicleId = it["vehicle_id"]?.toString(), driverName = it["driver_name"]?.toString(),
                createdAt = (it["created_at"] as? String)?.let { s -> parseIso(s) } ?: 0,
                subject = runCatching { InspectionSubject.valueOf((it["subject"] ?: "VEHICLE").toString()) }.getOrDefault(InspectionSubject.VEHICLE),
                overallStatus = (it["overall_status"] ?: it["status"] ?: "PENDING").toString(),
                defectCount = (it["defect_count"] as? Number)?.toInt() ?: 0, signatureName = (it["signature_name"] ?: "").toString(),
            )
        }
    }
    private fun mapDocument(m: Map<String, Any?>): DocumentItem = DocumentItem(
        id = m["document_id"].toString(), title = (m["title"] ?: "Document").toString(),
        docType = (m["document_type"] ?: m["doc_type"] ?: "?").toString(), ownerName = (m["owner_name"] ?: "").toString(),
        expiresOn = m["expires_on"]?.toString(), daysUntilExpiry = (m["days_until_expiry"] as? Number)?.toInt(),
    )
    private fun parseIso(s: String): Long = runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrDefault(0)

    private fun clearDomainState() {
        _vehicles.value = emptyList(); _activeShift.value = null; _shiftsHistory.value = emptyList()
        _refuelPurchases.value = emptyList(); _dvirReports.value = emptyList(); _accidentReports.value = emptyList()
        _anomalies.value = emptyList(); _notifications.value = emptyList(); _driverRoster.value = emptyList()
        _documents.value = emptyList(); _hardwareDevices.value = emptyList(); _trainingLessons.value = emptyList()
        _trailerAssignments.value = emptyList(); _vehicleIssues.value = emptyList()
    }
}
