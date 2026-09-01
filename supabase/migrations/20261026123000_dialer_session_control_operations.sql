-- Keep CRM side effects under the same browser-control lease from the moment
-- the user starts an action through the server's final acknowledgement.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS controller_operation_id uuid,
  ADD COLUMN IF NOT EXISTS controller_operation_label text,
  ADD COLUMN IF NOT EXISTS controller_operation_expires_at timestamptz;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_controller_operation_label_length,
  ADD CONSTRAINT dialer_sessions_controller_operation_label_length
    CHECK (controller_operation_label IS NULL OR char_length(controller_operation_label) BETWEEN 1 AND 120) NOT VALID;

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
      AND p_session.controller_operation_expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_dialer_session_control_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_controller_label text,
  p_force boolean DEFAULT false,
  p_expected_generation integer DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  recovered_attempt public.dialer_session_attempts;
  token_hash text;
  prior_label text;
  prior_stale boolean;
  event_name text;
BEGIN
  IF coalesce(trim(p_controller_token), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR char_length(trim(coalesce(p_controller_label, ''))) NOT BETWEEN 1 AND 120
  THEN RAISE EXCEPTION 'invalid_dialer_controller'; END IF;

  token_hash := public.dialer_controller_hash_v1(p_controller_token);
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'session_not_open'; END IF;

  IF session_row.controller_token_hash = token_hash THEN
    UPDATE public.dialer_sessions
    SET controller_label = trim(p_controller_label),
        controller_heartbeat_at = now(),
        controller_lease_expires_at = now() + interval '45 seconds'
    WHERE id = session_row.id
    RETURNING * INTO session_row;
    RETURN jsonb_build_object(
      'session', public.dialer_session_json_v1(session_row),
      'control', public.dialer_session_control_json_v1(session_row),
      'transferred', false
    );
  END IF;

  IF session_row.controller_token_hash IS NOT NULL AND NOT p_force THEN
    RAISE EXCEPTION 'session_control_conflict';
  END IF;
  IF session_row.controller_token_hash IS NOT NULL
    AND p_expected_generation IS DISTINCT FROM session_row.controller_generation
  THEN RAISE EXCEPTION 'session_control_changed'; END IF;

  -- A CRM write that began under the current controller must either commit or
  -- expire before another browser may take over.
  IF session_row.controller_operation_id IS NOT NULL
    AND session_row.controller_operation_expires_at > now()
  THEN RAISE EXCEPTION 'session_takeover_operation_in_progress'; END IF;

  -- Authorization is persisted before the browser asks Twilio to connect. If
  -- that tab dies in the small gap before it marks the attempt as dialing, the
  -- durable row would otherwise block the session forever. Recover only during
  -- an explicit takeover, after both the 45-second controller lease and the
  -- 90-second signed call intent have expired (plus 30 seconds of margin).
  -- Dialing/connected attempts are never recovered automatically because the
  -- provider call may still be live.
  IF p_force
    AND (session_row.controller_lease_expires_at IS NULL
      OR session_row.controller_lease_expires_at <= now())
  THEN
    SELECT * INTO recovered_attempt
    FROM public.dialer_session_attempts
    WHERE session_id = session_row.id
      AND status = 'authorized'
      AND started_at IS NULL
      AND connected_at IS NULL
      AND provider_call_sid IS NULL
      AND recording_sid IS NULL
      AND coalesce(metadata ->> 'provider_status', '') = ''
      AND coalesce(metadata ->> 'provider_child_call_sid', '') = ''
      AND updated_at <= now() - interval '2 minutes'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.dialer_session_attempts
      SET status = 'cancelled',
          ended_at = now(),
          duration_seconds = 0,
          metadata = metadata || jsonb_build_object(
            'recovery_reason', 'stale_pre_call_authorization',
            'recovered_during_takeover', true,
            'recovery_request_id', nullif(trim(coalesce(p_request_id, '')), '')
          ),
          updated_at = now()
      WHERE id = recovered_attempt.id
        AND status = 'authorized'
      RETURNING * INTO recovered_attempt;

      INSERT INTO public.dialer_session_events (
        session_id, lead_id, prospect_id, subject_kind, subject_id,
        campaign_member_id, event_type, notes, phone, metadata
      ) VALUES (
        session_row.id, recovered_attempt.lead_id, recovered_attempt.prospect_id,
        recovered_attempt.subject_kind, recovered_attempt.subject_id,
        recovered_attempt.campaign_member_id,
        'attempt_recovered_after_controller_loss',
        'Cancelled stale pre-call authorization during explicit session takeover',
        recovered_attempt.phone,
        jsonb_build_object(
          'client_attempt_id', recovered_attempt.client_attempt_id,
          'prior_controller_label', session_row.controller_label,
          'prior_lease_expires_at', session_row.controller_lease_expires_at,
          'authorization_age_seconds', greatest(
            0,
            floor(extract(epoch FROM (now() - recovered_attempt.created_at)))::integer
          ),
          'request_id', nullif(trim(coalesce(p_request_id, '')), '')
        )
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = session_row.id AND status = 'awaiting_disposition'
  ) THEN RAISE EXCEPTION 'session_takeover_disposition_required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = session_row.id AND status IN ('authorized', 'dialing', 'connected')
  ) THEN RAISE EXCEPTION 'session_takeover_live_call'; END IF;

  prior_label := session_row.controller_label;
  prior_stale := session_row.controller_lease_expires_at IS NULL
    OR session_row.controller_lease_expires_at <= now();
  event_name := CASE WHEN session_row.controller_token_hash IS NULL
    THEN 'session_control_claimed' ELSE 'session_control_transferred' END;

  UPDATE public.dialer_sessions
  SET controller_token_hash = token_hash,
      controller_label = trim(p_controller_label),
      controller_claimed_at = now(),
      controller_heartbeat_at = now(),
      controller_lease_expires_at = now() + interval '45 seconds',
      controller_generation = controller_generation + 1,
      controller_operation_id = NULL,
      controller_operation_label = NULL,
      controller_operation_expires_at = NULL
  WHERE id = session_row.id
  RETURNING * INTO session_row;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, notes, metadata
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id, event_name,
    CASE WHEN event_name = 'session_control_transferred'
      THEN 'Dialing control continued in another browser'
      ELSE 'Dialing control claimed by browser' END,
    jsonb_build_object(
      'prior_controller_label', prior_label,
      'new_controller_label', session_row.controller_label,
      'prior_lease_stale', prior_stale,
      'controller_generation', session_row.controller_generation,
      'request_id', nullif(trim(coalesce(p_request_id, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'session', public.dialer_session_json_v1(session_row),
    'control', public.dialer_session_control_json_v1(session_row),
    'transferred', event_name = 'session_control_transferred'
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_dialer_attempt_provider_status_v1(
  p_client_attempt_id text,
  p_provider_call_sid text,
  p_provider_status text,
  p_duration_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  attempt_session_id uuid;
  attempt_row public.dialer_session_attempts;
  session_row public.dialer_sessions;
  provider_status text := lower(trim(coalesce(p_provider_status, '')));
  duration_value integer := greatest(0, coalesce(p_duration_seconds, 0));
  prior_provider_sid text;
  next_status text;
BEGIN
  IF char_length(trim(coalesce(p_client_attempt_id, ''))) NOT BETWEEN 1 AND 200
    OR coalesce(trim(p_provider_call_sid), '') !~* '^CA[0-9a-f]{32}$'
    OR provider_status NOT IN (
      'initiated', 'ringing', 'answered', 'in-progress',
      'completed', 'failed', 'canceled', 'busy', 'no-answer'
    )
    OR duration_value > 86400
  THEN RAISE EXCEPTION 'invalid_dialer_provider_status'; END IF;

  -- Discover the owning session, then use the same session -> attempt lock
  -- order as takeover and controller mutations. Re-read the attempt after the
  -- session lock so the provider callback and takeover serialize atomically.
  SELECT session_id INTO attempt_session_id
  FROM public.dialer_session_attempts
  WHERE client_attempt_id = trim(p_client_attempt_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'attempt_not_found');
  END IF;

  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = attempt_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'session_not_found');
  END IF;

  SELECT * INTO attempt_row
  FROM public.dialer_session_attempts
  WHERE session_id = session_row.id
    AND client_attempt_id = trim(p_client_attempt_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'attempt_not_found');
  END IF;

  prior_provider_sid := nullif(attempt_row.metadata ->> 'provider_child_call_sid', '');
  IF prior_provider_sid IS NOT NULL
    AND prior_provider_sid IS DISTINCT FROM trim(p_provider_call_sid)
  THEN RAISE EXCEPTION 'dialer_provider_call_conflict'; END IF;

  next_status := attempt_row.status;
  IF provider_status IN ('initiated', 'ringing')
    AND attempt_row.status = 'authorized'
  THEN
    next_status := 'dialing';
  ELSIF provider_status IN ('answered', 'in-progress')
    AND attempt_row.status IN ('authorized', 'dialing')
  THEN
    next_status := 'connected';
  ELSIF provider_status IN ('completed', 'failed', 'canceled', 'busy', 'no-answer')
    AND attempt_row.status IN ('authorized', 'dialing', 'connected')
  THEN
    next_status := 'awaiting_disposition';
  END IF;

  UPDATE public.dialer_session_attempts
  SET provider_call_sid = coalesce(provider_call_sid, trim(p_provider_call_sid)),
      status = next_status,
      started_at = CASE
        WHEN provider_status IN ('initiated', 'ringing', 'answered', 'in-progress')
          THEN coalesce(started_at, now())
        ELSE started_at
      END,
      connected_at = CASE
        WHEN provider_status IN ('answered', 'in-progress')
          THEN coalesce(connected_at, now())
        ELSE connected_at
      END,
      ended_at = CASE
        WHEN provider_status IN ('completed', 'failed', 'canceled', 'busy', 'no-answer')
          THEN coalesce(ended_at, now())
        ELSE ended_at
      END,
      duration_seconds = CASE
        WHEN provider_status IN ('completed', 'failed', 'canceled', 'busy', 'no-answer')
          THEN greatest(coalesce(duration_seconds, 0), duration_value)
        ELSE duration_seconds
      END,
      metadata = metadata || jsonb_build_object(
        'provider', 'twilio',
        'provider_child_call_sid', trim(p_provider_call_sid),
        'provider_status', provider_status,
        'provider_evidence_at', now()
      ),
      updated_at = now()
  WHERE id = attempt_row.id
  RETURNING * INTO attempt_row;

  RETURN jsonb_build_object('recorded', true, 'attempt', to_jsonb(attempt_row));
END
$$;

REVOKE ALL ON FUNCTION public.record_dialer_attempt_provider_status_v1(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dialer_attempt_provider_status_v1(text, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_dialer_session_control_operation_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_operation_id uuid,
  p_operation_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
BEGIN
  IF p_operation_id IS NULL
    OR char_length(trim(coalesce(p_operation_label, ''))) NOT BETWEEN 1 AND 120
  THEN RAISE EXCEPTION 'invalid_dialer_operation'; END IF;

  session_row := public.assert_dialer_session_control_v1(
    p_session_id, p_actor_email, p_controller_token
  );
  IF session_row.controller_operation_id IS NOT NULL
    AND session_row.controller_operation_id IS DISTINCT FROM p_operation_id
    AND session_row.controller_operation_expires_at > now()
  THEN RAISE EXCEPTION 'session_control_operation_in_progress'; END IF;

  UPDATE public.dialer_sessions
  SET controller_operation_id = p_operation_id,
      controller_operation_label = trim(p_operation_label),
      controller_operation_expires_at = now() + interval '5 minutes'
  WHERE id = session_row.id
  RETURNING * INTO session_row;
  RETURN jsonb_build_object('control', public.dialer_session_control_json_v1(session_row));
END
$$;

CREATE OR REPLACE FUNCTION public.assert_dialer_session_control_operation_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_operation_id uuid
)
RETURNS public.dialer_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid_dialer_operation'; END IF;
  session_row := public.assert_dialer_session_control_v1(
    p_session_id, p_actor_email, p_controller_token
  );
  IF session_row.controller_operation_id IS DISTINCT FROM p_operation_id
    OR session_row.controller_operation_expires_at IS NULL
    OR session_row.controller_operation_expires_at <= now()
  THEN RAISE EXCEPTION 'session_control_operation_lost'; END IF;

  UPDATE public.dialer_sessions
  SET controller_operation_expires_at = now() + interval '5 minutes'
  WHERE id = session_row.id
  RETURNING * INTO session_row;
  RETURN session_row;
END
$$;

CREATE OR REPLACE FUNCTION public.end_dialer_session_control_operation_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'invalid_dialer_operation'; END IF;
  session_row := public.assert_dialer_session_control_v1(
    p_session_id, p_actor_email, p_controller_token
  );

  -- Idempotent cleanup may arrive after a retry or after a newer operation has
  -- replaced an expired one. Never clear a different operation.
  UPDATE public.dialer_sessions
  SET controller_operation_id = NULL,
      controller_operation_label = NULL,
      controller_operation_expires_at = NULL
  WHERE id = session_row.id
    AND controller_operation_id = p_operation_id
  RETURNING * INTO session_row;
  IF NOT FOUND THEN
    SELECT * INTO session_row FROM public.dialer_sessions WHERE id = p_session_id;
  END IF;
  RETURN jsonb_build_object('control', public.dialer_session_control_json_v1(session_row));
END
$$;

REVOKE ALL ON FUNCTION public.begin_dialer_session_control_operation_v1(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_dialer_session_control_operation_v1(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_dialer_session_control_operation_v1(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_dialer_session_control_operation_v1(uuid, text, text, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_dialer_session_control_operation_v1(uuid, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.end_dialer_session_control_operation_v1(uuid, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.begin_dialer_session_control_operation_v1(uuid, text, text, uuid, text) IS
  'Begins or renews one bounded CRM mutation under the current browser controller so takeover cannot race the write.';
