-- One durable dialer session may be open per operator, but only one browser
-- tab/device may control it. Controller secrets are hashed at rest and never
-- included in the public session JSON.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS controller_token_hash text,
  ADD COLUMN IF NOT EXISTS controller_label text,
  ADD COLUMN IF NOT EXISTS controller_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS controller_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS controller_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS controller_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_controller_generation_nonnegative,
  ADD CONSTRAINT dialer_sessions_controller_generation_nonnegative
    CHECK (controller_generation >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS dialer_sessions_controller_label_length,
  ADD CONSTRAINT dialer_sessions_controller_label_length
    CHECK (controller_label IS NULL OR char_length(controller_label) BETWEEN 1 AND 120) NOT VALID;

CREATE OR REPLACE FUNCTION public.dialer_controller_hash_v1(p_controller_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(extensions.digest(trim(p_controller_token), 'sha256'), 'hex')
$$;

REVOKE ALL ON FUNCTION public.dialer_controller_hash_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_controller_hash_v1(text) TO service_role;

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
    'stale', p_session.controller_lease_expires_at IS NULL OR p_session.controller_lease_expires_at <= now()
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_control_json_v1(public.dialer_sessions) TO service_role;

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
BEGIN
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  -- Every mutation is controller-owned. Pre-migration sessions must first
  -- claim control through the heartbeat/claim boundary below.
  IF session_row.controller_token_hash IS NULL THEN
    RAISE EXCEPTION 'session_control_conflict';
  END IF;
  IF coalesce(trim(p_controller_token), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_dialer_controller';
  END IF;
  token_hash := public.dialer_controller_hash_v1(p_controller_token);
  IF token_hash IS DISTINCT FROM session_row.controller_token_hash THEN
    RAISE EXCEPTION 'session_control_lost';
  END IF;

  UPDATE public.dialer_sessions
  SET controller_heartbeat_at = now(),
      controller_lease_expires_at = now() + interval '45 seconds'
  WHERE id = session_row.id
  RETURNING * INTO session_row;
  RETURN session_row;
END
$$;

REVOKE ALL ON FUNCTION public.assert_dialer_session_control_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_dialer_session_control_v1(uuid, text, text) TO service_role;

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
      controller_generation = controller_generation + 1
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

CREATE OR REPLACE FUNCTION public.heartbeat_dialer_session_control_v1(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
BEGIN
  session_row := public.assert_dialer_session_control_v1(
    p_session_id, p_actor_email, p_controller_token
  );
  RETURN jsonb_build_object(
    'session', public.dialer_session_json_v1(session_row),
    'control', public.dialer_session_control_json_v1(session_row)
  );
END
$$;

REVOKE ALL ON FUNCTION public.heartbeat_dialer_session_control_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_dialer_session_control_v1(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.start_dialer_session_v3(
  p_actor_email text,
  p_agent_name text,
  p_queue_key text,
  p_queue_items jsonb,
  p_caller_id text,
  p_saved_queue_id uuid,
  p_settings_snapshot jsonb,
  p_controller_token text,
  p_controller_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  open_session_id uuid;
  result jsonb;
  control_result jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0)
  );
  SELECT id INTO open_session_id
  FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF open_session_id IS NOT NULL THEN
    -- Pre-control sessions must surface the same explicit confirmation as a
    -- session owned by another controller. Never adopt one as a side effect
    -- of starting a new session.
    IF EXISTS (
      SELECT 1 FROM public.dialer_sessions
      WHERE id = open_session_id AND controller_token_hash IS NULL
    ) THEN
      RAISE EXCEPTION 'session_control_conflict';
    END IF;
    PERFORM public.claim_dialer_session_control_v1(
      open_session_id, actor_key, p_controller_token, p_controller_label,
      false, NULL, NULL
    );
  END IF;

  result := public.start_dialer_session_v2(
    actor_key, p_agent_name, p_queue_key, p_queue_items, p_caller_id,
    p_saved_queue_id, p_settings_snapshot
  );
  control_result := public.claim_dialer_session_control_v1(
    (result -> 'session' ->> 'id')::uuid,
    actor_key,
    p_controller_token,
    p_controller_label,
    false,
    NULL,
    NULL
  );
  RETURN result || jsonb_build_object('control', control_result -> 'control');
END
$$;

REVOKE ALL ON FUNCTION public.start_dialer_session_v3(text, text, text, jsonb, text, uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_dialer_session_v3(text, text, text, jsonb, text, uuid, jsonb, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v5(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_caller_id text,
  p_session_setup jsonb,
  p_controller_token text,
  p_controller_label text,
  p_takeover boolean DEFAULT false,
  p_expected_generation integer DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  open_session_id uuid;
  open_session public.dialer_sessions;
  result jsonb;
  control_result jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0)
  );
  SELECT * INTO open_session
  FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN open_session_id := open_session.id; END IF;

  IF open_session_id IS NOT NULL THEN
    IF open_session.controller_token_hash IS NULL AND NOT p_takeover THEN
      RAISE EXCEPTION 'session_control_conflict';
    END IF;
    control_result := public.claim_dialer_session_control_v1(
      open_session_id, actor_key, p_controller_token, p_controller_label,
      p_takeover, p_expected_generation, p_request_id
    );
    IF p_takeover THEN
      IF open_session.prospecting_campaign_id IS DISTINCT FROM p_campaign_id THEN
        RAISE EXCEPTION 'another_dialer_session_open';
      END IF;
      RETURN jsonb_build_object(
        'created', false,
        'session', control_result -> 'session',
        'batchSize', open_session.queue_size,
        'remaining', greatest(open_session.queue_size - open_session.current_index - 1, 0),
        'control', control_result -> 'control'
      );
    END IF;
  END IF;

  result := public.start_prospecting_dialer_session_v4(
    p_campaign_id, actor_key, p_actor_name, p_caller_id, p_session_setup
  );
  control_result := public.claim_dialer_session_control_v1(
    (result -> 'session' ->> 'id')::uuid,
    actor_key,
    p_controller_token,
    p_controller_label,
    false,
    NULL,
    p_request_id
  );
  RETURN result || jsonb_build_object('control', control_result -> 'control');
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v5(uuid, text, text, text, jsonb, text, text, boolean, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v5(uuid, text, text, text, jsonb, text, text, boolean, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.transition_dialer_session_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_dialer_session_control_v1(p_session_id, p_actor_email, p_controller_token);
  RETURN public.transition_dialer_session_v1(p_session_id, p_actor_email, p_action, p_reason);
END
$$;

CREATE OR REPLACE FUNCTION public.request_pause_dialer_session_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_dialer_session_control_v1(p_session_id, p_actor_email, p_controller_token);
  RETURN public.request_pause_dialer_session_v1(p_session_id, p_actor_email, p_reason);
END
$$;

CREATE OR REPLACE FUNCTION public.authorize_dialer_attempt_v4(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
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
BEGIN
  PERFORM public.assert_dialer_session_control_v1(p_session_id, p_actor_email, p_controller_token);
  RETURN public.authorize_dialer_attempt_v3(
    p_session_id, p_actor_email, p_client_attempt_id, p_subject_kind,
    p_subject_id, p_campaign_member_id, p_lead_id, p_prospect_id,
    p_prospect_phone_id, p_phone, p_caller_id
  );
END
$$;

CREATE OR REPLACE FUNCTION public.transition_dialer_attempt_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_client_attempt_id text,
  p_action text,
  p_disposition text DEFAULT NULL,
  p_duration_seconds integer DEFAULT NULL,
  p_reached boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_dialer_session_control_v1(p_session_id, p_actor_email, p_controller_token);
  RETURN public.transition_dialer_attempt_v1(
    p_session_id, p_actor_email, p_client_attempt_id, p_action,
    p_disposition, p_duration_seconds, p_reached
  );
END
$$;

CREATE OR REPLACE FUNCTION public.advance_dialer_session_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_client_attempt_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_dialer_session_control_v1(p_session_id, p_actor_email, p_controller_token);
  RETURN public.advance_dialer_session_v1(p_session_id, p_actor_email, p_client_attempt_id);
END
$$;

REVOKE ALL ON FUNCTION public.transition_dialer_session_v2(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_pause_dialer_session_v2(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_dialer_attempt_v4(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_dialer_attempt_v2(uuid, text, text, text, text, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_dialer_session_v2(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transition_dialer_session_v2(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_pause_dialer_session_v2(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_dialer_attempt_v4(uuid, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_dialer_attempt_v2(uuid, text, text, text, text, text, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_dialer_session_v2(uuid, text, text, text) TO service_role;

-- DEPLOYMENT CONTRACT: this additive migration intentionally leaves service_role
-- access to the legacy mutation RPCs in place so already-running application
-- instances remain compatible. Do not append the revocations here or to any
-- migration that can be applied in the same database push.
--
-- Legacy RPC enforcement must ship as a separate post-deploy migration/PR only
-- after Prospecting/Dialer mutations are in maintenance, all old instances and
-- in-flight requests are drained, and the new exact application SHA has been
-- verified against the controller-aware RPCs. Apply those revocations before
-- removing maintenance; otherwise an old instance could bypass browser control.

CREATE OR REPLACE FUNCTION public.decide_dialer_ai_change_proposal_v2(
  p_session_id uuid,
  p_actor_email text,
  p_controller_token text,
  p_client_attempt_id text,
  p_decision text,
  p_decision_key text,
  p_decided_by text,
  p_note text DEFAULT NULL
)
RETURNS public.ai_change_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  attempt_id uuid;
  proposal_id uuid;
BEGIN
  -- The session row remains locked through the proposal decision, so a
  -- competing takeover cannot commit between authorization and CRM writes.
  PERFORM public.assert_dialer_session_control_v1(
    p_session_id, p_actor_email, p_controller_token
  );
  SELECT id INTO attempt_id
  FROM public.dialer_session_attempts
  WHERE session_id = p_session_id
    AND client_attempt_id = trim(p_client_attempt_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  SELECT id INTO proposal_id
  FROM public.ai_change_proposals
  WHERE dialer_session_attempt_id = attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_change_proposal_not_found'; END IF;

  -- Match decide_ai_change_proposal_v1's advisory-before-row lock order so a
  -- direct lead-level decision and a dialer decision cannot deadlock. Recheck
  -- the attempt association after acquiring the advisory lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-change-proposal:' || proposal_id::text, 0)
  );
  SELECT id INTO proposal_id
  FROM public.ai_change_proposals
  WHERE id = proposal_id
    AND dialer_session_attempt_id = attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_change_proposal_not_found'; END IF;

  RETURN public.decide_ai_change_proposal_v1(
    proposal_id, p_decision, p_decision_key, p_decided_by, p_note
  );
END
$$;

REVOKE ALL ON FUNCTION public.decide_dialer_ai_change_proposal_v2(uuid, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_dialer_ai_change_proposal_v2(uuid, text, text, text, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.claim_dialer_session_control_v1(uuid, text, text, text, boolean, integer, text) IS
  'Atomically assigns one browser controller to an open dialer session; explicit takeover preserves the session and blocks unfinished calls/outcomes.';
