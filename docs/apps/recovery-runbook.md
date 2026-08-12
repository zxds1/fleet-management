# Recovery Runbook — App Error Codes & SLAs

Scope: the driver/admin Expo app (`packages/mobile`). This runbook maps every major `error_code`
(catalogue in `packages/mobile/src/core/errorCodes.ts`, the frozen `08 §1` contract) to its
user-facing consequence, the **offline-queue disposition** (D-7), and a **maximum recovery time
(SLA)**. It also defines the graceful-degradation tiers the app must hold under failure.

> New in this revision: per-flow / per-step **timeout** codes
> (`FLOW_STEP_TIMEOUT`, `CLOCKIN_STEP_TIMEOUT`, `REFUEL_OCR_TIMEOUT`, `INSPECTION_SUBMIT_TIMEOUT`)
> so a timeout is no longer collapsed into a generic `SERVICE_UNAVAILABLE` and can be traced to the
> exact failing step. All timeouts are transient → `retry`.

## Graceful-degradation tiers

The app degrades in layers rather than failing hard. From best to worst:

| Tier | Condition | User experience | Data safety |
|------|-----------|-----------------|-------------|
| **T0 — Online** | backend healthy, network good | all actions immediate | n/a |
| **T1 — Degraded** | backend slow / 5xx / throttle | actions show a spinner then succeed or auto-retry; no data lost | writes go through |
| **T2 — Offline-queued** | no network / request timeout (`FLOW_STEP_TIMEOUT` family) | action is **parked** in the Outbox ("Will send when online"); user keeps working | writes **never lost**; replayed on reconnect |
| **T3 — Failed review** | hard domain error (`failed_review`) | write held in Outbox, user edits/retries/discards | user-resolvable, not lost |
| **T4 — Reauth** | session dead (`reauth`) | forced re-login; in-flight writes preserved in queue | preserved, replayed post-login |
| **T5 — Fatal** | device/session revoked, account suspended | hard stop, contact admin | n/a |

The contract: **T0→T2 must never lose a user write.** T3/T4 keep the write in the Outbox. T5 is the
only tier that legitimately blocks the user.

## Error-code → consequence + SLA

Recovery time = time from the failure condition clearing to the queued write being replayed and the
Outbox clearing, assuming the user stays in the app. "Auto" = handled by the drainer without user
action; "User" = requires a user action (edit/discard/relogin).

### Transport / availability

| `error_code` | User-facing consequence | Disposition | Recovery SLA | Owner of recovery |
|--------------|-------------------------|-------------|--------------|-------------------|
| `SERVICE_UNAVAILABLE` (503) | "Service is busy, retrying" — write parked | `retry` | ≤ 30 s after backend recovers (auto-drain) | drainer |
| `FLOW_STEP_TIMEOUT` | A multi-step flow step timed out; write parked with step label | `retry` | ≤ 30 s after network recovers (auto-drain) | drainer |
| `CLOCKIN_STEP_TIMEOUT` | Clock-in step timed out; clock-in parked in Outbox | `retry` | ≤ 30 s (auto-drain) | drainer |
| `REFUEL_OCR_TIMEOUT` | Fuel OCR scan step timed out; receipt/refuel parked | `retry` | ≤ 30 s (auto-drain) | drainer |
| `INSPECTION_SUBMIT_TIMEOUT` | DVIR/inspection submit timed out; inspection parked | `retry` | ≤ 30 s (auto-drain) | drainer |
| `NETWORK_UNAVAILABLE` | "You're offline" — actions queued | `retry` | ≤ 30 s after reconnect (auto-drain) | drainer |
| `RATE_LIMITED` (429) | "Slow down, retrying" | `retry` | next backoff window (auto) | drainer |
| `OFFLINE_PIN_LOCKED` | Offline PIN attempts exhausted; queued writes wait | `retry` | after PIN reset / reauth (user) | user |
| `RESPONSE_INVALID` | Server returned an unparseable payload; write parked for review | `failed_review` | user re-submits (user) | user |

### Auth / session

| `error_code` | User-facing consequence | Disposition | Recovery SLA | Owner |
|--------------|-------------------------|-------------|--------------|-------|
| `UNAUTHENTICATED` (401) | Forced re-login | `reauth` | immediate on relogin (user) | user |
| `MFA_REQUIRED` | MFA prompt | `reauth` | user completes MFA (user) | user |
| `SESSION_LIMIT` | Re-login (too many sessions) | `reauth` | user re-logs in (user) | user |
| `ACCOUNT_SUSPENDED` | Hard stop, contact admin | `reauth` (fatal) | admin action (user) | admin |
| `DEVICE_REVOKED` | Hard stop, contact admin | `reauth` (fatal) | admin action (user) | admin |
| `DEVICE_UNKNOWN` | Register this device | `reauth` | user registers device (user) | user |
| `CONSENT_REQUIRED` | Accept consent to continue | `failed_review` | user accepts (user) | user |

