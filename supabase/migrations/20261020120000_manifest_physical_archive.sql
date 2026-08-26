-- Move retired Manifest storage out of the runtime schema without deleting it.
--
-- This operation is bound to the independently verified encrypted archive
-- receipt generated on 2026-08-26. It fails closed if the retained source rows
-- or PPC references no longer match the reviewed preflight.
--
-- hygiene-approved-destructive: revoke obsolete runtime access and move two
-- read-only historical tables into a private schema; no row or table is deleted.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  manifest_count bigint;
  history_count bigint;
  outbox_reference_count bigint;
  tracking_reference_count bigint;
  runtime_role text;
BEGIN
  IF to_regclass('public.manifests') IS NULL
     OR to_regclass('public.manifest_history') IS NULL
  THEN
    RAISE EXCEPTION 'Manifest archive source tables are missing from public';
  END IF;

  IF to_regnamespace('manifest_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'Manifest archive destination schema already exists';
  END IF;

  LOCK TABLE public.manifests, public.manifest_history IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO manifest_count FROM public.manifests;
  SELECT count(*) INTO history_count FROM public.manifest_history;
  SELECT count(*) INTO outbox_reference_count
  FROM public.ppc_conversion_outbox
  WHERE manifest_id IS NOT NULL;
  SELECT count(*) INTO tracking_reference_count
  FROM public.ppc_tracking_events
  WHERE manifest_id IS NOT NULL;

  IF manifest_count <> 367 OR history_count <> 10668 THEN
    RAISE EXCEPTION
      'Manifest source counts changed after verified export: manifests %, history %',
      manifest_count,
      history_count;
  END IF;

  IF outbox_reference_count <> 7 OR tracking_reference_count <> 8 THEN
    RAISE EXCEPTION
      'Retained PPC references changed after preflight: outbox %, tracking %',
      outbox_reference_count,
      tracking_reference_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ppc_conversion_outbox_manifest_id_fkey'
      AND conrelid = 'public.ppc_conversion_outbox'::regclass
      AND confrelid = 'public.manifests'::regclass
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ppc_tracking_events_manifest_id_fkey'
      AND conrelid = 'public.ppc_tracking_events'::regclass
      AND confrelid = 'public.manifests'::regclass
  ) THEN
    RAISE EXCEPTION 'Reviewed PPC foreign-key topology is not present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid IN ('public.manifests'::regclass, 'public.manifest_history'::regclass)
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Unexpected non-internal Manifest trigger remains';
  END IF;

  FOREACH runtime_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'cascade_writer', 'manifest_migrator']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role)
       AND (
         has_table_privilege(runtime_role, 'public.manifests', 'INSERT')
         OR has_table_privilege(runtime_role, 'public.manifests', 'UPDATE')
         OR has_table_privilege(runtime_role, 'public.manifests', 'DELETE')
         OR has_table_privilege(runtime_role, 'public.manifests', 'TRUNCATE')
         OR has_table_privilege(runtime_role, 'public.manifest_history', 'INSERT')
         OR has_table_privilege(runtime_role, 'public.manifest_history', 'UPDATE')
         OR has_table_privilege(runtime_role, 'public.manifest_history', 'DELETE')
         OR has_table_privilege(runtime_role, 'public.manifest_history', 'TRUNCATE')
       )
    THEN
      RAISE EXCEPTION 'Manifest writer shutdown is incomplete for role %', runtime_role;
    END IF;
  END LOOP;
END
$$;

CREATE SCHEMA manifest_archive AUTHORIZATION postgres;

COMMENT ON SCHEMA manifest_archive IS
  'Private historical storage. Not an application or PostgREST runtime schema.';

REVOKE ALL ON SCHEMA manifest_archive FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.manifest_archive_receipts (
  archive_id text PRIMARY KEY,
  format text NOT NULL CHECK (format = 'savingkc-manifest-archive-v1'),
  generated_at timestamptz NOT NULL,
  source_project_ref text NOT NULL,
  manifests_row_count bigint NOT NULL CHECK (manifests_row_count >= 0),
  manifests_sha256 text NOT NULL CHECK (manifests_sha256 ~ '^[a-f0-9]{64}$'),
  history_row_count bigint NOT NULL CHECK (history_row_count >= 0),
  history_sha256 text NOT NULL CHECK (history_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('archived', 'rolled_back')),
  archived_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz
);

