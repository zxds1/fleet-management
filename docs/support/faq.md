# Driver FAQ

This document answers the most common questions drivers have about the HelixFleet mobile app.
The app works offline and syncs when you're back online — see the **Offline mode** section for
details.

---

## 1. How do I log in?

1. Open the app and enter your **email address** and **password** (assigned by your fleet manager).
2. If MFA (multi-factor authentication) is enabled on your account, you will be prompted for a
   6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, etc.).
3. If this is your first login on a new device, you may be asked to **register your device**.
   Tap "Register device" — the app generates a device ID and sends it to the server.
4. You will then be taken to your home screen.

**If you don't have a password:** Your fleet manager creates your account and sends you a
temporary password. Contact your fleet manager if you have not received it.

---

## 2. How do I reset my password?

Password reset is **admin-initiated** in Phase 1 — there is no self-service reset endpoint.
Contact your fleet manager to reset your password from the admin console (Driver Detail →
Reset password). They will set a new password and share it with you securely.

If you do not hear back within 24 hours, contact `support@helixfleet.com`.

---

## 3. What do I do if GPS isn't updating?

**On the Driver App:**

1. **Check your phone's location services:**
   - Android: Settings → Apps → Fleet Management → Permissions → Location → "Allow all the time."
   - Ensure GPS is turned on.

2. **Check GPS consent:** If the app shows a consent prompt, you must accept it before GPS-based
   features (clock-in, accident location) will work. Go to **Settings → GPS consent** and accept.

3. **The app shows "OFFLINE" or stale location:** This means the tracker (the hardware device on
   your vehicle) has not reported a position in the last 15 minutes (decision N5 — a vehicle with
   no position > 15 min shows OFFLINE on the live map). This is not necessarily your phone's GPS.

4. **My Vehicle screen:** Pull down to refresh. If it still shows no position, the tracker may be
   offline. The shift will proceed in **degraded mode** (decision C1.10) — a dead tracker does not
   block clock-in, but you will see a banner on the home screen.

**If GPS is still not working:**
- Restart your phone.
- Restart the app.
- Contact your fleet manager or `support@helixfleet.com` — this may indicate a tracker hardware
  issue (Traccar not forwarding positions to the Redis Stream).

---

## 4. How do I start a shift (clock in)?

1. From your **Home** screen, tap **Clock In**.
2. You will see:
   - **Assignment picker** — select your assigned vehicle/trailer. You must have an assignment
     before clocking in (error `NO_ASSIGNMENT` blocks clock-in, decision C1.8).
   - **Start odometer** — enter the current odometer reading (km). It must be greater than or equal
     to the vehicle's last recorded odometer (error `ODOMETER_DECREASED` if it decreases).
   - **Start photo** — take a photo of the odometer (required, decision B1).
   - **GPS consent** — if you haven't already accepted, you will be prompted.
   - **HOS rest indicator** — if you haven't completed your required rest, you will see an
     `HOS_REST_BLOCKED` error (decision C3.3 — hard block).
3. Tap **Clock In**.

The app will show **"Pending"** while it queues the request. If you are offline, it stays pending
in your Outbox and syncs when you're back online. Once confirmed, your active shift appears on
the Home screen.

**Common errors:**
- `NO_ASSIGNMENT` — you have no active assignment. Contact dispatch.
- `ODOMETER_DECREASED` — the reading is lower than the last recorded value. Check the number
  and try again.
- `HOS_REST_BLOCKED` — you haven't completed the required rest period (10 hours daily rest by
  default). Wait until rest is complete.
- `CONSENT_REQUIRED` — you haven't accepted GPS tracking consent. Go to Settings → GPS consent.
- `CLOCKOUT_PENDING` — you have a previous shift that is pending close-out. Complete it first.

---

## 5. How do I end a shift (clock out)?

1. From your **Home** screen, tap **Clock Out** (on your active shift card).
2. You will need:
   - **End odometer** — must be greater than or equal to your start odometer.
   - **End photo** — take a photo of the odometer (required, decision B1).
   - **Optional notes** — any issues during the shift.
