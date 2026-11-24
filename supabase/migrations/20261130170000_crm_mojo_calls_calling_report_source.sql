-- Owner 11/07: per-dial Mojo history from the Calling Report (the web app's
-- own call detail, read with the existing scraper session) is a third
-- crm_mojo_calls source. It matched every expected 10/09-10/19 count.
ALTER TABLE public.crm_mojo_calls DROP CONSTRAINT IF EXISTS crm_mojo_calls_source_check;
ALTER TABLE public.crm_mojo_calls ADD CONSTRAINT crm_mojo_calls_source_check
  CHECK (source IN ('mojo_mcp_list_calls', 'mojo_session_recordings', 'mojo_session_calling_report'));

-- Widen the same allow-list inside the upsert RPC without restating its body.
DO $$
DECLARE
  definition text := pg_get_functiondef('public.upsert_crm_mojo_call_v1(jsonb)'::regprocedure);
  old_list text := $q$NOT IN ('mojo_mcp_list_calls', 'mojo_session_recordings')$q$;
  new_list text := $q$NOT IN ('mojo_mcp_list_calls', 'mojo_session_recordings', 'mojo_session_calling_report')$q$;
BEGIN
  IF position(new_list IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_list IN definition) = 0 THEN
    RAISE EXCEPTION 'upsert_crm_mojo_call_v1 source allow-list not found';
  END IF;
  EXECUTE replace(definition, old_list, new_list);
END
$$;
