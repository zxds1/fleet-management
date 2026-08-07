-- =============================================================================
-- 03_platform_core.sql
-- Fleet Management Platform - Media registry, runtime configuration,
--                             idempotency store, transactional outbox
--
-- Decisions: C2.4, C5.1, C5.2, C5.3, D4, D5, D7, D8
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.media_objects  (C5.3, D5)
-- -----------------------------------------------------------------------------
-- Single registry for every uploaded binary. Domain tables reference this table
-- rather than carrying loose object keys, so that:
--   * the retention worker has exactly one place to enumerate expiring evidence;
--   * S3 Object Lock placement is decided by retention_class at upload time;
--   * legal hold can freeze deletion of a specific accident's evidence.
--
-- No public read access ever. The API mints 60-second pre-signed URLs (D5).
-- -----------------------------------------------------------------------------
CREATE TABLE app.media_objects (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    bucket                  text NOT NULL,
    object_key              text NOT NULL,
    content_type            text NOT NULL,
    size_bytes              bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
    sha256                  bytea,

    -- C5.3: retention_class determines retain_until and Object Lock placement.
    retention_class         app.retention_class NOT NULL,
    retain_until            date NOT NULL,
    legal_hold              boolean NOT NULL DEFAULT false,
    object_lock_applied     boolean NOT NULL DEFAULT false,

    -- Back-reference. owner_id is nullable because the object is uploaded before
    -- the owning row is created in the same transaction (multipart clock-in).
    owner_kind              app.media_owner_kind NOT NULL,
    owner_id                uuid,

    uploaded_by             uuid REFERENCES app.users(id),
    uploaded_at             timestamptz NOT NULL DEFAULT now(),

    -- Client-reported capture instant. Informational only: C5.2 makes the server
    -- timestamp authoritative and strips EXIF, so this cannot be trusted as evidence.
    client_captured_at      timestamptz,
    exif_stripped           boolean NOT NULL DEFAULT true,
    width_px                integer,
    height_px               integer,

    checksum_verified_at    timestamptz,
    deleted_at              timestamptz,
    delete_reason           text,

    CONSTRAINT media_objects_lock_requires_accident
        CHECK (object_lock_applied = false OR retention_class = 'ACCIDENT'),
    CONSTRAINT media_objects_no_delete_under_hold
        CHECK (NOT (legal_hold = true AND deleted_at IS NOT NULL))
);

CREATE UNIQUE INDEX media_objects_location_unique
    ON app.media_objects (bucket, object_key);
CREATE INDEX media_objects_owner_idx
    ON app.media_objects (owner_kind, owner_id);
CREATE INDEX media_objects_retention_sweep_idx
    ON app.media_objects (retain_until)
    WHERE deleted_at IS NULL AND legal_hold = false;
CREATE INDEX media_objects_orphan_idx
    ON app.media_objects (uploaded_at)
    WHERE owner_id IS NULL AND deleted_at IS NULL;

COMMENT ON TABLE app.media_objects IS
    'Registry of every uploaded binary. Retention (C5.3) and Object Lock (D5) are driven from here.';
COMMENT ON COLUMN app.media_objects.client_captured_at IS
    'Untrusted client clock. C5.2 makes uploaded_at (server time) the evidential timestamp.';

CREATE TRIGGER media_objects_no_hard_delete
    BEFORE DELETE ON app.media_objects
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

-- -----------------------------------------------------------------------------
-- app.system_config  (C2.4)
-- -----------------------------------------------------------------------------
-- Every threshold in the platform lives here. There are no magic numbers in
-- application code. Changes are captured by the audit interceptor.
-- -----------------------------------------------------------------------------
CREATE TABLE app.system_config (
    key             text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    value           jsonb NOT NULL,
    value_type      text NOT NULL CHECK (value_type IN ('number','string','boolean','json','array')),
    description     text NOT NULL,
    min_value       numeric,
    max_value       numeric,
    unit            text,
    is_sensitive    boolean NOT NULL DEFAULT false,
    phase           smallint NOT NULL DEFAULT 1 CHECK (phase BETWEEN 1 AND 3),
    updated_by      uuid REFERENCES app.users(id),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.system_config IS
    'Runtime-tunable thresholds (C2.4). Admin-editable; every change is audited.';
COMMENT ON COLUMN app.system_config.is_sensitive IS
    'Sensitive values are redacted in API responses and in audit_logs.';

CREATE TRIGGER system_config_no_hard_delete
    BEFORE DELETE ON app.system_config
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

-- -----------------------------------------------------------------------------
-- app.idempotency_keys  (C5.1, D4)
-- -----------------------------------------------------------------------------
-- The offline queue retries every 30 s. Without this table the platform would
-- create duplicate shifts and duplicate fuel purchases. Every state-changing
-- endpoint requires an Idempotency-Key header; a replay returns the stored
-- response verbatim.
--
-- request_hash guards against a client reusing a key with a different body,
-- which must be rejected with 422 rather than silently returning a stale result.
-- -----------------------------------------------------------------------------
CREATE TABLE app.idempotency_keys (
    user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    idempotency_key uuid NOT NULL,
    endpoint        text NOT NULL,
    request_hash    text NOT NULL,

    state           text NOT NULL DEFAULT 'IN_PROGRESS'
                    CHECK (state IN ('IN_PROGRESS','COMPLETED','FAILED')),
    response_status smallint,
    response_body   jsonb,
    resource_id     uuid,

    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

    PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX idempotency_keys_expiry_idx ON app.idempotency_keys (expires_at);
CREATE INDEX idempotency_keys_stuck_idx
    ON app.idempotency_keys (created_at) WHERE state = 'IN_PROGRESS';

COMMENT ON TABLE app.idempotency_keys IS
    'C5.1/D4. Retention is 30 days, comfortably beyond the 24-hour offline ceiling (B13).';

-- -----------------------------------------------------------------------------
-- app.outbox_events  (D8)
-- -----------------------------------------------------------------------------
-- Transactional outbox. Domain writes and their side effects (WebSocket
-- broadcast, push, SMS, email, escalation timers) are committed atomically with
-- the business transaction, then relayed by the worker. This is what makes the
-- C6.3 five-minute accident escalation reliable rather than best-effort.
-- -----------------------------------------------------------------------------
CREATE TABLE app.outbox_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type      text NOT NULL,
    aggregate_type  text NOT NULL,
    aggregate_id    uuid,
    payload         jsonb NOT NULL,
    priority        app.notification_priority NOT NULL DEFAULT 'NORMAL',

    occurred_at     timestamptz NOT NULL DEFAULT now(),
    available_at    timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    attempts        smallint NOT NULL DEFAULT 0,
    last_error      text,
    dead_lettered_at timestamptz
);

CREATE INDEX outbox_events_pending_idx
    ON app.outbox_events (available_at, id)
    WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX outbox_events_aggregate_idx
    ON app.outbox_events (aggregate_type, aggregate_id);

COMMENT ON TABLE app.outbox_events IS
    'Transactional outbox (D8). Guarantees side effects survive a crash between commit and dispatch.';
