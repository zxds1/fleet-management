# Mobile Apps Design 00 — Overview

**Status:** Design (no code). **Source of truth:** `docs/architecture/00-locked-decisions.md`,
`01-service-boundaries.md`, `docs/backend/*` (especially `02-auth`, `03-rest-api`, `07-websocket-gateway`),
and the agreed product decisions recorded in `docs/apps/IMPLEMENTATION-PROMPT.md`.

This is the entry point for the **driver** and **admin** mobile apps. Both are built as a **single
Expo (React Native) app** with role-based UI, sharing one design system and one offline core.

---

## 1. Approved product decisions (locked for the apps)

| # | Area | Decision |
|---|---|---|
| D-1 | Repo structure | **One Expo app**, role-based UI switched by `Principal` role/permission. Shares design system + offline core. |
| D-2 | Admin platform | **RN/Expo tablet app** (deviates from locked A3.6 "web"; approved). |
| D-3 | Driver real-time | **Socket.IO added to driver** (deviates from locked A1.6 "HTTP polling only"; approved). |
| D-4 | Driver RT content | Own shift state + own vehicle display state + personal notifications + accident escalation they're part of. No full fleet map. |
| D-5 | Offline | **Full offline-first**: durable local queue, client UUID `Idempotency-Key` per write, flush on reconnect, 24 h ceiling (B13). |
| D-6 | Offline media | Capture + store locally, attach to queued record, upload to S3 when back online. |
| D-7 | Offline failure UX | **Conflict/duplicate** (`IDEMPOTENCY_CONFLICT`, replay) → **discard**. **Hard domain errors** (`ODOMETER_DECREASED`, `VALIDATION_ERROR`, `DVIR_FAIL_NEEDS_PHOTO`, `DEFECTS_NOT_REVIEWED`, …) → **move to "failed, review"** state for user action. |
| D-8 | Push | FCM direct via `expo-notifications`; Firebase creds supplied by product. |
| D-9 | Maps | **Google Maps** (DPIA exposure accepted). |
| D-10 | Languages | **English + Swahili** (en/sw) toggle, both apps. |
| D-11 | Auth | MFA/TOTP + offline PIN + biometric unlock. |
| D-12 | TOTP seeding | **Admin-provisioned**: admin app generates/assigns the driver TOTP seed. |
| D-13 | Scope/order | Both apps; **driver-first**; all driver journeys are v1 must-haves. |
| D-14 | State mgmt | TanStack Query (server cache) + Zustand (client/UI state). |

> **Deviations from locked architecture:** D-2 overrides **A3.6** (admin web → RN tablet) and D-3
> overrides **A1.6** (driver polling → Socket.IO). Both are explicitly approved product decisions and
> are treated as authoritative for the app build. The `ws` gateway must be extended to accept driver
> principals and expose driver-scoped channels (see §6, §8).

---

## 2. Package layout

```
packages/
  ├── shared/        # already built — types, schemas, errors, config, time, Result
  ├── db/            # already built — pool, transaction, repos, idempotency, outbox, config client
  ├── api/           # already built — REST + media presign + telemetry webhook
  ├── worker/        # already built — ingest + 13 jobs + outbox relay
  ├── ws/            # already built — Socket.IO gateway (EXTEND for driver tokens/channels)
  └── mobile/        # NEW — the single Expo app (driver + admin)
        src/
          design/         # design system: tokens, theme, components (distilled from provided screens)
          core/           # api client, auth/session store, offline queue, socket client, secure store, i18n
          features/       # shared feature modules (shifts, fuel, accidents, inspections, trailer, media, anomalies)
          driver/         # driver-only screens + navigation
          admin/          # admin-only screens + navigation (incl. driver MFA enrollment)
          App.tsx         # role switch: mounts driver or admin shell after login
```

Both driver and admin consume `@fleet/shared` (workspace `*`); the app binds to the exact
`openapi.yaml` shapes via the shared zod schemas.

---

## 3. Tech stack

| Concern | Choice |
|---|---|
| Framework | Expo (managed) + EAS Build; Android 10+ Phase 1, iOS Phase 2 (A3.4). |
| Language | TypeScript (strict), shared with backend. |
| Navigation | React Navigation (stack + bottom tabs); role-based root switch. |
| Server state | TanStack Query (`@tanstack/react-query`) — queries + mutations over the API client. |
| Client state | Zustand — auth/session, offline queue, socket connection, locale. |
| Networking | `fetch` wrapper around `@fleet/shared` schemas; `Idempotency-Key` injected by the offline core. |
| Real-time | `socket.io-client` (driver + admin); connect with access token. |
| Secure storage | `expo-secure-store` — refresh token + biometric-gated key. |
| Biometric | `expo-local-authentication` — unlocks the secure store only (not a server auth factor). |
| Offline queue | `expo-sqlite` (durable) + in-memory pending list; Zustand mirror for UI. |
| Push | `expo-notifications` + FCM (N9) direct. |
| Maps | `react-native-maps` with **Google** provider (D-9). |
| Media | `expo-camera` / `expo-image-picker`; S3 presigned PUT (60 s) via `/media/upload-url`. |
| i18n | `i18next` + `expo-localization`; `en` + `sw`. |
| Validation | `zod` (shared schemas) on the client; mirrors server. |

---

## 4. Design system

The screens you provide define **style only**; we distill them into a shared design system so driver
and admin look coherent:

- **Tokens:** color palette (brand, semantic/status, surface), typography scale, spacing, radius,
  elevation, icon set.
