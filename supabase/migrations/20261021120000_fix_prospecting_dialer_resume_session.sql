-- Repair the V4 Prospecting dialer resume path without changing campaign,
-- session, queue, or attempt data. The original function declares a local
-- `session_id` variable and also references the attempts table's `session_id`
-- column without qualification. PostgreSQL raises 42702 when an existing
-- active or paused session reaches that branch.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $migration$
DECLARE
  function_signature constant text := 'public.start_prospecting_dialer_session_v4(uuid,text,text,text,jsonb)';
  broken_fragment constant text := E'FROM public.dialer_session_attempts\n        WHERE session_id = open_session.id';
  repaired_fragment constant text := E'FROM public.dialer_session_attempts attempt\n        WHERE attempt.session_id = open_session.id';
  function_definition text;
  occurrence_count integer;
BEGIN
  IF to_regprocedure(function_signature) IS NULL THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4_missing';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(function_signature))
  INTO function_definition;

  occurrence_count := (
    length(function_definition) - length(replace(function_definition, broken_fragment, ''))
  ) / length(broken_fragment);

  IF occurrence_count <> 2 THEN
    RAISE EXCEPTION 'unexpected_start_prospecting_dialer_session_v4_definition: expected 2 ambiguous references, found %', occurrence_count;
  END IF;

  function_definition := replace(function_definition, broken_fragment, repaired_fragment);
  EXECUTE function_definition;
END
$migration$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  TO service_role;
