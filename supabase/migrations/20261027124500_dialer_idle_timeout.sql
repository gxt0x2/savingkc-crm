-- Five-minute inactivity boundary for durable dialer sessions.
--
-- Controller heartbeats prove that a browser still owns a session, but they
-- are not evidence that an agent is working. Real UI/session/call activity
-- advances last_interaction_at. An unattended open tab therefore expires at
-- the same deadline as a closed tab and cannot inflate acquisition metrics.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS idle_timeout_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS idle_timed_out_at timestamptz;

UPDATE public.dialer_sessions
SET last_interaction_at = coalesce(updated_at, started_at, now())
WHERE last_interaction_at IS NULL;

ALTER TABLE public.dialer_sessions
  ALTER COLUMN last_interaction_at SET DEFAULT now(),
  ALTER COLUMN last_interaction_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS dialer_sessions_idle_timeout_five_minutes,
  ADD CONSTRAINT dialer_sessions_idle_timeout_five_minutes
    CHECK (idle_timeout_seconds = 300) NOT VALID;

ALTER TABLE public.dialer_sessions
  VALIDATE CONSTRAINT dialer_sessions_idle_timeout_five_minutes;

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_open_idle_deadline
  ON public.dialer_sessions (last_interaction_at)
  WHERE status IN ('active', 'paused');

CREATE OR REPLACE FUNCTION public.dialer_session_json_v1(p_session public.dialer_sessions)
RETURNS jsonb
LANGUAGE sql
STABLE
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
    'lastInteractionAt', p_session.last_interaction_at,
    'idleExpiresAt', p_session.last_interaction_at + make_interval(secs => p_session.idle_timeout_seconds),
    'idleTimedOutAt', p_session.idle_timed_out_at,
    'updatedAt', p_session.updated_at,
    'stateVersion', p_session.state_version
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_session_control_json_v1(p_session public.dialer_sessions)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'controllerLabel', p_session.controller_label,
    'claimedAt', p_session.controller_claimed_at,
    'heartbeatAt', p_session.controller_heartbeat_at,
    'leaseExpiresAt', p_session.controller_lease_expires_at,
    'generation', p_session.controller_generation,
    'stale', p_session.controller_lease_expires_at IS NULL OR p_session.controller_lease_expires_at <= now(),
    'operationLabel', p_session.controller_operation_label,
    'operationExpiresAt', p_session.controller_operation_expires_at,
    'operationActive', p_session.controller_operation_id IS NOT NULL
      AND p_session.controller_operation_expires_at > now(),
    'lastInteractionAt', p_session.last_interaction_at,
    'idleExpiresAt', p_session.last_interaction_at + make_interval(secs => p_session.idle_timeout_seconds),
    'idleTimedOutAt', p_session.idle_timed_out_at
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_dialer_session_if_idle_v1(
  p_session_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  open_attempt_id uuid;
  open_attempt_status text;
  open_attempt_updated_at timestamptz;
  idle_deadline timestamptz;
  event_name text;
BEGIN
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status NOT IN ('active', 'paused') THEN
    RETURN public.dialer_session_json_v1(session_row);
  END IF;
  IF session_row.idle_timed_out_at IS NOT NULL
    AND session_row.stop_requested_at IS NOT NULL
  THEN
    RETURN public.dialer_session_json_v1(session_row);
  END IF;

  SELECT id, status, updated_at
  INTO open_attempt_id, open_attempt_status, open_attempt_updated_at
  FROM public.dialer_session_attempts
  WHERE session_id = session_row.id
    AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ORDER BY created_at DESC
  LIMIT 1;

  -- A provider-backed call is real work even when the agent is not touching
  -- the page. Its terminal attempt transition restarts the idle deadline.
  IF open_attempt_status = 'connected'
    OR (open_attempt_status IN ('authorized', 'dialing')
      AND open_attempt_updated_at > now() - interval '2 minutes')
  THEN
    RETURN public.dialer_session_json_v1(session_row);
  END IF;

  idle_deadline := session_row.last_interaction_at
    + make_interval(secs => session_row.idle_timeout_seconds);
  IF idle_deadline > now() THEN
    RETURN public.dialer_session_json_v1(session_row);
  END IF;

  IF open_attempt_status = 'awaiting_disposition' THEN
    UPDATE public.dialer_sessions
    SET status = 'paused',
        paused_at = coalesce(paused_at, idle_deadline),
        stop_requested_at = coalesce(stop_requested_at, idle_deadline),
        idle_timed_out_at = coalesce(idle_timed_out_at, idle_deadline),
        controller_lease_expires_at = least(coalesce(controller_lease_expires_at, idle_deadline), idle_deadline),
        controller_operation_id = NULL,
        controller_operation_label = NULL,
        controller_operation_expires_at = NULL,
        updated_at = now(),
        state_version = state_version + 1
    WHERE id = session_row.id
    RETURNING * INTO session_row;
    event_name := 'session_idle_stop_requested';
  ELSE
    IF open_attempt_status IN ('authorized', 'dialing') THEN
      UPDATE public.dialer_session_attempts
      SET status = 'cancelled',
          ended_at = coalesce(ended_at, idle_deadline),
          duration_seconds = coalesce(duration_seconds, 0),
          metadata = metadata || jsonb_build_object(
            'interruption_reason', 'session_idle_timeout',
            'interrupted_at', idle_deadline
          ),
          updated_at = now()
      WHERE id = open_attempt_id;
    END IF;
    UPDATE public.dialer_sessions
    SET status = 'stopped',
        stop_requested_at = coalesce(stop_requested_at, idle_deadline),
        ended_at = coalesce(ended_at, idle_deadline),
        idle_timed_out_at = coalesce(idle_timed_out_at, idle_deadline),
        controller_lease_expires_at = least(coalesce(controller_lease_expires_at, idle_deadline), idle_deadline),
        controller_operation_id = NULL,
        controller_operation_label = NULL,
        controller_operation_expires_at = NULL,
        updated_at = now(),
        state_version = state_version + 1
    WHERE id = session_row.id
    RETURNING * INTO session_row;
    event_name := 'session_idle_timeout';
  END IF;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, notes, metadata
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id, event_name,
    CASE WHEN event_name = 'session_idle_stop_requested'
      THEN 'Five-minute inactivity limit reached; save the pending call outcome to close the session'
      ELSE 'Calling session ended after five minutes without activity' END,
    jsonb_build_object(
      'idle_timeout_seconds', session_row.idle_timeout_seconds,
      'idle_deadline', idle_deadline,
      'open_attempt_status', open_attempt_status
    )
  );

  RETURN public.dialer_session_json_v1(session_row);
