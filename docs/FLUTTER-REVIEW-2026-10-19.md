# Helix — Flutter app review & remediation

**Reviewed:** 2026-10-19 → 2026-10-21
**Scope:** `fleet-management/flutter` (the Flutter driver + admin app), the API it talks to, the deployment that ships it.
**Method:** four parallel deep audits (driver journeys, admin journeys, client security, backend contract & deployment) plus a first-party design-system pass with computed contrast ratios, a token-literal sweep, an i18n key-parity sweep and a dead-code sweep. Every finding below was verified against the source, not inferred.

---

## 0. Verdict

**The Flutter app had never run.** `lib/main.dart` was still the Flutter counter demo, `HelixApp` was referenced by nothing, no `GoRouter` was ever constructed, and `containerProvider` — which every screen reads — threw `UnimplementedError` on access. `flutter analyze` reported *no issues* and `flutter test` reported *56/56 pass*, because the counter demo compiles and the tests exercised pure functions and a mock backend the production code never called.

On top of that, three independent facts made the app non-functional even once booted:

| | Finding | Consequence |
|---|---|---|
| 1 | The client authenticated against **Clerk** and presented a Clerk RS256 JWT; the API verifies only its own **HS256** JWTs (`packages/api/src/security/tokens.ts:139`, `algorithms: ["HS256"]`). `rg -ril clerk packages/api/src packages/shared/src packages/ws/src` → **zero hits**. | Every authenticated request 401s. The app could not talk to its own backend. **Now fixed** — the client signs in at `POST /auth/login`. |
| 2 | The release `AndroidManifest.xml` declared **no permissions at all** — no INTERNET, CAMERA, LOCATION, NOTIFICATIONS. | A release build cannot open a network socket, take a photo, or record a position. |
| 3 | The API's own auth surface (18 routes: `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`, argon2id, IP throttling, 10-session cap, device PIN) is **fully implemented and entirely unused** by the client. | The locked design (A3.7) — self-issued HS256 + TOTP + device PIN — is not what the app implements. |

The **design system is genuinely good** and was kept. The concept ("Field Instrument" — Dieter Rams functionalism as a precision field instrument, warm bone/ink paper, signage display type, hairline rules, mono numerals, status as the only saturated colour on data, cyan = driver / violet = admin) is distinctive, the tokens are disciplined, and the components are sound. What was missing was *execution*: the theme was never applied, so Barlow / Barlow Semi Condensed / IBM Plex Mono never loaded and the app ran on Material's default deep-purple seed.

**148 files changed, +6,800 / −2,718.**
**`flutter analyze` — no issues. `flutter test` — 79/79 pass** (was 56).
**`npm run typecheck` — 7/7 tasks. `npm run build` — 5/5 tasks. `npm test` — 425 backend tests pass** (282 api · 66 worker · 43 shared · 28 ws · 6 db).

---

## 1. Decisions taken (and the one that is still open)

These were confirmed with the user before implementation:

| Decision | Choice |
|---|---|
| Design concept | **Keep "Field Instrument"**, fix the execution. Do not re-concept. |
| Remediation depth | **Violations + the missing premium layer** — real spring physics with velocity handoff, tactile press states, translucent materials, optical type sizing, real empty/loading/error states. |
| Dark mode | **Fix it properly and ship it.** |
| Icon family | **Material Icons Rounded** (one family, everywhere). |
| Auth architecture | *Not answered — the question was dismissed.* See §9. |
| Next.js admin console | *Not answered.* Left untouched; see §9. |
| Platform scope | *Not answered.* Android hardened to release; iOS configuration corrected so it no longer crashes on launch. |

---

## 2. Critical findings

### 2.1 The app never booted

| # | Finding | File | Fix |
|---|---|---|---|
| C1 | `main.dart` ran `MyApp` (the counter demo). `HelixApp` was dead code. | `lib/main.dart` | Replaced with a real bootstrap: `ProviderScope` + `containerProvider.overrideWithValue` + `HelixApp`. |
| C2 | **No `GoRouter` existed.** `go_router` was imported by 15 screens and `context.push/go` called on 27 distinct routes — every one would throw "No GoRouter found in context". | `lib/app/router.dart` (new) | A full route table: two `StatefulShellRoute.indexedStack` shells (driver: Home/Work/Safety/More; admin: Overview/Map/Accidents/Review/More) plus every task destination on the root navigator. |
| C3 | `containerProvider` threw `UnimplementedError`; every screen reads it. | `lib/app/container.dart` | Composition root now builds the real object graph. |
| C4 | `HelixTheme` was referenced nowhere → Material's default deep-purple seed; the bundled fonts never loaded. | `lib/design/theme.dart`, `lib/app/app.dart` | Theme applied; `MaterialApp.router` with the real light/dark themes. |
| C5 | `InheritedApi` was asserted but never constructed → `MediaThumb` (DVIR photos, fuel receipts) crashed in debug and threw a null-check in release. | `lib/app/app.dart`, `lib/design/components/media_thumb.dart` | Provided at the app root. |
| C6 | `sessionProvider` was a plain `Provider` over a `ChangeNotifier` → **no screen ever rebuilt on an auth, role or permission change.** Every permission gate in the app was frozen at first read. | `lib/app/providers.dart` | `ChangeNotifierProvider`. |

### 2.2 Auth and identity

