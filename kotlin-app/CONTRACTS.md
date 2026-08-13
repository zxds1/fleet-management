# FleetPulse Android — Implementation Contract (canonical reference for all agents)

This is the production Android (Kotlin + Jetpack Compose) app for the FleetPulse backend.
It REPLACES the hardcoded stub. The backend in `D:\fleetmanagement` (branch `main`) is the source
of truth. The app MUST bind to the real API — never hardcode data, never invent endpoints.

## Package
`com.fleetpulse.app` (was `com.example`). All new files go under
`kotlin-app/app/src/main/java/com/fleetpulse/app/`.

## Backend base URL
Via `BuildConfig.API_BASE_URL` (from `local.properties` / gradle `buildConfigField`).
Default dev: `http://10.0.2.2:8787` (emulator → host loopback). The Expo app uses port 8787.
Auth routes are mounted at `/auth/*`, driver/admin at `/driver/*` `/admin/*`, plus `/shifts`,
`/fuel`, `/inspections`, `/accidents`, `/media`, `/dashboard`, `/anomalies`, `/notifications`,
`/documents`, `/me`, `/trailer`, `/vehicles`, `/hardware`.

## Auth response → Principal (mirror packages/mobile/src/core/auth/schemas.ts `toPrincipal`)
POST /auth/login (anonymous) body: { email? | phone?, password, mfa_code?, device_id_hash? }.
- If response has `mfa_required:true` + `mfa_challenge_token` → MFA screen, second leg
  POST /auth/mfa/verify { mfa_challenge_token, code }.
- Session body (sessionBody in packages/api/src/http/routes/auth.ts):
  access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, session_id,
  user_id, email, phone, roles:string[], permissions:string[], locale:"en"|"sw".
- Principal: userId, tenantId (from tenant_id or BOOTSTRAP), email, phone?, roles:RoleCode[],
  permissions:Set<PermissionCode>, deviceIdHash?, sessionId?, locale.
- Token: access JWT HS256 15m (in memory only), refresh opaque 7d + 24h offline window.
  NEVER decode the JWT. Build Principal from the response body.
- Roles union (db/schema/01_enums.sql): DRIVER, DISPATCHER, FLEET_MANAGER, ADMIN, FINANCE, AUDITOR.
- SHELL selection: derive from permissions, NOT role strings. A principal with any non-driver
  permission → can use ADMIN shell; pure DRIVER → DRIVER shell only. Mixed → role picker.

## Per-request contract (mirror packages/mobile/src/core/apiClient.ts)
- Header `Authorization: Bearer <accessToken>`.
- Header `Idempotency-Key: <UUID>` on EVERY non-GET/DELETE state-changing request.
- Header `x-request-id: <UUID>` on every request; read echoed `x-request-id` for correlation.
- Header `Accept: application/json` on GET; `content-type: application/json` otherwise.
- Errors: `application/problem+json` body `{ error_code, title, status, detail?, field_errors?[] }`.
  The app branches ONLY on `error_code` (packages/shared/src/errors.ts catalogue).
- Cursor pagination envelope: `{ data:[], next_cursor:string|null, has_more:bool }`.
- Retry: transport 408/429/502/503/504 with jittered exp backoff (cap 30s), honour Retry-After.
  Only GET/called-unsafe reads auto-retry; business writes are replayed by the offline drainer.

## Offline queue protocol (docs/backend/03-rest-api.md §8, docs/apps/driver.md §4)
- Every driver write persisted locally with a FRESH `Idempotency-Key` UUID + request body + retries.
- Serial drainer replays in enqueue order, sending the SAME Idempotency-Key header on replay.
- States: PENDING → INFLIGHT → DONE | FAILED_REVIEW (+ DISCARDED).
  - IDEMPOTENCY_CONFLICT (replay w/ different body) → DISCARD silently + toast.
  - IDEMPOTENCY_INFLIGHT → keep, retry after backoff.
  - Other hard domain errors (ODOMETER_DECREASED, CONSENT_REQUIRED, HOS_REST_BLOCKED,
    CLOCKOUT_PENDING, NO_ASSIGNMENT, MISSING_GAUGE_PAIR, DVIR_FAIL_NEEDS_PHOTO,
    DEFECTS_NOT_REVIEWED, etc.) → FAILED_REVIEW, keep visible with retry/edit/discard.
  - 24h offline ceiling without successful auth → force online login, reset queue.
