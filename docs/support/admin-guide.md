# Admin Web Console Guide

This guide covers the **HelixFleet admin console** (tablet app, React Native/Expo, per A3.4).
It is the operations hub for fleet managers, dispatchers, and administrators.

---

## 1. Accessing the admin console

1. Open the admin app on your tablet or visit `https://app.helixfleet.com` (web fallback in Phase 2).
2. Log in with your **email** and **password**.
3. If MFA (TOTP) is enabled for your role (`ADMIN` or `FLEET_MANAGER`, decision A3.7), enter the
   6-digit code from your authenticator app.
4. If you have both driver and admin permissions, you will see a **role picker** — tap
   "Continue as Admin."
5. You land on the **Dashboard**.

**MFA recovery:** If you lose your authenticator app, use a **recovery code** (shown once when
MFA was enrolled, decision A3.7, `docs/backend/02-auth.md` §3). If you have no recovery codes,
an admin with `user:manage` can re-enroll MFA for you from the Driver Detail screen
(`POST /auth/mfa/enroll` → `POST /auth/mfa/confirm`).

---

## 2. Dashboard

The Dashboard gives you a real-time snapshot of fleet health. Each card is a quick link:

| Card | What it shows | Tap → |
|---|---|---|
| Active vehicles | Vehicles currently shifting or moving | Live Map |
| QUARANTINED / OFFLINE | Assets in a blocked or offline state | Live Map (filtered) |
| Open accidents | Active accidents, with mayday flags highlighted | Accident Escalation Queue |
| Pending DVIR | Inspections awaiting review | DVIR Review Queue |
| Open anomalies | Unresolved fuel/HOS/maintenance/security anomalies | Anomaly Feed |
| Expiring documents | Documents expiring within 7 days | Expiring Documents |
| Unread notifications | Your unread notifications | Notifications Inbox |

The live map updates in real time via the `map:vehicle-states` Socket.IO channel (decision A1.6,
`docs/backend/07-websocket-gateway.md` §3). Vehicle status chips follow the N5 precedence:
`QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED`.
`QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED`.

---

## 3. Live map usage

**Reached from:** Side navigation → **Live Map**.

The Live Map displays every vehicle in your fleet as a colored marker:

- **Marker color** = vehicle display state (N5):
  - 🔴 Red: `QUARANTINED` — the vehicle is blocked (e.g., DVIR BLOCKER failure, accident quarantine).
  - ⚪ Grey: `OFFLINE` — no position received in > 15 min (`tracker.offline_threshold_minutes`).
  - 🟠 Orange: `HOS_ALERT` — approaching duty limit.
  - 🟡 Yellow: `SPEEDING` — speed exceeds `speed.limit_kph` (default 80, decision B10).
  - 🟢 Green: `MOVING`.
  - 🔵 Blue: `IDLING`.
  - ⚫ Slate: `PARKED` (ignition off, tracker online).
- **Filter:** Tap the filter icon to show/hide by status, assignment, or vehicle class.
- **Tap a marker** → opens a **Vehicle Detail drawer** showing:
  - Current shift info (clock-in time, driver, odometer).
  - HOS state (driving time today, rest eligibility).
  - Last known position and time.
  - Current assignment.
  - Quarantine reason (if applicable).
  - Quick links: **Open accident** (if any) / **Open DVIR** (if any).

**Real-time behavior:** The map subscribes to `map:vehicle-states` via Socket.IO. On
reconnect, a full snapshot is sent so the map is never stale (decision A1.6,
`docs/backend/07-websocket-gateway.md` §5). The gateway pushes only state diffs (derived
display state), not raw telemetry (decision N5).

**Note:** The admin console has a **10 concurrent session cap** per user (decision A1.6). Using
the tablet and phone simultaneously counts as two sessions.

---

## 4. Vehicle / driver management

**Reached from:** Side navigation → **Drivers** or **Live Map → Vehicle Detail**.

### Driver management

