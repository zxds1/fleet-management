# Helix mobile — assumption ledger

Every guess this app was built on, and what the backend actually says. The backend is the source of
truth: this file records where a guess was wrong, what replaced it, and where the code still has to
ask a human.

**Lifecycle.** An entry is *Open* while the app still guesses. When the real contract is known:

1. change the code to the real contract,
2. delete the `ASSUMPTION[ID]` tag from the code,
3. set the endpoint's `status` to `CONTRACT` in `src/api/endpoints.ts` (or `ASSUMED` + `assumption`
   where no route exists), and
4. move the entry to **Resolved**, with the evidence below.

`test/assumptions.test.ts` enforces exactly that loop: every tag in the code has an entry here, every
Open entry is tagged in the code so it can be found and changed, and the Resolved section is the audit
trail. Entries are `C-` (contract), `E-` (endpoint), `S-` (shape), `B-` (behaviour), `U-` (unbuilt),
`D-` (drift found while checking), `T-` (deferred review).

**Start here if you are new:** `HANDOVER.md` at the repository root has the verification commands, the
backend changes that were made (and the one that needs review), the environment gotchas, and the next
four steps.

The code was corrected against `packages/api/src/**` (the routers) rather than `api/openapi.yaml`,
because openapi is a partial locked copy of 02-api.md — see D-04. `test/contract.test.ts` rebuilds the
real route table from the routers at run time, so drift cannot come back silently.

## Index

| id | short | state |
|----|-------|-------|
| C-01 | Device registration has no gate | Resolved |
| C-02 | MFA recovery uses the verify endpoint | Resolved |
| C-03 | MFA enrolment is self-service only | Resolved |
| C-04 | Driver channels are rooms, not subscriptions | Resolved |
| C-05 | Login response shape | Resolved |
| C-06 | MFA challenge response shape | Resolved |
| C-07 | Vehicle-states response | Resolved |
| C-08 | Shift states | Resolved |
| C-09 | Permission codes | Resolved |
| C-10 | Config key names | Resolved |
| C-11 | Money as a decimal string, KES | Resolved |
| C-12 | Error envelope | Resolved |
| C-13 | Login → MFA → order | Resolved |
| C-14 | Refresh rotation | Resolved |
| C-15 | `device_id_hash` derivation | Resolved |
| C-16 | Consent | Resolved |
| C-17 | Suspended vs blocked | Resolved |
| E-01 | `/devices/register` | Resolved |
| E-02 | `POST /notifications/register` | Resolved |
| E-03 | `POST /push/token` | Resolved |
| E-04 | `GET /notifications` fields | Resolved |
| E-05 | `/auth/devices/{id}/pin` | Resolved |
| E-06 | `GET /media/{id}` | Resolved |
| E-07 | `GET /vehicles/{id}` | Resolved |
| E-08 | Fuel gauge records | Resolved (re-scoped, see U-12) |
| E-09 | Inspection templates | Resolved — items now exposed (D-07) |
| E-10 | Assignments for clock-in | Resolved |
| E-11 | Clock-in extras (disclaimer, notes, photos) | Resolved |
| E-12 | HOS remaining time | Resolved |
| E-13 | Odometer pre-check | Resolved — `GET /vehicles/{id}` |
| E-14 | DVIR photo required on FAIL | Resolved |
| E-15 | Media accepts video / CSV | Resolved |
| E-16 | Tenant-wide accident list | Resolved (via `ownScope=false`) |
| E-17 | Suspend / reinstate a driver | Resolved |
| E-18 | Statement CSV upload | Resolved |
| E-19 | TOTP provisioning URI | Resolved — MFA is a delivered OTP |
| S-01 | Mayday request | Resolved |
| S-02 | Accident request | Resolved |
| S-03 | Inspection item shape | Resolved |
| S-04 | Push `data_json` | Resolved — only `{ shift_id }` exists |
| S-05 | Error buckets | Resolved |
| S-06 | Socket payloads | Resolved |
| S-07 | Snapshot keys | Resolved — there are none |
| S-08 | Count endpoints | Resolved — `/notifications/count` |
| S-09 | Notification read state | Resolved |
| S-10 | Media response | Resolved |
| S-11 | Id names in create responses | Resolved |
| B-01 | Fuel: photo-first, no gauge pair | Resolved (needs confirmation) |
| B-02 | PIN lockout 5 / wipe 10 / 15 min | Resolved (needs confirmation) |
| B-03 | 24 h offline ceiling | Resolved (needs confirmation) |
| B-04 | Retry / backoff numbers | Resolved — confirmed: 6 attempts, 5 s → 5 min |
| B-05 | Throttle + poll cadence | Resolved (needs confirmation) |
| B-06 | Mayday hold time | Resolved — confirmed 2 s |
| B-07 | Media budget 500 KB | Resolved — confirmed 1080 px / 500 KB, video removed |
| B-08 | Badge counts from page size | Resolved — superseded by S-08 |
| B-09 | Shift queue defaults | Resolved — confirmed: today's date, 1 day |
| B-10 | Presign is re-requested per attempt | Resolved (needs confirmation) |
| B-11 | Role switch is per session | Resolved — persists on device, re-validated per sign-in |
| B-12 | Offline PIN never transits | Resolved |
| B-13 | Consent gate is read | Resolved |
| B-14 | Sign out keeps unsent writes | Resolved |
| B-15 | Biometric is a local unlock | Resolved |
| B-16 | Clock rollback fails closed | Resolved |
| B-17 | Both experiences are switchable | Open — needs confirmation |
| B-18 | Locale is en / sw | Resolved |
| B-19 | Two languages, no runtime switch of server copy | Resolved — confirmed: en/sw, device locale default, Settings toggle is explicit override |
| U-01 | Phone GPS fallback tracking | Resolved — `POST /telemetry/points` (residual D-08) |
| U-02 | Reefer temperature | Resolved |
| U-03 | Existing-trailer picker | Resolved — `GET /trailer` |
| U-04 | Odometer pre-check | Resolved |
| U-05 | Fuel card picker | Resolved — `GET /fuel/cards` |
| U-06 | Driver profile / name | Resolved |
| U-07 | Count endpoints | Resolved — same as S-08 |
| U-08 | Position timestamps and stale markers | Resolved (nullable, shown) |
| U-09 | Escalation timers and timeline | Resolved (one countdown, no timeline) |
| U-10 | "My vehicle" map without a fix | Resolved |
| U-11 | Statement import screen | Resolved |
| U-12 | `POST /fuel/refuel` is unreachable | Open — backend bug |
| P-10 | Google Maps setup | Open — needs you to create the keys |
| D-01 | Visual design review | Open — needs a designer |
| D-02 | Swahili copy review | Open — needs a native speaker |
| D-03 | `POST /consent` vs `/auth/consent` | Resolved — app calls `/auth/consent` |
| D-04 | openapi.yaml is a partial copy | Resolved — routers are the truth |
| D-05 | 16 permission codes were never seeded | Resolved — **authorisation change** |
| D-06 | Two `requirePermission` codes were UPPERCASE | Resolved — pure typo |
| D-07 | Templates returned no items | Resolved — additive |
| D-08 | Background position upload not shipped | Open — needs a device |
| P-06 | Notification delivery without Firebase | Resolved — gateway + local |
| D-05 | 16 permission codes were never seeded | Resolved (authorisation change) |
| D-06 | Two `requirePermission` codes were UPPERCASE | Resolved — pure typo |
| D-07 | Templates returned no items | Resolved — additive |
| T-08 | Residual security risks | Open |

---

## Open

### B-17
**Assumed:** with both `DRIVER` and an admin role, the app offers a role switch that lasts for the
session.
**Where:** `src/state/store.ts` (`setSession`), `src/screens/auth/AuthScreens.tsx` (`RoleSwitchScreen`)
**Blocker:** no.
**Confirm with:** product owner — should the choice persist across launches?

**Evidence:** roles are re-sent on every login and refresh (`sessionBody`), and nothing in the backend stores a preferred experience.
**If wrong:** a support call every time someone wants to swap. ASSUMPTION[B-17]
### P-10 — Google Maps and Firebase setup
**Assumed:** nothing about this is guessable from the repo, so this is the checklist for you.
**Where:** `app.config.ts` (`android.config.googleMaps.apiKey`, `googleServicesFile`), `eas.json`
**Evidence:** the app reads `GOOGLE_MAPS_API_KEY` and `GOOGLE_SERVICES_JSON` from the environment and
inlines them at build time; `react-native-maps` needs a real key to render a single tile, and
`expo-notifications` needs a real `google-services.json` to reach FCM.
**If wrong:** the map is a blank grey square and push never arrives, with no build error either way.
**Blocker:** yes — the app cannot be exercised on a device without these.
**Confirm with:** you. To create them:

