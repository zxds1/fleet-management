# Implementation Progress

> Snapshot as of 2026-08-07. Source of truth: `docs/backend/IMPLEMENTATION-PROMPT.md`,
> `docs/apps/IMPLEMENTATION-PROMPT.md`, and the locked decision docs. Do not contradict
> `docs/architecture/00-locked-decisions.md` / `02-open-risk-register.md`.

## ✅ Backend — Done (verified 2026-08-07)

- `npm run build` green across all 5 packages; `npm run test` green — **217 tests / 33 suites**
  (shared 43, db 6, worker 28, ws 17, api 131).
- `packages/shared` + `packages/db` implemented and tested (kernel + data access).
- `api` / `worker` / `ws` implemented and tested:
  - **API**: auth, shifts, fuel, accidents, inspections, trailer, media, insights — full route→service
    map from `03-rest-api.md`; middleware (`authenticate`, `requirePermission`, `idempotency`); RFC7807;
    S3 presign; telemetry webhook.
  - **API (admin console / A3.7)**: `AdminRepository.listDrivers` (DRIVER-role users joined to non-revoked
    `app.driver_devices` via `jsonb_agg`, keyset cursor on (email,id), status filter); `AdminService` (cursor
    encode/decode, `revokeDevice`→`device.revokeById`, `revokeSessions`→`auth.logoutAll`); new
    `createAdminRouter` mounted at `${base}` with `GET /drivers` (`user:read`), `POST /devices/:deviceId/revoke`
    (`device:revoke`), `POST /sessions/revoke` (`user:manage`) — all writes through `executeWrite` (audit +
    idempotency). Covered by `admin.service.test.ts` + `admin.routes.test.ts`; `contract.test.ts` allow-lists
    the `DriverSummary` / `RevokeSessionsRequest` DTO schemas.
  - **Worker**: Traccar ingest consumer + backfill + derive; `PgOutboxRelay` + handlers; **13 jobs**
    (notifications, escalation, hos-recompute, fuel-anomaly, ocr, maintenance-eval, stale-shift,
    document-expiry, efficiency-baseline, partition-maint, retention, accident-freeze, reconciliation).
  - **WS**: Socket.IO gateway — token auth, 10-session cap, snapshot-on-connect, channels
    (`map:vehicle-states`, `notifications`, `accident:live`). **Driver real-time now wired (Phase 9 /
    D-3): driver principals are accepted and subscribed to per-assignment `driver:shift`/`driver:vehicle`/
    `driver:accident` rooms; driver fan-out routes each event to exactly the affected driver's room.**
- Live PG on `:5444`; schema/seed validated; `shared/src/types/db.ts` generated (44 enums, 68
  relations, 6 roles, 59 permissions, 49 config rows).
- Deploy artifacts: `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/k8s/manifests.yaml`.

### Backend known gaps (non-blocking, organisational only)
- Hard launch legal gates (R-101 DPIA, R-103 HOS/emergency numbers, R-104 DVIR matrix) are
  sign-off/checklist items tracked in the CI `signoff-gates` job — not code changes. R-102 (Traccar
  version pin) and R-105 (Swahili native-speaker review) likewise.
- All previously-open code gaps are now closed:
  - `:5444` integration suite added (`packages/api/test/integration.test.ts`, gated by `PG_INTEGRATION=1`,
    runs in the CI `integration` job against throwaway PG+Redis).
  - `retention` job now performs real AWS SigV4 `deleteObject` via `EnvMediaPresigner` (worker) when
    run wet with credentials; dry-run logs otherwise.
  - Email transport is a real configurable JSON-POST provider (N9) degrading to a logged no-op when
    `EMAIL_API_URL` is absent.
  - Seed now includes `manage_own_mfa` + `revoke_device` (granted to DRIVER + ADMIN), so MFA enrol and
    device revoke are 200, not 403. `PermissionCode` union + `PERMISSION_CODES` regenerated.
  - Sentry hook (`initErrorReporter`) and `/health/deep` + `/healthz` were already wired; the CI
    sign-off gate job documents the human/legal gates as required status checks.

## ✅ Mobile Apps — Design (docs only, 2026-08-07)