3. Tap **Clock Out**.

If you don't provide the end photo or odometer, the shift goes to `PENDING_CLOSEOUT` (decision B7)
and you cannot start a new shift until the missing evidence is supplied. You will see a
"Complete close-out" action on your Home screen.

---

## 6. How do I complete a DVIR inspection?

1. From the bottom navigation, tap **Inspect** (the clipboard icon).
2. Tap **New inspection**.
3. The app auto-fills your vehicle and trailer from your assignment.
4. Go through each checklist item and mark it **Pass** or **Fail**:
   - **Failing items require a photo** — you must capture an image of the defect
     (error `DVIR_FAIL_NEEDS_PHOTO`, decision C1.5).
   - If an item **fails with BLOCKER severity**, the vehicle becomes quarantined and you
     cannot start a new shift until an admin reviews it.
   - **WARNING** severity fails allow the shift but flag the item for admin review.
5. Acknowledge that you reviewed **previous defects** (required — error `DEFECTS_NOT_REVIEWED`
   otherwise, decision C1.6).
6. Tap **Submit**.

If you are offline, the photos are stored locally and uploaded when you reconnect. The inspection
appears in your **DVIR List** as "Pending."

---

## 7. Accident reporting — what is the "SEND HELP NOW" flow?

If you are in an accident or need emergency assistance:

1. From the Home screen, tap **Report Accident**.
2. You will see two options:
   - **Submit report** — for non-emergency accidents. You can add photos, description, and location.
   - **SEND HELP NOW** (red button) — this is the **Mayday** flow (decision B17). It sends your
     current GPS coordinates immediately and **bypasses all photo requirements**. It triggers the
     full escalation ladder:
     1. The on-call team receives an immediate push notification + SMS (decision N9/FCM, A1.8).
     2. If not acknowledged within **5 minutes**, it escalates to the Head of Operations
       (`system_config.escalation.head_of_operations_user_id`).
     3. Critical accident SMS always breaks through quiet hours (decision C6.4).

3. For a standard accident report, you can add photos after submitting. The accident enters
   `INVESTIGATING` state, telemetry is frozen (5 min before / 1 min after, C3.4), and the
   on-call team reviews it.

**If you are off-shift:** SOS is available before clocking in (decision C1.14). Your location
from the configured freeze window is backfilled from Traccar if available; if no telemetry
exists, the accident record is marked `telemetry_available = false` rather than silently empty
(decision N3.2).

**Emergency contact numbers** shown in the app:
- Police: `112` (from `system_config.accident.emergency_police_number`)
- Ambulance: `999` (from `system_config.accident.emergency_ambulance_number`)
- Fleet manager direct line: shown if configured in `system_config`.

---

## 8. What happens if I lose signal or have no internet?

The app is **offline-first** (decision A1.5 — offline conflicts are flagged for manual resolution, not silently overwritten;
  B13 — max 24 h offline before forced online login). `location_updates` are partitioned monthly (D6). Here's what happens:

- **Clocking in/out, refueling, DVIR, accidents** you submit while offline are stored locally
  in a durable queue (SQLite on your device, `expo-sqlite`). They show as **"Pending"** in your
  Outbox.
- When you regain connectivity, the app automatically syncs (flushes) the queue in order.
- **No duplicate shifts or fuel purchases:** the server uses idempotency keys to prevent
  duplicates (decision C5.1). Even if you submit the same action twice, only one is recorded.
- **Photos** captured offline are stored on your device and uploaded to S3 (via presigned URLs)
  when you're back online. If a photo upload fails, the record moves to "Failed, review" and
  you can retry or edit it.

### 24-hour offline ceiling
If you are offline for more than **24 hours** (decision B13), the app forces you to log back in
online. A suspended driver is rejected at the next sync (`error_code: ACCOUNT_SUSPENDED`) and
shown "Account suspended. Contact Admin."

### Offline PIN
If you close the app and reopen it while offline, you may be prompted for a **4-digit offline
PIN** (decision B12):
- The PIN is stored as a bcrypt hash **only on your device** — the server never sees it.
- 5 failed attempts → 15-minute local lock (`error_code: OFFLINE_PIN_LOCKED`).
- 10 failed attempts → the local PIN hash is wiped and you must log in online.