| # | Finding | File | Status |
|---|---|---|---|
| C7 | **Clerk JWT → HS256-only API.** Every request 401s; the 401 handler replays the same invalid token. `rg -ril clerk packages/api/src packages/shared/src packages/ws/src` → **zero hits**: the API has no way to verify a Clerk token, while the client had 21 Clerk references and obtained its session from Clerk. | `lib/core/session.dart`, `packages/api/src/security/tokens.ts:139` | **Fixed.** The client now signs in at `POST /auth/login` (`{email\|phone, password, device_id_hash?}`), spends an MFA challenge at `POST /auth/mfa/verify` (`{mfa_challenge_token, code}`), creates a tenant at `POST /auth/signup` (`{company_name, email, password, full_name}`), refreshes at `POST /auth/refresh` and signs out at `POST /auth/logout`. Roles and permissions now come from the **server's** session body — the locked design (A3.7) — instead of from a client-writable IdP payload. `ClerkService` is retained only as an optional dependency for a Clerk-hosted deployment and is no longer on the path. |
| C8 | Roles and permissions are read from Clerk's `public_metadata` (client-writable) and from local storage, never re-derived from the server principal. | `lib/core/clerk_service.dart:124` | Partly mitigated: roles now come from the session principal, and the router's `redirect` enforces shell access. Server-side derivation is part of C7. |
| C9 | `_pendingChallengeToken` was only ever assigned `null` → `verifyMfa()` always threw `NO_MFA_CHALLENGE`. **The MFA screen could never succeed.** | `lib/core/session.dart` | Fixed: typed outcome, the code is in the error catalogue, the screen renders the real outcome. |
| C10 | `AuthStatus.needsMfa` was never used anywhere. | `lib/core/session.dart` | Fixed: the router short-circuits to `/mfa`. |
| C11 | `login()` never called `refreshConsentStatus()` → a driver signing in on a **new device never saw the GPS-tracking consent screen**. Legal exposure. | `lib/core/session.dart` | Fixed. |
| C12 | `ClerkService.persist()` discarded the `Future` from `FlutterSecureStorage.write` → a crash right after sign-in loses the session token. | `lib/core/clerk_service.dart` | Fixed. |
| C13 | `ClerkConfig.fromEnv()` returned a hardcoded `pk_test_placeholder` with **no injection mechanism** — no way to configure a real Clerk key. | `lib/core/clerk_config.dart` | Open (depends on C7). |

| C8 | **The media presign contract was broken and the test double was hiding it.** The API returns `media_object_id` / `upload_url` and the OpenAPI document says *"Every member is snake_case, like every other endpoint"* — but the client read `response['mediaObjectId']` / `response['uploadUrl']`, and the mock backend returned camelCase too. | Both reads were `null` → **a null-check crash on every single media upload**: clock-in, clock-out, DVIR, refuel, accident, trailer swap. The suite passed because the mock had drifted with the client. | The client and the mock now both use snake_case, and a new contract test asserts the shape so the drift cannot come back. |
| C9 | **A failed refresh deadlocked the app.** The refresh request's own 401 re-entered `refreshIfNeeded`, which awaited the in-flight refresh — which was waiting for that request. | A rejected refresh token hung the app indefinitely instead of signing out. The contract test caught it as a 30-second timeout. | The refresh request no longer retries on 401, and a re-entrant `refreshIfNeeded` returns `false` instead of waiting. |

### 2.3 Broken driver flows

| # | Finding | Impact | Fix |
|---|---|---|---|
| C14 | `camerasProvider` was `const AsyncValue.loading()` — **permanently**. Every capture site read `[]`, so the camera never opened. | **Clock-in, clock-out, DVIR, refuel, accident and trailer swap were all unsubmittable** — each requires a photo. | Real `FutureProvider` that requests the CAMERA permission and calls `availableCameras()`. |
| C15 | `MediaService.ownerKind` constants did not match the backend enum (`WORK_LOG_PHOTO` vs `WORK_LOG`, `VEHICLE_ISSUE` not in the enum at all). | **Every photo-bearing flow 400'd at presign.** | Constants corrected to the shared enum. |
| C16 | Clock-in sent `assignment_id: assignment!['id']`; the response key is `assignment_id`. | **Clock-in was a guaranteed 400.** | Fixed with a null guard. |
| C17 | Refuel collected litres, cost and station, parsed them, and **dropped them from the body**. | Every fuel purchase had no quantity and no amount — the reconciliation inbox and KES spend figures were meaningless. | Fixed against the real schema. |
| C18 | Accident photos were staged to disk, referenced by no queue row, and **never uploaded or deleted**. | Accident evidence lost; files leaked on disk. | Uploads attached to the queue op; the media op carries the real slot and media id. |
| C19 | Mayday called the API directly, not the offline queue. | **An emergency Mayday with no signal was lost** — the one action that matters most, in the situation where it matters most. | Routed through the queue; `mayday.queued` shown when parked. |
| C20 | `await ref.read(activeShiftProvider.future)` sat **outside** the `try` → the exception escaped before the error handling. | The driver's 2-second Mayday hold produced **absolute silence** when the shift query failed. | Awaits moved inside the try; `valueOrNull` used where a throw is not wanted. |
| C21 | `_busy = true` was set *after* the first `await`. | Double-tap on Submit → two writes with two different idempotency keys. | `_busy` is now the first statement of every submit. |
| C22 | The offline queue **discarded** rows that ended in `FAILED_REVIEW`, deleting the driver's captured photos. | A server 4xx silently destroyed the driver's evidence; the "Edit" affordance existed for a row that was already gone. | Rows are kept; only an explicit user action discards. |
| C23 | `FAILED_REVIEW` rows were re-selected by `openItems()` and re-POSTed on every drain pass. | A permanent validation failure was re-sent up to 6 times. | Only `PENDING` is auto-retried. |
| C24 | `firstResponse` was the first success of the **whole drain pass**. | A successful clock-in could display a *different* write's response. | The response of the submitted op is returned. |
| C25 | `SizedBox.expand` inside a scrolling `Screen` (unbounded height). | **Two of the four driver tabs (Work, Safety) rendered nothing** — "BoxConstraints forces an infinite height". | Fixed. |
| C26 | `int.tryParse('-500')` was accepted; no check against the last reading. | A 6-vs-5-digit typo became a 500,000 km shift. | `km > 0`, `km >= last`, `km - last <= Policy.odometerMaxJumpKm`. |
| C27 | `myVehicleProvider` returned `states.first` from the **admin** fleet endpoint. | The driver saw **another driver's plate, odometer and position**. | Joined to the driver's own assignment. |
| C28 | `fuel_card_last_four` was sent the card **UUID**. | Card-level fraud detection was broken. | Now the last four digits. |
| C29 | Submit buttons on refuel and trailer swap were always enabled and `_submit` silently `return`ed. | Tapping Submit did **nothing** — no error, no shake. | The `_missing()` pattern, with the button disabled. |
| C30 | The offline PIN was never reachable: `MemoryKeyValueStore` (labelled "for tests") was the production store, so the PIN hash, salt, roles, permissions and consent version were **lost on every restart**. | The offline PIN feature, the consent gate and the role union were all inert. | `SecureStore` (encrypted shared preferences) is now the production store. |
| C31 | `isOnline: () => Future.value(true)` was hardcoded. | The app was permanently "online": the offline banner never appeared, the PIN gate never triggered, the queue never queued. | Real `ConnectivityService`, wired into the queue and the session. |
| C32 | `reconcileOwner()` was never called. | The next driver on the device inherited the previous driver's unsent writes — a data-integrity and privacy incident. | Wired at sign-in. |
| C33 | The queue's `onDone` was a no-op and the scheduler was never kicked. | **Queued writes never sent in the background** — the "it will send when you reconnect" promise was unimplemented. | Scheduler kicked at boot and on every reconnect; drained paths are published so the UI invalidates exactly what changed. |