- `docs/apps/00-overview.md` — overview + approved decisions D-1…D-14 + offline/real-time architecture
  + design system + deviations (A3.6, A1.6).
- `docs/apps/driver.md` — driver screens/journeys, offline queue + photo/socket behavior.
- `docs/apps/admin.md` — admin tablet screens, live map, escalation console, review queues,
  admin-provisioned MFA enrollment.
- `docs/apps/IMPLEMENTATION-PROMPT.md` — build brief for `packages/mobile`.
- `docs/apps/caching.md` — caching strategy (unified offline-safe, encrypted MMKV, per-domain TTLs,
  socket→invalidate+refetch, prefetch on launch+reconnect, media/map-tile caching); referenced by the
  implementation prompt §2 + §6.
- `docs/security.md` — cross-cutting security spec (backend + mobile + CI): WAF/rate-limit, webhook
  HMAC, input/serialization hardening, injection/XSS prevention, media AV scan-on-PUT, Vault+rotation+
  gitleaks, SCA/SAST/pen-test, mobile pinning/root-detect/obfuscation, monitoring, DPA+ISO27001+SOC2.
  Referenced by both `IMPLEMENTATION-PROMPT.md` files.
- `CHANGELOG.md` created (captures backend 1.0.0 + app design work).

## 🚧 Mobile Apps — In Progress (snapshot 2026-08-07)

### `packages/mobile` (single Expo app, role-based)
- [x] Scaffold Expo (TS strict) + EAS config (driver phone `driver` + admin tablet `admin` profiles);
      boot `App.tsx` "ready" screen; `@fleet/shared/mobile` RN-safe subpath added (omits Node-only
      `@sentry/node`); `tsc --noEmit` + `jest` green (14 tests / 3 suites) on `src/core`.
- [x] Design system: Carbon tokens (primary `#0f62fe`, squared edges, 8px grid) + components
      (`Text`, `Button`, `Input`, `Card`, `StatusBadge`/`DisplayStateBadge` w/ N5 precedence,
      `EmptyState`, `Banner`, `Skeleton`, `OfflineBanner`, `ErrorState`, `ListRow`, `PhotoCapture`,
      `BottomSheet`, `MapView`).
- [x] Core (pure TS behind injected ports, unit-tested in node): `errorCodes` (frozen catalogue →
      single action + D-7 disposition), `error`, `i18n` (en/sw, no hardcoded copy — D-10),
      `apiClient` (zod + `Idempotency-Key` C5.1 + `CursorPage` D7 + 08 §1 normalization),
      `session` (login/refresh/logout, principal/roles/permissions/locale), `offlineQueue`
      (`OutboxItem` state machine, in-memory `QueueStore`, D-7 disposition handling, 24h ceiling B13),
      `uuid`.
- [x] Core (remaining): `socket` (driver subscribes `driver:shift`/`driver:vehicle`/`driver:accident`,
      admin subscribes `map:vehicle-states`/`notifications`/`accident:live`; bearer auth + auth-failure →
      re-login; injected Socket.IO factory, unit-tested), `push` (FCM token register + OS push → inbox
      sink, injected port), `camera` (capture→resize/compress/strip-EXIF contract, injected picker).
- [x] Offline queue: `expo-sqlite` durable `QueueStore` (injected `DbPort`, unit-tested) + serialized
      `Drainer` (replays one item at a time with frozen idempotency key; D-7 disposition; backoff;
      `reauth` → onReauth; parks when offline), unit-tested with fakes.
- [x] Auth vertical slice (driver-first): pure `AuthFlow` orchestration (login → mfa → setPin →
      consent → role → authed) over an injected `Session`; `Session` does login + MFA second leg +
      recovery-code bypass, device register + offline PIN (B12, PIN hashed on-device, hash pushed to
      server, lockout ladder 5→lock/10→wipe in `PinService`), consent (C5.5), biometric unlock port,
      logout; `Result` type. Screens: `Login`, `Mfa`, `SetPin`, `Consent`, `RoleSwitch`; wired in
      `App.tsx` router + `services.ts` composition root. Unit-tested (27 tests total).

