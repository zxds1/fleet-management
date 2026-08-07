# Execution Prompt — Fleet Management Platform Mobile Apps

> **Purpose:** Implementation brief for the driver + admin mobile apps. Hand it (with this repo) to
> an engineer or coding agent to build `packages/mobile` (single Expo app, role-based). The backend
> (`@fleet/api`, `@fleet/worker`, `@fleet/ws`, `@fleet/db`, `@fleet/shared`) is **already implemented
> and tested** — build on it, do not re-implement its contracts.

---

## 1. Goal

Implement the **driver** and **admin** mobile apps as a single Expo (React Native) app with role-based
UI, faithful to the **approved product decisions** in `docs/apps/00-overview.md` §1 and the service
boundaries in `docs/backend/*`. Result must pass typecheck, lint, and the test suite, and must enforce
every cross-cutting invariant below.

## 2. Source of truth (read these first, in order — do NOT guess; every behavior below is pinned in one of these)

### App design docs (this folder)
- `docs/apps/00-overview.md` — overview, approved decisions (D-1…D-14), layout, offline + real-time
  architecture, design system, deviations from locked decisions (A3.6, A1.6).
- `docs/apps/driver.md` — driver screens/journeys, offline/photo/socket behavior.
- `docs/apps/admin.md` — admin tablet screens, live map, escalation console, review queues, MFA enrollment.
- `docs/apps/flows.md` — **authoritative screen + flow spec**: every screen, elements/buttons, flows,
  navigation map, and the loading/empty/error/offline/pending state matrix. Implement screens to match
  this exactly; it is the contract for "what's in each screen".
- `docs/apps/IMPLEMENTATION-PROMPT.md` — this brief.
- `docs/apps/screens/` — **screen design images** (provided separately). Read them for visual style,
  spacing, color, and component look. They define *style only*; `flows.md` defines structure/behavior.
  If a screen has no image yet, follow `flows.md` + the shared design system — do not invent layout.

### Backend contracts (already built — build on, do not re-implement)
- `docs/backend/00-overview.md` — monorepo layout, layering contract, OpenAPI→types pipeline.
- `docs/backend/01-shared-kernel.md` — `Result`, `AppError`/RFC7807, `ConfigClient`, `Principal`,
  transaction/idempotency/outbox contracts.
- `docs/backend/02-auth.md` — JWT lifecycle, MFA/TOTP, `DeviceService` (offline PIN), permission union,
  session cap, consent.
- `docs/backend/03-rest-api.md` — route→service map, validation→error matrix, cursor pagination,
  **offline-queue protocol (§8)**, media flow (§9).
- `docs/backend/04-telemetry-ingest.md` — telemetry/derive (context for vehicle `display_state`).
- `docs/backend/05-workers.md` — the 13 jobs (notifications, escalation, fuel-anomaly, OCR, …).
- `docs/backend/06-repository-migrations.md` — repository/soft-delete/append-only rules.
- `docs/backend/07-websocket-gateway.md` — Socket.IO channels, session cap, snapshot-on-connect,
  reconnection. **Note:** currently admin-only — must be extended for driver (D-3).
- `docs/backend/08-error-state-model.md` — full `error_code` catalog + state machines. Map every code to
  localized copy + the single correct action in the apps.
- `docs/backend/09-observability-ci.md` — logging/health/CI expectations.
- `api/openapi.yaml` — the single HTTP contract; `packages/shared/src/schemas/*` are the runtime guards.

### Architecture & risk (gates)
- `docs/architecture/00-locked-decisions.md` — every `A*`/`B*`/`C*`/`D*`/`N*`/`M*` decision. Do not
  contradict; the **only** approved app deviations are D-2 (admin = RN tablet) and D-3 (driver =
  Socket.IO), both recorded in `docs/apps/00-overview.md` §1.
- `docs/architecture/01-service-boundaries.md` — process responsibilities, data ownership.
- `docs/architecture/02-open-risk-register.md` — residual risks + launch gates (R-101…R-112).

### Trackers
- `docs/PROGRESS.md` — live status; update it as you complete phases.
- `CHANGELOG.md` — record completed work under `Unreleased`.