- Durable in Room; force-close must not lose pending ops.

## Media flow (docs/backend/03-rest-api.md §9)
- POST /media/upload-url { owner_kind, retention_class, content_type, width_px?, height_px?,
  client_captured_at? } → 201 { media_object_id, upload_url (PUT, 60s), method:"PUT" }.
- PUT bytes (≤500KB, ≤1080px, EXIF stripped) to upload_url. Then reference object id in the
  write (start_media_object_id, odometer_photo_media_object_id, receipt_media_object_id,
  accident slot media_object_id, inspection item photo_media_object_id).
- owner_kind ∈ {WORK_LOG, INSPECTION_ITEM, FUEL_RECORD, FUEL_PURCHASE, EXPENSE, ACCIDENT_REPORT,
  ASSET_DOCUMENT, TRAILER_ASSIGNMENT, MAINTENANCE_RECORD, QUARANTINE_EVENT, STATEMENT_IMPORT}.
- retention_class ∈ {WORK_PLAN, INSPECTION, FUEL_RECEIPT, FUEL_DASHBOARD, EXPENSE_RECEIPT,
  ACCIDENT, ASSET_DOCUMENT, MAINTENANCE, STATEMENT_IMPORT, TRAILER_SWAP}.

## Realtime
- ADMIN uses Socket.IO gateway (packages/shared/src/realtime.ts channels):
  ws:map:vehicle-states, ws:notifications, ws:accident:live. Connect with Bearer token;
  gateway emits unprefixed events map:vehicle-states / notifications / accident:live.
  Snapshot on (re)connect. Auth rejection (ACCOUNT_SUSPENDED/DEVICE_REVOKED) → force re-login.
