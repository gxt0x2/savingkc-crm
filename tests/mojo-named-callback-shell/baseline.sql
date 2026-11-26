-- Pre-patch governed ingest. The fragments below match qualification v1.2 so
-- 20261222140002 can replace them. Behavior before that migration is what
-- before.sql records.

CREATE OR REPLACE FUNCTION public.ingest_crm_mojo_call_governed_v1(
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
  core_result jsonb;
  event_row public.crm_mojo_call_events;
  event_value uuid;
  provider_outcome text := nullif(btrim(coalesce(p_call->>'provider_outcome', p_outcome, '')), '');
  duration_value integer := CASE
    WHEN coalesce(p_call->>'call_duration', '') ~ '^[0-9]{1,5}$'
      THEN least((p_call->>'call_duration')::integer, 86400)
    ELSE 0
  END;
  recording_value text := nullif(btrim(coalesce(p_call->>'recording_url', '')), '');
  notes_value text := nullif(btrim(coalesce(p_call->>'notes', '')), '');
  requested_promotion boolean := lower(coalesce(p_call->>'promotion_eligible', 'false')) = 'true';
  qualified_by_agent boolean := lower(coalesce(p_call->>'qualified_by_agent', 'false')) = 'true';
  qualification_override_reason text := left(
    nullif(btrim(coalesce(p_call->>'qualification_override_reason', '')), ''),
    500
  );
  negative_intent boolean;
  seller_intent boolean;
  appointment_override boolean;
  scheduled_follow_up boolean := false;
  promotion_value boolean;
  status_value text;
  reasons_value text[] := ARRAY[]::text[];
BEGIN
  IF provider_outcome NOT IN (
    'callback_scheduled', 'meaningful_conversation', 'appointment_set',
    'not_interested', 'wrong_number', 'disconnected', 'no_answer',
    'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
  ) THEN RAISE EXCEPTION 'invalid_mojo_provider_outcome'; END IF;

  negative_intent := lower(coalesce(notes_value, '')) ~
    '(not interested|no thank(s| you)|do not call|\mdnc\M|wrong number|(abruptly[[:space:]]+)?hung up|hang up|already sold|listed with (an?|their) agent)';
  seller_intent := lower(coalesce(notes_value, '')) ~
    '(timeline[[:space:]]*:|sell(ing)? within|close within|motivation|reason for selling|wants? to sell|needs? to sell|plans? to sell|planning to sell|willing to sell|getting rid of|ready to part with|asking price|price[[:space:]]*:|offer[[:space:]]*:|[$][[:space:]]*[0-9]|[0-9][0-9,]*[[:space:]]*k\M|condition|repairs?|renovat|foundation|roof|hvac|flood|fire damage|inherited|probate|foreclosure|tenant|vacant|rent back|equity|liens?)';

  appointment_override := provider_outcome = 'appointment_set' AND p_follow_up_at IS NOT NULL;
  scheduled_follow_up := provider_outcome IN ('callback_scheduled', 'meaningful_conversation')
    AND p_follow_up_at IS NOT NULL
    AND p_follow_up_at >= clock_timestamp() - interval '5 minutes';
  promotion_value := requested_promotion
    AND provider_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND (
      NOT negative_intent
      OR (qualified_by_agent AND qualification_override_reason IS NOT NULL)
    )
    AND (
      appointment_override
      OR (
        duration_value >= 120
        AND recording_value IS NOT NULL
        AND (qualified_by_agent OR seller_intent)
        AND (provider_outcome <> 'callback_scheduled' OR p_follow_up_at IS NOT NULL)
      )
    );
  status_value := CASE
    WHEN provider_outcome NOT IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set') THEN 'not_applicable'
    WHEN promotion_value THEN 'eligible'
    WHEN negative_intent THEN 'ineligible'
    WHEN provider_outcome = 'callback_scheduled' AND p_follow_up_at IS NULL THEN 'ineligible'
    WHEN recording_value IS NULL OR duration_value = 0 THEN 'evidence_pending'
    ELSE 'ineligible'
  END;
  reasons_value := CASE
    WHEN status_value = 'not_applicable' THEN ARRAY['non_promotion_outcome']::text[]
    WHEN status_value = 'eligible' AND appointment_override
      THEN ARRAY['scheduled_appointment_override']::text[]
    WHEN status_value = 'eligible' AND qualified_by_agent AND negative_intent
      THEN ARRAY['agent_qualified', 'negative_intent_overridden', 'minimum_duration_met']::text[]
    WHEN status_value = 'eligible' AND qualified_by_agent
      THEN ARRAY['agent_qualified', 'minimum_duration_met']::text[]
    WHEN status_value = 'eligible'
      THEN ARRAY['seller_intent_documented', 'minimum_duration_met']::text[]
    WHEN negative_intent THEN ARRAY['negative_intent']::text[]
    WHEN provider_outcome = 'callback_scheduled' AND p_follow_up_at IS NULL
      THEN ARRAY['callback_without_scheduled_time']::text[]
    WHEN recording_value IS NULL THEN ARRAY['recording_pending']::text[]
    WHEN duration_value = 0 THEN ARRAY['duration_pending']::text[]
    WHEN duration_value < 120 THEN ARRAY['below_minimum_duration']::text[]
    ELSE ARRAY['missing_seller_intent_evidence']::text[]
  END;

  -- The retained core function receives only the enforced outcome. This keeps
  -- old callers fail-closed: `other` never creates a lead shell.
  core_result := public.ingest_crm_mojo_call_core_v1(
    p_call,
    CASE WHEN promotion_value OR scheduled_follow_up THEN provider_outcome ELSE 'other' END,
    p_call_at,
    p_follow_up_at
  );
  event_value := (core_result->>'eventId')::uuid;

  UPDATE public.crm_mojo_call_events AS event SET
    outcome = provider_outcome,
    duration_seconds = greatest(event.duration_seconds, duration_value),
    recording_url = coalesce(recording_value, event.recording_url),
    follow_up_at = coalesce(event.follow_up_at, p_follow_up_at),
    promotion_eligible = promotion_value,
    qualification_status = status_value,
    qualification_reasons = reasons_value,
    recording_processing_status = CASE
      WHEN event.recording_processing_status = 'analyzed' THEN 'analyzed'
      WHEN recording_value IS NOT NULL THEN event.recording_processing_status
      ELSE 'pending'
    END,
    updated_at = now()
  WHERE event.id = event_value
  RETURNING * INTO event_row;

  RETURN core_result || jsonb_build_object(
    'outcome', provider_outcome,
    'promotionEligible', promotion_value,
    'qualificationStatus', status_value,
    'qualificationReasons', to_jsonb(reasons_value),
    'callAt', event_row.call_at,
    'followUpAt', event_row.follow_up_at,
    'activityId', event_row.activity_id,
    'leadId', event_row.lead_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_crm_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN position('@' IN coalesce(value, '')) > 1 THEN lower(btrim(value))
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.apply_crm_mojo_source_projection_v2(
  p_event_id uuid,
  p_provider_emails text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object('status', 'rehearsal', 'eventId', p_event_id);
$$;

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
  governed_result jsonb;
  projection_result jsonb;
  provider_emails_value text[];
BEGIN
  governed_result := public.ingest_crm_mojo_call_governed_v1(
    p_call, p_outcome, p_call_at, p_follow_up_at
  );
  IF governed_result->>'eventId' IS NULL THEN RETURN governed_result; END IF;

  provider_emails_value := ARRAY(
    SELECT DISTINCT public.normalize_crm_email(value)
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_call->'emails') = 'array'
        THEN p_call->'emails'
        ELSE jsonb_build_array(p_call->>'email') END
    ) AS emails(value)
    WHERE public.normalize_crm_email(value) IS NOT NULL
    ORDER BY 1
  );
  projection_result := public.apply_crm_mojo_source_projection_v2(
    (governed_result->>'eventId')::uuid, provider_emails_value
  );
  RETURN governed_result || jsonb_build_object('sourceProjection', projection_result);
END
$$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.rehearse_mojo_ingest(
  p_record text,
  p_name text,
  p_phone text,
  p_provider_outcome text,
  p_disposition text,
  p_follow timestamptz DEFAULT NULL,
  p_lead_exists boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.ingest_crm_mojo_call_v1(
    jsonb_strip_nulls(jsonb_build_object(
      'record_id', p_record,
      'contact_name', p_name,
      'phone_number', p_phone,
      'disposition', p_disposition,
      'provider_outcome', p_provider_outcome,
      'call_duration', '2460',
      'recording_url', 'https://example.test/audio/rehearsal',
      'agent_name', 'Casey',
      'notes', 'Asked for a callback.',
      'lead_exists', p_lead_exists
    )),
    'other',
    timestamptz '2026-11-19 18:00:00+00',
    p_follow
  );
$$;
