-- Durable stop requests for the single-line dialer.
--
-- Ending a session while a call is active is a two-phase transition:
-- request_stop persists the operator's intent immediately; the active call is
-- then wrapped up and dispositioned before stop finalizes the session. New
-- attempts and queue advancement fail closed as soon as stop is requested.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.dialer_session_json_v1(p_session public.dialer_sessions)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', p_session.id,
    'status', p_session.status,
    'actorEmail', p_session.actor_email,
    'agentName', p_session.agent_name,
    'queueKey', p_session.queue_key,
    'savedQueueId', p_session.saved_queue_id,
    'leadIds', CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(p_session.queue_snapshot, '[]'::jsonb)) item
        WHERE jsonb_typeof(item) <> 'string'
      ) THEN p_session.queue_snapshot
      ELSE '[]'::jsonb
    END,
    'queueItems', public.dialer_session_queue_items_v2(p_session.queue_snapshot),
    'queueSize', p_session.queue_size,
    'currentIndex', p_session.current_index,
    'currentLeadId', p_session.current_lead_id,
    'currentProspectId', p_session.current_prospect_id,
    'currentSubjectKind', p_session.current_subject_kind,
    'currentSubjectId', p_session.current_subject_id,
    'currentCampaignMemberId', p_session.current_campaign_member_id,
    'callerId', p_session.caller_id,
    'dialsCompleted', p_session.dials_completed,
    'contacts', p_session.contacts,
    'skips', p_session.skips,
    'outcomes', p_session.outcomes,
    'startedAt', p_session.started_at,
    'pausedAt', p_session.paused_at,
    'stopRequestedAt', p_session.stop_requested_at,
    'endedAt', p_session.ended_at,
    'updatedAt', p_session.updated_at,
    'stateVersion', p_session.state_version
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_dialer_session_v1(
  p_session_id uuid,
  p_actor_email text,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  next_index integer;
  next_item jsonb;
  open_attempt boolean;
  event_name text;
BEGIN
  SELECT * INTO session_row FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  IF p_action IN ('pause', 'stop', 'skip') AND EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = session_row.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) THEN RAISE EXCEPTION 'call_in_progress'; END IF;

  IF p_action = 'request_stop' THEN
    IF session_row.status = 'stopped' THEN
      RETURN public.dialer_session_json_v1(session_row);
    END IF;
    IF session_row.status NOT IN ('active', 'paused') THEN
      RAISE EXCEPTION 'invalid_session_transition';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.dialer_session_attempts
      WHERE session_id = session_row.id
        AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
    ) INTO open_attempt;
    IF open_attempt THEN
      IF session_row.stop_requested_at IS NOT NULL THEN
        RETURN public.dialer_session_json_v1(session_row);
      END IF;
      UPDATE public.dialer_sessions
      SET stop_requested_at = now(), updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
      event_name := 'session_stop_requested';
    ELSE
      UPDATE public.dialer_sessions
      SET status = 'stopped', stop_requested_at = coalesce(stop_requested_at, now()),
          ended_at = coalesce(ended_at, now()), updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
      event_name := 'session_stop';
    END IF;
  ELSIF p_action = 'pause' THEN
    IF session_row.status <> 'active' OR session_row.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions SET status = 'paused', paused_at = now(), updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
    event_name := 'session_pause';
  ELSIF p_action = 'resume' THEN
    IF session_row.status <> 'paused' OR session_row.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions SET status = 'active', paused_at = NULL, updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
    event_name := 'session_resume';
  ELSIF p_action = 'stop' THEN
    IF session_row.status = 'stopped' THEN RETURN public.dialer_session_json_v1(session_row); END IF;
    IF session_row.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions
    SET status = 'stopped', stop_requested_at = coalesce(stop_requested_at, now()),
        ended_at = coalesce(ended_at, now()), updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
    event_name := 'session_stop';
  ELSIF p_action = 'skip' THEN
    IF session_row.status <> 'active' OR session_row.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'skip_reason_required'; END IF;
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes
    ) VALUES (
      session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
      session_row.current_subject_kind, session_row.current_subject_id,
      session_row.current_campaign_member_id, 'subject_skipped', trim(p_reason)
    );
    next_index := session_row.current_index + 1;
    IF next_index >= session_row.queue_size THEN
      UPDATE public.dialer_sessions
      SET status = 'completed', ended_at = now(), skips = skips + 1,
          updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
    ELSE
      next_item := public.dialer_queue_item_v2(session_row.queue_snapshot, next_index);
      UPDATE public.dialer_sessions
      SET current_index = next_index,
          current_subject_kind = next_item ->> 'kind',
          current_subject_id = (next_item ->> 'id')::uuid,
          current_lead_id = CASE WHEN next_item ->> 'kind' = 'lead' THEN (next_item ->> 'id')::uuid END,
          current_prospect_id = CASE WHEN next_item ->> 'kind' = 'prospect' THEN (next_item ->> 'id')::uuid END,
          current_campaign_member_id = nullif(next_item ->> 'campaignMemberId', '')::uuid,
          skips = skips + 1, updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
    END IF;
    event_name := 'session_skip';
  ELSE RAISE EXCEPTION 'invalid_session_action'; END IF;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, notes
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id, event_name, nullif(trim(p_reason), '')
  );
  RETURN public.dialer_session_json_v1(session_row);
