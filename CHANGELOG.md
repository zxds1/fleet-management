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
- `CHANGELOG.md` (this file).

### Changed
- (none yet — implementation not started)

### Known gaps
- Mobile app implementation not started; design/contract docs only.
- `packages/ws` must be extended for driver Socket.IO (D-3) before driver real-time works.
- Firebase/FCM credentials and Google Maps API key to be supplied for EAS builds + map rendering.

## [1.0.0] - 2026-08-07

### Added
- Backend fully implemented and tested (verified: `npm run build` green across 5 packages;
  `npm run test` green — **209 tests / 31 suites**).
  - `@fleet/shared` — kernel: `Result`, `AppError`/RFC7807, `ConfigClient`, transaction/idempotency/
    outbox contracts, logging (redaction), time (EAT), zod schemas, generated `db.ts` types.
  - `@fleet/db` — `createPool`, `transaction` (pre-COMMIT audit + outbox), `BaseRepository`,
    `runMigrations`, `PgIdempotencyService`, `PgOutboxRelay`, `PgConfigClient`.
  - `@fleet/api` — Express: auth, shifts, fuel, accidents, inspections, trailer, media, insights;
    `authenticate`/`requirePermission`/`idempotency` middleware; RFC7807; S3 presign.
  - `@fleet/worker` — Traccar ingest consumer + backfill + derive; outbox relay; **13 jobs**.
  - `@fleet/ws` — Socket.IO gateway: token auth, 10-session cap, snapshot-on-connect, channels
    (`map:vehicle-states`, `notifications`, `accident:live`).
- Deploy artifacts: `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/k8s/manifests.yaml`.
- `db/schema` (00–11) + `db/seed` authoritative DDL/seed; generated `shared/src/types/db.ts`.

### Known gaps (backend, non-blocking)
- Integration tests against `:5444` (odometer-decrease, idempotency replay, DVIR-fail-photo,
  soft-delete) not yet added.
- Real AWS SigV4 signing for media deletion in the `retention` job (deferred dependency).
- Email transport provider wired as a logged no-op.
- Some seeded permission codes (`MANAGE_OWN_MFA`, `REVOKE_DEVICE`) not yet present in `db/seed`.
- Observability/CI (Sentry hook, `/health/deep`, GitHub Actions sign-off gate) and hard launch legal
  gates (R-101 DPIA, R-103 HOS/emergency numbers, R-104 DVIR matrix) still pending.
