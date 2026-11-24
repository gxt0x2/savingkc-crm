-- Scheduled per-dial Mojo ingest.
--
-- crm_mojo_calls was only writable from a one-off backfill, so it stayed empty.
-- This function records one dial into crm_mojo_calls and crm_mojo_call_events,
-- deduped by Mojo call id (record_id mojo-call-<id>), and stamps prospect_phones.
-- It does not read or write the dialer import queue, does not create leads, and
-- does not clear an existing opt-out or DNC stamp. Opt-outs are only added.

CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1(
  p_phone text,
  p_disposition text,
  p_call_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+1[0-9]{10}$' THEN
    RETURN 0;
  END IF;
  IF p_call_at IS NULL THEN
    RAISE EXCEPTION 'invalid_mojo_call_time';
  END IF;
  IF p_disposition IS NOT NULL AND p_disposition NOT IN (
    'dnc', 'wrong_number', 'disconnected', 'no_answer', 'left_voicemail', 'busy'
  ) THEN
    RAISE EXCEPTION 'invalid_mojo_phone_disposition';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mojo-dial-phone:' || p_phone, 0)
  );

  UPDATE public.prospect_phones AS phone
  SET
    attempted = true,
    last_attempt_at = CASE
      WHEN phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at THEN p_call_at
      ELSE phone.last_attempt_at
    END,
    last_attempt_by = CASE
      WHEN phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at THEN 'Mojo'
      ELSE phone.last_attempt_by
    END,
    last_disposition = CASE
      WHEN p_disposition = 'dnc' THEN 'dnc'
      WHEN p_disposition = 'wrong_number'
        AND NOT (
          phone.voice_hold IS TRUE
          OR lower(btrim(coalesce(phone.last_disposition, ''))) IN (
            'dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead'
          )
        ) THEN 'wrong_number'
      WHEN p_disposition = 'disconnected'
        AND NOT (
          phone.voice_hold IS TRUE
          OR lower(btrim(coalesce(phone.last_disposition, ''))) IN (
            'dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead', 'wrong_number'
          )
        ) THEN 'disconnected'
      WHEN p_disposition IN ('no_answer', 'left_voicemail', 'busy')
        AND NOT (
          phone.voice_hold IS TRUE
          OR lower(btrim(coalesce(phone.last_disposition, ''))) IN (
            'dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead',
            'wrong_number', 'disconnected',
            'spoke_with_owner', 'callback_requested', 'appointment_set',
            'deal_potential', 'offer_made', 'not_interested'
          )
        )
        AND (phone.last_attempt_at IS NULL OR phone.last_attempt_at <= p_call_at)
        THEN p_disposition
      ELSE phone.last_disposition
    END,
    voice_hold = CASE WHEN p_disposition = 'dnc' THEN true ELSE phone.voice_hold END,
    voice_hold_reason = CASE
      WHEN p_disposition = 'dnc' AND nullif(btrim(coalesce(phone.voice_hold_reason, '')), '') IS NULL THEN 'mojo_dnc'
      ELSE phone.voice_hold_reason
    END,
    voice_hold_at = CASE
      WHEN p_disposition = 'dnc' AND phone.voice_hold_at IS NULL THEN p_call_at
      ELSE phone.voice_hold_at
    END,
    voice_hold_by = CASE
      WHEN p_disposition = 'dnc' AND nullif(btrim(coalesce(phone.voice_hold_by, '')), '') IS NULL THEN 'Mojo'
      ELSE phone.voice_hold_by
    END
  WHERE public.normalize_conversation_phone(phone.phone) = p_phone
    AND (
      phone.attempted IS DISTINCT FROM true
      OR (phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at)
      OR (
        p_disposition = 'dnc'
        AND (phone.voice_hold IS DISTINCT FROM true OR phone.last_disposition IS DISTINCT FROM 'dnc')
      )
      OR (
        p_disposition = 'wrong_number'
        AND phone.voice_hold IS NOT TRUE
        AND lower(btrim(coalesce(phone.last_disposition, ''))) NOT IN (
          'dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead', 'wrong_number'
        )
      )
      OR (
        p_disposition = 'disconnected'
        AND phone.voice_hold IS NOT TRUE
        AND lower(btrim(coalesce(phone.last_disposition, ''))) NOT IN (
          'dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead',
          'wrong_number', 'disconnected'
        )
      )
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END
$$;

REVOKE ALL ON FUNCTION public.apply_mojo_dial_phone_stamp_v1(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mojo_dial_phone_stamp_v1(text, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.apply_mojo_dial_phone_stamp_v1(text, text, timestamptz) IS
  'Adds a Mojo dial stamp to every matching prospect_phones row. attempted is only set true. voice_hold is only set true. Existing DNC, opt-out, wrong-number and disconnected stamps are not replaced by a weaker result.';

CREATE OR REPLACE FUNCTION public.apply_mojo_dial_batch_v1(p_calls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $$
DECLARE
  item jsonb;
  fact jsonb;
  ledger jsonb;
  outcome_value text;
  disposition_value text;
  phone_value text;
  agent_value text;
  label_value text;
  contact_value text;
  call_at_value timestamptz;
  duration_value integer;
  inserted_id uuid;
  calls_applied integer := 0;
  events_inserted integer := 0;
  events_replayed integer := 0;
  phones_updated integer := 0;
  phone_hits integer := 0;
BEGIN
  IF jsonb_typeof(p_calls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_mojo_dial_batch';
  END IF;
  IF jsonb_array_length(p_calls) > 100 THEN
    RAISE EXCEPTION 'mojo_dial_batch_too_large';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_calls)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_mojo_call';
    END IF;

    outcome_value := nullif(btrim(coalesce(item->>'outcome', '')), '');
    IF outcome_value IS NULL OR outcome_value NOT IN (
      'callback_scheduled', 'meaningful_conversation', 'appointment_set',
      'not_interested', 'wrong_number', 'disconnected', 'no_answer',
      'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_outcome';
    END IF;

    disposition_value := nullif(btrim(coalesce(item->>'phone_disposition', '')), '');
    IF disposition_value IS NOT NULL AND disposition_value NOT IN (
      'dnc', 'wrong_number', 'disconnected', 'no_answer', 'left_voicemail', 'busy'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_phone_disposition';
    END IF;

    phone_value := nullif(btrim(coalesce(item->>'normalized_phone', '')), '');
    IF phone_value IS NOT NULL AND phone_value !~ '^\+1[0-9]{10}$' THEN
      RAISE EXCEPTION 'invalid_mojo_phone';
    END IF;

    agent_value := nullif(btrim(coalesce(item->>'agent_name', '')), '');
    IF agent_value IS NOT NULL AND (
      char_length(agent_value) > 160 OR agent_value ~ '[0-9]{7}'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_agent';
    END IF;

    label_value := nullif(btrim(coalesce(item->>'result_label', '')), '');
    IF label_value IS NULL THEN
      label_value := 'Unknown';
    END IF;
    IF char_length(label_value) > 250 THEN
      RAISE EXCEPTION 'invalid_mojo_disposition';
    END IF;

    IF coalesce(item->>'call_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
      RAISE EXCEPTION 'invalid_mojo_call_time';
    END IF;
    call_at_value := (item->>'call_at')::timestamptz;

    IF item->'duration_seconds' IS NULL OR jsonb_typeof(item->'duration_seconds') = 'null' THEN
      duration_value := 0;
    ELSIF jsonb_typeof(item->'duration_seconds') = 'number'
      AND (item->>'duration_seconds') ~ '^[0-9]+$'
      AND (item->>'duration_seconds')::integer BETWEEN 0 AND 86400 THEN
      duration_value := (item->>'duration_seconds')::integer;
    ELSE
      RAISE EXCEPTION 'invalid_mojo_call_duration';
    END IF;

    contact_value := nullif(btrim(coalesce(item->>'provider_contact_id', '')), '');
    fact := item - 'normalized_phone' - 'outcome' - 'phone_disposition' - 'agent_name';
    ledger := public.upsert_crm_mojo_call_v1(fact);
    IF ledger IS NULL OR ledger->>'recordId' IS NULL THEN
      RAISE EXCEPTION 'invalid_mojo_call_upsert_result';
    END IF;
    calls_applied := calls_applied + 1;

    phone_hits := public.apply_mojo_dial_phone_stamp_v1(phone_value, disposition_value, call_at_value);
    phones_updated := phones_updated + phone_hits;

    inserted_id := NULL;
    INSERT INTO public.crm_mojo_call_events (
      record_id,
      call_at,
      normalized_phone,
      provider_contact_id,
      duration_seconds,
      disposition_raw,
      outcome,
      agent_name,
      agent_key,
      contact_name,
      unresolved_reason,
      promotion_eligible,
      qualification_status
    ) VALUES (
      ledger->>'recordId',
      call_at_value,
      phone_value,
      contact_value,
      duration_value,
      label_value,
      outcome_value,
      agent_value,
      'mojo',
      CASE
        WHEN coalesce(item->>'contact_initials', '') ~ '^[A-Z](\.[A-Z]){0,3}\.$' THEN item->>'contact_initials'
        ELSE NULL
      END,
      CASE
        WHEN phone_value IS NULL THEN 'invalid_phone'
        WHEN phone_hits = 0 THEN 'unknown_contact'
        ELSE NULL
      END,
      false,
      'not_applicable'
    )
    ON CONFLICT (record_id) DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NULL THEN
      events_replayed := events_replayed + 1;
    ELSE
      events_inserted := events_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'calls', calls_applied,
    'eventsInserted', events_inserted,
    'eventsReplayed', events_replayed,
    'phonesUpdated', phones_updated
  );
END
$$;

REVOKE ALL ON FUNCTION public.apply_mojo_dial_batch_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mojo_dial_batch_v1(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_mojo_dial_batch_v1(jsonb) IS
  'Idempotent Mojo dial batch. Upserts crm_mojo_calls by call id, inserts crm_mojo_call_events once, and adds prospect_phones stamps. Does not write the dialer import queue, leads, activities, or SMS opt-out rows.';
