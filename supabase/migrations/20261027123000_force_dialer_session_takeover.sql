-- An explicit operator takeover is an emergency stop for every older browser
-- controller. Preserve the durable session and seller position, but cancel any
-- unfinished browser-owned work so the new controller can begin a fresh call
-- after the standard 15-second countdown.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

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
  interrupted_attempt public.dialer_session_attempts;
  token_hash text;
  prior_label text;
  prior_stale boolean;
  prior_operation_id uuid;
  prior_operation_label text;
  prior_operation_expires_at timestamptz;
  prior_attempt_status text;
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
      'transferred', false,
      'interruptedAttempt', NULL
    );
  END IF;

  IF session_row.controller_token_hash IS NOT NULL AND NOT p_force THEN
    RAISE EXCEPTION 'session_control_conflict';
  END IF;
  IF session_row.controller_token_hash IS NOT NULL
    AND p_expected_generation IS DISTINCT FROM session_row.controller_generation
  THEN RAISE EXCEPTION 'session_control_changed'; END IF;

  prior_label := session_row.controller_label;
  prior_stale := session_row.controller_lease_expires_at IS NULL
    OR session_row.controller_lease_expires_at <= now();
  prior_operation_id := session_row.controller_operation_id;
  prior_operation_label := session_row.controller_operation_label;
  prior_operation_expires_at := session_row.controller_operation_expires_at;

  IF p_force THEN
    SELECT * INTO interrupted_attempt
    FROM public.dialer_session_attempts
    WHERE session_id = session_row.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      prior_attempt_status := interrupted_attempt.status;
      UPDATE public.dialer_session_attempts
      SET status = 'cancelled',
          ended_at = coalesce(ended_at, now()),
          duration_seconds = coalesce(duration_seconds, 0),
          metadata = metadata || jsonb_build_object(
            'interruption_reason', 'session_control_transferred',
            'interrupted_status', prior_attempt_status,
            'interrupted_by_controller', trim(p_controller_label),
            'takeover_request_id', nullif(trim(coalesce(p_request_id, '')), ''),
            'interrupted_at', now()
          ),
          updated_at = now()
      WHERE id = interrupted_attempt.id
      RETURNING * INTO interrupted_attempt;

      INSERT INTO public.dialer_session_events (
        session_id, lead_id, prospect_id, subject_kind, subject_id,
        campaign_member_id, event_type, notes, phone, metadata
      ) VALUES (
        session_row.id, interrupted_attempt.lead_id, interrupted_attempt.prospect_id,
        interrupted_attempt.subject_kind, interrupted_attempt.subject_id,
        interrupted_attempt.campaign_member_id,
        'attempt_interrupted_by_control_transfer',
        'Unfinished call was interrupted when dialing moved to another browser',
        interrupted_attempt.phone,
        jsonb_build_object(
          'client_attempt_id', interrupted_attempt.client_attempt_id,
          'prior_attempt_status', prior_attempt_status,
          'provider_call_sid', interrupted_attempt.provider_call_sid,
          'prior_controller_label', prior_label,
          'new_controller_label', trim(p_controller_label),
          'request_id', nullif(trim(coalesce(p_request_id, '')), '')
        )
      );
    END IF;
  END IF;

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
      controller_operation_expires_at = NULL,
      status = CASE WHEN p_force THEN 'active' ELSE status END,
      paused_at = CASE WHEN p_force THEN NULL ELSE paused_at END,
      stop_requested_at = CASE WHEN p_force THEN NULL ELSE stop_requested_at END,
      updated_at = CASE WHEN p_force THEN now() ELSE updated_at END,
      state_version = state_version + CASE WHEN p_force THEN 1 ELSE 0 END
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
      THEN 'Other dialing controllers were disconnected and control continued in this browser'
      ELSE 'Dialing control claimed by browser' END,
    jsonb_build_object(
      'prior_controller_label', prior_label,
      'new_controller_label', session_row.controller_label,
      'prior_lease_stale', prior_stale,
      'controller_generation', session_row.controller_generation,
      'interrupted_attempt_id', interrupted_attempt.id,
      'interrupted_attempt_status', prior_attempt_status,
      'cancelled_operation_id', prior_operation_id,
      'cancelled_operation_label', prior_operation_label,
      'cancelled_operation_expires_at', prior_operation_expires_at,
      'request_id', nullif(trim(coalesce(p_request_id, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'session', public.dialer_session_json_v1(session_row),
    'control', public.dialer_session_control_json_v1(session_row),
    'transferred', event_name = 'session_control_transferred',
    'interruptedAttempt', CASE WHEN interrupted_attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
      'clientAttemptId', interrupted_attempt.client_attempt_id,
      'status', prior_attempt_status,
      'providerCallSid', interrupted_attempt.provider_call_sid
    ) END
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text)
  TO service_role;

COMMENT ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text) IS
  'Atomically fences older browser controllers; an explicit takeover cancels unfinished work, preserves seller position, and resumes under the new controller.';