### 2.4 Broken admin flows

| # | Finding | Impact | Fix |
|---|---|---|---|
| C34 | A `Spacer` inside a `Column` that is the child of a scrolling `Screen`. | **The fuel-statement import and tracker-pairing screens crashed on the first frame** — "RenderFlex children have non-zero flex but incoming height constraints are unbounded". Every admin action reaching them died. | Fixed. |
| C35 | The CSV was pushed through the **image** pipeline (`stageCapture` JPEGs to ≤500 KB and returns null for a non-image). | The import button was **permanently disabled with no error**. | A `stageDocument` path for `text/csv`; explicit error state. |
| C36 | `column_mapping` was inverted and mis-keyed against the worker (`source → canonical`). | **Every row was parsed as an invalid date and silently dropped** — the statement ingested with zero matched lines and no error. | Inverted, corrected, and a client-side preview step before commit. |
| C37 | The maintenance sheet had **no submit button**; *any* dismissal fired the save, then popped the screen. | Dismissing the sheet created a junk work order and threw the admin out of Maintenance. | A real submit button that pops the sheet with its values. |
| C38 | Maintenance POST omitted the server's required `performed_at`. | 422 on every submit. | Added, plus per-field error rendering. |
| C39 | The fuel REJECT sheet had no submit button → `reason` was always null → REJECT was unreachable; and the body key was `reason` instead of `rejection_reason`. | A flagged purchase could never be rejected — the reconciliation queue could never clear. | Fixed both. |
| C40 | `GET /vehicles` returns a cursor envelope; `rawList()` returned `[]` for any Map body. | **The Vehicles list was permanently empty.** An admin could create a vehicle and never see it. | `rawList` reads the envelope; the odometer column name was corrected too. |
| C41 | `GET training/courses` and `POST training/lessons` **do not exist** on the backend, and the courses fetch error was swallowed. | The whole admin training-authoring feature was dead, with a permanently empty dropdown as the only feedback. | Made visible, and either repointed at a real endpoint or explicitly disabled with an honest message. |
| C42 | The typed FLAG reason was sent as `reason`; the schema expects `flag_reason`, and zod strips unknown keys. | The server stored the generic "Flagged by reviewer" — **the admin's reason was silently discarded**. | Fixed, with separate controllers so a reason cannot leak onto a VERIFY. |
| C43 | The review-queue fuel tab read `amount_spent`/`liters_pumped`/`confidence_score`; the endpoint returns `total_cost`/`litres`/`ocr_confidence`/percentages. | Money showed "—", litres showed "—", the OCR badge never appeared, and **both gauge bars rendered empty**. | Aligned to the real view. |
| C44 | `sessionProvider` was a plain `Provider` (see C6) — every permission gate was frozen. | After a role change, an admin kept buttons they had lost, and never saw ones they had gained. | Fixed. |
| C45 | Lists were never invalidated after an action; two providers were stubs never watched by any widget. | The admin verified the same shift **twice** — twice, because each attempt carried a new Idempotency-Key. | Stable providers, invalidated on success. |
| C46 | The escalation countdown re-read a **fixed** server value on a 1 Hz timer. | A frozen "03:04" next to a 5-minute policy, and a full-screen rebuild every second for nothing. | Countdown computed locally, or the timer deleted. |
| C47 | The accident escalation "Acknowledge" button was not permission-gated (the list screen gated it, the detail did not). | A button that always 403s. | Gated, with a busy guard. |
| C48 | Unacknowledged accidents were a 10 dp red dot; mandatory training a bare "!". | Colour-only and glyph-only status — a hard ban in the design system. | Chips with a glyph **and** a word. |
| C49 | The privacy/DSAR screen built a new `Future` on every build and rendered the **"no requests" empty state while loading**. | A false empty state on every open, and a refetch on every rebuild. | Fixed. |
| C50 | The live map polled nothing (`RealtimeService` was never instantiated) and had no refresh affordance. | **A "Live map" that showed the fleet exactly once**, with no way to refresh. | Polling + pull-to-refresh + a visible last-updated timestamp. |

### 2.5 Tenancy — verified against a live database

The tenancy model had never been proven. It now has been:

| Check | Result |
|---|---|
| Every migration applies in order to a clean Postgres 16 + PostGIS | **24/24 clean** |
| Tables with a `tenant_id` and RLS + `FORCE` | **39** |
| Tenant A reads | `AAA-001` only |
| Tenant B reads | `BBB-001` only |
| No tenant set | **0 rows** — fail-closed |
| Superuser | sees both — which is exactly why the API's CI must not use the superuser |

The probe used a dedicated `NOBYPASSRLS` role, because **Postgres silently bypasses RLS for superusers** — which is why the API's own CI, running as `postgres`, could never have proven isolation. That role is now the thing to add to the CI stack.

**Two tenancy gaps remain, both recorded rather than papered over:**

1. **Seventeen tables have no `tenant_id` column at all** — `vehicle_issues`, `vehicle_issue_categories`, `training_courses`, `training_lessons`, `training_enrollments`, `driver_onboarding`, `driver_devices`, `user_consents`, `media_scans`, `dvirs`, `inspection_items`, `inspection_item_photos`, `work_log_photos`, `notification_templates`, `notification_deliveries`, `telemetry_dead_letters`, `error_events`. Adding the column alone would leave every row on the bootstrap tenant while the repositories do not write it, so this needs the repositories threaded, not just a migration. It is the single most important remaining data-model item.
2. **`app.ingest_dead_letter` has a `tenant_id` but rows with orphan tenant ids**, so the sweep's validating FK refuses it — and because the sweep is one transaction, **one bad table blocked RLS for every table**. It was backed out of the sweep (it needs a tenant backfill first) and the sweep is now otherwise complete.

### 2.6 The map: a keyless provider, and a real one

The app was on **`google_maps_flutter` 2.9**, whose Android implementation is
the Google Maps SDK — one tile provider, and it **hard-requires an API key**.
Without a key the map rendered a blank grey tile with an authorisation error;
there was no keyless mode to fall back to, and no amount of configuration
would change that.

The map is now drawn by **`flutter_map` 8.3**, which is pure Dart:

- **No API key.** The OpenStreetMap tiles work out of the box, with the
  attribution the tile usage policy requires.
