-- Emergency data-location rollback for 20261020120000_manifest_physical_archive.
-- This restores the two retained tables to public without reopening retired
-- compatibility RPCs or any Manifest write path. Applying it requires its own
-- production approval.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  manifest_count bigint;
  history_count bigint;
BEGIN
  IF to_regclass('public.manifests') IS NOT NULL
     OR to_regclass('public.manifest_history') IS NOT NULL
     OR to_regclass('manifest_archive.manifests') IS NULL
     OR to_regclass('manifest_archive.manifest_history') IS NULL
  THEN
    RAISE EXCEPTION 'Manifest archive is not in the expected rollback state';
  END IF;

  LOCK TABLE manifest_archive.manifests, manifest_archive.manifest_history
    IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO manifest_count FROM manifest_archive.manifests;
  SELECT count(*) INTO history_count FROM manifest_archive.manifest_history;

  IF manifest_count <> 367 OR history_count <> 10668 THEN
    RAISE EXCEPTION 'Archived Manifest counts no longer match the reviewed receipt';
  END IF;
END
$$;

ALTER TABLE manifest_archive.manifests SET SCHEMA public;
ALTER TABLE manifest_archive.manifest_history SET SCHEMA public;

GRANT SELECT ON TABLE public.manifests, public.manifest_history
  TO authenticated, service_role;

UPDATE manifest_archive.manifest_archive_receipts
SET status = 'rolled_back',
    rolled_back_at = now()
WHERE archive_id = 'savingkc-manifest-archive-2026-08-26T203409329Z'
  AND status = 'archived';

DO $$
BEGIN
  IF to_regclass('public.manifests') IS NULL
     OR to_regclass('public.manifest_history') IS NULL
     OR to_regclass('manifest_archive.manifests') IS NOT NULL
     OR to_regclass('manifest_archive.manifest_history') IS NOT NULL
  THEN
    RAISE EXCEPTION 'Manifest tables did not return cleanly to public';
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
    RAISE EXCEPTION 'PPC foreign keys did not follow the rollback';
  END IF;
END
$$;

COMMENT ON TABLE public.manifests IS
  'Historical Manifest JSON restored read-only by emergency archive rollback.';

COMMENT ON TABLE public.manifest_history IS
  'Historical Manifest audit rows restored read-only by emergency archive rollback.';

NOTIFY pgrst, 'reload schema';

COMMIT;
