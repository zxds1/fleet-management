# Support Knowledge Base — Index

Welcome to the **HelixFleet Support Knowledge Base**. This index links to every support,
FAQ, user guide, and operational runbook for the Fleet Management Platform.

---

## Table of contents

### Getting started
- [Support Overview — channels, SLA tiers, hours of operation](00-overview.md)
- [Driver User Guide (English)](driver-user-guide.md)
- [Admin Web Console Guide](admin-guide.md)

### Driver resources
- [Driver FAQ](faq.md) — login, password reset, GPS, shift start/end, DVIR, accidents,
  offline mode, M-Pesa payments, error code reference.
- [Driver App User Guide (English)](driver-user-guide.md) — step-by-step walkthrough of every
  driver app journey: login, MFA recovery, offline PIN, clock in/out, refueling, DVIR
  inspection, accident reporting, offline mode, and more.

### Administrator resources
- [Admin Web Console Guide](admin-guide.md) — live map, vehicle/driver management, DVIR review
  queue, anomaly feed, driver MFA enrollment, maintenance scheduling.
 - [Driver FAQ](faq.md) — also covers admin-relevant items (MFA recovery codes, device revocation).
 - [Swahili Terms Glossary](swahili-terms.md) — key Swahili translations for error messages and UI strings.

### Operational runbooks (on-call DevOps)
- [Operational Runbooks](runbooks.md) — step-by-step incident procedures covering:
  - [R-01: DB backup restore procedure](runbooks.md#r-01-db-backup-restore-procedure)
  - [R-02: Redis flush + rebuild](runbooks.md#r-02-redis-flush--rebuild)
  - [R-03: Traccar container restart](runbooks.md#r-03-traccar-container-restart)
  - [R-04: API pod restart](runbooks.md#r-04-api-pod-restart)
  - [R-05: Telemetry ingestion backlog clearing](runbooks.md#r-05-telemetry-ingestion-backlog-clearing)
  - [R-06: Failover to standby](runbooks.md#r-06-failover-to-standby)
  - [R-07: Worker job failure / stuck outbox](runbooks.md#r-07-worker-job-failure--stuck-outbox)
  - [R-08: Security incident response](runbooks.md#r-08-security-incident-response)

### Engineering design docs (reference)
The following are the engineering-level design documents that underpin the platform. These are
reference material for support and ops engineers who need to understand system internals:

| Document | Covers |
|---|---|
| [`docs/apps/00-overview.md`](../apps/00-overview.md) | Mobile app architecture (Expo, offline-first, real-time) |
| [`docs/apps/driver.md`](../apps/driver.md) | Driver app screens, journeys, offline/photo/socket behavior |
| [`docs/apps/admin.md`](../apps/admin.md) | Admin app screens, live map, escalation console, MFA enrollment |
| [`docs/apps/flows.md`](../apps/flows.md) | Screen & flow specification for every app journey |
| [`docs/backend/00-overview.md`](../backend/00-overview.md) | Backend service module map, runtime processes |
| [`docs/backend/01-shared-kernel.md`](../backend/01-shared-kernel.md) | Shared kernel: Result, AppError, transactions, idempotency, outbox |
| [`docs/backend/02-auth.md`](../backend/02-auth.md) | JWT, MFA/TOTP, device+offline PIN, session cap, consent |
| [`docs/backend/03-rest-api.md`](../backend/03-rest-api.md) | REST API design, validation, error matrix, offline queue |
| [`docs/backend/04-telemetry-ingest.md`](../backend/04-telemetry-ingest.md) | Telemetry ingest, retention transform, HOS inference |
| [`docs/backend/05-workers.md`](../backend/05-workers.md) | All 13 background jobs, triggers, idempotency |
| [`docs/backend/06-repository-migrations.md`](../backend/06-repository-migrations.md) | Repo pattern, migrations, soft-delete |
| [`docs/backend/07-websocket-gateway.md`](../backend/07-websocket-gateway.md) | Socket.IO channels, push flow, session cap |
| [`docs/backend/08-error-state-model.md`](../backend/08-error-state-model.md) | Full error catalogue + state machines |
| [`docs/backend/09-observability-ci.md`](../backend/09-observability-ci.md) | Logging, probes, CI/CD pipeline, testing contract |
| [`docs/backend/slo.md`](../backend/slo.md) | Service Level Objectives, burn-rate alerts |
| [`docs/architecture/00-locked-decisions.md`](../architecture/00-locked-decisions.md) | Locked decision register (A/B/C/D/N/M decisions) |
| [`docs/architecture/01-service-boundaries.md`](../architecture/01-service-boundaries.md) | Runtime topology, process boundaries, data ownership |
| [`docs/architecture/02-open-risk-register.md`](../architecture/02-open-risk-register.md) | Risk register |
| [`docs/security.md`](../security.md) | Security specification (ISO 27001, SOC 2, Kenya DPA 2019) |
| [`docs/legal/privacy-policy.md`](../legal/privacy-policy.md) | Privacy policy |
| [`docs/legal/terms-of-service.md`](../legal/terms-of-service.md) | Terms of service |

### Incident response
- [`docs/architecture/02-open-risk-register.md`](../architecture/02-open-risk-register.md) §C —
  incident classification (SEV-1/2/3), on-call contact list, escalation matrix, and sign-off gates
  (R-101, R-103, R-104, R-105 launch requirements).

---

## Quick find

**I'm a driver and I can't log in:**
→ [Driver FAQ: How do I log in?](faq.md#1-how-do-i-log-in)
→ [Driver User Guide: Login + MFA recovery](driver-user-guide.md#1-login--mfa-recovery)

**I'm a driver and my GPS isn't updating:**
→ [Driver FAQ: What to do if GPS isn't updating?](faq.md#3-what-do-i-do-if-gps-isnt-updating)

**I forgot my password:**
→ [Driver FAQ: How do I reset my password?](faq.md#2-how-do-i-reset-my-password)

**I'm an admin and need to enroll MFA for a driver:**
→ [Admin Guide: Driver MFA enrollment](admin-guide.md#7-driver-mfa-enrollment)

**I'm an admin and need to review a DVIR:**
→ [Admin Guide: DVIR review queue](admin-guide.md#5-dvir-review-queue)

**I'm on-call and the database is down:**
→ [Runbook R-01: DB backup restore procedure](runbooks.md#r-01-db-backup-restore-procedure)
→ [Runbook R-06: Failover to standby](runbooks.md#r-06-failover-to-standby)

**I'm on-call and telemetry is backlogged:**
→ [Runbook R-05: Telemetry ingestion backlog clearing](runbooks.md#r-05-telemetry-ingestion-backlog-clearing)

**I need to look up an error code:**
→ [Driver FAQ: Error code reference](faq.md#10-what-do-the-error-codes-mean-on-my-screen)
→ [Backend: Full error catalogue](docs/backend/08-error-state-model.md) (engineering reference)

---

## Contact support

| Channel | When to use |
|---|---|
| `support@helixfleet.com` | General questions, feature requests, non-urgent bugs |
| `+254 20 555 0100` | Urgent issues during business hours (08:00–18:00 EAT) |
| `safety@helixfleet.com` | Accident follow-up, compliance queries |
| `billing@helixfleet.com` | Billing, M-Pesa payments, fuel reconciliation |
| `security@helixfleet.com` | Suspected security breach or leaked credentials (immediate) |
| `privacy@helixfleet.com` | Data export or deletion requests (DSAR) |
| [status.helixfleet.com](https://status.helixfleet.com) | Real-time uptime and maintenance windows |

See [Support Overview](00-overview.md) for full SLA details and hours of operation.
