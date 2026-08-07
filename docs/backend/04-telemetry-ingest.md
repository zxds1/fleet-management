# Backend Design 04 — Telemetry Ingest & Derived State

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md`,
`docs/architecture/00-locked-decisions.md` (A1.1, A1.2, A2.4, C1.9, C1.10, C5.6, N2.1–N2.4, N3.1–N3.3, N5, N7, N8),
`01-service-boundaries.md` §3, `db/schema/*`.

This document specifies the telemetry path: how Traccar positions become
`telemetry.location_updates`, the retention transform that enforces off-shift discard (C5.6),
the Redis Stream transport (N2.3), the back-fill poller, dedup, and the derived state the worker
maintains (`tracker_health`, `driver_duty_segments`, `driver_hos_state`, movement events,
summaries). It is the implementation contract for `@fleet/worker` ingest mode.

---

## 1. Topology

```
trackers ─▶ Traccar (A1.1 decode) ─▶ Redis Stream `traccar:positions` (N2.3)
                                        │
                          ingest-worker consumer ──┐
                                        │          │  back-fill poller (5 min, 30 min lookback)
                                        ▼          ▼
                              retention transform ─▶ telemetry.location_updates
                                        │
                                        ├─▶ app.tracker_health        (N5 is_online/offline alert)
                                        ├─▶ app.vehicle_movement_events (C5.6 off-shift movement, ts only)
                                        ├─▶ telemetry.location_summaries (retention sweep rollup)
                                        ├─▶ app.driver_duty_segments  (N7/N8 DRIVING/ON_DUTY/BREAK)
                                        ├─▶ app.driver_hos_state      (N7 rolling HOS → C3.3 block)
                                        └─▶ app.shifts (duration/distance while open)
```

Traccar is authoritative for **devices**; our DB is authoritative for **assets** (N2.1).
Provisioning is one-way API→Traccar (the returned `traccar_device_id` is stored on `vehicles`).
Traccar's own history is purged on the same schedule (N2.4) so the discard rule is not defeated.

---

## 2. Transport — durable Redis Stream (N2.3)

- Traccar forwards each decoded position to the durable Redis Stream `traccar:positions`
  (`XADD`), **not** fire-and-forget HTTP. Redis AOF is enabled (C5.10) so a worker restart or
  brief Redis outage does not lose buffered positions.
- The pinned Traccar version's forwarding transports are verified at integration time (R-102).
  If the pinned build lacks Redis-Stream forwarding, HTTP forwarding is enabled and the back-fill
  poller becomes the primary durability guarantee.
- Each stream entry carries the raw Traccar position attributes (ignition, speed, `traccar_device_id`,
  `traccar_position_id`, OBD fuel/odometer as cross-checks only — M3).

---

## 3. Retention transform (C5.6 / N3.3) — the discard step

Before a position reaches `location_updates`, the ingest worker computes the **retained window**
and discards anything outside it. This is the technical half of the regulated-tracking rule
(C5.6); the DPIA is the legal half (R-101).

1. For an **on-shift** vehicle: retain `clock_in − 15 min … clock_out + 15 min`
   (`shift.retention_window_minutes`, configurable, default 15 — N3.3). This removes boundary
   races and preserves the geofence idle window (A1.7).
2. For an **off-shift** vehicle: positions are **discarded** entirely. Only an off-shift
   *movement* is recorded — a `vehicle_movement_events` row with a timestamp only (C5.6), no
   coordinates.
3. **Exceptions that force retention off-shift** (never discarded):
   - An active `recovery_modes` row for the vehicle (N3.1) — bounded window, mandatory reason,
     fully audited.
   - An open `accident_reports` for the vehicle (N3.2) — the freeze window is cloned into
     `accident_telemetry` (see `05` §2, `accident-freeze` worker).

Positions outside every retained window are dropped silently (not stored, not errored).

---

## 4. Back-fill poller (N2.3)

Every 5 minutes the poller reconciles Traccar's REST API over a **30-minute lookback** into
`location_updates`, using the `location_updates_traccar_dedupe` unique index on
`traccar_position_id`. Because the same index is enforced on the stream consumer, **both paths
are idempotent** — a position delivered by both stream and poller lands exactly once.

The poller is also the gap-closer: if the stream or Traccar API is briefly unavailable, the
next poll fills the hole before the 90-day raw retention (`retention.location_raw_days`) or the
monthly partition drop (`06`) would lose it.

---

## 5. Gap handling, offline, and phone-GPS fallback (C1.9 / C1.10)

| Condition | Behaviour |
|---|---|
| Telemetry gap ≤ `tracker.gap_interpolate_max_minutes` (default 5) | interpolate the missing samples; `tracker_reliability = 'OK'` |
| Gap > 5 min | exclude from driving time; set `tracker_reliability = 'PARTIAL'`; flag for Admin |
| No position for `tracker.offline_threshold_minutes` (default 15) | `tracker_health.is_online = false`; after `tracker.phone_fallback_prompt_minutes` the app offers opt-in phone-GPS fallback (C5.6, coordinates still discarded off-shift) |
| Dead tracker at clock-in (C1.10) | shift proceeds in degraded mode (banner); no block |

Moving vs stationary is decided by `telemetry.moving_speed_kph` (default 3 kph) on the
interpolated stream. Ignition is taken from Traccar attributes (A1.2, OBD passive CAN bus).

---

## 6. Derived state — `tracker_health` (N5)

Recomputed on each position (and on silence):

- `last_position_at`, `last_ignition`, `last_speed_kph`.
- `is_online` = position within `tracker.offline_threshold_minutes`.
- `display_state` precedence (N5, surfaced via Socket.IO in `07`): `QUARANTINED` > `OFFLINE` >
  `HOS_ALERT` > `SPEEDING` (> `speed.limit_kph`, default 80, B10) > `MOVING` > `IDLING` >
  `PARKED` (ignition off, tracker online).
- Offline alert emitted to the worker when transitioning online→offline.

---

## 7. Duty / HOS inference (N7 / N8)

HOS is **driver-centric and rolling**, not per-shift (N7), closing the split-shift / vehicle-swap
evasion (R-010).

- `app.driver_duty_segments` — append-only ledger; a `EXCLUDE` constraint forbids overlapping
  segments. Segment kinds: `DRIVING`, `ON_DUTY`, `BREAK`, `OFF_DUTY`.
- **Inferred BREAK (N8):** ignition OFF ≥ `min_break_seconds` creates an inferred `BREAK` segment;
  the driver may confirm or reclassify as `ON_DUTY` from the dashboard.
- **Daily/weekly rest (C3.1):** derived from `OFF_DUTY` segments between shifts.
- `app.driver_hos_state` — recomputed rolling position for active drivers (worker `hos-recompute`,
  every 5 min). Exposes `next_eligible_clock_in_at`; when rest is incomplete the clock-in service
  returns `422 HOS_REST_BLOCKED` (C3.3 hard block, `03` §5).

Because HOS is driver-centric, a mid-day vehicle swap (C1.7) that closes/opens a shift does **not**
reset HOS — the ledger is continuous across the swap.

---

## 8. Worker-owned rollups

| Target | Cadence | Notes |
|---|---|---|
| `telemetry.location_summaries` | retention sweep (nightly) | summarised before partition drop (`06`) |
| `app.vehicle_movement_events` | per off-shift movement | timestamp only (C5.6) |
| `app.shifts` duration/distance | on open shift, per position batch | feeds verification inbox (`03` §2.2) |

---

## 9. Invariants this document locks

1. Positions reach the DB only via the Redis Stream consumer **or** the back-fill poller; both are
   idempotent on `traccar_position_id`.
2. Off-shift coordinates are discarded; only off-shift *movement timestamps* and the two forced
   exceptions (recovery mode, open accident) are retained (C5.6/N3).
3. HOS is a rolling driver-centric ledger; the per-shift clock-in block reads `driver_hos_state`.
4. A dead/missing tracker never blocks clock-in (degraded mode only).
5. Redis AOF + the poller together make ingestion crash-safe.

`05-workers.md` defines the worker jobs that consume this state (anomaly scoring, HOS recompute,
escalation, retention).
