-- Replace the prospecting dialer caller-ID allowlist with the four
-- remaining cold DIDs. The eight bad cold numbers are removed from the
-- CRM phone inventory and must not return to this allowlist.
-- Twilio number release is outside this migration.
--
-- Into the pool (Press-1 cold callback):
--   +18166088770  (816) 608-8770
--   +18166088552  (816) 608-8552
--   +18166088559  (816) 608-8559
--   +18166086999  (816) 608-6999
--
-- Removed from inventory (2026-10-30 owner):
--   +18164761344  (816) 476-1344
--   +18166404701  (816) 640-4701
--   +18165788107  (816) 578-8107
--   +18166536616  (816) 653-6616
--   +18163100845  (816) 310-0845
--   +18162538313  (816) 253-8313
--   +18164761589  (816) 476-1589
--   +18166408032  (816) 640-8032
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