1. **Google Cloud project** — one project for `africa.helix.driver` and one for `africa.helix.admin`.
2. **Maps SDK for Android** — enable *Maps SDK for Android* in each project. Note the map is rendered by
   `react-native-maps`, which on Android uses the Google Maps SDK, so this is not the Maps *URL* API.
3. **API key** — create a key, then **restrict it**: Android apps only, with the package name
   `africa.helix.driver` (or `africa.helix.admin`) and the SHA-1 of that app's signing certificate.
   There is no restriction on the Maps key itself beyond that; do not add an IP restriction, the app
   runs on mobile networks.
4. **Firebase project** — register an Android app per bundle id, download `google-services.json`, and put
   the path in `GOOGLE_SERVICES_JSON` for each EAS profile.
5. **Firebase Cloud Messaging** — enable it, and confirm FCM works on a physical device (an emulator
   without Play Services will not register, which is why `registerPush` returns quietly there).
6. **SHA-1s** — you will need at least three: the debug keystore, the upload keystore for Play, and the
   EAS remote keystore if you use one. Collect them with
   `keytool -list -v -keystore <keystore> -alias <alias>` and add **every** one to the Maps key
   restrictions, or the map silently fails on that build.
7. **Where to put them** — as EAS environment variables, not in the repo. `eas.json` profiles set
   `API_BASE_URL`, `WS_URL`, `SSL_PINS`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVICES_JSON`, `REQUIRE_PINNING`
   and `ADMIN_CONTACT` per environment.

### D-01
**Assumed:** the self-chosen colour, spacing and type scale are acceptable.
**Where:** `src/design/tokens.ts` and every screen.
**Evidence:** contrast ratios are asserted in `test/a11y.test.ts`, and the layout rules are guarded in
`test/guards.test.ts`; nothing here has been looked at by a designer.
**If wrong:** the app is usable but looks like a prototype.
**Blocker:** yes — this needs a person, not a test.
**Confirm with:** a designer.

### D-02
**Assumed:** the Swahili in `src/i18n/sw.ts` is correct and idiomatic.
**Where:** `src/i18n/sw.ts`.
**Evidence:** every key exists in both dictionaries (`test/i18nKeys.test.ts`), so nothing is missing or
dead, but nothing checks the language itself.
**If wrong:** a Swahili speaker reads stiff or wrong copy in the field.
**Blocker:** yes — a language check cannot be automated away.
**Confirm with:** a native Swahili speaker.

### T-08
**Assumed:** a client-side integrity verdict is good enough.
**Where:** `src/security.ts`, `src/core/security.ts`, `app.config.ts`.
**Evidence:** Play Integrity is never verified by the backend (there is no Play Integrity route anywhere in
`packages/api`), so a patched client can lie about root, hooks and debuggers. Pinning fails closed when
the pin config is missing, but a correctly configured pin list cannot be verified from inside the app.
**If wrong:** a compromised client passes the gate and replays writes.
**Blocker:** yes — needs Play Integrity verification server-side before this can be closed.
**Confirm with:** a security review, plus a backend decision on Play Integrity.

---

### D-08 — background position upload is not shipped
**Assumed:** phone-GPS fallback would keep working with the app in a pocket.
**Now:** it does not, and this is a deliberate line rather than an oversight. `POST /telemetry/points`
exists and the sampler works (see U-01), but the sampler only runs while the app is OPEN. On Android only a
foreground service keeps uploading once the app is backgrounded, and that needs `expo-task-manager` plus a
`foregroundService` permission plus a notification the driver must not dismiss — none of which has been run
on a real phone for a full shift in this repo. Shipping it untested would trade a known gap for an unknown
one.
**Where:** `src/core/phoneTracking.ts`, and the clock-in copy (`shift.phoneFallbackHelp`) says exactly this.
**Evidence:** there is no background-location permission in `app.config.ts` and no `expo-task-manager`
dependency; both are the work, not an oversight in the wiring.
**If wrong:** a driver whose tracker fails while the app is closed records a gap, and the HOS rest maths
that `phone_gps_fallback_enabled` implies is optimistic for that stretch. The tracker is the primary source,
so this is a fallback failing, not tracking failing.
**Blocker:** yes, but it needs a DEVICE, not code — this is the first item on the Phase 4 device script.
**Confirm with:** you, once a full shift has been run on a real phone with the screen off.

### P-06 — notification delivery without Firebase
**Assumed:** notifications arrive by FCM push token.
**Where:** `src/push.ts`, `src/realtimeService.ts`, `app.config.ts`, `test/guards.test.ts`
**Now:** they arrive over the realtime gateway the app already holds open. `packages/ws/src/gateway.ts`
publishes every notification to `notifications:{userId}`, and `packages/worker/src/outbox/relay.ts` and
`jobs/stale-shift.ts` publish to that topic. The app turns each `notifications` event into a LOCAL
notification with `expo-notifications`, which uses Android's own NotificationManager and needs no push
service. There is **no FCM token, no `google-services.json` and no Firebase project**; `test/guards.test.ts`
fails the build if any of the three come back.
**Evidence:** `fleet-management/packages/ws/src/gateway.ts` (`roomNotifications`, `EVENT_NOTIFICATIONS`).
**Cost, stated plainly:** a notification is delivered while the app process is alive and the socket is
connected. If Android has killed the process there is NO background delivery — reliable background push on
Android without FCM or an OEM channel is not achievable. The inbox is the durable record: the gateway
re-sends the unread snapshot on every connect, so nothing is lost, it is only late. Re-adding FCM later is
`googleServicesFile` in `app.config.ts` plus a token passed to `POST /auth/devices`, whose `push_token`
field already exists and is already persisted server-side; nothing else would change.
**If wrong:** a driver who has force-quit the app misses an alert banner until they reopen it. For this
product the alerts that matter (a Mayday) are SENT by the app, and the receiving end is a foregrounded
admin console, so the exposure is small — but it is not zero and it should be a conscious choice.
**Blocker:** no.
**Confirm with:** you — this is an architecture decision, not just a code change.

## Resolved

### C-01 — Device registration has no gate
**Was assumed:** an unregistered phone gets `DEVICE_UNKNOWN` and must register before it can do anything.
**Now:** there is no `DEVICE_UNKNOWN` code in the backend catalogue at all, and no unauthenticated
registration route. Registration happens right after login with the bearer token.
**Evidence:** `fleet-management/packages/shared/src/errors.ts` `ERROR_CODE_BUCKET` (no such code);
`packages/api/src/http/routes/auth.ts:296` `POST /auth/devices` (authenticated); `services/device.ts`
`findAnyByHash` compares `device_id_hash` exactly.
**Code:** `src/device.ts` `registerDevice` runs from `finishLogin`; the login screen has no device gate.

### C-02 — MFA recovery uses the verify endpoint
**Was assumed:** `POST /auth/mfa/recover`, reachable without a session.
**Now:** recovery codes go through `POST /auth/mfa/verify` with the same `{ mfa_challenge_token, code }`
body; `MfaService.verify` tries recovery codes first, and the response is the full session body
(so it *does* include a refresh token).
**Evidence:** `packages/api/src/http/routes/auth.ts:139`; `packages/shared/src/schemas/auth.ts`
`MfaVerifySchema` (`code` min 4 max 16); `services/mfa.ts` verify/recovery branch.
**Code:** `src/screens/auth/AuthScreens.tsx` — one field, labelled as an OTP *or* a recovery code.

### C-03 — MFA enrolment is self-service only
**Was assumed:** an admin provisions MFA for a driver, and the endpoint takes a target user.
**Now:** `POST /auth/mfa/enroll` takes only `{ password }`, requires `manage_own_mfa`, and enrols the
caller. There is no target-user field and no admin provisioning route anywhere in the API.
**Evidence:** `packages/api/src/http/routes/auth.ts:268`; `services/mfa.ts` `enroll`.
**Code:** the admin driver detail no longer offers enrolment; the self-service screen is reachable only
from Settings.

### C-04 — Driver channels are rooms, not subscriptions
**Was assumed:** the client emits `subscribe` with names like `driver:accident:{userId}`.
**Now:** the gateway derives rooms from the verified Principal and emits six events. The app listens;
it never subscribes. Driver rooms are keyed by the **driver** id, not user/shift/vehicle id.
**Evidence:** `packages/ws/src/gateway.ts:74` `roomDriver(driverId)`, `:161` `socket.join(roomDriver(scope.driverId))`,
`:164` notifications, `:187` `ROOM_VEHICLES` for admins, `:189` `ROOM_ACCIDENT` for the on-call roster.
**Code:** `src/core/realtime.ts` (`queryKeyForEvent`, `DRIVER_EVENTS`, `ADMIN_EVENTS`),
`src/realtimeService.ts`. The reference `packages/ws` in the app repo was replaced by the real contract.

### C-05 — Login response shape
**Was assumed:** `{ access_token, refresh_token, mfa_required, roles }`.
**Now:** `sessionBody()` — `token_type`, `access_token`, `access_token_expires_at`, `refresh_token`,
`refresh_token_expires_at`, `session_id`, `user_id`, `email`, `phone`, `roles`, `permissions`,
`locale`. The identity fields are mirrored into the response on purpose, so the client builds its
Principal from this trusted body rather than from a decoded token.
**Evidence:** `packages/api/src/http/routes/auth.ts` `sessionBody`; `packages/shared/src/mobile.ts`.
**Code:** `SessionResponseSchema`, `src/auth.ts` `performLogin`.

### C-06 — MFA challenge response shape
**Was assumed:** the same shape as a successful login, with `mfa_required: true` added.
**Now:** `{ mfa_required: true, mfa_challenge_token }` — and nothing else.
**Evidence:** `packages/api/src/http/routes/auth.ts` `mfa_required` branch.

### C-07 — Vehicle-states response
**Was assumed:** `{ vehicles: [{ vehicle_id, display_state, latitude, longitude, driver_name, next_eligible_clock_in_at }] }`
with non-null coordinates.
**Now:** the projection is `app.v_vehicle_display_state` and also carries `plate`, `odometer_km`,
`engine_hours`, `vehicle_class`, `asset_status`, `is_online`, `last_position_at`, `last_speed_kph`.
`latitude` and `longitude` **are nullable**: a quarantined asset or a tracker that never reported has
no position.
**Evidence:** `packages/api/src/services/queries.ts` `vehicleStates` (the SELECT list).
**Code:** `VehicleStateRowSchema`; the map skips a vehicle with no fix instead of pinning it at (0,0).

### C-08 — Shift states
**Was assumed:** these exact values.
**Now:** confirmed unchanged.
**Evidence:** `fleet-management/packages/shared/src/schemas/shifts.ts`.
**Code:** `ShiftState`, `ShiftVerificationStatus` in `packages/shared/src/types.ts (the app mirror; the backend source is types/db.ts)`.

### C-09 — Permission codes
**Was assumed:** a short invented list (`fuel:verify`, `admin:read`, …) that the app used to hide controls.
**Now:** the real 85-code list from `app.permissions`, granted as the union over roles. The UI gate is
`can()`, which is a strict set lookup when the response carried `permissions`, and permissive only when
it did not.
**Evidence:** `fleet-management/packages/shared/src/types/db.ts` (generated from `db/schema` +
`db/seed/01_seed.sql`); `packages/api/src/middleware/requirePermission.ts` (`codes.some(...)`).
**Code:** `PermissionCode`, `can`, `principalFromSessionBody`; every admin control gates on the
permission its endpoint actually requires.

### C-10 — Config key names
**Was assumed:** `offline.auth_window_hours`, `offline.pin_lockout_minutes`, `hos.daily_limit_hours`, …
**Now:** `auth.device_offline_max_hours`, `auth.offline_pin_lockout_attempts`,
`auth.offline_pin_wipe_attempts`, `auth.offline_pin_lockout_minutes`, `auth.max_concurrent_sessions`,
`shift.max_duty_hours`, `shift.overrun_warning_hours`, `speed.limit_kph`, …
**Evidence:** `fleet-management/packages/shared/src/config.ts` (generated from the seed).
**Code:** `NumericConfigKey` is a closed union, so a renamed key is a compile error.
**Also resolved:** there is no `GET /config`, so the app seeds the values locally; a safety rule such as
the offline ceiling must work with no network.

### C-11 — Money
**Was assumed:** a decimal string for money, but every fuel list row a nested `Money` object.
**Now:** the decimal string with `currency: "KES"` was right for the request bodies; the read models are
not nested at all. **string** with `currency: "KES"`. Note the reconciliation and pending-fuel rows return **flat
**numeric** columns from PG (`total_cost`, `unit_price`, `gauge_before_percent`) rather than a Money
object — the app parses them leniently.
**Evidence:** `fleet-management/packages/shared/src/schemas/fuel.ts` `RefuelSchema.total_cost`;
`fleet-management/packages/api/src/services/queries.ts` (the reconciliation-inbox SELECT returns
`total_cost` as a bare numeric column).

### C-12 — Error envelope
**Was assumed:** RFC 7807, but with a hand-written list of roughly the right codes.
**Now:** RFC 7807 with the backend's frozen 31-code catalogue, copied verbatim, plus `error_code` as the only branchable member. The frozen catalogue is 31 codes; the client
copies it exactly (`SERVER_ERROR_CODES`), and `test/misc-core.test.ts` fails if the two sets differ.
**Evidence:** `fleet-management/packages/shared/src/errors.ts` `ERROR_CODE_BUCKET`,
`RETRYABLE_ERROR_CODES`.
**Removed as invented:** `DEVICE_UNKNOWN`, `GAUGE_DELTA_HIGH`, `FUEL_PRICE_SPIKE`, `BLOCKER_DEFECT` are
not error codes. The last two are anomaly kinds; `block_shift` is a successful-response field. They now
live in `SIGNAL_CATALOG` and are shown next to a save that worked.

### C-13 — Login → MFA order
**Was assumed:** a fixed order — password, then MFA, then device registration, then consent.
**Evidence:** `fleet-management/packages/api/src/http/routes/auth.ts` — the login handler returns either
`sessionBody(...)` or `{ mfa_required: true, mfa_challenge_token }`, and `MfaRequired` / `ConsentRequired`
are thrown from the same service.
**Now:** there is no fixed order. The server decides and says so: tokens, or `mfa_required` with a challenge
token, or 403 `CONSENT_REQUIRED` / `ACCOUNT_SUSPENDED`. The state machine is one function
(`performLogin`) so Login and MFA Challenge cannot drift.

### C-14 — Refresh rotation
**Was assumed:** unknown — the draft could not say whether the refresh token changed.
**Now:** refresh tokens **are** rotated on every refresh, and the app restarts its offline window only after a
successful online exchange. `POST /auth/devices/refresh` additionally returns the server's own
`offline_until` from `auth.device_offline_max_hours`, which is authoritative when present.
**Evidence:** `services/session.ts` `refresh`; `services/device.ts:66`.

**Evidence:** `fleet-management/packages/api/src/services/session.ts` (`refresh` rotates) and `packages/api/src/services/device.ts:66` (`auth.device_offline_max_hours`).
### C-15 — `device_id_hash`
SHA-256 of the install's random device id. Compared as a whole string by `findAnyByHash`; not salted,
not truncated. The schema's `min(16)` is satisfied by the 64 hex characters.
**Evidence:** `packages/api/src/http/routes/auth.ts:296` `DeviceRegisterSchema`; `services/device.ts`.

**Now:** SHA-256 of the install's random device id, compared as a whole string.
### C-16 — Consent
`GET /me/consent` → `{ consented, current_version, required_version }`; `POST /auth/consent` takes
`{ consent_type, policy_version, accepted }`. The app sends the `required_version` the gate reported, so
a policy bump cannot leave a driver on stale consent.
**Evidence:** `packages/api/src/http/routes/me.ts:26`; `auth.ts:386`; `schemas/auth.ts` `ConsentSchema`.

**Now:** the gate is `GET /me/consent`; acceptance is `POST /auth/consent`.
### C-17 — Suspended vs blocked
`ACCOUNT_SUSPENDED` clears the cache, the queue and the session, then shows Suspended with no way back
except sign-out. Root/hook/pin failures show Blocked, which is a device problem, not an account one.

**Evidence:** `fleet-management/packages/api/src/http/write.ts` (`ACCOUNT_SUSPENDED` comes back as a 403 on any write) and `packages/api/src/security/tokens.ts` (the session check).
**Now:** Suspended is an account state, Blocked is a device state; they never mix.
### E-01 — `POST /devices/register` → `POST /auth/devices`
The guessed path does not exist. See C-01.
**Code:** `ENDPOINTS.registerDevice = POST /auth/devices`.

**Evidence:** `fleet-management/packages/api/src/app/app.ts:95` mounts the auth router at `${base}/auth`, so no route can answer `/devices/register`.
### E-02 — `POST /notifications/register` does not exist
There is no notification-registration endpoint. The inbox is a cursor page over
`GET /notifications` and a notification reaches the phone through FCM.
**Evidence:** `packages/api/src/http/routes/notifications.ts` (three routes only).

**Now:** no such endpoint exists.
### E-03 — `POST /push/token` does not exist
The FCM token is sent to `POST /auth/devices` as `push_token`, which is the only place the backend
accepts one. The app therefore hands the token to the same `registerDevice()` the login path already
calls, so it is idempotent.
**Evidence:** `packages/api/src/http/routes/auth.ts:296` `DeviceRegisterSchema.push_token`.

**Now:** no such endpoint exists; the FCM token goes to `POST /auth/devices`.
### E-04 — `GET /notifications` fields
Rows are `app.notifications`. There is **no `read_at`**: read state is the `status` column
(`QUEUED | SENT | DELIVERED | READ | FAILED | SUPPRESSED`), and the payload column is `payload`
(jsonb), not `data_json`. The title and body are already localised by the server.
**Evidence:** `packages/api/src/http/routes/notifications.ts` SELECT; `repositories/notifications.ts`.
**Code:** `NotificationSchema`, `isUnread`.

### E-05 — `PUT /devices/{id}/pin` → `POST /auth/devices/pin` with an **empty** body
The PIN never transits the wire; the server only records that a PIN exists, which is what makes the
offline unlock auditable.
**Evidence:** `packages/api/src/http/routes/auth.ts:320`; `schemas/auth.ts` `SetPinSchema` (empty object).

**Now:** `POST /auth/devices/pin` with an empty body.
### E-06 — `GET /media/{id}` returns a 302, not `{ url }`
`packages/api/src/http/routes/media.ts:78` calls `res.redirect(presigned.url)`. The reader follows the
redirect once with the bearer token and hands the object-storage URL to the image loader, so the token
never reaches the image request.
**Code:** `ApiClient.resolveMediaUrl`, `src/design/MediaThumb.tsx`.

### E-07 — `GET /vehicles/{id}`
It is a `VehicleRecord`: plate, class, status, `is_operational`, `non_operational_reason`, make, model,
year, ownership, `current_odometer_km`, `current_odometer_at`, `engine_hours`, tank capacity, notes.
It has **no** `current_shift`, `assignment`, `hos_state` or `quarantine_reason` — those were invented.
The map drawer reads the HOS rest-end from `next_eligible_clock_in_at` on the row itself and the
quarantine reason from `non_operational_reason`.
**Evidence:** `packages/api/src/services/vehicles.ts` `getOne`.

**Now:** a `VehicleRecord` — a plate and odometer, not a live operational picture.
### E-08 — Fuel gauge records (re-scoped, see U-12)
**Answer:** nothing creates them. There is no gauge-record endpoint, and the one endpoint that wants the
ids is unreachable. The working driver flow is `POST /driver/fuel/purchase`, which takes a receipt
photo, an odometer photo and the odometer reading, and lets the server's OCR fill litres and cost;
`POST /driver/fuel/correct` lets the driver fix what OCR read, and
`GET /driver/fuel/purchase/{id}/ocr` is polled until terminal.
**Evidence:** `packages/api/src/http/routes/fuel.ts:203`; `schemas/fuel.ts` `PhotoFirstRefuelSchema`.
**Code:** the refuel form submits the photo-first body and nothing else.

### E-10 — Assignments for clock-in
There is no list. `GET /drivers/me/assignment` returns the driver's **current** assignment as a single
object and 404 `NO_ASSIGNMENT` when there is none, so the assignment picker is gone and clock-in sends
the assignment the server already knows about.
**Evidence:** `packages/api/src/http/routes/onboarding.ts:155`.

**Now:** one object, not a list.
### E-12 — HOS remaining time
**Now:** the rest end is `next_eligible_clock_in_at` on the driver's own vehicle-state row.
`GET /dashboard/vehicle-states` narrows a DRIVER to their open shift plus their assignments and each row
carries `next_eligible_clock_in_at`. That is the rest end; the home screen shows a rest banner from it.
**Evidence:** `services/queries.ts` `vehicleStates` (`ownScopeDriverId`).

**Evidence:** `fleet-management/packages/api/src/services/queries.ts` `vehicleStates` (the `ownScopeDriverId` WHERE clause and the `next_eligible_clock_in_at` column).
### E-14 — DVIR photo on FAIL
Enforced in the service, not the schema: a FAIL needs a note and a photo, and a BLOCKER FAIL
quarantines the asset. `InspectionSubmitSchema` mirrors the zod schema exactly (no refine);
`InspectionSubmitStrictSchema` adds the service rule so the driver finds out before the round trip.
**Evidence:** `packages/api/src/services/inspections.ts`.

**Now:** the wire schema is permissive; a strict mirror adds the service rule.
### E-15 — Media accepts video and CSV
`MediaUploadSchema.content_type` is any non-empty string up to 200 characters, so `image/jpeg`,
`video/mp4` and the statement-import `text/csv` are all accepted. The earlier guess that the API refused
CSV was wrong — it came from a stale `MediaUploadRequestSchema` in the app's own schemas that nothing
imported.

**Evidence:** `fleet-management/packages/shared/src/schemas/media.ts` `MediaUploadSchema` (`content_type: z.string().min(1).max(200)`).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/schemas/media.ts` `MediaUploadSchema`..
### E-16 — Tenant-wide accident list
There is no `GET /accidents`. The one list endpoint takes `ownScope`; `ownScope=false` makes the backend
drop the driver filter and return every accident in the tenant.
**Evidence:** `packages/api/src/http/routes/accidents.ts:121`.