END
$$;

REVOKE ALL ON FUNCTION public.transition_dialer_session_v1(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_dialer_session_v1(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_dialer_attempt_v2(
  p_session_id uuid,
  p_actor_email text,
  p_client_attempt_id text,
  p_subject_kind text,
  p_subject_id uuid,
  p_campaign_member_id uuid,
  p_lead_id uuid,
  p_prospect_id uuid,
  p_prospect_phone_id uuid,
  p_phone text,
  p_caller_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  attempt_row public.dialer_session_attempts;
BEGIN
  SELECT * INTO session_row FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status <> 'active' THEN RAISE EXCEPTION 'session_not_active'; END IF;
  IF session_row.stop_requested_at IS NOT NULL THEN RAISE EXCEPTION 'session_stop_requested'; END IF;
  IF session_row.current_subject_kind IS DISTINCT FROM p_subject_kind
    OR session_row.current_subject_id IS DISTINCT FROM p_subject_id
    OR session_row.current_campaign_member_id IS DISTINCT FROM p_campaign_member_id
  THEN RAISE EXCEPTION 'session_subject_mismatch'; END IF;
  IF (p_subject_kind = 'lead' AND (p_lead_id IS DISTINCT FROM p_subject_id OR p_prospect_id IS NOT NULL))
    OR (p_subject_kind = 'prospect' AND (p_prospect_id IS DISTINCT FROM p_subject_id OR p_lead_id IS NOT NULL))
    OR p_subject_kind NOT IN ('lead', 'prospect')
  THEN RAISE EXCEPTION 'attempt_context_mismatch'; END IF;
  IF p_prospect_phone_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.prospect_phones phone
    JOIN public.prospects prospect ON prospect.id = phone.prospect_id
    WHERE phone.id = p_prospect_phone_id
      AND (
        (p_subject_kind = 'prospect' AND prospect.id = p_subject_id)
        OR (p_subject_kind = 'lead' AND prospect.lead_id = p_subject_id)
      )
  ) THEN RAISE EXCEPTION 'attempt_context_mismatch'; END IF;
  IF p_subject_kind = 'prospect' AND p_prospect_phone_id IS NULL THEN RAISE EXCEPTION 'attempt_context_mismatch'; END IF;

  SELECT * INTO attempt_row FROM public.dialer_session_attempts
  WHERE client_attempt_id = trim(p_client_attempt_id);
  IF FOUND THEN
    IF attempt_row.session_id <> session_row.id
      OR attempt_row.subject_kind IS DISTINCT FROM p_subject_kind
      OR attempt_row.subject_id IS DISTINCT FROM p_subject_id
    THEN RAISE EXCEPTION 'attempt_context_mismatch'; END IF;
    RETURN to_jsonb(attempt_row);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = session_row.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) THEN RAISE EXCEPTION 'attempt_in_progress'; END IF;

  INSERT INTO public.dialer_session_attempts (
    session_id, client_attempt_id, subject_kind, subject_id, campaign_member_id,
    lead_id, prospect_id, prospect_phone_id, phone, caller_id
  ) VALUES (
    session_row.id, trim(p_client_attempt_id), p_subject_kind, p_subject_id,
    p_campaign_member_id, p_lead_id, p_prospect_id, p_prospect_phone_id,
    trim(p_phone), trim(p_caller_id)
  ) RETURNING * INTO attempt_row;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, phone, metadata
  ) VALUES (
    session_row.id, p_lead_id, p_prospect_id, p_subject_kind, p_subject_id,
    p_campaign_member_id, 'attempt_authorized', trim(p_phone),
    jsonb_build_object('client_attempt_id', trim(p_client_attempt_id), 'prospect_phone_id', p_prospect_phone_id)
  );
  RETURN to_jsonb(attempt_row);
