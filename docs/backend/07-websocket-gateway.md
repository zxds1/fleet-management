# Backend Design 07 — WebSocket Gateway (Socket.IO)

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md` (Principal §1,
AuthError §2), `02-auth.md` (session cap §6, consent), `docs/architecture/01-service-boundaries.md` §5,
`00-locked-decisions.md` (A1.6, C6.3, C6.4, N5, N9).

This document specifies the `ws` process: the Socket.IO channels, the push/notification flow, the
concurrent-session cap, and reconnection/backpressure. It is the implementation contract for
`@fleet/ws`. Drivers use HTTP polling (A1.6); this gateway serves **admin clients only**.

---

## 1. Process boundary (`00` §3)

`ws` is a separate Deployment because Socket.IO needs its own connection/heartbeat management and a
different scaling profile than request/response HTTP (A1.6). **It holds no system of record** — it
recomputes state from PG + the `vehicle:{id}:state` Redis hash and pushes
`app.v_vehicle_display_state` (N5). A crash loses only in-flight pushes, never data.

---

## 2. Authentication & session cap (A1.6 / `02` §6)

- The client connects with the **access token** (HS256, `02` §1); the gateway validates it and
  loads the `Principal` (`01` §1). No token → immediate disconnect.
- **Max 10 live sessions per user**, tracked in Redis `user:{userId}:sessions` (sorted set,
  member = `session_id`, score = `expires_at`), with `app.user_sessions` as the audit source
  (`02` §6). On the 11th connection the lowest-scored (oldest) member is evicted and its
  `user_sessions` row revoked → security alert. A Redis failure degrades to the DB check only
  (R-109).
- A suspended/revoked session (`02` §4) is rejected at connect with the same `error_code`
  (`ACCOUNT_SUSPENDED` / `DEVICE_REVOKED`) so the admin console can show the reason.

---

## 3. Channels

| Channel | Audience | Payload | Trigger |
|---|---|---|---|
| `map:vehicle-states` | all authed admins | per-vehicle `display_state` (N5 precedence) from `v_vehicle_display_state` | `tracker_health` / shift / HOS change |
| `notifications` | the user | `app.notifications` rows (user-scoped) | `notifications` worker (`05` §2 #1) |
| `accident:live` | on-call roster (C6.3) | `accident_reports` create + escalate | `accident.created` / `escalation` worker (`05` §2 #2/#3) |

State is **recomputed server-side** from the DB + `vehicle:{id}:state` Redis hash on every change;
the gateway never holds the system of record (`01-service-boundaries.md` §5).

---

## 4. Push flow (N9 / C6.3 / C6.4)

Driver push is **not** socket-based — it is FCM direct (N9), drained by the `notifications` worker
from the outbox (`05` §2 #1, §5). The gateway's role is the **admin** real-time surface only.

- `notifications` worker sends FCM → delivery receipt updates `delivered_at`.
- Critical accident SMS always breaks quiet hours (C6.4); normal push is suppressed off-hours.
- `accident:live` is pushed to the on-call roster the instant `accident_reports` is created; the
  `escalation` worker drives the C6.3 timeout ladder (ack within `accident.ack_timeout_minutes`,
  else next tier → Head of Operations).

---

## 5. Reconnection & backpressure

- Clients reconnect with the token; the gateway re-subscribes channels from the `Principal`.
- On (re)connect, the gateway sends a **full snapshot** of the subscribed views
  (`v_vehicle_display_state`, unread `notifications`) so a client never shows stale state.
- Backpressure: state diffs are computed server-side and only the changed vehicles are emitted on
  `map:vehicle-states`. High-frequency telemetry (30 s ping, A2.4) does **not** stream raw
  positions to the client — only the derived `display_state` transition.
- Heartbeat/ping interval follows Socket.IO defaults, tuned for admin-console long sessions.

---

## 6. Invariants this document locks

1. `ws` is admin-only; drivers use HTTP polling (A1.6).
2. Connection requires a valid access token; the 10-session cap is Redis-enforced with `user_sessions` as the audit source.
3. The gateway recomputes state from PG + Redis; it owns no system of record.
4. Driver push is FCM (N9) via the worker, not Socket.IO; the gateway surfaces admin real-time only.
5. Snapshots on (re)connect prevent stale UI after a disconnect.

`08-error-state-model.md` consolidates every `error_code` and the domain state machines the
gateway and APIs expose.