### Checking your Outbox
Go to **More (three dots) → Outbox** to see all pending, in-flight, and failed items. From there
you can **Retry**, **Edit**, or **Discard** items in the "Failed, review" state.

---

## 9. What do I do if M-Pesa payment isn't reflecting?

M-Pesa payments for fuel purchases are processed through our partner system. If your payment
has not reflected:

1. **Wait at least 1 hour** — M-Pesa settlements can take up to 60 minutes to process and
   appear in the system.
2. **Check the receipt** — in the app, go to **Refuel → History** and look for the purchase.
   Its status should show as "Submitted" or "Verified."
3. If the status is stuck on "Submitted" for more than 1 hour, or if you paid but the app shows
   no record:
   - Double-check the transaction in your M-Pesa statement (SMS or app).
   - Take a screenshot of the M-Pesa confirmation.
4. Contact **billing@helixfleet.com** with:
   - Your driver name and vehicle plate.
   - The M-Pesa transaction ID.
   - The amount and time of payment.
   - A screenshot of the M-Pesa confirmation.

> **Note:** Per decision C2.3, expired fuel cards are accepted and flagged (not blocked). If
> your card was expired, the purchase is still recorded but may require manual review by finance
> before payment clearance.

---

## 10. What do the error codes mean on my screen?

The app shows technical error codes in some cases. Here are the most common ones you may see:

| Error code | What it means | What to do |
|---|---|---|
| `ODOMETER_DECREASED` | The odometer reading is lower than the last recorded value. | Check the number and enter it again. |
| `HOS_REST_BLOCKED` | You haven't completed your required rest period. | Complete your daily rest (10 hours by default) before clocking in. |
| `NO_ASSIGNMENT` | You have no active vehicle assignment. | Contact your dispatcher. |
| `CLOCKOUT_PENDING` | Your previous shift hasn't been fully closed. | Complete the close-out (add end odometer + photo). |
| `CONSENT_REQUIRED` | You haven't accepted GPS tracking consent. | Go to Settings → GPS consent and accept. |
| `DVIR_FAIL_NEEDS_PHOTO` | A failing inspection item needs a photo. | Add a photo of the defect and resubmit. |
| `DEFECTS_NOT_REVIEWED` | You didn't acknowledge previous defects. | Go back and check the "previous defects reviewed" box. |
| `ACCOUNT_SUSPENDED` | Your account is suspended. | Contact your fleet manager. |
| `DEVICE_REVOKED` | Your device was revoked by an admin. | Contact your fleet manager. |
| `OFFLINE_PIN_LOCKED` | Too many failed offline PIN attempts. | Wait 15 minutes, then go online to log in again. |
| `IDEMPOTENCY_CONFLICT` | A sync conflict occurred after 24h offline. | Go online, log back in, and retry. Items in Outbox are safe. |
| `MISSING_GAUGE_PAIR` | Refuel requires both before and after fuel gauge readings. | Enter both before and after gauge % with photos. |

Full error catalogue: see `docs/backend/08-error-state-model.md`.

---

## 11. Can I use the app outside Kenya / without signal?

Yes. The app works fully offline (see §8). Your data syncs when you next connect to the internet,
even if that's days later (up to the 24-hour offline ceiling, B13). However, real-time features
like live vehicle position and accident escalation require connectivity to function.

If you are roaming internationally, data charges may apply. The app does not auto-download large
updates in the background.

---

## 12. How do I manage my device?

From the **More** screen → **Profile / Settings**:
- **Device:** Shows your registered device label. You can **Reset offline PIN** to set a new
  4-digit PIN.
- **Language:** Toggle between English and Swahili (decision A2.6).
- **GPS consent:** View or re-accept your GPS tracking consent (decision C5.5).
- **Log out:** Clears all local data and returns to the login screen.

If your device is lost or stolen, ask your fleet manager to **revoke your device** from the admin
console. This remotely invalidates your session (decision B12/B13).
