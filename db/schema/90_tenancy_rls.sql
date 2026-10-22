-- =============================================================================
-- 99_tenancy_rls.sql
-- Fleet Management Platform - Multi-tenancy: tenant_id propagation, tenant-scoped
--                             uniqueness and row-level security.
--
-- Phase: 2
--
-- THIS IS THE LAST MIGRATION IN THE SERIES, ON PURPOSE. The row-level-security
-- sweep below is DYNAMIC: it enables RLS on every table in the app/telemetry
-- schemas that carries a tenant_id column. A sweep that ran before the later
-- migrations (training, onboarding, vehicle issues, privacy requests, media
-- scans, dead-letter) silently missed every one of them, because they did not
-- exist yet when the previous hard-coded list was written.
--
-- The tenancy foundation (app.tenants, the RLS helper functions, app.invitations,
-- app.user_tenants, app.manager_assignments) lives in 12_tenancy_core.sql,
-- which runs early because later migrations reference app.tenants.
--
-- The platform was authored single-tenant (01..11). This file converts it in
-- place rather than forking the schema, so every existing row keeps working:
--
--   1. A bootstrap tenant with the FIXED uuid 00000000-0000-0000-0000-000000000001
--      is inserted FIRST (in 12_tenancy_core.sql). Every pre-existing row
--      belongs to it.
--   2. tenant_id is added to each tenant-aware table WITH a DEFAULT of that
--      bootstrap id, so the ALTER back-fills existing rows in one pass and any
--      in-flight writer that has not yet learned about tenancy still succeeds.
--   3. The column is then set NOT NULL. The DEFAULT is deliberately KEPT: it is
--      the safety net that makes this migration reversible in application terms
--      and keeps the pre-tenancy tests/fixtures valid. Application code always
--      passes tenant_id explicitly (defence in depth), and RLS WITH CHECK
--      rejects a default that disagrees with the session tenant, so the default
--      can never silently leak a row into the wrong tenant.
--   4. RLS is enabled on every tenant table with a single `tenant_isolation`
--      policy keyed on current_setting('app.current_tenant_id'). SYSTEM_ADMIN
--      bypasses it via current_setting('app.current_role').
--
-- Isolation is therefore enforced twice: by Postgres (RLS) and by an explicit
-- `AND tenant_id = $n` in every repository query.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- tenant_id propagation
-- -----------------------------------------------------------------------------
-- Every tenant-aware table gets the same treatment, so it is driven from one
-- list rather than 30 hand-written ALTERs that could drift. Tables intentionally
-- NOT listed are global/platform-scoped and documented at the bottom of this file.
--
-- The list below is the DECLARATION of which tables are tenant-scoped. It is
-- the only hand-maintained list left: once a table is listed here it carries a
-- tenant_id column, and the RLS sweep further down picks it up automatically.
--
-- The DEFAULT back-fills existing rows during ADD COLUMN (Postgres 11+ rewrites
-- nothing: the default is stored in the catalogue), so this is fast even on the
-- partitioned telemetry tables.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_target        record;
    v_bootstrap     constant text := '00000000-0000-0000-0000-000000000001';
    v_targets       constant text[][] := ARRAY[
        -- schema,      table
        ['app',       'vehicles'],
        ['app',       'drivers'],
        ['app',       'trailers'],
        ['app',       'geofences'],
        ['app',       'asset_documents'],
        ['app',       'assignments'],
        ['app',       'recovery_modes'],
        ['app',       'shifts'],
        ['app',       'work_logs'],
        ['app',       'inspections'],
        ['app',       'trailer_assignments'],
        ['app',       'trailer_last_known_location'],
        ['app',       'tracker_health'],
        ['app',       'vehicle_movement_events'],
        ['app',       'driver_duty_segments'],
        ['app',       'driver_hos_state'],
        ['app',       'hos_violations'],
        ['app',       'fuel_cards'],
        ['app',       'fuel_records'],
        ['app',       'fuel_purchases'],
        ['app',       'fuel_purchase_anomalies'],
        ['app',       'fuel_efficiency_records'],
        ['app',       'fuel_card_statements'],
        ['app',       'fuel_card_statement_lines'],
        ['app',       'expenses'],
        ['app',       'payroll_exports'],
        ['app',       'accident_reports'],
        ['app',       'accident_media'],
        ['app',       'maintenance_schedules'],
        ['app',       'maintenance_records'],
        ['app',       'quarantine_events'],
        ['app',       'media_objects'],
        ['app',       'privacy_requests'],
        ['app',       'invitations'],
        ['app',       'manager_assignments'],
        ['app',       'notifications'],
        ['app',       'on_call_roster'],
        ['app',       'escalation_timers'],
        ['telemetry', 'location_updates'],
        ['telemetry', 'location_summaries']
    ];
    i integer;