**Now:** `GET /accidents/me?ownScope=false`.
### E-17 — Suspend / reinstate a driver
`POST /admin/users/{id}/suspend` and `POST /admin/users/{id}/reinstate` (both `user:manage`), plus
`POST /drivers/{id}/approve` and `POST /sessions/revoke`. There is no `POST /drivers/{id}/suspend`.
**Evidence:** `packages/api/src/http/routes/admin.ts`.

**Now:** `POST /admin/users/{id}/suspend` and `/reinstate`.
### E-18 — Statement CSV upload
`POST /reconciliation/statements` with `{ provider, period_start, period_end, media_object_id,
column_mapping }`. The file is uploaded through the normal media presign path with
`owner_kind: STATEMENT_IMPORT`, `retention_class: STATEMENT_IMPORT`, `content_type: text/csv`, and only
the media id goes in the statement body.
**Evidence:** `packages/api/src/http/routes/fuel.ts` reconciliation router; `schemas/fuel.ts`.

**Now:** a normal media upload followed by `POST /reconciliation/statements`.
### E-19 — TOTP provisioning URI
There is none, because MFA is a **delivered** OTP: a 6-digit code sent by SMS to drivers and by email
to admins, with a 5-attempt cap and a 5-minute window. `enroll` returns only `recovery_codes`. The QR
screen was a wrong guess and is gone.
**Evidence:** `packages/api/src/services/mfa.ts:2` ("Role-routed DELIVERED OTP MFA (replaces TOTP)"),
`:27` `MAX_OTP_ATTEMPTS = 5`, `:41` "No TOTP secret is created".

