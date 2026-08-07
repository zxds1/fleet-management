# Mobile App Design — Admin (tablet)

**Status:** Design (no code). **Depends on:** `00-overview.md`, `docs/backend/02-auth.md`,
`03-rest-api.md` (§2.2, §2.3, §2.4, §2.5, §2.7), `07-websocket-gateway.md`.

The admin app is a **React Native / Expo tablet** app (D-2, overrides locked A3.6 "web"). It is the
operations console: live map, accident escalation, DVIR/fuel review queues, anomaly + document feeds,
and **driver management including admin-provisioned MFA** (D-12).

---

## 1. Entry & role switch

After login, a user with any non-driver permission (`shift:verify`, `accident:acknowledge`,
`fuel:clear_payment`, `inspection:review`, `user:manage`, `device:revoke`, …) gets the **admin shell**.
A pure driver gets the driver shell (see `driver.md`). A mixed user sees a role picker.

---

## 2. Screens

| # | Screen | Key endpoints / channels | Notes |
|---|---|---|---|
| 1 | **Login + MFA** | `POST /auth/login`, `/auth/mfa/recover`, `/auth/refresh` | Same auth core as driver; MFA mandatory for ADMIN/FLEET_MANAGER (`02` §3). |
| 2 | **Live map** | socket `map:vehicle-states`; `GET /dashboard/vehicle-states` fallback | Fleet `v_vehicle_display_state` (N5 precedence). Tap vehicle → detail drawer (shift/HOS/last position). |
| 3 | **Accident escalation console** | socket `accident:live`; `GET /accidents/{id}/telemetry/verify`; `POST /accidents/{id}/acknowledge` | On-call view; acknowledge cancels escalation timer (C6.3); verify telemetry hash chain (C3.4). |
| 4 | **DVIR review queue** | `GET /inspections`(review view), `POST /inspections/{id}/verify` or flag | Review failing items + photos; BLOCKER failures already quarantined asset (C1.5). |
| 5 | **Fuel reconciliation** | `GET /fuel/reconciliation-inbox`; `POST /fuel/purchases/{id}/verify`; `POST /reconciliation/statements` | VERIFY/REJECT/CLEAR_PAYMENT (FINANCE gate C6.1); import statements. |
| 6 | **Anomaly feed** | `GET /anomalies` | Unified open anomalies (FUEL/HOS/ACCIDENT/MAINTENANCE/SECURITY). |
| 7 | **Expiring documents** | `GET /documents/expiring` | Asset document expiry window (B8). |
| 8 | **Driver management + MFA enrollment** | `POST /auth/mfa/enroll` (admin side), `POST /admin/users/{id}/revoke-sessions`, `PUT /devices/{id}/pin`, `POST /devices/register` | **Admin-provisioned TOTP (D-12):** generate/assign driver seed, show QR/setup key + one-time recovery codes. Revoke device/session (B13). |
| 9 | **Notifications inbox** | socket `notifications`; `GET /notifications` | User-scoped; quiet-hours aware on server (C6.4). |
| 10 | **Profile / settings** | locale toggle (en/sw), logout | Same core as driver. |

---

## 3. Live map (admin)

- Socket.IO `map:vehicle-states` pushes derived `display_state` diffs only (no raw telemetry, `07` §5).
- Snapshot on (re)connect prevents stale UI.
- Status chip follows N5 precedence: `QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED`.
- Google Maps base layer (D-9) via `react-native-maps` Google provider.
- Tapping a vehicle opens a detail drawer (current shift, HOS state, last known position, assignment).

---

## 4. Accident escalation console

- `accident:live` fires the instant a report is created/escalated; the on-call roster sees it.
- C6.3 timeout ladder is driven by the `escalation` worker server-side; the console shows ack state
  and the armed `escalation_timers`. `acknowledge` cancels the timer.
- `GET /accidents/{id}/telemetry/verify` runs `fn_verify_accident_chain` (C3.4) and shows per-row validity.
- Critical escalations also reach on-call via FCM/Africa's Talking (N9/A1.8), breaking quiet hours.

---

## 5. Real-time & sessions

- One Socket.IO connection with the access token; subscribes to `map:vehicle-states`, `notifications`,
  `accident:live`.
- **10-session cap per user** (A1.6) — a tablet + a phone both count; eviction notifies the user.
- When the socket is down, FCM delivers personal notifications (N9) so the tablet isn't blind in the
  background; on return, snapshot refreshes state.

---

## 6. Driver MFA enrollment (D-12)

- Admin opens a driver → "Enroll MFA" → `POST /auth/mfa/enroll` → server generates TOTP secret
  (AES-GCM encrypted, never returned in clear) and returns an `otpauth://` URI + recovery codes.
- Admin shows the **QR / setup key** to the driver (out-of-band, e.g. in person) and the **recovery
  codes once**. The driver imports into their authenticator app; first successful code activates it.
- Revoke device / force re-auth via `revoke-sessions` / `device:revoke` (B13).

---

## 7. Invariants this document locks

1. Admin is RN/Expo tablet (D-2); it is **not** a web app.
2. Admin real-time is Socket.IO (`map:vehicle-states`, `notifications`, `accident:live`); driver
   real-time is the separate driver-scoped channels (D-3/D-4).
3. TOTP is **admin-provisioned** (D-12); the admin app owns enrollment + recovery-code display.
4. FINANCE can only `CLEAR_PAYMENT` (C6.1); it cannot adjust figures.
5. The 10-session cap applies to admin principals exactly as to drivers (A1.6).
