-- Let an owner correct a campaign draft in place without replacing its
-- audience or creating a second campaign. Live and previously run campaigns
-- remain immutable through this setup boundary.
-- hygiene-approved-destructive: replace only mutable draft step rows after
-- locking the campaign and proving it has no execution actions; the audit event
-- preserves who changed the setup and the audience is never deleted.

CREATE OR REPLACE FUNCTION public.update_prospecting_campaign_draft_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_name text,
  p_kind text,
  p_caller_id text,
  p_from_phone text,
  p_default_timezone text,
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
  campaign_row public.prospecting_campaigns;
  step_value jsonb;
  step_position integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR coalesce(trim(p_actor_email), '') = '' OR coalesce(trim(p_actor_name), '') = '' THEN
    RAISE EXCEPTION 'invalid_campaign_actor';
  END IF;
  IF jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 12 THEN
    RAISE EXCEPTION 'invalid_campaign_steps';
  END IF;
  IF p_kind = 'dialer' AND jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 0 THEN RAISE EXCEPTION 'dialer_campaign_steps_not_supported'; END IF;
  IF p_kind = 'sms' AND jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) < 1 THEN RAISE EXCEPTION 'campaign_has_no_steps'; END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id
    AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status <> 'draft' THEN RAISE EXCEPTION 'campaign_setup_locked'; END IF;
  IF EXISTS (SELECT 1 FROM public.prospecting_campaign_actions WHERE campaign_id = p_campaign_id) THEN
    RAISE EXCEPTION 'campaign_setup_locked';
  END IF;

  UPDATE public.prospecting_campaigns
    SET name = trim(p_name),
        kind = p_kind,
        caller_id = CASE WHEN p_kind = 'dialer' THEN nullif(trim(p_caller_id), '') ELSE NULL END,
        from_phone = CASE WHEN p_kind = 'sms' THEN nullif(trim(p_from_phone), '') ELSE NULL END,
        default_timezone = coalesce(nullif(trim(p_default_timezone), ''), 'America/Chicago'),
        per_hour = p_per_hour,
        per_day = p_per_day,
        updated_at = now()
    WHERE id = p_campaign_id;

  DELETE FROM public.prospecting_campaign_steps WHERE campaign_id = p_campaign_id;

  FOR step_value IN SELECT value FROM jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  LOOP
    step_position := step_position + 1;
    INSERT INTO public.prospecting_campaign_steps (campaign_id, position, delay_minutes, body_template)
    VALUES (
      p_campaign_id,
      step_position,
      greatest(0, least(43200, coalesce((step_value ->> 'delayMinutes')::integer, 0))),
      trim(coalesce(step_value ->> 'bodyTemplate', ''))
    );
  END LOOP;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'campaign_setup_updated',
    trim(p_actor_name),
    jsonb_build_object('previous_kind', campaign_row.kind, 'kind', p_kind, 'steps', step_position)
  );

  RETURN p_campaign_id;
END
$$;

REVOKE ALL ON FUNCTION public.update_prospecting_campaign_draft_v1(uuid, text, text, text, text, text, text, text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_prospecting_campaign_draft_v1(uuid, text, text, text, text, text, text, text, integer, integer, jsonb) TO service_role;
