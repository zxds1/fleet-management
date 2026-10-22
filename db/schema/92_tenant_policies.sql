-- 92_tenant_policies.sql — the row-level security policies.
--
-- This is the LAST step of the tenancy migration, and it is dynamic: it
-- protects every table that carries a `tenant_id`, whichever migration added
-- the column. A hard-coded list could be, and was, out of date — a table that
-- held tenant data with no policy was visible to every tenant.
--
-- The tables that are deliberately not protected are excluded by name below,
-- with the reason.
-- Each one needs the same one-line application change: bind the session tenant
-- (or set app.current_role = SYSTEM_ADMIN) before the INSERT. Until then they
-- rely on their own explicit tenant_id predicates, not on RLS.
DO $$
DECLARE
    v_table      record;
    v_predicate  text;
BEGIN
    FOR v_table IN
        SELECT n.nspname  AS schema_name,
               c.relname  AS table_name,
               a.atttypid::regtype::text AS column_type
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE c.relkind IN ('r', 'p')
           AND n.nspname IN ('app', 'telemetry')
           AND a.attname = 'tenant_id'
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND NOT (
               (n.nspname = 'app' AND c.relname IN ('error_events', 'ingest_dead_letter', 'password_reset_codes'))
               -- partitions of an excluded table inherit its tenant_id column but must
               -- keep the parent's (unprotected) behaviour
               OR EXISTS (
                   SELECT 1
                     FROM pg_inherits inh
                     JOIN pg_class pc ON pc.oid = inh.inhparent
                     JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                    WHERE inh.inhrelid = c.oid
                      AND pn.nspname = 'app'
                      AND pc.relname IN ('error_events', 'ingest_dead_letter', 'password_reset_codes')
               )
           )
         ORDER BY n.nspname, c.relname
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                       v_table.schema_name, v_table.table_name);
        -- Applies the policy to the table owner too. Without this the API's own
        -- role (which owns the schema in most deployments) would silently skip RLS.
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                       v_table.schema_name, v_table.table_name);

        -- uuid tenant_id compares directly; a text tenant_id compares against the
        -- canonical uuid text so the predicate stays type-correct.
        v_predicate := CASE
            WHEN v_table.column_type = 'uuid'
                THEN 'tenant_id = app.fn_current_tenant_id()'
            ELSE 'tenant_id = app.fn_current_tenant_id()::text'
        END;

        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
                       v_table.schema_name, v_table.table_name);
        EXECUTE format($p$
            CREATE POLICY tenant_isolation ON %I.%I
                USING (%s OR app.fn_is_system_admin())
                WITH CHECK (%s OR app.fn_is_system_admin())
        $p$, v_table.schema_name, v_table.table_name, v_predicate, v_predicate);
    END LOOP;
END
$$;