- **Components:** `Button`, `Input`, `Card`, `StatusBadge` (N5 precedence colors), `PhotoCapture`,
  `OfflineBanner`, `ErrorState`, `BottomSheet`, `ListRow` (cursor pages), `MapView` wrapper,
  `EmptyState`, `Banner`.
- **Status precedence** (N5) for any vehicle/asset state chip: `QUARANTINED > OFFLINE > HOS_ALERT >
  SPEEDING > MOVING > IDLING > PARKED`.
- **Offline affordances:** a global `OfflineBanner` + per-item pending/failed states so the queue is
  always visible.

---

## 5. Offline-first architecture (D-5/D-6/D-7)

```
Write action (clock-in, refuel, DVIR, accident, trailer swap)
   │
   ├─ build request body (zod-validated)
   ├─ mint Idempotency-Key = UUID            ── every write, per backend §8
   ├─ enqueue to expo-sqlite (durable) with status = PENDING
   └─ optimistic UI update (status badge: pending)
        │
        ▼  connectivity returns / every 10 s + on app foreground
   Flush worker (single serial drainer)
      for each PENDING (oldest first):
        PUT/POST with same Idempotency-Key header
          ├─ 2xx cached response  → mark DONE (replay-safe)
          ├─ 409 IDEMPOTENCY_INFLIGHT → retry after backoff
          ├─ 422 IDEMPOTENCY_CONFLICT (replay w/ different body) → DISCARD (D-7)
          ├─ 4xx hard (ODOMETER_DECREASED, VALIDATION_ERROR, DVIR_FAIL_NEEDS_PHOTO, …)
          │       → move to FAILED_REVIEW (D-7): keep in queue, surface error_code, user edits/retries/discards
          └─ network/5xx → leave PENDING, exponential backoff (max 30 s)
      offline ceiling: if > 24 h since last successful auth → force online re-login (B13),
                        on re-login flush remaining; suspended → ACCOUNT_SUSPENDED (B13)
```

Media (D-6): a photo captured offline is stored locally (file URI) and attached to the queued
record. On flush, the record write is sent first (to obtain the entity id), then
`POST /media/upload-url` mints the 60 s PUT, the bytes are uploaded to S3, and the referencing
field is patched. If media upload fails, the record is marked `FAILED_REVIEW` rather than discarded.

---

## 6. Real-time architecture (D-3/D-4)

Both apps open **one** Socket.IO connection (the `ws` gateway) using the access token. The gateway
must be extended (see `IMPLEMENTATION-PROMPT.md` §4) to:

- accept **driver** principals (currently admin-only, `07` §2),
- enforce the **10-session cap** per user (already Redis-enforced),
- on (re)connect send a **snapshot** of the subscribed views.

| Channel | Audience | Payload | Notes |
|---|---|---|---|
| `map:vehicle-states` | admins | `v_vehicle_display_state` (N5) | unchanged from `07` §3 |
| `notifications` | the user | user-scoped `app.notifications` | unchanged |
| `accident:live` | on-call roster | accident create/escalate | unchanged |
| `driver:shift` | **the driver** | their shift state transitions | NEW (D-4) |
| `driver:vehicle` | **the driver** | their vehicle `display_state` | NEW (D-4) |
| `driver:accident` | **the driver** | escalation status for accidents they filed | NEW (D-4) |

Driver does **not** receive the fleet map channel. Admin notifications also reach the device via FCM
when the socket is down (N9), so the admin tablet is not blind in the background.

---

## 7. Auth & security (D-11/D-12)

- Login: `POST /auth/login` (email, password, optional `mfa_code`, `device_id_hash`) → access (15 min,
  in memory) + refresh (7 d, offline window 24 h, in `expo-secure-store`).
- MFA/TOTP is **admin-provisioned** (D-12): the admin app calls `POST /auth/mfa/enroll` on behalf of a
  driver, displays/generates the TOTP seed (QR/setup key), and the driver imports it into an
  authenticator app. The secret is encrypted server-side; recovery codes shown once.
- Offline PIN (`DeviceService`, B12/B13/M4): a 4-digit PIN, hash never leaves the device; 5 fails →
  15 min local lock; 10 fails → wipe local PIN + force online re-login.
- **Biometric** (`expo-local-authentication`) gates unlocking the secure store / app only; it is **not**
  a server auth factor. Server auth still requires a valid JWT (refreshed as needed).
- Session cap (A1.6): 10/user; eviction notifies the user.
- All tokens/keys in `expo-secure-store`; never log secrets.

---

## 8. What already exists (reuse, do not rebuild)

- `@fleet/shared`: `Result`, `AppError`/RFC7807, `ConfigClient` types, `Principal`, zod `schemas/*`,
  generated `db.ts` types, `realtime.ts` channel constants, `time.ts`, `logging.ts`.
- `@fleet/api`: every endpoint the apps call (auth, shifts, fuel, accidents, inspections, trailer,
  media, insights) — see `03-rest-api.md`.
- `@fleet/ws`: Socket.IO gateway (extend for driver; §6).
- `@fleet/worker`: FCM/Africa's Talking/email notifications, OCR, reconciliation, accident freeze.
- `api/openapi.yaml`: the single HTTP contract the apps bind to.

---

## 9. Later documents

| Doc | Expands |
|---|---|
| `driver.md` | Driver app screens, journeys, offline/photo/socket behavior. |
| `admin.md` | Admin app screens, live map, escalation console, review queues, driver MFA enrollment. |
| `IMPLEMENTATION-PROMPT.md` | Build brief: phases, structure, invariants, commands, DoD. |