### Domain / validation (hard stops, surfaced for user action)

| `error_code` | User-facing consequence | Disposition | Recovery SLA | Owner |
|--------------|-------------------------|-------------|--------------|-------|
| `VALIDATION_ERROR` | Field-level "fix this and retry" | `failed_review` | user edits (user) | user |
| `ODOMETER_DECREASED` / `ODOMETER_DIVERGENCE` | Odometer conflict; edit required | `failed_review` | user edits (user) | user |
| `HOS_REST_BLOCKED` | Rest required before continuing | `failed_review` | after rest (user) | user |
| `MISSING_GAUGE_PAIR` | Provide both gauges | `failed_review` | user edits (user) | user |
| `DVIR_FAIL_NEEDS_PHOTO` | Add a defect photo | `failed_review` | user adds photo (user) | user |
| `DEFECTS_NOT_REVIEWED` | Review defects first | `failed_review` | user reviews (user) | user |
| `WORK_PLAN_REQUIRED` | Attach a work plan | `failed_review` | user edits (user) | user |
| `FORBIDDEN` (403) | Not permitted; contact admin | `failed_review` | admin (user) | admin |
| `NO_ASSIGNMENT` | No assignment; contact dispatch | `failed_review` | dispatch (user) | user |
| `NOT_FOUND` (404) | Resource gone; informational | `failed_review` | n/a (informational) | — |

### Idempotency / duplicates

| `error_code` | User-facing consequence | Disposition | Recovery | Owner |
|--------------|-------------------------|-------------|----------|-------|
| `DUPLICATE` | Silently dropped (already recorded) | `discard` | automatic, no user action | drainer |
| `IDEMPOTENCY_CONFLICT` | Dropped — different body under same key | `discard` | automatic | drainer |
| `IDEMPOTENCY_INFLIGHT` | Back off, retry shortly | `retry` | automatic (short backoff) | drainer |
| `CLOCKOUT_PENDING` / `SHIFT_ALREADY_OPEN` | Edit / informational | `failed_review` / none | user (user) | user |

### Media / unknown

| `error_code` | User-facing consequence | Disposition | Recovery | Owner |
|--------------|-------------------------|-------------|----------|-------|
| `MEDIA_UPLOAD_FAILED` | Photo upload failed; retry | `failed_review` | auto/user retry | user |
| `UNKNOWN` | Generic retry | `failed_review` | auto/user retry | user |

## Observability wires (what actually exists)

> Audit correction: an earlier revision of this section claimed `reportError`, `outbox.lag_ms`,
> `metrics.flush` and `setActiveRequestId`/`withRequestId` telemetry wires. **None of those exist in
> the mobile codebase.** This section now describes only the observability that is actually wired.

- **Structured logger** (`packages/mobile/src/core/logger.ts`): the app's only logging layer. Emits
  JSON lines via `console` at `debug|info|warn|error`, stamped with `service_name:"mobile"` plus
  correlated `session_id` / `request_id` / `error_code` / `flow_step` via `logger.child(...)`. All
  logged context is passed through a `redact()` helper that strips keys matching
  `pin|password|secret|token|apikey|authorization|cookie|email|phone|ssn` so secrets never reach
  logs.
- **`requestId` correlation**: `setSentryRequestId(id)` (`core/sentry.ts`) mirrors the upstream
  API `x-request-id` onto the Sentry scope (`request_id` tag) on every response
  (`core/apiClient.ts`), so a crash trace lines up with the originating API call. It is a no-op until
  Sentry is initialised.
- **Sentry crash reporting** (`core/sentry.ts`): `captureException(err, { code, route, message })`
  reports a caught error tagged by `error_code` (the grouping key). `tracesSampleRate: 0.2` enables
  RUM sampling. `captureException` is de-duplicated per `(code|route)` in `ErrorBoundary` and
  `ErrorScreen` via a `reportedRef`, so a given error is not double-fired across renders.
- **`initSentry()` at boot** (`App.tsx`): called on mount, **except in demo mode**
  (`EXPO_PUBLIC_DEMO_MODE`). It is also a **no-op when no `SENTRY_DSN` is configured**
  (`initSentry` returns early without a DSN), so test/demo builds never crash and emit no events.

## Verification

- Unit/chaos: `src/core/__tests__/chaos.db-down.test.ts` (backend 503 → park → recover),
  `src/core/__tests__/chaos.network-throttle.test.ts` (2G throttle → timeout → park → recover, with
  recovery-time assertions).
- E2E: `src/maestro/chaos-network-throttle.yaml` documents the throttle → graceful degradation →
  recovery contract (network conditioned out-of-band).