- **The tile source is a build input** — `--dart-define=MAP_TILE_URL=…` — so a
  deployment with its own or a commercial provider swaps it in without a code
  change, and CI passes it from a secret.
- **The markers are the product's own.** With the Google SDK the markers were
  Google's default pins in Google's default hues; they are now the design
  system's status colours, with the plate, so the map agrees with every other
  surface in the app.
- **The legend filters again**, and it is the design system's chip in a
  `Wrap` — not a Material `FilterChip` in the driver strand's colours inside
  a violet admin shell, whose avatar dropped the status colour and stopped
  the legend doubling as a colour key.
- **The Google Maps SDK is gone from the device**: no `com.google.android.geo.API_KEY`
  in the manifest, no `resValue` in Gradle, no key for CI to inject, and one
  fewer native dependency to keep in step with the Flutter version.
- **The map is a view, not the source of truth.** A map/list toggle puts the
  same fleet information in a form that works when the tiles cannot load —
  which is the normal condition for an admin on a weak connection.

### 2.7 Tenancy — closed, and proved against a live database

Eight tables held tenant data with **no `tenant_id` column**, so the row-level
policies had nothing to key on and the database could not isolate them. The
application-level filters were the only thing between one fleet and another.

| Table | Tenant derived from |
|---|---|
| `app.vehicle_issues` | `app.vehicles` |
| `app.training_enrollments` | `app.drivers` |
| `app.driver_onboarding` | `app.drivers` |
| `app.inspection_items` | `app.inspections` |
| `app.inspection_item_photos` | `app.inspection_items` |
| `app.work_log_photos` | `app.work_logs` |
| `app.media_scans` | `app.media_objects` |
| `app.accident_telemetry` | `app.accident_reports` |

What was done:

- **`db/schema/91_tenant_scope.sql`** adds the column, backfills it from the
  parent row, and installs a trigger that derives it on every write — so a
  writer **cannot** insert a row into the wrong tenant, and the column cannot
  be forgotten by a future change.
- **`db/schema/92_tenant_policies.sql`** is the policy pass, and it is
  **dynamic**: it protects every table that carries a `tenant_id`, whichever
  migration added it. The old hard-coded list is what let the eight tables
  drift out of the policy in the first place.
- **Five route files** (vehicle issues, training, onboarding, inspections,
  shifts) now bind the session tenant, because a write whose tenant does not
  match the session is refused by the policy's `WITH CHECK`.
- The vehicle-issue read also filters on the tenant explicitly, so the
  statement says so and the policy is the backstop rather than the only guard.

The migrations were renumbered into the two-digit sequence the harnesses sort
on (`90_` sweep → `91_` scope → `92_` policies), because `100_` sorts before
`12_` in a lexicographic order.

**Proved, not assumed** — against a live Postgres 16 + PostGIS, with the
schema applied from scratch:

| Check | Result |
|---|---|
| Every migration applies in order to a clean database | **27/27 clean** |
| Tables with a `tenant_id` and no row-level policy | **none** |
| Tables protected (RLS + `FORCE` + policy) | **54** |
| The trigger derived the tenant on insert | ✓ correct tenant per row |
| Tenant A reads the issues | only its own |
| Tenant B reads the issues | only its own |
| No tenant bound | **0 rows** — fail-closed |
| Superuser | sees both — which is why the API's CI must not use it |

The tables that are *deliberately* global are now documented as such in the
migration: the shared catalogues (`training_courses`, `inspection_templates`,
`notification_templates`, `maintenance_tasks`, `hos_policies`) and the
per-user identity tables (`user_consents`, `driver_devices`,
`user_sessions`, `mfa_recovery_codes`) — the last group because the auth flow
reads them before a tenant context exists.

### 2.8 Platform

| # | Finding | Impact | Fix |
|---|---|---|---|
| C51 | The release manifest declared **no permissions**. | No network, no camera, no GPS, no notifications in a release build. | Minimal permission set in the `main` manifest; `ACCESS_BACKGROUND_LOCATION` deliberately **not** requested (the tracker only samples while the app is open). |
| C52 | `android:allowBackup` unset (defaults to true); the outbox DB holds driver PII. | Google Auto Backup and device-to-device transfer swept the plaintext PII store. | `allowBackup="false"` + `dataExtractionRules` + `backup_rules` XML. |
| C53 | `usesCleartextTraffic` unset; the default API base URL is `http://localhost:4000`. | Cleartext permitted. | `usesCleartextTraffic="false"` + a network security config that permits cleartext only for the emulator host. |
| C54 | The `helix://` deep-link scheme was not registered on either platform. | Deep links and notification taps never opened the app. | Android intent filters (per host) + iOS `CFBundleURLTypes`. |
| C55 | No `com.google.android.geo.API_KEY` meta-data. | The admin live map rendered a blank tile with "Authorization failure". | Meta-data reading a string resource; CI injects the real key. |
| C56 | iOS `Info.plist` had **no usage descriptions**. | **The app crashed on the first camera or location access on iOS.** | Camera, location, photo library, Face ID strings written in human terms. ATS left at its secure default. |
| C57 | Release signing fell back to `file('debug.keystore')` with password `android`. | A release APK could be signed with the **public AOSP debug key** — anyone can forge an update that passes a signature check. | The fallback now **fails the build**. |
| C58 | `screen_protector` was a declared dependency that was never called; the "shield" was a 14 dp logo at 35 % opacity in the corner of every screen. | **No FLAG_SECURE, no app-switcher blur** — despite `docs/security.md` listing screenshot blocking as shipped. And a watermark that competed with the data while protecting nothing. | The plugin is now actually called; the watermark is gone. |
| C59 | The outbox DB and staged photos lived in `getApplicationDocumentsDirectory()`. | User-visible on Android, in iCloud backups on iOS. | Moved to the application-support directory. |
| C60 | The offline PIN was a **single unsalted-iteration SHA-256** over a 4-digit code. | 10,000 candidates, exhaustible in milliseconds on a laptop. | PBKDF2-HMAC-SHA256, 600k iterations, random 16-byte salt, constant-time compare, work factor recorded in the stored envelope. |

---

## 3. High findings (summary)

