# Changelog

All notable changes to the Fleet Management Platform are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to semantic versioning.

## [Unreleased]

### Added
- Mobile apps design docs under `docs/apps/`:
  - `00-overview.md` — single Expo app (role-based), approved decisions D-1…D-14, offline-first +
    real-time architecture, design system, deviations from locked decisions (A3.6, A1.6).
  - `driver.md` — driver screens/journeys, offline queue + photo/socket behavior.
  - `admin.md` — admin tablet screens, live map, escalation console, review queues, admin-provisioned
    MFA enrollment.
  - `IMPLEMENTATION-PROMPT.md` — build brief for `packages/mobile` (phases, structure, invariants,
    DoD, approved deviations, launch gates).
  - `caching.md` — unified offline-safe caching strategy (encrypted MMKV, per-domain TTLs, socket
    invalidate+refetch, prefetch, media/map-tile caching).
  - `security.md` — cross-cutting security spec (WAF/rate-limit, webhook HMAC, input/serialization
    hardening, injection/XSS prevention, media AV scan, Vault+rotation+gitleaks, SCA/SAST/pen-test,
    mobile pinning/root-detect/obfuscation, DPA+ISO27001+SOC2).
- `CHANGELOG.md` (this file).
- **`packages/mobile` (Expo, RN 0.74.5 / Expo SDK 51) — implementation started**:
  - Scaffolded single Expo app with `driver` (phone) + `admin` (tablet) EAS profiles, `tsconfig`
    (Bundler resolution, `@fleet/shared/mobile` + `@/*` paths), `app.json`, `eas.json`, Metro/babel.
  - `@fleet/shared/mobile` RN-safe barrel (excludes Node-only `@sentry/node` server modules).
  - Carbon design system: tokens (primary `#0f62fe`, squared edges, 8px grid) + `Text`, `Button`,
    `Input`, `Card`, `StatusBadge`/`DisplayStateBadge` (N5 precedence), `EmptyState`, `Banner`,
    `Skeleton`, `OfflineBanner`, `ErrorState`, `ListRow`, `PhotoCapture`, `BottomSheet`, `MapView`.
  - Pure-TS core (injected ports, unit-tested in node): `errorCodes` (frozen catalogue → single
    action + D-7 queue disposition), `error`, `i18n` (en/sw, no hardcoded copy), `apiClient` (zod +
    `Idempotency-Key` C5.1 + `CursorPage` D7 + 08 §1 normalization), `session`, `offlineQueue`
    (state machine + D-7 disposition + 24h ceiling B13), `uuid`. `tsc --noEmit` + jest green.
  - Phase 3 core bridges (pure TS, injected native ports): `socket` (driver `driver:shift`/
    `driver:vehicle`/`driver:accident` + admin channels, bearer auth, auth-failure→re-login;
    `RealtimeChannels` extended in `@fleet/shared` with the three driver channels for the gateway),
    `push` (FCM token register + OS-push→inbox sink), `camera` (capture→resize/compress/strip-EXIF
    contract for evidence photos, C5.4).
  - Phase 4 durable offline queue: `expo-sqlite` `QueueStore` (injected `DbPort`) + serialized `Drainer`
    (one-at-a-time replay with frozen idempotency key, D-7 disposition, backoff, `reauth`→onReauth,
    parks when offline).
  - Auth vertical slice: pure `AuthFlow` (login→mfa→setPin→consent→role→authed) over injected
    `Session`; `Session` does login + MFA second leg + recovery-code bypass, device register + offline
    PIN (B12, PIN hashed on-device, lockout ladder 5→lock/10→wipe in `PinService`), consent (C5.5),
    biometric unlock port, logout; `Result` type; screens `Login`/`Mfa`/`SetPin`/`Consent`/`RoleSwitch`
     wired in `App.tsx` + `services.ts`. (27 tests / 7 suites.)
  - Driver journeys (Phase 6): `MediaService` (presigned PUT upload, D5) + `ShiftsService` (clock-in/out,
    B1), `RefuelService` (before/after/receipt, B3), `InspectionsService` (DVIR, fail-item photos, 1.1),
    `AccidentsService` (mayday B17 + report + scene-media, 3.1). Every journey commits online or parks
    the business request in the offline outbox (idempotent, C5.1) after evidence uploads; domain errors
    surface as `ApiError`, transport failures queue. Screens `DriverHome`/`ClockIn`/`ClockOut`/`Refuel`/
    `Inspection`/`Accident` + `DriverRouter` wired in `App.tsx` for the driver role. Reuses
     `@fleet/shared/mobile` zod schemas. (39 tests / 9 suites.)
  - Driver feed + profile (Phase 6 cont.): `FeedService` (notifications over `ws:notifications`, anomalies
     via `GET /anomalies`, own-vehicle live state over `driver:vehicle` + REST snapshot from
     `/dashboard/vehicle-states`); screens `Notifications`/`Anomalies`/`VehicleState`/`Profile` wired into
     `DriverRouter` (socket connects as driver; pushes re-render via `onChange`). (43 tests / 10 suites.)
  - Admin journeys (Phase 8): pure `admin` services — `DashboardService` (live map via
     `GET /dashboard/vehicle-states` + `ws:map:vehicle-states`, accident live via `ws:accident:live`,
     derived counts), `AccidentConsoleService` (`GET /accidents/{id}/telemetry/verify` hash-chain),
     `AnomalyService` (`GET /anomalies`), `DocumentService` (`GET /documents/expiring`),
     `FuelReconcileService` (`GET /fuel/reconciliation-inbox` + verify + `POST /reconciliation/statements`),
     `VerificationService` (`GET /shifts/verification-inbox` + verify/flag), `SecurityService` (MFA enroll
     D-12 via `POST /auth/mfa/enroll`). `AdminRouter` + screens `LiveMap`/`AccidentConsole`/`DvirReview`/
     `FuelReconcile`/`AnomalyFeed`/`ExpiringDocs`/`Drivers` (MFA enroll QR + recovery codes, device/session
     revoke)/`AdminNotifications`/`AdminProfile` wired in `App.tsx` (socket connects as admin).
  - **`packages/ws` gateway driver real-time wiring (Phase 9 / D-3)**: `handleConnection` now accepts
    driver principals and subscribes them to server-decided, per-assignment rooms
    (`driver:shift:<shiftId>`, `driver:vehicle:<vehicleId>`, `driver:accident:<userId>`) so a driver only
    receives their own shift/vehicle/accident events; (re)connect snapshot emits the driver's own vehicle
    + shift state; bus fan-out routes `driver:*` payloads to the affected driver's room by scope. Added
    `DriverRepository` (PG views, parameterised SQL). 10-session cap retained (identity-scoped).
    Gateway unit tests cover driver room subscription + driver-only snapshot + admin-room exclusion;
    ws suite green (19 tests / 4 suites).
  - **Hardening (Phase 10)**: `core/security.ts` (security.md §9, S-4) — root/jailbreak refusal
    (`shouldRefuseRun` blocks boot; offline PIN withheld on ANY compromise), tamper/repackaging check,
    certificate-pin verify over an allow-list (`PinnedEndpoint`), and deep-link validation
    (`validateDeepLink` allow-list; hostile links dropped, never auto-navigate). `App.tsx` gates boot on
    integrity and renders localized `security.rooted*`/`security.tampered*` refusal copy. `push.ts` now
    deep-link-validates incoming FCM payloads before deriving a navigation intent (never auto-executed).
    Offline media upload sequencing (`uploadSequence`) uploads evidence before the referencing business
    record, fail-closed (D6/D-5). a11y large-text scale (`design/a11y.ts`, clamped at 1.6x) + an
    `ErrorBoundary` wrapping each router. `eas.json` adds Expo JS code signing + obfuscation flags;
    `app.json` adds a `security` extra (cert pins, deep-link allow-list, `refuseOnRooted`) and
    `a11y.maxFontSizeMultiplier`. Dedicated GitHub Actions mobile pipeline (`.github/workflows/mobile.yml`):
    mobile typecheck + jest, plus gitleaks secret scan + npm-audit SCA (S-5/S-6).
  - **Admin driver roster + device/session revoke — implemented end-to-end (closes the KNOWN-GAP)**:
    `api/openapi.yaml` defines `GET /drivers` (cursor-paginated `DriverSummary`),
    `POST /devices/{deviceId}/revoke`, `POST /sessions/revoke`, plus `DriverSummary` + `RevokeSessionsRequest`
    schemas. `@fleet/api` now implements them: `AdminRepository.listDrivers` (DRIVER-role users joined to
    non-revoked `app.driver_devices` via `jsonb_agg`, keyset cursor on (email,id), status filter); `AdminService`
    (cursor encode/decode, `revokeDevice`→`device.revokeById`, `revokeSessions`→`auth.logoutAll`); new
    `createAdminRouter` mounted at `${base}` with `GET /drivers` (`user:read`), `POST /devices/:deviceId/revoke`
    (`device:revoke`), `POST /sessions/revoke` (`user:manage`) — all writes through `executeWrite` (audit +
    idempotency). Covered by `admin.service.test.ts` + `admin.routes.test.ts`; `contract.test.ts` allow-lists
    the `DriverSummary`/`RevokeSessionsRequest` DTO schemas. Mobile `DriverRosterService` loads the real roster
    (no local stub); `SecurityService.revokeDevice`/`revokeAllSessions` bind to the locked paths; `DriversScreen`
    refreshes after a revoke. Mobile suite green — **68 tests / 13 suites**; `@fleet/api` suite green —
    **131 tests / 18 suites**; `tsc --noEmit` clean.

