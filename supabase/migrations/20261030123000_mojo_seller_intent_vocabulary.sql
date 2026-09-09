-- Recognize natural seller-intent wording observed in governed Mojo call notes.
--
-- The first qualification migration intentionally failed closed. This patch
-- expands only the seller-intent vocabulary and reclassifies matching evidence;
-- it does not create, reactivate, unlink, or otherwise mutate a CRM lead.

DO $mojo_vocabulary$
DECLARE
  wrapper_signature regprocedure := pg_catalog.to_regprocedure(
    'public.ingest_crm_mojo_call_v1(jsonb,text,timestamp with time zone,timestamp with time zone)'
  );
  wrapper_definition text;
  old_fragment constant text :=
    'wants? to sell|needs? to sell|asking price';
  new_fragment constant text :=
    'wants? to sell|needs? to sell|plans? to sell|planning to sell|willing to sell|getting rid of|ready to part with|asking price';
BEGIN
  IF wrapper_signature IS NULL THEN
    RAISE EXCEPTION 'ingest_crm_mojo_call_v1 wrapper is required before the seller-intent vocabulary patch';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(wrapper_signature)
  INTO wrapper_definition;

  IF pg_catalog.strpos(wrapper_definition, old_fragment) = 0 THEN
    RAISE EXCEPTION 'expected Mojo seller-intent vocabulary fragment was not found';
  END IF;

  wrapper_definition := pg_catalog.replace(wrapper_definition, old_fragment, new_fragment);
  EXECUTE wrapper_definition;
END
$mojo_vocabulary$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  TO service_role;

WITH newly_recognized AS (
  SELECT event.id
  FROM public.crm_mojo_call_events AS event
  WHERE event.qualification_status = 'ineligible'
    AND event.qualification_reasons = ARRAY['missing_seller_intent_evidence']::text[]
    AND event.outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND event.duration_seconds >= 120
    AND event.recording_url IS NOT NULL
    AND (event.outcome <> 'callback_scheduled' OR event.follow_up_at IS NOT NULL)
    AND lower(coalesce(event.notes, '')) ~
      '(plans? to sell|planning to sell|willing to sell|getting rid of|ready to part with)'
    AND lower(coalesce(event.notes, '')) !~
      '(not interested|no thank(s| you)|do not call|\mdnc\M|wrong number|(abruptly[[:space:]]+)?hung up|hang up|already sold|listed with (an?|their) agent)'
)
UPDATE public.crm_mojo_call_events AS event SET
  promotion_eligible = true,
  qualification_status = 'eligible',
  qualification_reasons = ARRAY['seller_intent_documented', 'minimum_duration_met']::text[],
  updated_at = now()
FROM newly_recognized
WHERE event.id = newly_recognized.id;

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('mojo_qualification_version', '"mojo_qualification_v1_1"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

COMMENT ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz) IS
  'Records Mojo provider evidence using governed qualification v1.1, including natural seller-intent wording, before lead creation or promotion.';