- DRIVER uses HTTP polling (docs/backend/07 §1: "ws serves admin clients only; drivers use HTTP
  polling"). Poll GET /dashboard/vehicle-states + GET /shifts/me/active every ~10s; show OFFLINE
  state for own vehicle when socket/polling fails. Notifications via FCM (stretch) + manual fetch.

## Key request schemas (packages/shared/src/schemas/*)
- ClockIn: { assignment_id:uuid, start_odometer_km:int≥0, start_fuel_gauge:EMPTY|QUARTER|HALF|
  THREE_QUARTER|FULL, start_media_object_id:uuid, phone_gps_fallback_enabled:bool,
  consent_version:str, planned_notes?, work_plan_media_object_ids?:uuid[≤5] }
- ClockOut: { shift_id:uuid, end_odometer_km:int≥0, end_fuel_gauge, end_media_object_id:uuid,
  debrief_notes? }
- PhotoFirstRefuel: { shift_id:uuid|null, vehicle_id:uuid, odometer_reading:int≥0,
  receipt_media_object_id:uuid, odometer_photo_media_object_id:uuid, fuel_card_last_four:/^\d{4}$/?,
  purchased_at:ISO }
- InspectionSubmit: { shift_id:uuid, template_id:uuid, subject:VEHICLE|TRAILER|TRAILER_SWAP,
  vehicle_id?:uuid, previous_defects_reviewed:bool, signature_name:str, items:[{template_item_id,
  result:PASS|FAIL|NOT_APPLICABLE, numeric_value?, notes?, photo_media_object_id?}] }
- Mayday: { shift_id?:uuid, vehicle_id?:uuid, position:{latitude,longitude}, mayday_reason:str }
- AccidentCreate: { shift_id?, vehicle_id?, occurred_at?, position?, position_source?, driver_statement?,
  witness_*, third_party_*, police_ob_number?, insurance_claim_number? }
- AccidentMedia: { slot:FRONT_DAMAGE|REAR_DAMAGE|SIDE_DAMAGE|OTHER_VEHICLE_PLATE|WITNESS|ADDITIONAL|
  POLICE_ABSTRACT|INSURANCE_DOCUMENT, media_object_id:uuid }
- VerifyPurchase: { action:VERIFY|REJECT|CLEAR_PAYMENT, adjusted_litres?, adjusted_amount?,
  adjusted_odometer?, rejection_reason?, admin_notes? }
- VerifyShift: { action:VERIFY|FLAG, flag_reason?, corrected_end_odometer_km? }

## Vehicle display state (docs/backend 01 enums + v_vehicle_display_state precedence)
QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED. Use a sealed/enum
`VehicleDisplayState` with this exact precedence (highest wins).

## Error codes to branch on (packages/shared/src/errors.ts ERROR_CODE_BUCKET)
client: VALIDATION_ERROR, UNAUTHENTICATED, MFA_REQUIRED, FORBIDDEN, ACCOUNT_SUSPENDED,
  DEVICE_REVOKED, IP_BLOCKED, SESSION_REVOKED, CONSENT_REQUIRED, NOT_FOUND, CLOCKOUT_PENDING,
  SHIFT_ALREADY_OPEN, UNLOCK_REQUIRED, NO_ASSIGNMENT, DUPLICATE, SESSION_LIMIT,
  IDEMPOTENCY_CONFLICT, OFFLINE_PIN_LOCKED
business: ODOMETER_DECREASED, ODOMETER_DIVERGENCE, HOS_REST_BLOCKED, MISSING_GAUGE_PAIR,
  DVIR_FAIL_NEEDS_PHOTO, DEFECTS_NOT_REVIEWED, WORK_PLAN_REQUIRED, ONBOARDING_PROFILE_EMPTY,
  ONBOARDING_CONSENT_REQUIRED, BACKGROUND_CHECK_ALREADY_CLEARED, MEDIA_QUARANTINED
transient: SERVICE_UNAVAILABLE, RATE_LIMITED, IDEMPOTENCY_INFLIGHT
Map each to localized (en/sw) plain-language copy + the single correct user action.

## i18n
en + sw required. Locale sourced from Principal.locale; user may toggle. Use Android string resources
with a `values-sw` folder OR a simple in-code map keyed by locale. Keep strings centralized.

## Architecture (layered, single Activity + Compose Navigation)
com.fleetpulse.app
  .app            FleetApplication (Hilt-less: manual DI via object graph), SessionGraph
  .data
    .remote       ApiClient (OkHttp+Retrofit+AuthInterceptor+IdempotencyInterceptor),
                  SocketClient (admin), Endpoints (retrofit interfaces), DTOs + Moshi,
                  ErrorParser (RFC7807 → AppException with error_code)
    .local        AppDatabase (Room), QueueDao, DraftDao, SessionPrefs (DataStore/Encrypted), PinStore
    .repo         FleetRepository (single source of truth: StateFlows), OfflineQueue + Drainer
    Models.kt     domain models (NO hardcoded data), enums matching backend
  .domain         PermissionCode, RoleCode, principal logic, usecases (optional/minimal)
  .ui
    .theme        Color/Type/Theme (keep existing bento palette)
    .auth         Login/Mfa/Signup/Consent/OfflinePin/RoleSwitch/Suspended/Forgot
    .driver      Home, ClockIn/Out, Refuel, Inspection(DVIR), Accidents/Mayday, Outbox,
                 Anomalies, Notifications, MyShifts, Documents, Onboarding, Training, Profile,
                 VehicleState, VehicleIssue
    .admin       Dashboard, LiveMap, AccidentConsole+Detail, DvirReview+Detail, FuelReconcile+
                 Detail, StatementImport, AnomalyFeed+Detail, ExpiringDocs+Detail, Drivers+Detail,
                 Hardware, SettingsTriggers, TrainingReview, Vehicles+Detail, Vehicles list,
                 AdminManagement, Profile, Notifications
    .components   OfflineBanner, ErrorState, EmptyState, PermissionGate, AsyncImage, BottomBar, etc.
  MainActivity   sets Compose content, hosts NavHost (auth ↔ driver ↔ admin graphs)

NO hardcoded fake principal / fake fleet data. All initial state = empty + loading.
The stub's `FleetRepository`/`Models`/`AppDatabase` are REWRITTEN. Keep the existing theme files.