1. Tap **Drivers** in the side navigation.
2. **List view** shows all drivers with:
   - Status: `ACTIVE` or `SUSPENDED`.
   - Registered device(s).
   - MFA enabled: Yes/No (MFA mandatory for `ADMIN` and `FLEET_MANAGER` per decision A3.7).
   - Last login.
   3. **Search / filter** by name, email, or status.
   4. Tap a driver → **Driver Detail** screen.

### Driver Detail

From the Driver Detail screen you can:

#### Enroll MFA (admin-provisioned, decision A3.7 / `docs/backend/02-auth.md` §3)1. Tap **Enroll MFA**.
2. The system generates a TOTP secret (encrypted server-side, never returned in clear).
3. A **QR code** and **setup key** appear on screen. Hand these to the driver (in person, or
   via a secure channel).
4. The driver scans the QR code with their authenticator app (Google Authenticator,
   Microsoft Authenticator, etc.) and enters the first 6-digit code.
5. **Recovery codes** are displayed **once** — give them to the driver securely. They can
   use a recovery code to log in if they lose their authenticator app.
6. Tap **Confirm**. MFA is now active for the driver.

> **Driver MFA is NOT mandatory** (decision A3.7) — it is mandatory only for `ADMIN` and
> `FLEET_MANAGER` roles. Driver MFA is admin-provisioned (decision A3.7): the admin app owns
> enrollment + recovery-code display.

#### Other actions
- **Revoke device** — tap **Revoke device** → `POST /devices/:deviceId/revoke` → invalidates the
  device-bound refresh token (`device:revoke` permission). The driver is forced to log in online on next sync
  (decision B12/B13).
- **Revoke sessions** — tap **Revoke sessions** → `POST /sessions/revoke` → forces re-authentication on all devices.
- **Suspend / Reinstate** — changes the driver's status. A suspended driver cannot log in
  (error `ACCOUNT_SUSPENDED`).
- **Edit profile** — update contact info, assign/unassign vehicles, manage roles.

### Vehicle management

From the **Live Map → Vehicle Detail drawer** or the **Fleet** section:

- View vehicle status, current driver, HOS state, and last position.
- **Quarantine / Lift quarantine** — quarantine blocks the vehicle (quarantine requires a
  reason; lifting requires audited reason per decision C3.9).
- **Recovery mode** — enable for a bounded window with a mandatory reason (decision N3.1).
  This retains location data off-shift for investigation.
- **View telemetry history** — read-only track replay (requires `telemetry:read_history`).

---

## 5. DVIR review queue

**Reached from:** Side navigation → **DVIR Review**.

This queue shows all DVIR inspections submitted by drivers that are pending review or have
been flagged.

1. **List view** — each row shows:
   - Vehicle / trailer and driver.
   - Submission time.
   - Items that failed (with photos).
   - Severity: `BLOCKER` failures are highlighted in red and the asset is quarantined
     (decision C1.5).
   - Status: `SUBMITTED`, `REVIEWED`, or `FLAGGED`.
2. Tap a row → **DVIR Review Detail**.

### DVIR Review Detail

- View each inspection item: pass/fail, notes, and the **photo** (if a photo was required).
- **Verify** — marks the inspection as reviewed and locks it (`verified_by`, `verified_at`).
  This clears the quarantine if no BLOCKER defects remain unresolved.
- **Flag** — send the inspection back to the driver with a reason. The driver must resubmit.
- **Corrected fields** — if you need to adjust an odometer or gauge reading after verification,
  use **Unlock for Correction** (decision B18). The original value is preserved in `audit_logs`.

**Permissions:**
- `inspection:read` — view submitted inspections.
- `shift:verify` — verify and lock shifts for payroll.
- `shift:unlock` — unlock verified shifts for correction.
- `asset:lift_quarantine` — lift quarantines.

**API endpoints:**
- `GET /shifts/verification-inbox` (shift verification view for payroll)
- `POST /shifts/{id}/verify` (verify/flag a shift)
- `POST /inspections` (driver submits DVIR; the review UI reads submitted inspections via the
  verification inbox and the anomaly feed)

> **Note:** The Phase 1 API does not yet expose a dedicated `GET /inspections` review endpoint.
> Admins review submitted DVIRs through the verification inbox and the anomaly feed.

---

## 6. Anomaly feed

