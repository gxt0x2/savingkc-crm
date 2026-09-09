-- Governed Mojo qualification and durable recording evidence.
--
-- Provider dispositions remain evidence. `promotion_eligible` is the separate
-- CRM decision boundary used for lead creation and lifecycle side effects.

ALTER TABLE public.crm_mojo_call_events
  ADD COLUMN IF NOT EXISTS provider_contact_id text,
  ADD COLUMN IF NOT EXISTS provider_recording_id text,
  ADD COLUMN IF NOT EXISTS promotion_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (qualification_status IN ('eligible', 'ineligible', 'evidence_pending', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS qualification_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS recording_storage_path text,
  ADD COLUMN IF NOT EXISTS recording_processing_status text NOT NULL DEFAULT 'pending'
    CHECK (recording_processing_status IN ('pending', 'processing', 'copied', 'analyzed', 'failed')),
  ADD COLUMN IF NOT EXISTS recording_processing_error text,
  ADD COLUMN IF NOT EXISTS recording_copied_at timestamptz,
  ADD COLUMN IF NOT EXISTS recording_analyzed_at timestamptz;

-- Missing recordings are persisted without making them claimable by the
-- worker. A later sync enriches the same record and moves it to `pending`.
ALTER TABLE public.mojo_call_queue
  DROP CONSTRAINT IF EXISTS mojo_call_queue_status_check;
ALTER TABLE public.mojo_call_queue
  ADD CONSTRAINT mojo_call_queue_status_check CHECK (status IN (
    'pending', 'waiting_evidence', 'processing', 'completed', 'failed', 'dead_letter'
  ));

-- Classify legacy events without deleting, unlinking, or changing a lead. The
-- dry-run audit below the application layer remains the approval boundary for
-- any historical CRM remediation.
WITH signals AS (
  SELECT
    event.id,
    lower(coalesce(event.notes, '')) ~
      '(not interested|no thank(s| you)|do not call|\mdnc\M|wrong number|(abruptly[[:space:]]+)?hung up|hang up|already sold|listed with (an?|their) agent)' AS negative_intent,
    lower(coalesce(event.notes, '')) ~
      '(timeline[[:space:]]*:|sell(ing)? within|close within|motivation|reason for selling|wants? to sell|needs? to sell|asking price|price[[:space:]]*:|offer[[:space:]]*:|[$][[:space:]]*[0-9]|[0-9][0-9,]*[[:space:]]*k\M|condition|repairs?|renovat|foundation|roof|hvac|flood|fire damage|inherited|probate|foreclosure|tenant|vacant|rent back|equity|liens?)' AS seller_intent
  FROM public.crm_mojo_call_events AS event
), classified AS (
  SELECT
    event.*,
    signals.negative_intent,
    signals.seller_intent,
    (
      event.outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
      AND NOT signals.negative_intent
      AND (
        (event.outcome = 'appointment_set' AND event.follow_up_at IS NOT NULL)
        OR (
          event.duration_seconds >= 120
          AND event.recording_url IS NOT NULL
          AND signals.seller_intent
          AND (event.outcome <> 'callback_scheduled' OR event.follow_up_at IS NOT NULL)
        )
      )
    ) AS eligible
  FROM public.crm_mojo_call_events AS event
  JOIN signals ON signals.id = event.id
)
UPDATE public.crm_mojo_call_events AS event SET
  promotion_eligible = classified.eligible,
  qualification_status = CASE
    WHEN classified.outcome NOT IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set') THEN 'not_applicable'
    WHEN classified.eligible THEN 'eligible'
    WHEN classified.negative_intent THEN 'ineligible'
    WHEN classified.outcome = 'callback_scheduled' AND classified.follow_up_at IS NULL THEN 'ineligible'
    WHEN classified.recording_url IS NULL OR classified.duration_seconds = 0 THEN 'evidence_pending'
    ELSE 'ineligible'
  END,
  qualification_reasons = CASE
    WHEN classified.outcome NOT IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
      THEN ARRAY['non_promotion_outcome']::text[]
    WHEN classified.eligible AND classified.outcome = 'appointment_set'
      AND (classified.duration_seconds < 120 OR classified.recording_url IS NULL OR NOT classified.seller_intent)
      THEN ARRAY['scheduled_appointment_override']::text[]
    WHEN classified.eligible THEN ARRAY['legacy_seller_intent_and_duration']::text[]
    WHEN classified.negative_intent THEN ARRAY['negative_intent']::text[]
    WHEN classified.outcome = 'callback_scheduled' AND classified.follow_up_at IS NULL
      THEN ARRAY['callback_without_scheduled_time']::text[]
    WHEN classified.recording_url IS NULL THEN ARRAY['recording_pending']::text[]
    WHEN classified.duration_seconds = 0 THEN ARRAY['duration_pending']::text[]
    WHEN classified.duration_seconds < 120 THEN ARRAY['below_minimum_duration']::text[]
    ELSE ARRAY['missing_seller_intent_evidence']::text[]
  END,
  updated_at = now()
FROM classified
WHERE event.id = classified.id;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_qualification_review
  ON public.crm_mojo_call_events(call_at DESC, record_id)
  WHERE outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND promotion_eligible = false;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_recording_work
  ON public.crm_mojo_call_events(recording_processing_status, call_at, record_id)
  WHERE recording_url IS NOT NULL
    AND promotion_eligible = true
    AND recording_processing_status <> 'analyzed';

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_mojo_call_events_provider_recording
  ON public.crm_mojo_call_events(provider_recording_id)
  WHERE provider_recording_id IS NOT NULL;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mojo-call-recordings',
  'mojo-call-recordings',
  false,
  104857600,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.ingest_crm_mojo_call_core_v1(jsonb,text,timestamp with time zone,timestamp with time zone)') IS NULL THEN
    ALTER FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
      RENAME TO ingest_crm_mojo_call_core_v1;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_core_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

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
  provider_recording_value text := left(nullif(btrim(coalesce(p_call->>'provider_recording_id', '')), ''), 160);
  existing_record_value text;
  existing_promotion boolean := false;
  existing_duration integer := 0;
  existing_recording text;
  existing_notes text;
  existing_follow_up timestamptz;
  requested_promotion boolean := lower(coalesce(p_call->>'promotion_eligible', 'false')) = 'true';
  qualified_by_agent boolean := lower(coalesce(p_call->>'qualified_by_agent', 'false')) = 'true';
  negative_intent boolean;
  seller_intent boolean;
  appointment_override boolean;
  promotion_value boolean;
  status_value text;
  reasons_value text[] := ARRAY[]::text[];
BEGIN
  IF provider_outcome NOT IN (
    'callback_scheduled', 'meaningful_conversation', 'appointment_set',
    'not_interested', 'wrong_number', 'disconnected', 'no_answer',
    'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
  ) THEN RAISE EXCEPTION 'invalid_mojo_provider_outcome'; END IF;

  SELECT
    event.record_id, event.promotion_eligible,
    event.duration_seconds, event.recording_url, event.notes, event.follow_up_at
  INTO
    existing_record_value, existing_promotion,
    existing_duration, existing_recording, existing_notes, existing_follow_up
  FROM public.crm_mojo_call_events AS event
  WHERE event.record_id = p_call->>'record_id'
  LIMIT 1;

  -- Provider activity groupings can change between the intraday sync and the
  -- end-of-day sweep. Reuse established evidence identity when the immutable
  -- recording identifier (or a legacy recording URL) already exists.
  IF existing_record_value IS NULL AND (provider_recording_value IS NOT NULL OR recording_value IS NOT NULL) THEN
    SELECT
      event.record_id, event.promotion_eligible,
      event.duration_seconds, event.recording_url, event.notes, event.follow_up_at
    INTO
      existing_record_value, existing_promotion,
      existing_duration, existing_recording, existing_notes, existing_follow_up
    FROM public.crm_mojo_call_events AS event
    WHERE (provider_recording_value IS NOT NULL AND event.provider_recording_id = provider_recording_value)
      OR (recording_value IS NOT NULL AND event.recording_url = recording_value)
    ORDER BY (event.provider_recording_id = provider_recording_value) DESC NULLS LAST, event.call_at DESC
    LIMIT 1;
  END IF;
  IF existing_record_value IS NOT NULL THEN
    p_call := jsonb_set(p_call, '{record_id}', to_jsonb(existing_record_value), true);
  END IF;

  duration_value := greatest(duration_value, coalesce(existing_duration, 0));
  recording_value := coalesce(recording_value, existing_recording);
  IF char_length(coalesce(existing_notes, '')) > char_length(coalesce(notes_value, '')) THEN
    notes_value := existing_notes;
  END IF;
  p_follow_up_at := coalesce(existing_follow_up, p_follow_up_at);
  negative_intent := lower(coalesce(notes_value, '')) ~
    '(not interested|no thank(s| you)|do not call|\mdnc\M|wrong number|(abruptly[[:space:]]+)?hung up|hang up|already sold|listed with (an?|their) agent)';
  seller_intent := lower(coalesce(notes_value, '')) ~
    '(timeline[[:space:]]*:|sell(ing)? within|close within|motivation|reason for selling|wants? to sell|needs? to sell|asking price|price[[:space:]]*:|offer[[:space:]]*:|[$][[:space:]]*[0-9]|[0-9][0-9,]*[[:space:]]*k\M|condition|repairs?|renovat|foundation|roof|hvac|flood|fire damage|inherited|probate|foreclosure|tenant|vacant|rent back|equity|liens?)';

  appointment_override := provider_outcome = 'appointment_set' AND p_follow_up_at IS NOT NULL;
  promotion_value := requested_promotion
    AND provider_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND NOT negative_intent
    AND (
      appointment_override
      OR (
        duration_value >= 120
        AND recording_value IS NOT NULL
        AND (qualified_by_agent OR seller_intent)
        AND (provider_outcome <> 'callback_scheduled' OR p_follow_up_at IS NOT NULL)
      )
    );
  IF NOT promotion_value
    AND coalesce(existing_promotion, false)
    AND NOT negative_intent
    AND provider_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set') THEN
    promotion_value := true;
  END IF;
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
    CASE WHEN promotion_value THEN provider_outcome ELSE 'other' END,
    p_call_at,
    p_follow_up_at
  );
  event_value := (core_result->>'eventId')::uuid;

  UPDATE public.crm_mojo_call_events AS event SET
    outcome = provider_outcome,
    duration_seconds = greatest(event.duration_seconds, duration_value),
    recording_url = coalesce(recording_value, event.recording_url),
    provider_contact_id = coalesce(left(nullif(btrim(p_call->>'provider_contact_id'), ''), 160), event.provider_contact_id),
    provider_recording_id = coalesce(provider_recording_value, event.provider_recording_id),
    notes = CASE
      WHEN char_length(coalesce(notes_value, '')) > char_length(coalesce(event.notes, '')) THEN notes_value
      ELSE event.notes
    END,
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

  IF event_row.activity_id IS NOT NULL THEN
    UPDATE public.lead_activities AS activity SET
      created_at = p_call_at,
      metadata = coalesce(activity.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'outcome', provider_outcome,
        'duration_seconds', event_row.duration_seconds,
        'recording_url', event_row.recording_url,
        'call_at', p_call_at,
        'follow_up_at', event_row.follow_up_at,
        'promotion_eligible', promotion_value,
        'qualification_status', status_value,
        'qualification_reasons', to_jsonb(reasons_value)
      ))
    WHERE activity.id = event_row.activity_id;
  END IF;

  IF event_row.lead_id IS NOT NULL
    AND promotion_value
    AND coalesce((core_result->>'latestForLead')::boolean, false) THEN
    UPDATE public.leads SET
      call_duration_seconds = greatest(coalesce(call_duration_seconds, 0), event_row.duration_seconds),
      call_result = event_row.disposition_raw,
      mojo_record_id = event_row.record_id,
      updated_at = now()
    WHERE id = event_row.lead_id;
  END IF;

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

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz) IS
  'Records Mojo provider evidence while requiring the governed 120-second qualification boundary before lead creation or promotion.';

INSERT INTO public.system_config(key, value, updated_at)
VALUES
  ('mojo_qualification_version', '"mojo_qualification_v1"'::jsonb, now()),
  ('mojo_minimum_meaningful_seconds', '120'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