## 3. What already exists (do NOT rebuild)

- `packages/shared` — `Result`, `AppError`/RFC7807, `ConfigClient` types + `CONFIG_DEFAULTS`,
  `Principal`, zod `schemas/*`, generated `db.ts`, `realtime.ts` channel constants, `time.ts`,
  `logging.ts`. Consumes fine in RN (verify no Node-only built-ins; shim if needed).
- `packages/db`, `packages/api`, `packages/worker` — full backend; every endpoint the apps call.
- `packages/ws` — Socket.IO gateway (EXTEND for driver tokens + `driver:shift`/`driver:vehicle`/
  `driver:accident` channels; keep 10-session cap).

## 4. Package to build

```
packages/mobile/        # Expo app (node dist/mobile/... via EAS; no Node server)
  app.json / eas.json   # EAS build profiles: driver (phone) + admin (tablet)
  src/
    design/             # tokens, theme, components (distilled from provided screens)
    core/
      apiClient.ts      # fetch wrapper; injects Idempotency-Key; zod-validates
      session.ts        # auth/session store (expo-secure-store), access/refresh, biometric gate
      offlineQueue.ts   # expo-sqlite durable queue + serial drainer (D-5/D-7)
      socket.ts         # socket.io-client; driver+admin channel subscriptions; snapshot
      push.ts           # expo-notifications + FCM (N9)
      i18n.ts           # i18next en/sw (D-10)
      camera.ts         # expo-camera wrapper: ≤500KB, ≤1080px, EXIF strip (C5.2)
    features/           # shifts, fuel, accidents, inspections, trailer, media, anomalies, auth
    driver/ admin/      # role shells + navigators
    App.tsx             # role switch after login
```

Register `packages/mobile` in the root workspace (`workspaces: ["packages/*"]`) and mirror the
`build`/`typecheck`/`lint`/`test` scripts of the other packages. Use `tsconfig.base.json`.

## 5. Implementation phases (build in this order)

1. **Scaffold** the Expo app (`expo init` equivalent, TypeScript strict), EAS config, empty
   `App.tsx` booting to a "ready" screen; `npm run build` (typecheck) + `npm run test` green on
   skeleton. Confirm `@fleet/shared` imports cleanly in RN (shim Node built-ins if required).
2. **Design system**: tokens + core components (`Button`, `Input`, `Card`, `StatusBadge` w/ N5
   precedence, `OfflineBanner`, `ErrorState`, `PhotoCapture`, `ListRow`, `MapView`, `EmptyState`,
   `BottomSheet`) distilled from the screen images in `docs/apps/screens/` (style only — read them for
   visual language; `flows.md` defines structure).
3. **Core**: `apiClient` (zod + `Idempotency-Key`), `session` (login/refresh, secure store,
   biometric gate, offline PIN via `DeviceService`), `i18n` (en/sw), `socket` (connect + snapshot +
   channel subscribe), `push` (FCM).
4. **Offline queue**: `expo-sqlite` durable store + serial drainer with the D-5/D-7 state machine
   (PENDING→DONE, conflict→discard, hard error→FAILED_REVIEW), 24 h ceiling + forced re-login (B13).
5. **Auth vertical slice** (driver-first, D-13): login, MFA (recover path; enroll is admin side),
   device register + offline PIN, biometric unlock, consent, logout. Role switch in `App.tsx`.
6. **Driver journeys**: clock-in/out + HOS, refuel, DVIR (with offline photo), accident mayday +
   media, anomalies + notifications inbox, own-vehicle live state (socket `driver:*`), profile/settings.
   All writes offline-queued with `Idempotency-Key`.
7. **Admin journeys**: live map (`map:vehicle-states`), accident escalation console, DVIR review,
   fuel reconciliation + statement import, anomaly feed, expiring documents, **driver MFA enrollment
   (D-12)** + device/session revoke, notifications inbox, profile/settings.
8. **Gateway extension** (`packages/ws`): accept driver principals; add `driver:shift`,
   `driver:vehicle`, `driver:accident` channels; keep 10-session cap; snapshot-on-(re)connect. Ship
   behind the same auth path.
