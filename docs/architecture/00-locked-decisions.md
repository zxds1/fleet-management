# Locked Decision Register

**Platform:** Enterprise Fleet Management Platform
**Version:** 1.0 — LOCKED
**Jurisdiction:** Kenya (NTSA), Kenya Data Protection Act 2019
**Status:** Signed off. This document is the single source of truth. Any change requires a new version and a migration plan.

---

## 1. How to read this document

Every decision carries the identifier used during requirements elicitation:

| Prefix | Meaning |
|---|---|
| `A*` | Blocking strategic / infrastructure decision |
| `B*` | Resolution of a contradiction in the original functional specification |
| `C*` | Pillar-level clarification |
| `D*` | Accepted engineering default |
| `N*` | Contradiction introduced by the answer sheet, resolved during architecture review |
| `M*` | Minor interpretation applied by the architect |

Decisions marked **PROVISIONAL** were resolved using the architect's recommendation under the client's
instruction *"accept all my recommendations, build now"*. They are individually listed in
`02-open-risk-register.md` and may be overridden at sign-off without structural rework.

---

## 2. Strategic decisions (A)

| ID | Decision |
|---|---|
| A0.1 | Greenfield. No legacy code, database, GPS platform or ERP. |
| A1.1 | **Traccar** (Apache-2.0, self-hosted) handles all tracker protocol decoding. No custom TCP/UDP parser is written. Traccar `deviceId` joins to `vehicles.traccar_device_id`; IMEI joins to `vehicles.tracker_imei`. |
| A1.2 | OBD-II read passively over the tracker CAN bus. Surfaced as Traccar position `attributes`. No BLE to phone. |
| A1.3 | Fuel tank capacity is **hardcoded per vehicle** by an Admin at onboarding. Never auto-derived. |
| A1.4 | OCR: **Google Cloud Vision**, with **Tesseract** as an automatic fallback on API failure or cost-cap breach. OCR output is advisory; driver-entered values remain authoritative until an Admin verifies. |
| A1.5 | Offline conflicts: **flag both versions for manual resolution**. Never silently overwrite. |
| A1.6 | Admin real time via **Socket.IO WebSockets**. Driver app uses **HTTP polling at 10 s**. Max **10 concurrent sessions per user**, enforced in Redis. |
| A1.7 | Auto-clockout permitted **only** when: ignition OFF **and** inside a yard geofence **and** stationary ≥ 15 min **and** a 5-minute countdown push was not cancelled. See N6 for the 14-hour case. |
| A1.8 | SMS via **Africa's Talking** (Kenyan, in-country). Sender ID `FLEET_ALERT`. Numbers normalised to E.164 (`+254…`). SMS is last-resort escalation only. Rate limit: **5 SMS per incident per 15 minutes**. |
| A1.9 | Fuel card reconciliation: **Phase 1 CSV upload** with a generic column-mapping UI. Match key: `date + amount + card last four`. Provider API integration is Phase 2. |
| A1.10 | **AWS**: EKS (workloads), RDS PostgreSQL 16 + PostGIS, ElastiCache Redis, S3. Region `af-south-1`. See N1. |
| A2.1 | Kenya. NTSA regulations. Kenya Data Protection Act 2019. |
| A2.2 | **KES** primary. `currency_code CHAR(3)` present on every monetary row from day one so cross-border (Phase 2) needs no migration. |
| A2.3 | Storage in UTC (`timestamptz`). Display in **EAT (UTC+3)**. An operational "day" is `00:00:00`–`23:59:59.999999` EAT. |
| A2.4 | Now: 50 tractors / 100 trailers / 80 drivers / 5 admins. 3-year: 200 / 400 / 300 / 15. GPS ping **30 s**. |
| A2.5 | **Single tenant.** No tenant columns, no tenant isolation. |
| A2.6 | Driver app **English + Swahili**. Admin app English only. Checklist labels carry `label_en` and `label_sw`. |
| A2.7 | **Phase 1** Operations + minimal Assets → **Phase 2** Financial → **Phase 3** Safety/HOS. Schema is modelled for all three now (N10). |
| A2.8 | Paid SaaS approved, target < USD 300/month at 50 vehicles. |
| A3.1 | **Node.js 20 + Express + TypeScript.** |
| A3.2 | No custom ingestor. Traccar (Java) ingests; our Node services consume. |
| A3.3 | Maintainers assumed fluent in TypeScript/React. Mandatory JSDoc, developer runbook, CI gates. |
| A3.4 | **Expo (managed) + EAS Build.** Android 10+ only in Phase 1. iOS is Phase 2. BYOD permitted. |
| A3.5 | Distribution via **Firebase App Distribution / internal MDM**. Play Store is Phase 2. |
| A3.6 | **UI designs are supplied externally.** This architecture defines API contracts only. No UI prescription. |
| A3.7 | **Self-issued JWT (HS256)**. **TOTP MFA mandatory** for `ADMIN` and `FLEET_MANAGER`. Drivers use a local 4-digit PIN (B12). |
| A3.8 | **Turborepo monorepo** on **GitHub**, CI/CD via **GitHub Actions**, `dev → staging → prod`. |
| A3.9 | Three environments. Dev via Docker Compose; staging mirrors prod at reduced size. |

