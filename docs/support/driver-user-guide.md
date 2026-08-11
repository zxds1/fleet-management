# Driver App User Guide (English)

This guide walks you through every journey in the HelixFleet driver mobile app, step by step.
The app is **offline-first** — if you lose signal, your work is saved locally and syncs when
you reconnect.

---

## 1. Login + MFA recovery

### Logging in

1. Open the **Fleet Management** app (the blue "H" icon with a ribbon).
2. Enter your **email address** and **password** (assigned by your fleet manager).
3. Tap **Log in**.

If MFA (multi-factor authentication) is enabled on your account, you will see a 6-digit code
prompt. Open your authenticator app (Google Authenticator, Microsoft Authenticator, etc.) and
enter the current code.

### First login on a new device

If this is your first time logging in on a new phone:

1. The app may show a **Register this device** message (error `DEVICE_UNKNOWN`).
2. Tap **Register device**. The app generates a unique device ID and registers it with the
   server.
3. You may then be prompted to set a **4-digit offline PIN** (see §2).

### MFA recovery

If you lose your phone or your authenticator app stops working:

- **Use a recovery code.** When MFA was first enrolled, one-time recovery codes were displayed
  (decision A3.7 / `docs/backend/02-auth.md` §3). Enter one of those codes on the MFA
  Challenge screen by tapping **Use recovery code**. The code is single-use.
- **No recovery codes?** Contact your fleet manager. An admin can re-enroll your MFA from the
  admin console (Driver Detail → Enroll MFA), which generates new codes.

> MFA is **not** mandatory for drivers by default (decision A3.7). It is mandatory only for
> `ADMIN` and `FLEET_MANAGER` roles. However, your company may have enabled it for drivers —
> if so, you must use an authenticator app + recovery codes.

---

## 2. Offline PIN (field re-auth)

Your phone may require a **4-digit PIN** to unlock the app when you are offline:

- The PIN is stored **only on your device** as a bcrypt hash — the server never knows your PIN
  (decision B12).
- Enter the PIN to unlock the app and continue working.
- **5 failed attempts** → the app locks you out for **15 minutes** (`error_code: OFFLINE_PIN_LOCKED`).
- **10 failed attempts** → the local PIN hash is wiped. You must connect to the internet and
  log in again to set a new PIN.

### Setting or resetting your offline PIN

From the app:

1. Go to **More** (three dots) → **Profile / Settings** → **Device**.
2. Tap **Reset offline PIN**.
3. Enter a new 4-digit PIN on the device (biometric unlock may be required first).

If your device is **lost or stolen**, ask your fleet manager to **revoke your device** from the
admin console. This invalidates your session on the server side.

---

## 3. Clock in / out (with GPS consent)

### Before you clock in

- You **must have an active assignment** (a vehicle + shift period assigned by dispatch). If
  you don't, you will see `NO_ASSIGNMENT` and cannot clock in (decision C1.8).
- You **must accept GPS tracking consent**. If you haven't, you will be redirected to the
  consent screen. You can review it later in **Settings → GPS consent**.

### How to clock in

1. From the **Home** screen, tap **Clock In**.
2. Confirm or select your **Assignment** (vehicle + trailer).
3. Enter the **start odometer** (km) — take a photo of the odometer dial first (required,
  decision B1).
4. The **start fuel gauge** is auto-filled if your vehicle has a fuel card; otherwise select
  from EMPTY / QUARTER / HALF / THREE-QUARTER / FULL.
5. Review and tap **Clock In**.

The app shows **"Pending"** while it queues the request. You'll see your active shift on the
Home screen once it syncs.

**What GPS consent means:** Your location is only recorded during active shifts
(`clock_in - 15 min` to `clock_out + 15 min`, decision N3.3). Off-shift, the platform discards
coordinates and records only a timestamp if the vehicle moves (decision C5.6). You can revoke
consent at any time in Settings, but then you cannot start a shift.

### How to clock out

1. From the **Home** screen, tap **Clock Out** on your active shift card.
2. Enter the **end odometer** — take a photo of the odometer (required, decision B1).
3. Enter any optional **notes** about issues during the shift.
4. Tap **Clock Out**.

If you don't provide the end photo or odometer, the shift goes to `PENDING_CLOSEOUT` (decision
B7). You will see a "Complete close-out" banner — you cannot start a new shift until this is
done.

### HOS (Hours of Service)

- Daily driving limit: **8 hours** (decision C3.1).
- Daily rest: **10 hours** minimum.
- Duty period: **14 hours** max — at 12 hours you get a warning; at 14 hours the shift is
  marked overrun and requires admin force-close (decision N6).
- **The 14-hour rule does NOT auto-clock-out.** You must end your shift manually
  (decision N6).

If you try to clock in and see `HOS_REST_BLOCKED`, it means you haven't completed the required
rest period. Wait until rest is complete, then try again.

---

## 4. Refueling workflow

### Submitting a refuel

