# Operational Runbooks

**Owner:** DevOps Lead (on-call rotation). **Companion docs:**
`docs/backend/00-overview.md`, `docs/backend/04-telemetry-ingest.md`,
`docs/backend/05-workers.md`, `docs/backend/07-websocket-gateway.md`,
`docs/backend/09-observability-ci.md`, `docs/backend/slo.md`,
 `deploy/docker-compose.yml`, `deploy/k8s/manifests.yaml`, `deploy/monitoring/alerts.yaml`,
 `docs/backend/06-repository-migrations.md`, `docs/security.md`.

These runbooks are the **step-by-step procedures** for the on-call operations team. They cover
the most common production incidents. Each runbook references the relevant monitoring alert,
health endpoint, and rollback script.

**On-call contact:** see `docs/architecture/02-open-risk-register.md` §C (sign-off gates). Current
on-call is tagged `@oncall-devops` in Slack (#ops).

---

## Runbook index

| # | Incident | Runbook | Related alert |
|---|---|---|---|
| R-01 | Database backup restore needed | **DB backup restore procedure** | (any data loss) |
| R-02 | Redis AOF corrupt / memory exhausted | **Redis flush + rebuild** | `redis-eviction` (CloudWatch) |
| R-03 | Traccar container unhealthy | **Traccar container restart** | `TelemetryStreamDepth` (stream depth) |
| R-04 | API pod crash / 5xx spike | **API pod restart** | `ApiErrorRateAlarm` (A-01) |
| R-05 | Telemetry ingestion backlog | **Telemetry ingestion backlog clearing** | `TelemetryStreamDepthAlarm` (T-03) |
| R-06 | Primary DB failed, standby available | **Failover to standby** | RDS event / `DbReplicaLagAlarm` |
| R-07 | Background worker failure / stuck outbox | **Worker restart / outbox retry** | `OutboxBacklogAlarm` or SLO A-04 |
| R-08 | Security incident (compromised token, breach) | **Security incident response** | Sentry / CloudWatch 4xx spike |

---

## R-01: DB backup restore procedure

**When to use:** Data corruption, accidental deletion, or schema migration failure requires
restoring from backup.

**RPO:** 15 minutes (WAL archiving, decision C5.4).
**RTO:** 2 hours (Multi-AZ failover, C5.4).

### Prerequisites

- The daily backup CronJob (`backup-daily`, schedule `0 23 * * *` = 02:00 EAT) writes to
  S3 at `s3://fleet-backups-production/<YYYY>/<MM>/<DD>/backup-<timestamp>.sql.gz.gpg`.
- Base backups (`backup-<timestamp>-base.tar.gz.gpg`) are also available for PITR.
- The `fleet-backup` ServiceAccount (IRSA role `fleet-backup-role`) has S3 + KMS access.
- Secrets: `DATABASE_URL` (fleet DB admin), `BACKUP_ENCRYPTION_KEY` (gpg passphrase or KMS key id).

> **Note:** The backup/restore scripts (`scripts/backup/restore.sh`,
> `scripts/dr/rollback-api.sh`) and the incident-response doc
> (`scripts/dr/incident-response.md`) are referenced in pre-production designs but do not
> yet exist in the repository. Adapt the manual commands below to your actual tooling, or
> create the referenced scripts from the deployment manifests in
> `deploy/k8s/manifests.yaml` and `deploy/docker-compose.yml`.

### Steps

1. **Assess** — confirm the need for a restore:
   - Check `db/validate.sh` for constraint failures or data corruption.
   - Check RDS event subscriptions and CloudWatch `DatabaseConnections`, `CPUUtilization`,
     `FreeStorageSpace`.
   - If only a single table is affected and no backup is needed, stop here.
   - Otherwise, proceed.

2. **Stop writes** — put the system in maintenance mode:
   ```bash
   # Scale API to 0 (no new writes)
   kubectl scale deployment api --replicas=0 -n fleet
   # Drain the worker (stop ingesting telemetry)
   kubectl scale deployment worker --replicas=0 -n fleet
   kubectl scale deployment ingest --replicas=0 -n fleet
   # Mark maintenance in system_config
   psql "$DATABASE_URL" -c "INSERT INTO app.system_config (key, value, value_type, description) VALUES ('maintenance_mode', 'true', 'boolean', 'Manual maintenance mode (R-01)') ON CONFLICT (key) DO UPDATE SET value='true';"
   ```

3. **Identify the backup** to restore:
   ```bash
   export ENV=production
   export S3_BUCKET=fleet-backups-production
   export AWS_REGION=af-south-1
   export DATABASE_URL="postgresql://fleet-admin:***@fleet-prod.cluster-...:5432/fleet"
   export BACKUP_ENCRYPTION_KEY="****"

    # List available backups
    aws s3 ls "s3://fleet-backups-production/$(date +%Y)/$(date +%m)/$(date +%d)/" --region af-south-1
    ```

4. **Restore** (full logical restore):
    ```bash
    # 1. Download the encrypted backup from S3
    aws s3 cp "s3://fleet-backups-production/<path>/backup-<timestamp>.sql.gz.gpg" ./backup.sql.gz.gpg

    # 2. Decrypt (gpg or KMS)
    gpg --decrypt --output backup.sql.gz backup.sql.gz.gpg

    # 3. Decompress
    gunzip backup.sql.gz

    # 4. Terminate existing connections
    psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fleet' AND pid <> pg_backend_pid();"

    # 5. Drop and recreate schemas, then restore
    psql "$DATABASE_URL" -c "DROP SCHEMA app, telemetry, audit CASCADE; CREATE SCHEMA app, telemetry, audit;"
    psql "$DATABASE_URL" -d fleet -f backup.sql
    ```

   **For point-in-time recovery** (restore to a specific timestamp):
   ```bash
   # Restore from the nearest base backup, then replay WAL archives to the target time
   pg_basebackup -D /var/lib/postgresql/data/restore -Ft -z -P -R
   # Then follow pg_waldump / pg_rewind to recover to: 2026-08-10 09:45:00+03
   ```
   This uses `pg_basebackup` + WAL archive to restore to the exact point in time (decision C5.4).

5. **Validate** — run against the restored DB:
   ```bash
   npm run db:types:check  # regenerate + verify db.ts types
   cd db && bash ./validate.sh  # smoke tests: constraints, triggers, idempotency
   ```
   Also manually verify critical functions:
   ```sql
   psql "$DATABASE_URL" -c "SELECT count(*) FROM app.roles;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM app.permissions;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM app.system_config;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM app.hos_policies;"
   ```

6. **Clear maintenance mode** and scale services back:
   ```bash
   psql "$DATABASE_URL" -c "UPDATE app.system_config SET value='false' WHERE key='maintenance_mode';"
   kubectl scale deployment api --replicas=3 -n fleet
   kubectl scale deployment worker --replicas=3 -n fleet
   kubectl scale deployment ws --replicas=2 -n fleet
   kubectl scale deployment ingest --replicas=2 -n fleet
   ```

7. **Verify** — confirm full system health:
   ```bash
   curl https://api.fleet.helixfleet.com/health/deep
   kubectl get pods -n fleet
   ```
   The deep health probe checks replication lag, outbox backlog, and last ingest position age
   (`docs/backend/09-observability-ci.md` §2).

8. **Document** — file a post-mortem. Incident classification and escalation is defined in
   `docs/architecture/02-open-risk-register.md` §C. The on-call contact list is maintained there.

### Monthly restore-test (verification)

A monthly CronJob (`restore-test`, schedule `0 0 1 * *` = 03:00 EAT on the 1st) automatically
tests the latest backup. It spins up a throwaway PostgreSQL in Docker, restores the latest
backup, runs schema validation queries, and tears down. Logs:
```bash
kubectl get cronjob restore-test -n fleet
kubectl logs job/restore-test-<timestamp> -n fleet
```

**Runbook sign-off:** This procedure is reviewed quarterly or after any SEV-1 data incident.

---

## R-02: Redis flush + rebuild

**When to use:** Redis AOF corruption, memory exhaustion (eviction of live session data),
or the `redis-eviction` CloudWatch alarm fires (EvictedKeys > 0).

**Impact:** Redis holds session caches, the `traccar:positions` telemetry stream buffer, and
the `user:{userId}:sessions` sorted set (session cap, decision A1.6). Flushing loses
in-flight telemetry that hasn't been processed yet and all cached sessions.

**Note (risk):** This is a last-resort action. Normally Redis AOF survives restarts
(decision C5.10). Only flush if AOF is corrupt or the cluster is unreachable and stuck.

### Prerequisites

- Kubernetes access to the `fleet` namespace.
- `kubectl` configured with admin access to `af-south-1`.
- The RDS database is the source of truth for sessions (`app.user_sessions`).

### Steps

1. **Assess** — diagnose the Redis issue:
   ```bash
   # Check pod status
   kubectl get pods -n fleet -l app=redis

   # Check logs
   kubectl logs -n fleet -l app=redis --tail=50

   # Port-forward to inspect
   kubectl port-forward svc/redis 6379:6379 -n fleet &
   redis-cli ping
   redis-cli INFO persistence    # check AOF status
   redis-cli INFO memory         # check used_memory vs maxmemory
   redis-cli INFO stats          # check evicted_keys
   redis-cli XLEN traccar:positions   # stream depth
   ```

2. **Check stream depth** — if `XLEN traccar:positions` is large (> 5 000, SLO T-03), the
   backlog will need reprocessing after rebuild (see R-05).

3. **Drain the API** — prevent new session writes while we rebuild:
   ```bash
   kubectl scale deployment api --replicas=0 -n fleet
   # Workers can stay running — they will re-queue failed stream reads.
   ```

4. **Flush Redis** — choose the method based on the problem:

   **Option A: AOF corruption (data loss expected)** — flush all:
   ```bash
   redis-cli FLUSHALL ASYNC
   ```

   **Option B: Restart with a clean AOF** — restart the Redis pod:
   ```bash
   kubectl rollout restart statefulset/redis -n fleet
   # Wait for all 3 pods to come back online (StatefulSet)
   kubectl rollout status statefulset/redis -n fleet --timeout=120s
   ```

5. **Verify rebuild** — confirm Redis is healthy with AOF re-enabled:
   ```bash
   redis-cli ping                          # expect PONG
    redis-cli CONFIG GET appendonly       # expect "appendonly:yes" (C5.10)
    redis-cli INFO persistence             # AOF rewrite should be in progress or complete
   ```

    The Redis config (`deploy/k8s/manifests.yaml` §"Redis") enforces:
    - `--appendonly yes --appendfsync everysec` (AOF, decision C5.10).
    - `maxmemory` and `maxmemory-policy` are **not set** in the manifest (no eviction policy
      configured — Redis will fail to allocate memory rather than evict). If memory pressure is
      observed, investigate connection leaks before considering eviction policy changes.

6. **Rebuild session state** — sessions are rebuilt from `app.user_sessions` in the DB. Users
   will need to re-authenticate on next use. The `PgOutboxRelay` will re-deliver any pending
   outbox events. No manual DB work is needed — the auth layer (`docs/backend/02-auth.md` §6)
   re-populates `user:{userId}:sessions` from `app.user_sessions` on next login.

7. **Scale API back up:**
   ```bash
   kubectl scale deployment api --replicas=3 -n fleet
   kubectl rollout status deployment/api -n fleet --timeout=120s
   ```

8. **Verify** — check the deep health probe and that telemetry is flowing again:
   ```bash
   curl https://api.fleet.helixfleet.com/health/deep
    # /readyz should report postgres: true, s3: true
   # last_ingest_age_seconds should be dropping
   ```

9. **Notify** — if sessions were lost, affected admins receive a security alert. Use the
   `notifications` worker to publish a system-wide message if needed (decision C5.7, 2-hour
   response window).

10. **Document** — record the incident in the post-mortem template.

---

## R-03: Traccar container restart

**When to use:** Traccar is unhealthy, the tracker port (5005) is not accepting connections,
the Redis Stream is not advancing, or `traccar:positions` backlog grows.

**Traccar role:** Decodes 200+ GPS tracker protocols and forwards positions to the Redis
Stream `traccar:positions` (decision A1.1/N2.3). Our DB is authoritative for assets;
Traccar is authoritative for devices (decision N2.1).

### Prerequisites

- `kubectl` access to the `fleet` namespace.
- The back-fill poller runs every 5 minutes with a 30-minute lookback (decision N2.3)
  and is idempotent on `traccar_position_id`. It will recover any gap from the stream outage
  automatically.

### Steps

1. **Assess** — check Traccar health and stream depth:
   ```bash
   kubectl get pods -n fleet -l app=traccar
   kubectl logs -n fleet -l app=traccar --tail=30

   # Check the Redis Stream
   kubectl port-forward svc/redis 6379:6379 -n fleet &
   redis-cli XLEN traccar:positions

   # Check the deep health probe for ingest lag
   curl https://api.fleet.helixfleet.com/health/deep
   # Look at last_ingest_age_seconds
   ```

2. **Drain (not needed for short restarts)** — the back-fill poller (decision N2.3) recovers
   gaps automatically. If the restart will take > 5 minutes, note the current stream ID and
   plan to verify no positions were lost:
   ```bash
   redis-cli XINFO STREAM traccar:positions  # note last-generated-id
   ```
   Traccar's own history is purged on the same schedule (decision N2.4), so only the Redis
   Stream + back-fill poller protect recent data.

3. **Restart Traccar:**
   ```bash
   kubectl rollout restart deployment/traccar -n fleet
   kubectl rollout status deployment/traccar -n fleet --timeout=120s
   ```
   The `traccar` Deployment has 2 replicas (`deploy/k8s/manifests.yaml` §"Traccar Deployment").
   Kubernetes will restart one pod at a time (no downtime for the standby tracker protocol
   connections).

4. **Verify** — confirm Traccar is healthy and the stream is advancing:
   ```bash
   kubectl get pods -n fleet -l app=traccar
   kubectl logs -n fleet -l app=traccar --tail=20  # look for "Started at" / "Redis forwarder enabled"

   # Wait 30s, then check stream is advancing
   redis-cli XLEN traccar:positions
   sleep 30
   redis-cli XLEN traccar:positions    # should be increasing if trackers are connected
   ```

5. **Check data completeness** — if the restart was > 5 minutes, the back-fill poller
   (decision N2.3) should have closed the gap. Verify:
   ```bash
   # Ingest age should be < 30s (SLI T-01: P95 ≤ 5s, T-02: P99 ≤ 30s)
   curl https://api.fleet.helixfleet.com/health/deep | grep -i ingest
   ```

6. **Document** — record the incident. If the restart recurs, check the Traccar version pin
   (risk register R-0102 — Traccar version must be pinned + forwarding transport verified).

---

## R-04: API pod restart

**When to use:** API pods crash, OOM-kill, 5xx error rate exceeds 0.1% (SLO A-01, alert
`ApiErrorRateAlarm`), or the liveness probe (`/healthz`) fails.

**API role:** Express HTTP service — REST endpoints, media presign, telemetry webhook accept
(`docs/backend/00-overview.md` §3, README §3).

### Prerequisites

- `kubectl` access to the `fleet` namespace.
- The API has 3 replicas with a PodDisruptionBudget requiring min 2 available
  (`deploy/k8s/manifests.yaml` §"API PodDisruptionBudget").
- Rolling update strategy: `maxUnavailable: 0, maxSurge: 1` — so there is always capacity.

### Steps

1. **Assess** — confirm the issue is the pod, not an upstream dependency:
   ```bash
   kubectl get pods -n fleet -l app=fleet-api
   kubectl logs -n fleet -l app=fleet-api --tail=50
   # Look for crashes, OOM kills, or 5xx stack traces

   # Check Sentry for error patterns (tagged by error_code)
   # Check dependent services
   kubectl get pods -n fleet -l app=redis
   kubectl get pods -n fleet -l app=traccar
   ```

2. **Check Sentry** — look for a spike in errors with a specific `error_code` tag. If this is
    a code bug rather than infrastructure, do NOT restart — roll back the API image via
    `kubectl rollout undo deployment/api` (the deployment has a revision history).

3. **Restart the API pods:**
   ```bash
   # Rolling restart of the API deployment
   kubectl rollout restart deployment/api -n fleet
   kubectl rollout status deployment/api -n fleet --timeout=180s
   ```

   The rolling restart replaces pods one at a time (maxSurge=1, maxUnavailable=0), so there
   is no downtime. Each new pod must pass the readiness probe (`GET /readyz` checks PostgreSQL
   connectivity + S3 reachability) before receiving traffic.

4. **Verify** — confirm health probes pass and error rate drops:
   ```bash
   kubectl get pods -n fleet -l app=fleet-api

   # Liveness and readiness probes
    curl -s https://api.fleet.helixfleet.com/healthz   # expect 200
    curl -s https://api.fleet.helixfleet.com/readyz    # expect 200, s3: true, postgres: true

   # Deep health (replication lag, outbox backlog, ingest lag)
   curl -s https://api.fleet.helixfleet.com/health/deep
   ```

   Check CloudWatch for the API 5xx rate (SLO A-01) — it should return to ≤ 0.1%.

5. **If the pod keeps crashing** — check:
   - `kubectl describe pod <pod-name> -n fleet` for OOM/resource issues.
   - Resource limits: requests={cpu: 500m, memory: 512Mi}, limits={cpu: 1, memory: 1Gi}
     (`deploy/k8s/manifests.yaml`).
    - If it's a code issue, roll back via `kubectl rollout undo deployment/api`.

6. **Document** — record the incident and the root cause.

---

## R-05: Telemetry ingestion backlog clearing

**When to use:** The `traccar:positions` Redis Stream is growing (`XLEN > 10,000`, warning;
`> 50,000`, page per SLO T-03), or `last_ingest_age_seconds` from `/health/deep` exceeds 60 s
(alert `TelemetryStreamDepthAlarm` or `TelemetryIngestLagAlarm`).

**Ingest topology** (`docs/backend/04-telemetry-ingest.md`):
```
trackers → Traccar → Redis Stream traccar:positions → ingest-worker consumer → location_updates
                                   (back-fill poller every 5 min, 30-min lookback)
```

### Prerequisites

- The ingestion pipeline runs in the `worker` image with `--role ingest` (README §3).
  The `ingest` Deployment reuses the `api`/`worker` image.
- The worker is stateless and horizontally scalable — the Redis Stream consumer group
  distributes messages across replicas (`deploy/k8s/manifests.yaml` §"Worker Deployment").

### Steps

1. **Assess** — measure the backlog:
   ```bash
   kubectl port-forward svc/redis 6379:6379 -n fleet &
   redis-cli XLEN traccar:positions

   # Check ingest lag from the deep health probe
   curl -s https://api.fleet.helixfleet.com/health/deep
   # last_ingest_age_seconds: should be < 30 (SLO T-02)

   # Check worker ingest logs
   kubectl logs -n fleet -l app=fleet-worker --tail=20
   # Look for "consumer.processPositions" and any errors

   # Check Traccar forwarding
   kubectl logs -n fleet -l app=traccar --tail=20
   ```

2. **Check for errors** — if positions are failing to process:
   ```bash
   kubectl logs -n fleet -l app=fleet-worker --tail=100
   # Look for DB connection errors, constraint violations, or OOM.
   ```
   If the ingest worker itself is crashing, restart it (see R-04 adapted for `--role ingest`).

3. **Scale the ingest workers** — the worker is stateless; the Redis consumer group
   (`XREADGROUP`) distributes messages. Scale up to drain the backlog:
   ```bash
   kubectl scale deployment ingest --replicas=5 -n fleet
   kubectl rollout status deployment/ingest -n fleet --timeout=120s
   ```
   Each replica consumes a subset of the stream via the consumer group. The HPA is configured
   for CPU/memory scaling (recommended also based on stream depth, per `deploy/k8s/manifests.yaml`
   §"Worker Deployment" comment).

4. **Monitor the backlog draining:**
   ```bash
   watch -n 10 'redis-cli XLEN traccar:positions'
   ```
   The depth should decrease. At 50 trackers × 30 s ping (decision A2.4), the normal steady-state
   depth is very low (< 5,000). The backlog should clear within 5–10 minutes depending on size.

5. **Verify** — confirm ingest age returns to normal:
   ```bash
   curl -s https://api.fleet.helixfleet.com/health/deep
   # last_ingest_age_seconds should be < 30
   ```

6. **Scale back down** — once the backlog is cleared:
   ```bash
   kubectl scale deployment ingest --replicas=2 -n fleet
   ```

7. **Root-cause analysis** — if the backlog recurs:
   - Check the Traccar version (risk R-0102 — forwarding transport must be verified).
   - Check the back-fill poller lookback window (5 min, 30-min lookback, decision N2.3).
   - Check worker pod CPU/mem (scale HPA based on `XLEN` depth, not just CPU).

---

## R-06: Failover to standby

**When to use:** The primary RDS Postgres instance has failed (crash, hardware failure) and a
standby (Multi-AZ) is available within the same region (`af-south-1`, decision A1.10).

**RPO:** 15 minutes (WAL archiving, decision C5.4).
**RTO:** 2 hours (Multi-AZ failover, C5.4).
**Alert:** RDS event subscription or `DbReplicaLagAlarm` firing (see C5.4 for RPO/RTO).

### Prerequisites

- RDS Postgres 16 + PostGIS on a Multi-AZ deployment or with a read replica (`fleet-prod`
  cluster, decision A1.10).
- The `fleet-db` Kubernetes secret holds the `DATABASE_URL`.
- The standby is within 15 seconds of the primary (check `pg_stat_replication`).

### Steps

1. **Assess** — confirm the primary is down and the standby is in sync:
   ```bash
   # Check RDS event subscriptions
   aws rds describe-events --source-identifier fleet-prod --source-type db-instance

   # Check replica lag (connect to the standby via its reader endpoint, or via kubectl port-forward)
   psql "postgresql://fleet:pass@fleet-prod-ro.cluster-...:5432/fleet" -c "
     SELECT pid, write_lag, flush_lag, replay_lag FROM pg_stat_replication;
   "
   ```
   If `replay_lag < 15s`, the standby is safe to promote.

2. **Confirm no other action is faster** — a simple pod restart or API redeploy (R-04) will
   NOT help if the DB itself is the problem. If RDS reports a planned failover or the instance
   is in `stopping`/`failed`, proceed to promotion.

3. **Promote the standby** — this makes the standby the new primary:
   ```bash
   aws rds failover-db-cluster \
     --db-cluster-identifier fleet-prod \
     --target-db-instance-identifier fleet-prod-standby
   ```
   Or, for a read-replica:
   ```bash
   aws rds promote-read-replica-db-cluster \
     --db-cluster-identifier fleet-prod-ro
   ```

   This process takes 2–5 minutes. RDS performs the promotion automatically.

4. **Update the `DATABASE_URL` secret** — point applications to the new writer endpoint:
   ```bash
   # Find the new writer endpoint from the RDS console / CLI
   aws rds describe-db-clusters --db-cluster-identifier fleet-prod \
     --query 'DBClusters[0].Endpoint' --output text

   # Update the secret
   kubectl get secret fleet-db -n fleet -o jsonpath='{.data.DATABASE_URL}' | base64 -d
   # Update with the new endpoint, then re-encode
   echo -n "postgresql://fleet:***@NEW-ENDPOINT:5432/fleet" | base64
   kubectl create secret generic fleet-db --from-literal=DATABASE_URL="postgresql://..." \
     --namespace=fleet -o yaml --dry-run=client | kubectl apply -f -
   ```

5. **Restart API pods** to pick up the new `DATABASE_URL`:
   ```bash
   kubectl rollout restart deployment/api -n fleet
   kubectl rollout restart deployment/worker -n fleet
   kubectl rollout restart deployment/ws -n fleet
   kubectl rollout status deployment/api -n fleet --timeout=120s
   ```

6. **Validate** — confirm the system is healthy on the new primary:
   ```bash
   # Health probes
    curl -s https://api.fleet.helixfleet.com/healthz
    curl -s https://api.fleet.helixfleet.com/readyz
    curl -s https://api.fleet.helixfleet.com/health/deep

   # Data integrity checks
   psql "postgresql://fleet:***@NEW-ENDPOINT:5432/fleet" -c "
     SELECT count(*) AS shifts FROM app.shifts;
     SELECT count(*) AS roles FROM app.roles;
     SELECT count(*) AS sessions FROM app.user_sessions WHERE revoked_at IS NULL;
   "
   ```

7. **Monitor** — watch CloudWatch for:
   - `DatabaseConnections` — should be stable.
   - `ReplicaLag` — the old primary, once repaired, should catch up as a new standby.
   - API 5xx rate (SLO A-01) — should be ≤ 0.1%.

8. **Repair the failed primary** — once the old primary is back online, restore it from backup
   (R-01) and re-attach it as a standby. Do NOT promote it back to primary without a deliberate
   failover and data verification.

9. **Document** — file a SEV-1 post-mortem. Incident classification and escalation is defined in
   `docs/architecture/02-open-risk-register.md` §C.

---

## R-07: Worker job failure / stuck outbox

**When to use:** Background jobs are failing (SLO A-04: ≥ 99% jobs succeed), or the outbox
backlog is growing (deep health probe shows `outbox_backlog > 1000`).

### Steps

1. **Assess** — check worker logs and outbox depth:
   ```bash
   kubectl logs -n fleet -l app=fleet-worker --tail=50

   psql "$DATABASE_URL" -c "
     SELECT event_type, priority, count(*) as count,
            max(occurred_at) as last_seen
     FROM app.outbox_events
     WHERE published_at IS NULL AND dead_lettered_at IS NULL
     GROUP BY event_type, priority
     ORDER BY last_seen DESC;
   "
   ```

2. **Check for dead-lettered events:**
   ```bash
   psql "$DATABASE_URL" -c "
     SELECT event_type, aggregate_type, aggregate_id, last_error, attempts
     FROM app.outbox_events
     WHERE dead_lettered_at IS NOT NULL
     ORDER BY dead_lettered_at DESC
     LIMIT 20;
   "
   ```

3. **Restart the worker** (idempotent jobs will retry):
   ```bash
   kubectl rollout restart deployment/worker -n fleet
   kubectl rollout status deployment/worker -n fleet --timeout=120s
   ```

4. **Re-run failed events manually** (if dead-lettered):
   ```bash
    # Update the outbox row to retry (clear dead_lettered_at, reset attempts)
    psql "$DATABASE_URL" -c "
      UPDATE app.outbox_events
      SET dead_lettered_at = NULL, attempts = 0, last_error = NULL
      WHERE dead_lettered_at IS NOT NULL
      AND event_type IN ('accident.created', 'shift.started')
      LIMIT 100;
    "
    ```

5. **Verify** — the outbox backlog should drain within minutes, and `/health/deep` should show
   `outbox_backlog` decreasing.

> **Note:** The `/health/deep` endpoint counts pending outbox events as those where
> `published_at IS NULL AND dead_lettered_at IS NULL`. If the probe reports `outbox_backlog`
> differently from the manual query above, verify the health check code in
> `packages/api/src/app/health.ts` matches the schema in `db/schema/03_platform_core.sql`.

---

## R-08: Security incident response

**When to use:** Suspected credential exposure, security breach, leaked token, suspected data
exfiltration, or a `SERVICE_UNAVAILABLE` / `401` / `403` spike that may indicate an attack.

**Severity:** Starts at SEV-1. Escalate immediately to `security@helixfleet.com` and the
on-call DevOps engineer.

### Steps

1. **Triage** — determine scope:
   - Check Sentry for unusual error patterns or spikes in `UNAUTHENTICATED` / `FORBIDDEN`.
   - Check CloudWatch for abnormal 4xx/5xx rates, request volumes from unknown IPs.
   - Check `audit_logs` for suspicious `LOGIN` / `CONFIG_CHANGE` / `DEVICE_REVOKE` entries.

2. **Contain** — stop the bleeding:
   - If a specific user's token is compromised, revoke their sessions:
     ```bash
     curl -X POST https://api.fleet.helixfleet.com/api/v1/sessions/revoke \
       -H "Authorization: Bearer <admin-token>" \
       -H "Idempotency-Key: <uuid>" \
       -H "Content-Type: application/json" \
       -d '{"user_id": "<compromised-user-id>"}'
     ```
   - If a device is compromised, revoke it:
     ```bash
     curl -X POST https://api.fleet.helixfleet.com/api/v1/devices/<deviceId>/revoke \
       -H "Authorization: Bearer <admin-token>" \
       -H "Idempotency-Key: <uuid>"
     ```
   - If the API key / JWT signing secret is compromised, rotate via the secret store
     (Vault/SSM) and restart the API pods (see R-04).

3. **Investigate** — review audit trail:
   ```sql
   -- Check for suspicious logins in the last 24h
   SELECT actor_user_id, ip_address, user_agent, occurred_at
   FROM audit.audit_logs
   WHERE action = 'LOGIN'
     AND occurred_at > now() - interval '24 hours'
   ORDER BY occurred_at DESC;
   ```

4. **Eradicate** — clean up:
   - Force a global sign-out for affected users (revoke all sessions).
   - If MFA was not enabled on a compromised account, require MFA enrolment (decision A3.7).

5. **Recover** — restore normal operations:
   - Confirm the system is healthy: `curl https://api.fleet.helixfleet.com/health/deep`
   - Confirm no unusual activity in CloudWatch/Sentry for 30 minutes.

6. **Document** — file a post-mortem. Security incidents are governed by
   `docs/security.md` §10 (Monitoring, response & resilience) and the Kenya DPA 2019 breach
   notification requirements (§7 of the privacy policy).

> **Legal notice:** Under the Kenya Data Protection Act 2019, personal data breaches must be
> reported to the Data Protection Commissioner within 72 hours if the breach is likely to
> result in a risk to the rights and freedoms of data subjects. Escalate to legal counsel.