### Changed
- `@fleet/api` — added the admin console router (A3.7): `AdminRepository`/`AdminService`/`createAdminRouter`
  for `GET /drivers`, `POST /devices/:deviceId/revoke`, `POST /sessions/revoke` (done earlier; now covered by
  `admin.service.test.ts` + `admin.routes.test.ts`).
- `@fleet/worker` — `retention` job now performs real AWS SigV4 `deleteObject` via a new worker `EnvMediaPresigner`
  when run wet with credentials (dry-run logs otherwise); `emailTransport` is now a real configurable JSON-POST
  provider (N9) degrading to a logged no-op when `EMAIL_API_URL` is absent.
- `db/seed/01_seed.sql` — added `manage_own_mfa` + `revoke_device` permissions (granted to DRIVER + ADMIN) so MFA
  enrol and device revoke return 200; `PermissionCode` union + `PERMISSION_CODES` regenerated.
- `packages/api/test/integration.test.ts` — `:5444` integration suite (idempotency replay, soft-delete rejection,
  DVIR fail-photo, odometer-rollback), gated by `PG_INTEGRATION=1` and run by the CI `integration` job.
- `.github/workflows/ci.yml` — `integration` job now sets `PG_INTEGRATION=1` so the integration suite runs against
  throwaway PG + Redis; `signoff-gates` job documents the human/legal launch gates as required status checks.

