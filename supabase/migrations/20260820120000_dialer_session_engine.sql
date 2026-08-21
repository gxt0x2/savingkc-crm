-- Durable single-line dialer sessions.
--
-- The existing dialer_sessions/dialer_session_events tables were an audit
-- shell. This migration makes the server the source of truth for queue
-- position and adds one durable record per authorized outbound attempt.

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS queue_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS caller_id text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_queue_snapshot_array,
  ADD CONSTRAINT dialer_sessions_queue_snapshot_array
    CHECK (jsonb_typeof(queue_snapshot) = 'array') NOT VALID,
  DROP CONSTRAINT IF EXISTS dialer_sessions_current_index_nonnegative,
  ADD CONSTRAINT dialer_sessions_current_index_nonnegative
    CHECK (current_index >= 0) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_sessions_one_open_per_actor
  ON public.dialer_sessions (lower(actor_email))
  WHERE actor_email IS NOT NULL AND status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_actor_updated
  ON public.dialer_sessions (lower(actor_email), updated_at DESC)
  WHERE actor_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dialer_session_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id) ON DELETE CASCADE,
  client_attempt_id text NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  prospect_phone_id uuid REFERENCES public.prospect_phones(id) ON DELETE SET NULL,
  phone text NOT NULL,
  caller_id text NOT NULL,
  status text NOT NULL DEFAULT 'authorized'
    CHECK (status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition', 'dispositioned', 'failed', 'cancelled')),
  disposition text,
  duration_seconds integer,
  reached boolean,
  started_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  dispositioned_at timestamptz,
  advanced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_attempt_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_attempts_one_open_per_session
  ON public.dialer_session_attempts (session_id)
  WHERE status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition');

CREATE INDEX IF NOT EXISTS idx_dialer_attempts_session_created
  ON public.dialer_session_attempts (session_id, created_at DESC);

ALTER TABLE public.dialer_session_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dialer_session_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dialer_session_attempts TO service_role;

DROP POLICY IF EXISTS "Service role full access on dialer_session_attempts" ON public.dialer_session_attempts;
CREATE POLICY "Service role full access on dialer_session_attempts"
  ON public.dialer_session_attempts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

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
    'leadIds', p_session.queue_snapshot,
    'queueSize', p_session.queue_size,
    'currentIndex', p_session.current_index,
    'currentLeadId', p_session.current_lead_id,
    'callerId', p_session.caller_id,
    'dialsCompleted', p_session.dials_completed,
    'contacts', p_session.contacts,
    'skips', p_session.skips,
    'startedAt', p_session.started_at,
    'pausedAt', p_session.paused_at,
    'endedAt', p_session.ended_at,
    'updatedAt', p_session.updated_at,
    'stateVersion', p_session.state_version
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.start_dialer_session_v1(
  p_actor_email text,
  p_agent_name text,
  p_queue_key text,
  p_lead_ids uuid[],
  p_caller_id text,
  p_saved_queue_id uuid DEFAULT NULL,
  p_settings_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor text := lower(trim(coalesce(p_actor_email, '')));
  v_session public.dialer_sessions;
BEGIN
  IF v_actor = '' OR coalesce(trim(p_agent_name), '') = '' THEN
    RAISE EXCEPTION 'invalid_actor';
  END IF;
  IF coalesce(array_length(p_lead_ids, 1), 0) < 1 OR array_length(p_lead_ids, 1) > 100 THEN
    RAISE EXCEPTION 'invalid_queue_size';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_lead_ids) value WHERE value IS NULL) THEN
    RAISE EXCEPTION 'invalid_lead_id';
  END IF;
  IF (SELECT count(DISTINCT id) FROM public.leads WHERE id = ANY(p_lead_ids)) <> array_length(p_lead_ids, 1) THEN
    RAISE EXCEPTION 'invalid_lead_id';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || v_actor, 0));

  SELECT * INTO v_session
  FROM public.dialer_sessions
  WHERE lower(actor_email) = v_actor AND status IN ('active', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'session', public.dialer_session_json_v1(v_session));
  END IF;

  INSERT INTO public.dialer_sessions (
    actor_email, agent_name, queue_key, saved_queue_id, campaign,
    mode, lines_per_agent, queue_snapshot, queue_size, current_index,
    current_lead_id, caller_id, settings_snapshot, status
  ) VALUES (
    v_actor, trim(p_agent_name), coalesce(nullif(trim(p_queue_key), ''), 'custom'), p_saved_queue_id, 'All sources',
    'power', 1, to_jsonb(p_lead_ids), array_length(p_lead_ids, 1), 0,
    p_lead_ids[1], nullif(trim(p_caller_id), ''), coalesce(p_settings_snapshot, '{}'::jsonb), 'active'
  ) RETURNING * INTO v_session;

  INSERT INTO public.dialer_session_events (session_id, lead_id, event_type, metadata)
  VALUES (v_session.id, v_session.current_lead_id, 'session_started', jsonb_build_object('queue_size', v_session.queue_size));

  RETURN jsonb_build_object('created', true, 'session', public.dialer_session_json_v1(v_session));
