-- Canonical Mojo call ingestion.
--
-- Mojo is a provider evidence source, not a second CRM. This migration keeps
-- the existing import queue as the durable transport, adds an immutable call
-- event ledger, and exposes service-role-only claim/ingest/finish commands.

CREATE TABLE IF NOT EXISTS public.crm_mojo_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id text NOT NULL UNIQUE CHECK (char_length(record_id) BETWEEN 1 AND 160),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  activity_id uuid REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  call_at timestamptz NOT NULL,
  normalized_phone text,
  contact_name text,
  property_address text,
  city text,
  state text,
  zip text,
  email text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds BETWEEN 0 AND 86400),
  disposition_raw text NOT NULL CHECK (char_length(disposition_raw) BETWEEN 1 AND 250),
  outcome text NOT NULL CHECK (outcome IN (
    'callback_scheduled', 'meaningful_conversation', 'appointment_set',
    'not_interested', 'wrong_number', 'disconnected', 'no_answer',
    'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
  )),
  agent_name text,
  agent_key text NOT NULL CHECK (char_length(agent_key) BETWEEN 1 AND 80),
  notes text,
  list_name text,
  campaign_name text,
  recording_url text,
  follow_up_at timestamptz,
  unresolved_reason text CHECK (unresolved_reason IS NULL OR unresolved_reason IN (
    'invalid_phone', 'duplicate_phone', 'unknown_contact'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_mojo_call_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_mojo_call_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_mojo_call_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_lead_time
  ON public.crm_mojo_call_events(lead_id, call_at DESC, record_id DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_phone_time
  ON public.crm_mojo_call_events(normalized_phone, call_at DESC, record_id DESC)
  WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_phones_canonical_phone
  ON public.prospect_phones(public.normalize_conversation_phone(phone))
  WHERE public.normalize_conversation_phone(phone) IS NOT NULL;

ALTER TABLE public.mojo_call_queue
  ADD COLUMN IF NOT EXISTS call_event_id uuid
  REFERENCES public.crm_mojo_call_events(id) ON DELETE SET NULL;

ALTER TABLE public.mojo_call_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mojo_call_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mojo_call_queue TO service_role;

CREATE INDEX IF NOT EXISTS idx_mojo_call_queue_claim_v1
  ON public.mojo_call_queue(created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.claim_mojo_call_queue_v1(p_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, record_id text, payload jsonb, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.mojo_call_queue AS stale
  SET status = CASE WHEN coalesce(stale.attempts, 0) >= 3 THEN 'dead_letter' ELSE 'pending' END,
      processing_started_at = NULL,
      last_error = CASE
        WHEN coalesce(stale.attempts, 0) >= 3 THEN coalesce(stale.last_error, 'processing_lease_expired')
        ELSE stale.last_error
      END
  WHERE stale.status = 'processing'
    AND stale.processing_started_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH candidates AS (
    SELECT queue.id
    FROM public.mojo_call_queue AS queue
    WHERE queue.status = 'pending'
      AND coalesce(queue.attempts, 0) < 3
    ORDER BY queue.created_at, queue.id
    LIMIT greatest(1, least(coalesce(p_limit, 5), 10))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.mojo_call_queue AS queue SET
    status = 'processing',
    processing_started_at = now(),
    attempts = coalesce(queue.attempts, 0) + 1,
    last_error = NULL
  FROM candidates
  WHERE queue.id = candidates.id
  RETURNING queue.id, queue.record_id, queue.payload, queue.attempts;
END
$$;
REVOKE ALL ON FUNCTION public.claim_mojo_call_queue_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mojo_call_queue_v1(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_mojo_call_queue_v1(
  p_queue_id uuid,
  p_success boolean,
  p_lead_id uuid DEFAULT NULL,
  p_call_event_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  queue public.mojo_call_queue;
  next_status text;
BEGIN
  SELECT * INTO queue
  FROM public.mojo_call_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF queue.id IS NULL THEN RAISE EXCEPTION 'mojo_queue_item_not_found'; END IF;
  IF queue.status <> 'processing' THEN RAISE EXCEPTION 'mojo_queue_claim_mismatch'; END IF;

  next_status := CASE
    WHEN p_success THEN 'completed'
    WHEN coalesce(queue.attempts, 0) >= 3 THEN 'dead_letter'
    ELSE 'pending'
  END;

  UPDATE public.mojo_call_queue SET
    status = next_status,
    lead_id = CASE WHEN p_success THEN p_lead_id ELSE lead_id END,
    call_event_id = CASE WHEN p_success THEN p_call_event_id ELSE call_event_id END,
    manifest_id = CASE WHEN p_success THEN NULL ELSE manifest_id END,
    opportunity_score = CASE WHEN p_success THEN NULL ELSE opportunity_score END,
    processing_started_at = NULL,
    completed_at = CASE WHEN p_success THEN now() ELSE NULL END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error, 'unknown_error'), 1000) END
  WHERE id = p_queue_id;

  RETURN next_status;
END
$$;
REVOKE ALL ON FUNCTION public.finish_mojo_call_queue_v1(uuid,boolean,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_mojo_call_queue_v1(uuid,boolean,uuid,uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_crm_mojo_call_v1(
  p_call jsonb,
  p_outcome text,
  p_call_at timestamptz,
  p_follow_up_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing public.crm_mojo_call_events;
  event_row public.crm_mojo_call_events;
  lead_row public.leads;
  candidate_ids uuid[];
  activity_value uuid;
  record_value text := nullif(btrim(coalesce(p_call->>'record_id', '')), '');
  phone_value text := public.normalize_conversation_phone(p_call->>'phone_number');
  name_value text := nullif(btrim(coalesce(p_call->>'contact_name', '')), '');
  address_value text := nullif(btrim(coalesce(p_call->>'property_address', '')), '');
  city_value text := nullif(btrim(coalesce(p_call->>'city', '')), '');
  state_value text := nullif(upper(btrim(coalesce(p_call->>'state', ''))), '');
  zip_value text := nullif(btrim(coalesce(p_call->>'zip', '')), '');
  email_value text := nullif(lower(btrim(coalesce(p_call->>'email', ''))), '');
  disposition_value text := nullif(btrim(coalesce(p_call->>'disposition', '')), '');
  agent_value text := nullif(btrim(coalesce(p_call->>'agent_name', '')), '');
  agent_key_value text := CASE
    WHEN lower(coalesce(p_call->>'agent_name', '')) LIKE '%ernest%' THEN 'ernest'
    WHEN lower(coalesce(p_call->>'agent_name', '')) LIKE '%casey%' THEN 'casey'
    ELSE 'casey'
  END;
  notes_value text := nullif(btrim(coalesce(p_call->>'notes', '')), '');
  list_value text := nullif(btrim(coalesce(p_call->>'list_name', '')), '');
  campaign_value text := nullif(btrim(coalesce(p_call->>'campaign_name', '')), '');
  recording_value text := nullif(btrim(coalesce(p_call->>'recording_url', '')), '');
  duration_value integer := CASE
    WHEN coalesce(p_call->>'call_duration', '') ~ '^[0-9]{1,5}$'
      THEN least((p_call->>'call_duration')::integer, 86400)
    ELSE 0
  END;
  unresolved_value text;
  is_latest boolean := false;
BEGIN
  IF jsonb_typeof(p_call) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_mojo_call'; END IF;
  IF record_value IS NULL OR char_length(record_value) > 160 THEN RAISE EXCEPTION 'invalid_mojo_record_id'; END IF;
  IF p_call_at IS NULL OR p_call_at > clock_timestamp() + interval '1 day'
     OR p_call_at < timestamptz '2000-01-01' THEN RAISE EXCEPTION 'invalid_mojo_call_time'; END IF;
  IF disposition_value IS NULL OR char_length(disposition_value) > 250 THEN RAISE EXCEPTION 'invalid_mojo_disposition'; END IF;
  IF p_outcome NOT IN (
    'callback_scheduled', 'meaningful_conversation', 'appointment_set',
    'not_interested', 'wrong_number', 'disconnected', 'no_answer',
    'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
  ) THEN RAISE EXCEPTION 'invalid_mojo_outcome'; END IF;
  IF coalesce(char_length(name_value), 0) > 250
    OR coalesce(char_length(address_value), 0) > 500
    OR coalesce(char_length(city_value), 0) > 160
    OR coalesce(char_length(state_value), 0) > 40
    OR coalesce(char_length(zip_value), 0) > 30
    OR coalesce(char_length(email_value), 0) > 320
    OR coalesce(char_length(agent_value), 0) > 160
    OR coalesce(char_length(notes_value), 0) > 10000
    OR coalesce(char_length(list_value), 0) > 250
    OR coalesce(char_length(campaign_value), 0) > 250
    OR coalesce(char_length(recording_value), 0) > 2000
  THEN RAISE EXCEPTION 'invalid_mojo_call_field'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('canonical-mojo-call:' || record_value, 0)
  );

  SELECT * INTO existing
  FROM public.crm_mojo_call_events
  WHERE record_id = record_value;

  IF existing.id IS NOT NULL THEN
    SELECT * INTO lead_row FROM public.leads WHERE id = existing.lead_id;
    is_latest := existing.lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.crm_mojo_call_events AS newer
      WHERE newer.lead_id = existing.lead_id
        AND (newer.call_at, newer.record_id) > (existing.call_at, existing.record_id)
    );
    RETURN jsonb_build_object(
      'eventId', existing.id, 'leadId', existing.lead_id,
      'activityId', existing.activity_id, 'outcome', existing.outcome,
      'normalizedPhone', existing.normalized_phone,
      'unresolvedReason', existing.unresolved_reason,
      'callAt', existing.call_at, 'followUpAt', existing.follow_up_at,
      'station', lead_row.station, 'assignedAgent', lead_row.assigned_agent,
      'latestForLead', is_latest, 'replayed', true
    );
  END IF;

  IF phone_value IS NULL THEN
    unresolved_value := 'invalid_phone';
  ELSE
    SELECT array_agg(candidate.id ORDER BY candidate.id)
    INTO candidate_ids
    FROM (
      SELECT DISTINCT matched.id
      FROM (
        SELECT lead.id
        FROM public.leads AS lead
        WHERE public.normalize_conversation_phone(lead.phone) = phone_value
        UNION ALL
        SELECT prospect.lead_id AS id
        FROM public.prospect_phones AS prospect_phone
        JOIN public.prospects AS prospect ON prospect.id = prospect_phone.prospect_id
        WHERE public.normalize_conversation_phone(prospect_phone.phone) = phone_value
          AND prospect.lead_id IS NOT NULL
      ) AS matched
      ORDER BY matched.id
      LIMIT 2
    ) AS candidate;

    IF coalesce(array_length(candidate_ids, 1), 0) > 1 THEN
      unresolved_value := 'duplicate_phone';
    ELSIF coalesce(array_length(candidate_ids, 1), 0) = 1 THEN
      SELECT * INTO lead_row FROM public.leads WHERE id = candidate_ids[1] FOR UPDATE;
    ELSIF p_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
      AND name_value IS NOT NULL
      AND lower(name_value) NOT IN ('unknown', 'mojo lead') THEN
      INSERT INTO public.leads(
        full_name, phone, email, property_address, city, state, zip,
        source, station, priority
      ) VALUES (
        name_value, phone_value, email_value, address_value, city_value,
        state_value, zip_value, 'mojo_call', 'new', 'normal'
      ) RETURNING * INTO lead_row;
    ELSE
      unresolved_value := 'unknown_contact';
    END IF;
  END IF;

  INSERT INTO public.crm_mojo_call_events(
    record_id, lead_id, call_at, normalized_phone, contact_name,
    property_address, city, state, zip, email, duration_seconds,
    disposition_raw, outcome, agent_name, agent_key, notes, list_name, campaign_name,
    recording_url, follow_up_at, unresolved_reason
  ) VALUES (
    record_value, lead_row.id, p_call_at, phone_value, name_value,
    address_value, city_value, state_value, zip_value, email_value, duration_value,
    disposition_value, p_outcome, agent_value, agent_key_value, notes_value, list_value,
    campaign_value, recording_value, p_follow_up_at, unresolved_value
  ) RETURNING * INTO event_row;

  -- `agent_daily_stats` remains a compatibility reporting projection. The
  -- immutable event above is the source of truth, so exact retries cannot
  -- increment the aggregate twice.
  INSERT INTO public.agent_daily_stats(
    agent_id, date, calls_made, meaningful_conversations,
    dispositions_logged, metadata
  ) VALUES (
    agent_key_value,
    (p_call_at AT TIME ZONE 'America/Chicago')::date,
    1,
    CASE WHEN p_outcome IN (
      'callback_scheduled', 'meaningful_conversation', 'appointment_set',
      'not_interested', 'already_sold', 'listed'
    ) THEN 1 ELSE 0 END,
    1,
    jsonb_build_object('call_source', 'crm_mojo_call_events', 'projection_version', 1)
  )
  ON CONFLICT (agent_id, date) DO UPDATE SET
    calls_made = coalesce(public.agent_daily_stats.calls_made, 0) + 1,
    meaningful_conversations = coalesce(public.agent_daily_stats.meaningful_conversations, 0) + EXCLUDED.meaningful_conversations,
    dispositions_logged = coalesce(public.agent_daily_stats.dispositions_logged, 0) + 1,
    metadata = coalesce(public.agent_daily_stats.metadata, '{}'::jsonb)
      || jsonb_build_object('call_source', 'crm_mojo_call_events', 'projection_version', 1);

  IF lead_row.id IS NOT NULL THEN
    INSERT INTO public.lead_activities(lead_id, activity_type, description, agent, metadata)
    VALUES (
      lead_row.id,
      'call',
      'Mojo call — ' || disposition_value || CASE WHEN notes_value IS NULL THEN '' ELSE ': ' || left(notes_value, 500) END,
      coalesce(agent_value, 'Mojo import'),
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'mojo_call_event', 'provider', 'mojo',
        'event_id', event_row.id, 'record_id', record_value,
        'direction', 'outbound', 'outcome', p_outcome,
        'disposition', disposition_value, 'phone', phone_value,
        'duration_seconds', duration_value, 'call_at', p_call_at,
        'notes', notes_value, 'list_name', list_value,
        'campaign_name', campaign_value, 'recording_url', recording_value,
        'follow_up_at', p_follow_up_at,
        'phone_status', CASE
          WHEN p_outcome = 'wrong_number' THEN 'wrong_number'
          WHEN p_outcome = 'disconnected' THEN 'disconnected'
          WHEN p_outcome = 'dnc' THEN 'dnc'
          ELSE NULL
        END
      ))
    ) RETURNING id INTO activity_value;

    UPDATE public.crm_mojo_call_events
    SET activity_id = activity_value, updated_at = now()
    WHERE id = event_row.id;
    event_row.activity_id := activity_value;

    is_latest := NOT EXISTS (
      SELECT 1 FROM public.crm_mojo_call_events AS newer
      WHERE newer.lead_id = lead_row.id
        AND newer.id <> event_row.id
        AND (newer.call_at, newer.record_id) > (event_row.call_at, event_row.record_id)
    );

    IF is_latest THEN
      UPDATE public.leads SET
        full_name = CASE
          WHEN name_value IS NOT NULL AND (
            nullif(btrim(coalesce(full_name, '')), '') IS NULL
            OR full_name IN ('Unknown', 'Mojo Lead')
            OR full_name LIKE 'Caller (%'
          ) THEN name_value ELSE full_name END,
        phone = CASE WHEN nullif(btrim(coalesce(phone, '')), '') IS NULL THEN phone_value ELSE phone END,
        email = CASE WHEN nullif(btrim(coalesce(email, '')), '') IS NULL THEN email_value ELSE email END,
        property_address = CASE WHEN nullif(btrim(coalesce(property_address, '')), '') IS NULL THEN address_value ELSE property_address END,
        city = CASE WHEN nullif(btrim(coalesce(city, '')), '') IS NULL THEN city_value ELSE city END,
        state = CASE WHEN nullif(btrim(coalesce(state, '')), '') IS NULL THEN state_value ELSE state END,
        zip = CASE WHEN nullif(btrim(coalesce(zip, '')), '') IS NULL THEN zip_value ELSE zip END,
        mojo_record_id = record_value,
        call_result = disposition_value,
        call_duration_seconds = duration_value,
        updated_at = now()
      WHERE id = lead_row.id
      RETURNING * INTO lead_row;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'eventId', event_row.id, 'leadId', event_row.lead_id,
    'activityId', event_row.activity_id, 'outcome', event_row.outcome,
    'normalizedPhone', event_row.normalized_phone,
    'unresolvedReason', event_row.unresolved_reason,
    'callAt', event_row.call_at, 'followUpAt', event_row.follow_up_at,
    'station', lead_row.station, 'assignedAgent', lead_row.assigned_agent,
    'latestForLead', is_latest, 'replayed', false
  );
END
$$;
REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  TO service_role;

COMMENT ON TABLE public.crm_mojo_call_events IS
  'Immutable provider-call evidence. Mojo facts are canonical here; AI interpretation requires a separate reviewed proposal.';
