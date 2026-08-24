-- Subject-aware durable single-line dialer sessions.
--
-- Legacy Lead-only sessions continue to use their UUID-array queue snapshots.
-- New V2 sessions store reviewed queue objects and never create shadow Leads
-- for source Prospects.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS current_subject_kind text,
  ADD COLUMN IF NOT EXISTS current_subject_id uuid,
  ADD COLUMN IF NOT EXISTS current_prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_campaign_member_id uuid REFERENCES public.prospecting_campaign_members(id) ON DELETE SET NULL;

UPDATE public.dialer_sessions
SET current_subject_kind = 'lead',
    current_subject_id = current_lead_id
WHERE current_lead_id IS NOT NULL
  AND current_subject_id IS NULL;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_current_subject_kind_check,
  ADD CONSTRAINT dialer_sessions_current_subject_kind_check
    CHECK (current_subject_kind IS NULL OR current_subject_kind IN ('lead', 'prospect')) NOT VALID;
ALTER TABLE public.dialer_sessions
  VALIDATE CONSTRAINT dialer_sessions_current_subject_kind_check;

ALTER TABLE public.dialer_session_attempts
  ADD COLUMN IF NOT EXISTS subject_kind text,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_member_id uuid REFERENCES public.prospecting_campaign_members(id) ON DELETE SET NULL;

UPDATE public.dialer_session_attempts
SET subject_kind = 'lead', subject_id = lead_id
WHERE lead_id IS NOT NULL AND subject_id IS NULL;

ALTER TABLE public.dialer_session_attempts
  DROP CONSTRAINT IF EXISTS dialer_session_attempts_subject_check,
  ADD CONSTRAINT dialer_session_attempts_subject_check
    CHECK (
      (subject_kind IS NULL AND subject_id IS NULL)
      OR (subject_kind = 'lead' AND subject_id IS NOT NULL AND lead_id = subject_id AND prospect_id IS NULL)
      OR (subject_kind = 'prospect' AND subject_id IS NOT NULL AND prospect_id = subject_id AND lead_id IS NULL)
    ) NOT VALID;
ALTER TABLE public.dialer_session_attempts
  VALIDATE CONSTRAINT dialer_session_attempts_subject_check;

ALTER TABLE public.dialer_session_events
  ADD COLUMN IF NOT EXISTS subject_kind text,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_member_id uuid REFERENCES public.prospecting_campaign_members(id) ON DELETE SET NULL;

UPDATE public.dialer_session_events
SET subject_kind = 'lead', subject_id = lead_id
WHERE lead_id IS NOT NULL AND subject_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_session_attempts_subject
  ON public.dialer_session_attempts (subject_kind, subject_id, created_at DESC)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dialer_session_events_subject
  ON public.dialer_session_events (subject_kind, subject_id, created_at DESC)
  WHERE subject_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_legacy_dialer_session_subject_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.current_lead_id IS NOT NULL
    AND (NEW.current_subject_id IS NULL OR NEW.current_subject_kind = 'lead')
  THEN
    NEW.current_subject_kind := 'lead';
    NEW.current_subject_id := NEW.current_lead_id;
    NEW.current_prospect_id := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_legacy_dialer_session_subject_v2()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_legacy_dialer_session_subject_v2 ON public.dialer_sessions;
CREATE TRIGGER sync_legacy_dialer_session_subject_v2
  BEFORE INSERT OR UPDATE OF current_lead_id ON public.dialer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_dialer_session_subject_v2();

CREATE OR REPLACE FUNCTION public.dialer_queue_item_v2(p_snapshot jsonb, p_index integer)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'array' OR p_index < 0 OR p_index >= jsonb_array_length(p_snapshot) THEN NULL
    WHEN jsonb_typeof(p_snapshot -> p_index) = 'string' THEN jsonb_build_object(
      'kind', 'lead',
      'id', p_snapshot ->> p_index,
      'leadId', p_snapshot ->> p_index,
      'prospectId', NULL,
      'campaignMemberId', NULL
    )
    ELSE p_snapshot -> p_index
  END
