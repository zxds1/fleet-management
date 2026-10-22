-- =============================================================================
-- 12_tenancy_core.sql
-- Fleet Management Platform - Multi-tenancy: tenant registry, the admin-invite
--                             provisioning ledger, tenant membership and
--                             super-admin manager assignment.
--
-- Phase: 2
--
-- This file is the tenancy FOUNDATION. It runs early (position 12) because later
-- migrations reference app.tenants (20_privacy_requests.sql, 22_password_reset.sql)
-- and the RLS helper functions.
--
-- The platform was authored single-tenant (01..11). These files convert it in
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
-- Steps 1-3 live in 99_tenancy_rls.sql, which is the LAST migration in the
-- series: the row-level-security sweep must see every tenant-scoped table in
-- the schema, including the ones created after this file.
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
-- RLS helper functions
-- -----------------------------------------------------------------------------
-- Defined here (not in 99_tenancy_rls.sql) because a policy expression is parsed
-- at CREATE POLICY time: any migration that creates a tenant_isolation policy
-- before the sweep runs needs these functions to already exist.
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
