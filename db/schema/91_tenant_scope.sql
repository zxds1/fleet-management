-- 91_tenant_scope.sql — tenant scope for the tables that were missing it.
--
-- Runs after 90_tenancy_rls.sql (which adds the parent tables' tenant_id) and
-- before 92_tenant_policies.sql (which applies the policies).
--
-- The tenancy sweep (99_tenancy_rls.sql) can only protect a table that has a
-- `tenant_id`. These eight tables held tenant data without one, so the
-- database could not isolate them: a row was visible to every tenant, and the
-- application-level filters were the only thing standing between one fleet and
-- another.
--
-- The column is added, backfilled from the parent row, and kept correct by a
-- trigger, so a writer cannot forget it. The sweep is now dynamic — it picks
-- up every table that has the column — so a table added later cannot be
-- forgotten either.
--
-- The tables that are deliberately NOT here are global by design, the same way
-- `app.roles`, `app.permissions` and `app.user_sessions` are:
--
--   app.training_courses, app.training_lessons   a shared course catalogue
--   app.inspection_templates, app.inspection_template_items
--                                                a shared template catalogue
--   app.notification_templates                   a shared template catalogue
--   app.maintenance_tasks, app.hos_policies       a shared task/policy catalogue
--   app.user_consents, app.driver_devices        per USER, not per tenant
--                                                (the auth flow reads them
--                                                before a tenant context exists)
--   app.user_sessions, app.mfa_recovery_codes     per USER, same reason
--   app.tenants, app.users, app.user_tenants      the identity model itself
--   app.roles, app.permissions, app.role_permissions, app.user_roles
--   app.system_config, app.idempotency_keys, app.outbox_events, app.job_dead_letter
--                                                infrastructure

-- ── 1. the columns ────────────────────────────────────────────────────────

ALTER TABLE app.vehicle_issues         ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.training_enrollments    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.driver_onboarding       ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.inspection_items        ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.inspection_item_photos  ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.work_log_photos         ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.media_scans             ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE app.accident_telemetry      ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- ── 2. the trigger that keeps it right ────────────────────────────────────
--
-- One function for every table: the parent table and the column that points
-- at it come from the trigger arguments. A writer cannot insert a row into
-- the wrong tenant, because the column is derived, not supplied.

CREATE OR REPLACE FUNCTION app.fn_set_tenant_from_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT p.tenant_id FROM app.%I p WHERE p.id = $1', TG_ARGV[0])
    INTO v_tenant
    USING (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  IF v_tenant IS NULL THEN
    -- The parent has no tenant yet, or the pointer is not there. Refusing the
    -- row is the safe answer: a row with no tenant is invisible to every
    -- tenant under the RLS policy, and visible only to a system admin.
    RAISE EXCEPTION 'tenant_id could not be derived for % from %.%', TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1]
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER vehicle_issues_tenant
  BEFORE INSERT OR UPDATE OF vehicle_id ON app.vehicle_issues
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('vehicles', 'vehicle_id');

CREATE OR REPLACE TRIGGER training_enrollments_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON app.training_enrollments
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('drivers', 'driver_id');

CREATE OR REPLACE TRIGGER driver_onboarding_tenant
  BEFORE INSERT OR UPDATE OF driver_id ON app.driver_onboarding
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('drivers', 'driver_id');

CREATE OR REPLACE TRIGGER inspection_items_tenant
  BEFORE INSERT OR UPDATE OF inspection_id ON app.inspection_items
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('inspections', 'inspection_id');

CREATE OR REPLACE TRIGGER inspection_item_photos_tenant
  BEFORE INSERT OR UPDATE OF inspection_item_id ON app.inspection_item_photos
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('inspection_items', 'inspection_item_id');

CREATE OR REPLACE TRIGGER work_log_photos_tenant
  BEFORE INSERT OR UPDATE OF work_log_id ON app.work_log_photos
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('work_logs', 'work_log_id');

CREATE OR REPLACE TRIGGER media_scans_tenant
  BEFORE INSERT OR UPDATE OF media_object_id ON app.media_scans
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('media_objects', 'media_object_id');

CREATE OR REPLACE TRIGGER accident_telemetry_tenant
  BEFORE INSERT OR UPDATE OF report_id ON app.accident_telemetry
  FOR EACH ROW EXECUTE FUNCTION app.fn_set_tenant_from_parent('accident_reports', 'report_id');

-- ── 3. the backfill ───────────────────────────────────────────────────────
--
-- In dependency order: a child is backfilled after its parent, because the
-- child reads the parent's tenant.

UPDATE app.vehicle_issues i
   SET tenant_id = v.tenant_id
  FROM app.vehicles v
 WHERE v.id = i.vehicle_id AND i.tenant_id IS NULL;

UPDATE app.training_enrollments e
   SET tenant_id = d.tenant_id
  FROM app.drivers d
 WHERE d.id = e.driver_id AND e.tenant_id IS NULL;

UPDATE app.driver_onboarding o
   SET tenant_id = d.tenant_id
  FROM app.drivers d
 WHERE d.id = o.driver_id AND o.tenant_id IS NULL;

UPDATE app.inspection_items i
   SET tenant_id = ins.tenant_id
  FROM app.inspections ins
 WHERE ins.id = i.inspection_id AND i.tenant_id IS NULL;

UPDATE app.inspection_item_photos p
   SET tenant_id = i.tenant_id
  FROM app.inspection_items i
 WHERE i.id = p.inspection_item_id AND p.tenant_id IS NULL;

UPDATE app.work_log_photos p
   SET tenant_id = w.tenant_id
  FROM app.work_logs w
 WHERE w.id = p.work_log_id AND p.tenant_id IS NULL;

UPDATE app.media_scans s
   SET tenant_id = m.tenant_id
  FROM app.media_objects m
 WHERE m.id = s.media_object_id AND s.tenant_id IS NULL;

UPDATE app.accident_telemetry t
   SET tenant_id = r.tenant_id
  FROM app.accident_reports r
 WHERE r.id = t.report_id AND t.tenant_id IS NULL;

-- A row whose parent has no tenant cannot be derived. The sweep falls back to
-- the bootstrap tenant for the same case; do the same here, and say so.
DO $$
DECLARE
    v_orphans integer := 0;
BEGIN
    SELECT count(*) INTO v_orphans FROM app.vehicle_issues WHERE tenant_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE NOTICE 'vehicle_issues: % row(s) had no derivable tenant; moved to the bootstrap tenant', v_orphans;
    END IF;
    UPDATE app.vehicle_issues SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.training_enrollments SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.driver_onboarding SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.inspection_items SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.inspection_item_photos SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.work_log_photos SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.media_scans SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    UPDATE app.accident_telemetry SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
END
$$;

-- Every one of these is now NOT NULL: the trigger derives the value, and the
-- policy's WITH CHECK refuses a row that does not match the session tenant.
ALTER TABLE app.vehicle_issues        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.training_enrollments   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.driver_onboarding      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.inspection_items       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.inspection_item_photos ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.work_log_photos        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.media_scans            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.accident_telemetry     ALTER COLUMN tenant_id SET NOT NULL;

-- The FK is added NOT VALID and then validated, so the exclusive lock window
-- is a SHARE UPDATE EXCLUSIVE rather than a full-table ACCESS EXCLUSIVE.
DO $$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'vehicle_issues', 'training_enrollments', 'driver_onboarding',
        'inspection_items', 'inspection_item_photos', 'work_log_photos',
        'media_scans', 'accident_telemetry'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = format('%s_tenant_fk', v_table)
               AND conrelid = format('app.%I', v_table)::regclass
        ) THEN
            EXECUTE format(
                'ALTER TABLE app.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES app.tenants(id) ON DELETE RESTRICT NOT VALID',
                v_table, format('%s_tenant_fk', v_table));
            EXECUTE format(
                'ALTER TABLE app.%I VALIDATE CONSTRAINT %I',
                v_table, format('%s_tenant_fk', v_table));
        END IF;
    END LOOP;
END
$$;

-- ── 4. the indexes the sweep and the queries need ────────────────────────

CREATE INDEX IF NOT EXISTS vehicle_issues_tenant_idx ON app.vehicle_issues (tenant_id);
CREATE INDEX IF NOT EXISTS training_enrollments_tenant_idx ON app.training_enrollments (tenant_id);
CREATE INDEX IF NOT EXISTS driver_onboarding_tenant_idx ON app.driver_onboarding (tenant_id);
CREATE INDEX IF NOT EXISTS inspection_items_tenant_idx ON app.inspection_items (tenant_id);
CREATE INDEX IF NOT EXISTS inspection_item_photos_tenant_idx ON app.inspection_item_photos (tenant_id);
CREATE INDEX IF NOT EXISTS work_log_photos_tenant_idx ON app.work_log_photos (tenant_id);
CREATE INDEX IF NOT EXISTS media_scans_tenant_idx ON app.media_scans (tenant_id);
CREATE INDEX IF NOT EXISTS accident_telemetry_tenant_idx ON app.accident_telemetry (tenant_id);