**Reached from:** Side navigation → **Anomalies**.

The **Anomaly Feed** is a unified list of all open anomalies across fuel, HOS, accident,
maintenance, and security domains (decision `docs/backend/03-rest-api.md` §2.7, endpoint
`GET /anomalies`).

1. Each row shows:
   - Domain tag (FUEL, HOS, ACCIDENT, MAINTENANCE, SECURITY).
   - Severity: `CRITICAL` or `WARNING`.
   - Description of the anomaly.
   - The affected asset (vehicle/trailer) and, where relevant, the driver.
   - The time it was detected.
2. **Filters** — filter by domain, severity, asset, or date range.
3. Tap a row → **Anomaly Detail**.

### Anomaly Detail

- Full description, evidence (gauge photos, telemetry snippets), and the recommended action.
- Linked entity (e.g., the fuel purchase, the shift, the accident report) — tap to navigate.
- **Resolution** happens in the owning domain screen:
  - FUEL anomalies → Fuel Reconciliation Inbox.
  - HOS anomalies → the shift record.
  - ACCIDENT anomalies → Accident Detail.
  - MAINTENANCE anomalies → Maintenance screen.

**Critical anomalies** also generate push notifications (decision N9, FCM) to the on-call
fleet manager and finance team. SMS is sent as a fallback if push is not delivered within
the escalation window (decision A1.8, `docs/backend/05-workers.md` §5).

---

## 7. Driver MFA enrollment

This is the **admin-provisioned MFA flow** (decision A3.7 / `docs/backend/02-auth.md` §3).

1. Navigate to **Drivers** → select the driver.
2. On the **Driver Detail** screen, tap **Enroll MFA** → calls `POST /auth/mfa/enroll`.
3. The server generates a TOTP secret, encrypts it (AES-GCM with KMS), and returns an
   `otpauth://` provisioning URI.
4. The admin screen displays:
   - A **QR code** the driver can scan with their authenticator app.
   - The **setup key** (manual entry) if the driver cannot scan.
   - **Recovery codes** (shown once) — give these to the driver securely.
5. The driver opens their authenticator app, scans the QR code (or enters the setup key),
   and the app begins generating 6-digit codes.
6. The driver enters the current 6-digit code in the app → `POST /auth/mfa/confirm`
   to **confirm activation**.
7. The server sets `users.mfa_enabled = true`.

> **To disable MFA:** An admin with `user:manage` can revoke MFA for a driver by selecting the
> driver in the roster and choosing "Disable MFA." The driver's `mfa_enabled` flag is cleared;
> they will log in without a code until MFA is re-enrolled.

**Recovery path:** If the driver loses their authenticator app and has no recovery codes,
an admin can **re-enroll** them (which generates a new secret and new recovery codes).

---

## 8. Maintenance scheduling

**Reached from:** Side navigation → **Maintenance** (Phase 3 feature, decisions C3.11/C3.12).

