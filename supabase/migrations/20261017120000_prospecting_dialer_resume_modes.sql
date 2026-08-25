-- Make the operator's campaign-start choice explicit and durable.
-- Resume is the safe default. "First unworked" closes only the same
-- campaign's idle/paused session, releases unfinished members, and rebuilds
-- the next batch in original enrollment order. It never resets completed work.

CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v3(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_caller_id text,
  p_start_behavior text DEFAULT 'resume'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  start_behavior text := lower(trim(coalesce(p_start_behavior, 'resume')));
  campaign_row public.prospecting_campaigns;
  open_session public.dialer_sessions;
  member_ids uuid[];
  queue_items jsonb;
  session_result jsonb;
  session_id uuid;
  remaining integer;
BEGIN
  IF actor_key = '' OR coalesce(trim(p_actor_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF start_behavior NOT IN ('resume', 'first_unworked') THEN RAISE EXCEPTION 'invalid_start_behavior'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0));

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = actor_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  IF campaign_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;
  IF nullif(trim(coalesce(p_caller_id, '')), '') IS NULL
    OR trim(p_caller_id) IS DISTINCT FROM trim(campaign_row.caller_id)
  THEN RAISE EXCEPTION 'invalid_caller_id'; END IF;

  SELECT * INTO open_session
  FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF open_session.prospecting_campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'another_dialer_session_open';
    END IF;
    IF open_session.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'session_stop_requested'; END IF;

    IF start_behavior = 'resume' THEN
      IF open_session.status = 'paused' THEN
        UPDATE public.dialer_sessions
        SET status = 'active', paused_at = NULL, updated_at = now(), state_version = state_version + 1
        WHERE id = open_session.id
        RETURNING * INTO open_session;
        INSERT INTO public.dialer_session_events (
          session_id, lead_id, prospect_id, subject_kind, subject_id,
          campaign_member_id, event_type, notes
        ) VALUES (
          open_session.id, open_session.current_lead_id, open_session.current_prospect_id,
          open_session.current_subject_kind, open_session.current_subject_id,
          open_session.current_campaign_member_id, 'session_resume', 'Resumed from campaign workspace'
        );
      END IF;
      RETURN jsonb_build_object(
        'created', false,
        'session', public.dialer_session_json_v1(open_session),
        'batchSize', open_session.queue_size,
        'remaining', (
          SELECT count(*) FROM public.prospecting_campaign_members
          WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL
        )
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.dialer_session_attempts
      WHERE session_id = open_session.id
        AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
    ) THEN RAISE EXCEPTION 'call_in_progress'; END IF;

    UPDATE public.dialer_sessions
    SET status = 'stopped', stop_requested_at = coalesce(stop_requested_at, now()),
        ended_at = coalesce(ended_at, now()), updated_at = now(), state_version = state_version + 1
    WHERE id = open_session.id;
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes
    ) VALUES (
      open_session.id, open_session.current_lead_id, open_session.current_prospect_id,
      open_session.current_subject_kind, open_session.current_subject_id,
      open_session.current_campaign_member_id, 'session_stop', 'Restarted from first unworked seller'
    );
  END IF;

  SELECT
    array_agg(candidate.id ORDER BY candidate.enrolled_at, candidate.id),
    jsonb_agg(jsonb_build_object(
      'kind', candidate.subject_kind,
      'id', coalesce(candidate.lead_id, candidate.prospect_id),
      'leadId', candidate.lead_id,
      'prospectId', candidate.prospect_id,
      'campaignMemberId', candidate.id
    ) ORDER BY candidate.enrolled_at, candidate.id)
  INTO member_ids, queue_items
  FROM (
    SELECT member.id, member.subject_kind, member.lead_id, member.prospect_id, member.enrolled_at
    FROM public.prospecting_campaign_members member
    WHERE member.campaign_id = p_campaign_id
      AND member.status = 'active'
      AND member.dialer_session_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.prospecting_campaign_member_contacts contact
        WHERE contact.member_id = member.id AND contact.status = 'ready'
      )
    ORDER BY member.enrolled_at, member.id
    LIMIT 100
    FOR UPDATE
  ) candidate;
  IF coalesce(jsonb_array_length(queue_items), 0) = 0 THEN RAISE EXCEPTION 'campaign_dialer_complete'; END IF;

  session_result := public.start_dialer_session_v2(
    actor_key, trim(p_actor_name), 'campaign:' || p_campaign_id::text,
    queue_items, trim(p_caller_id), NULL,
    jsonb_build_object(
      'prospectingCampaignId', p_campaign_id,
      'campaignName', campaign_row.name,
      'startBehavior', start_behavior
    )
  );
  session_id := (session_result -> 'session' ->> 'id')::uuid;

  UPDATE public.dialer_sessions
  SET prospecting_campaign_id = p_campaign_id
  WHERE id = session_id AND lower(actor_email) = actor_key;
  UPDATE public.prospecting_campaign_members
  SET dialer_session_id = session_id, updated_at = now()
  WHERE id = ANY(member_ids)
    AND campaign_id = p_campaign_id
    AND status = 'active'
    AND dialer_session_id IS NULL;

  SELECT count(*) INTO remaining
  FROM public.prospecting_campaign_members
  WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (p_campaign_id, 'dialer_batch_started', trim(p_actor_name), jsonb_build_object(
    'dialer_session_id', session_id,
    'batch_size', jsonb_array_length(queue_items),
    'remaining', remaining,
    'start_behavior', start_behavior
  ));

  RETURN session_result || jsonb_build_object(
    'batchSize', jsonb_array_length(queue_items),
    'remaining', remaining
  );
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v3(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v3(uuid, text, text, text, text)
  TO service_role;
