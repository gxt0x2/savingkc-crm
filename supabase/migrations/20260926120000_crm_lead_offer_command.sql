-- Record a seller offer, its timeline evidence, and any required lifecycle
-- transition in one transaction. Legacy compatibility state is not a write target.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_canonical_offer_command
  ON public.lead_activities ((metadata ->> 'command_id'))
  WHERE activity_type = 'offer'
    AND metadata ->> 'source' = 'canonical_offer_v1'
    AND metadata ? 'command_id';

CREATE OR REPLACE FUNCTION public.record_crm_lead_offer_v1(
  target_lead_id uuid,
  target_command_id uuid,
  target_amount numeric,
  target_method text,
  target_notes text,
  target_actor_email text,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  activity_row public.lead_activities;
  lifecycle_result jsonb := NULL;
  normalized_method text := lower(btrim(target_method));
  normalized_notes text := nullif(btrim(target_notes), '');
  normalized_amount numeric := round(target_amount);
  previous_amount numeric;
  next_stage text;
  description_value text;
BEGIN
  IF target_command_id IS NULL THEN RAISE EXCEPTION 'command_id_required'; END IF;
  IF target_lead_id IS NULL THEN RAISE EXCEPTION 'lead_id_required'; END IF;
  IF normalized_amount IS NULL OR normalized_amount <= 0 OR normalized_amount > 100000000 THEN RAISE EXCEPTION 'invalid_offer_amount'; END IF;
  IF normalized_method IS NULL OR normalized_method NOT IN ('verbal', 'written') THEN RAISE EXCEPTION 'invalid_offer_method'; END IF;
  IF length(coalesce(normalized_notes, '')) > 1000 THEN RAISE EXCEPTION 'offer_notes_too_long'; END IF;
  IF nullif(btrim(target_actor_email), '') IS NULL OR nullif(btrim(target_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_command_id::text, 0));

  SELECT * INTO activity_row
  FROM public.lead_activities
  WHERE activity_type = 'offer'
    AND metadata ->> 'source' = 'canonical_offer_v1'
    AND metadata ->> 'command_id' = target_command_id::text
  LIMIT 1;
  IF FOUND THEN
    IF activity_row.lead_id IS DISTINCT FROM target_lead_id
      OR (activity_row.metadata ->> 'offer_amount')::numeric IS DISTINCT FROM normalized_amount
      OR activity_row.metadata ->> 'offer_method' IS DISTINCT FROM normalized_method THEN
      RAISE EXCEPTION 'offer_command_conflict';
    END IF;
    SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id;
    RETURN jsonb_build_object(
      'leadId', target_lead_id,
      'activity', to_jsonb(activity_row),
      'stage', lead_row.station,
      'amount', lead_row.offer_amount,
      'lifecycle', NULL,
      'replayed', true
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_lifecycle_events
    WHERE command_id = target_command_id
  ) THEN
    RAISE EXCEPTION 'offer_command_conflict';
  END IF;

  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF lower(coalesce(lead_row.classification, '')) = 'dead'
    OR lower(coalesce(lead_row.station, '')) IN ('dead', 'closed_lost') THEN
    RAISE EXCEPTION 'terminal_lead_cannot_receive_offer';
  END IF;
  previous_amount := lead_row.offer_amount;

  next_stage := CASE
    WHEN lower(coalesce(lead_row.station, '')) IN ('offer_made', 'under_contract', 'in_closing', 'contract', 'closed_won', 'closed')
      THEN lower(lead_row.station)
    ELSE 'offer_made'
  END;

  IF next_stage = 'offer_made' AND lead_row.station IS DISTINCT FROM 'offer_made' THEN
    SELECT public.crm_apply_lifecycle_command_v1(
      target_lead_id,
      target_command_id,
      'transition',
      'offer_made',
      'opportunity',
      'hot',
      NULL,
      NULL,
      NULL,
      'Seller offer recorded',
      NULL,
      NULL,
      lower(btrim(target_actor_email)),
      btrim(target_actor_name)
    ) INTO lifecycle_result;
    IF lifecycle_result ->> 'leadId' IS DISTINCT FROM target_lead_id::text
      OR lifecycle_result ->> 'stage' IS DISTINCT FROM 'offer_made' THEN
      RAISE EXCEPTION 'offer_command_conflict';
    END IF;
  END IF;

  UPDATE public.leads SET
    offer_amount = normalized_amount,
    updated_at = now()
  WHERE id = target_lead_id
  RETURNING * INTO lead_row;

  description_value := initcap(normalized_method) || ' offer made: $'
    || trim(to_char(normalized_amount, 'FM999,999,999,990'))
    || CASE WHEN normalized_notes IS NOT NULL THEN ' — ' || normalized_notes ELSE '' END;

  INSERT INTO public.lead_activities(
    lead_id,
    activity_type,
    description,
    agent,
    metadata
  ) VALUES (
    target_lead_id,
    'offer',
    description_value,
    btrim(target_actor_name),
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'canonical_offer_v1',
      'command_id', target_command_id,
      'direction', 'outbound',
      'offer_amount', normalized_amount,
      'offer_method', normalized_method,
      'notes', normalized_notes,
      'previous_amount', previous_amount,
      'recorded_at', now(),
      'actor_email', lower(btrim(target_actor_email))
    ))
  ) RETURNING * INTO activity_row;

  RETURN jsonb_build_object(
    'leadId', target_lead_id,
    'activity', to_jsonb(activity_row),
    'stage', lead_row.station,
    'amount', lead_row.offer_amount,
    'lifecycle', lifecycle_result,
    'replayed', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.record_crm_lead_offer_v1(uuid, uuid, numeric, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_crm_lead_offer_v1(uuid, uuid, numeric, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.record_crm_lead_offer_v1(uuid, uuid, numeric, text, text, text, text) IS
  'Atomically records a human seller offer and any required governed lifecycle transition.';