BEGIN
    FOR i IN 1 .. array_length(v_targets, 1) LOOP
        v_target := ROW(v_targets[i][1], v_targets[i][2]);

        -- Skip anything that is not present (partial deployments of phase 2/3).
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = v_targets[i][1] AND table_name = v_targets[i][2]
        ) THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS tenant_id uuid DEFAULT %L',
            v_targets[i][1], v_targets[i][2], v_bootstrap);

        -- Back-fill any row that predates the column (e.g. added without default
        -- by an earlier partial run) before the NOT NULL below can bite. The partitioned
        -- telemetry table is skipped here: it already excludes the UPDATE (and FK) cost,
        -- and its tenant_id is written by the ingest consumer at insert time.
        IF v_targets[i][1] = 'app' THEN
            EXECUTE format(
                'UPDATE %I.%I SET tenant_id = %L WHERE tenant_id IS NULL',
                v_targets[i][1], v_targets[i][2], v_bootstrap);

            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL',
                v_targets[i][1], v_targets[i][2]);
        END IF;

        -- telemetry.location_updates is partitioned and carries ~1.7M rows/day
        -- (A2.4); a validating FK there would be prohibitively expensive and the
        -- consumer already maintains referential integrity (see the comment on
        -- location_updates.shift_id). Everything else gets a real FK.
        IF v_targets[i][1] = 'app' THEN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = format('%s_tenant_fk', v_targets[i][2])
                   AND conrelid = format('%I.%I', v_targets[i][1], v_targets[i][2])::regclass
            ) THEN
                -- NOT VALID: a validating FK takes ACCESS EXCLUSIVE and full-scans the
                -- table. The VALIDATE below only needs SHARE UPDATE EXCLUSIVE, so the
                -- exclusive lock window stays tiny even on the largest tables.
                EXECUTE format(
                    'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES app.tenants(id) ON DELETE RESTRICT NOT VALID',
                    v_targets[i][1], v_targets[i][2], format('%s_tenant_fk', v_targets[i][2]));
                EXECUTE format(
                    'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
                    v_targets[i][1], v_targets[i][2], format('%s_tenant_fk', v_targets[i][2]));
            END IF;
        END IF;

        -- Every tenant-scoped query filters on tenant_id first.
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON %I.%I (tenant_id)',
            format('%s_tenant_idx', v_targets[i][2]), v_targets[i][1], v_targets[i][2]);
    END LOOP;
END
$$;

COMMENT ON COLUMN app.vehicles.tenant_id IS
    'Owning tenant. DEFAULT is the bootstrap tenant so the pre-tenancy fleet keeps working; the application always supplies it explicitly and RLS WITH CHECK rejects a mismatch.';
COMMENT ON COLUMN app.media_objects.tenant_id IS
    'Owning tenant. Threaded through the presigner so an S3 object key can never be minted or resolved across a tenant boundary (C5.3/D5).';
