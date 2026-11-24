-- Per-call Mojo dial ledger.
--
-- crm_mojo_call_events stays meaningful-only (mojo-activity-* identities).
-- This table stores one row per dial, including power-dial calls with no
-- outcome. It does not enter mojo_call_queue, does not change DNC, and does
-- not create leads, activities, appointments, or work items.

SET statement_timeout = '2min';

CREATE TABLE IF NOT EXISTS public.crm_mojo_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id text NOT NULL UNIQUE,
  provider_call_id text NOT NULL,
  provider_contact_id text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  call_at timestamptz NOT NULL,
  dial_session_id text,
  contact_initials text,
  phone_last4 text,
  duration_seconds integer NOT NULL DEFAULT 0,
  result_code integer,
  result_label text,
  is_recorded boolean,
  appointment_count integer,
  lead_exists boolean,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_mojo_calls_record_id_check
    CHECK (record_id ~ '^mojo-call-[0-9]{1,18}$'),
  CONSTRAINT crm_mojo_calls_provider_call_check
    CHECK (
      provider_call_id ~ '^[0-9]{1,18}$'
      AND record_id = 'mojo-call-' || provider_call_id
    ),
  CONSTRAINT crm_mojo_calls_contact_check
    CHECK (provider_contact_id IS NULL OR provider_contact_id ~ '^[0-9]{1,18}$'),
  CONSTRAINT crm_mojo_calls_session_check
    CHECK (dial_session_id IS NULL OR dial_session_id ~ '^[0-9]{1,18}$'),
  CONSTRAINT crm_mojo_calls_initials_check
    CHECK (contact_initials IS NULL OR contact_initials ~ '^[A-Z](\.[A-Z]){0,3}\.$'),
  CONSTRAINT crm_mojo_calls_phone_check
    CHECK (phone_last4 IS NULL OR phone_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT crm_mojo_calls_duration_check
    CHECK (duration_seconds BETWEEN 0 AND 86400),
  CONSTRAINT crm_mojo_calls_result_code_check
    CHECK (result_code IS NULL OR result_code BETWEEN 0 AND 999),
  CONSTRAINT crm_mojo_calls_result_label_check
    CHECK (
      result_label IS NULL
      OR (
        char_length(result_label) BETWEEN 1 AND 80
        AND result_label !~ '[0-9]{7}'
      )
    ),
  CONSTRAINT crm_mojo_calls_appointment_count_check
    CHECK (appointment_count IS NULL OR appointment_count BETWEEN 0 AND 1000),
  CONSTRAINT crm_mojo_calls_source_check
    CHECK (source IN ('mojo_mcp_list_calls', 'mojo_session_recordings')),
  CONSTRAINT crm_mojo_calls_time_check
    CHECK (call_at >= timestamptz '2000-01-01')
);

