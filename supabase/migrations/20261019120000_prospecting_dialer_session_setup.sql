-- Durable agent-facing setup for the single-line Prospecting dialer.
-- Caller IDs are restricted to cold-call-designated lines, queue eligibility
-- is bounded by recorded attempts/recency, and the final attempt boundary
-- rechecks the same policy before a call can be authorized.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE INDEX IF NOT EXISTS idx_dialer_attempts_normalized_phone_created
  ON public.dialer_session_attempts (
    public.prospecting_phone_key_v1(phone),
    created_at DESC
  )
  WHERE status IN ('dialing', 'connected', 'awaiting_disposition', 'dispositioned');

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
    'settingsSnapshot', coalesce(p_session.settings_snapshot, '{}'::jsonb),
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

CREATE OR REPLACE FUNCTION public.prospecting_dialer_phone_is_eligible_v1(
  p_phone text,
  p_session_setup jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.prospecting_phone_key_v1(p_phone) <> ''
    AND (
      SELECT count(*)
      FROM public.dialer_session_attempts attempt
      WHERE public.prospecting_phone_key_v1(attempt.phone) = public.prospecting_phone_key_v1(p_phone)
        AND attempt.status IN ('dialing', 'connected', 'awaiting_disposition', 'dispositioned')
    ) < coalesce((p_session_setup ->> 'maxAttemptsPerNumber')::integer, 7)
    AND (
      nullif(p_session_setup ->> 'notDialedHours', '') IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.dialer_session_attempts attempt
        WHERE public.prospecting_phone_key_v1(attempt.phone) = public.prospecting_phone_key_v1(p_phone)
          AND attempt.status IN ('dialing', 'connected', 'awaiting_disposition', 'dispositioned')
          AND attempt.created_at >= now() - make_interval(hours => (p_session_setup ->> 'notDialedHours')::integer)
      )
    )
    AND (
      nullif(p_session_setup ->> 'notContactedHours', '') IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.dialer_session_attempts attempt
        WHERE public.prospecting_phone_key_v1(attempt.phone) = public.prospecting_phone_key_v1(p_phone)
          AND attempt.reached = true
          AND attempt.created_at >= now() - make_interval(hours => (p_session_setup ->> 'notContactedHours')::integer)
      )
    )
$$;

