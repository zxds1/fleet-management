# Support — Overview

**Status:** Active documentation. **Audience:** drivers, fleet administrators, dispatchers, and the
on-call operations team.

This is the entry point for all Fleet Management Platform (HelixFleet) end-user and operational
support documentation. It is intentionally separate from the engineering design docs in
`docs/apps/` and `docs/backend/`; those describe *how the system is built*, while this folder
describes *how people use and operate it*.

---

## 1. Who this is for

| Audience | Where to start |
|---|---|
| **Drivers** (mobile app) | `driver-user-guide.md` → `faq.md` |
| **Fleet admins / dispatchers** (tablet/web console) | `admin-guide.md` → `faq.md` |
| **On-call ops / DevOps** | `runbooks.md` → `00-overview.md` (this file) |

---

## 2. Support channels

### Email
- **General support:** `support@helixfleet.com` — use for feature questions, account issues,
  and non-urgent bugs. Response within SLA (see §3).
- **Billing / finance:** `billing@helixfleet.com` — fuel payment clearance, invoices, expense
  approvals.
- **Safety / accidents:** `safety@helixfleet.com` — mayday follow-up, accident report review,
  compliance queries.
- **Data requests (DSAR / privacy):** `privacy@helixfleet.com` — data export or deletion requests
  under the Kenya Data Protection Act 2019.

### Phone
- **Support hotline:** `+254 20 555 0100` — operational hours only (see §4). For urgent
  **active-safety** incidents, use the in-app **SEND HELP NOW** button, which pages the on-call
  roster via FCM + SMS (decision C6.3).
- **Emergency (outside hours, life-threatening):** `999` (ambulance) or `112` (general emergency).
  The app also surfaces these numbers directly in the SOS chooser (`accident.emergency_police_number`,
  `accident.emergency_ambulance_number` in `system_config`).

### In-app / in-product
- **Admin console:** Help → Contact Support opens a pre-filled ticket with the user's role and
  current view.
- **Driver app:** Settings → Report a Problem captures the device ID, app version, and last 50
  offline queue entries to attach to the support ticket.

### Status page
- Public status: `https://status.helixfleet.com` — real-time uptime (99.5% target, C5.7),
  scheduled maintenance windows, and historical incident summaries.

---

## 3. SLA tiers

| Tier | Customers | First response | Resolution target | Hours |
|---|---|---|---|---|
| **Critical (SEV-1)** | All | 15 minutes | 2 hours | 24 / 7 |
| **High** | Paid / Enterprise | 1 hour | 8 hours | Business hours |
| **Standard** | Paid / Standard | 4 hours | Next business day | Business hours |
| **Low** | All | 8 hours | 3 business days | Business hours |

### What counts as Critical (SEV-1)
- Drivers or admins cannot log in or submit reports.
- Telemetry ingest is stalled or > 15 min behind.
- API returning 5xx on > 5% of requests for 5 consecutive minutes.
- Accidental data deletion or corruption.
- Security breach or suspected credential exposure.

> Full incident classification and escalation is defined in `docs/architecture/02-open-risk-register.md`
> (sign-off gates §C). The ops on-call contact list and escalation matrix are maintained there.

---

## 4. Hours of operation

- **Support phone line:** Monday–Friday, 08:00 – 18:00 EAT. Closed on Kenyan public holidays.
- **Email support:** Same hours; responses outside business hours are batched for the next
  business day.
- **SEV-1 paging:** 24 / 7 / 365. The current DevOps on-call engineer is tagged `@oncall-devops`
  in Slack (#ops). After 5 minutes of no acknowledgment, an SMS is sent via Africa's Talking
  (`FLEET_ALERT` sender, decision A1.8) to the DevOps Lead's phone.
- **Planned maintenance windows:** Tuesdays 02:00 – 04:00 EAT (coincides with the daily backup
  window). Subscribers to the status page receive advance notice.

---

## 5. Quick reference: when to contact whom

| Symptom | Contact |
|---|---|
| Driver locked out / MFA recovery codes lost | `support@helixfleet.com` or admin console (admin can view recovery codes) |
| Forgot password | Driver: use "Forgot password" link on the login screen. Admin: `support@helixfleet.com` |
| GPS not updating in the app or on the live map | `support@helixfleet.com` (may indicate a Traccar forwarder or tracker issue) |
| Vehicle quarantined by DVIR BLOCKER defect | Fleet manager — see `admin-guide.md` §4 (DVIR review queue) |
| Fuel purchase flagged as an anomaly | `billing@helixfleet.com` |
| Accident mayday — escalation not acknowledged | Emergency: `112` / `999`. Non-urgent: `safety@helixfleet.com` |
| M-Pesa payment not reflecting after 1 hour | `billing@helixfleet.com` (FCM/Vision cross-border transfer, see DPIA R-101) |
| Suspect security breach or leaked credential | `security@helixfleet.com` immediately; see `docs/security.md` §10 (Monitoring, response & resilience) |

---

## 6. How to file a good support ticket

To get the fastest resolution, include:

1. **Your role** — Driver, Fleet Manager, Admin, or Ops.
2. **What you were doing** — the exact screen or API action.
3. **What happened** — the error message or unexpected result.
4. **When** — date and time (EAT) if possible.
5. **Who / which asset** — vehicle plate or driver name for context.
6. **Error code from the screen** — the app surfaces stable `error_code` strings
   (see `docs/backend/08-error-state-model.md`). Copy it exactly.

From the driver app: Settings → Report a Problem auto-attaches your device ID, app version, and
the last 50 offline queue entries, which dramatically speeds triage.

---

## 7. What's in this folder

| Document | Purpose |
|---|---|
| `00-overview.md` | This file — channels, SLA, hours of operation. |
| `faq.md` | Driver-facing FAQ: login, GPS, shifts, DVIR, accidents, offline mode, M-Pesa. |
| `admin-guide.md` | Admin web console: live map, vehicle/driver management, DVIR queue, anomalies, MFA, maintenance. |
| `driver-user-guide.md` | Driver mobile app, English: login, MFA recovery, clock in/out, refuel, DVIR, accidents, offline mode. |
| `runbooks.md` | Operational runbooks for the ops team: DB restore, Redis flush, Traccar restart, API pod restart, telemetry backlog, failover, worker/stuck outbox. |
| `index.md` | Knowledge base table of contents — links to all the above. |
