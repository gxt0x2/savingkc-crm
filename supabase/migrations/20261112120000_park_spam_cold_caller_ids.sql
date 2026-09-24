-- Park spam-flagged and high-risk cold caller IDs from the prospecting
-- dialer allowlist. Twilio ownership and inbound callback routing stay in
-- place; this only removes the numbers from outbound session authorization.
--
-- Parked (do not release):
--   +18162538313  (816) 253-8313  hard spam/scam flag
--   +18166408032  (816) 640-8032  hard spam/scam flag
--   +18163100845  (816) 310-0845  elevated / high risk
--   +18164761589  (816) 476-1589  elevated / high risk
--
-- Still outbound-eligible:
--   +18166404701, +18165788107, +18166536616, +18164761344

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

  IF function_definition !~ '\+18163100845'
    OR function_definition !~ '\+18162538313'
    OR function_definition !~ '\+18164761589'
    OR function_definition !~ '\+18166408032'
    OR (length(function_definition) - length(replace(function_definition, allowlist_marker, '')))
         / length(allowlist_marker) <> 1
  THEN
    RAISE EXCEPTION 'unexpected_start_prospecting_dialer_session_v4_caller_allowlist';
  END IF;

  updated_definition := regexp_replace(
    function_definition,
    'allowed_caller_ids constant text\[\] := ARRAY\[[^]]+\];',
    $array$allowed_caller_ids constant text[] := ARRAY['+18166404701', '+18165788107', '+18166536616', '+18164761344'];$array$
  );

  IF updated_definition = function_definition
    OR updated_definition ~ '\+18163100845'
    OR updated_definition ~ '\+18162538313'
    OR updated_definition ~ '\+18164761589'
    OR updated_definition ~ '\+18166408032'
    OR updated_definition !~ '\+18166404701'
    OR updated_definition !~ '\+18165788107'
    OR updated_definition !~ '\+18166536616'
    OR updated_definition !~ '\+18164761344'
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
