# Helix design & engineering review

What the review found in the first build, and what changed. Each fix is enforced by a test where it can be (see `test/guards.test.ts`).

## Contract pass: the app was written against guesses, and was rewritten against the backend

The first build was written without access to the backend, so the request and response shapes, the
endpoint paths, the error codes, the permission names, the realtime channels and every local threshold
were invented. This pass replaced all of it with what `fleet-management/packages/**` actually does, and
`docs/ASSUMPTIONS.md` records every entry with the evidence that closed it.

The change that mattered most was **choosing the right source of truth**: `api/openapi.yaml` is a partial
locked copy of the API brief, and it is wrong in places (`POST /consent` is served at `/auth/consent`;
there is no device registration, onboarding or photo-first fuel in it at all). `test/contract.test.ts`
therefore *rebuilds the route table from the routers and the mount points in `app.ts`* and checks the app
against that, cross-checking openapi only where it does document a path.

Headline corrections:

| Was guessed | Actually true |
|---|---|
| An unregistered phone gets `DEVICE_UNKNOWN` | No such error code exists. `POST /auth/devices` runs after login with the bearer token (C-01) |
| `POST /auth/mfa/recover` for a locked-out user | Recovery codes go through `POST /auth/mfa/verify` in the same field as the OTP, and the response *is* a full session (C-02) |
| An admin provisions MFA for a driver | `POST /auth/mfa/enroll` takes only a password and enrols the caller. No admin route exists (C-03) |
| TOTP: `provisioning_uri` + a QR screen | MFA is a **delivered** OTP (SMS/email). `enroll` returns recovery codes and nothing else (E-19) |
| The client subscribes to `driver:accident:{userId}` | The gateway derives rooms from the Principal and pushes six events; the client never subscribes. Driver rooms are keyed by **driver** id (C-04) |
| A 409 means "retry the idempotency" | Only `IDEMPOTENCY_INFLIGHT` retries. `CLOCKOUT_PENDING`, `SHIFT_ALREADY_OPEN` and `UNLOCK_REQUIRED` are also 409 and need a person (S-05) |
| `GET /media/{id}` returns `{ url }` | It returns a **302** to a short-lived presigned GET (E-06) |
| Anomaly `description`, `asset_name`, `days_until_expiry`, notification `data_json`/`read_at` | `kind`/`title`/`body`, `linked_asset`, `days_remaining`, `payload`, and read state is `status` (E-04) |
| The DVIR can render its checklist | `GET /inspections/templates` returns no items and nothing else exposes them. The form refuses rather than inventing one (**E-09 — open**) |
| A driver picks an assignment for clock-in | `GET /drivers/me/assignment` returns their one current assignment, or 404 (E-10) |
| The DVIR could not render a single line | The route returned `{ template_id, name, label }` and the items table was never selected from. `listActive()` now returns every item with both languages, severity, `input_type` and bounds (D-07, E-09) |
| No last odometer to check against | `GET /vehicles/{id}` returns `current_odometer_km`, the last ACCEPTED reading (E-13, U-04) |
| A push could open anything | The only payload any producer writes is `{ shift_id }`; everything else is `{}` (S-04) |
| Exact badge counts were impossible | `GET /reports/analytics` returns real counts for accidents, pending DVIRs, flags and documents; the rest are labelled "at least" (S-08) |
| Gauge-pair refuel | `POST /fuel/refuel` asks for gauge-record ids **nothing creates** and requires a permission that is not in `app.permissions`, so it 403s for everyone. The driver flow is photo-first (**U-12 — open, needs your decision**) |

### Firebase removed: notifications now come from the gateway the app already holds open

`app.config.ts` has no `google-services.json`, there is no FCM token anywhere, and there is no Firebase
project. The realtime gateway already publishes every notification to `notifications:{userId}`
(`packages/ws/src/gateway.ts`), so the app turns each `notifications` event into a **local** notification via
`expo-notifications`, which uses Android's own NotificationManager and needs no push service.
`test/guards.test.ts` fails the build if `googleServicesFile`, `GOOGLE_SERVICES_JSON`, `getDevicePushTokenAsync`
or `fcm_token` reappear.

