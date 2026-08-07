# Backend Design 09 — Observability & CI/CD

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md` (logging §9,
AppError §2), `03-rest-api.md` §8 (testing contract), `docs/architecture/00-locked-decisions.md`
(A3.8, A3.9, C5.7, C5.8, N1), `turbo.json`, `package.json` (workspaces).

This document specifies observability (CloudWatch/Sentry, probes, structured logs) and the GitHub
Actions pipeline that enforces the testing/lint/typecheck/contract gates before merge to
`staging`. It is the implementation contract for `deploy/*` and `.github/workflows/*`.

---

## 1. Telemetry & logging (C5.7 / `01` §9)

- **Structured JSON logs** everywhere via the shared `Logger` (`01` §9). `ConsoleLogger` writes one
  line per entry; in AWS, stdout is shipped to **CloudWatch Logs** (infra) with a service/environment
  dimension. PII/secrets are redacted by the kernel serializer before emission (`00` §4 invariant 6).
- **Application errors → Sentry** (C5.7): every uncaught exception and every `AppError` mapped to a
  5xx is reported with `error_code`, `requestId`, and the `Principal` id (no PII). `error_code` is
  the Sentry tag for grouping.
- **Tracing:** a `requestId` is generated per request (and threaded into `AppError.requestId` and the
  RFC7807 `instance`) so a single operation is correlatable across API → outbox → worker.
- **Metrics (CloudWatch):** request rate/latency per route, `error_code` counts, outbox drain lag,
  Redis Stream depth (`traccar:positions`), partition-maintenance health, and the S3/Object-Lock
  write success for accident media (C5.3).

---

## 2. Probes & health

| Probe | Path | Checks |
|---|---|---|
| Liveness | `GET /healthz` | process up |
| Readiness | `GET /readyz` | PG connect + Redis ping + (api) S3 reachability |
| Deep | `GET /health/deep` | replication lag, outbox backlog, last ingest position age (`04`) |

k8s uses liveness/readiness for restart/rollout; the deep probe pages the infra lead if the ingest
lag or outbox backlog breaches threshold (C5.7, 2-hour response window). Uptime target **99.5%**
(C5.7).

---

## 3. Testing contract (A3.3 / C5.8 / `03` §8)

Per package, enforced by Turborepo task graph (`turbo.json`):

- **Unit** ≥ 80 % on services; uses `Result` + fakes for repositories (no DB). `@fleet/shared`
  ships its own Jest suite (zod schemas, `Result`, error→RFC7807, time, logging redaction).
- **Integration** against a throwaway PG (the `db/validate.sh` cluster pattern) with applied DDL +
  seed, asserting real constraints/triggers fire (odometer-decrease rejection, idempotency replay,
  DVIR-fail-photo enforcement, soft-delete rejection).
- **Contract** tests assert `shared/schemas` match `api/openapi.yaml` (`00` §5) and that generated
  `db.ts` matches the live schema (`06` §7). Divergence fails the build.
- **E2E** Playwright on critical journeys (clock-in → refuel → verify; accident mayday →
  escalation).
- **Load** 50 trackers × 10 s against the ingest path (`04`, C5.8).

---

## 4. CI pipeline (GitHub Actions, A3.8 / A3.9)

Branch protection: no merge to `staging` without green on `dev → staging → prod`.

```
on: pull_request (target staging)
  jobs:
    - turbo:build        # tsc -b across workspace (typecheck, no emit needed)
    - turbo:lint         # tsc --noEmit + eslint per package
    - turbo:test         # jest --passWithNoTests (unit + contract)
    - contract:          # openapi↔schema + db.ts↔schema generators
    - integration:       # spin PG(:5444 pattern) + run integration suite
    - e2e:               # Playwright critical journeys
    - load-smoke:        # ingest 50×10s (C5.8) — scheduled, not per-PR
```

`turbo` caches by task hash so unchanged packages skip work. `deploy/` Dockerfiles build the single
`api`/`worker`/`ws` image (command switch, `00` §3); staging mirrors prod at reduced size (A3.9).

---

## 5. Environments & secrets (N1 / `00` §6)

- Three environments (A3.9): dev (Docker Compose), staging (prod mirror, reduced), prod.
- **Region `af-south-1`** (Cape Town, N1) — personal data resident in Africa, not Kenya; cross-border
  transfer to Google (Vision/Geocoding) and FCM covered by the DPIA (R-101, launch gate).
- Out-of-band secrets (JWT key, FCM SA, Vision key, Africa's Talking key, S3/KMS, DB/Redis URLs)
  come from the platform secret store (EKS IRSA / SSM), mounted as env/secret files. `system_config`
  holds only tunable thresholds (C2.4), never secrets.
- Africa's Talking stays in-country (N1); FCM/Vision/Geocoding are the documented cross-border
  flows requiring DPIA sign-off before go-live.

---

## 6. Sign-off gates (from `02-open-risk-register.md` §C)

CI enforces code quality; the following are **human/legal gates** recorded as required status
checks or release blockers:

1. **R-101** DPIA approved by legal counsel (Kenya DPA 2019 cross-border transfer) — **hard launch gate**.
2. **R-103** HOS figures + emergency numbers confirmed by transport counsel — **hard launch gate**.
3. **R-104** DVIR severity matrix reviewed/signed by fleet safety officer — **hard launch gate**.
4. **R-105** Swahili strings native-speaker reviewed — quality gate (fast-follow OK).
5. **R-102** Traccar version pinned + forwarding transport verified — quality gate.

---

## 7. Invariants this document locks

1. Logs are structured JSON, PII-redacted by the kernel; errors flow to Sentry tagged by `error_code`.
2. Every request carries a `requestId` correlatable across API → outbox → worker.
3. Unit ≥ 80 %, integration against throwaway PG, contract (openapi↔schema + db.ts↔schema), E2E,
   and ingest load test are all CI gates.
4. No merge to `staging` without green; three environments; secrets out-of-band; `system_config`
   holds no secrets.
5. The five risk-register gates (R-101/103/104 hard, R-105/102 quality) are release blockers.

This completes the backend design set `00`–`09`. The spine is `00-overview.md`; `01` is the shared
kernel; `02`–`03` cover auth and REST; `04`–`09` cover ingest, workers, data access, realtime,
error/state model, and observability/CI.