**Now:** there is no provisioning URI, no secret and no QR code.
### S-01 — Mayday request
`{ shift_id: uuid|null, vehicle_id: uuid|null, position: GeoPoint, mayday_reason: string }`. Both ids are
required keys but nullable, which is how the API expresses "off shift". It bypasses every evidence rule.
**Evidence:** `packages/shared/src/schemas/accidents.ts` `MaydaySchema`.

**Now:** both ids are required keys but nullable, which is how the API says "off shift".
### S-02 — Accident request
`AccidentCreateSchema`: statement capped at 5000 chars, position must be a valid `GeoPoint`,
`position_source` is one of `TRACKER | PHONE_GPS | MANUAL`. There is **no severity field** — the server
derives severity — so the local severity chips are a triage hint and are not sent.

**Evidence:** `fleet-management/packages/shared/src/schemas/accidents.ts` `AccidentCreateSchema` — note there is no `severity` member.
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/schemas/accidents.ts` `AccidentCreateSchema`..
### S-03 — Inspection item shape
`{ template_item_id, result, numeric_value?, notes?, photo_media_object_id? }`. The admin detail item
adds `photo_count` and `blocker` (the table stores severity, not a boolean).

**Evidence:** `fleet-management/packages/shared/src/schemas/inspections.ts` `InspectionItemSchema`, and `packages/api/src/repositories/inspections.ts` `DvirDetailItemRow`.
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/schemas/inspections.ts` `InspectionItemSchema`..
### S-05 — Error buckets
`transient | client | third_party | business | data_corruption`, with the retryable set being exactly
`SERVICE_UNAVAILABLE`, `RATE_LIMITED`, `IDEMPOTENCY_INFLIGHT`. `IDEMPOTENCY_CONFLICT` is `client`, so a
replayed key with a different body is a hard failure, not a retry.
**Code:** `classifyResponse` keys on `error_code` first and no longer treats *every* 409 as in-flight —
`CLOCKOUT_PENDING`, `SHIFT_ALREADY_OPEN` and `UNLOCK_REQUIRED` are also 409 and need a person.

