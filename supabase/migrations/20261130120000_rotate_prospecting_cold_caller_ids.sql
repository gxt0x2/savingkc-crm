-- Rotate the prospecting dialer caller-ID allowlist.
-- Twilio ownership stays. Inbound cold_callback routing stays on every
-- cold_call DID, including parked numbers, so old callbacks still work.
-- This only changes which numbers start_prospecting_dialer_session_v4
-- will authorize for a new cold/prospecting session.
--
-- Into the pool (Press-1 cold callback):
--   +18166088770  (816) 608-8770
--   +18166088552  (816) 608-8552
--   +18166088559  (816) 608-8559
--   +18166086999  (816) 608-6999
--
-- Parked 2026-10-30 (do not release; keep inbound cold_callback):
--   +18164761344  (816) 476-1344
--   +18166404701  (816) 640-4701
--   +18165788107  (816) 578-8107
--   +18166536616  (816) 653-6616
--
-- Already parked 2026-09-23 and still excluded:
--   +18163100845, +18162538313, +18164761589, +18166408032
--
-- Not in this pool:
--   +18166086699  (816) 608-6699  Gertha Dotson (Admin/TC)

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $migration$
DECLARE
  function_signature constant text := 'public.start_prospecting_dialer_session_v4(uuid,text,text,text,jsonb)';
  function_definition text;
  updated_definition text;
  allowlist_marker constant text := 'allowed_caller_ids constant text[] := ARRAY';
BEGIN
  IF to_regprocedure(function_signature) IS NULL THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4_missing';
  END IF;

  SELECT pg_get_functiondef(to_regprocedure(function_signature))
  INTO function_definition;

  IF function_definition !~ '\+18166404701'
    OR function_definition !~ '\+18165788107'
    OR function_definition !~ '\+18166536616'
    OR function_definition !~ '\+18164761344'
    OR function_definition ~ '\+18166088770'
    OR function_definition ~ '\+18166086699'
    OR (length(function_definition) - length(replace(function_definition, allowlist_marker, '')))
         / length(allowlist_marker) <> 1
  THEN
    RAISE EXCEPTION 'unexpected_start_prospecting_dialer_session_v4_caller_allowlist';
  END IF;

  updated_definition := regexp_replace(
    function_definition,
    'allowed_caller_ids constant text\[\] := ARRAY\[[^]]+\];',
    $array$allowed_caller_ids constant text[] := ARRAY['+18166088770', '+18166088552', '+18166088559', '+18166086999'];$array$
  );

  IF updated_definition = function_definition
    OR updated_definition !~ '\+18166088770'
    OR updated_definition !~ '\+18166088552'
    OR updated_definition !~ '\+18166088559'
    OR updated_definition !~ '\+18166086999'
    OR updated_definition ~ '\+18166404701'
    OR updated_definition ~ '\+18165788107'
    OR updated_definition ~ '\+18166536616'
    OR updated_definition ~ '\+18164761344'
    OR updated_definition ~ '\+18163100845'
    OR updated_definition ~ '\+18162538313'
    OR updated_definition ~ '\+18164761589'
    OR updated_definition ~ '\+18166408032'
    OR updated_definition ~ '\+18166086699'
  THEN
    RAISE EXCEPTION 'unexpected_start_prospecting_dialer_session_v4_caller_allowlist';
  END IF;

  EXECUTE updated_definition;
END
$migration$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  TO service_role;