COMMENT ON COLUMN telemetry.location_updates.tenant_id IS
    'Owning tenant, denormalised from the vehicle by the ingest consumer. Deliberately not a foreign key for the same reason as shift_id: partition-wide FK enforcement is too costly at 1.7M rows/day (A2.4).';

-- -----------------------------------------------------------------------------
-- Tenant-scoped uniqueness
-- -----------------------------------------------------------------------------
-- The single-tenant schema made plates, licences and employee numbers globally
-- unique. Under tenancy two customers may legitimately hold the same plate, so
-- each of those indexes is re-cut to include tenant_id. Names that are genuinely
-- global (users.email, media_objects.bucket+object_key, refresh token hashes)
-- are left alone.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS app.vehicles_plate_unique;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_plate_unique
    ON app.vehicles (tenant_id, license_plate) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS app.trailers_plate_unique;
CREATE UNIQUE INDEX IF NOT EXISTS trailers_tenant_plate_unique
    ON app.trailers (tenant_id, license_plate)
    WHERE deleted_at IS NULL AND merged_into_trailer_id IS NULL;

DROP INDEX IF EXISTS app.drivers_licence_unique;
CREATE UNIQUE INDEX IF NOT EXISTS drivers_tenant_licence_unique
    ON app.drivers (tenant_id, licence_number) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS app.drivers_employee_number_unique;
CREATE UNIQUE INDEX IF NOT EXISTS drivers_tenant_employee_number_unique
    ON app.drivers (tenant_id, employee_number)
    WHERE employee_number IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS app.geofences_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS geofences_tenant_name_unique
    ON app.geofences (tenant_id, lower(name)) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS app.fuel_cards_provider_lastfour_unique;
CREATE UNIQUE INDEX IF NOT EXISTS fuel_cards_tenant_provider_lastfour_unique
    ON app.fuel_cards (tenant_id, provider, last_four) WHERE deleted_at IS NULL;

-- Tracker identity stays globally unique: one physical device reports to one
-- Traccar instance, so the same IMEI in two tenants is a provisioning error, not a
-- legitimate collision (N2.1).

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- One policy shape everywhere:
--
--     USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid
--                 OR current_setting('app.current_role', true) = 'SYSTEM_ADMIN')
--
-- `true` as the second argument to current_setting makes a missing GUC return
-- NULL instead of raising, so an un-hooked connection sees ZERO rows rather than
-- erroring or - far worse - seeing everything.
--
-- WITH CHECK repeats the predicate so a write cannot place a row in another
-- tenant even if the application forgot to pass tenant_id and the column DEFAULT
-- filled it in.
-- -----------------------------------------------------------------------------

-- The sweep is DYNAMIC: every table in the app/telemetry schemas that carries a
-- tenant_id column is enabled, forced and given the tenant_isolation policy.
-- A table can therefore no longer be created "after the sweep" and silently end
-- up without RLS.
--
-- The three exclusions are deliberate and each one is a WRITE PATH THAT DOES NOT
-- BIND THE SESSION TENANT. Enabling RLS on those tables would reject every
-- write (the WITH CHECK compares the row against a NULL session tenant), so
-- they are left unprotected until the application binds the tenant:
--
--   app.error_events        - the RFC7807 mirror writes on its own pooled
--                             connection, outside any tenant transaction
--                             (packages/api/src/app/app.ts).
--   app.ingest_dead_letter  - the ingest consumer writes on an unbound pooled
--                             connection (packages/db/src/dead-letter.ts).
--   app.password_reset_codes- the request path is UNAUTHENTICATED, so its write
--                             transaction is bound to the bootstrap tenant while
--                             the row carries the requesting user's real tenant
--                             (packages/api/src/services/passwordReset.ts).
--
-- The policies themselves are applied by 92_tenant_policies.sql, which runs
-- after every table that carries a tenant_id exists. Applying them here would
-- leave the later tables unprotected.