### Driver journeys
- [x] Core services (pure, injected ports, unit-tested): `MediaService` (presigned PUT upload, D5),
      `ShiftsService` (clock-in/out + active lookup, B1), `RefuelService` (before/after/receipt, B3),
      `InspectionsService` (DVIR, fail-item photos, 1.1), `AccidentsService` (mayday B17 + report +
      scene-media attach, 3.1). All commit online or park the business request in the offline outbox
      (idempotent, C5.1) after evidence is uploaded; domain 4xx/5xx surface as `ApiError`, transport
      failures queue. Reuse `@fleet/shared/mobile` zod schemas (no redefined shapes).
- [x] Screens + `DriverRouter`: `DriverHome`, `ClockIn`, `ClockOut`, `Refuel`, `Inspection`, `Accident`
      (Carbon + i18n, no hardcoded copy), wired in `App.tsx` after auth for the driver role.
- [x] Feed + profile: `FeedService` (notifications over `ws:notifications`, anomalies via `GET /anomalies`,
      own-vehicle live state over `driver:vehicle` + REST snapshot from `/dashboard/vehicle-states`); screens
      `Notifications`, `Anomalies`, `VehicleState`, `Profile`; wired into `DriverRouter` (socket connects as
      driver, pushes re-render via `onChange`). Driver journeys complete.

### Admin journeys
- [x] Core services (pure, injected `ApiClient` + `SocketClient`): `DashboardService` (live map via
      `GET /dashboard/vehicle-states` + `ws:map:vehicle-states`, accident live via `ws:accident:live`,
      derived counts), `AccidentConsoleService` (escalation + `GET /accidents/{id}/telemetry/verify`
      hash-chain check), `AnomalyService` (`GET /anomalies`, domain filter), `DocumentService`
      (`GET /documents/expiring`), `FuelReconcileService` (`GET /fuel/reconciliation-inbox` + verify +
      `POST /reconciliation/statements`), `VerificationService` (`GET /shifts/verification-inbox` +
      verify/flag), `SecurityService` (MFA enroll D-12 via `POST /auth/mfa/enroll`), `DriverRosterService`
      (`GET /drivers`, cursor-paginated). `SecurityService.revokeDevice` binds to `POST /devices/{deviceId}/revoke`
      and `revokeAllSessions` to `POST /sessions/revoke`.
- [x] `AdminRouter` + screens `LiveMap`, `AccidentConsole`, `DvirReview`, `FuelReconcile`,
      `AnomalyFeed`, `ExpiringDocs`, `Drivers` (MFA enroll QR + recovery codes, device/session revoke
      from the real roster), `AdminNotifications`, `AdminProfile`; wired in `App.tsx` (socket connects as
      admin, feeds bind). Admin journeys complete.
- [x] **Contract closure (previously KNOWN-GAP):** `api/openapi.yaml` defines `GET /drivers`,
       `POST /devices/{deviceId}/revoke`, `POST /sessions/revoke` plus `DriverSummary` / `RevokeSessionsRequest`
       schemas. `DriverRosterService` loads the real roster; `DriversScreen` no longer uses a local stub and
       refreshes after a revoke. The `@fleet/api` server handlers are implemented (see Backend Done below),
       covered by `admin.service.test.ts` (cursor/revoke) + `admin.routes.test.ts` (DriverSummary mapping),
       and the OpenAPI contract gate (`contract.test.ts`) now allows the new DTO schemas.

### Gateway extension (`packages/ws`) — DONE (Phase 9)
- [x] Accepts driver principals; `handleConnection` branches on `roles` (DRIVER vs admin) and subscribes
      a driver to server-decided, per-assignment rooms — `driver:shift:<shiftId>`, `driver:vehicle:<vehicleId>`,
      `driver:accident:<userId>` — so a driver only ever receives their own shift/vehicle/accident events.
- [x] Driver (re)connect snapshot emits the driver's own vehicle display state + own shift state
      (07 §5); admin rooms/snapshots unchanged.
- [x] Bus fan-out for `driver:shift` / `driver:vehicle` / `driver:accident` routes each payload to the
      affected driver's room by `shift_id` / `vehicle_id` / `user_id` scope (07 §3/§5).
