# Screen inventory (Helix)

Every screen named in the brief exists and now talks to the **real** backend contract, verified against
`packages/api/src/**` rather than the brief. Where the backend cannot support a screen, the screen says
so instead of guessing — those are marked **(gap)** and each one names its ledger entry in
`docs/ASSUMPTIONS.md`. What the API actually returns is in brackets after each row.

## Auth (both roles)
Splash (logo + silent refresh). Login has **no device gate**: registration is `POST /auth/devices` right after the session exists, and there is no `DEVICE_UNKNOWN` — C-01 / Login / MFA Challenge (delivered 6-digit OTP **or** a recovery code in the same field — there is no separate recovery endpoint and no QR code, because MFA is not TOTP — C-02/E-19) / Offline PIN / Consent / Role Switch / Suspended / Blocked (device integrity).

## Driver (phone, bottom tabs)
| Tab / screen | Contents |
|---|---|
| Clock in / out | odometer (with the vehicle's last **accepted** reading shown, and a decrease or a >500 km jump blocked), **fuel gauge (required)**, photo, optional plan notes, optional location sharing [`POST /shifts/clock-in`; the assignment comes from `GET /drivers/me/assignment`, so there is no picker — C-13/E-10; the last reading comes from `GET /vehicles/{id}` — E-13; `phone_gps_fallback_enabled` is sent true only when the sampler actually started — U-01] |
| After clock-in | the server's own `disclaimer`, shown verbatim before the app navigates away (E-11) |
| Home | the driver's name, hold-to-send Mayday, shift card, vehicle chip, rest banner from `next_eligible_clock_in_at`, clock in/out, trailer swap, my vehicle [`GET /drivers/me/onboarding` for the name — U-06] |
| Refuel | **photo-first**: receipt photo + odometer photo + odometer reading, a card chosen from `GET /fuel/cards`, and the four digits typed (the API deliberately does not return them) [`POST /driver/fuel/purchase`]. The retired gauge-% pair is U-12 |
| Inspect | template picker, then one control per checklist item in the driver's own language: pass/fail/NA for a PASS_FAIL line, a number with its server-declared bounds for a NUMERIC line (the reefer temperature), note **and** photo required on a fail, defects-reviewed, signature. A required line with no result blocks submission. |
| Accidents | hold-to-send Mayday, statement, witness, plate, photos [`POST /accidents`; severity is server-derived and is not sent — S-02] |
| Swap | Trailer swap: bobtail, an **existing** trailer from `GET /trailer` (hidden if already hooked to a vehicle, because a double-hook is a database error), or a new plate + type; hook photo; hook inspection (U-03) |
| More (Settings) | Account (language, role switch, and the driver's name from `GET /drivers/me/onboarding` — U-06), Security (PIN, biometric, MFA), Device, Data (Outbox, log out) |
| Stack | Clock in, Clock out, Trailer swap, Outbox, Edit queued item, My vehicle, Inbox, details |

## Admin (tablet, left rail)
| Section | Contents |
|---|---|
| Overview | attention cards (accidents highlighted), fleet status counts, pull-to-refresh. The four cards with a matching field read **exact** counts from `GET /reports/analytics`; the rest are a labelled lower bound (S-08) |
| Map | N5 map (`QUARANTINED → OFFLINE → HOS_ALERT → SPEEDING → MOVING → IDLING → PARKED`), status filter + legend, vehicle drawer [`GET /vehicles/{id}` is a VehicleRecord, so the drawer shows plate/odometer/HOS, not a live shift — E-07]. A vehicle with no fix is listed but not drawn (U-10) |
| Accidents | list [`GET /accidents/me?ownScope=false` — there is no tenant-wide route — E-16], detail with a countdown derived from `seconds_to_escalation` (**no timeline exists — U-09**), acknowledge, telemetry hash-chain check, media via 302 redirects (E-06) |
| Review | Shifts / Inspections / Fuel segments, details with verify/flag/reject/clear/adjust (each gated on the permission its endpoint enforces), statement CSV import |
| Drivers | roster, detail: revoke device (`device:revoke`), sign out everywhere, suspend/reinstate (`POST /admin/users/{id}/…`), MFA enrolment state shown read-only. **MFA cannot be provisioned here — enrolment is self-service only (C-03)** |
| Alerts | Notifications / Flags / Documents segments, read-only details. The badge is an exact count (`GET /notifications/count`, S-08); "mark read" appears only for a principal holding `notification:manage`, which is what the endpoint enforces |
| Settings | same grouped settings |

## What a screen refuses to do
Three things are deliberately not offered, because the backend cannot support them and guessing would
mislead the person in the field:

* **Background position upload.** The clock-in screen offers to share location and says, in the copy, that
  Helix only sends while the app is open — because that is exactly what it does. A foreground service would
  keep uploading with the app closed, but one that has never run on a real phone for a full shift is a worse
  risk than not shipping it (D-08, the first item on the device script).

Marking a notification read is offered only to a principal holding `notification:manage`, because that is
what `POST /notifications/{id}/read` enforces.

## Cross-cutting
Mayday banner above everything, offline banner, "Offline copy" tags, Pending chips, skeleton loading, quiet toast, privacy shield in the app switcher.