END
$$;

REVOKE ALL ON FUNCTION public.start_dialer_session_v1(text, text, text, uuid[], text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_dialer_session_v1(text, text, text, uuid[], text, uuid, jsonb) TO service_role;

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
  v_session public.dialer_sessions;
  v_next_index integer;
  v_next_lead uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  IF p_action IN ('pause', 'stop', 'skip') AND EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = v_session.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) THEN
    RAISE EXCEPTION 'call_in_progress';
  END IF;

  IF p_action = 'pause' THEN
    IF v_session.status <> 'active' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions
      SET status = 'paused', paused_at = now(), updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  ELSIF p_action = 'resume' THEN
    IF v_session.status <> 'paused' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions
      SET status = 'active', paused_at = NULL, updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  ELSIF p_action = 'stop' THEN
    IF v_session.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions
      SET status = 'stopped', ended_at = now(), updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  ELSIF p_action = 'skip' THEN
    IF v_session.status <> 'active' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'skip_reason_required'; END IF;
    INSERT INTO public.dialer_session_events (session_id, lead_id, event_type, notes)
      VALUES (v_session.id, v_session.current_lead_id, 'lead_skipped', trim(p_reason));
    v_next_index := v_session.current_index + 1;
    IF v_next_index >= v_session.queue_size THEN
      UPDATE public.dialer_sessions
        SET status = 'completed', ended_at = now(), skips = skips + 1,
            updated_at = now(), state_version = state_version + 1
        WHERE id = v_session.id RETURNING * INTO v_session;
    ELSE
      v_next_lead := (v_session.queue_snapshot ->> v_next_index)::uuid;
      UPDATE public.dialer_sessions
        SET current_index = v_next_index, current_lead_id = v_next_lead, skips = skips + 1,
            updated_at = now(), state_version = state_version + 1
        WHERE id = v_session.id RETURNING * INTO v_session;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_session_action';
  END IF;

  INSERT INTO public.dialer_session_events (session_id, lead_id, event_type, notes)
    VALUES (v_session.id, v_session.current_lead_id, 'session_' || p_action, nullif(trim(p_reason), ''));
  RETURN public.dialer_session_json_v1(v_session);
END
$$;

