# Mobile Apps — Screen & Flow Specification (`flows.md`)

**Status:** Design (no code). **Companion to:** `00-overview.md`, `driver.md`, `admin.md`,
`IMPLEMENTATION-PROMPT.md`. **Source of truth for screens:** the approved decisions D-1…D-14 and the
backend contracts in `docs/backend/02-auth.md`, `03-rest-api.md`, `07-websocket-gateway.md`.

This document lists **every screen** the driver and admin apps need, what each contains (fields,
lists, **buttons**), the **flow** when a button is tapped (API call → transition → state), and how each
screen behaves across **loading / empty / error / offline / pending** states. Screen style is taken
from the designs you will provide; only structure + behavior are fixed here.

Global rule: every state-changing tap enqueues an offline write with a fresh `Idempotency-Key`
(D-5). Conflict/duplicate replays are discarded; hard errors move the item to `FAILED_REVIEW` (D-7).

---

## A. Cross-app shells (both apps)

### A.1 Splash / Boot
- **Purpose:** init secure store, resolve locale, attempt silent token refresh.
- **Contains:** app logo; spinner.
- **Flow:** on cold start → try `POST /auth/refresh` with stored refresh token.
  - success → go to Role Switch (if multi-role) or the user's shell.
  - `ACCOUNT_SUSPENDED` → Suspended screen. refresh missing/expired → Login.
- **States:** none beyond spinner; suspended/offline (refresh fails → Login).

### A.2 Role Switch
- **Reached from:** Splash, when the `Principal` has **both** driver-scoped and admin-scoped
  permissions.
- **Contains:** two large cards — **"Continue as Driver"**, **"Continue as Admin"**; locale toggle.
- **Flow:** tap → mounts `driver/App` or `admin/App` root navigator. Choice remembered for the session.

### A.3 Biometric Unlock (system prompt, not a screen)
- **Flow:** when a valid refresh token exists but the secure store is biometric-gated, the OS prompt
  appears; success unlocks the store and refreshes the access token. Failure → Login. Biometric is
  **local only** (D-11) — never a server auth factor.

### A.4 Global Offline Outbox (reachable from `OfflineBanner`)
- **Reached from:** the persistent `OfflineBanner` (shown whenever queue has `PENDING`/`FAILED_REVIEW`
  or no connectivity) and from More/Settings.
- **Contains:** list of queued items with `status` chip (`PENDING` / `INFLIGHT` / `FAILED_REVIEW`),
  `error_code` (if failed), timestamp; per item **Retry**, **Edit**, **Discard** (for `FAILED_REVIEW`);
  global **Flush now** (forces a drain attempt).
- **Flow:** Retry → re-drain that item; Edit → opens the originating form prefilled; Discard → removes
  from queue (with confirm); Flush now → runs the serial drainer.
- **States:** empty (all synced) → "All changes synced" empty state.

### A.5 Bottom navigation — Driver
Tabs: **Home**, **Refuel**, **Inspect**, **Accidents**, **More**. `More` opens Profile/Settings +
Outbox. Active-shift quick action floats on Home.

### A.6 Side navigation — Admin (tablet)
Sections: **Dashboard**, **Live Map**, **Accidents**, **DVIR Review**, **Fuel**, **Anomalies**,
**Documents**, **Drivers**, **Notifications**, **Settings**. Active incident counters show as badges.

---

## B. Driver app screens

### B.1 Login
- **Purpose:** authenticate (email + password; optional MFA; device register).
- **Reached from:** Splash (no session) / Logout.
- **Contains:** Email field, Password field (toggle reveal), **Log in** (primary), **Forgot? / Need
  device?** (links to admin/IT), locale toggle, offline indicator.
- **Flow:** tap Log in → `POST /auth/login`:
  - `401 UNAUTHENTICATED` → inline error, increment attempt UI.
  - `403 DEVICE_UNKNOWN` → message "Register this device first" + **Register device** button →
    `POST /devices/register` then back to login.
  - `403 ACCOUNT_SUSPENDED` → Suspended screen. `403 CONSENT_REQUIRED` → Consent screen.
  - `401 MFA_REQUIRED` → MFA Challenge. success → Device register (if new) → Role Switch / shell.
