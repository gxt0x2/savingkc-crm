-- Retire the final database-side Manifest writers while preserving historical
-- JSON, history, PPC foreign keys, and the canonical AI approval contract.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The canonical-only AI decision function is defined by
-- 20261002120000_ai_change_proposal_manifest_retirement.sql. It must be in
-- place before the obsolete Manifest RPC below is removed.

DROP TRIGGER IF EXISTS trg_auto_create_manifest ON public.leads;
DROP FUNCTION IF EXISTS public.auto_create_manifest_for_lead();

DROP TRIGGER IF EXISTS trg_manifest_cascade_to_lead ON public.manifests;
DROP FUNCTION IF EXISTS public.sync_manifest_to_lead();

DROP FUNCTION IF EXISTS public.update_manifest_and_cascade(uuid, jsonb, text, text);

REVOKE INSERT, UPDATE ON TABLE public.manifests
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cascade_writer') THEN
    EXECUTE 'REVOKE INSERT, UPDATE ON TABLE public.manifests FROM cascade_writer';
  END IF;
END
$$;

COMMENT ON TABLE public.manifests IS
  'Historical Manifest JSON retained read-only pending export, checksum, rollback rehearsal, and archive.';

COMMIT;
