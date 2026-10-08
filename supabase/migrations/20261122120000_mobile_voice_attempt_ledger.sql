-- A mobile outbound call has no Twilio call SID while it is Connecting, and a
-- Twilio Call resource does not expose its status callback URL. The PSTN leg's
-- signed status callback carries the phone's attempt id, so this ledger maps
-- (agent identity, attempt) to the provider parent call and holds an End that
-- arrived before Twilio reported any leg. A web dialer call on the same client
-- identity never has a mobile attempt row, so a mobile End cannot reach it.

CREATE TABLE IF NOT EXISTS public.mobile_voice_attempts (
  agent_identity text NOT NULL,
  client_attempt_id text NOT NULL,
  source text,
  parent_call_sid text,
  last_call_sid text,
  last_status text,
  end_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_identity, client_attempt_id),
  CHECK (char_length(agent_identity) BETWEEN 1 AND 120),
  CHECK (char_length(client_attempt_id) BETWEEN 1 AND 200),
  CHECK (source IS NULL OR source IN ('mobile_manual', 'mobile_lead')),
  CHECK (parent_call_sid IS NULL OR parent_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  CHECK (last_call_sid IS NULL OR last_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
  CHECK (last_status IS NULL OR char_length(last_status) <= 40)
);

ALTER TABLE public.mobile_voice_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_voice_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mobile_voice_attempts TO service_role;
COMMENT ON TABLE public.mobile_voice_attempts IS
  'Service-role-only map from a mobile call attempt to its Twilio parent call, plus any End requested before Twilio reported a leg.';

-- Called from the signed Twilio status callback. The first parent SID wins:
-- one phone attempt id belongs to exactly one outbound call.
CREATE OR REPLACE FUNCTION public.record_mobile_voice_attempt_leg_v1(
  p_identity text, p_client_attempt_id text, p_source text,
  p_parent_call_sid text, p_call_sid text, p_status text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_voice_attempts%ROWTYPE;
BEGIN
  INSERT INTO public.mobile_voice_attempts AS attempt
    (agent_identity, client_attempt_id, source, parent_call_sid, last_call_sid, last_status)
  VALUES (
    p_identity, p_client_attempt_id, p_source,
    nullif(p_parent_call_sid, ''), nullif(p_call_sid, ''), nullif(p_status, '')
  )
  ON CONFLICT (agent_identity, client_attempt_id) DO UPDATE SET
    source = coalesce(attempt.source, EXCLUDED.source),
    parent_call_sid = coalesce(attempt.parent_call_sid, EXCLUDED.parent_call_sid),
    last_call_sid = coalesce(EXCLUDED.last_call_sid, attempt.last_call_sid),
    last_status = coalesce(EXCLUDED.last_status, attempt.last_status),
    updated_at = clock_timestamp()
  RETURNING * INTO r;
  RETURN jsonb_build_object('parent_call_sid', r.parent_call_sid, 'end_requested', r.end_requested_at IS NOT NULL);
END;
$$;

-- Called from the authenticated mobile hangup route. Returns the parent SID
-- when Twilio already reported a leg; otherwise the stored request is enforced
-- by the next signed status callback for this attempt.
CREATE OR REPLACE FUNCTION public.request_mobile_voice_attempt_end_v1(
  p_identity text, p_client_attempt_id text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_voice_attempts%ROWTYPE;
BEGIN
  INSERT INTO public.mobile_voice_attempts AS attempt (agent_identity, client_attempt_id, end_requested_at)
  VALUES (p_identity, p_client_attempt_id, clock_timestamp())
  ON CONFLICT (agent_identity, client_attempt_id) DO UPDATE SET
    end_requested_at = coalesce(attempt.end_requested_at, EXCLUDED.end_requested_at),
    updated_at = clock_timestamp()
  RETURNING * INTO r;
  RETURN jsonb_build_object('parent_call_sid', r.parent_call_sid, 'end_requested', true);
END;
$$;

REVOKE ALL ON FUNCTION public.record_mobile_voice_attempt_leg_v1(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_mobile_voice_attempt_end_v1(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mobile_voice_attempt_leg_v1(text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_mobile_voice_attempt_end_v1(text,text) TO service_role;
