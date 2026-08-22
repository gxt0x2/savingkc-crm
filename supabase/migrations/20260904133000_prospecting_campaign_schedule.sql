-- LaunchControl-style operator schedule controls. V2 wrappers keep the
-- existing V1 boundaries available during a zero-downtime application rollout
-- while atomically persisting send days and the local-time window.

CREATE OR REPLACE FUNCTION public.validate_prospecting_schedule_v1(
  p_send_window_start time,
  p_send_window_end time,
  p_send_days smallint[]
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_send_window_start IS NULL OR p_send_window_end IS NULL OR p_send_window_start >= p_send_window_end THEN
    RAISE EXCEPTION 'invalid_campaign_schedule';
  END IF;
  IF p_send_days IS NULL
    OR cardinality(p_send_days) NOT BETWEEN 1 AND 7
    OR EXISTS (SELECT 1 FROM unnest(p_send_days) day WHERE day NOT BETWEEN 0 AND 6)
    OR (SELECT count(DISTINCT day) FROM unnest(p_send_days) day) <> cardinality(p_send_days) THEN
    RAISE EXCEPTION 'invalid_campaign_schedule';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.validate_prospecting_schedule_v1(time, time, smallint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_prospecting_schedule_v1(time, time, smallint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.create_prospecting_campaign_v2(
  p_owner_email text,
  p_owner_name text,
  p_name text,
  p_kind text,
  p_caller_id text,
  p_from_phone text,
  p_default_timezone text,
  p_send_window_start time,
  p_send_window_end time,
  p_send_days smallint[],
  p_per_hour integer,
  p_per_day integer,
  p_steps jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_id uuid;
BEGIN
  PERFORM public.validate_prospecting_schedule_v1(p_send_window_start, p_send_window_end, p_send_days);
  campaign_id := public.create_prospecting_campaign_v1(
    p_owner_email, p_owner_name, p_name, p_kind, p_caller_id, p_from_phone,
    p_default_timezone, p_per_hour, p_per_day, p_steps
  );
  UPDATE public.prospecting_campaigns
  SET send_window_start = p_send_window_start,
      send_window_end = p_send_window_end,
      send_days = p_send_days,
      updated_at = now()
  WHERE id = campaign_id;
  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (campaign_id, 'campaign_schedule_set', trim(p_owner_name), jsonb_build_object(
    'send_window_start', p_send_window_start,
    'send_window_end', p_send_window_end,
    'send_days', to_jsonb(p_send_days)
  ));
  RETURN campaign_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_prospecting_campaign_v2(text, text, text, text, text, text, text, time, time, smallint[], integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_prospecting_campaign_v2(text, text, text, text, text, text, text, time, time, smallint[], integer, integer, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.update_prospecting_campaign_draft_v2(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_name text,
  p_kind text,
  p_caller_id text,
  p_from_phone text,
  p_default_timezone text,
  p_send_window_start time,
  p_send_window_end time,
  p_send_days smallint[],
  p_per_hour integer,
  p_per_day integer,
  p_steps jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_id uuid;
BEGIN
  PERFORM public.validate_prospecting_schedule_v1(p_send_window_start, p_send_window_end, p_send_days);
  campaign_id := public.update_prospecting_campaign_draft_v1(
    p_campaign_id, p_actor_email, p_actor_name, p_name, p_kind, p_caller_id,
    p_from_phone, p_default_timezone, p_per_hour, p_per_day, p_steps
  );
  UPDATE public.prospecting_campaigns
  SET send_window_start = p_send_window_start,
      send_window_end = p_send_window_end,
      send_days = p_send_days,
      updated_at = now()
  WHERE id = campaign_id;
  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (campaign_id, 'campaign_schedule_updated', trim(p_actor_name), jsonb_build_object(
    'send_window_start', p_send_window_start,
    'send_window_end', p_send_window_end,
    'send_days', to_jsonb(p_send_days)
  ));
  RETURN campaign_id;
END
$$;

REVOKE ALL ON FUNCTION public.update_prospecting_campaign_draft_v2(uuid, text, text, text, text, text, text, text, time, time, smallint[], integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_prospecting_campaign_draft_v2(uuid, text, text, text, text, text, text, text, time, time, smallint[], integer, integer, jsonb) TO service_role;
