-- packages/db/src/migrations/16_password_reset.sql
-- Password-reset delegation (immune-system follow-on).
--
-- A reset is REQUESTED by the account owner and, unless the owner is the tenant's company owner
-- (the self-signup super-admin), must be APPROVED by an authorised admin before a code is delivered:
--   * invited ADMIN   -> approver is the inviting admin (user_roles.granted_by)
--   * DRIVER          -> approver is any tenant ADMIN / FLEET_MANAGER
--   * company owner    -> no approval; code delivered to email immediately
-- The code is single-use, hashed at rest (SHA-256), and expires after PASSWORD_RESET_CODE_TTL_MINUTES.

CREATE TABLE IF NOT EXISTS app.password_reset_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id),
  user_id         uuid NOT NULL REFERENCES app.users(id),
  channel         text NOT NULL CHECK (channel IN ('email', 'email_sms')),
  status          text NOT NULL DEFAULT 'PENDING_APPROVAL'
                    CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'EXPIRED', 'REVOKED')),
  code_hash       text NOT NULL,
  contact_hint    text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  approver_user_id uuid NULL,
  approved_by     uuid NULL,
  approved_at     timestamptz NULL,
  delivered_at    timestamptz NULL,
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_user_idx
  ON app.password_reset_codes (user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS password_reset_approver_idx
  ON app.password_reset_codes (tenant_id, approver_user_id, status);
