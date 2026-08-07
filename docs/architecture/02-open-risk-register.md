# Open Risk Register

**Platform:** Enterprise Fleet Management Platform
**Status:** Locked design, pre-build
**Companion documents:** `00-locked-decisions.md`, `01-service-boundaries.md`,
`api/openapi.yaml`, `db/schema/*`, `deploy/*`

This register records (a) the 12 design risks surfaced during requirements
review and how the locked design resolves each, and (b) the residual risks that
remain open at design sign-off. Items marked **PROVISIONAL** were resolved using
the architect's recommendation under the client instruction *"accept all my
recommendations, build now"* and may be overridden at final sign-off.

---

## A. The 12 design risks (all resolved by the locked design)

| # | Risk | Resolution | Where |
|---|------|------------|-------|
| R-001 | Accident photo wizard traps an injured driver | `is_mayday` path submits GPS + flag only, bypasses all 4 photos, fires full escalation immediately | `accidents/mayday` API, `accident_reports.is_mayday`, `B17` |
| R-002 | Fuel-card mismatch false-positives on pooled cards | `CARD_MISMATCH` only when `is_pooled=false` **and** wrong vehicle; submitting driver always logged | `M2`, `fuel_purchase_anomalies` |
| R-003 | Hard-blocking fuel entry on expired card loses expense data | Expired card **accepted + flagged** (`EXPIRED_CARD`), never blocked | `C2.3`, anomaly type |
| R-004 | Verified shifts cannot be corrected (payroll errors) | "Unlock for Correction" workflow, audited, original preserved in `audit_logs` | `B18`, `shifts.*_at`, `unlock_count` |
| R-005 | Tracker gap / single point of failure for HOS | Interpolate ≤5 min, flag PARTIAL beyond, optional phone-GPS fallback, clock-in allowed with dead tracker | `C1.9`, `C1.10`, `tracker_reliability` |
| R-006 | Duplicate fuel purchases / shifts from offline retries | Mandatory `Idempotency-Key`; duplicate returns cached response | `C5.1`, `D4`, `idempotency_keys` |
| R-007 | Suspended driver with offline phone keeps working | Server stores device-bound refresh token (not PIN), invalidated on suspension; offline window = 24h then forced login | `B12`, `B13`, `driver_devices` |
| R-008 | Map legend collision (speeding vs quarantined) + no offline state | New legend with precedence QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED | `N5`, `v_vehicle_display_state` |
| R-009 | 14-hour force-clockout could strand a moving driver | **14 h does not auto-close.** Marks `is_overrun`, alerts, requires human/admin closure | `N6`, `C1.1` |
| R-010 | Per-shift HOS allows split-shift / vehicle-swap evasion | HOS is driver-centric rolling ledger (`driver_duty_segments`, non-overlap EXCLUDE) | `N7`, `driver_hos_state` |
| R-011 | Off-shift location retention vs regulated tracking | Positions discarded outside shift window + 15 min buffer; off-shift movement logged as timestamp only | `C5.6`, `N3.3`, `vehicle_movement_events` |
| R-012 | Data residency (C5.5) contradicted by chosen stack | `af-south-1` (Cape Town) accepted with DPA cross-border safeguards; Africa's Talking stays in-country | `N1`, see R-101 |

---

## B. Residual / open risks at design sign-off

### R-101 — Data residency is Cape Town, not Kenya  **[HIGH, LAUNCH GATE]**
`af-south-1` is in South Africa (N1). Google Vision, Google Maps Geocoding and
FCM all move personal data abroad (N9). **Resolution accepted:** treat as
"resident in Africa, not Kenya" and rely on Kenya DPA 2019 cross-border transfer
safeguards documented in the DPIA. **Action required:** the DPIA must be approved
by the client's legal counsel **before go-live**. If counsel requires true
in-country storage, the fallback path (MinIO + Tesseract + self-hosted Nominatim
+ in-country push) is documented in `00-locked-decisions.md` N1 option (b) and is
a re-platform, not a patch.
**Owner:** Legal / DPO. **Status:** OPEN, accepted.

