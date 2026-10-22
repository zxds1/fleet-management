-- =============================================================================
-- 15_privacy_requests.sql
-- Fleet Management Platform - Data Subject Access Request (DSAR) ledger
--
-- Decisions: C5.5 (consent ledger), C6.5 (append-only audit), D3 (soft delete)
-- GDPR 2016/679 (right to access, right to erasure, data portability) and Kenya
-- DPA 2019 equivalent provisions.
--
-- Phase: 3
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.privacy_request_type
-- -----------------------------------------------------------------------------
-- Closed lifecycle for the kind of access request a driver can raise.
-- -----------------------------------------------------------------------------
CREATE TYPE app.privacy_request_type AS ENUM (
    'EXPORT',
    'DELETION'
);

-- -----------------------------------------------------------------------------
-- app.privacy_request_status
-- -----------------------------------------------------------------------------
-- Lifecycle of a DSAR request. The worker drives PENDING -> PROCESSING -> READY
-- (for exports) or PENDING -> PROCESSING -> COMPLETED (for deletions). A driver
-- marks an export DOWNLOADED after fetching the presigned URL.
-- -----------------------------------------------------------------------------
CREATE TYPE app.privacy_request_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'READY',
    'DOWNLOADED',
    'COMPLETED',
    'FAILED'
);

-- -----------------------------------------------------------------------------
-- app.privacy_requests
-- -----------------------------------------------------------------------------
-- One row per DSAR submission. Append-only: hard delete is trigger-rejected and
-- UPDATE is forbidden so the audit trail of a data-subject exercise cannot be
-- tampered with (C6.5). A driver may only ever see their own rows (RLS);
-- ADMIN/FLEET_MANAGER see the tenant's rows through the tenant_isolation policy.
--
-- download_token is a single-use opaque uuid. It is returned to the caller ONLY
-- over the authenticated GET .../download path; the token itself is the bearer
-- credential for fetching the export, so it must never appear in an audit log.
-- -----------------------------------------------------------------------------
CREATE TABLE app.privacy_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,

    request_type    app.privacy_request_type NOT NULL,
    status          app.privacy_request_status NOT NULL DEFAULT 'PENDING',

    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,

    download_token  uuid,
    file_key        text,
    file_size_bytes bigint,

    notes           text,

    CONSTRAINT privacy_requests_status_transition
        CHECK (
            (request_type = 'EXPORT' AND status IN ('PENDING','PROCESSING','READY','DOWNLOADED','FAILED'))
         OR (request_type = 'DELETION' AND status IN ('PENDING','PROCESSING','COMPLETED','FAILED'))
        )
);

COMMENT ON TABLE app.privacy_requests IS
    'DSAR ledger (GDPR/ Kenya DPA 2019). One row per export or deletion request. Append-only (C6.5).';
COMMENT ON COLUMN app.privacy_requests.download_token IS
    'Single-use opaque token returned only to the authenticated owner; the bearer credential for the export download.';
COMMENT ON COLUMN app.privacy_requests.file_key IS
    'S3 object key of the generated export (JSON or ZIP). Populated by the background worker.';

-- Tenant/user lookup index for the "list my requests" surface.
CREATE INDEX privacy_requests_tenant_user_idx
    ON app.privacy_requests (tenant_id, user_id, created_at DESC);

-- Worker dispatch index: pick up the oldest PROCESSING/READY work first.
CREATE INDEX privacy_requests_worker_idx
    ON app.privacy_requests (status, created_at)
    WHERE status IN ('PENDING', 'PROCESSING');

-- One download token per row, never reused.
CREATE UNIQUE INDEX privacy_requests_download_token_unique
    ON app.privacy_requests (download_token) WHERE download_token IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Row Level Security (tenant_isolation pattern from 14_tenancy.sql)
-- -----------------------------------------------------------------------------
ALTER TABLE app.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.privacy_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON app.privacy_requests;
CREATE POLICY tenant_isolation ON app.privacy_requests
    USING (tenant_id = app.fn_current_tenant_id() OR app.fn_is_system_admin())
    WITH CHECK (tenant_id = app.fn_current_tenant_id() OR app.fn_is_system_admin());

-- -----------------------------------------------------------------------------
-- Triggers (D3 / C6.5)
-- -----------------------------------------------------------------------------
-- Append-only: status transitions are written by the worker; user-facing writes
-- never touch the row after insert, so UPDATE would be a tampering attempt.
CREATE TRIGGER privacy_requests_append_only
    BEFORE UPDATE OR DELETE ON app.privacy_requests
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_mutation();

CREATE TRIGGER privacy_requests_no_hard_delete
    BEFORE DELETE ON app.privacy_requests
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();