The cost, stated rather than implied: delivery works while the app process is alive and the socket is
connected. If Android has killed the process there is **no** background notification — reliable background
push on Android without FCM or an OEM channel is not achievable. Nothing is lost: the gateway re-sends the
unread snapshot on every connect, so it is late rather than missing. Re-adding FCM later is one config key
and one token sent to `POST /auth/devices`, whose `push_token` field already exists server-side.

### Four endpoints added to unblock four ledger entries

| Endpoint | Unblocks | Why it did not exist |
|---|---|---|
| `GET /trailer` | U-03, the existing-trailer picker | The router was mounted but only had `POST /trailer/swap` |
| `GET /fuel/cards` | U-05, the card picker | `POST /fuel/cards` was the only card route, and it is ADMIN work |
| `GET /notifications/count` | S-08, the exact inbox badge | The cursor page fetched `limit + 1` so `has_more` needed no COUNT |
| `POST /telemetry/points` | U-01, phone-GPS ingest | The only ingest was the public Traccar webhook, which attributes by device, never to a phone |

The phone ingest is the one worth reviewing: it is authenticated, the vehicle comes from the **caller's own
OPEN shift** and never from the body, and the batch is bounded in size, age and sampling rate.

### Three backend defects found while closing the ledger

The app could not work because of these, not because of a client guess. All three are fixed, and
`test/contract.test.ts` reads the backend source so they cannot come back.

| Defect | Effect on the app | Fix |
|---|---|---|
| **16 permission codes existed in the TypeScript union but had no row in `app.permissions`** (D-05) | `app.role_permissions.permission_code` has an FK to it, so those codes were ungrantable: the whole accidents API (Mayday included), the inbox, driver onboarding and anomaly detail were a 403 for every role, ADMIN included | Added the 16 rows; granted DRIVER `inspection:read`, `accident:read`, `notification:read`, `onboarding:read`, `onboarding:submit` — all already own-scoped server-side, so a driver still reads only their own records |
| **Two `requirePermission` codes were UPPERCASE** (D-06) | `asPerm("MANAGE_OWN_MFA")` can never match a lowercase grant, so two-step login could not be switched on by anyone and self-service device revoke was dead | Lower-cased both. Grants nothing new — the permissions were already seeded |
| **`GET /inspections/templates` selected no items** (D-07) | The DVIR screen was unusable; the form could only refuse to submit | `listActive()` now loads the items in one extra query. Additive; the seed already had them |

## Final pass: two defects found while auditing assumptions
| Problem | Fix |
|---|---|
| Every write called `crypto.randomUUID()`, which does not exist in React Native's Hermes engine, so the first clock-in, refuel or Mayday would have crashed | One id generator (`core/uuid.ts`) wired to the platform's secure random source; throws instead of using `Math.random`; a test forbids the global call |
| Clock-in and clock-out sent a fuel gauge of `HALF` for everyone | A required gauge picker (Empty, quarter, half, three quarters, Full); a test forbids a default |

Also added: every API path now lives in `src/api/endpoints.ts` (tagged contract / implied / assumed), `docs/ASSUMPTIONS.md` has 97 numbered entries checked against the code by `test/assumptions.test.ts`, app icon, adaptive icon and splash, an EAS development-client profile, `.env.example`, `.gitignore`, a SQLite version marker.

