-- =============================================================================
-- 02_identity.sql
-- Fleet Management Platform - Users, roles, permissions, devices, drivers
--
-- Decisions: A3.7, B12, B13, B16(superseded), C6.1, C6.2, C6.4, C5.5, N4, M4
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.users
-- -----------------------------------------------------------------------------
-- N4: role membership lives in app.user_roles, not on this table. A user may
-- hold several roles simultaneously and permissions are combined by union.
--
-- Drivers sign in with a phone number (unique); admins self-register with an
-- email. Either identifier may be null, but exactly one is required per role:
-- drivers carry `phone`, admins carry `email`. MFA is OPTIONAL and opt-in only
-- (enrolled via /auth/mfa/enroll); nothing here forces it.
-- -----------------------------------------------------------------------------
CREATE TABLE app.users (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   citext,                       -- admins; null for phone-only drivers
    password_hash           text NOT NULL,               -- argon2id
    full_name               text NOT NULL CHECK (btrim(full_name) <> ''),
    phone                   app.phone_e164 UNIQUE,        -- drivers; null for email-only admins
    is_active               boolean NOT NULL DEFAULT true,

    -- A3.7: TOTP MFA is OPTIONAL and opt-in. The flag records enrolment state only.
    mfa_enabled             boolean NOT NULL DEFAULT false,
    mfa_secret_encrypted    bytea,                       -- AES-GCM via KMS data key
    mfa_enrolled_at         timestamptz,

    -- C6.4: per-user quiet hours. CRITICAL notifications always break through.
    dnd_start_local         time,
    dnd_end_local           time,

    -- A2.6: driver app is bilingual; admin app is English only.
    locale                  text NOT NULL DEFAULT 'en'
                            CHECK (locale IN ('en', 'sw')),

    failed_login_count      integer NOT NULL DEFAULT 0,
    locked_until            timestamptz,
    last_login_at           timestamptz,
    password_changed_at     timestamptz NOT NULL DEFAULT now(),

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    CONSTRAINT users_mfa_consistent
        CHECK ((mfa_enabled = false) OR (mfa_secret_encrypted IS NOT NULL)),
    CONSTRAINT users_dnd_pair
        CHECK ((dnd_start_local IS NULL) = (dnd_end_local IS NULL)),
    CONSTRAINT users_contact_required
        CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Email uniqueness applies only to live rows (D3 soft delete) and only when present.
CREATE UNIQUE INDEX users_email_unique
    ON app.users (email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX users_phone_idx ON app.users (phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE INDEX users_full_name_trgm
    ON app.users USING gin (full_name gin_trgm_ops);

COMMENT ON TABLE  app.users IS 'System users. Drivers authenticate by phone, admins by email.';
COMMENT ON COLUMN app.users.mfa_secret_encrypted IS 'TOTP seed, AES-GCM encrypted with a KMS data key. Never returned by the API.';

-- -----------------------------------------------------------------------------
-- app.roles / app.permissions / app.role_permissions / app.user_roles
-- N4, C6.1, C6.2
-- -----------------------------------------------------------------------------
CREATE TABLE app.roles (
    code            app.role_code PRIMARY KEY,
    name            text NOT NULL,
    description     text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.permissions (
    code            text PRIMARY KEY CHECK (code ~ '^[a-z_]+:[a-z_]+$'),
    description     text NOT NULL,
    phase           smallint NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 3)
);

COMMENT ON COLUMN app.permissions.phase IS
    'Delivery phase the permission belongs to (A2.7). Phase 2/3 permissions are seeded but unused until then.';

CREATE TABLE app.role_permissions (
    role_code       app.role_code NOT NULL REFERENCES app.roles(code) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES app.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE app.user_roles (
    user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    role_code       app.role_code NOT NULL REFERENCES app.roles(code) ON DELETE RESTRICT,
    granted_by      uuid REFERENCES app.users(id),
    granted_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_code)
);

CREATE INDEX user_roles_role_idx ON app.user_roles (role_code);

COMMENT ON TABLE app.user_roles IS
    'Many-to-many role membership. Effective permissions are the UNION across all roles held (C6.2/N4).';

-- -----------------------------------------------------------------------------
-- app.mfa_recovery_codes  (A3.7)
-- -----------------------------------------------------------------------------
CREATE TABLE app.mfa_recovery_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    code_hash   text NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mfa_recovery_codes_user_idx
    ON app.mfa_recovery_codes (user_id) WHERE used_at IS NULL;

-- -----------------------------------------------------------------------------
-- app.user_sessions  (A1.6)
-- -----------------------------------------------------------------------------
-- Live session state is held in Redis. This table exists so that revocation and
-- concurrent-session enforcement remain auditable after a Redis flush.
-- -----------------------------------------------------------------------------
CREATE TABLE app.user_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    refresh_token_hash  text NOT NULL,
    ip_address          inet,
    user_agent          text,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    revoked_reason      text,
    last_seen_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_sessions_expiry_after_issue CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX user_sessions_token_unique ON app.user_sessions (refresh_token_hash);
CREATE INDEX user_sessions_active_idx
    ON app.user_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

COMMENT ON TABLE app.user_sessions IS
    'Admin/web sessions. A1.6 caps concurrent live sessions at 10 per user (enforced in Redis, audited here).';

-- -----------------------------------------------------------------------------
-- app.driver_devices  (B13, N9)
-- -----------------------------------------------------------------------------
-- A driver may sign in from any phone (the account is not bound to a device), so
-- the device record exists only to deliver push notifications and to support
-- remote revocation (B13). No PIN, no device-bound offline refresh path.
-- -----------------------------------------------------------------------------
CREATE TABLE app.driver_devices (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    device_id_hash              text NOT NULL,
    device_label                text,
    device_model                text,
    os_version                  text,
    app_version                 text,

    -- N9: FCM direct, not the Expo relay.
    push_token                  text,
    push_provider               text NOT NULL DEFAULT 'FCM'
                                CHECK (push_provider IN ('FCM')),
    push_token_updated_at       timestamptz,

    biometric_enrolled          boolean NOT NULL DEFAULT false,

    last_seen_online_at         timestamptz,
    revoked_at                  timestamptz,
    revoked_by                  uuid REFERENCES app.users(id),
    revoked_reason              text,

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX driver_devices_user_device_unique
    ON app.driver_devices (user_id, device_id_hash) WHERE revoked_at IS NULL;
CREATE INDEX driver_devices_user_idx ON app.driver_devices (user_id);

-- -----------------------------------------------------------------------------
-- app.drivers  (N4, B16, C3.10)
-- -----------------------------------------------------------------------------
-- Optional 1:1 profile on a user. A FLEET_MANAGER acting as relief driver simply
-- gains a drivers row plus the DRIVER role; no separate login is required.
--
-- Licence and medical expiry are duplicated into app.asset_documents by the
-- document worker so a single expiry engine covers vehicles, trailers and people
-- (C3.10). The columns here are the fast-path copy used at clock-in.
-- -----------------------------------------------------------------------------
CREATE TABLE app.drivers (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     uuid NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE RESTRICT,
    employee_number             text,
    licence_number              text,                       -- optional at creation; completed after approval
    licence_class               text,
    licence_expiry              date,
    medical_certificate_expiry  date,

    emergency_contact_name      text,
    emergency_contact_phone     app.phone_e164,

    -- C3.2: optional per-driver override of the global HOS policy. Audited.
    hos_policy_id               uuid,          -- FK added in 05_telemetry_hos.sql
    hos_override_reason         text,
    hos_override_by             uuid REFERENCES app.users(id),
    hos_override_at             timestamptz,

    status                      app.driver_status NOT NULL DEFAULT 'ACTIVE',
    status_changed_at           timestamptz NOT NULL DEFAULT now(),
    hired_on                    date,

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    deleted_at                  timestamptz,

    CONSTRAINT drivers_hos_override_complete
        CHECK ((hos_policy_id IS NULL) OR (hos_override_reason IS NOT NULL AND hos_override_by IS NOT NULL))
);

CREATE UNIQUE INDEX drivers_licence_unique
    ON app.drivers (licence_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX drivers_employee_number_unique
    ON app.drivers (employee_number) WHERE employee_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX drivers_status_idx ON app.drivers (status) WHERE deleted_at IS NULL;

COMMENT ON TABLE app.drivers IS
    'Driver profile, 1:1 optional on users (N4). shifts.driver_id references this table.';

-- -----------------------------------------------------------------------------
-- app.user_consents  (C5.5)
-- -----------------------------------------------------------------------------
-- The Kenya DPA 2019 consent record. GPS_TRACKING_WORKING_HOURS must be present
-- and unrevoked before a driver can open a shift; the clock-in service enforces it.
-- -----------------------------------------------------------------------------
CREATE TABLE app.user_consents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    consent_type    app.consent_type NOT NULL,
    policy_version  text NOT NULL,
    accepted_at     timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,
    ip_address      inet,
    user_agent      text,
    device_id_hash  text
);

CREATE UNIQUE INDEX user_consents_active_unique
    ON app.user_consents (user_id, consent_type, policy_version)
    WHERE revoked_at IS NULL;
CREATE INDEX user_consents_user_idx ON app.user_consents (user_id, consent_type);

COMMENT ON TABLE app.user_consents IS
    'Kenya Data Protection Act 2019 consent ledger (C5.5). Required before a first shift.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON app.users
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

CREATE TRIGGER users_no_hard_delete
    BEFORE DELETE ON app.users
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER drivers_set_updated_at
    BEFORE UPDATE ON app.drivers
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

CREATE TRIGGER drivers_no_hard_delete
    BEFORE DELETE ON app.drivers
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER driver_devices_set_updated_at
    BEFORE UPDATE ON app.driver_devices
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

-- Consent is an append-only legal record; revocation is a column update only.
CREATE TRIGGER user_consents_no_hard_delete
    BEFORE DELETE ON app.user_consents
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();