---

## 3. Contradiction resolutions (B)

| ID | Decision |
|---|---|
| B1 | Clock-in **requires** an odometer photo + numeric reading. `shifts.start_odometer_km` and `shifts.end_odometer_km` added. |
| B2 | Fuel gauge captured by **driver selector**: `EMPTY, QUARTER, HALF, THREE_QUARTER, FULL` (stored also as `gauge_percent`). Admin may override during verification. No gauge OCR. |
| B3 | Refuel flow **forces a before-photo and an after-photo** of the gauge, each with an odometer reading. Without this the anomaly engine has no input. |
| B4 | Tank capacity remains Admin-entered (A1.3). B4 is interpreted as: *anomaly detection* is now computable. See M1. |
| B5 | Authoritative consumption = **full-to-full tank method**. When the shift is not full-to-full, gauge delta is used and the record is marked `is_approximate = true` and `method = 'GAUGE_ESTIMATE'`. |
| B6 | Efficiency baseline = **per-vehicle rolling average over the last 30 shifts**, minimum sample **5 shifts**, else fleet-wide fallback. Recomputed daily. |
| B7 | An auto-closed or force-closed shift missing its final odometer becomes `state = 'PENDING_CLOSEOUT'`. The driver **cannot start a new shift** until the missing evidence is supplied. |
| B8 | Document expiry: **daily scan**, **weekly digest** email, escalating to **daily individual alerts from T-7 days**. |
| B9 | Map legend replaced — see N5. |
| B10 | Speeding threshold: **single global value** in `system_config` (`speed.limit_kph`, default 80). Per-road-segment is Phase 2. |
| B11 | Expenses are a **separate feature** with their own endpoints. UI placement is the frontend team's decision (A3.6). See M5. |
| B12 | PIN: **bcrypt hash stored in the device keystore only**. The server stores a hash of `device_id` and a device-bound refresh token, never the PIN. Devices are revocable server-side. |
| B13 | Max offline operation **24 hours**, then forced online login. A suspended driver's device-bound refresh token is invalidated; on next sync the API returns `403` with code `ACCOUNT_SUSPENDED`. |
| B14 | `assignments.trailer_id` added (nullable, to support bobtail and rigids). |
| B15 | `trailers` gains `current_vehicle_id`, `trailer_type`, `length_ft`, `capacity_weight_kg`. |
| B16 | Superseded by N4 — multi-role model. A `drivers` row is an optional 1:1 profile on `users`. `shifts.driver_id → drivers.id`. |
| B17 | Accident wizard exposes a permanent **"SEND HELP NOW — skip evidence"** action. Submits coordinates + `is_mayday = true`, bypasses all photo requirements, and fires the full escalation immediately. |
| B18 | Verified shifts are **lockable, not immutable**. Admin "Unlock for Correction" is audited; `corrected_at`, `corrected_by`, `correction_reason` are stamped; the prior value is preserved forever in `audit_logs`. |

---

## 4. Pillar clarifications (C) — condensed