REVOKE ALL ON TABLE public.manifest_archive_receipts FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.manifest_archive_receipts (
  archive_id,
  format,
  generated_at,
  source_project_ref,
  manifests_row_count,
  manifests_sha256,
  history_row_count,
  history_sha256,
  status
) VALUES (
  'savingkc-manifest-archive-2026-08-26T203409329Z',
  'savingkc-manifest-archive-v1',
  '2026-08-26T20:38:45.658Z'::timestamptz,
  'fprrknfyzlthbxewnwmi',
  367,
  '2b22f25ce0307e1be09c03256a632729fc696233e65e4013b2c73f50a029cc7b',
  10668,
  '0bc2c67336d3ae1304e4957efb32176f5974ee2cc52c161e1b74e0c42bcb0dac',
  'archived'
);

-- V1 is the only remaining live-schema function body that reads Manifest.
-- V2 delegates to V1. The application runtime has used canonical V4 since the
-- Hot Engine retirement, so these compatibility RPCs must not follow the data.
ALTER FUNCTION public.contact_workspace_page_v2(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.contact_workspace_page_v1(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.contact_workspace_page_v2(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.contact_workspace_manifest_tags(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.manifests, public.manifest_history
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['cascade_writer', 'manifest_migrator']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.manifests, public.manifest_history FROM %I',
        runtime_role
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.manifest_history SET SCHEMA manifest_archive;
ALTER TABLE public.manifests SET SCHEMA manifest_archive;
ALTER TABLE public.manifest_archive_receipts SET SCHEMA manifest_archive;

COMMENT ON TABLE manifest_archive.manifests IS
  'Retired Manifest snapshot archived under verified receipt savingkc-manifest-archive-2026-08-26T203409329Z.';

COMMENT ON TABLE manifest_archive.manifest_history IS
  'Retired Manifest audit history archived under verified receipt savingkc-manifest-archive-2026-08-26T203409329Z.';

DO $$
DECLARE
  archived_manifest_count bigint;
  archived_history_count bigint;
  runtime_role text;
BEGIN
  IF to_regclass('public.manifests') IS NOT NULL
     OR to_regclass('public.manifest_history') IS NOT NULL
     OR to_regclass('manifest_archive.manifests') IS NULL
     OR to_regclass('manifest_archive.manifest_history') IS NULL
     OR to_regclass('manifest_archive.manifest_archive_receipts') IS NULL
  THEN
    RAISE EXCEPTION 'Manifest tables did not move cleanly into the private schema';
  END IF;

  SELECT count(*) INTO archived_manifest_count FROM manifest_archive.manifests;
  SELECT count(*) INTO archived_history_count FROM manifest_archive.manifest_history;

  IF archived_manifest_count <> 367 OR archived_history_count <> 10668 THEN
    RAISE EXCEPTION 'Archived Manifest counts do not match the verified receipt';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ppc_conversion_outbox_manifest_id_fkey'
      AND conrelid = 'public.ppc_conversion_outbox'::regclass
      AND confrelid = 'manifest_archive.manifests'::regclass
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ppc_tracking_events_manifest_id_fkey'
      AND conrelid = 'public.ppc_tracking_events'::regclass
      AND confrelid = 'manifest_archive.manifests'::regclass
  ) THEN
    RAISE EXCEPTION 'PPC foreign keys did not follow the archived Manifest table';
  END IF;

  FOREACH runtime_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'cascade_writer', 'manifest_migrator']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role)
       AND (
         has_schema_privilege(runtime_role, 'manifest_archive', 'USAGE')
         OR has_table_privilege(runtime_role, 'manifest_archive.manifests', 'SELECT')
         OR has_table_privilege(runtime_role, 'manifest_archive.manifest_history', 'SELECT')
       )
    THEN
      RAISE EXCEPTION 'Archived Manifest remains reachable by runtime role %', runtime_role;
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