1. From the **Home** screen, tap **Refuel** (or use the bottom navigation).
2. The app auto-fills your **current shift** and **vehicle**.
3. Enter:
   - **Before fuel gauge** — select from the dropdown AND take a photo of the gauge (decision
     B3). Both before and after are required.
   - **After fuel gauge** — select AND take a photo.
   - **Litres** purchased.
   - **Total cost** (in KES).
   - **Odometer** reading at the time of fueling.
   - **Fuel card last four digits** (if using a fuel card).
   - **Receipt photo** (optional, but recommended — OCR is run later by the system).
4. Tap **Submit refuel**.

The app shows **"Pending"** while it queues the request.

### What happens after

- If you provided before+after gauge photos, your submission has **gauge evidence**.
- If you are missing the before or after gauge, you get `MISSING_GAUGE_PAIR` (decision B3) and
  the item goes to your Outbox for review.
- The **anomaly engine** scores your refuel asynchronously (every 5 minutes, `docs/backend/02-fuel-anomaly.md`
  / `docs/backend/05-workers.md` §2 #9). Anomalies (e.g., gauge deviation suggesting a possible leak
  or theft) appear later in the **Anomalies** screen. This does **not** block your submission.
- Finance will **verify and clear** your refuel in the admin console (decision C6.1). You will
  see the status update in **Refuel → History**.

---

## 5. DVIR inspection

DVIR (Driver Vehicle Inspection Report) is the pre-shift safety checklist.

### Starting an inspection

1. From the bottom navigation, tap **Inspect** (the clipboard icon).
2. Tap **New inspection**.
3. The app auto-selects the **template** based on your vehicle/trailer type. Available templates:
   - **Pre-Shift Tractor Inspection** (for your truck/tractor).
   - **Pre-Shift Trailer Inspection** (for your trailer).
   - **Mid-Shift Trailer Hook Check** (if you swapped trailers during the shift).

### Completing the inspection

4. Go through each item and mark it **Pass** ✅ or **Fail** ❌:
   - If an item **fails**, you **must take a photo** of the defect
     (`DVIR_FAIL_NEEDS_PHOTO`, decision C1.5).
   - **BLOCKER** severity fails: the vehicle is quarantined after submission and no one can
     clock in with it until an admin reviews and clears it (decision C1.5).
   - **WARNING** severity fails: the inspection is submitted with warnings; the admin reviews
     asynchronously.
   - Some items accept a **numeric value** (e.g., reefer temperature, -40 to +40 °C, decision M6).
5. You **must acknowledge** "Previous defects reviewed" by checking the box
   (`DEFECTS_NOT_REVIEWED` blocks submission, decision C1.6).
6. Tap **Submit**.

### After submission

- If you were offline, the photos are stored locally and uploaded when you reconnect (decision
  D6 — `location_updates` partitioned monthly).
- The inspection appears in your **DVIR List** with status `SUBMITTED`.
- An admin reviews it in the **DVIR Review Queue**. You will see the status change to
  `REVIEWED` or `FLAGGED`.
- If you forgot a photo, the item goes to your **Outbox** as `FAILED_REVIEW` with
  `DVIR_FAIL_NEEDS_PHOTO`. Tap it, add the photo, and retry.

---

## 6. Accident reporting

### Standard accident report

1. From the **Home** screen, tap **Report Accident**.
2. Enter:
   - **Description** of the incident.
   - **Location** (auto-captured from GPS; tap to adjust if needed).
   - **Severity** (Low / Medium / High).
3. Add **photos** of the scene, vehicle damage, and any injuries (decision C3.6 —
   recommended but not required for a standard report).
4. Tap **Submit report**.

The accident enters `PENDING` state. The on-call team sees it and escalates as needed. You can
track its status in **Accidents → My Accidents**.

### Mayday (SEND HELP NOW)

If this is an emergency or someone is injured:

1. Tap **Report Accident**.
2. Toggle on **"SEND HELP NOW"** (red button).
3. Tap **Submit MAYDAY**.

**What happens next (decision B17):**
- Your GPS coordinates are sent immediately.
- **No photos are required** — the mayday bypasses all photo requirements.
- The on-call team is notified instantly via **push (FCM)** + **SMS** (`FLEET_ALERT` sender,
  decision A1.8/N9).
- If not acknowledged within **5 minutes**, the system escalates to the Head of Operations
  (decision C6.3).
- Telemetry is **frozen** (5 min before / 1 min after, decision C3.4) and a SHA-256 hash chain
  is computed for evidence integrity.

### Viewing your accidents

From the bottom navigation or Home → **My Accidents**:
- See a list of all accidents you've reported.
- Tap one for **detail**: status, description, photos, escalation state.
- If you are on the on-call roster, you may see an **Acknowledge** button (cancels the
  escalation timer).
- Tap **Add media** to upload additional photos after submission.

### Emergency numbers

The accident report screen also shows:
- **Police:** `112`
- **Ambulance:** `999`
- **Fleet manager direct line:** (if configured by your admin)