**Evidence:** `fleet-management/packages/shared/src/errors.ts` (`ERROR_CODE_BUCKET` and `RETRYABLE_ERROR_CODES`).
### S-06 — Socket payloads
The gateway publishes the raw accident event on `accident:live` (a Mayday sets `mayday`), forwards
whatever the producer published on `driver:accident`, and emits the full vehicle array on
`map:vehicle-states`. The app treats every payload as untrusted: ids must be UUIDs and free text is
trimmed, so a malformed event can never put arbitrary content in front of someone.

**Evidence:** `fleet-management/packages/ws/src/pubsub.ts` (what the producers publish) and `packages/ws/src/gateway.ts` (what the gateway emits).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/ws/src/pubsub.ts`..
### S-07 — Snapshot keys
There is no snapshot envelope with named keys. On every (re)connect the gateway re-emits current state:
the whole vehicle array for an admin, the driver's own vehicle row + shift row + unread notifications for
a driver. The app's "reconnect invalidates everything I listen for" *is* the snapshot, and a reconnect
drops the throttle window so that refetch happens immediately rather than up to 2 s later.

**Evidence:** `fleet-management/packages/ws/src/gateway.ts` `handleConnection` (the admin snapshot emits the whole array; the driver snapshot emits one row each).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/ws/src/gateway.ts` `handleConnection`..
### S-09 — Notification read state
`status`, not `read_at`. `POST /notifications/{id}/read` sets it to `READ`, and that is also what the
gateway's own unread filter uses.

**Evidence:** `fleet-management/packages/api/src/http/routes/notifications.ts` (`POST /notifications/:id/read` sets `status = READ`).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/api/src/http/routes/notifications.ts`..
### S-10 — Media response
`{ media_object_id, upload_url, expires_in_seconds, method }`; the presign lasts 60 seconds.

**Evidence:** `fleet-management/packages/shared/src/schemas/media.ts` `MediaUploadResponseSchema` and `packages/api/src/media/presigner.ts` (60 s).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/schemas/media.ts` `MediaUploadResponseSchema`..
### S-11 — Id names in create responses
`shift_id` (clock-in), `accident_id`, `inspection_id`, `trailer_assignment_id`, `fuel_purchase_id`.
There is no `fuel_record_id` anywhere, because nothing creates an `app.fuel_records` row. Clock-out
returns **only** `{ shift_id }` — the `state`, `shift_duration_seconds` and `distance_km` in openapi are
not implemented.

**Evidence:** `fleet-management/packages/api/src/http/routes/{shifts,accidents,inspections,trailer,fuel}.ts` (the `ok({ ... })` bodies).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/api/src/http/routes/{shifts,accidents,inspections,trailer,fuel}.ts`..
### B-01 — Fuel flow
Resolved as photo-first; **needs your confirmation** that the B3 gauge-pair flow is retired rather than
fixed (see U-12).

**Evidence:** `fleet-management/packages/api/src/http/routes/fuel.ts:203` (`POST /driver/fuel/purchase`).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/api/src/http/routes/fuel.ts:203`..
### B-02 — PIN lockout
4 digits, 5 wrong tries lock for 15 minutes, 10 wipe the PIN locally. Those numbers now come from
`auth.offline_pin_lockout_attempts`, `auth.offline_pin_wipe_attempts` and
`auth.offline_pin_lockout_minutes`. A clock moved backwards is treated as tampering, not as a shorter
wait. **Needs confirmation.**

**Evidence:** `fleet-management/packages/shared/src/config.ts` (`auth.offline_pin_lockout_attempts`, `_wipe_attempts`, `_lockout_minutes`).
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/config.ts` (`auth.offline_pin_*`)..
### B-03 — 24 h offline ceiling
Enforced locally from `auth.device_offline_max_hours`, tightened by the server's own `offline_until`
when the device has been bound. **Needs confirmation.**

**Evidence:** `fleet-management/packages/shared/src/config.ts` (`auth.device_offline_max_hours` = 24) and `packages/api/src/services/device.ts:66`.
**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/packages/shared/src/config.ts` (`auth.device_offline_max_hours`)..
### B-04 — Retry / backoff numbers
**Was assumed:** unknown — the draft could not say whether the retry counts and backoff curve were fixed.
**Now:** confirmed: max 6 attempts per item, backoff 5 s → 5 min, and `IDEMPOTENCY_INFLIGHT` is retried
up to 6 times then left PENDING. The server classifies `IDEMPOTENCY_INFLIGHT` as `transient` and
`IDEMPOTENCY_CONFLICT` as `client`, so a replayed key with a different body is never retried.
**Evidence:** `fleet-management/packages/shared/src/errors.ts` (`RETRYABLE_ERROR_CODES`); the local values are
`POLICY.maxAttempts`, `POLICY.retryBaseMs`, `POLICY.retryMaxMs` in `src/core/policy.ts`.
### B-05 — Throttle and poll cadence
One refetch per query key per 2 s while connected; 15 s REST polling when the socket is down.
**Needs confirmation.**

**Evidence:** no backend constant; the cadence is a device-side choice in `src/core/queryConfig.ts` and `src/core/realtime.ts`.
**Now:** 2 s throttle while connected, 15 s polling while not.
**Evidence:** nothing in `fleet-management/packages/api` sets a client cadence; the numbers are a device choice. The gateway only tells the client when it reconnects (`fleet-management/packages/ws/src/gateway.ts`)..
### B-06 — Mayday hold time
**Was assumed:** a 2-second hold before sending.
**Now:** confirmed: 2 s. The hold is purely client-side; nothing server-side depends on it.
**Evidence:** `app/packages/mobile/src/core/policy.ts` (`POLICY.maydayHoldMs` = 2_000); consumed by
`src/design/MaydayButton.tsx` (`delayLongPress`). The backend `POST /accidents/mayday` route
(`fleet-management/packages/api/src/http/routes/accidents.ts`) has no hold-time parameter, confirming
the timer is device-only.
### B-07 — Media budget 500 KB
**Was assumed:** a photo is resized to 1080 px and kept under 500 KB.
**Now:** confirmed: 1080 px / 500 KB. Video is removed: a 15 s clip cannot fit the budget, so the control
is not offered. The backend accepts any content type and does not check size (`MediaUploadSchema` has no
size rule), so this is a device-side budget only.
**Evidence:** `app/packages/mobile/src/core/policy.ts` (`POLICY.mediaMaxBytes`, `POLICY.mediaMaxWidthPx`);
`src/core/media.ts` and `src/design/PhotoCapture.tsx` enforce it before upload. The backend schema
`fleet-management/packages/shared/src/schemas/media.ts` (`MediaUploadSchema`) confirms there is no
server-side size check.
### B-10 — Presign per attempt
A presigned URL is requested fresh on every upload attempt; a failed PUT is retried, never reused,
because the URL only lasts 60 s. **Needs confirmation.**