### Operations
- **C1.1** Shifts may span midnight. Max duty **14 h**. Warning at **12 h**. See N6 for the 14-hour behaviour.
- **C1.2** Multiple (split) shifts per calendar day permitted.
- **C1.3** Bobtail permitted (`assigned_trailer_id NULL`). Doubles/road-trains not supported in Phase 1.
- **C1.4** DVIR checklists are **Admin-configurable** via versioned `inspection_templates`. NTSA-aligned defaults seeded.
- **C1.5** Per-item severity: `BLOCKER` fails block the shift and quarantine the asset; `WARNING` fails allow the shift and raise an Admin flag.
- **C1.6** Driver must tick `previous_defects_reviewed` and provide a typed signature name. Both are persisted.
- **C1.7** Mid-day vehicle swap **closes** the current shift and **opens** a new one, linked via `shifts.previous_shift_id`. HOS is unaffected because HOS is driver-centric (N7).
- **C1.8** No assignment = hard block. Self-selection is Phase 2.
- **C1.9** Telemetry gaps ≤ 5 min are interpolated. Gaps > 5 min are excluded from driving time and set `tracker_reliability = 'PARTIAL'`. After 15 min offline the app offers an opt-in phone-GPS fallback.
- **C1.10** A dead tracker does **not** block clock-in. The shift proceeds with a degraded-mode banner.
- **C1.11** Drivers may create an unknown trailer on the fly (`status = 'EXTERNAL'`, `is_external = true`). Admin can later merge it into the master registry via `merged_into_trailer_id`.
- **C1.12** Dropping to bobtail is permitted.
- **C1.13** Work plan: **max 5 photos**, enforced at database level.
- **C1.14** SOS available off-shift and pre-clock-in. See N3.2 for its telemetry consequence.

### Financial
- **C2.1** **Never store a PAN**, hashed or otherwise. Only `last_four` + a human label. Out of PCI scope.
- **C2.2** Cards belong to vehicles; a vehicle may hold several. `is_pooled` cards never raise `CARD_MISMATCH`. See M2.
- **C2.3** Expired card: **accept the purchase and flag it** (`EXPIRED_CARD` anomaly). Never block.
- **C2.4** All thresholds live in `system_config` and are editable at runtime. No magic numbers in code.
- **C2.5** Phase 1 payroll is **CSV export only**: `Driver, Vehicle, Shift Date, Total Hours, Driving Hours, Total KM, Verified, Flagged`.
- **C2.6** Expenses: driver submits, Admin approves/rejects (binary). No payout workflow, no cash float in Phase 1.
- **C2.7** Categories fixed to `TOLL, PARKING, REPAIR, OTHER`. Any expense > **KES 5 000** raises an automatic Admin alert.
- **C2.8** Phase 1 captures `supplier_name` and `total_cost` only. VAT / KRA PIN / ETR is Phase 2.
- **C2.9** Cost per KM is **fuel-only** in Phase 1.
- **C2.10** Calendar month default; ad-hoc custom ranges supported.

### Safety & compliance
- **C3.1** NTSA-aligned defaults, all configurable: driving **8 h/day**, break **30 min after 4 h** cumulative driving, daily rest **10 h**, weekly rest **24 h**, duty **14 h**.
- **C3.2** One global default HOS policy; per-driver override permitted and audited.
- **C3.3** **Hard block** — a driver cannot open a new shift until the required rest has elapsed.
- **C3.4** Telemetry freeze **5 min before / 1 min after**, configurable 2–10 min. `accident_telemetry` is a SHA-256 **hash chain**; any tampering breaks the chain.
- **C3.5** Emergency chooser: Police, Ambulance, Fleet Manager direct — all numbers from `system_config`.
- **C3.6** Accident lifecycle `PENDING → INVESTIGATING → RESOLVED → CLOSED`, with `insurance_claim_number`, `police_ob_number`, third-party insurer/plate, and Police Abstract PDF upload.
- **C3.7** Multiple yard geofences drawn in-browser. Each vehicle may have a `home_geofence_id`.
- **C3.8** Hourly stale-shift worker: open > 14 h **and** tracker offline > 4 h → Admin alert.
- **C3.9** Accident-induced quarantine requires a repair-completion PDF to lift. Manual quarantine can be lifted with a mandatory audited reason and no PDF.
- **C3.10** Generic `asset_documents` table covering vehicles, trailers **and drivers** (licence, medical).
- **C3.11** Maintenance triggers: odometer, time and engine hours. Tracks vendor, cost, parts, downtime.
- **C3.12** Maintenance auto-quarantine **OFF by default**; overdue threshold configurable.

### Assets
- **C4.1** Fleet includes tractors, rigids, vans and pickups (`vehicle_class`). Non-tractors simply carry a NULL trailer.
- **C4.2** **Driver photo odometer is authoritative.** Decreasing readings are **rejected**. Tracker/OBD divergence raises an advisory flag for Admin review.
- **C4.3** Google Maps Geocoding API for trailer "last seen at", with a cached address to minimise cost.
- **C4.4** `ownership_type`: `OWNED | LEASED | SUBCONTRACTOR`.
- **C4.5** Day-by-day manual dispatch. Recurring rotas are Phase 2.