---

## 7. Offline mode

The app is designed to work **fully offline**. Here's how:

### What works offline
- **Clocking in/out** — queued and synced when online.
- **Refueling** — queued; before/after gauge photos stored locally.
- **DVIR inspections** — queued; defect photos stored locally.
- **Accident reports** — queued; photos stored locally.
- **Viewing cached data** — you can see your recent shifts, fuel history, and DVIR list from
  the last time you were online.

### The Outbox

Go to **More → Outbox** to see everything you've submitted while offline:
- **Pending** — waiting to sync.
- **In-flight** — currently being transmitted.
- **Failed, review** — the server rejected the submission (e.g., `ODOMETER_DECREASED`,
  `HOS_REST_BLOCKED`). Tap to **Edit**, **Retry**, or **Discard**.
- **Discarded** — duplicate submissions are silently discarded   (decision D4 — client-generated
  UUID idempotency on every mobile write).

### 24-hour ceiling

If you are offline for more than **24 hours** (decision B13), the app forces you to log back in
online when you reconnect. A suspended driver is rejected at next sync
(`error_code: ACCOUNT_SUSPENDED`) and shown a "Contact Admin" message.

### Reconnecting

- When the app detects connectivity, it automatically starts syncing (flushing the Outbox).
- You can tap **Flush now** in the Outbox to trigger a sync manually.
- A persistent **Offline Banner** at the top of the screen shows queue status. It disappears
  when everything is synced.

### Phone GPS fallback

If your vehicle's tracker goes offline, the app may offer an **opt-in phone-GPS fallback**
after 15 minutes of no position (decision C1.9). This uses your phone's location for a
degraded experience. Note: off-shift phone GPS is still discarded per the retention policy
(C5.6).

---

## 8. Other features

### My Vehicle (live)

From **Home → My Vehicle**:
- See a mini-map with your vehicle's last known position.
- The status chip shows the vehicle's current state (MOVING, IDLING, PARKED, OFFLINE, etc.)
  per the N5 precedence rules.
-   Updates live via the `driver:vehicle` Socket.IO channel (deviation D-3 from locked decision A1.6,
  approved in `docs/apps/00-overview.md` — both are approved product decisions). If the socket drops, the app falls back to polling
  `GET /dashboard/vehicle-states` every 10 seconds (decision A1.6, the baseline).

### Anomalies

From **Home → Anomalies** or the bottom navigation badge:
- See all anomalies detected for you or your vehicles.
- Domains: FUEL (possible theft, card mismatch, expired card), HOS (rest not completed),
  ACCIDENT (unacknowledged), MAINTENANCE (due/overdue), SECURITY.
- Tap an anomaly to see details and the recommended action.

### Notifications

From the **bell icon** at the top:
- See all notifications sent to you.
- Includes shift reminders, HOS warnings, accident updates, fuel anomaly alerts, and
  maintenance reminders.
- Tap to navigate to the related item.

### Profile / Settings

From **More → Profile / Settings**:
- **Language** — toggle between English and Swahili (decision A2.6).
- **GPS consent** — view or re-accept your GPS tracking consent (decision C5.5).
- **Device** — see your registered device; reset your offline PIN.
- **Log out** — clears all local data and returns to the login screen.

---

## 9. Common error messages and what to do

| Error | What it means | What to do |
|---|---|---|
| `DEVICE_UNKNOWN` | Your device isn't registered. | Tap "Register device" on the login screen. |
| `DEVICE_REVOKED` | Your device was revoked by an admin. | Contact your fleet manager. |
| `ACCOUNT_SUSPENDED` | Your account is suspended. | Contact your fleet manager. |
| `CONSENT_REQUIRED` | You haven't accepted GPS consent. | Go to Settings → GPS consent and accept. |
| `NO_ASSIGNMENT` | You have no active assignment. | Contact dispatch. |
| `CLOCKOUT_PENDING` | Your previous shift isn't fully closed. | Complete the close-out (end odometer + photo). |
| `SHIFT_ALREADY_OPEN` | You already have an open shift. | Clock out of the current shift first. |
| `ODOMETER_DECREASED` | The odometer reading went backwards. | Enter the correct reading. |
| `HOS_REST_BLOCKED` | You haven't completed required rest. | Wait for rest to complete, then retry. |
| `DVIR_FAIL_NEEDS_PHOTO` | A failing inspection item needs a photo. | Add a photo of the defect. |
| `DEFECTS_NOT_REVIEWED` | You didn't acknowledge previous defects. | Check the "previous defects reviewed" box. |
| `MISSING_GAUGE_PAIR` | Refuel needs both before and after gauge readings. | Enter both before and after gauge % with photos. |
| `OFFLINE_PIN_LOCKED` | Too many failed offline PIN attempts. | Wait 15 min, or go online to log in again. |

Full error catalogue: see `docs/backend/08-error-state-model.md`.