**Evidence:** `fleet-management/packages/shared/src/schemas/media.ts` (`expires_in_seconds`), and `packages/api/src/media/presigner.ts`.
**Now:** a fresh presign on every attempt.
**Evidence:** `fleet-management/packages/api/src/media/presigner.ts` issues a 60-second URL, which is why a failed PUT must re-presign..
### B-12 — Offline PIN never transits
`POST /auth/devices/pin` takes an empty body. The PIN is salted-PBKDF2 in SecureStore and is compared
locally only.

**Evidence:** `fleet-management/packages/api/src/http/routes/auth.ts:320` (`POST /devices/pin`) and `packages/shared/src/schemas/auth.ts` `SetPinSchema` (an empty object).
**Now:** the PIN never leaves the device.
**Evidence:** `fleet-management/packages/api/src/http/routes/auth.ts:320` takes an empty body for the PIN flag..
### B-13 — Consent gate is read
The app reads `GET /me/consent` before offering the clock-in form and never blocks the form offline —
the server enforces it anyway, and a driver with no signal must still be able to prepare the shift.

**Evidence:** `fleet-management/packages/api/src/http/routes/me.ts:26` (`GET /me/consent`).
**Now:** read the gate, never block the form offline.
**Evidence:** `fleet-management/packages/api/src/http/routes/me.ts:26` is the gate..
### B-14 — Sign out keeps unsent writes
Queued writes and staged photos survive sign-out and are replayed on the next sign-in **on the same
device**. If a *different* person signs in on that device the previous person's unsent work is destroyed
rather than replayed under the new person's token, because unsent work is personal data.

**Evidence:** no backend contract: `app.offline_queue` rows are not owned by a user, so the app keys ownership off the stored `queue_owner`.
**Now:** unsent work survives sign-out on the same device, and is destroyed if a different person signs in.
**Evidence:** no backend contract at all: `app.offline_queue` (`fleet-management/db`) has no user column, so ownership is tracked on the device..
### B-15 — Biometric is a local unlock
Biometrics only release the stored session on this device; the server still needs a valid refresh token
once there is a network.

**Evidence:** `fleet-management/packages/api/src/http/routes/auth.ts` — there is no biometric endpoint; the refresh token is still required.
**Now:** a local unlock, not an authentication.
**Evidence:** there is no biometric endpoint anywhere in `fleet-management/packages/api`; the refresh token is still required..
### B-16 — Clock rollback fails closed
A timestamp before the last successful auth is treated as tampering, not as extra offline time.

**Evidence:** no backend contract; the local ceiling is stricter than the server window on purpose.
**Now:** fail closed.
**Evidence:** no backend contract; the local ceiling is deliberately stricter than `auth.device_offline_max_hours` (`fleet-management/packages/shared/src/config.ts`)..
### B-11 — Role switch persistence
**Was assumed:** the role choice lasts for the session only.
**Now:** the choice persists on the device via SecureStore and is re-validated against the session's
roles on every sign-in, so a remembered choice can never grant access the roles do not carry.
**Evidence:** `app/packages/mobile/src/state/store.ts` (`restoreActiveRole`, `setActiveRole`); the backend
re-sends `roles` on every login and refresh (`fleet-management/packages/api/src/http/routes/auth.ts`
`sessionBody`), so the persisted choice is always checked against what the session actually holds.
### U-07 — Count endpoints
**Assumed:** the inbox and flag badges can show exact numbers.
**Where:** `src/hooks.ts` (`useBadgeCounts`)
**Evidence:** this is the product-side view of the same gap as S-08: there is no count endpoint for
notifications or anomalies, only a cursor page.
**If wrong:** the badge is a lower bound, not a count.
**Blocker:** no — cosmetic.
**Confirm with:** product owner — see S-08.

**Evidence:** `fleet-management/packages/api/src/http/routes/notifications.ts` and `insights.ts` — only cursor pages, no count route.
**Now:** a badge is the first page size, with a "+" when `has_more`.
**Evidence:** `fleet-management/packages/api/src/http/routes/notifications.ts` and `insights.ts` expose cursor pages only..
### B-18 — Locale
`en` / `sw` only, from `app.users.locale`; `locale.timezone` is `Africa/Nairobi` and `locale.currency`
is `KES`.

**Evidence:** `fleet-management/packages/shared/src/config.ts` (`locale.timezone`, `locale.currency`) and `packages/shared/src/types/db.ts` (`users.locale`).
**Now:** `en` / `sw`, EAT, KES.
**Evidence:** `fleet-management/packages/shared/src/config.ts` sets `locale.timezone` / `locale.currency`..
### B-19 — Two languages, no runtime switch of server copy
**Was assumed:** the app's UI copy is sent by the server in the user's locale.
**Now:** confirmed: two languages (`en`, `sw`), the device locale is the default, and the Settings toggle
is the explicit override which persists on the device. The server localises notification copy only; every
string the app renders itself must exist in both dictionaries.
**Evidence:** `app/packages/mobile/src/core/policy.ts` (`POLICY.locales`); `src/i18n/index.ts` derives the
`Locale` type from it and persists the override in SecureStore; `test/i18nKeys.test.ts` demands every key
in both dictionaries. The backend `locale.timezone` / `locale.currency` keys
(`fleet-management/packages/shared/src/config.ts`) and `app.notifications.locale` confirm the server
localises notification text only, not the app's own UI copy.
### D-03 — `POST /consent` vs `/auth/consent`
openapi documents `POST /consent`, but the route is declared inside `auth.ts`, which `app.ts` mounts at
`${base}/auth`. The path that actually answers is `/auth/consent`. The app calls `/auth/consent`;
`test/contract.test.ts` fails if the router ever stops declaring it.

**Evidence:** `fleet-management/packages/api/src/app/app.ts:95` (auth router mounted at `${base}/auth`) vs `fleet-management/api/openapi.yaml` (`/consent`).
**Now:** the app calls `/auth/consent`.
**Evidence:** `fleet-management/packages/api/src/app/app.ts:95` vs `fleet-management/api/openapi.yaml`..
### D-04 — openapi.yaml is a partial copy
It documents no device registration, no onboarding, no photo-first fuel and no media read, and it lists
`POST /consent` at a path the router does not serve. `test/contract.test.ts` therefore rebuilds the
route table from `packages/api/src/http/routes/*.ts` + the mount table in `app.ts`, and cross-checks
openapi only where it does document a path. The two known spec gaps (`GET /inspections`,
`POST /drivers` are served but not documented) are asserted by name so they cannot be forgotten.

**Now:** any non-empty content type up to 200 characters is accepted, including `video/mp4` and `text/csv`.
**Evidence:** `fleet-management/api/openapi.yaml` vs `packages/api/src/http/routes/*.ts`..
### U-08 — Position timestamps and stale markers
`last_position_at` and `is_online` exist on the vehicle-state row, and both are nullable; the map shows
`OFFLINE` when there is no fix, and the live-refresh indicator is driven by the socket state.

**Evidence:** `fleet-management/packages/api/src/services/queries.ts` `vehicleStates` (the `last_position_at` / `is_online` columns).
**Now:** `last_position_at` and `is_online` are shown, and a null position reads as OFFLINE.
**Evidence:** `fleet-management/packages/api/src/services/queries.ts` `vehicleStates`..
### U-09 — Escalation timers and timeline
There is no `escalation_timers` array and no `timeline` array. The detail exposes a single
`seconds_to_escalation` countdown to the next tier plus `escalation_tier` and `chain_valid`, so the
countdown is derived from that one number and started at mount.

**Evidence:** `fleet-management/packages/api/src/services/accidents.ts:266` (`AccidentDetailView.seconds_to_escalation`) — there is no `timeline` member.
**Now:** one countdown from `seconds_to_escalation`; no timeline.
**Evidence:** `fleet-management/packages/api/src/services/accidents.ts:266` — `seconds_to_escalation`, no `timeline`..
### U-10 — "My vehicle" map with no fix
Handled: a driver whose tracker has not reported has no position, so the screen says so instead of
centring on a null.

**Evidence:** `fleet-management/packages/api/src/services/queries.ts` `vehicleStates` (latitude/longitude are `string | null`).
**Now:** the screen says the position is unknown instead of centring on a null.
**Evidence:** `fleet-management/packages/api/src/services/queries.ts` `vehicleStates` (coordinates are nullable)..
### U-11 — Statement import screen
Built and wired: pick a CSV, map the columns, `POST /reconciliation/statements`.**Evidence:** `fleet-management/packages/api/src/http/routes/fuel.ts` (the reconciliation router) and `packages/shared/src/schemas/fuel.ts` `StatementImportSchema`.
**Now:** built and wired to `POST /reconciliation/statements`.
**Evidence:** `fleet-management/packages/shared/src/schemas/fuel.ts` `StatementImportSchema`..

