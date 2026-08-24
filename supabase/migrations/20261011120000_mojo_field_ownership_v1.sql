-- Mojo field ownership v1.
-- Provider data is retained in crm_mojo_call_events and lead_activities.
-- Only identity gaps plus the latest call snapshot may update leads.
-- County, tax, deceased, property, and source facts remain CRM-controlled.

ALTER TABLE public.agent_daily_stats
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

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
      -- CRM policy creates the identity shell. Mojo property/list fields remain
      -- immutable provider evidence and never become canonical property/source data.
      INSERT INTO public.leads(
        full_name, phone, email, source, station, priority
      ) VALUES (
        name_value, phone_value, email_value, 'mojo_call', 'new', 'normal'
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


COMMENT ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz) IS
  'Ingests immutable Mojo call evidence. Lead writes follow mojo_field_ownership_v1: identity fill-only, latest operational call snapshot, and governed lifecycle commands.';

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('mojo_field_ownership_version', '"mojo_field_ownership_v1"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