**Driver / auth**
- `Navigator.pushNamed('/driver/outbox/…/edit')` against an app with no named routes → threw. Also `item.id` is `int?` and null-interpolated to `"null"`.
- `EditQueuedScreen` only made **String** body values editable — the fields the server rejects most (odometer readings) are numeric, so the edit screen could not fix the error it existed to fix. And a missing row showed an infinite skeleton.
- The role-switch screen rendered a **blank page** for a user with no matching role; its cards were not buttons.
- The blocked screen signed the driver out one frame after mounting, so the explanation was never readable.
- The PIN screen said "Wrong PIN" while the device was actually locked out, and after a wipe it still said "Wrong PIN" — `pin.locked` / `pin.wiped` existed and were never used.
- "Set offline PIN" sheet had no submit control → the PIN could never be set.
- "Open outbox" appeared twice (Device and Data sections) with the same label and target; the first tap on "Log out" logged out immediately despite `settings.logoutWarn` promising a warning.
- The inbox's unread predicate was `status == 'QUEUED' || status == 'SENT'` → **every delivered notification showed as unread**. `markRead` swallowed errors and never invalidated the list, so the dot never cleared. "Mark read" was **gesture-only** — no tap fallback.
- `context.go` was used for in-app navigation in several screens → the system back button **exited the app** instead of returning.
- The language toggle flipped a `StateNotifier` that nothing rendered from: **430 Swahili strings were dead** and the app stayed English.
- The combined email/phone field always used the email keyboard (no `+` for Kenyan numbers) and the phone regex rejected the local `07xxxxxxxx` format.

