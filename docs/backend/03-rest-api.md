# Backend Design 03 — REST API Design

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md`, `02-auth.md`,
`api/openapi.yaml`, `db/schema/*`.

This document specifies the HTTP layer: route→handler→service→repository mapping for every domain,
validation rules, the error matrix, cursor pagination, the driver offline-queue protocol, and the
media flow. It is the implementation contract for `@fleet/api`. All request/response shapes are
defined in `api/openapi.yaml`; here they are referenced, not redefined.

---

## 1. HTTP layer contract (from `00` §4)

For every request:
1. Router matches the path; the **zod** schema for that operation validates the body/query
   (`01` §11). Failure → `400 VALIDATION_ERROR` with `field_errors`.
2. `authenticate` middleware validates the access token and loads the session → attaches
   `Principal` (`02` §1).
3. `requirePermission(code)` guard runs (where the operation needs one).
4. Handler reads `Idempotency-Key` (all state-changing ops, `01` §5) and calls
   `IdempotencyService.start`. On replay → returns cached response, no service call.
5. Handler calls the **service** method inside `transaction()` (`01` §4); the service returns
   `Result<T>`.
6. Handler maps `Ok → 2xx`, `Err → RFC7807` (`01` §2). On success it calls
   `IdempotencyService.complete` (inside the same tx) before commit.

Handlers are intentionally thin: no SQL, no business rules, no external calls.

---

## 2. Domain route → service map

### 2.1 Auth / Device / Consent  (`02`)
See `02-auth.md` §8 for the endpoint table. Services: `AuthService`, `MfaService`,
`DeviceService`, `ConsentService`, `SessionService`.

### 2.2 Shifts  (`shifts` table, `v_shift_verification_inbox`)
| Endpoint | Service method | Key behaviour |
|---|---|---|
| `POST /shifts/clock-in` | `ShiftService.clockIn` | Validate `assignment_id` exists & not cancelled; `start_odometer_km ≥ vehicles.current_odometer_km` (trigger `fn_shifts_validate_start_odometer` → `422 ODOMETER_DECREASED`); require accepted GPS consent (C5.5 → `403 CONSENT_REQUIRED`); require `start_media_object_id` (B1); check no `PENDING_CLOSEOUT` for driver (trigger → `409 CLOCKOUT_PENDING`); HOS rest block (C3.3 → `422 HOS_REST_BLOCKED`); insert `shifts` OPEN + `fuel_records` (SHIFT_START) + `work_logs` (plan evidence enforced by deferred constraint → `422 WORK_PLAN_REQUIRED`). |
| `POST /shifts/clock-out` | `ShiftService.clockOut` | Require `end_media_object_id` (B1) + `end_odometer_km ≥ start`; compute distance/durations; if any close-out artefact missing → `PENDING_CLOSEOUT` + `closeout_missing` jsonb (B7). |
| `GET /shifts/me/active` | `ShiftService.getActive` | Returns the OPEN shift or null. |
| `GET /shifts/verification-inbox` | `ShiftQuery.verificationInbox` | Cursor page over `v_shift_verification_inbox`; filters `verification_status`, `state`, `operational_date`. |
| `POST /shifts/{id}/verify` | `ShiftService.verify` | `VERIFY` (lock, `verified_by/at`, `locked_at`) or `FLAG` (flag_reason). `corrected_end_odometer_km` only allowed after `UNLOCK_FOR_CORRECTION` (B18) → else `409 UNLOCK_REQUIRED`. |
| `POST /shifts/{id}/force-close` | `ShiftService.forceClose` | Admin override for overrun/stale (N6/C3.8); audited. |

### 2.3 Fuel  (`fuel_records`, `fuel_purchases`, `fuel_purchase_anomalies`, `fuel_cards`)
| Endpoint | Service method | Key behaviour |
|---|---|---|
| `POST /fuel/refuel` | `FuelService.submitRefuel` | Create `before_fuel_record` + `after_fuel_record` (B3) then `fuel_purchases` with `fuel_card_last_four`; DB enforces the gauge-pair for driver entries (→ `422 MISSING_GAUGE_PAIR`). OCR is queued (A1.4). The anomaly worker scores it later (2.5). |
| `POST /fuel/purchases/{id}/verify` | `FuelService.verifyPurchase` | `VERIFY` (Fleets Mgr), `REJECT` (reason), `CLEAR_PAYMENT` (FINANCE, requires `admin_verified`). `adjusted_litres` only for `fuel:adjust`. |
| `GET /fuel/reconciliation-inbox` | `FuelQuery.reconciliationInbox` | Cursor page over `v_fuel_reconciliation_inbox` (includes gauge delta vs expected rise). |
| `POST /fuel/cards` | `FuelCardService.create` | `is_pooled` XOR `assigned_vehicle_id` (DB check). |
| `POST /reconciliation/statements` | `ReconciliationService.importStatement` | Stores `fuel_card_statements`, queues CSV parse + match (A1.9). |

### 2.4 Accidents  (`accident_reports`, `accident_media`, `accident_telemetry`)
| Endpoint | Service method | Key behaviour |
|---|---|---|
| `POST /accidents/mayday` | `AccidentService.mayday` | Insert `accident_reports` with `is_mayday=true`, `telemetry_available=false` (N3.2); emit `accident.escalate` outbox (full escalation, bypasses photo requirements) → `201`. **No photo slots required** (B17). |
| `POST /accidents` | `AccidentService.create` | Insert report (state PENDING). Evidence follows via PATCH/media. |
| `POST /accidents/{id}/media` | `AccidentService.attachMedia` | Validate `slot`; for primary slots enforce one-per-report (DB unique); insert `accident_media` (append-only trigger). |
| `GET /accidents/{id}/telemetry/verify` | `AccidentQuery.verifyChain` | Calls `app.fn_verify_accident_chain` → returns per-row validity (C3.4). |
| `POST /accidents/{id}/acknowledge` | `AccidentService.acknowledge` | Sets `acknowledged_by/at`; cancels `escalation_timers` (C6.3). |

### 2.5 Inspections (DVIR)  (`inspections`, `inspection_items`, `inspection_template_items`)
| Endpoint | Service method | Key behaviour |
|---|---|---|
| `POST /inspections` | `InspectionService.submit` | Insert `inspections` + items; failing item **requires** a photo (deferred constraint `fn_inspection_items_fail_requires_photo` → `422 DVIR_FAIL_NEEDS_PHOTO`); `previous_defects_reviewed=true` enforced (DB check → `422 DEFECTS_NOT_REVIEWED`); if any `BLOCKER` fail → set asset `is_operational=false` + quarantine (C1.5). |

### 2.6 Trailer  (`trailer_assignments`, `trailers`)
| Endpoint | Service method | Key behaviour |
|---|---|---|
| `POST /trailer/swap` | `TrailerService.swap` | Hook: create/activate `trailer_assignments` (unique partial indexes prevent double-hook, C1.11/C1.12); require `hook_inspection_id` (3-item check); optional driver-created external trailer (C1.11) → `trailers` `is_external=true`. Drop to bobtail = close row with `drop_media_object_id`, no successor. |

### 2.7 Reconciliation / Anomalies / Documents / Media
| Endpoint | Service | Notes |
|---|---|---|
| `GET /anomalies` | `AnomalyQuery.feed` | Cursor page over `v_open_anomalies` (union of fuel/HOS/accident/maintenance/security). |
| `GET /documents/expiring` | `DocumentQuery.expiring` | Cursor page over `asset_documents` within `within_days` of `expires_on` (3.5/B8). |
| `POST /media/upload-url` | `MediaService.uploadUrl` | Mint 60 s pre-signed PUT (D5); pre-insert `media_objects` with `retain_until` from `retention_class`; `ACCIDENT` → Object Lock (C5.3). |
| `GET /dashboard/vehicle-states` | `DashboardQuery.vehicleStates` | Snapshot of `v_vehicle_display_state` (N5). |

---

## 3. Critical flow — clock-in (end to end)

```
App ──POST /shifts/clock-in (Idempotency-Key=K)──▶ API
  handler: validate zod; authenticate; requirePermission('shift:clock_in')
  IdempotencyService.start(K) → NEW
  transaction(tx):
    ShiftService.clockIn(tx, body):
      assignment = repos.assignments.get(body.assignment_id)        // must exist, not cancelled
      repos.vehicles.assertOdometerGE(vehicleId, start_odometer_km)  // 422 ODOMETER_DECREASED
      consent = repos.consents.accepted(driverId, 'GPS_TRACKING_WORKING_HOURS') // 403 CONSENT_REQUIRED
      openShift = repos.shifts.findOpen(driverId)                   // 409 CLOCKOUT_PENDING if PENDING_CLOSEOUT
      hos = repos.hos.state(driverId)                                // 422 HOS_REST_BLOCKED if blocked
      shift = repos.shifts.insert(OPEN, odometer, fuel_gauge, clock_in_at, source=DRIVER)
      repos.fuel_records.insert(SHIFT_START, media, odometer, gauge)
      repos.work_logs.insert(planned_notes)
      // deferred constraint at COMMIT checks work_log has ≥1 photo or notes
      tx.audit({action:CREATE, entity:'shifts', id:shift.id, ...})
      tx.registerOutbox({type:'shift.started', aggregate:'shift', id:shift.id})
    IdempotencyService.complete(K, 201, {shift_id,...}, tx)
  COMMIT  →  outbox relay later notifies live map / HOS recompute
  201 {shift_id, clock_in_at, disclaimer}
```

Every italicised check is a DB constraint already in `db/schema`; the service re-checks in the
transaction for a clean error_code before the DB would reject, but the DB is the final authority
(defence in depth).

---

## 4. Critical flow — refuel + anomaly scoring (2.5)

```
App ──POST /fuel/refuel (K)──▶ API → transaction:
   insert fuel_records(SHIFT_START? no) BEFORE + AFTER (B3)
   insert fuel_purchases(litres, cost, odometer, card_last_four, before/after ids)
   queue OCR job (A1.4)  → outbox {type:'fuel.ocr', purchaseId}
   201 {fuel_purchase_id, open_anomalies:[]}     // anomalies scored by worker, not sync
Worker (fuel-anomaly, 5-min): for each unprocessed purchase:
   load before/after gauge_percent, tank_capacity
   expected_rise% = litres / capacity * 100
   deviation = (after% - before%) - expected_rise%
   if |deviation| > config('fuel.anomaly_gauge_deviation_pct') → anomaly POSSIBLE_THEFT_OR_LEAK
   card: if NOT pooled AND assigned_vehicle ≠ purchase.vehicle → CARD_MISMATCH (M2)
   if card.expires_on < purchased_at → EXPIRED_CARD (accepted+flagged, C2.3)
   efficiency: if shift full-to-full & deviation from baseline > config('fuel.efficiency_deviation_pct') → EFFICIENCY_DEVIATION
   price: if unit_price deviates > config('fuel.price_outlier_pct') from 30d mean → PRICE_OUTLIER
   missing gauge evidence (admin back-entry) → MISSING_GAUGE_EVIDENCE
   emit notification outbox for CRITICAL anomalies (N9/A1.8)
```

The sync endpoint returns `open_anomalies:[]` because scoring is asynchronous by design — the
reconciliation inbox (`GET /fuel/reconciliation-inbox`) shows the scored results.

---

## 5. Validation rule → source map

| Rule | Enforced by | Error |
|---|---|---|
| Odometer cannot decrease within shift | `shifts_odometer_not_decreasing` + `fn_shifts_validate_start_odometer` | `422 ODOMETER_DECREASED` |
| No duplicate start/end gauge record | unique indexes `one_start_per_shift` / `one_end_per_shift` | `409 DUPLICATE` |
| Refuel requires before+after gauge | `fuel_purchases_driver_entry_has_gauge_pair` | `422 MISSING_GAUGE_PAIR` |
| DVIR fail requires photo | deferred constraint `fn_inspection_items_fail_requires_photo` | `422 DVIR_FAIL_NEEDS_PHOTO` |
| DVIR defects acknowledged | `inspections_defects_must_be_reviewed` | `422 DEFECTS_NOT_REVIEWED` |
| No open shift if pending close-out | `fn_shifts_block_when_pending_closeout` | `409 CLOCKOUT_PENDING` |
| HOS rest not complete | `driver_hos_state.next_eligible_clock_in_at` | `422 HOS_REST_BLOCKED` |
| GPS consent missing | `user_consents` check | `403 CONSENT_REQUIRED` |
| Verified shift edited without unlock | `shifts_verified_is_locked` / unlock check | `409 UNLOCK_REQUIRED` |
| Idempotency key reused, body differs | `idempotency_keys` unique + hash compare | `422 IDEMPOTENCY_CONFLICT` |
| Assignment mandatory before clock-in | `assignments` existence check in service | `409 NO_ASSIGNMENT` |

The service layer returns these codes; the DB constraints are the guarantee.

---

## 6. Error matrix (consolidated; full catalog in `08`)

State-changing handlers map service `Result<Err>` to:

- `400 VALIDATION_ERROR` — zod failure (`field_errors`).
- `401 UNAUTHENTICATED` / `MFA_REQUIRED` — auth (`02`).
- `403 FORBIDDEN` / `ACCOUNT_SUSPENDED` / `DEVICE_REVOKED` / `CONSENT_REQUIRED` — authz/device/consent.
- `404 NOT_FOUND` — missing resource.
- `409 CLOCKOUT_PENDING` / `SHIFT_ALREADY_OPEN` / `UNLOCK_REQUIRED` / `NO_ASSIGNMENT` / `DUPLICATE` / `SESSION_LIMIT`.
- `422 ODOMETER_DECREASED` / `ODOMETER_DIVERGENCE` / `HOS_REST_BLOCKED` / `MISSING_GAUGE_PAIR` /
  `DVIR_FAIL_NEEDS_PHOTO` / `DEFECTS_NOT_REVIEWED` / `IDEMPOTENCY_CONFLICT` / `WORK_PLAN_REQUIRED`.
- `429 RATE_LIMITED` / `OFFLINE_PIN_LOCKED` — auth/device/MFA.
- `503 SERVICE_UNAVAILABLE` — downstream (Traccar/Vision/FCM) degraded.

Every `error_code` is a stable string in `api/openapi.yaml` `Problem.error_code`.

---

## 7. Cursor pagination (D7)

- Query params: `cursor?`, `limit?` (1–50, default 50), plus domain filters.
- Implementation: **keyset** pagination on a stable sort tuple, e.g. `(created_at DESC, id DESC)`;
  `cursor` is a base64 of the last row's sort values. Avoids `OFFSET` drift on live data.
- Response envelope (from `openapi.yaml` `CursorPage`): `{ data: T[], next_cursor: string|null, has_more: boolean }`.
- All list endpoints (`verification-inbox`, `reconciliation-inbox`, `anomalies`, `documents`,
  `statements`) use this envelope.

---

## 8. Driver offline-queue protocol (C5.1 / D4, `01` §5)

1. The app persists every pending write (clock-in, refuel, inspection, accident, expense) locally
   with a **fresh `Idempotency-Key` UUID** and the request body.
2. On connectivity, it replays queued writes in order, sending the same key header.
3. Server: `IdempotencyService.start` returns the cached response if the key completed → the app
   marks the local op done (no duplicate shift/purchase). If the key is IN_PROGRESS (prior attempt
   crashed mid-flight) → `409 IDEMPOTENCY_INFLIGHT`, app retries after backoff. Different body →
   `422 IDEMPOTENCY_CONFLICT`.
4. Backoff: exponential, max 30 s, with the 24 h offline ceiling (B13) after which a forced online
   login resets the queue.
5. The queue is durable on the device (SQLite) so a force-close does not lose pending ops.

This is what makes the "no duplicate shifts / no duplicate fuel purchases" guarantee real
(design risk #8).

---

## 9. Media flow (D5 / C5.3)

```
App ──POST /media/upload-url {owner_kind, retention_class, content_type}──▶
   MediaService.uploadUrl → pre-insert media_objects(retain_until from class; ACCIDENT→Object Lock)
   → 201 {media_object_id, upload_url (PUT, 60s), method:'PUT'}
App ──PUT upload_url (binary, ≤500KB, 1080px, EXIF stripped per C5.2)──▶ S3
App ──POST /shifts/clock-in {..., start_media_object_id}──▶ references the object
```
The API never receives image bytes; the 60 s URL is the only write path to S3. Orphans (object
inserted, never referenced) are reclaimed by `fn_media_due_for_deletion`.

---

## 10. Invariants this document locks

1. All state-changing routes require `Idempotency-Key`; replay returns the cached response.
2. Handlers contain no business logic; services own rules; repositories own SQL.
3. The DB constraints in `db/schema` are the final authority; service checks exist only to return
   clean `error_code`s.
4. List endpoints are cursor-paginated with a stable envelope.
5. Media is upload-via-presigned-URL only; the API never buffers bytes.
6. The offline queue is the client's responsibility and is made safe by server-side idempotency.