### Known gaps
- Firebase/FCM credentials and Google Maps API key to be supplied for EAS builds + map rendering.
- Hard launch legal gates (R-101 DPIA, R-103 HOS/emergency numbers, R-104 DVIR matrix) are sign-off/checklist
  items, not code changes; tracked in the CI `signoff-gates` job.

## [1.0.0] - 2026-08-07

### Added
  - Backend fully implemented and tested (verified: `npm run build` green across 5 packages;
   `npm run test` green — **217 tests / 33 suites**).
  - `@fleet/shared` — kernel: `Result`, `AppError`/RFC7807, `ConfigClient`, transaction/idempotency/
    outbox contracts, logging (redaction), time (EAT), zod schemas, generated `db.ts` types.
  - `@fleet/db` — `createPool`, `transaction` (pre-COMMIT audit + outbox), `BaseRepository`,
    `runMigrations`, `PgIdempotencyService`, `PgOutboxRelay`, `PgConfigClient`.
  - `@fleet/api` — Express: auth, shifts, fuel, accidents, inspections, trailer, media, insights;
    `authenticate`/`requirePermission`/`idempotency` middleware; RFC7807; S3 presign.
   - `@fleet/worker` — Traccar ingest consumer + backfill + derive; outbox relay; **13 jobs** (notifications,
     escalation, hos-recompute, fuel-anomaly, ocr, maintenance-eval, stale-shift, document-expiry,
     efficiency-baseline, partition-maint, retention, reconciliation); **retention** job hard-deletes expired
     media via AWS SigV4 `deleteObject` (wet) and **email** transport is a real configurable JSON-POST provider
     (N9) degrading to a logged no-op when unconfigured.
  - `@fleet/ws` — Socket.IO gateway: token auth, 10-session cap, snapshot-on-connect, channels
    (`map:vehicle-states`, `notifications`, `accident:live`); **driver real-time rooms** added in
    Phase 9 (`driver:shift:<id>`, `driver:vehicle:<id>`, `driver:accident:<userId>`).
- Deploy artifacts: `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/k8s/manifests.yaml`.
- `db/schema` (00–11) + `db/seed` authoritative DDL/seed; generated `shared/src/types/db.ts`.

### Known gaps (backend, non-blocking) — CLOSED
- Integration tests against `:5444`, AWS SigV4 media deletion in `retention`, email transport no-op, and
  missing seed permission codes (`MANAGE_OWN_MFA`, `REVOKE_DEVICE`) were all closed in the Unreleased section.
- Sentry hook (`initErrorReporter`) and `/health/deep` + `/healthz` were already wired. The remaining open
  items are organisational sign-off gates (R-101/R-103/R-104), tracked in the CI `signoff-gates` job.
