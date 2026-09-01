-- Active dialer campaigns are shared calling work for authenticated acquisitions
-- operators. Preserve the operator's identity on the dialer session while allowing
-- them to read the active campaign audience and start/resume the campaign.
--
-- This is a forward-only repair because production skipped the earlier
-- 20261024123000 migration before later dialer-control migrations were applied.
-- Draft, paused, archived, and non-dialer campaigns remain owner-only.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $$
DECLARE
  function_definition text;
  function_signature constant text :=
    'public.start_prospecting_dialer_session_v4(uuid,text,text,text,jsonb)';
  owner_guard constant text :=
    'WHERE id = p_campaign_id AND lower(owner_email) = actor_key';
  team_guard constant text :=
    'WHERE id = p_campaign_id AND (lower(owner_email) = actor_key OR (kind = ''dialer'' AND status = ''active''))';
BEGIN
  SELECT pg_get_functiondef(function_signature::regprocedure)
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4_missing';
  END IF;

  IF position(team_guard IN function_definition) = 0 THEN
    IF position(owner_guard IN function_definition) = 0 THEN
      RAISE EXCEPTION 'start_prospecting_dialer_session_v4_guard_changed';
    END IF;
    function_definition := replace(function_definition, owner_guard, team_guard);
    IF position(owner_guard IN function_definition) > 0
      OR position(team_guard IN function_definition) = 0
    THEN
      RAISE EXCEPTION 'start_prospecting_dialer_session_v4_team_guard_patch_failed';
    END IF;
    EXECUTE function_definition;
  END IF;
END
$$;

DO $$
DECLARE
  function_definition text;
  function_signature constant text :=
    'public.prospecting_campaign_member_page_v3(text,uuid,text,text,integer,timestamp with time zone,uuid)';
  owner_guard constant text :=
    'WHERE campaign.id = p_campaign_id AND lower(campaign.owner_email) = clean_actor;';
  team_guard constant text :=
    'WHERE campaign.id = p_campaign_id AND (lower(campaign.owner_email) = clean_actor OR (campaign.kind = ''dialer'' AND campaign.status = ''active''));';
BEGIN
  SELECT pg_get_functiondef(function_signature::regprocedure)
  INTO function_definition;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'prospecting_campaign_member_page_v3_missing';
  END IF;

  IF position(team_guard IN function_definition) = 0 THEN
    IF position(owner_guard IN function_definition) = 0 THEN
      RAISE EXCEPTION 'prospecting_campaign_member_page_v3_guard_changed';
    END IF;
    function_definition := replace(function_definition, owner_guard, team_guard);
    IF position(owner_guard IN function_definition) > 0
      OR position(team_guard IN function_definition) = 0
    THEN
      RAISE EXCEPTION 'prospecting_campaign_member_page_v3_team_guard_patch_failed';
    END IF;
    EXECUTE function_definition;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamptz, uuid)
  TO service_role;