### Technical
- **C5.1** `Idempotency-Key` header **mandatory** on every state-changing endpoint. Duplicate keys return the cached original response.
- **C5.2** Images: 1080 px wide, JPEG q70, ≤ 500 KB. **EXIF stripped**; server timestamp is authoritative.
- **C5.3** Retention: receipts **7 y**, accident media **7 y** under S3 Object Lock, DVIR **7 y**, work plans **7 y** (raised per M7), raw GPS **90 d**.
- **C5.4** RPO **15 min** (WAL archiving), RTO **2 h** (Multi-AZ failover), PITR retained **35 days**.
- **C5.5** Region `af-south-1` — see N1. One-time driver GPS consent screen. DPIA before launch.
- **C5.6** Hardware tracks 24/7; the platform **discards** off-shift location. Off-shift movement records a timestamp only. See N3.
- **C5.7** CloudWatch (infra) + Sentry (application). Uptime target **99.5 %**. Alerts to the infrastructure lead, 2-hour response window. No formal on-call rotation.
- **C5.8** Unit ≥ 80 % coverage, API contract integration tests, Playwright E2E on critical journeys, plus a telemetry load test at 50 devices × 10 s.
- **C5.9** RDS PostgreSQL 16 + PostGIS. **Native declarative partitioning**, not TimescaleDB.
- **C5.10** Redis **AOF enabled** (`appendfsync everysec`).

### Security & governance
- **C6.1** Roles: `DRIVER`, `DISPATCHER`, `FLEET_MANAGER`, `ADMIN`, `FINANCE` (read-only + "cleared for payment"), `AUDITOR` (read-only everything incl. audit logs).
- **C6.2** Multiple roles per user, permissions combined by **union**. See N4.
- **C6.3** Configurable **on-call roster**. Acknowledgement = first responder opening the accident and tapping Acknowledge. No acknowledgement in 5 min → Head of Operations (a `system_config` user ID) via email + SMS.
- **C6.4** Per-user quiet hours. Critical accident SMS always breaks through; push is suppressed.
- **C6.5** Audit logs retained **7 years** in an append-only table protected by a trigger that rejects `UPDATE` and `DELETE`.
- **C6.6** No integrations in Phase 1. Payroll/accounting/fuel-supplier/insurer adapters are Phase 2, behind webhook + adapter interfaces.

---

## 5. Engineering defaults (D) — all accepted

| ID | Default |
|---|---|
| D1 | `timestamptz` UTC storage, EAT rendering. |
| D2 | `numeric(14,2)` money + explicit `currency_code`. Never floats. |
| D3 | Soft delete (`deleted_at`) on master records. Hard deletes disabled. |
| D4 | Client-generated UUID idempotency on every mobile write. |
| D5 | 60-second pre-signed URLs, private buckets, separate Object-Locked bucket for accident evidence (7-year retention). |
| D6 | `location_updates` partitioned monthly; the 90-day archiver **drops whole partitions**. |
| D7 | REST at `/api/v1`, cursor pagination, RFC 7807 problem details. |
| D8 | All state-changing endpoints execute inside a single database transaction. |

---

## 6. Architecture-review resolutions (N) — PROVISIONAL

