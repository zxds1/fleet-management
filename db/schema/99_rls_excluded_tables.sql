-- Enable RLS on the three tables previously excluded from the tenant sweep.
-- Policies allow access when the session tenant is unset (bootstrap/unbound
-- write paths) OR matches the row's tenant_id, so existing unbound writes keep
-- working while cross-tenant reads are blocked once a tenant is bound.
ALTER TABLE app.error_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.error_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.error_events;
CREATE POLICY tenant_isolation ON app.error_events
  USING (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

ALTER TABLE app.ingest_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ingest_dead_letter FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.ingest_dead_letter;
CREATE POLICY tenant_isolation ON app.ingest_dead_letter
  USING (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));
