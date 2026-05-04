-- Resolve Supabase advisor: public schema tables must not be readable/writable
-- by anon users simply because RLS was never enabled.
--
-- This app gates dashboard routes with Supabase Auth and uses the service-role
-- client from API routes for privileged workflows. Keep authenticated app users
-- working, but make anonymous access fail closed on every public table.

DO $$
DECLARE
  tbl record;
BEGIN
  -- Remove legacy catch-all anon policies found in the live project. With RLS
  -- enabled these policies would still make the CRM data publicly accessible.
  DROP POLICY IF EXISTS "allow_all_leads" ON public.leads;
  DROP POLICY IF EXISTS "allow_all_activities" ON public.lead_activities;

  FOR tbl IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT LIKE 'sql_%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tbl.schemaname, tbl.tablename);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = tbl.schemaname
        AND tablename = tbl.tablename
        AND policyname = 'Authenticated full access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        'Authenticated full access',
        tbl.schemaname,
        tbl.tablename
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = tbl.schemaname
        AND tablename = tbl.tablename
        AND policyname = 'Service role full access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'Service role full access',
        tbl.schemaname,
        tbl.tablename
      );
    END IF;
  END LOOP;
END
$$;

-- Make intent explicit for default privileges too. RLS still controls access,
-- but anon should not receive direct table privileges on future tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
