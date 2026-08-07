# Implementation Progress

> Snapshot as of 2026-08-07. Source of truth: `docs/backend/IMPLEMENTATION-PROMPT.md`,
> `docs/apps/IMPLEMENTATION-PROMPT.md`, and the locked decision docs. Do not contradict
> `docs/architecture/00-locked-decisions.md` / `02-open-risk-register.md`.

## ✅ Backend — Done (verified 2026-08-07)

- `npm run build` green across all 5 packages; `npm run test` green — **209 tests / 31 suites**
  (shared 43, db 6, worker 28, ws 17, api 115).
- `packages/shared` + `packages/db` implemented and tested (kernel + data access).
- `api` / `worker` / `ws` implemented and tested:
  - **API**: auth, shifts, fuel, accidents, inspections, trailer, media, insights — full route→service
    map from `03-rest-api.md`; middleware (`authenticate`, `requirePermission`, `idempotency`); RFC7807;
    S3 presign; telemetry webhook.
  - **Worker**: Traccar ingest consumer + backfill + derive; `PgOutboxRelay` + handlers; **13 jobs**
    (notifications, escalation, hos-recompute, fuel-anomaly, ocr, maintenance-eval, stale-shift,
    document-expiry, efficiency-baseline, partition-maint, retention, accident-freeze, reconciliation).
  - **WS**: Socket.IO gateway — token auth, 10-session cap, snapshot-on-connect, channels
    (`map:vehicle-states`, `notifications`, `accident:live`). **Extend for driver tokens/channels per
    `docs/apps` D-3 before driver real-time works.**
- Live PG on `:5444`; schema/seed validated; `shared/src/types/db.ts` generated (44 enums, 68
  relations, 6 roles, 59 permissions, 49 config rows).
- Deploy artifacts: `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/k8s/manifests.yaml`.

### Backend known gaps (non-blocking)
- Integration tests against `:5444` (odometer-decrease, idempotency replay, DVIR-fail-photo,
  soft-delete rejection) not yet added.
- Real AWS SigV4 signing for media deletion in the `retention` job (deferred dependency).
- Email transport provider wired as a logged no-op.
- Seeded permission codes `MANAGE_OWN_MFA`, `REVOKE_DEVICE` (and any referenced) not yet in `db/seed`.
- Observability/CI (Sentry hook, `/health/deep`, GitHub Actions sign-off gate) and hard launch legal
  gates (R-101 DPIA, R-103 HOS/emergency numbers, R-104 DVIR matrix) still pending.

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

## 🚧 Mobile Apps — Remaining (implementation not started)

### `packages/mobile` (single Expo app, role-based)
- [ ] Scaffold Expo (TS strict) + EAS config (driver phone + admin tablet profiles); boot `App.tsx`;
      confirm `@fleet/shared` imports in RN (shim Node built-ins if required); build + test green.
- [ ] Design system: tokens + components distilled from provided screens (style only).
- [ ] Core: `apiClient` (zod + Idempotency-Key), `session` (login/refresh, secure store, biometric
      gate, offline PIN), `i18n` (en/sw), `socket`, `push` (FCM), `camera` (resize/strip EXIF).
- [ ] Offline queue: `expo-sqlite` durable store + serial drainer; D-5/D-7 state machine
      (PENDING→DONE, conflict→discard, hard error→FAILED_REVIEW); 24 h ceiling + forced re-login.
- [ ] Auth vertical slice (driver-first): login, MFA recover (enroll is admin side), device register +
      offline PIN, biometric unlock, consent, logout; role switch.

### Driver journeys
- [ ] Clock-in/out + HOS (offline-queued, error mapping).
- [ ] Refuel / fuel purchase (offline-queued; async anomaly scoring).
- [ ] DVIR inspection (offline-queued; offline photo capture + later upload).
- [ ] Accident mayday + media (offline-queued; media posts when online; mayday no-photo B17).
- [ ] Anomalies + notifications inbox; own-vehicle live state (`driver:*` socket); profile/settings.

### Admin journeys
- [ ] Live map (`map:vehicle-states`); accident escalation console; DVIR review; fuel reconciliation +
      statement import; anomaly feed; expiring documents; **driver MFA enrollment (D-12)** + device/
      session revoke; notifications inbox; profile/settings.

### Gateway extension (`packages/ws`)
- [ ] Accept driver principals; add `driver:shift`, `driver:vehicle`, `driver:accident` channels;
      keep 10-session cap; snapshot-on-(re)connect.

### Hardening / launch
- [ ] FCM wiring (Firebase creds), Google Maps key, offline media upload sequencing.
- [ ] Unit + integration tests per `IMPLEMENTATION-PROMPT.md` §8.
- [ ] GitHub Actions mobile pipeline; re-run backend launch gates (R-101/R-103/R-104).