ALTER TABLE public.crm_mojo_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_mojo_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_mojo_calls TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_contact_time
  ON public.crm_mojo_calls (provider_contact_id, call_at DESC, record_id DESC)
  WHERE provider_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_session
  ON public.crm_mojo_calls (dial_session_id, call_at, record_id)
  WHERE dial_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_call_at
  ON public.crm_mojo_calls (call_at DESC, record_id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_provider_contact_lead
  ON public.crm_mojo_call_events (provider_contact_id, lead_id)
  WHERE provider_contact_id IS NOT NULL AND lead_id IS NOT NULL;

COMMENT ON TABLE public.crm_mojo_calls IS
  'Per-call Mojo dial ledger. Meaningful activity remains in crm_mojo_call_events. Rows here do not enter mojo_call_queue, do not change DNC, and do not create leads, activities, or work items.';

CREATE OR REPLACE FUNCTION public.upsert_crm_mojo_call_v1(p_call jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '8s'
AS $$
DECLARE
  record_value text;
  provider_call_value text;
  contact_value text;
  session_value text;
  initials_value text;
  phone_value text;
  label_value text;
  source_value text;
  call_at_value timestamptz;
  duration_value integer;
  result_code_value integer;
  appointment_value integer;
  recorded_value boolean;
  lead_exists_value boolean;
  matched_lead uuid;
  match_count integer;
  existing public.crm_mojo_calls;
  stored public.crm_mojo_calls;
BEGIN
  IF jsonb_typeof(p_call) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_mojo_call';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_call) AS key
    WHERE key NOT IN (
      'record_id', 'provider_call_id', 'provider_contact_id', 'call_at',
      'dial_session_id', 'contact_initials', 'phone_last4', 'duration_seconds',
      'result_code', 'result_label', 'is_recorded', 'appointment_count',
      'lead_exists', 'source'
    )
  ) THEN
    RAISE EXCEPTION 'mojo_call_payload_has_forbidden_field';
  END IF;

  provider_call_value := nullif(btrim(coalesce(p_call->>'provider_call_id', '')), '');
  record_value := nullif(btrim(coalesce(p_call->>'record_id', '')), '');
  IF provider_call_value IS NULL OR provider_call_value !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'invalid_mojo_call_id';
  END IF;
  IF record_value IS DISTINCT FROM 'mojo-call-' || provider_call_value
     OR record_value LIKE 'mojo-activity-%' THEN
    RAISE EXCEPTION 'invalid_mojo_call_record_id';
  END IF;

  contact_value := nullif(btrim(coalesce(p_call->>'provider_contact_id', '')), '');
  IF contact_value IS NOT NULL AND contact_value !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'invalid_mojo_contact_id';
  END IF;

  session_value := nullif(btrim(coalesce(p_call->>'dial_session_id', '')), '');
  IF session_value IS NOT NULL AND session_value !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'invalid_mojo_dial_session';
  END IF;

  initials_value := nullif(btrim(coalesce(p_call->>'contact_initials', '')), '');
  IF initials_value IS NOT NULL AND initials_value !~ '^[A-Z](\.[A-Z]){0,3}\.$' THEN
    RAISE EXCEPTION 'invalid_mojo_contact_initials';
  END IF;

  phone_value := nullif(btrim(coalesce(p_call->>'phone_last4', '')), '');
  IF phone_value IS NOT NULL AND phone_value !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'invalid_mojo_phone_last4';
  END IF;

  IF coalesce(p_call->>'call_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
    RAISE EXCEPTION 'invalid_mojo_call_time';
  END IF;
  call_at_value := (p_call->>'call_at')::timestamptz;
  IF call_at_value IS NULL
     OR call_at_value > clock_timestamp() + interval '1 day'
     OR call_at_value < timestamptz '2000-01-01' THEN
    RAISE EXCEPTION 'invalid_mojo_call_time';
  END IF;

  IF p_call->'duration_seconds' IS NULL OR jsonb_typeof(p_call->'duration_seconds') = 'null' THEN
    duration_value := 0;
  ELSIF jsonb_typeof(p_call->'duration_seconds') = 'number'
    AND (p_call->>'duration_seconds') ~ '^[0-9]+$'
    AND (p_call->>'duration_seconds')::integer BETWEEN 0 AND 86400 THEN
    duration_value := (p_call->>'duration_seconds')::integer;
  ELSE
    RAISE EXCEPTION 'invalid_mojo_call_duration';
  END IF;

  IF p_call->'result_code' IS NULL OR jsonb_typeof(p_call->'result_code') = 'null' THEN
    result_code_value := NULL;
  ELSIF jsonb_typeof(p_call->'result_code') = 'number'
    AND (p_call->>'result_code') ~ '^[0-9]+$'
    AND (p_call->>'result_code')::integer BETWEEN 0 AND 999 THEN
    result_code_value := (p_call->>'result_code')::integer;
  ELSE
    RAISE EXCEPTION 'invalid_mojo_call_result';
  END IF;

  label_value := nullif(btrim(coalesce(p_call->>'result_label', '')), '');
  IF label_value IS NOT NULL AND (
    char_length(label_value) > 80
    OR label_value ~ '[0-9]{7}'
    OR label_value !~ '^[A-Za-z][A-Za-z0-9 /&''.,+-]{0,79}$'
  ) THEN
    RAISE EXCEPTION 'invalid_mojo_call_result_label';
  END IF;

  IF p_call->'is_recorded' IS NULL OR jsonb_typeof(p_call->'is_recorded') = 'null' THEN
    recorded_value := NULL;
  ELSIF jsonb_typeof(p_call->'is_recorded') = 'boolean' THEN
    recorded_value := (p_call->>'is_recorded')::boolean;
  ELSE
    RAISE EXCEPTION 'invalid_mojo_call_recorded';
  END IF;

  IF p_call->'appointment_count' IS NULL OR jsonb_typeof(p_call->'appointment_count') = 'null' THEN
    appointment_value := NULL;
  ELSIF jsonb_typeof(p_call->'appointment_count') = 'number'
    AND (p_call->>'appointment_count') ~ '^[0-9]+$'
    AND (p_call->>'appointment_count')::integer BETWEEN 0 AND 1000 THEN
    appointment_value := (p_call->>'appointment_count')::integer;
  ELSE
    RAISE EXCEPTION 'invalid_mojo_appointment_count';
  END IF;

  IF p_call->'lead_exists' IS NULL OR jsonb_typeof(p_call->'lead_exists') = 'null' THEN
    lead_exists_value := NULL;
  ELSIF jsonb_typeof(p_call->'lead_exists') = 'boolean' THEN
    lead_exists_value := (p_call->>'lead_exists')::boolean;
  ELSE
    RAISE EXCEPTION 'invalid_mojo_lead_exists';
  END IF;

  source_value := nullif(btrim(coalesce(p_call->>'source', '')), '');
  IF source_value IS NULL OR source_value NOT IN ('mojo_mcp_list_calls', 'mojo_session_recordings') THEN
    RAISE EXCEPTION 'invalid_mojo_call_source';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-mojo-call:' || record_value, 0)
  );

  -- Match an existing CRM lead only when exactly one meaningful-event row
  -- already links this Mojo contact id. Never match by phone or name, and
  -- never create a lead from a per-call row.
  matched_lead := NULL;
  IF contact_value IS NOT NULL THEN
    SELECT count(DISTINCT event.lead_id), min(event.lead_id::text)::uuid
    INTO match_count, matched_lead
    FROM public.crm_mojo_call_events AS event
    WHERE event.provider_contact_id = contact_value
      AND event.lead_id IS NOT NULL;
    IF match_count IS DISTINCT FROM 1 THEN
      matched_lead := NULL;
    END IF;
  END IF;

  SELECT * INTO existing
  FROM public.crm_mojo_calls
  WHERE record_id = record_value;

  IF existing.id IS NOT NULL
     AND existing.provider_contact_id IS NOT DISTINCT FROM contact_value
     AND existing.lead_id IS NOT DISTINCT FROM matched_lead
     AND existing.call_at = call_at_value
     AND existing.dial_session_id IS NOT DISTINCT FROM session_value
     AND existing.contact_initials IS NOT DISTINCT FROM initials_value
     AND existing.phone_last4 IS NOT DISTINCT FROM phone_value
     AND existing.duration_seconds = duration_value
     AND existing.result_code IS NOT DISTINCT FROM result_code_value
     AND existing.result_label IS NOT DISTINCT FROM label_value
     AND existing.is_recorded IS NOT DISTINCT FROM recorded_value
     AND existing.appointment_count IS NOT DISTINCT FROM appointment_value
     AND existing.lead_exists IS NOT DISTINCT FROM lead_exists_value
     AND existing.source = source_value THEN
    RETURN jsonb_build_object(
      'recordId', existing.record_id,
      'leadId', existing.lead_id,
      'replayed', true,
      'inserted', false
    );
  END IF;

  INSERT INTO public.crm_mojo_calls (
    record_id, provider_call_id, provider_contact_id, lead_id, call_at,
    dial_session_id, contact_initials, phone_last4, duration_seconds,
    result_code, result_label, is_recorded, appointment_count, lead_exists, source
  ) VALUES (
    record_value, provider_call_value, contact_value, matched_lead, call_at_value,
    session_value, initials_value, phone_value, duration_value,
    result_code_value, label_value, recorded_value, appointment_value, lead_exists_value, source_value
  )
  ON CONFLICT (record_id) DO UPDATE SET
    provider_contact_id = EXCLUDED.provider_contact_id,
    lead_id = EXCLUDED.lead_id,
    call_at = EXCLUDED.call_at,
    dial_session_id = EXCLUDED.dial_session_id,
    contact_initials = EXCLUDED.contact_initials,
    phone_last4 = EXCLUDED.phone_last4,
    duration_seconds = EXCLUDED.duration_seconds,
    result_code = EXCLUDED.result_code,
    result_label = EXCLUDED.result_label,
    is_recorded = EXCLUDED.is_recorded,
    appointment_count = EXCLUDED.appointment_count,
    lead_exists = EXCLUDED.lead_exists,
    source = EXCLUDED.source,
    updated_at = now()
  RETURNING * INTO stored;

  RETURN jsonb_build_object(
    'recordId', stored.record_id,
    'leadId', stored.lead_id,
    'replayed', false,
    'inserted', existing.id IS NULL
  );
END
$$;

REVOKE ALL ON FUNCTION public.upsert_crm_mojo_call_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_crm_mojo_call_v1(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.upsert_crm_mojo_call_v1(jsonb) IS
  'Idempotent per-call Mojo upsert. Matches a lead only by provider_contact_id. Does not write mojo_call_queue, DNC, leads, activities, or work items.';
