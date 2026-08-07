# Mobile App Design — Driver

**Status:** Design (no code). **Depends on:** `00-overview.md`, `docs/backend/02-auth.md`,
`03-rest-api.md` (§2.2, §2.3, §2.4, §2.5, §2.6, §8, §9), `07-websocket-gateway.md`.

The driver app runs on Android 10+ (Phase 1), BYOD permitted (A3.4). It is the **offline-first**
field tool for a driver: clock in/out, refuel, DVIR, accident mayday, and view their own status.

---

## 1. Entry & role switch

After a successful login the `Principal.roles`/permissions decide the shell: a driver (or a user with
only driver-scoped permissions) gets the **driver shell**; a dispatcher/fleet-manager/finance/admin
gets the **admin shell** (see `admin.md`). A user with both sees a role picker on first launch.

---

## 2. Screens / journeys (v1 must-haves, D-13 "all")

| # | Journey | Key endpoints | Notes |
|---|---|---|---|
| 1 | **Auth + MFA + offline PIN** | `POST /auth/login`, `/auth/mfa/enroll`(admin side), `/auth/mfa/recover`, `/auth/refresh`, `/devices/register`, `PUT /devices/{id}/pin`, `/auth/logout` | Biometric unlock of secure store (D-11). Offline PIN for field re-auth (B12/B13). |
| 2 | **Clock-in / clock-out + HOS** | `POST /shifts/clock-in`, `POST /shifts/clock-out`, `GET /shifts/me/active`, `GET /shifts/verification-inbox` | Full guard chain surfaced as actionable errors (`ODOMETER_DECREASED`, `CONSENT_REQUIRED`, `HOS_REST_BLOCKED`, `CLOCKOUT_PENDING`, `NO_ASSIGNMENT`). Offline-queued. |
| 3 | **Refuel / fuel purchase** | `POST /fuel/refuel`, `GET /fuel/reconciliation-inbox` | Before+after gauge; offline-queued; anomalies scored async (server). |
| 4 | **DVIR inspection** | `POST /inspections` | Failing item requires a photo (`DVIR_FAIL_NEEDS_PHOTO`); defects-reviewed enforced. Offline-queued; photo captured + uploaded later (D-6). |
| 5 | **Accident mayday + media** | `POST /accidents/mayday`, `POST /accidents`, `POST /accidents/{id}/media`, `POST /accidents/{id}/acknowledge` | Mayday bypasses photo requirements (B17) and triggers escalation. Offline-queued; media posts when online. |
| 6 | **Anomalies + notifications inbox** | `GET /anomalies`, `GET /notifications`(via socket `notifications`), `GET /documents/expiring` | Read-only feeds; cursor pagination. |
| 7 | **Live map / own vehicle state** | socket `driver:vehicle` + `driver:shift`; `GET /dashboard/vehicle-states` as fallback | No fleet map (D-4). |
| 8 | **Profile + settings** | `GET /consent/required`, `POST /consent`, locale toggle | Language en/sw (D-10); GPS consent acceptance (C5.5). |

---

## 3. Clock-in flow (offline-aware)

```
Tap Clock In
  → validate assignment_id + start_odometer_km (zod) + capture start photo (B1) + GPS consent accepted
  → enqueue { POST /shifts/clock-in, Idempotency-Key=UUID, status=PENDING }
  → optimistic "Pending" badge
  → on flush success: 201 { shift_id, clock_in_at }; show active shift
  → on flush hard error (ODOMETER_DECREASED / CONSENT_REQUIRED / HOS_REST_BLOCKED / CLOCKOUT_PENDING):
        move to FAILED_REVIEW, show explainer + Edit/Retry (D-7)
  → on flush IDEMPOTENCY_CONFLICT (replay w/ different body): DISCARD (D-7)
```

All clock-in error codes from `03` §5 / `08` §1 are mapped to plain-language, driver-actionable copy
(localized en/sw).

---

## 4. Offline queue (D-5/D-7)

- Durable in `expo-sqlite`; a force-close never loses pending ops.
- Single serial drainer; replays in enqueue order; **same `Idempotency-Key`** header on replay.
- States: `PENDING → DONE | FAILED_REVIEW` (+ `INFLIGHT` transient).
- `FAILED_REVIEW` items remain visible in an "Outbox / Pending" screen with `error_code`, retry, edit,
  or discard. Conflict/duplicate replays are discarded silently with a toast (D-7).
- 24 h ceiling: after 24 h without a successful auth, force online login (B13); a suspended driver is
  rejected (`ACCOUNT_SUSPENDED`) and shown "Account suspended. Contact Admin."

---

## 5. Media capture + offline upload (D-6)

- `expo-camera` / `expo-image-picker`; enforce ≤500 KB, ≤1080 px, EXIF stripped (C5.2) at capture.
- Offline: store file locally, attach reference to the queued record.
- On flush: write the record → `POST /media/upload-url` (60 s PUT) → PUT bytes to S3 → patch the
  referencing field (`start_media_object_id`, accident media slot, inspection item photo). If the
  upload fails, the record goes to `FAILED_REVIEW` (kept, not discarded).
- Accident media uses the Object-Locked bucket (D5/C5.3); mayday needs no photo (B17).

---

## 6. Real-time (D-3/D-4)

- One Socket.IO connection to `ws` with the access token; subscribes to `driver:shift`,
  `driver:vehicle`, `driver:accident`, `notifications`.
- Snapshot on (re)connect (gateway sends current shift + vehicle state).
- If the socket drops, the app falls back to `GET /dashboard/vehicle-states` / `GET /shifts/me/active`
  on a 10 s poll and shows `OFFLINE` state (N5 precedence) for the driver's own vehicle.
- FCM push (`expo-notifications`, N9) delivers personal alerts when the app is backgrounded.

---

## 7. Error & empty states

- Every `error_code` from `08` is mapped to a localized message + the single correct driver action.
- Global `OfflineBanner` whenever the queue has `PENDING`/`FAILED_REVIEW` items or connectivity is down.
- `EmptyState` for empty feeds/inbox; `ErrorState` for non-retryable failures.

---

## 8. Invariants this document locks

1. Every driver write carries a fresh client `Idempotency-Key` UUID (C5.1/D4).
2. Offline queue is durable and serial; replay is safe by construction.
3. Conflict/duplicate replays are discarded; hard domain errors go to `FAILED_REVIEW` (D-7).
4. Driver real-time is Socket.IO but **only** their own shift/vehicle/accident + personal notifications
   (D-3/D-4).
5. Biometric unlocks local secure store only; server auth always requires a valid JWT.
6. Media is upload-via-presigned-URL; the app never sends image bytes to the API directly.