### E-09
**Was assumed:** the DVIR checklist can be rendered from `GET /inspections/templates`.
**Now:** it can. The backend bug was that `InspectionTemplateRepository.listActive()` selected only
`t.id`, `t.name`, `t.name`, so the driver received `{ template_id, name, label }` and could not render a
single line. `listActive()` now joins `app.inspection_template_items` and returns each item with `code`,
`label_en`, `label_sw`, `severity`, `input_type`, `unit`, `min_value`, `max_value`, `is_required` and
`sequence`. The seed already populated them (`db/seed/01_seed.sql` — DVIR_TRACTOR_V1 5 items,
DVIR_TRAILER_V1 6, SWAP_TRAILER_V1 3), so no data migration was needed.
**Evidence:** `fleet-management/packages/api/src/repositories/inspections.ts` `listActive()`; the columns are
`fleet-management/db/schema/05_operations.sql` (`label_en`, `label_sw`, `severity`, `input_type`, `unit`, `min_value`,
`max_value`, `is_required`, `sequence`).
**Code:** `InspectionTemplateItemOptionSchema`; the DVIR form renders one control per item and refuses to
submit a required item that has no result.

### E-13
**Was assumed:** no last accepted odometer is readable, so a driver only learns about a decrease after the round trip.
**Now:** `GET /vehicles/{id}` returns `current_odometer_km` and `current_odometer_at` — the vehicle's last
ACCEPTED reading (the column the C4.2 rollback trigger maintains). `asset:read` is a DRIVER permission, so
this is readable from the driver's own phone.
**Evidence:** `fleet-management/packages/shared/src/schemas/vehicles.ts` `VehicleRecordSchema`; `fleet-management/db/schema/04_assets.sql`
(`current_odometer_km`, `current_odometer_at`).
**Code:** `lastOdometerQuery`; clock-in and clock-out warn on a decrease and on a jump over 500 km, and
block submission until it is corrected.

### S-04
**Was assumed:** the push payload has a predictable `{ entity, id }` shape.
**Now:** the only non-empty payload any producer writes is `{ shift_id }`, from the stale-shift job
(`jsonb_build_object('shift_id', $1)`). The accident-escalation and DVIR producers omit the `payload`
column entirely, so theirs is `{}`. The 18 seeded `app.notification_templates` rows are never rendered — no
producer sets `template_code` and no template-rendering code exists — so there is no second vocabulary.
**Evidence:** `fleet-management/packages/worker/src/jobs/stale-shift.ts` (the only payload) and
`fleet-management/packages/worker/src/jobs/pg.ts` `enqueueNotification` (no payload column).
**Code:** `targetFromData` accepts only `shift_id` and ignores everything else, because a guessed route is
worse than the inbox.

### U-02
**Was assumed:** the reefer temperature cannot be captured because the template does not say which item is numeric.
**Now:** it can. `app.inspection_input_type` is `PASS_FAIL | NUMERIC` and the seeded `REEFER_TEMP` item is
`NUMERIC` with `unit 'C'`, `min_value -40`, `max_value 40`. Once the items were exposed (E-09) the template
itself said which line was a temperature and what range was legal.
**Evidence:** `fleet-management/db/schema/01_enums.sql` (`app.inspection_input_type`); `fleet-management/db/seed/01_seed.sql` (REEFER_TEMP).
**Code:** a NUMERIC item renders a number field labelled with its own bounds and unit, and the form blocks
submission when the reading is out of range or missing.

### U-04
**Was assumed:** unimplemented; it needed the same read endpoint as E-13.
**Now:** built. Both clock-in and clock-out show the vehicle's last accepted reading next to the field and
refuse a lower value before the round trip.
**Evidence:** see E-13 (`fleet-management/packages/shared/src/schemas/vehicles.ts`).
**Code:** `odoError` in `src/screens/driver/DriverScreens.tsx`.

### U-06
**Was assumed:** no driver-facing profile endpoint exists, so the app cannot show a display name.
**Now:** `GET /drivers/me/onboarding` returns `full_name` (plus licence, background-check state and consent)
and is own-scoped. It was unreachable only because its `onboarding:read` permission had no row in
`app.permissions`; that is fixed (see D-05).
**Evidence:** `fleet-management/packages/api/src/http/routes/onboarding.ts` `GET /onboarding`; the gate is
`requirePermission("onboarding:read")` and `listForUser`-style own scoping via `svc.drivers.findByUserId`.
**Code:** `myOnboardingQuery`; the home screen greets the driver by name, falling back to the nav title when
there is no onboarding record yet.

### D-05 — permission codes that were declared but never seeded
**Assumed:** every code in `PermissionCode` had a row in `app.permissions`.
**Now:** it did not. **16 codes existed only in the TypeScript union**, and `app.role_permissions.permission_code`
has a FOREIGN KEY to `app.permissions(code)` — so they could never be granted to any role, and every route
gated on one was a hard 403 for everybody, ADMIN included. The victim list included the whole accidents API
(`accident:read`, `accident:report`, `accident:acknowledge`, `accident:close`), the inbox
(`notification:read`), driver onboarding (`onboarding:read`, `onboarding:submit`), anomaly detail
(`anomaly:read`), training and privacy.
**Evidence:** `packages/shared/src/types/db.ts` `PermissionCode` vs the `INSERT INTO app.permissions` block in
`db/seed/01_seed.sql`; the FK is `db/schema/02_identity.sql`.
**Fixed by:** adding the 16 rows to the seed, and granting DRIVER the read halves of the flows it could
already create — `inspection:read`, `accident:read`, `notification:read`, `onboarding:read`,
`onboarding:submit`. **This is an authorisation change**, so it was checked first: every route concerned is
already own-scoped server-side. `GET /accidents/:id` passes `ownScopeDriverId(req, svc, "accident:update")`,
`GET /inspections/:id` passes `ownScopeDriverId(req, svc, "inspection:template_manage")`, `GET /notifications`
calls `listForUser(principal.userId)`, and `/me` uses `svc.drivers.findByUserId`. A driver therefore reads
only their OWN records, and the fleet-wide permission (`accident:update`, `inspection:template_manage`) is what
lifts the scope. No data is exposed beyond what the driver already wrote.
**If wrong:** a driver could read another driver's accident or DVIR. The code paths say otherwise, but this is
the one change here that touches authorisation, so it is worth a second pair of eyes.
**Blocker:** no — but it is the change most worth reviewing.
**Confirm with:** you.

### D-06 — two `requirePermission` codes were UPPERCASE
**Assumed:** the two self-service auth routes were reachable.
**Now:** they were not. `requirePermission` compares against the lowercase union in `types/db.ts`, and
`asPerm()` is a cast, so `asPerm("MANAGE_OWN_MFA")` could never match a grant. `POST /auth/mfa/enroll` and
`POST /auth/devices/revoke` answered 403 for every role — two-step login could not be switched on by anyone,
and the self-service device revoke was dead.
**Evidence:** `packages/api/src/http/routes/auth.ts` (`asPerm("manage_own_mfa")`, `asPerm("revoke_device")` now);
`requirePermission` in `packages/api/src/middleware/requirePermission.ts`.
**Fixed by:** lower-casing both. This is a pure typo fix and grants nothing: the permissions themselves were
already seeded and already granted to DRIVER.
**If wrong:** nothing — it was unreachable before.
**Blocker:** no.
**Confirm with:** no one.

### D-07 — `GET /inspections/templates` returned no items (E-09's root cause)
**Assumed:** the response shape `InspectionTemplateOption` was what the driver needed.
**Now:** the SQL selected `t.id`, `t.name`, `t.name` and nothing else. `InspectionTemplateItemRepository` had
**no read method at all** — it was only ever used for write-path validation
(`getById(item.template_item_id)` in `services/inspections.ts`), so the table was never selected from anywhere
in the codebase.
**Evidence:** `fleet-management/packages/api/src/repositories/inspections.ts` (before/after `listActive()`).
**Fixed by:** `listActive()` now loads the items for the returned templates in one extra query, keyed by id,
in `sequence` order. Additive: the existing three fields are unchanged.
**If wrong:** nothing — the previous response carried no information the app could use.
**Blocker:** no.
**Confirm with:** no one.