- [x] `DriverRepository` added (`activeContext`, `vehicleState`, `shiftState` over PG views, parameterised
      SQL). 10-session cap retained (identity-scoped). `RealtimeChannels.driver*` already defined in
      `@fleet/shared`; `@fleet/shared` rebuilt so `packages/ws` resolves them from dist.
- [x] Tests: gateway unit tests cover driver room subscription + driver-only snapshot + admin-room
      exclusion; full ws suite green (19 tests / 4 suites).

### Hardening (Phase 10) — DONE
- [x] **Mobile app hardening (security.md §9, S-4)** in `packages/mobile/src/core/security.ts` (pure, port-
      injected, unit-tested): device integrity (root/jailbreak refusal `shouldRefuseRun` + offline-PIN
      withholding on ANY compromise), tamper/repackaging check, certificate-pin verify (`verifyPin` over
      `PinnedEndpoint` allow-list), and deep-link validation (`validateDeepLink` allow-list of schemes/hosts;
      hostile/unknown links dropped, never auto-navigate). `App.tsx` gates boot on `shouldRefuseRun` and
      renders the localized `security.rooted*` / `security.tampered*` refusal copy.
- [x] **Push (FCM) + deep-link safety (`push.ts`)**: `Push.start` registers the FCM token + sinks OS pushes
      into the unified inbox; incoming payloads are deep-link-validated via `Security.validateDeepLink` before
      any navigation intent is derived (never auto-executed — security.md §5). i18n `security.*` keys already
      present (en/sw).
- [x] **Offline media upload sequencing (`media.ts` + `uploadSequence`)**: evidence photos upload (presigned
      PUT) *before* the business record that references them is queued; fail-closed — any upload failure
      aborts the batch so no record references a missing `media_object_id` (D6/D-5).
- [x] **a11y + large-text (`design/a11y.ts`)**: `clampFontSizeMultiplier` caps OS scaling at 1.6x (tokens
      `a11y.maxFontSizeMultiplier`) so large text does not break admin tables; `scaledFontSize` + `nextLargeTextTier`
      drive a settings toggle. `ErrorBoundary` component added (`design/components/ErrorBoundary.tsx`) and
      wraps the driver/admin routers in `App.tsx` for render-crash isolation.
- [x] **Build config**: `eas.json` adds `updates.codeSigning` (Expo JS code signing, RSA) + obfuscation env
      flags; `app.json` adds a `security` extra (cert-pin allow-list from `$API_CERT_PIN_SHA256`/`$WS_CERT_PIN_SHA256`,
      deep-link allow-list, `refuseOnRooted`) and `a11y.maxFontSizeMultiplier`.
- [x] **GitHub Actions mobile pipeline** (`.github/workflows/mobile.yml`): dedicated job runs mobile typecheck
      + jest, plus secret scan (gitleaks) and SCA (npm audit) — the S-5/S-6 controls. Mobile is also covered by
      the root `ci.yml` build/lint/typecheck/test.
- [x] **Tests**: `security.test.ts` (integrity refusal + pin verify + deep-link validation), media `uploadSequence`
      (ordered ids + fail-closed), `a11y.test.ts` (clamp/scale/tier), `admin.test.ts` (`DriverRosterService` from
      `GET /drivers` + `SecurityService` revoke). Mobile suite green — **68 tests / 13 suites**;
      `tsc --noEmit` clean.

### Launch gates (still open)
- [x] Backend `:5444` integration suite added (`packages/api/test/integration.test.ts`, `PG_INTEGRATION=1`,
      runs in CI `integration` job) covering idempotency replay, soft-delete rejection, DVIR fail-photo,
      and odometer-rollback.
- [ ] Mobile integration tests per `IMPLEMENTATION-PROMPT.md` §8 (against `:5444`); blocked on Firebase/FCM
      creds + Google Maps keys for EAS builds.
- [ ] Re-run backend launch gates (R-101 DPIA, R-103 HOS/emergency numbers, R-104 DVIR matrix) — sign-off
      tracked in the CI `signoff-gates` job.
- [ ] Supply Firebase/FCM creds + Google Maps keys for EAS builds.
