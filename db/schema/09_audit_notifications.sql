-- =============================================================================
-- 09_audit_notifications.sql
-- Fleet Management Platform - Append-only audit trail, notifications,
--                             escalation roster
--
-- Decisions: A1.8, C6.3, C6.4, C6.5, N9, 7.1, 7.2
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- audit.audit_logs  (7.1, C6.5)
-- -----------------------------------------------------------------------------
-- Every POST/PUT/PATCH/DELETE by an authenticated principal is written here by
-- the audit interceptor, capturing old_value against new_value.
--
-- C6.5: append-only, enforced by trigger. Retained seven years, partitioned by
-- year so expiry is a partition DROP rather than a mass delete.
--
-- actor_user_id is deliberately NOT a foreign key: the audit trail must remain
-- readable and complete even if the referenced user row is later removed, and
-- a foreign key would create a delete-time dependency on an append-only table.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE audit.audit_logs_id_seq AS bigint;

CREATE TABLE audit.audit_logs (
    id                  bigint NOT NULL DEFAULT nextval('audit.audit_logs_id_seq'),
    occurred_at         timestamptz NOT NULL DEFAULT now(),

    actor_user_id       uuid,
    actor_email         citext,
    actor_role_codes    text[] NOT NULL DEFAULT '{}',
    on_behalf_of_driver_id uuid,

    action              app.audit_action NOT NULL,
    entity_schema       text NOT NULL DEFAULT 'app',
    entity_table        text NOT NULL,
    entity_id           uuid,

    old_value           jsonb,
    new_value           jsonb,
    changed_fields      text[],

    reason              text,
    ip_address          inet,
    user_agent          text,
    request_id          uuid,
    endpoint            text,
    http_method         text,
    http_status         smallint,

    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

ALTER SEQUENCE audit.audit_logs_id_seq OWNED BY audit.audit_logs.id;

CREATE INDEX audit_logs_entity_idx   ON audit.audit_logs (entity_table, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx    ON audit.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_action_idx   ON audit.audit_logs (action, occurred_at DESC);
CREATE INDEX audit_logs_request_idx  ON audit.audit_logs (request_id) WHERE request_id IS NOT NULL;

-- C6.5: the table accepts INSERT only.
CREATE TRIGGER audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit.audit_logs
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_mutation();

COMMENT ON TABLE audit.audit_logs IS
    'C6.5. Append-only, 7-year retention, yearly partitions. UPDATE and DELETE raise restrict_violation.';
COMMENT ON COLUMN audit.audit_logs.actor_user_id IS
    'Intentionally not a foreign key so the trail survives independently of the users table.';

-- -----------------------------------------------------------------------------
-- app.notification_templates
-- -----------------------------------------------------------------------------
-- Bilingual (A2.6) message bodies with per-channel defaults, so operations can
-- adjust wording without a deployment.
-- -----------------------------------------------------------------------------
CREATE TABLE app.notification_templates (
    code                text PRIMARY KEY,
    description         text NOT NULL,
    default_priority    app.notification_priority NOT NULL DEFAULT 'NORMAL',
    default_channels    app.notification_channel[] NOT NULL DEFAULT '{PUSH}',
    title_en            text NOT NULL,
    body_en             text NOT NULL,
    title_sw            text,
    body_sw             text,
    -- C6.4: CRITICAL messages ignore quiet hours.
    breaks_quiet_hours  boolean NOT NULL DEFAULT false,
    is_active           boolean NOT NULL DEFAULT true,
    updated_by          uuid REFERENCES app.users(id),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- app.notifications  (7.2, A1.8, C6.4, N9)
-- -----------------------------------------------------------------------------
-- One row per recipient per channel, so a single incident that fans out to push,
-- SMS and email produces three auditable delivery attempts.
--
-- N9: FCM direct is used precisely so delivered_at can be populated from a real
-- delivery receipt. The C6.3 five-minute escalation keys off acknowledgement,
-- but delivery failure escalates sooner.
-- -----------------------------------------------------------------------------
CREATE TABLE app.notifications (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code           text REFERENCES app.notification_templates(code),

    recipient_user_id       uuid REFERENCES app.users(id) ON DELETE CASCADE,
    recipient_address       text,          -- phone or email actually used, for audit
    channel                 app.notification_channel NOT NULL,
    priority                app.notification_priority NOT NULL DEFAULT 'NORMAL',
    locale                  text NOT NULL DEFAULT 'en',

    title                   text NOT NULL,
    body                    text NOT NULL,
    payload                 jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Incident correlation, used by the A1.8 SMS rate limit
    -- (max 5 SMS per incident per 15 minutes).
    incident_kind           text,
    incident_id             uuid,
    dedupe_key              text,

    status                  app.notification_status NOT NULL DEFAULT 'QUEUED',
    attempts                smallint NOT NULL DEFAULT 0,
    provider                text,
    provider_message_id     text,
    queued_at               timestamptz NOT NULL DEFAULT now(),
    sent_at                 timestamptz,
    delivered_at            timestamptz,
    failed_at               timestamptz,
    failure_reason          text,
    suppressed_reason       text,

    CONSTRAINT notifications_recipient_present
        CHECK (recipient_user_id IS NOT NULL OR recipient_address IS NOT NULL),
    CONSTRAINT notifications_failure_complete
        CHECK (status <> 'FAILED' OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
    CONSTRAINT notifications_suppressed_complete
        CHECK (status <> 'SUPPRESSED_DND' OR suppressed_reason IS NOT NULL)
);

CREATE INDEX notifications_queue_idx
    ON app.notifications (queued_at) WHERE status = 'QUEUED';
CREATE INDEX notifications_recipient_idx
    ON app.notifications (recipient_user_id, queued_at DESC);
CREATE INDEX notifications_incident_idx
    ON app.notifications (incident_kind, incident_id, queued_at DESC);
-- A1.8: supports the per-incident SMS rate-limit window query.
CREATE INDEX notifications_sms_rate_limit_idx
    ON app.notifications (incident_id, sent_at)
    WHERE channel = 'SMS' AND sent_at IS NOT NULL;
CREATE UNIQUE INDEX notifications_dedupe_unique
    ON app.notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- app.on_call_roster  (C6.3)
-- -----------------------------------------------------------------------------
-- Replaces "notify all Fleet Managers" with a configurable, ordered roster.
-- -----------------------------------------------------------------------------
CREATE TABLE app.on_call_roster (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    incident_kind   text NOT NULL DEFAULT 'ACCIDENT',
    escalation_tier smallint NOT NULL DEFAULT 1 CHECK (escalation_tier BETWEEN 1 AND 5),
    effective_from  timestamptz NOT NULL DEFAULT now(),
    effective_to    timestamptz,
    is_active       boolean NOT NULL DEFAULT true,
    created_by      uuid REFERENCES app.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT on_call_roster_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX on_call_roster_lookup_idx
    ON app.on_call_roster (incident_kind, escalation_tier, effective_from DESC)
    WHERE is_active = true;

COMMENT ON TABLE app.on_call_roster IS
    'C6.3. Tier 1 is paged first; tier 2+ receive the five-minute escalation. The Head of Operations is held in system_config.';

-- -----------------------------------------------------------------------------
-- app.escalation_timers  (C6.3)
-- -----------------------------------------------------------------------------
-- Durable timers so the five-minute accident escalation survives a restart.
-- Created inside the same transaction as the accident report (D8).
-- -----------------------------------------------------------------------------
CREATE TABLE app.escalation_timers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_kind       text NOT NULL,
    incident_id         uuid NOT NULL,
    tier                smallint NOT NULL DEFAULT 1,
    fires_at            timestamptz NOT NULL,
    fired_at            timestamptz,
    cancelled_at        timestamptz,
    cancelled_reason    text,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT escalation_timers_not_both_fired_and_cancelled
        CHECK (NOT (fired_at IS NOT NULL AND cancelled_at IS NOT NULL))
);

CREATE INDEX escalation_timers_due_idx
    ON app.escalation_timers (fires_at)
    WHERE fired_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX escalation_timers_incident_tier_unique
    ON app.escalation_timers (incident_kind, incident_id, tier);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER notification_templates_set_updated_at
    BEFORE UPDATE ON app.notification_templates
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