Maintenance schedules are evaluated hourly by the `maintenance-eval` worker
(`docs/backend/05-workers.md` §2 #4).

1. **List view** shows all scheduled maintenance tasks per asset:
   - Task name (e.g., "Oil change", "Annual service", "Brake inspection").
   - Trigger type: `ODOMETER` (distance-based) or `TIME` (calendar-based).
   - Next due: odometer reading or date.
   - Status: `DUE_SOON` (within `maintenance.due_soon_km` or `maintenance.due_soon_days`
     before due) or `OVERDUE`.
2. Tap a task → **Task Detail**:
   - View the maintenance schedule, last completed date/odometer, and due threshold.
   - **Record completion** — enter the odometer, date, vendor, cost, parts used, and
     downtime. Requires `maintenance:record` permission.
   - Optionally upload photos (retained per C5.3/M7 — 7 years).
3. **Auto-quarantine** (decision C3.12): if `maintenance.auto_quarantine_enabled` is true
   (default: false), an overdue asset is automatically quarantined until the task is
   completed.

### Default maintenance tasks (seeded)

| Code | Task | Applies to | Trigger | Interval |
|---|---|---|---|---|
| OIL_CHANGE | Oil change | Vehicle | Odometer | 10,000 km |
| TYRE_ROTATION | Tyre rotation | Vehicle | Odometer | 10,000 km |
| BRAKE_INSPECTION | Brake inspection | Vehicle | Odometer | 20,000 km |
| ANNUAL_SERVICE | Annual service | Vehicle | Time | 365 days |
| TRAILER_ANNUAL | Trailer annual service | Trailer | Time | 365 days |

All thresholds (`maintenance.due_soon_km`, `maintenance.overdue_km_threshold`,
`maintenance.auto_quarantine_enabled`) are admin-editable in **Settings → System Configuration**
and take effect immediately (decision C2.4). They are seeded in `db/seed/01_seed.sql` as rows in
`app.system_config` and editable at runtime.

---

## 9. Notifications inbox

**Reached from:** Bell icon in the top bar.

Shows all notifications sent to you via FCM push (decision N9). The feed is user-scoped and
respects quiet hours (decision C6.4). Each notification links to the related entity
(shift, accident, anomaly, etc.) — tap to navigate.

**Critical accident notifications** break through quiet hours (decision C6.4) and are also
delivered via SMS as a fallback (decision A1.8, Africa's Talking).

---

## 10. Profile / Settings (admin)

**Reached from:** Side navigation → **Profile / Settings**.

- **Language:** English only for admin app (decision A2.6).
- **Logout:** Clears your session (invalidates the refresh token) and returns to login.
- **System Configuration** (requires `config:manage` permission): View and edit all runtime
  thresholds in `system_config` (decision C2.4). Changes are audited.

Common config keys you may edit (seeded in `db/seed/01_seed.sql`, table `app.system_config`):
- `speed.limit_kph` — global speeding threshold (decision B10, default 80).
- `tracker.offline_threshold_minutes` — minutes without a position before a vehicle shows OFFLINE (N5, default 15).
- `accident.ack_timeout_minutes` — escalation window (C6.3, default 5 min).
- `fuel.anomaly_gauge_deviation_pct` — anomaly sensitivity (default 20%).
- `escalation.head_of_operations_user_id` — who receives the 5-min escalation (N6.3).

---

## 11. Key admin routes (API reference)

All endpoints are under the base path `/api/v1` (decision D7). State-changing endpoints require
an `Idempotency-Key` header (decision C5.1).

| Screen | Endpoint | Permission |
|---|---|---|
| Login / MFA | `POST /auth/login`, `POST /auth/mfa/verify`, `POST /auth/mfa/confirm` | — |
| Device + session management | `GET /drivers`, `POST /devices/:deviceId/revoke`, `POST /sessions/revoke` | `user:manage` / `device:revoke` |
| Live map | `GET /dashboard/vehicle-states` (fallback), `map:vehicle-states` socket (real-time) | `telemetry:read_live` |
| Accident escalation | `POST /accidents/mayday`, `POST /accidents` (create), `POST /accidents/{id}/acknowledge` | `accident:report` / `accident:acknowledge` |
| DVIR review | Admin reviews via the verification inbox + anomaly feed | `inspection:read` |
| Shift verification | `GET /shifts/verification-inbox`, `POST /shifts/{id}/verify`, `POST /shifts/{id}/force-close` | `shift:verify` / `shift:force_close` |
| Fuel reconciliation | `GET /fuel/reconciliation-inbox`, `POST /fuel/purchases/{id}/verify`, `POST /fuel/cards`, `POST /reconciliation/statements` | `fuel:verify` / `fuel:clear_payment` / `fuel:card_manage` |
| Anomalies | `GET /anomalies` | (read-only; no auth gate in Phase 1) |
| Expiring documents | `GET /documents/expiring` | (read-only; no auth gate in Phase 1) |
| Media upload | `POST /media/upload-url` | (authenticated) |
| Notifications | `notifications` socket (admin real-time; driver push is FCM via worker) | — |

**Note on the FINANCE role:** Finance users are read-only over data with a single write action:
`fuel:clear_payment` (decision C6.1). They can clear verified receipts for payment but cannot
adjust fuel figures (that requires `fuel:adjust`).