- **States:** loading (spinner on button), error (inline), offline (button disabled with "You're
  offline — login needs connection" unless a refresh token can satisfy it).

### B.2 MFA Challenge (driver)
- **Reached from:** Login when `mfa_enabled`.
- **Contains:** 6-digit code field, **Verify** (primary), **Use recovery code** (secondary →
  `POST /auth/mfa/recover`), **Cancel**.
- **Flow:** Verify → re-`POST /auth/login` with `mfa_code`; wrong → `401 UNAUTHENTICATED`, clear field.

### B.3 Offline PIN (field re-auth)
- **Reached from:** app foreground after offline period, or when a stored session needs local
  re-auth without network.
- **Contains:** 4-digit PIN pad, **Unlock** (primary), attempts remaining, **"Can't unlock? Go
  online"**.
- **Flow:** correct PIN → unlock secure store, continue. 5 fails → 15 min local lock (`OFFLINE_PIN_LOCKED`);
  10 fails → wipe local PIN + force online Login (B12/B13/M4).

### B.4 Driver Home
- **Reached from:** Role Switch / post-login.
- **Contains:**
  - Active-shift card (if any): status, vehicle, clock-in time, **Clock Out** (primary, if active).
  - If no active shift: **Clock In** (primary) → Clock-In screen.
  - Own-vehicle status chip (N5 precedence: QUARANTINED/OFFLINE/HOS_ALERT/SPEEDING/MOVING/IDLING/PARKED),
    updates via `driver:vehicle` socket.
  - Today's anomalies count (tap → Anomalies), unread notifications badge (tap → Notifications).
  - Quick links: Refuel, Inspect, Report Accident, My Vehicle.
- **Flow:** each quick link navigates; socket updates refresh the chips live; pull-to-refresh →
  `GET /shifts/me/active` + `GET /dashboard/vehicle-states`.

### B.5 Clock-In
- **Reached from:** Home → Clock In.
- **Contains:**
  - Assignment picker (**Assignment** — list of driver's assignments; required).
  - Start odometer field (numeric, km) — validated `≥ vehicle.current_odometer_km`.
  - Start photo capture (**Camera** — `start_media_object_id`, required B1).
  - GPS consent status banner (if not accepted → **Accept consent** → Consent screen).
  - HOS rest indicator (shows if blocked).
  - **Clock In** (primary), **Cancel**.
- **Flow:** tap Clock In → zod-validate → enqueue `POST /shifts/clock-in` (Idempotency-Key) → optimistic
  "Pending" → navigate Home (active shift card shows pending). On flush:
  - `201` → active shift shown. `409 CLOCKOUT_PENDING` / `NO_ASSIGNMENT` / `SHIFT_ALREADY_OPEN` →
    `FAILED_REVIEW`. `422 ODOMETER_DECREASED` / `HOS_REST_BLOCKED` / `CONSENT_REQUIRED` → `FAILED_REVIEW`
    with plain-language copy + **Edit**. `422 IDEMPOTENCY_CONFLICT` (replay) → discard.

### B.6 Clock-Out
- **Reached from:** Home (active shift) → Clock Out.
- **Contains:** end odometer (≥ start), end photo capture (required B1), optional notes, **Clock Out**
  (primary), **Cancel**.
- **Flow:** enqueue `POST /shifts/clock-out`; missing close-out artefact → server sets `PENDING_CLOSEOUT`
  (B7) → shown on Home with "Complete close-out" action linking back here.

### B.7 My Shifts (history)
- **Reached from:** Home → More → My Shifts.
- **Contains:** cursor-paged list (date, vehicle, duration, status, verification status); tap → shift
  detail (read-only: odometer, gauges, photos, verification state).
- **Flow:** paginate (`cursor`) → `GET /shifts/verification-inbox` filtered to driver.

### B.8 Refuel (new)
- **Reached from:** Home → Refuel or bottom-nav Refuel.
- **Contains:**
  - Assignment/shift context (current active shift auto-filled).
  - Before-gauge % + After-gauge % (required pair B3), litres, cost, odometer, fuel-card last four.
  - Receipt photo capture (optional; OCR later).
  - **Submit refuel** (primary), **Cancel**.
- **Flow:** enqueue `POST /fuel/refuel` (Idempotency-Key) → optimistic pending. On flush: `422
  MISSING_GAUGE_PAIR` → `FAILED_REVIEW`; `201` → success toast; anomalies scored asynchronously
  (server), surfaced later in Anomalies.

### B.9 Fuel History
- **Reached from:** Refuel → History / More.
- **Contains:** cursor list of the driver's purchases + reconciliation status; tap → purchase detail
  (`verified`/`rejected`/`cleared` with reason). Pull-to-refresh → `GET /fuel/reconciliation-inbox`.

### B.10 DVIR List
- **Reached from:** bottom-nav Inspect.
- **Contains:** list of inspection templates + recent submissions (status: SUBMITTED/REVIEWED/FLAGGED,
  any BLOCKER quarantine); **New inspection** (primary) → DVIR Form; tap → DVIR Detail.

### B.11 DVIR Form (new)
- **Reached from:** DVIR List → New inspection.
- **Contains:**
  - Template selector; vehicle/trailer auto from active assignment.
  - Per-item rows: pass/fail toggle, notes; **failing item requires a photo** (`DVIR_FAIL_NEEDS_PHOTO`)
    → PhotoCapture.
  - "Previous defects reviewed?" acknowledgement (required; `DEFECTS_NOT_REVIEWED` otherwise).
  - **Submit** (primary), **Save draft** (local only), **Cancel**.
- **Flow:** enqueue `POST /inspections`; photo captured offline → stored locally, uploaded after the
  record write (D-6). On flush: `422 DVIR_FAIL_NEEDS_PHOTO` / `DEFECTS_NOT_REVIEWED` → `FAILED_REVIEW`.
  `201 { inspection_id, block_shift }` → if `block_shift`, Home shows "Vehicle quarantined" banner.

### B.12 DVIR Detail
- **Reached from:** DVIR List → row.
- **Contains:** items (pass/fail, photos, notes), review state, quarantine flag; read-only for driver.

### B.13 Accident (new mayday / report)
- **Reached from:** Home → Report Accident.
- **Contains:**
  - **Mayday** toggle (priority: bypasses photo requirement B17, triggers escalation).
  - Location (auto from GPS / phone fallback), description, severity.
  - **Add photo / video** (accident media; stored offline if no signal, uploaded later D-6).
  - **Submit report** (primary) / **Submit MAYDAY** (red, when toggle on), **Cancel**.
- **Flow:** enqueue `POST /accidents/mayday` (or `POST /accidents`); on flush `201` → "Accident
  submitted" + go to Accident Detail. Media posts via `POST /accidents/{id}/media` after reconnect.

### B.14 My Accidents (list) + B.15 Accident Detail
- **List:** cursor page of driver's reports (status, mayday flag, escalation state); tap → Detail.
- **Detail:** status, description, media gallery, **escalation status** (armed timer / acknowledged /
  escalated tier) via `driver:accident` socket; **Acknowledge** (if driver is on-call/responsible) →
  `POST /accidents/{id}/acknowledge`; **Add media**; telemetry-chain verify result (read-only).

### B.16 Anomalies (feed)
- **Reached from:** Home badge / More.
- **Contains:** cursor list from `GET /anomalies` (domains FUEL/HOS/ACCIDENT/MAINTENANCE/SECURITY),
  status chip, severity; tap → detail (description, evidence, recommended action). Filters by domain.

### B.17 Notifications (inbox)
- **Reached from:** bell badge.
- **Contains:** user-scoped list via `notifications` socket + `GET /notifications`; unread dot;
  tap → marks read + deep-links to the related entity (shift/accident/anomaly). **Mark all read**.

### B.18 My Vehicle (live)
- **Reached from:** Home → My Vehicle.
- **Contains:** mini-map (own vehicle only, Google D-9) + `display_state` chip + last position/time;
  live via `driver:vehicle`; fallback `GET /dashboard/vehicle-states` poll when socket down.

### B.19 Documents (expiring, scoped)
- **Reached from:** More → Documents.
- **Contains:** `GET /documents/expiring` (within_days) for the driver's assets; list with expiry date
  + countdown; tap → detail. (Read-only; admin manages.)

### B.20 Profile / Settings
- **Contains:** driver name/role, **Language** (en/sw toggle, D-10), **GPS consent** status → Consent
  screen, **Device** (registered device label, **Reset offline PIN**), **Log out** (→ `POST /auth/logout`,
  clears store), **Open Outbox**.
- **Flow:** Log out → confirm → Splash. Language change → re-render via i18n.

### B.21 Consent (GPS)
- **Reached from:** Login/`403 CONSENT_REQUIRED` / Settings.
- **Contains:** policy version (`GET /consent/required`), **Accept** (→ `POST /consent`), **Decline**
  (→ cannot start shift). On accept → return to prior screen.

### B.22 Suspended
- **Reached from:** login/refresh `ACCOUNT_SUSPENDED`.
- **Contains:** "Account suspended. Contact Admin." + **Log out**. No further navigation.

---

## C. Admin app screens (tablet)

### C.1 Login (admin) / C.2 MFA Challenge (admin, mandatory) / C.3 Biometric
Same as B.1–B.3, but MFA is **mandatory** for ADMIN/FLEET_MANAGER (`02` §3); recovery path identical.

### C.4 Dashboard (home)
- **Contains:** summary cards — active vehicles, vehicles QUARANTINED/OFFLINE, open accidents (with
  mayday highlight), pending DVIR, open anomalies, expiring-documents count; each card → the relevant
  screen. Unread notifications badge → Notifications.

### C.5 Live Map
- **Reached from:** side nav Map.
- **Contains:** fleet map (Google D-9) with vehicle markers colored by N5 precedence; **filter**
  (status/assignment); tap marker → Vehicle Detail drawer; live via `map:vehicle-states` (diffs only);
  snapshot on (re)connect.
- **Vehicle Detail drawer:** current shift, HOS state, last known position/time, assignment,
  QUARANTINED reason; **Open accident** (if any) / **Open DVIR**.

### C.6 Accident Escalation Queue (list) + C.7 Accident Detail
- **List:** `accident:live` + `GET` accidents filtered to open/escalating; rows show mayday flag,
  armed escalation tier + timer (C6.3), ack state; tap → Detail.
- **Detail:** description, media gallery, **Acknowledge** (→ `POST /accidents/{id}/acknowledge`,
  cancels timer), **Verify telemetry chain** (→ `GET /accidents/{id}/telemetry/verify`, shows per-row
  validity C3.4), escalation timeline, on-call roster. Live updates via `accident:live`.

### C.8 DVIR Review Queue (list) + C.9 DVIR Review Detail
- **List:** inspections pending review (failing items + photos, BLOCKER→quarantined asset C1.5);
  tap → Detail.
- **Detail:** items (pass/fail, photos, notes), **Verify** (lock, `verified_by/at`) / **Flag**
  (flag_reason); corrected fields only after unlock (`409 UNLOCK_REQUIRED`). → `POST /inspections/{id}/verify`.

### C.10 Fuel Reconciliation Inbox (list) + C.11 Purchase Detail
- **List:** `GET /fuel/reconciliation-inbox` (keyset cursor; includes gauge delta vs expected rise);
  rows show status + anomaly flags; tap → Detail.
- **Detail:** purchase data, gauge evidence, anomaly list; actions per permission:
  - `fuel:verify` → **Verify** / **Reject** (reason).
  - `finance:clear_payment` (FINANCE) → **Clear payment** (requires `admin_verified`; C6.1). Adjusted
    litres only for `fuel:adjust`.
  - → `POST /fuel/purchases/{id}/verify`.

### C.12 Statement Import
- **Reached from:** Fuel → Import statement.
- **Contains:** file picker (CSV) → `POST /reconciliation/statements`; shows parse/match progress
  (async, server); errors surface as a result list.

### C.13 Anomaly Feed (list) + C.14 Anomaly Detail
- **List:** `GET /anomalies` (domain filter); tap → Detail.
- **Detail:** description, evidence, recommended action, linked entity; read-only (resolution happens
  in the owning domain screen).

### C.15 Expiring Documents (list) + C.16 Document Detail
- **List:** `GET /documents/expiring` (within_days); rows show asset, doc type, expiry countdown;
  tap → Detail.
- **Detail:** document metadata, expiry, linked asset; admin may note renewal (document management
  beyond v1 is out of scope).

### C.17 Drivers (list) + C.18 Driver Detail (MFA enrollment, D-12)
- **List:** drivers with status (ACTIVE/SUSPENDED), device, MFA-enabled; search; tap → Detail.
- **Detail contains:**
  - Status, roles/permissions, last login, device(s).
  - **Enroll MFA** (admin-provisioned, D-12): → `POST /auth/mfa/enroll` → shows **QR / setup key** +
    **one-time recovery codes** to hand to the driver; first driver code activates it.
  - **Revoke device** (→ `device:revoke`) / **Revoke sessions** (→ `POST /admin/users/{id}/revoke-sessions`,
    forces re-auth B13).
  - **Suspend / Reinstate** (if permitted).

### C.19 Notifications (inbox)
Same as B.17 (user-scoped; admin also gets on-call accident pages via `accident:live`).

### C.20 Profile / Settings
Same shape as B.20 (language en/sw, logout, open outbox, profile).

---

## D. State-handling matrix (all screens)

| State | Behavior |
|---|---|
| Loading | Inline spinner / skeleton; primary button shows spinner, disabled. |
| Empty | `EmptyState` with contextual copy + primary action (e.g., "No active shift — Clock In"). |
| Error (4xx hard) | `ErrorState` with `error_code` mapped to localized copy + the single correct action. |
| Offline (no connectivity) | `OfflineBanner` persistent; writes enqueue as `PENDING`; reads show last cached + "offline" tag. |
| Pending (queued) | Item shows "Pending" chip; reflects in Outbox; optimistic UI where safe. |
| Failed review | Item in Outbox with `error_code` + **Retry/Edit/Discard**; never silently lost. |
| Reconnect | Serial drainer flushes `PENDING`; snapshot refreshes socket views; banner clears when empty. |

## E. Navigation map (high level)

```
Splash ─▶ Login ─▶ MFA ─▶ (device register / consent) ─▶ Role Switch ─┬▶ Driver shell
                                                                       └▶ Admin shell
Driver shell:  Home ⇄ Clock-In/Out, Refuel⇄History, Inspect⇄DVIR Form/Detail,
               Accidents⇄Detail, Anomalies, Notifications, My Vehicle, Documents, Settings, Outbox
Admin shell:   Dashboard ⇄ Map⇄Vehicle, Accidents⇄Detail, DVIR Review⇄Detail,
               Fuel⇄Purchase/Statement, Anomalies⇄Detail, Documents⇄Detail, Drivers⇄Driver Detail,
               Notifications, Settings, Outbox
Shared: OfflineBanner ─▶ Outbox (Retry/Edit/Discard/Flush)
```

All state-changing taps carry a fresh `Idempotency-Key`; conflict/duplicate → discard, hard error →
`FAILED_REVIEW` (D-7). Driver real-time = `driver:*` + `notifications` sockets; admin = `map:*`,
`notifications`, `accident:live` (D-3/D-4).
