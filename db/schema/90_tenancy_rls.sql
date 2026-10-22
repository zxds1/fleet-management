-- =============================================================================
-- 14_tenancy.sql
-- Fleet Management Platform - Multi-tenancy: tenant registry, tenant_id on every
--                             tenant-aware table, row-level security, the
--                             admin-invite provisioning ledger, and super-admin
--                             manager assignment.
--
-- Phase: 2
--
-- The platform was authored single-tenant (01..13). This file converts it in
-- place rather than forking the schema, so every existing row keeps working:
--
--   1. A bootstrap tenant with the FIXED uuid 00000000-0000-0000-0000-000000000001
--      is inserted FIRST. Every pre-existing row belongs to it.
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
-- Enums
-- -----------------------------------------------------------------------------

-- Lifecycle of a tenant's subscription. SUSPENDED/EXPIRED keep the data intact
-- and readable by a SYSTEM_ADMIN while blocking normal sign-in.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'tenant_status' AND n.nspname = 'app') THEN
        CREATE TYPE app.tenant_status AS ENUM (
            'ACTIVE',
            'SUSPENDED',   -- billing or compliance hold; sign-in refused
            'TRIAL',
            'EXPIRED'
        );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'subscription_tier' AND n.nspname = 'app') THEN
        CREATE TYPE app.subscription_tier AS ENUM (
            'BASIC',
            'PROFESSIONAL',
            'ENTERPRISE'
        );
    END IF;
END
$$;

-- SYSTEM_ADMIN is the cross-tenant operator role (platform staff). It is the only
-- role permitted to bypass tenant_isolation, and it is never granted to a tenant
-- user by the invite flow.
ALTER TYPE app.role_code ADD VALUE IF NOT EXISTS 'SYSTEM_ADMIN';

-- Tenancy lifecycle audit actions. These are what the tenant-provisioning and RBAC
-- routes write to audit.audit_logs (self-signup, invite, accept, role grant/revoke,
-- manager scope changes); without them those writes would fail the enum check.
ALTER TYPE app.audit_action ADD VALUE IF NOT EXISTS 'TENANT_CREATE';
ALTER TYPE app.audit_action ADD VALUE IF NOT EXISTS 'MEMBERSHIP_GRANT';
ALTER TYPE app.audit_action ADD VALUE IF NOT EXISTS 'MEMBERSHIP_REVOKE';
ALTER TYPE app.audit_action ADD VALUE IF NOT EXISTS 'INVITATION_CREATE';
ALTER TYPE app.audit_action ADD VALUE IF NOT EXISTS 'SCOPE_ASSIGN';