END
$$;

REVOKE ALL ON FUNCTION public.expire_dialer_session_if_idle_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_dialer_session_if_idle_v1(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_idle_dialer_sessions_for_actor_v1(p_actor_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_id uuid;
  expired_count integer := 0;
  was_open boolean;
  is_open boolean;
BEGIN
  FOR session_id IN
    SELECT id
    FROM public.dialer_sessions
    WHERE lower(actor_email) = lower(trim(p_actor_email))
      AND status IN ('active', 'paused')
    ORDER BY updated_at
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT status IN ('active', 'paused') INTO was_open
    FROM public.dialer_sessions WHERE id = session_id;
    PERFORM public.expire_dialer_session_if_idle_v1(session_id, p_actor_email);
    SELECT status IN ('active', 'paused') INTO is_open
    FROM public.dialer_sessions WHERE id = session_id;
    IF was_open AND NOT is_open THEN expired_count := expired_count + 1; END IF;
  END LOOP;
  RETURN expired_count;
END
$$;

REVOKE ALL ON FUNCTION public.expire_idle_dialer_sessions_for_actor_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_idle_dialer_sessions_for_actor_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_dialer_session_control_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text
)
RETURNS public.dialer_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  token_hash text;
  prior_interaction timestamptz;
BEGIN
  PERFORM public.expire_dialer_session_if_idle_v1(p_session_id, p_actor_email);
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.idle_timed_out_at IS NOT NULL
    AND session_row.status = 'stopped'
    AND session_row.stop_requested_at IS NOT NULL
  THEN RAISE EXCEPTION 'session_idle_expired'; END IF;
  IF session_row.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'session_not_open'; END IF;
  IF session_row.controller_token_hash IS NULL THEN RAISE EXCEPTION 'session_control_conflict'; END IF;
  IF coalesce(trim(p_controller_token), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_dialer_controller';
  END IF;
  token_hash := public.dialer_controller_hash_v1(p_controller_token);
  IF token_hash IS DISTINCT FROM session_row.controller_token_hash THEN
    RAISE EXCEPTION 'session_control_lost';
  END IF;

  prior_interaction := session_row.last_interaction_at;
  UPDATE public.dialer_sessions
  SET last_interaction_at = now(),
      controller_heartbeat_at = now(),
      controller_lease_expires_at = now() + interval '45 seconds'
  WHERE id = session_row.id
  RETURNING * INTO session_row;

  IF prior_interaction <= now() - interval '10 seconds' THEN
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes
    ) VALUES (
      session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
      session_row.current_subject_kind, session_row.current_subject_id,
      session_row.current_campaign_member_id, 'session_activity', 'Dialer action recorded'
    );
  END IF;
  RETURN session_row;
END
$$;

REVOKE ALL ON FUNCTION public.assert_dialer_session_control_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_dialer_session_control_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.heartbeat_dialer_session_control_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_user_active boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  token_hash text;
  prior_interaction timestamptz;
BEGIN
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.controller_token_hash IS NULL THEN RAISE EXCEPTION 'session_control_conflict'; END IF;
  IF coalesce(trim(p_controller_token), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_dialer_controller';
  END IF;
  token_hash := public.dialer_controller_hash_v1(p_controller_token);
  IF token_hash IS DISTINCT FROM session_row.controller_token_hash THEN
    RAISE EXCEPTION 'session_control_lost';
  END IF;

  PERFORM public.expire_dialer_session_if_idle_v1(p_session_id, p_actor_email);
  SELECT * INTO session_row FROM public.dialer_sessions WHERE id = p_session_id FOR UPDATE;
  IF session_row.status NOT IN ('active', 'paused') THEN
    RETURN jsonb_build_object(
      'session', public.dialer_session_json_v1(session_row),
      'control', public.dialer_session_control_json_v1(session_row)
    );
  END IF;

  prior_interaction := session_row.last_interaction_at;
  UPDATE public.dialer_sessions
  SET last_interaction_at = CASE WHEN coalesce(p_user_active, false) THEN now() ELSE last_interaction_at END,
      controller_heartbeat_at = now(),
      controller_lease_expires_at = now() + interval '45 seconds'
  WHERE id = session_row.id
  RETURNING * INTO session_row;

  IF coalesce(p_user_active, false) AND prior_interaction <= now() - interval '10 seconds' THEN
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes
    ) VALUES (
      session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
      session_row.current_subject_kind, session_row.current_subject_id,
      session_row.current_campaign_member_id, 'session_activity', 'Agent active on calling floor'
    );
  END IF;

  RETURN jsonb_build_object(
    'session', public.dialer_session_json_v1(session_row),
    'control', public.dialer_session_control_json_v1(session_row)
  );
END
$$;

REVOKE ALL ON FUNCTION public.heartbeat_dialer_session_control_v2(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_dialer_session_control_v2(uuid, text, text, boolean) TO service_role;

-- Keep the old application heartbeat compatible during the migration/deploy
-- overlap, but crucially do not let that heartbeat count as agent activity.
CREATE OR REPLACE FUNCTION public.heartbeat_dialer_session_control_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.heartbeat_dialer_session_control_v2(
    p_session_id, p_actor_email, p_controller_token, false
  )
$$;

REVOKE ALL ON FUNCTION public.heartbeat_dialer_session_control_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_dialer_session_control_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.touch_dialer_session_from_attempt_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(NEW.metadata ->> 'interruption_reason', '') <> 'session_idle_timeout'
    AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.updated_at IS DISTINCT FROM OLD.updated_at)
  THEN
    UPDATE public.dialer_sessions
    SET last_interaction_at = now()
    WHERE id = NEW.session_id AND status IN ('active', 'paused');
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_touch_dialer_session_from_attempt ON public.dialer_session_attempts;
CREATE TRIGGER trg_touch_dialer_session_from_attempt
AFTER INSERT OR UPDATE OF status, updated_at ON public.dialer_session_attempts
FOR EACH ROW EXECUTE FUNCTION public.touch_dialer_session_from_attempt_v1();

REVOKE ALL ON FUNCTION public.touch_dialer_session_from_attempt_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_dialer_session_from_attempt_v1() TO service_role;

COMMENT ON FUNCTION public.heartbeat_dialer_session_control_v2(uuid, text, text, boolean) IS
  'Renews browser control without counting passive heartbeats as work; only explicit user activity extends the five-minute session deadline.';
