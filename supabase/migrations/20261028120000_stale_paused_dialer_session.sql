-- Stale paused dialer sessions stay "open" (ended_at null) and block the
-- one-session-per-actor lock plus campaign-member claim. That burned the
-- 2026-09-01 America/Chicago calling day: session 11355a3b stayed paused
-- with 0 attempts after Monday, and Casey could not start Jackson Tax 3+.
--
-- This migration makes the trap fail closed and recoverable:
--   * detect stale paused (0 attempts this Chicago day, or paused past 15m)
--   * block new starts until the row is cleared
--   * end the row without draining mojo_call_queue
-- Existing release_prospecting_dialer_batch_v1 still frees claimed members.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.dialer_session_is_stale_paused_v1(p_session public.dialer_sessions)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    p_session.status = 'paused'
    AND p_session.ended_at IS NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.dialer_session_attempts attempt
        WHERE attempt.session_id = p_session.id
          AND attempt.created_at >= (
            date_trunc('day', timezone('America/Chicago', now()))
            AT TIME ZONE 'America/Chicago'
          )
      )
      OR p_session.paused_at IS NULL
      OR p_session.paused_at <= now() - interval '15 minutes'
    )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_is_stale_paused_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_is_stale_paused_v1(public.dialer_sessions)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_stale_paused_dialer_sessions_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', session_row.id,
    'status', session_row.status,
    'actorEmail', session_row.actor_email,
    'agentName', session_row.agent_name,
    'prospectingCampaignId', session_row.prospecting_campaign_id,
    'campaignName', coalesce(session_row.settings_snapshot ->> 'campaignName', ''),
    'startedAt', session_row.started_at,
    'pausedAt', session_row.paused_at,
    'endedAt', session_row.ended_at,
    'attemptCountToday', (
      SELECT count(*)
      FROM public.dialer_session_attempts attempt
      WHERE attempt.session_id = session_row.id
        AND attempt.created_at >= (
          date_trunc('day', timezone('America/Chicago', now()))
          AT TIME ZONE 'America/Chicago'
        )
    )
  ) ORDER BY session_row.paused_at NULLS FIRST, session_row.updated_at), '[]'::jsonb)
  FROM public.dialer_sessions session_row
  WHERE public.dialer_session_is_stale_paused_v1(session_row)
$$;

REVOKE ALL ON FUNCTION public.list_stale_paused_dialer_sessions_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_stale_paused_dialer_sessions_v1()
  TO service_role;

CREATE OR REPLACE FUNCTION public.clear_stale_paused_dialer_session_v1(
  p_session_id uuid,
  p_actor_email text,
  p_reason text DEFAULT 'stale_paused_session_cleared'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  session_row public.dialer_sessions;
  open_attempt public.dialer_session_attempts;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
  IF actor_key = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF reason IS NULL THEN reason := 'stale_paused_session_cleared'; END IF;
  IF char_length(reason) > 200 THEN RAISE EXCEPTION 'invalid_clear_reason'; END IF;

  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status IN ('completed', 'stopped') AND session_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'cleared', false,
      'alreadyEnded', true,
      'session', public.dialer_session_json_v1(session_row)
    );
  END IF;
  IF NOT public.dialer_session_is_stale_paused_v1(session_row) THEN
    RAISE EXCEPTION 'session_not_stale_paused';
  END IF;

  SELECT * INTO open_attempt
  FROM public.dialer_session_attempts
  WHERE session_id = session_row.id
    AND status IN ('authorized', 'dialing', 'connected')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'call_in_progress'; END IF;

  SELECT * INTO open_attempt
  FROM public.dialer_session_attempts
  WHERE session_id = session_row.id
    AND status = 'awaiting_disposition'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.dialer_session_attempts
    SET status = 'cancelled',
        disposition = coalesce(disposition, 'interrupted'),
        ended_at = coalesce(ended_at, now()),
        dispositioned_at = coalesce(dispositioned_at, now()),
        updated_at = now()
    WHERE id = open_attempt.id;
    INSERT INTO public.dialer_session_events (
      session_id, lead_id, prospect_id, subject_kind, subject_id,
      campaign_member_id, event_type, notes, metadata
    ) VALUES (
      session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
      session_row.current_subject_kind, session_row.current_subject_id,
      session_row.current_campaign_member_id,
      'attempt_interrupted_by_stale_clear',
      'Cancelled unfinished outcome while clearing a stale paused session',
      jsonb_build_object(
        'attempt_id', open_attempt.id,
        'cleared_by', actor_key,
        'clear_reason', reason
      )
    );
  END IF;

  UPDATE public.dialer_sessions
  SET status = 'stopped',
      stop_requested_at = coalesce(stop_requested_at, now()),
      ended_at = coalesce(ended_at, now()),
      paused_at = paused_at,
      updated_at = now(),
      state_version = state_version + 1
  WHERE id = session_row.id
  RETURNING * INTO session_row;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, notes, metadata
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id,
    'session_stop',
    reason,
    jsonb_build_object(
      'cleared_stale_paused', true,
      'cleared_by', actor_key,
      'mojo_call_queue_drained', false
    )
  );

  RETURN jsonb_build_object(
    'cleared', true,
    'alreadyEnded', false,
    'session', public.dialer_session_json_v1(session_row)
  );
END
$$;

REVOKE ALL ON FUNCTION public.clear_stale_paused_dialer_session_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_stale_paused_dialer_session_v1(uuid, text, text)
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

  IF open_session_id IS NOT NULL AND public.dialer_session_is_stale_paused_v1(open_session) THEN
    RAISE EXCEPTION 'stale_paused_session_blocks_start';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.dialer_sessions other
    WHERE other.prospecting_campaign_id = p_campaign_id
      AND other.id IS DISTINCT FROM open_session_id
      AND public.dialer_session_is_stale_paused_v1(other)
  ) THEN
    RAISE EXCEPTION 'stale_paused_session_blocks_start';
  END IF;

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

COMMENT ON FUNCTION public.clear_stale_paused_dialer_session_v1(uuid, text, text) IS
  'Ends a stale paused dialer session without draining mojo_call_queue. Releases claimed campaign members through the existing status trigger.';