-- -----------------------------------------------------------------------------
-- app.tenants
-- -----------------------------------------------------------------------------
-- One row per customer fleet. max_vehicles / max_drivers are the subscription
-- quota enforced by the application at asset-creation time; settings holds the
-- per-tenant overrides that would otherwise pollute app.system_config.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.tenants (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL CHECK (btrim(name) <> ''),
    slug                text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    status              app.tenant_status NOT NULL DEFAULT 'TRIAL',
    subscription_tier   app.subscription_tier NOT NULL DEFAULT 'BASIC',

    max_vehicles        integer NOT NULL DEFAULT 25 CHECK (max_vehicles > 0),
    max_drivers         integer NOT NULL DEFAULT 50 CHECK (max_drivers > 0),

    settings            jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique
    ON app.tenants (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tenants_status_idx
    ON app.tenants (status) WHERE deleted_at IS NULL;

COMMENT ON TABLE app.tenants IS
    'Customer fleet registry. Every tenant-aware table carries tenant_id REFERENCES app.tenants(id) and is protected by the tenant_isolation RLS policy.';
COMMENT ON COLUMN app.tenants.slug IS
    'URL/subdomain-safe unique handle. Used for tenant-scoped Redis key prefixes and realtime rooms only via id, never as an authorisation input.';
COMMENT ON COLUMN app.tenants.max_vehicles IS
    'Subscription quota. Enforced in the application at vehicle onboarding, not by a constraint, so an over-quota tenant is never left with unreadable rows.';

-- -----------------------------------------------------------------------------
-- Bootstrap tenant  (MUST precede every ALTER ... ADD COLUMN tenant_id below)
-- -----------------------------------------------------------------------------
-- Fixed uuid so migrations, seeds, fixtures and tests all agree on the identity
-- of "the fleet that existed before tenancy". Exported from @fleet/shared as
-- BOOTSTRAP_TENANT_ID.
-- -----------------------------------------------------------------------------
INSERT INTO app.tenants (id, name, slug, status, subscription_tier, max_vehicles, max_drivers)
VALUES ('00000000-0000-0000-0000-000000000001',
        'Bootstrap Fleet',
        'bootstrap',
        'ACTIVE',
        'ENTERPRISE',
        100000,
        100000)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- tenant_id propagation
-- -----------------------------------------------------------------------------
-- Every tenant-aware table gets the same treatment, so it is driven from one
-- list rather than 30 hand-written ALTERs that could drift. Tables intentionally
-- NOT listed are global/platform-scoped and documented at the bottom of this file.
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
-- Traccar instance, so the same IMEI in two tenants is a provisioning error, not
-- a legitimate collision (N2.1).

-- -----------------------------------------------------------------------------
-- app.invitations  (admin-invite manager provisioning)
-- -----------------------------------------------------------------------------
-- An ADMIN invites a FLEET_MANAGER (or another ADMIN) into their own tenant. The
-- returned token is the only credential the invitee needs to set a password; it
-- is single-use (accepted_at) and time-boxed (expires_at). The invitation itself
-- is tenant-scoped, which is what binds the created user to the inviter's tenant
-- rather than to a client-supplied tenant id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

    email           citext NOT NULL,
    role_code       app.role_code NOT NULL,

    invited_by      uuid REFERENCES app.users(id),
    token           uuid NOT NULL DEFAULT gen_random_uuid(),

    accepted_at     timestamptz,
    accepted_user_id uuid REFERENCES app.users(id),
    revoked_at      timestamptz,

    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT invitations_acceptance_complete
        CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL)),
    -- Only management roles are invitable. Drivers are onboarded with a driver
    -- profile through the admin console, not through a self-service password set.
    CONSTRAINT invitations_role_is_invitable
        CHECK (role_code IN ('FLEET_MANAGER','ADMIN','DISPATCHER','FINANCE','AUDITOR'))
);

CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_unique
    ON app.invitations (token);
