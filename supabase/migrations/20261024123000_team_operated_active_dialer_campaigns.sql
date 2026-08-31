-- Active dialer campaigns are operated by the acquisitions team rather than
-- locked to the employee who originally created the campaign. The web server
-- authenticates the operator and this RPC remains service-role-only. Draft,
-- paused, archived, and SMS campaign administration remains owner-only.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $$
DECLARE
  function_definition text;
  owner_guard constant text := 'WHERE id = p_campaign_id AND lower(owner_email) = actor_key';
  team_guard constant text := 'WHERE id = p_campaign_id AND (lower(owner_email) = actor_key OR (kind = ''dialer'' AND status = ''active''))';
BEGIN
  SELECT pg_get_functiondef(
    'public.start_prospecting_dialer_session_v4(uuid,text,text,text,jsonb)'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL OR position(owner_guard IN function_definition) = 0 THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4 owner guard changed; refusing unsafe patch';
  END IF;

  function_definition := replace(function_definition, owner_guard, team_guard);
  IF position(owner_guard IN function_definition) > 0 OR position(team_guard IN function_definition) = 0 THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4 team guard patch failed';
  END IF;

  EXECUTE function_definition;
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  TO service_role;