$$;

REVOKE ALL ON FUNCTION public.dialer_queue_item_v2(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_queue_item_v2(jsonb, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_session_queue_items_v2(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(public.dialer_queue_item_v2(p_snapshot, item.ordinality::integer - 1) ORDER BY item.ordinality), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_snapshot, '[]'::jsonb)) WITH ORDINALITY item(value, ordinality)
$$;

REVOKE ALL ON FUNCTION public.dialer_session_queue_items_v2(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_queue_items_v2(jsonb) TO service_role;

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
    'endedAt', p_session.ended_at,
    'updatedAt', p_session.updated_at,
    'stateVersion', p_session.state_version
  )
$$;

REVOKE ALL ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_session_json_v1(public.dialer_sessions) TO service_role;

CREATE OR REPLACE FUNCTION public.start_dialer_session_v2(
  p_actor_email text,
  p_agent_name text,
  p_queue_key text,
  p_queue_items jsonb,
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
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  session_row public.dialer_sessions;
  first_item jsonb;
  queue_size integer;
BEGIN
  IF actor_key = '' OR coalesce(trim(p_agent_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF jsonb_typeof(coalesce(p_queue_items, 'null'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid_queue'; END IF;
  queue_size := jsonb_array_length(p_queue_items);
  IF queue_size < 1 OR queue_size > 100 THEN RAISE EXCEPTION 'invalid_queue_size'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_queue_items) item
    WHERE jsonb_typeof(item) <> 'object'
      OR coalesce(item ->> 'kind', '') NOT IN ('lead', 'prospect')
      OR coalesce(item ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (item ->> 'kind' = 'lead' AND nullif(item ->> 'leadId', '') IS DISTINCT FROM nullif(item ->> 'id', ''))
      OR (item ->> 'kind' = 'lead' AND nullif(item ->> 'prospectId', '') IS NOT NULL)
      OR (item ->> 'kind' = 'prospect' AND nullif(item ->> 'prospectId', '') IS DISTINCT FROM nullif(item ->> 'id', ''))
      OR (item ->> 'kind' = 'prospect' AND nullif(item ->> 'leadId', '') IS NOT NULL)
  ) THEN RAISE EXCEPTION 'invalid_queue_subject'; END IF;

  IF (
    SELECT count(*) FROM (
      SELECT DISTINCT item ->> 'kind' AS kind, item ->> 'id' AS id
      FROM jsonb_array_elements(p_queue_items) item
    ) unique_item
  ) <> queue_size THEN RAISE EXCEPTION 'duplicate_queue_subject'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_queue_items) item
    WHERE item ->> 'kind' = 'lead'
      AND NOT EXISTS (SELECT 1 FROM public.leads lead WHERE lead.id = (item ->> 'id')::uuid)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_queue_items) item
    WHERE item ->> 'kind' = 'prospect'
      AND NOT EXISTS (SELECT 1 FROM public.prospects prospect WHERE prospect.id = (item ->> 'id')::uuid)
  ) THEN RAISE EXCEPTION 'invalid_queue_subject'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_queue_items) item
    WHERE nullif(item ->> 'campaignMemberId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.prospecting_campaign_members member
        WHERE member.id = (item ->> 'campaignMemberId')::uuid
          AND member.subject_kind = item ->> 'kind'
          AND coalesce(member.lead_id, member.prospect_id) = (item ->> 'id')::uuid
      )
  ) THEN RAISE EXCEPTION 'invalid_campaign_member_subject'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0));
  SELECT * INTO session_row
  FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('created', false, 'session', public.dialer_session_json_v1(session_row)); END IF;

  first_item := public.dialer_queue_item_v2(p_queue_items, 0);
  INSERT INTO public.dialer_sessions (
    actor_email, agent_name, queue_key, saved_queue_id, campaign, mode,
    lines_per_agent, queue_snapshot, queue_size, current_index,
    current_lead_id, current_prospect_id, current_subject_kind,
    current_subject_id, current_campaign_member_id, caller_id,
    settings_snapshot, status
  ) VALUES (
    actor_key, trim(p_agent_name), coalesce(nullif(trim(p_queue_key), ''), 'custom'),
    p_saved_queue_id, 'All sources', 'power', 1, p_queue_items, queue_size, 0,
    CASE WHEN first_item ->> 'kind' = 'lead' THEN (first_item ->> 'id')::uuid END,
    CASE WHEN first_item ->> 'kind' = 'prospect' THEN (first_item ->> 'id')::uuid END,
    first_item ->> 'kind', (first_item ->> 'id')::uuid,
    nullif(first_item ->> 'campaignMemberId', '')::uuid,
    nullif(trim(p_caller_id), ''), coalesce(p_settings_snapshot, '{}'::jsonb), 'active'
  ) RETURNING * INTO session_row;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, metadata
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id, 'session_started',
    jsonb_build_object('queue_size', session_row.queue_size)
  );
  RETURN jsonb_build_object('created', true, 'session', public.dialer_session_json_v1(session_row));
