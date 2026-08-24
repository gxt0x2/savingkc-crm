-- Close the remaining direct-table write paths after Manifest retirement.
-- Historical rows stay queryable for compatibility and later archival, but
-- application runtime roles cannot mutate or remove them.
-- hygiene-approved-destructive: only obsolete broad RLS policies and DML
-- grants are removed; no table, function, or business row is deleted.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.manifests, public.manifest_history
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['cascade_writer', 'manifest_migrator']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manifests, public.manifest_history FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END
$$;

DROP POLICY IF EXISTS "Authenticated full access" ON public.manifests;
DROP POLICY IF EXISTS "authenticated_all" ON public.manifests;
DROP POLICY IF EXISTS "Service role full access" ON public.manifests;
DROP POLICY IF EXISTS "Authenticated full access" ON public.manifest_history;
DROP POLICY IF EXISTS "Service role full access" ON public.manifest_history;

CREATE POLICY "Authenticated read-only"
  ON public.manifests
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role read-only"
  ON public.manifests
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Authenticated read-only"
  ON public.manifest_history
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role read-only"
  ON public.manifest_history
  FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE public.manifests IS
  'Historical Manifest JSON retained read-only pending export, checksum, rollback rehearsal, and archive.';

COMMENT ON TABLE public.manifest_history IS
  'Historical Manifest audit rows retained read-only pending export, checksum, rollback rehearsal, and archive.';

COMMIT;