### U-12 — the B3 gauge-pair refuel is retired
**Was assumed:** a driver could submit `POST /fuel/refuel` with a `before_fuel_record_id` and an
`after_fuel_record_id`.
**Now:** retired, deliberately, on the backend. Three things were true at once:
1. **No endpoint ever created an `app.fuel_records` row**, so the two ids the body demands could not be
   obtained. `InspectionTemplateItemRepository`-style read access does not exist for that table either.
2. The route's guard was `requirePermission(asPerm("fuel:enter"))`, and **`fuel:enter` is not in
   `app.permissions`** — the seeded permission is `fuel:record_gauge` — so it answered 403 FORBIDDEN for
   every role.
3. The database had already moved on: migration 12 introduced the `DRIVER_PHOTO` entry source precisely so a
   photo-first driver row does NOT need the gauge pair
   (`fuel_purchases_driver_entry_has_gauge_pair` is kept only to protect legacy `DRIVER` rows).

I did not simply correct the typo to `fuel:record_gauge`: that would have made the route reachable and let a
driver insert a `DRIVER` row with two fabricated UUIDs pointing at nothing, which is worse than a 403.
**Removed instead:** the `POST /fuel/refuel` route, `FuelService.submitRefuel`, `RefuelSchema` /
`RefuelInput`, the `MISSING_GAUGE_PAIR` error code (no longer producible), the `openapi.yaml` path, and the
app's `ENDPOINTS.refuel`. The database constraint is left in place — it still guards historical rows.
**Now:** `POST /driver/fuel/purchase` is the single driver fuel entry: a receipt photo, an odometer photo and
the odometer reading, with OCR filling litres and cost and `POST /driver/fuel/correct` letting the driver fix
what OCR read.
**Evidence:** `fleet-management/db/schema/12_fuel_hardware_extension.sql:128-140` (the `DRIVER_PHOTO`
constraint and its comment); `packages/api/src/media` and `packages/api/src/http/routes/fuel.ts` (the route
header now records the retirement).
**Code:** `ENDPOINTS.driverFuelPurchase` is the only fuel write the app makes.
**If wrong:** nothing — the flow was unreachable before and is gone now.
**Blocker:** no.
**Confirm with:** no one. If a gauge-record endpoint is ever wanted, it is a NEW schema and a NEW route, not
a revival of this one.

### E-11
**Was assumed:** clock-in carries a work plan and the server returns a disclaimer, but what the disclaimer says is undocumented.
**Now:** both are wired, and neither is invented. `ClockInSchema` accepts `planned_notes` and
`work_plan_media_object_ids`, so the form now sends `planned_notes` from an optional field, and a
successful clock-in surfaces the server's own `disclaimer` verbatim on a follow-up screen before navigating
away. Whether a work plan is MANDATORY for this tenant remains a server-side decision the client does not
pre-empt: `WORK_PLAN_REQUIRED` is a 422 the server raises, and adding that rule later needs no client change.
**Evidence:** `fleet-management/packages/shared/src/schemas/shifts.ts` `ClockInSchema`; the clock-in
response is `{ shift_id, clock_in_at, disclaimer }`.
**Code:** `planned_notes` on clock-in; `lastSubmitResponse()` carries the response body so the disclaimer is
read from the server's own words.

### S-08
**Was assumed:** the inbox and flag badges could never be exact.
**Now:** the inbox badge is exact. `GET /notifications/count` returns `{ total, unread }` and its UNREAD
predicate (`status NOT IN ('READ','FAILED','SUPPRESSED')`) is deliberately the SAME filter the gateway uses
for its unread snapshot, so the badge and the inbox agree by construction. The anomaly badge is still a
lower bound: there is no anomaly-count endpoint, and `GET /reports/analytics` (which does have
`anomalies_open`) needs `report:read`, which a DRIVER does not hold.
**Evidence:** `fleet-management/packages/api/src/repositories/notifications.ts` `countForUser`.
**Code:** `useBadgeCounts` reads the count endpoint; the admin overview reads `GET /reports/analytics` for
accidents, pending DVIRs, flags and documents, and labels any remaining card "at least" for a screen reader.

### U-01
**Was assumed:** there was no way for a phone to contribute a position, so `phone_gps_fallback_enabled`
was a flag that changed rest arithmetic with no data behind it.
**Now:** the ingest exists. `POST /telemetry/points` is authenticated, takes a batch of up to 60 points, and
publishes them to the SAME `traccar:positions` stream the Traccar webhook uses, so the worker, the retention
rules and the map behave identically. Attribution is the important part: the vehicle comes from the CALLER'S
OPEN SHIFT, resolved from the bearer token, never from the body, and a point outside the caller's own shift
is refused — so a stolen token cannot paint the map or move somebody else's rest arithmetic. The route also
bounds the batch (60), its age (5 min) and its sampling floor (10 s), because a phone battery cannot support
a 1 Hz stream and a large batch would be a way to flood the shared stream.
**Evidence:** `fleet-management/packages/shared/src/ingest.ts` `PhonePointsSchema`, `PHONE_POINTS`,
`normalizePhonePoint`; `fleet-management/packages/api/src/http/routes/telemetry.ts` `POST /points`.
**Code:** `src/core/phoneTracking.ts`. `phone_gps_fallback_enabled` is now sent TRUE only when the sampler
actually STARTED, so the server's rest maths can never assume tracking that is not running.
**Residual, and it is real:** the sampler runs while the app is OPEN. There is deliberately no
`expo-task-manager` foreground service, because one that has never been run on a real phone for a full shift
is a worse risk than not shipping it. See the new entry D-08.

### U-05
**Was assumed:** no fuel-card list existed, so a picker had nothing to show.
**Now:** `GET /fuel/cards` exists and is guarded by `asset:read` — which a DRIVER holds — rather than
`fuel:card_manage`, because choosing which card to present is not card ADMIN; only `POST /fuel/cards` is.
It returns this vehicle's dedicated card plus every pooled card, and deliberately does NOT return
`last_four` or `notes`: the refuel form still asks for the four digits, and a card note is not something to
read on a phone in a yard.
**Evidence:** `fleet-management/packages/api/src/repositories/fuel.ts` `listSelectable`.
**Code:** `fuelCardsQuery`; the refuel form renders the cards as a radio group and still requires the digits.

### B-08
**Was assumed:** a badge is the size of the first page, with a "+" when more exist.
**Now:** superseded. The inbox badge is an exact count (see S-08) and the admin overview reads real counts
from `GET /reports/analytics`. Only the anomalies badge, which a driver sees, is still a bound — and it is
labelled "at least" for a screen reader rather than presented as a count.
**Evidence:** `fleet-management/packages/api/src/http/routes/notifications.ts` `GET /count`.
**Code:** `BADGE_PAGE_SIZE` remains in `src/core/policy.ts` because it is still the fetch size, but it no
longer stands in for a count.

### B-09 — Shift queue defaults
**Was assumed:** the shift review queue opens on today's Kenyan date with status `PENDING`.
**Now:** confirmed: the app defaults to today's date (`POLICY.reviewQueueDays = 1`). The endpoint filters
on an exact `operational_date` and defaults to ALL dates when the param is omitted, so "open on today"
is a client default either way.
**Evidence:** `app/packages/mobile/src/core/policy.ts` (`POLICY.reviewQueueDays`); consumed by
`src/screens/review/ReviewQueueScreen.tsx`. The backend route
`fleet-management/packages/api/src/http/routes/shifts.ts` (`GET /shifts/verification-inbox`) confirms
the date filter is optional and defaults to all dates.

### U-03
**Was assumed:** no trailer list existed, so the hook screen could only create a trailer.
**Now:** `GET /trailer` exists — note the SINGULAR path, because `app.ts` mounts the trailer router at
`${base}/trailer` alongside `POST /trailer/swap`. It returns every available, operational trailer, bounded
at 200, with `current_vehicle_id` and the reefer set-point band. The picker hides any trailer already hooked
to a vehicle, because the database's unique partial indexes make a double-hook a hard error.
**Evidence:** `fleet-management/packages/api/src/repositories/shifts.ts` `TrailerRepository.listAvailable`.
**Code:** `trailersQuery`; the swap form now offers bobtail, an existing trailer, or a new plate + type.
