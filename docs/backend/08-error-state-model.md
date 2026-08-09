# Backend Design 08 — Error & State Model

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md` (AppError §2,
IdempotencyService §5), `02-auth.md`, `03-rest-api.md` §5/§6, `docs/architecture/00-locked-decisions.md`
(B7, B17, B18, C1.5, C3.3, C3.4, C3.6, M2, M4, N5, N6, N7), `db/schema/*`.

This document is the **consolidated, frozen catalogue** of client-visible `error_code`s and the
domain **state machines** (shift, accident, HOS, fuel anomaly, vehicle display). It is the single
reference the mobile and admin apps branch on. Every code here is emitted by an `AppError`
subclass or a `ConflictError`/`SemanticViolation` with that exact `error_code` (`01` §2).

---

## 1. Error catalogue (stable `error_code`s)

| HTTP | `error_code` | Meaning | Raised by |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | zod failure (see `field_errors`) | router (`03` §1) |
| 401 | `UNAUTHENTICATED` | missing/invalid access token or bad credentials | `02` §2 |
| 401 | `MFA_REQUIRED` | MFA code required | `02` §2/#3 |
| 403 | `FORBIDDEN` | missing permission | `requirePermission` (`02` §5) |
| 403 | `ACCOUNT_SUSPENDED` | suspended driver at sync (24 h ceiling) | `02` §4/B13 |
| 403 | `DEVICE_REVOKED` | revoked device | `02` §4/B12 |
| 403 | `CONSENT_REQUIRED` | missing GPS consent (C5.5) | `02` §7/`03` §5 |
| 404 | `NOT_FOUND` | resource missing | repository |
| 409 | `CLOCKOUT_PENDING` | open shift has pending close-out (B7) | `03` §5 |
| 409 | `SHIFT_ALREADY_OPEN` | driver already has OPEN shift | `03` §2.2 |
| 409 | `UNLOCK_REQUIRED` | edited verified shift without unlock (B18) | `03` §5 |
| 409 | `NO_ASSIGNMENT` | clock-in without assignment (C1.8) | `03` §5 |
| 409 | `DUPLICATE` | duplicate start/end gauge or key | `03` §5 |
| 409 | `SESSION_LIMIT` | session-cap eviction race (A1.6) | `02` §6 |
| 409 | `IDEMPOTENCY_INFLIGHT` | prior attempt still running (C5.1) | `01` §5 |
| 422 | `ODOMETER_DECREASED` | odometer decreased (C4.2) | `03` §5 |
| 422 | `ODOMETER_DIVERGENCE` | OBD vs driver reading advisory (M3) | `05` §3 |
| 422 | `HOS_REST_BLOCKED` | required rest not elapsed (C3.3) | `04` §7 |
| 422 | `MISSING_GAUGE_PAIR` | refuel missing before/after (B3) | `03` §5 |
| 422 | `DVIR_FAIL_NEEDS_PHOTO` | failing item without photo (C1.5) | `03` §5 |
| 422 | `DEFECTS_NOT_REVIEWED` | DVIR defects not acknowledged (C1.6) | `03` §5 |
| 422 | `IDEMPOTENCY_CONFLICT` | key reused, body differs (C5.1) | `01` §5 |
| 422 | `WORK_PLAN_REQUIRED` | clock-in missing plan evidence (C1.13) | `03` §2.2 |
| 422 | `ONBOARDING_PROFILE_EMPTY` | background check submitted with no profile captured | onboarding (`03` onboarding) |
| 422 | `ONBOARDING_CONSENT_REQUIRED` | background check submitted without the consent flag | onboarding (`03` onboarding) |
| 422 | `BACKGROUND_CHECK_ALREADY_CLEARED` | background check resubmitted after it cleared | onboarding (`03` onboarding) |
| 429 | `RATE_LIMITED` | too many attempts (login/PIN) | `02` §9/M4 |
| 429 | `OFFLINE_PIN_LOCKED` | offline PIN locked 15 min (M4) | `02` §4 |
| 503 | `SERVICE_UNAVAILABLE` | downstream degraded (Traccar/Vision/FCM) | handler boundary |

`error_code` is **frozen** — adding one is a contract change requiring a versioned `openapi.yaml`
bump.

---

## 2. Shift state machine

```
                 clockIn (valid)                 auto/force close (A1.7/N6)
  (none) ───────────────▶ OPEN ───────────────────────────────────────────▶ CLOSED
                              │                                                ▲
                  clockOut missing artefacts (B7)                              │ verify/forceClose
                              ▼                                                │
                       PENDING_CLOSEOUT ── supply evidence ───────────────────┘
                              │ (blocks next clock-in → CLOCKOUT_PENDING)
                              └── force-close (Admin, N6/C3.8) ──▶ CLOSED

  verification_status: PENDING ──verify──▶ VERIFIED (locked, B18)
                              └──flag──▶ FLAGGED
  VERIFIED may be UNLOCK_FOR_CORRECTION (audited, B18) → editable, then re-verify.
  overrun: at 14 h → is_overrun=true, alerts, requires human/admin closure (N6).
```

---

## 3. Accident state machine (C3.6 / B17 / N3.2)

```
  mayday (B17, no photos) ──▶ PENDING (is_mayday=true) ─┐
  create (evidence follows)─▶ PENDING ──────────────────┤
                                                         ▼
                                              INVESTIGATING (telemetry frozen+chained, C3.4)
                                                         │
                                            acknowledge (cancels escalation_timers, C6.3)
                                                         ▼
                                                  RESOLVED (insurance/ob_number/abstract)
                                                         ▼
                                                       CLOSED
```

`mayday` fires full escalation immediately and bypasses all photo slots (B17, R-001). Off-shift
SOS with no telemetry marks `telemetry_available=false` (N3.2/R-107). `accident_telemetry` is
append-only and SHA-256 hash-chained (C3.4).

---

## 4. HOS / duty state (N7 / N8 / C3.3)

- `driver_duty_segments` (append-only ledger, no overlap): `DRIVING | ON_DUTY | BREAK | OFF_DUTY`.
- `driver_hos_state` (rolling, driver-centric): exposes `next_eligible_clock_in_at`. If rest
  incomplete → clock-in returns `422 HOS_REST_BLOCKED` (hard block, C3.3).
- Inferred `BREAK` from ignition-off ≥ `min_break_seconds` (N8), confirmable/reclassifiable by the
  driver. Daily/weekly rest derived from `OFF_DUTY` between shifts.
- Vehicle swap closes/opens a shift but does **not** reset HOS (N7).

---

## 5. Fuel anomaly types (`05` §3)

`POSSIBLE_THEFT_OR_LEAK`, `CARD_MISMATCH` (M2), `EXPIRED_CARD` (accepted+flagged, C2.3),
`EFFICIENCY_DEVIATION`, `ODOMETER_ROLLBACK`, `ODOMETER_DIVERGENCE` (M3), `GAUGE_OBD_DIVERGENCE`,
`DUPLICATE_PURCHASE`, `PRICE_OUTLIER`, `MISSING_GAUGE_EVIDENCE`. CRITICAL ones emit a notification
outbox. Anomalies are scored asynchronously (`03` §4).

---

## 6. Vehicle display-state precedence (N5)

`QUARANTINED` (red) > `OFFLINE` (grey, no position > 15 min) > `HOS_ALERT` (orange) >
`SPEEDING` (yellow, > `speed.limit_kph`) > `MOVING` (green) > `IDLING` (blue) > `PARKED` (slate,
ignition off, online). Surfaced read-time via `v_vehicle_display_state` to `ws` (`07` §3) and
`GET /dashboard/vehicle-states` (`03` §2.7).

---

## 7. Invariants this document locks

1. `error_code` is the only client-branchable member; the catalogue above is frozen.
2. Shift `VERIFIED` is lockable (B18), never immutable; corrections are audited and preserved.
3. Mayday bypasses photo requirements but still freezes telemetry + escalates (B17).
4. HOS is a rolling driver-centric ledger; the per-shift block reads `driver_hos_state`.
5. Anomalies are async and advisory-or-flagging; they never block a valid fuel entry (except the
   gauge-pair/photo DB constraints, `03` §5).

`09-observability-ci.md` defines how these states/errors are observed and gated in CI.