## Bugs and security gaps fixed
| Problem | Fix |
|---|---|
| Unsent writes and staged photos survived a logout; a different person signing in would have replayed them under their own token | Queue is tagged to its owner. A different user signing in destroys the old queue and staged files. Suspension wipes them too. |
| Declining consent mid-session **continued** the session | Decline now signs out |
| Socket snapshots wrote a different data shape into the query cache (crash risk, silent drift) | Snapshots only trigger a refetch. A test forbids `setQueryData` in realtime code |
| Map events (every second) refetched on every event | Throttled to one refetch per key per 2 s, with a trailing refetch |
| Stuck writes (5xx, weak signal) only retried on the next network event | `DrainScheduler`: exponential backoff + jitter, kicked on start, foreground, reconnect and after each submit |
| Photos were full camera originals (several MB) against the 500 KB rule | Resized to 1080 px and re-encoded until under 500 KB before queueing |
| Moving the phone clock back extended the 24 h offline window | A clock earlier than the last login counts as expired |
| PIN hash was unsalted SHA-256 of a 4-digit PIN | Per-install random salt (a 4-digit PIN is still weak by nature; the lockout and secure store are the real protection) |
| No anti-tamper beyond root | Release builds also refuse hooking frameworks and attached debuggers |
| Credential/QR/recovery screens could be screenshotted; recents showed app content; recovery codes were copyable | Screenshots blocked on those screens, privacy shield in the app switcher, codes not selectable, lock-screen notifications hide content |
| "Duplicate discarded" toast from the brief was never shown | Quiet toast, announced to screen readers |
| Same form could be submitted twice (tab forms kept old values) | `FormShell` empties the form after success and shows a confirmation |

## Flows and UX
* **Mayday** was 3 taps deep and easy to hit by accident. Now a hold-to-send button (2 s, with progress) on Home and at the top of Accidents. One sender, works offline, no photos.
* **Admins are alerted** to a Mayday on any screen (banner, vibration, screen-reader announcement). Drivers see help-status updates. Event payloads are validated before display.
* **Admin tablet** now has a persistent left rail with 7 sections; each section keeps its own stack so the rail never disappears. Driver phone tabs have icons.
* **Combined:** Notifications + Flags + Documents -> one **Inbox**. Shifts + Inspections + Fuel -> one **Review** queue. Profile/More -> grouped **Settings** (Account, Security, Device, Data). Seven hand-rolled list/page containers -> `PagedList` and `Screen`.
* **Dual-role users can switch role** in Settings (previously only by logging out).
* **Removed:** typing a raw UUID for the assignment (dev builds only), the Mayday toggle mode, 24 dead translation keys, per-file `Page` helpers, a separate security store.
* Disabled buttons now say **what is missing**. Leaving a half-filled form asks first. Decimal commas ("45,5") are accepted. Money is always a two-place string.
* **Error actions are specific** per the contract: CLOCKOUT_PENDING opens clock-out, SHIFT_ALREADY_OPEN opens the shift, NO_ASSIGNMENT refreshes assignments, HOS_REST_BLOCKED shows the rest end time and disables clock-in, GAUGE_DELTA_HIGH / FUEL_PRICE_SPIKE are shown as information ("saved, flagged for review") instead of errors.
* **Permissions:** admin actions are hidden when the token lists permissions and the person lacks them. When the token is silent they stay visible and the server's 403 is handled.

## Accessibility
* All text/background pairs pass WCAG AA (test computes contrast); two status/error colours were darkened to pass.
* Status is never colour alone (word + glyph). Chips and targets are at least 44 px, primary actions 56 px.
* Skeletons respect "reduce motion"; results and errors are announced; tab lists/selected states are exposed; large text is capped at 1.3x.

## Shared package
`packages/shared` (`@fleet/shared`) now owns every Zod schema, enum, `AppError`, `Result`, time/EAT helpers, `ConfigClient`, realtime channel names, permissions and a secret-redacting logger. The mobile app has no schemas of its own. **It is built from the brief's contracts, because the real shared package and `openapi.yaml` were not in the files received.** Replace the contents (keep the export names) when you have the real ones; contract tests will show any drift.

## Still open (needs your repo/backend)
Real `@fleet/shared` and `openapi.yaml`; Postgres/Redis integration tests; the gateway merge (see `docs/ws-gateway.md`, whose reference differs from the channel naming in the pseudocode you sent: the brief scopes `driver:shift:{shiftId}`, the pseudocode uses the user id); on-device runs of SQLite, MMKV, pinning, push and root detection; Play Integrity (needs a backend verifier).