### R-102 — Traccar integration is version-sensitive  **[MEDIUM]**
N2.3 depends on Traccar supporting durable (Redis/Redis-Stream) forwarding. If
the pinned build lacks it, the back-fill poller becomes the primary durability
guarantee. **Action:** pin a Traccar version during build and verify the
forwarding transport against it; otherwise enable HTTP forward + poller.
**Status:** OPEN, mitigation designed.

### R-103 — HOS figures are an interpretation, not verified law  **[HIGH]**
The seeded NTSA values (8 h driving, 30 min break, 10 h rest, 14 h duty) are the
client's stated reading (C3.1). They are configurable, but a wrong legal baseline
is a compliance defect, not a tuning one. **Action:** transport counsel to confirm
the figures and the exact per-road / per-class rules before go-live. **Also** the
emergency numbers 112 / 999 (C3.5, `accident.*_number` config) must be confirmed
locally. **Status:** OPEN, flagged in seed comments.

### R-104 — DVIR BLOCKER/WARNING severities are defaults  **[MEDIUM]**
The seeded checklist severity assignments (C1.5) are architectural defaults. A
BLOCKER on the wrong item can either ground a truck unnecessarily or let an unsafe
one roll. **Action:** the fleet safety officer must review and confirm
`inspection_template_items.severity` before the first live shift. **Status:** OPEN,
flagged in seed comments.

### R-105 — Swahili UI strings are unverified  **[LOW]**
All `label_sw` values and Swahili notification bodies are machine-generated
placeholders (A2.6). **Action:** native-speaker review before driver-app launch.
**Status:** OPEN.

### R-106 — Over-retention of work-plan and DVIR photos  **[LOW, DPIA]**
M7 raised work-plan and DVIR retention from 90 days / 1 year to **7 years** to
match the payroll dispute window. This is a deliberate over-retention that the
DPIA should explicitly justify as proportionate under the Kenya DPA 2019.
**Status:** OPEN, under DPIA (R-101).

### R-107 — Off-shift SOS telemetry may be empty  **[LOW]**
An off-shift SOS (C1.14) finds no retained telemetry to freeze (N3.2); the record
is marked `telemetry_available=false`. **Mitigation:** the mayday still carries
last-known position from the phone and fires escalation. **Status:** accepted.

### R-108 — Auto-clockout depends on geofence quality  **[MEDIUM]**
A1.7 auto-clockout requires the vehicle inside a yard polygon. A sloppily drawn
geofence can either never trigger (driver must manual-close) or falsely trigger.
**Mitigation:** geofences are admin-drawn and version-logged; the 15-min idle +
5-min cancel countdown prevents accidental closure. **Action:** operator training
on geofence drawing. **Status:** accepted.

### R-109 — Concurrent-session cap is Redis-enforced  **[LOW]**
A1.6 caps admin sessions at 10/user in Redis; the DB table is the audit record.
A Redis failure degrades to the DB check only. **Status:** accepted.

### R-110 — PCI surface  **[INFORMATIONAL]**
No PAN is ever stored (C2.1); only `last_four` + label. The platform is out of
PCI DSS scope by construction. Reconciliation is statement-based (A1.9). **Status:** closed by design.

### R-111 — Provider availability for push delivery receipts  **[MEDIUM]**
N9 chose FCM direct specifically for delivery receipts that the C6.3 escalation
relies on. If FCM is unavailable in a given market/device, the escalation falls
back to an SMS timer. **Status:** accepted, dual-channel.

### R-112 — Database-level validation of external media  **[LOW]**
`media_object_id` FK constraints guarantee referenced objects exist, but
content integrity (that the bytes match the claimed `retention_class`) is enforced
by the upload service, not the schema. **Status:** accepted.

---

## C. Sign-off gates

Before any production deployment, the following must be true:

1. **R-101** DPIA approved by legal counsel (Kenya DPA 2019 cross-border transfer).
2. **R-103** HOS figures and emergency numbers confirmed by transport counsel.
3. **R-104** DVIR severity matrix reviewed and signed by the fleet safety officer.
4. **R-105** Swahili strings reviewed by a native speaker.
5. **R-102** Traccar version pinned and forwarding transport verified.

Items 1–3 are hard launch gates. Items 4–5 are quality gates that may be
remediated in a fast-follow.