END
$$;

REVOKE ALL ON FUNCTION public.start_dialer_session_v2(text, text, text, jsonb, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_dialer_session_v2(text, text, text, jsonb, text, uuid, jsonb)
  TO service_role;

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

  IF p_action = 'pause' THEN
    IF session_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions SET status = 'paused', paused_at = now(), updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
  ELSIF p_action = 'resume' THEN
    IF session_row.status <> 'paused' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions SET status = 'active', paused_at = NULL, updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
  ELSIF p_action = 'stop' THEN
    IF session_row.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
    UPDATE public.dialer_sessions SET status = 'stopped', ended_at = now(), updated_at = now(), state_version = state_version + 1
    WHERE id = session_row.id RETURNING * INTO session_row;
  ELSIF p_action = 'skip' THEN
    IF session_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_session_transition'; END IF;
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
  ELSE RAISE EXCEPTION 'invalid_session_action'; END IF;

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, notes
  ) VALUES (
    session_row.id, session_row.current_lead_id, session_row.current_prospect_id,
    session_row.current_subject_kind, session_row.current_subject_id,
    session_row.current_campaign_member_id, 'session_' || p_action, nullif(trim(p_reason), '')
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

  INSERT INTO public.dialer_session_events (
    session_id, lead_id, prospect_id, subject_kind, subject_id,
    campaign_member_id, event_type, disposition, phone, metadata
  ) VALUES (
    session_row.id, attempt_row.lead_id, attempt_row.prospect_id,
    attempt_row.subject_kind, attempt_row.subject_id, attempt_row.campaign_member_id,
    'subject_completed', attempt_row.disposition, attempt_row.phone,
    jsonb_build_object('client_attempt_id', attempt_row.client_attempt_id, 'prospect_phone_id', attempt_row.prospect_phone_id)
  );
  RETURN public.dialer_session_json_v1(session_row);
END
$$;

REVOKE ALL ON FUNCTION public.advance_dialer_session_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_dialer_session_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v2(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_caller_id text
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
BEGIN
  IF actor_key = '' OR coalesce(trim(p_actor_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0));
  SELECT * INTO campaign_row FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = actor_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  IF campaign_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;
  IF nullif(trim(coalesce(p_caller_id, '')), '') IS NULL OR trim(p_caller_id) IS DISTINCT FROM trim(campaign_row.caller_id) THEN
    RAISE EXCEPTION 'invalid_caller_id';
  END IF;

  SELECT * INTO open_session FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object(
    'created', false,
    'session', public.dialer_session_json_v1(open_session),
    'batchSize', open_session.queue_size,
    'remaining', (SELECT count(*) FROM public.prospecting_campaign_members WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL)
  ); END IF;

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
        WHERE contact.member_id = member.id AND contact.status = 'ready'
      )
    ORDER BY member.enrolled_at, member.id
    LIMIT 100 FOR UPDATE
  ) candidate;
  IF coalesce(jsonb_array_length(queue_items), 0) = 0 THEN RAISE EXCEPTION 'campaign_dialer_complete'; END IF;

  session_result := public.start_dialer_session_v2(
    actor_key, trim(p_actor_name), 'campaign:' || p_campaign_id::text,
    queue_items, trim(p_caller_id), NULL,
    jsonb_build_object('prospectingCampaignId', p_campaign_id, 'campaignName', campaign_row.name)
  );
  session_id := (session_result -> 'session' ->> 'id')::uuid;
  UPDATE public.dialer_sessions SET prospecting_campaign_id = p_campaign_id WHERE id = session_id AND lower(actor_email) = actor_key;
  UPDATE public.prospecting_campaign_members SET dialer_session_id = session_id, updated_at = now()
  WHERE id = ANY(member_ids) AND campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL;
  SELECT count(*) INTO remaining FROM public.prospecting_campaign_members
  WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL;
  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (p_campaign_id, 'dialer_batch_started', trim(p_actor_name), jsonb_build_object(
    'dialer_session_id', session_id, 'batch_size', jsonb_array_length(queue_items), 'remaining', remaining
  ));
  RETURN session_result || jsonb_build_object('batchSize', jsonb_array_length(queue_items), 'remaining', remaining);
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v2(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v2(uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.project_prospecting_dialer_event_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  member_row public.prospecting_campaign_members;
BEGIN
  IF NEW.event_type NOT IN ('lead_completed', 'subject_completed') THEN RETURN NEW; END IF;
  SELECT * INTO session_row FROM public.dialer_sessions WHERE id = NEW.session_id;
  IF NOT FOUND OR session_row.prospecting_campaign_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.prospecting_campaign_members
  SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
  WHERE campaign_id = session_row.prospecting_campaign_id
    AND status = 'active'
    AND (
      (NEW.campaign_member_id IS NOT NULL AND id = NEW.campaign_member_id)
      OR
      (NEW.campaign_member_id IS NULL AND NEW.lead_id IS NOT NULL AND lead_id = NEW.lead_id)
    )
  RETURNING * INTO member_row;

  IF FOUND THEN
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
    VALUES (member_row.campaign_id, member_row.id, 'member_call_completed', session_row.agent_name, jsonb_build_object(
      'dialer_session_id', NEW.session_id, 'disposition', NEW.disposition,
      'phone', NEW.phone, 'subject_kind', member_row.subject_kind,
      'subject_id', coalesce(member_row.lead_id, member_row.prospect_id)
    ));
    IF NOT EXISTS (SELECT 1 FROM public.prospecting_campaign_members WHERE campaign_id = member_row.campaign_id AND status = 'active') THEN
      UPDATE public.prospecting_campaigns SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
      WHERE id = member_row.campaign_id AND status = 'active';
    ELSE
      UPDATE public.prospecting_campaigns SET updated_at = now() WHERE id = member_row.campaign_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.project_prospecting_dialer_event_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_prospecting_dialer_event_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_project_dialer_event ON public.dialer_session_events;
CREATE TRIGGER prospecting_project_dialer_event
  AFTER INSERT ON public.dialer_session_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('lead_completed', 'subject_completed'))
  EXECUTE FUNCTION public.project_prospecting_dialer_event_v1();

COMMENT ON FUNCTION public.start_dialer_session_v2(text, text, text, jsonb, text, uuid, jsonb) IS
  'Starts a durable single-line queue of canonical Lead or source-Prospect subjects without creating shadow Leads.';