REVOKE ALL ON FUNCTION public.prospecting_dialer_phone_is_eligible_v1(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_dialer_phone_is_eligible_v1(text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v4(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_caller_id text,
  p_session_setup jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  campaign_row public.prospecting_campaigns;
  open_session public.dialer_sessions;
  member_ids uuid[];
  queue_items jsonb;
  session_result jsonb;
  session_id uuid;
  remaining integer;
  setup jsonb := coalesce(p_session_setup, '{}'::jsonb);
  start_behavior text;
  caller_mode text;
  caller_ids text[];
  max_attempts integer;
  not_dialed_hours integer;
  not_contacted_hours integer;
  session_settings jsonb;
  allowed_caller_ids constant text[] := ARRAY[
    '+18163100845', '+18162538313', '+18164761589', '+18166404701',
    '+18165788107', '+18166408032', '+18166536616', '+18164761344'
  ];
BEGIN
  IF actor_key = '' OR coalesce(trim(p_actor_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF jsonb_typeof(setup) <> 'object' THEN RAISE EXCEPTION 'invalid_session_setup'; END IF;

  start_behavior := lower(trim(coalesce(setup ->> 'startBehavior', 'resume')));
  caller_mode := lower(trim(coalesce(setup ->> 'callerMode', 'static')));
  max_attempts := coalesce((setup ->> 'maxAttemptsPerNumber')::integer, 7);
  not_dialed_hours := nullif(setup ->> 'notDialedHours', '')::integer;
  not_contacted_hours := nullif(setup ->> 'notContactedHours', '')::integer;

  IF start_behavior NOT IN ('resume', 'first_unworked')
    OR caller_mode NOT IN ('static', 'rotation')
    OR max_attempts NOT BETWEEN 4 AND 7
    OR (not_dialed_hours IS NOT NULL AND not_dialed_hours NOT IN (24, 72, 168, 336, 720))
    OR (not_contacted_hours IS NOT NULL AND not_contacted_hours NOT IN (24, 72, 168, 336, 720))
    OR jsonb_typeof(setup -> 'callerIds') <> 'array'
  THEN RAISE EXCEPTION 'invalid_session_setup'; END IF;

  SELECT array_agg(value ORDER BY ordinal)
  INTO caller_ids
  FROM jsonb_array_elements_text(setup -> 'callerIds') WITH ORDINALITY AS selected(value, ordinal);
  IF coalesce(cardinality(caller_ids), 0) < 1
    OR cardinality(caller_ids) > (CASE WHEN caller_mode = 'rotation' THEN 5 ELSE 1 END)
    OR cardinality(caller_ids) <> (SELECT count(DISTINCT value) FROM unnest(caller_ids) value)
    OR EXISTS (SELECT 1 FROM unnest(caller_ids) value WHERE value <> ALL(allowed_caller_ids))
    OR trim(coalesce(p_caller_id, '')) IS DISTINCT FROM caller_ids[1]
  THEN RAISE EXCEPTION 'invalid_caller_id'; END IF;

  setup := jsonb_build_object(
    'startBehavior', start_behavior,
    'callerMode', caller_mode,
    'callerIds', to_jsonb(caller_ids),
    'maxAttemptsPerNumber', max_attempts,
    'notDialedHours', not_dialed_hours,
    'notContactedHours', not_contacted_hours
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0));

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = actor_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  IF campaign_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;

  session_settings := jsonb_build_object(
    'prospectingCampaignId', p_campaign_id,
    'campaignName', campaign_row.name,
    'startBehavior', start_behavior,
    'prospectingSession', setup,
    'callerPlan', jsonb_build_object(
      'mode', caller_mode,
      'staticCallerId', caller_ids[1],
      'rotationCallerIds', CASE WHEN caller_mode = 'rotation' THEN to_jsonb(caller_ids) ELSE '[]'::jsonb END,
      'rotateEveryCalls', 1,
      'redialCallerId', NULL
    )
  );

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
      IF EXISTS (
        SELECT 1 FROM public.dialer_session_attempts
        WHERE session_id = open_session.id
          AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
      ) THEN RAISE EXCEPTION 'call_in_progress'; END IF;
      UPDATE public.dialer_sessions
      SET status = 'active', paused_at = NULL, caller_id = caller_ids[1],
          settings_snapshot = session_settings, updated_at = now(), state_version = state_version + 1
      WHERE id = open_session.id
      RETURNING * INTO open_session;
      INSERT INTO public.dialer_session_events (
        session_id, lead_id, prospect_id, subject_kind, subject_id,
        campaign_member_id, event_type, notes, metadata
      ) VALUES (
        open_session.id, open_session.current_lead_id, open_session.current_prospect_id,
        open_session.current_subject_kind, open_session.current_subject_id,
        open_session.current_campaign_member_id, 'session_resume', 'Resumed from campaign workspace',
        jsonb_build_object('session_setup', setup)
      );
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
        WHERE contact.member_id = member.id
          AND contact.status = 'ready'
          AND public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)
      )
    ORDER BY member.enrolled_at, member.id
    LIMIT 100
    FOR UPDATE
  ) candidate;
  IF coalesce(jsonb_array_length(queue_items), 0) = 0 THEN RAISE EXCEPTION 'campaign_session_filters_empty'; END IF;

  session_result := public.start_dialer_session_v2(
    actor_key, trim(p_actor_name), 'campaign:' || p_campaign_id::text,
    queue_items, caller_ids[1], NULL, session_settings
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
    'session_setup', setup
  ));

  RETURN session_result || jsonb_build_object(
    'batchSize', jsonb_array_length(queue_items),
    'remaining', remaining
  );
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_dialer_attempt_v3(
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
  setup jsonb;
  caller_plan jsonb;
  normalized_phone text := public.prospecting_phone_key_v1(p_phone);
BEGIN
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE client_attempt_id = trim(p_client_attempt_id)
  ) THEN
    RETURN public.authorize_dialer_attempt_v2(
      p_session_id, p_actor_email, p_client_attempt_id, p_subject_kind,
      p_subject_id, p_campaign_member_id, p_lead_id, p_prospect_id,
      p_prospect_phone_id, p_phone, p_caller_id
    );
  END IF;

  setup := session_row.settings_snapshot -> 'prospectingSession';
  caller_plan := session_row.settings_snapshot -> 'callerPlan';
  IF setup IS NOT NULL THEN
    IF jsonb_typeof(setup) <> 'object' OR jsonb_typeof(caller_plan) <> 'object' THEN
      RAISE EXCEPTION 'invalid_session_setup';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN caller_plan ->> 'mode' = 'rotation' THEN caller_plan -> 'rotationCallerIds'
          ELSE jsonb_build_array(caller_plan ->> 'staticCallerId')
        END
      ) allowed(value)
      WHERE allowed.value = trim(p_caller_id)
    ) THEN RAISE EXCEPTION 'invalid_caller_id'; END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-phone:' || normalized_phone, 0));
    IF NOT public.prospecting_dialer_phone_is_eligible_v1(p_phone, setup) THEN
      IF (
        SELECT count(*) FROM public.dialer_session_attempts attempt
        WHERE public.prospecting_phone_key_v1(attempt.phone) = normalized_phone
          AND attempt.status IN ('dialing', 'connected', 'awaiting_disposition', 'dispositioned')
      ) >= (setup ->> 'maxAttemptsPerNumber')::integer THEN
        RAISE EXCEPTION 'dialer_attempt_limit';
      END IF;
      IF nullif(setup ->> 'notContactedHours', '') IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.dialer_session_attempts attempt
        WHERE public.prospecting_phone_key_v1(attempt.phone) = normalized_phone
          AND attempt.reached = true
          AND attempt.created_at >= now() - make_interval(hours => (setup ->> 'notContactedHours')::integer)
      ) THEN RAISE EXCEPTION 'dialer_recently_contacted'; END IF;
      RAISE EXCEPTION 'dialer_recently_dialed';
    END IF;
  END IF;

  RETURN public.authorize_dialer_attempt_v2(
    p_session_id, p_actor_email, p_client_attempt_id, p_subject_kind,
    p_subject_id, p_campaign_member_id, p_lead_id, p_prospect_id,
    p_prospect_phone_id, p_phone, p_caller_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.authorize_dialer_attempt_v3(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_dialer_attempt_v3(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text)
  TO service_role;