9. **Hardening**: FCM wiring with provided Firebase creds, Google Maps key, offline media upload
   sequencing, a11y + large-text, error/empty states, and the GitHub Actions mobile pipeline.

## 6. Cross-cutting invariants (enforce in review + lint)

- **One Idempotency-Key per write (C5.1/D4):** the `offlineQueue`/`apiClient` mints a fresh UUID for
  every state-changing call; replays send the same key. Conflict/duplicate → discard; hard error →
  `FAILED_REVIEW` (D-7).
- **Offline-first (D-5):** queue is durable (`expo-sqlite`); a force-close loses nothing; serial
  drain; exponential backoff (max 30 s); 24 h ceiling → forced re-login (B13).
- **No secrets in logs / secure store only (B12):** PIN hash never leaves device; refresh token +
  biometric-gated key in `expo-secure-store`.
- **Biometric is local only (D-11):** unlocks the store/app; server auth always needs a valid JWT.
- **Media via presigned URL (D5/C5.3):** `POST /media/upload-url` → 60 s PUT to S3; app never sends
  bytes to the API; offline photos upload after the record write (D-6).
- **Real-time scoping (D-3/D-4):** driver subscribes only to `driver:*` + `notifications`; admin to
  `map:vehicle-states` + `notifications` + `accident:live`. 10-session cap enforced server-side.
- **Cursor pagination (D7):** all list views use the `CursorPage` envelope; no `OFFSET`.
- **i18n (D-10):** all user-facing strings via `i18n` en/sw; no hardcoded copy.
- **Handlers thin / types shared:** bind to `@fleet/shared` schemas + `openapi.yaml`; never redefine
  shapes locally.

## 7. Tooling commands

```
npm install                       # workspace deps (adds packages/mobile)
npm run build                     # turbo: tsc -b across packages
npm run typecheck                 # turbo: tsc -b --noEmit
npm run test                      # turbo: jest (unit + contract)
npm run lint                      # turbo: eslint
cd packages/mobile && npx jest    # per-package tests
eas build --profile driver        # EAS build (phone)
eas build --profile admin         # EAS build (tablet)
```

## 8. Definition of Done (per app)

- `tsc -b` clean (strict, `noUncheckedIndexedAccess`).
- Unit tests on `offlineQueue` (replay/idempotency/conflict-discard/hard-error→FAILED_REVIEW, 24 h
  ceiling), `apiClient` (Idempotency-Key injection, error mapping), `session` (refresh, biometric
  gate, offline PIN counters), `socket` (channel subscribe + snapshot) using fakes + `Result`.
- Integration: a throwaway PG + the `:5444` pattern; assert idempotency replay returns cached response,
  odometer-decrease rejection surfaces as `FAILED_REVIEW`, DVIR-fail-photo enforced.
- Contract: app request/response shapes match `shared/schemas` + `openapi.yaml` (no local redefinition).
- Every state-changing call carries `Idempotency-Key`; offline queue durable; media via presigned URL.
- `ws` gateway extended for driver with the three `driver:*` channels; 10-session cap intact.

## 9. Approved deviations from locked architecture

- **D-2 overrides A3.6** — admin is RN/Expo tablet, not web.
- **D-3 overrides A1.6** — driver uses Socket.IO (not HTTP polling only); gateway extended accordingly.

Both are explicitly approved and authoritative for the app build.

## 10. Hard launch gates (do not skip — `02-open-risk-register.md` §C)

- **R-101** DPIA approved (Kenya DPA 2019; data in `af-south-1`; FCM/Vision/Geocoding cross-border
  documented; Google Maps adds further cross-border exposure — accepted per D-9).
- **R-103** HOS figures + emergency numbers confirmed by transport counsel.
- **R-104** DVIR severity matrix reviewed/signed by fleet safety officer.
- **R-109** Redis failure degrades gateway to DB-only session check (already designed).

## 11. First concrete action

Scaffold `packages/mobile` (Expo + TS strict) with an empty but booting `App.tsx`, confirm
`@fleet/shared` imports in RN, get `npm run build` + `npm run test` green on the skeleton, then build
the **design system** + **auth/session/offline-queue core** as the first real vertical slice (driver
login → role switch).
