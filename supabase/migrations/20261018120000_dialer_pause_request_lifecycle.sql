-- Durable pause requests for the single-line prospecting dialer.
--
-- A pause command must take effect even when the most recent call still needs
-- an outcome. The session becomes non-callable immediately, while the open
-- attempt remains available for one disposition. This prevents a hang-up or
-- stale client from advancing into another number after the agent paused.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.request_pause_dialer_session_v1(
  p_session_id uuid,
  p_actor_email text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  open_attempt boolean;
BEGIN
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND lower(actor_email) = lower(trim(p_actor_email))
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF session_row.status IN ('completed', 'stopped') THEN
    RAISE EXCEPTION 'invalid_session_transition';
  END IF;
  IF session_row.stop_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'session_stop_requested';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.dialer_session_attempts
    WHERE session_id = session_row.id
      AND status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) INTO open_attempt;

  IF session_row.status = 'active' THEN
    UPDATE public.dialer_sessions
    SET status = 'paused',
        paused_at = coalesce(paused_at, now()),
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
      CASE WHEN open_attempt THEN 'session_pause_requested' ELSE 'session_pause' END,
      nullif(trim(p_reason), ''),
      jsonb_build_object('requires_disposition', open_attempt)
    );
  END IF;

  RETURN jsonb_build_object(
    'session', public.dialer_session_json_v1(session_row),
    'requiresDisposition', open_attempt
  );
END
$$;

REVOKE ALL ON FUNCTION public.request_pause_dialer_session_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_pause_dialer_session_v1(uuid, text, text)
  TO service_role;