| ID | Resolution |
|---|---|
| **N1** | **Accepted Cape Town.** `af-south-1` is South Africa, not Kenya. C5.5 is restated as *"personal data resident in Africa (ZA), not Kenya"*. Cross-border transfer to AWS ZA, Google Cloud (Vision, Geocoding) and FCM is handled through documented Kenya DPA 2019 safeguards recorded in the DPIA. Africa's Talking remains in-country. **Legal sign-off on the DPIA is a launch gate.** |
| **N2.1** | **Our database is authoritative for assets; Traccar is authoritative for devices.** Provisioning is one-way: our API creates/updates the Traccar device via Traccar's REST API and stores the returned `traccar_device_id`. No bidirectional sync. |
| **N2.2** | Traccar receives its **own logical database** (`traccar`) on the same RDS instance, with its own role and no cross-database access. |
| **N2.3** | Traccar forwards positions to a **durable Redis Stream**, not fire-and-forget HTTP. A **reconciliation poller** backfills from Traccar's REST API every 5 minutes over a 30-minute lookback to close any gap. The pinned Traccar version's forwarding transports are verified at integration time; if the pinned build lacks Redis forwarding, HTTP forwarding is used and the poller becomes the primary durability guarantee. |
| **N2.4** | Traccar's own position history is purged on the same schedule as ours so the C5.6 discard rule is not defeated by Traccar's tables. |
| **N3.1** | **Recovery Mode** added: an Admin can enable location retention for a single vehicle for a bounded window, with a mandatory reason, fully audited (`recovery_modes` table). This is the documented exception to off-shift discard. |
| **N3.2** | An off-shift SOS **retroactively retains** the configured freeze window, backfilled from Traccar before its purge runs. Where no data exists, the accident record is marked `telemetry_available = false` rather than silently empty. |
| **N3.3** | Retention window is `clock_in − 15 min` to `clock_out + 15 min` (configurable) to remove boundary races and preserve the geofence idle window. |
| **N4** | **Multi-role wins.** `roles` / `user_roles` / `permissions` / `role_permissions` with union semantics. `drivers` is an optional 1:1 profile keyed on `users.id`, which cleanly supports a manager acting as relief driver. |
| **N5** | **Map legend and precedence locked.** States: `QUARANTINED` (red) > `OFFLINE` (grey, no position > 15 min) > `HOS_ALERT` (orange) > `SPEEDING` (yellow) > `MOVING` (green) > `IDLING` (blue) > `PARKED` (slate, ignition off, tracker online). Restores the HOS state B9 had deleted and adds the missing parked state. |
| **N6** | **The 14-hour rule does not auto-clock-out.** At 12 h a warning fires; at 14 h the shift is marked `is_overrun = true`, driver and Admin are alerted, and closure requires either the driver or an audited Admin force-close. Automatic clock-out remains exclusive to the A1.7 yard condition. |
| **N7** | **HOS is driver-centric and rolling**, not per-shift. `driver_duty_segments` is an append-only ledger with a non-overlap exclusion constraint; `driver_hos_state` holds the computed rolling position. This closes the split-shift / vehicle-swap evasion. |
| **N8** | **Breaks are inferred and confirmable.** Ignition OFF ≥ `min_break_seconds` creates an inferred `BREAK` segment; the driver may confirm or reclassify it as `ON_DUTY` from the dashboard. Daily and weekly rest are derived from `OFF_DUTY` segments between shifts. |
| **N9** | **FCM direct** (not Expo Push Service), consumed by `expo-notifications`. Chosen for high-priority delivery and delivery receipts, which the C6.3 five-minute escalation depends on, and to remove one foreign relay hop. |
| **N10** | Full three-phase schema authored now; Phase 1 tables deployed first, Phases 2–3 arrive as pre-planned additive migrations. |

---

## 7. Minor interpretations (M) — PROVISIONAL

| ID | Interpretation |
|---|---|
| M1 | Tank capacity is Admin-entered only. B4 refers to anomaly computability, not capacity derivation. |
| M2 | `CARD_MISMATCH` fires only when `fuel_cards.is_pooled = false` **and** `assigned_vehicle_id <> purchase.vehicle_id`. Pooled cards never raise it; the submitting driver is always recorded. |
| M3 | Driver gauge selector is authoritative. OBD fuel level and OBD odometer are cross-checks only, raising `GAUGE_OBD_DIVERGENCE` / `ODOMETER_DIVERGENCE` advisories that never block. |
| M4 | Offline PIN: 5 failures → 15-minute lockout; 10 failures → local PIN hash wiped, forcing online re-login. |
| M5 | Expenses have first-class endpoints. UI placement is out of scope per A3.6. |
| M6 | Reefer temperature in **°C**, `numeric(5,2)`, valid range −40 to +40. |
| M7 | Work-plan and DVIR photo retention **raised to 7 years** to match the payroll dispute window. Flagged in the risk register as potential over-retention for DPIA review. |

---

## 8. Deliverables produced under this register

| # | Artefact | Location |
|---|---|---|
| 1 | PostgreSQL schema (DDL) | `db/schema/*.sql`, `db/seed/*.sql` |
| 2 | OpenAPI 3.0 specification | `api/openapi.yaml` |
| 3 | Service boundary definitions | `docs/architecture/01-service-boundaries.md` |
| 4 | Docker Compose / Kubernetes manifests | `deploy/docker-compose.yml`, `deploy/k8s/*.yaml` |
| 5 | Open Risk Register | `docs/architecture/02-open-risk-register.md` |