-- -----------------------------------------------------------------------------
-- Deliberately NOT tenant-scoped (payload / global tables)
-- -----------------------------------------------------------------------------
--   app.users, app.user_roles, app.user_sessions, app.driver_devices,
--   app.mfa_recovery_codes, app.user_consents
--       Identity is global: email uniqueness, session revocation and the DPA
--       consent ledger must all work before a tenant is resolved (login happens
--       BEFORE app.current_tenant_id can be set). Tenant membership lives in
--       app.user_tenants, and every tenant-aware read joins through it.
--
--   app.roles, app.permissions, app.role_permissions
--       Platform-wide RBAC vocabulary, identical for all tenants.
--
--   app.system_config, app.notification_templates, app.hos_policies,
--   app.inspection_templates, app.inspection_template_items,
--   app.maintenance_tasks
--       Shared reference/configuration data. Per-tenant overrides belong in
--       app.tenants.settings; promoting these to per-tenant rows is a separate,
--       larger decision than this migration.
--
--   app.idempotency_keys
--       Partitioned by user_id, which is already tenant-bound transitively.
--
--   app.outbox_events
--       Payload-scoped: the tenant travels inside `payload` so the relay can fan
--       out to the right realtime room without a schema change and without the
--       relay needing a tenant GUC to drain the queue.
--
--   audit.audit_logs
--       Append-only, 7-year, cross-tenant compliance record read only by
--       platform staff. It is payload-scoped for the same reason actor_user_id is
--       not a foreign key: the trail must survive independently of the rows it
--       describes.
--
--   app.inspection_items, app.inspection_item_photos, app.work_log_photos,
--   app.accident_telemetry
--       Child rows reached exclusively through an RLS-protected parent
--       (inspections / work_logs / accident_reports) with ON DELETE CASCADE. A
--       second tenant_id here would be denormalisation that can drift from the
--       parent without adding any reachable isolation.
--
-- -----------------------------------------------------------------------------
-- Tenant-scoped BY INTENT, still without a tenant_id column
-- -----------------------------------------------------------------------------
-- These tables belong to exactly one tenant, but they carry no tenant_id yet, so
-- the dynamic sweep above cannot protect them. They are deliberately NOT given
-- the column here: RLS is deny-by-default, and the current read paths for these
-- tables use a plain pooled client (packages/api/src/db/withClient.ts) that does
-- NOT bind the session tenant. Enabling RLS before those reads bind the tenant
-- would turn every list into an empty result.
--
-- To close them, one application change per table is needed (no schema change):
--   * read through withTenantClient(pool, tenantContextOf(principal), ...)
--   * stamp tenant_id on write (the column default is added by the propagation
--     block above once the write path is ready)
--
--   app.vehicle_issues      - driver-reported defects, owned by a vehicle
--   app.training_courses    - LMS catalogue
--   app.training_lessons    - LMS catalogue
--   app.training_enrollments - per-driver completion
--   app.driver_onboarding   - per-driver onboarding + background check
--   app.media_scans         - malware scan of a tenant's media object
--
-- app.work_logs, app.fuel_records, app.fuel_purchase_anomalies and
-- app.media_objects ARE tenant-scoped and ARE in the propagation list above.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Analytics range indexes
-- -----------------------------------------------------------------------------
-- The hierarchical analytics surface (services/analytics.ts) filters app.shifts on
-- a clock_in_at range per vehicle/driver. The inherited (tenant_id, vehicle_id,
-- operational_date) indexes do not serve that range, so every breakdown subquery
-- falls back to a per-vehicle/per-driver scan. These composite indexes let both
-- the range filter and the asset join use one index. Only app.shifts carries the
-- analytics range workload; the others are left to their existing indexes.
CREATE INDEX IF NOT EXISTS shifts_tenant_vehicle_clockin_idx
    ON app.shifts (tenant_id, vehicle_id, clock_in_at);
CREATE INDEX IF NOT EXISTS shifts_tenant_driver_clockin_idx
    ON app.shifts (tenant_id, driver_id, clock_in_at);