-- One live invitation per email per tenant; re-inviting supersedes rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
    ON app.invitations (tenant_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS invitations_tenant_idx ON app.invitations (tenant_id);
CREATE INDEX IF NOT EXISTS invitations_expiry_idx
    ON app.invitations (expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE app.invitations IS
    'Admin-invite provisioning ledger. The tenant of the invitation - never a request field - decides which tenant the accepted user lands in.';
COMMENT ON COLUMN app.invitations.token IS
    'Single-use activation token returned to the inviting Admin. POST /auth/accept-invite exchanges it for a password-backed account.';

-- -----------------------------------------------------------------------------
-- app.user_tenants  (which tenant a user belongs to)
-- -----------------------------------------------------------------------------
-- app.users stays global so email uniqueness, sessions and the audit trail keep
-- their existing semantics. Tenant membership is a separate row, which also
-- leaves the door open for a future support user who spans tenants without
-- rewriting the users table.
--
-- A SYSTEM_ADMIN legitimately has no membership row; their principal resolves to
-- the bootstrap tenant and RLS is bypassed by app.current_role.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.user_tenants (
    user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
    is_primary  boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_tenants_one_primary
    ON app.user_tenants (user_id) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS user_tenants_tenant_idx ON app.user_tenants (tenant_id);

-- Every pre-tenancy user belongs to the bootstrap tenant.
INSERT INTO app.user_tenants (user_id, tenant_id, is_primary)
SELECT u.id, '00000000-0000-0000-0000-000000000001', true
  FROM app.users u
ON CONFLICT (user_id, tenant_id) DO NOTHING;

COMMENT ON TABLE app.user_tenants IS
    'Tenant membership. Resolved at login and stamped into the JWT as the `tid` claim; the API never accepts a tenant id from the client.';

-- -----------------------------------------------------------------------------
-- app.manager_assignments  (super-admin driver/vehicle assignment)
-- -----------------------------------------------------------------------------
-- Scopes a FLEET_MANAGER to a subset of the tenant's fleet. A row names exactly
-- one subject (a vehicle or a driver), which keeps real foreign keys instead of a
-- polymorphic target column and lets the read path use two cheap index scans.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.manager_assignments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,

    vehicle_id  uuid REFERENCES app.vehicles(id) ON DELETE CASCADE,
    driver_id   uuid REFERENCES app.drivers(id) ON DELETE CASCADE,

    assigned_by uuid REFERENCES app.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT manager_assignments_exactly_one_subject CHECK (
        (vehicle_id IS NOT NULL)::int + (driver_id IS NOT NULL)::int = 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS manager_assignments_vehicle_unique
    ON app.manager_assignments (user_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manager_assignments_driver_unique
    ON app.manager_assignments (user_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS manager_assignments_tenant_idx
    ON app.manager_assignments (tenant_id);
CREATE INDEX IF NOT EXISTS manager_assignments_user_idx
    ON app.manager_assignments (user_id);

COMMENT ON TABLE app.manager_assignments IS
    'Super-admin scoping of a manager to specific vehicles/drivers within one tenant. Absence of rows means tenant-wide visibility.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tenants_set_updated_at ON app.tenants;
CREATE TRIGGER tenants_set_updated_at
    BEFORE UPDATE ON app.tenants
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

DROP TRIGGER IF EXISTS tenants_no_hard_delete ON app.tenants;
CREATE TRIGGER tenants_no_hard_delete
    BEFORE DELETE ON app.tenants
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

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

-- Resolves the session tenant. STABLE + explicit search_path so it is safe to
-- call from a policy.
CREATE OR REPLACE FUNCTION app.fn_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = app, pg_catalog
AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.fn_current_tenant_id() IS
    'Session tenant, set by the API via SET LOCAL app.current_tenant_id at the start of every request transaction. NULL when unset, which makes RLS deny-by-default.';

-- True when the session is a platform operator, who reads across tenants.
CREATE OR REPLACE FUNCTION app.fn_is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = app, pg_catalog
AS $$
    SELECT coalesce(current_setting('app.current_role', true), '') = 'SYSTEM_ADMIN'
$$;

COMMENT ON FUNCTION app.fn_is_system_admin() IS
    'SYSTEM_ADMIN RLS bypass. Set by the API via SET LOCAL app.current_role only when the verified JWT carries the SYSTEM_ADMIN role; it is never derived from a request field.';

DO $$
DECLARE
    v_targets constant text[][] := ARRAY[
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
        ['app',       'notifications'],
        ['app',       'on_call_roster'],
        ['app',       'escalation_timers'],
        ['app',       'invitations'],
        ['app',       'manager_assignments'],
        ['app',       'user_tenants'],
        ['telemetry', 'location_updates'],
        ['telemetry', 'location_summaries']
    ];
    i integer;
BEGIN
    FOR i IN 1 .. array_length(v_targets, 1) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = v_targets[i][1] AND table_name = v_targets[i][2]
        ) THEN
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                       v_targets[i][1], v_targets[i][2]);
        -- Applies the policy to the table owner too. Without this the API's own
        -- role (which owns the schema in most deployments) would silently skip RLS.
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                       v_targets[i][1], v_targets[i][2]);

        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
                       v_targets[i][1], v_targets[i][2]);
        EXECUTE format($p$
            CREATE POLICY tenant_isolation ON %I.%I
                USING (tenant_id = app.fn_current_tenant_id() OR app.fn_is_system_admin())
                WITH CHECK (tenant_id = app.fn_current_tenant_id() OR app.fn_is_system_admin())
        $p$, v_targets[i][1], v_targets[i][2]);
    END LOOP;
END
$$;

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