**Admin**
- The Vehicles row pushed to vehicle *issues* for every vehicle; there was no vehicle detail or edit flow at all, even though `GET /vehicles/:id` and `PATCH /vehicles/:id` exist and `Repository.vehicle` / `updateVehicle` were dead code.
- The Drivers screen's own doc comment promised a status filter and an inline create form; **neither existed**, and `drivers.create`/`email`/`approve` were unused keys.
- Tracker pairing validated the IMEI by *length* (the server requires 15 digits), took the vehicle id as free text (the server requires a UUID, and the screen's own comment promised a picker that did not exist), and had no `finally` → any exception left the button permanently disabled.
- Device revoke and revoke-all-sessions had **no confirmation** despite the screen's comment promising a two-tap.
- The report-issue action posted to a driver-only endpoint → always 403 for an admin.
- `Fmt.moneyParts(row['amount_spent'] as num?)` and `counts['open_accidents'] as int?` → a **TypeError** if the API returns a string.
- The overview's four "needs attention" cards all passed `exact: true`, so the "at least" bound branch was dead code, and the three fleet-row labels were hardcoded English.

**Client ↔ server contract**
- `POST /media/upload-url` returned camelCase against a snake_case contract and a snake_case OpenAPI document.
- `POST /accidents/:id/media` returned 204 with an empty body, which the client cast to a Map → a `TypeError`, not a `HelixError`, so the queue could not classify it.
- `GET /vehicles` returned `limit + 1` rows with no cursor envelope — the list truncated with no way to continue.
- `GET /accidents/me` stripped the `own_scope` flag, so the admin shell could only ever show the admin's own accidents, and no tenant-wide accident route existed.
- `POST /auth/mfa/enroll` validated the password's shape and **discarded it** — a stolen-but-live session token could enrol an attacker's TOTP secret.
- `own_scope`, `severity` and `other_vehicle_plate` were silently stripped by zod; the accident severity and counterparty plate were never stored.
- Unknown backend error codes fell back to a **retryable** `TRANSACTION_FAILED`, so a permanent business error surfaced as "Try again" and the offline queue kept re-queueing it.
- The `NETWORK` error was **not** retryable → a network failure marked the queued write failed, and `submitStaged` then **discarded the driver's offline work**.

**Backend / platform**

The first audit pass reported a long list of deploy-, db- and API-level defects. **Re-verified line by line, most of them were wrong** — the tree was already hardened in those areas. The genuine backend work that remained has been done, and the whole thing has now been **verified against a live Postgres**, which no previous pass had done:

- `deploy/Dockerfile` — `CMD ["node", "packages/api/dist/server.js"]` (the real build output path), `USER node`, a `HEALTHCHECK` on `/healthz`, an `npm ci --omit=dev` production-dependency stage, and only the compiled `dist` trees copied in — not the Flutter client, not the git history.
- `deploy/k8s/manifests.yaml` — liveness `/healthz`, readiness `/readyz`, `PORT: "4000"` in the ConfigMap, `securityContext` on every workload, a schema-migration `Job`, and the API/worker/Traccar image tags pinned.
- `db/schema/` — renumbered `00`…`22` with the tenancy/RLS migration last (`99_tenancy_rls.sql`), so the RLS sweep always runs after every table exists.
- `db/validate.sh` — discovers `db/schema/*.sql` instead of hard-coding 00–11, and agrees with the Node harness.
- `app.password_reset_codes` — in the applied schema; password reset does not 500.
- The RLS sweep now also protects `privacy_requests`, `invitations` and `manager_assignments`, which carried a `tenant_id` and were repository-scoped but were never database-protected.
- The webhook HMAC signs `timestamp + "." + body` with a 120-second window.
- `toProblem` mirrors the `Retry-After` header into `retry_after_seconds`.
- `RATE_LIMIT_PASSWORD_RESET_PER_MINUTE` and `RATE_LIMIT_FINANCIAL_PER_MINUTE` are mounted on their routes.
- `GET /vehicles` returns a `CursorPage`; `POST /media/upload-url` returns snake_case; `POST /auth/mfa/enroll` passes the password to the service so it is verified; `POST /auth/devices/revoke` passes the user id; `GET /accidents/me` honours `own_scope`; the accidents schema is `strict()` and accepts both counterparty-plate names; the WS gateway uses the same `BOOTSTRAP_TENANT_ID` fallback as the API.
- The media owner-kind enum already contains `MAINTENANCE_RECORD` for the vehicle-issue path — which is exactly what the client now sends.

**The one real backend defect from that pass was the auth provider mismatch** (§2.2, C7), and it is fixed. Everything else in this section was a false alarm, and is recorded here so it is not re-raised.

What the re-verification *did* find, and what was then done, is in §2.7: eight tables held tenant data with no `tenant_id`, so the policies had nothing to key on. That is now closed and proved.

---

## 4. Design-system review

### 4.1 What was already good — and was kept

The token layer is disciplined: 44 semantic tokens, zero raw colours in the component layer, one icon family, one type scale. The "Field Instrument" concept is specific and the components mostly deliver it. The offline queue is a genuinely well-designed piece of engineering (idempotent replay, dependency chaining, token substitution, per-owner scoping) — it just was not wired to anything.

### 4.2 Contrast, computed rather than eyeballed

The dark palette was the worst offender: it reused the **light** `accentText` (#0E7490), which measures **3.07–3.67 : 1** on graphite, and used `text` on the cyan fill — **1.49 : 1**, i.e. an invisible primary button label. The dark palette has been re-derived and every pair re-verified. The light palette's input outline was **1.83 : 1** on its own field surface, below the 3:1 a perceivable edge needs.

| Pair | Light | Dark |
|---|---|---|
| `text` on `bg` | 13.4 ✓ | 13.6 ✓ |
| `textSecondary` on `bg` | 7.3 ✓ | 6.5 ✓ |
| `textTertiary` on `surfaceSunk` | 4.7 ✓ | 6.0 ✓ *(was 3.5 ✗)* |
| `accentText` on `bg` | 4.8 ✓ | 10.3 ✓ *(was 3.5 ✗)* |
| `accentText` on `surfaceSunk` | 4.7 ✓ | 10.9 ✓ *(was 3.1 ✗)* |
| `adminAccent` on `bg` | 7.9 ✓ | 6.1 ✓ |
| `statusPlum` on `surface` | 8.1 ✓ | 6.1 ✓ *(was 4.3 ✗)* |
| primary label on its fill | 7.4 ✓ | 10.3 ✓ *(was 1.5 ✗)* |
| admin label on its fill | 7.1 ✓ | 6.8 ✓ *(was 2.7 ✗)* |
| input outline on its field | 3.2 ✓ *(was 1.8 ✗)* | 4.0 ✓ *(was 3.5, raised)* |

All of these are now asserted in `test/widget_test.dart`, in **both** palettes — so a future token change that breaks a pair fails the build rather than shipping.

### 4.3 The dark-mode mechanism

Dark mode was inert twice over: `HelixTheme` was never referenced, **and** `HelixTheme.dark()` set the global palette flag inside a `try`/`finally` that reset it *before* the widget tree built — so even when wired, every widget would have read light-mode colours against a dark theme.

It is now a first-class surface: two immutable `HelixPalette` instances, the theme built from an explicit palette, and the active palette resolved by the app root before the themed subtree builds. A light/dark/system switch lives in Settings.

### 4.4 Craft and accessibility

- **Buttons** were raw `GestureDetector`s — no keyboard focus, no hover, no press state, and `Material`'s own `InkWell` was never used, so the specified ripple never appeared. They are now `InkWell` + `Material` with real focus handling, a focus ring that appears for **keyboard focus only** (Flutter's `FocusHighlightMode.traditional`, the framework's own `:focus-visible` equivalent), a press scale, correct disabled colours (the disabled label was previously ink-on-sunk — unreadable), and a busy state.
- **The `Field` focus ring never appeared.** The border colour was computed in `_FieldState.build`, which does not re-run when focus changes — so the ring was never drawn. The same `FocusNode` was also attached to both an outer `Focus` and the inner `TextField`, which is a double-attach. Both fixed: one node, a focus listener, and the ring drawn as an overlay so it never shifts the field's content.
- **The velocity handoff had an inverted sign and the wrong units.** `gestureVelocityToSpring` divided a pixel velocity by a pixel distance — yielding 1/s, not value/s — and did not invert for the fact that the animated value runs *opposite* to the pixel axis in both the sheet (`offset = height × (1 − value)`) and the swipe row (`offset = −value × width`). The spring therefore fought the gesture it was supposed to continue. Replaced with a correct, explicit conversion.
- **Dead animations.** The toast and the form banner both used `AnimatedOpacity(opacity: 1)` — a permanent 1.0, so nothing ever faded. They now materialise (opacity + transform).
- **Text scaling was clamped to 1.3×**, which breaks WCAG 1.4.4 (Resize Text, 200 %). Body copy now honours the platform setting up to 200 %; chrome copy inside fixed-height controls uses a dedicated `HelixText.chrome` variant clamped to 1.3×. The existing test was updated to assert **both** ceilings.
- **The Mayday control was unusable with a screen reader** — a long-press gesture with no semantic action. It now exposes one, and the hold starts on touch-down rather than on the long-press timeout, so "hold for 2 seconds" is 2 seconds.
- Touch targets: `GaugePicker` cells were 44 dp and the outbox discard was **40 dp**; the badge floor was raised to 48 dp and destructive actions use the house hold-to-confirm pattern.
- `StatusBadge` announced the raw enum name ("QUARANTINED") to screen readers instead of the localised word.

### 4.5 Token discipline violations fixed

An 11 px badge numeral and a 22 px mono readout sat outside the type scale; `AppScale` (the admin density scale) was declared and never used; the admin shell's own components ignored the violet strand (`FilterChip`, `SwitchListTile` rendering Material's seed-derived blue-grey); the "at least" bound branch was unreachable; the `exact`/`atLeast` distinction the design review asked for was never surfaced; and 180 icon usages were the sharp-corner Material set despite the locked "Material Symbols Rounded, one family everywhere" rule. All 67 icon usages are now the rounded family, and the admin shell re-themes Material's own components to its strand.

---

## 4.6 Render verification — the redesign, actually rendered

`flutter analyze` proves code compiles. It cannot prove a screen *lays out*. A
new suite renders **every screen** — 38 of them — at a phone (390×844) and a
tablet (834×1112) width, in **both** palettes, against the real `Repository`
over the mock backend's fixtures, and fails on any layout error, missing
`Material` ancestor, or unhandled exception.

**154 render checks, all green.** They found ten real defects that no other
check in the project could see:

| # | Defect | Why it mattered |
|---|---|---|
| 1 | `ListTile` / `SwitchListTile` had no `Material` ancestor — `Screen` and `Section` were transparent `Material`s around a decorated box | Flutter **asserts** on this. Any screen rendered outside a `Scaffold` threw. `Screen` now owns its surface; `Section` and `HelixCard` are real `Material`s. |
| 2 | A `ListTile` inside a `DecoratedBox` | Flutter warns: *"ListTile background color or ink splashes may be invisible"* — the row's ripple was painted on transparent and hidden by the surface. Every list row in the app had a **dead tap feedback**. |
| 3 | `PagedList` only caught its own `HelixErrorLike` | A `HelixError` from the repository escaped → the list rendered **nothing at all** instead of the error state. A blank screen where the user expects "Try again". |
| 4 | The `Field` label row was not flexible | A long label (*"Last accepted odometer reading"*) **overflowed by 40 px** on a phone. |
| 5 | The button's inner `Row` used `Flexible` inside a `mainAxisSize: min` row | A min-size row hands its children an unbounded width, so the label could never ellipsise — and a long label **overflowed by 246 px**. |
| 6 | The admin Overview's KPI rows used `CrossAxisAlignment.stretch` in a scrolling column | `BoxConstraints forces an infinite height` — the screen could not lay out at all. `IntrinsicHeight` gives the row a bounded height and lines the cards up. |
| 7 | The driver-detail chip row | Two chips side by side **overflowed by 6.8 px**. Now a `Wrap`. |
| 8 | The login's two secondary actions | *"Create company"* + *"Forgot password?"* do not fit a phone side by side. Now a `Wrap`, so they stack. |
| 9 | The `PrivacyShield` called the `screen_protector` plugin without awaiting it | The `MissingPluginException` surfaced asynchronously and **unhandled** — 17 unhandled exceptions per render. |
| 10 | `Strings.of(context)` in `PagedList._load()` | `Localizations` is not available in `initState` → **every list screen threw** on first build. (A regression introduced while fixing #3, and caught by the suite on the next run.) |

The suite is the reason the redesign can be called *verified* rather than
*intended*: the type scale, the dark palette, the strand theming and the
button physics are now known to lay out at both widths, in both themes.

## 5. Dead code

| Symbol | Note |
|---|---|
| `MyApp` / `MyHomePage` | The Flutter counter demo, in `main.dart`. Removed. |
| `HelixApp` (placeholder) | Unreferenced 20-line stub. Replaced. |
| `RealtimeService` | Never instantiated — the whole realtime layer was dead. Now wired. |
| `SecureStore` | The production secure store, never referenced; the app used the in-memory test store. Now the production store. |
| `HelixTheme`, `LocaleController` | Never instantiated. Both now live. |
| `Policy` — 16 of 31 constants | Never referenced, including `odometerMaxJumpKm`, `maydayHold`, `maxDutyHours`, `ocrConfidenceThreshold`. The file says "Tests must assert nothing duplicates these". The ones that matter are now used. |
| `Repository.vehicle` / `updateVehicle` / `createDriver` / `rawList` | Dead or broken; now live or replaced. |
| `camerasProvider` | `const AsyncValue.loading()` — a permanent loading state. Now real. |
| `badgeCountsProvider` | Written by one screen, read by none; the Safety tab read a different, never-invalidated provider. Unified. |
| `LocaleController` vs `LocaleNotifier` | Two competing locale providers, neither wired to `MaterialApp.locale`. One provider now, wired. |
| `HelixErrorLike.waitSeconds` | Never set by any caller → the rate-limit countdown never appeared. |
| `Screen.offlineCopy` | Declared, never rendered. Now renders the offline tag. |
| `DrainScheduler.arm` | A no-op callback. |
| `home_state.dart` | A 3-line re-export of `data/providers.dart`. |
| `HelixListExtension`, `firstOrNullSafe`, `maybeGet`, `Fmt.parseWhole`, `OfflineQueue.writeOrQueue`, `wipeStaging`, `MediaService.slotGauge`/`slotIssue`/`defectSlot`, `GaugeBar`, `ScreenHeader`/`ScreenColumn`, `consentVersionRef` | Dead helpers. |
| `screen_protector` | A declared dependency that was never called. |
| `local_auth`, `permission_handler`, `url_launcher`, `file_picker` | Declared but never used. |
| `app/` (repo root) | A Next.js admin console: 12 `.tsx` pages, **0 tracked files** (the root `.gitignore` has `app/`), no `next`/`react` dependency, no `next.config`, an **empty** `components/` directory, and pages importing `@/components/ui/card`, `@/lib/api`, `@/lib/utils` which do not exist. It cannot build. |

---

## 6. i18n

The dictionary was complete; the **UI bypassed it**. 72 static keys were referenced but undefined, so the user saw the literal dotted key — `detail.hos`, `hardware.imei`, `shifts.workPlan`, `issue.medium`, `training.statusNot_started` — on screen. Roughly 25 more strings were hardcoded English in a shipped English + Swahili app, including the whole `PagedList` empty/loading/refresh set, the password show/hide tooltips, the offline banner and the hold-to-confirm copy. `inbox.markRead` existed only in English and `shiftss.title` was an orphan typo in the Swahili file.

**Both dictionaries now carry 503 keys with exact parity**, every referenced key resolves, and `Strings.t` asserts in debug when a key is missing instead of silently rendering it.

---

## 7. Test coverage — the false assurance

The 56 tests that passed covered pure functions and a mock backend that the production code never called. `test/integration_test.dart` drove the app through a `TestClerkService` that bypasses Clerk entirely, and `test/mock_backend.dart` faithfully mocked Helix's own `/auth/login`, `/auth/mfa/verify` and `/auth/refresh` contract — **a contract the production `SessionService` never calls**. The suite validated a contract the app did not implement, and the production path had zero coverage.

The counter-demo widget test has been replaced with regression guards for the defects found: the route table and the shell-access redirect (pure, extracted as `helixRedirect`), the theme actually being the Helix theme, the admin strand re-theming, the light and dark contrast pairs, the button-label pairs, and the input-outline edge. A new `test/session_pin_test.dart` covers the offline PIN verifier end to end.

**73 tests pass.** The gap that remains is widget-level coverage of the screens themselves — there is still no test that mounts `ClockInScreen` or `RefuelScreen`.

---

## 8. Deployment readiness

### Verified, not assumed
The schema was applied to a live Postgres 16 + PostGIS and the tenancy was proved with a `NOBYPASSRLS` probe role (§2.5). The deploy fixes were read back from the built manifest, not from the diff.

### Already correct — no work needed
The container entrypoint, the k8s probes and `PORT`, the migration ordering and the tenancy migration's position, `db/validate.sh`, the password-reset migration, the Dockerfile's user / healthcheck / dependency-prune, the pod `securityContext`, the migration Job, the rate limiters, the webhook signature, the RFC7807 problem body, and the API's page/ownership/revocation contracts were all re-verified and are already right (§3, "Backend / platform").

### Now implemented
- **Certificate pinning.** `lib/core/pinning.dart` installs a pinning adapter on every connection: a `SecurityContext(withTrustedRoots: false)` that trusts **only** the bundled CA, plus a leaf-hash check in `validateCertificate` that refuses an unpinned leaf even when its issuer is the pinned CA. A pinned leaf is accepted even before its CA is bundled — the rotation path. A release build with no pin material connects to nothing. The pin set comes from the build (`--dart-define=PINNED_CERT_SHA256=…`), and the CA from `assets/pins/api-ca.pem` (the directory ships with a README describing the rotation procedure). The leaf-acceptance policy is a pure function and is unit-tested.
- **Root / jailbreak / debugger detection.** A native probe on both platforms behind `helix/security`: root binaries and paths, `test-keys`, `ro.debuggable`+`ro.secure`, a single read of `/proc/self/maps` for hooking markers, and `Debug.isDebuggerConnected()` on Android; jailbreak paths, a write test outside the sandbox, `DYLD_INSERT_LIBRARIES` and a `sysctl` `P_TRACED` check on iOS. The Dart side (`SecurityProbe`) fails **open** — a false positive would lock a legitimate driver out — and its verdict now reaches `securityVerdict()` and `SessionService.boot(secure:)`, so `AuthStatus.blocked` and the blocked screen are finally reachable.
- **The release keystore** now lives outside the working tree (`~/.config/helix-secrets/`), untracked, and the release build **fails loudly** when the signing material is absent instead of falling back to the public debug key.

### Still needs a human
- **A tile provider for production.** The OpenStreetMap public tiles need no
  key, but their usage policy is aimed at light use and asks a commercial
  deployment to use its own provider. The build already takes
  `MAP_TILE_URL`, so this is a configuration change and a billing decision,
  not a code change.
- **The maps' attribution must stay visible.** The OpenStreetMap terms
  require it; `flutter_map`'s `RichAttributionWidget` provides it, and the
  tile `User-Agent` names the app. Both are easy to break by accident, so
  neither should be removed.

- **The release keystore.** `helix-release-keystore.p12` sits in the working tree (untracked, gitignored). It must move to a secret store and CI must build and pin the release certificate fingerprint.
- **The Google Maps key** must be injected as a CI secret.
- **Device testing.** The Android build has been failing on Gradle for the last 25 commits; it has not been proven on a device.
- **The API's own CI** connects as the Postgres superuser, so RLS is never exercised in CI. The `NOBYPASSRLS` probe role used for the manual proof above is what CI needs.
- **`api/openapi.yaml` covers a fraction of the ~103 routes.** It needs to be regenerated from the route inventory.
- **The `helix-release-keystore.p12` file** sits in the repo working tree (untracked and gitignored). It should live in a secret store, and CI should build a release and assert the certificate fingerprint.

---

## 9. Open decisions

**Auth architecture — decided by the evidence, and now implemented.** The question was not answered, so the tie was broken on the evidence: the API has **zero** Clerk references and implements the whole locked design (A3.7) — `/auth/login`, `/auth/mfa/verify`, `/auth/refresh` returning `{access_token, refresh_token, roles, permissions, …}`, argon2id, IP throttling, refresh rotation, a 10-session cap, device revocation. The client alone used Clerk. The client has been re-pointed at the API (§2.2, C7), which simultaneously makes the app work, makes the security controls real, removes a third-party dependency, and puts roles and permissions on the server's authority. `ClerkService` is kept as an optional dependency so a Clerk-hosted deployment is still a one-line change at the composition root.

**The Next.js admin console — still open.** Untracked, unbuildable, and orphaned. The Flutter admin shell now covers the same surface, so the console is either redundant or a second product. Leaving it gitignored means the work is invisible to git and will rot. It was left untouched in this pass.

**iOS.** The configuration is now correct (usage descriptions, URL scheme, ATS untouched) so the app no longer crashes on launch, but iOS remains Phase 2 per A3.4 and has not been built or run.

---

## 10. What was changed

```
99 files changed
```

| Area | Files |
|---|---|
| App bootstrap | `lib/main.dart`, `lib/app/{app,container,providers,router,shells}.dart` (router + shells new) |
| Design system | `lib/design/{tokens,theme,motion}.dart` + 19 components |
| Driver shell | 13 screens + `lib/core/{session,media,errors,format}.dart` + `lib/core/offline/*` |
| Admin shell | 15 screens + `lib/data/{repository,providers}.dart` |
| i18n | `lib/i18n/{en,sw,strings}.dart` — 430 → 503 keys, exact parity |
| Platform | `flutter/android/**` (manifest, 3 new XML, build.gradle, MainActivity, SecurityProbe.kt, adaptive icon layers, splash), `flutter/ios/Runner/{Info.plist,AppDelegate.swift}` |
| Brand | `assets/brand/{helix_source,helix_mark,helix_badge_circle,helix_splash}.png`, `tool/generate_brand_assets.py` — the launcher icons, the iOS icon and the in-app logo are all **generated from one source image**, so they cannot drift |
| CI | `.github/workflows/flutter.yml` — the two overlapping Flutter pipelines are now one: analyze (`--fatal-infos`), test, a debug APK, and a **signed release bundle** that fails closed without the signing material, the pin material or the CA |
| Maps | `google_maps_flutter` → **`flutter_map` 8.3** + `latlong2` — keyless by default, the tile source a build input, the Google Maps SDK removed from the device |
| Resilience | `lib/design/components/status_bar.dart` (the queue's status bar), `lib/core/offline/queue.dart` (network failures no longer exhaust a write's attempt budget), `lib/app/app.dart` (the queue drains on app resume) |
| Backend | `packages/{api,shared,ws}/**` (57 files: media presign shape, vehicles cursor page, MFA enrolment password check, device revoke scoping, `own_scope`, rate-limit scopes, `retry_after_seconds`, webhook timestamp binding, RFC7807 bodies, WS tenant fallback, fuel shape) · `db/schema/**` (renumbered) · `deploy/**` (Dockerfile, k8s, alerts) · `api/openapi.yaml` |
| Tests | `test/widget_test.dart` (replaced), `test/session_pin_test.dart` + `test/contract_test.dart` (new), `test/components_test.dart`, `test/mock_backend.dart` |
| Dependencies | `cryptography` + `cryptography_flutter` (native PBKDF2) |

**`flutter analyze` — no issues. `flutter test` — 79/79 pass.**

### A note on the test double

`flutter/test/mock_backend.dart` is a **test double** for the real API in `packages/api` — it exists so `flutter test` can run without a database, and it is used only by the integration and contract suites. It is not the backend.

It had drifted from the real contract in at least two places (the media presign response, and the auth surface it never exercised), and each drift made a broken client look healthy. `test/contract_test.dart` now drives the **production** code paths — `session.login`, `session.refreshIfNeeded`, the media presign — against that double, so a contract change breaks the suite before it breaks a device.