REVOKE ALL ON FUNCTION public.transition_dialer_session_v1(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_dialer_session_v1(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_dialer_attempt_v1(
  p_session_id uuid,
  p_actor_email text,
  p_client_attempt_id text,
  p_lead_id uuid,
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
  v_session public.dialer_sessions;
  v_attempt public.dialer_session_attempts;
BEGIN
  SELECT * INTO v_session FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.status <> 'active' THEN RAISE EXCEPTION 'session_not_active'; END IF;
  IF v_session.current_lead_id IS DISTINCT FROM p_lead_id THEN RAISE EXCEPTION 'session_lead_mismatch'; END IF;

  SELECT * INTO v_attempt FROM public.dialer_session_attempts
  WHERE client_attempt_id = trim(p_client_attempt_id);
  IF FOUND THEN
    IF v_attempt.session_id <> v_session.id THEN RAISE EXCEPTION 'attempt_context_mismatch'; END IF;
    RETURN to_jsonb(v_attempt);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dialer_session_attempts
    WHERE session_id = v_session.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) THEN
    RAISE EXCEPTION 'attempt_in_progress';
  END IF;

  INSERT INTO public.dialer_session_attempts (
    session_id, client_attempt_id, lead_id, prospect_phone_id, phone, caller_id
  ) VALUES (
    v_session.id, trim(p_client_attempt_id), p_lead_id, p_prospect_phone_id, trim(p_phone), trim(p_caller_id)
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.dialer_session_events (session_id, lead_id, event_type, phone, metadata)
    VALUES (v_session.id, p_lead_id, 'attempt_authorized', trim(p_phone), jsonb_build_object('client_attempt_id', trim(p_client_attempt_id)));
  RETURN to_jsonb(v_attempt);
END
$$;

REVOKE ALL ON FUNCTION public.authorize_dialer_attempt_v1(uuid, text, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_dialer_attempt_v1(uuid, text, text, uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_dialer_attempt_v1(
  p_session_id uuid,
  p_actor_email text,
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
DECLARE
  v_session public.dialer_sessions;
  v_attempt public.dialer_session_attempts;
BEGIN
  SELECT * INTO v_session FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;

  SELECT * INTO v_attempt FROM public.dialer_session_attempts
  WHERE session_id = v_session.id AND client_attempt_id = trim(p_client_attempt_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  IF p_action = 'started' THEN
    IF v_attempt.status = 'authorized' THEN
      UPDATE public.dialer_session_attempts SET status = 'dialing', started_at = now(), updated_at = now()
      WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    END IF;
  ELSIF p_action = 'connected' THEN
    IF v_attempt.status IN ('authorized', 'dialing') THEN
      UPDATE public.dialer_session_attempts SET status = 'connected', connected_at = now(), updated_at = now()
      WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    END IF;
  ELSIF p_action = 'ended' THEN
    IF v_attempt.status IN ('authorized', 'dialing', 'connected') THEN
      UPDATE public.dialer_session_attempts
        SET status = 'awaiting_disposition', ended_at = now(),
            duration_seconds = greatest(0, coalesce(p_duration_seconds, 0)), updated_at = now()
        WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    END IF;
  ELSIF p_action IN ('failed', 'cancelled') THEN
    IF v_attempt.status IN ('authorized', 'dialing', 'connected') THEN
      UPDATE public.dialer_session_attempts
        SET status = p_action, ended_at = now(), duration_seconds = greatest(0, coalesce(p_duration_seconds, 0)), updated_at = now()
        WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    END IF;
  ELSIF p_action = 'disposition' THEN
    IF coalesce(trim(p_disposition), '') = '' THEN RAISE EXCEPTION 'disposition_required'; END IF;
    IF v_attempt.status = 'dispositioned' THEN
      IF v_attempt.disposition <> trim(p_disposition) THEN RAISE EXCEPTION 'disposition_conflict'; END IF;
      RETURN to_jsonb(v_attempt);
    END IF;
    IF v_attempt.status NOT IN ('authorized', 'dialing', 'connected', 'awaiting_disposition') THEN
      RAISE EXCEPTION 'invalid_attempt_transition';
    END IF;
    UPDATE public.dialer_session_attempts
      SET status = 'dispositioned', disposition = trim(p_disposition), reached = coalesce(p_reached, false),
          dispositioned_at = now(), duration_seconds = coalesce(duration_seconds, greatest(0, coalesce(p_duration_seconds, 0))),
          updated_at = now()
      WHERE id = v_attempt.id RETURNING * INTO v_attempt;
    UPDATE public.dialer_sessions
      SET dials_completed = dials_completed + 1,
          contacts = contacts + CASE WHEN coalesce(p_reached, false) THEN 1 ELSE 0 END,
          outcomes = jsonb_set(outcomes, ARRAY[trim(p_disposition)], to_jsonb(coalesce((outcomes ->> trim(p_disposition))::integer, 0) + 1), true),
          updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  ELSE
    RAISE EXCEPTION 'invalid_attempt_action';
  END IF;

  RETURN to_jsonb(v_attempt);
END
$$;

REVOKE ALL ON FUNCTION public.transition_dialer_attempt_v1(uuid, text, text, text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_dialer_attempt_v1(uuid, text, text, text, text, integer, boolean) TO service_role;

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
  v_session public.dialer_sessions;
  v_attempt public.dialer_session_attempts;
  v_next_index integer;
BEGIN
  SELECT * INTO v_session FROM public.dialer_sessions
  WHERE id = p_session_id AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_session.status <> 'active' THEN RAISE EXCEPTION 'session_not_active'; END IF;

  SELECT * INTO v_attempt FROM public.dialer_session_attempts
  WHERE session_id = v_session.id AND client_attempt_id = trim(p_client_attempt_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v_attempt.status <> 'dispositioned' THEN RAISE EXCEPTION 'disposition_required'; END IF;
  IF v_attempt.advanced_at IS NOT NULL THEN RETURN public.dialer_session_json_v1(v_session); END IF;
  IF v_attempt.lead_id IS DISTINCT FROM v_session.current_lead_id THEN RAISE EXCEPTION 'session_lead_mismatch'; END IF;

  UPDATE public.dialer_session_attempts SET advanced_at = now(), updated_at = now()
    WHERE id = v_attempt.id;
  v_next_index := v_session.current_index + 1;
  IF v_next_index >= v_session.queue_size THEN
    UPDATE public.dialer_sessions
      SET status = 'completed', ended_at = now(), updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  ELSE
    UPDATE public.dialer_sessions
      SET current_index = v_next_index,
          current_lead_id = (queue_snapshot ->> v_next_index)::uuid,
          updated_at = now(), state_version = state_version + 1
      WHERE id = v_session.id RETURNING * INTO v_session;
  END IF;

  INSERT INTO public.dialer_session_events (session_id, lead_id, event_type, disposition, phone, metadata)
    VALUES (v_session.id, v_attempt.lead_id, 'lead_completed', v_attempt.disposition, v_attempt.phone,
      jsonb_build_object('client_attempt_id', v_attempt.client_attempt_id));
  RETURN public.dialer_session_json_v1(v_session);
END
$$;

REVOKE ALL ON FUNCTION public.advance_dialer_session_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_dialer_session_v1(uuid, text, text) TO service_role;

-- The browser never reads these tables directly. API handlers use service role.
REVOKE ALL ON TABLE public.dialer_sessions, public.dialer_session_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dialer_sessions, public.dialer_session_events TO service_role;