END
$$;

REVOKE ALL ON FUNCTION public.authorize_dialer_attempt_v2(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_dialer_attempt_v2(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.advance_dialer_session_v1(
  p_session_id uuid,
  p_actor_email text,
  p_client_attempt_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  attempt_row public.dialer_session_attempts;
  next_index integer;
  next_item jsonb;
BEGIN
  SELECT * INTO session_row FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status = 'stopped' AND session_row.stop_requested_at IS NOT NULL THEN
    RETURN public.dialer_session_json_v1(session_row);
  END IF;
  IF session_row.status <> 'active' THEN RAISE EXCEPTION 'session_not_active'; END IF;
  SELECT * INTO attempt_row FROM public.dialer_session_attempts
  WHERE session_id = session_row.id AND client_attempt_id = trim(p_client_attempt_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF attempt_row.status <> 'dispositioned' THEN RAISE EXCEPTION 'disposition_required'; END IF;
  IF attempt_row.advanced_at IS NOT NULL THEN RETURN public.dialer_session_json_v1(session_row); END IF;
  IF coalesce(attempt_row.subject_kind, 'lead') IS DISTINCT FROM coalesce(session_row.current_subject_kind, 'lead')
    OR coalesce(attempt_row.subject_id, attempt_row.lead_id) IS DISTINCT FROM coalesce(session_row.current_subject_id, session_row.current_lead_id)
  THEN RAISE EXCEPTION 'session_subject_mismatch'; END IF;

  UPDATE public.dialer_session_attempts SET advanced_at = now(), updated_at = now() WHERE id = attempt_row.id;
  IF session_row.stop_requested_at IS NOT NULL THEN
    UPDATE public.dialer_sessions
    SET status = 'stopped', ended_at = coalesce(ended_at, now()),
        updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
  ELSE
    next_index := session_row.current_index + 1;
    IF next_index >= session_row.queue_size THEN
      UPDATE public.dialer_sessions
      SET status = 'completed', ended_at = now(), updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
    ELSE
      next_item := public.dialer_queue_item_v2(session_row.queue_snapshot, next_index);
      UPDATE public.dialer_sessions
      SET current_index = next_index,
          current_subject_kind = next_item ->> 'kind',
          current_subject_id = (next_item ->> 'id')::uuid,
          current_lead_id = CASE WHEN next_item ->> 'kind' = 'lead' THEN (next_item ->> 'id')::uuid END,
          current_prospect_id = CASE WHEN next_item ->> 'kind' = 'prospect' THEN (next_item ->> 'id')::uuid END,
          current_campaign_member_id = nullif(next_item ->> 'campaignMemberId', '')::uuid,
          updated_at = now(), state_version = state_version + 1
      WHERE id = session_row.id RETURNING * INTO session_row;
    END IF;
  END IF;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, disposition, phone, metadata
  ) VALUES (
    session_row.id, attempt_row.lead_id, attempt_row.prospect_id,
    attempt_row.subject_kind, attempt_row.subject_id, attempt_row.campaign_member_id,
    'subject_completed', attempt_row.disposition, attempt_row.phone,
    jsonb_build_object('client_attempt_id', attempt_row.client_attempt_id, 'prospect_phone_id', attempt_row.prospect_phone_id)
  );
  IF session_row.status = 'stopped' THEN
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes
    ) VALUES (
      session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
      session_row.current_subject_kind, session_row.current_subject_id,
      session_row.current_campaign_member_id, 'session_stop', 'Stop finalized after call outcome'
    );
  END IF;
  RETURN public.dialer_session_json_v1(session_row);
END
$$;

REVOKE ALL ON FUNCTION public.advance_dialer_session_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_dialer_session_v1(uuid, text, text) TO service_role;
