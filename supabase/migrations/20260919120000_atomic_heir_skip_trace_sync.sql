-- Replace one deceased prospect's heir phone set and append its operator
-- evidence in a single transaction. The API validates provider input first;
-- this function repeats the critical ownership and payload checks at the
-- authoritative write boundary.

CREATE OR REPLACE FUNCTION public.replace_heir_skip_trace_v1(
  p_lead_id uuid,
  p_prospect_id uuid,
  p_actor text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 OR length(p_actor) > 200 THEN
    RAISE EXCEPTION 'invalid actor';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0
     OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'invalid heir replacement payload';
  END IF;

  PERFORM 1
  FROM public.prospects
  WHERE id = p_prospect_id
    AND lead_id = p_lead_id
    AND is_deceased IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prospect does not belong to deceased lead';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS item
    WHERE jsonb_typeof(item) <> 'object'
       OR COALESCE(item->>'phone', '') !~ '^\+[1-9][0-9]{7,14}$'
       OR length(btrim(COALESCE(item->>'contact_name', ''))) = 0
       OR lower(COALESCE(item->>'relationship', 'relative')) = 'owner'
  ) THEN
    RAISE EXCEPTION 'invalid heir replacement row';
  END IF;

  -- hygiene-approved-destructive: replace only non-owner skip-trace heir rows
  -- inside this transaction after a complete payload and linked deceased
  -- prospect are validated; any insert or evidence failure rolls back deletion.
  DELETE FROM public.prospect_phones
  WHERE prospect_id = p_prospect_id
    AND lower(COALESCE(relationship, '')) <> 'owner';

  INSERT INTO public.prospect_phones (
    prospect_id,
    phone,
    phone_type,
    phone_connected,
    contact_name,
    relationship,
    contact_address
  )
  SELECT
    p_prospect_id,
    row.phone,
    NULLIF(left(btrim(row.phone_type), 50), ''),
    CASE
      WHEN row.phone_connected IN ('connected', 'disconnected') THEN row.phone_connected
      ELSE NULL
    END,
    left(btrim(row.contact_name), 200),
    left(lower(COALESCE(NULLIF(btrim(row.relationship), ''), 'relative')), 100),
    NULLIF(left(btrim(row.contact_address), 500), '')
  FROM jsonb_to_recordset(p_rows) AS row(
    phone text,
    phone_type text,
    phone_connected text,
    contact_name text,
    relationship text,
    contact_address text
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.prospects
  SET is_skip_traced = TRUE
  WHERE id = p_prospect_id;

  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    description,
    agent,
    metadata
  ) VALUES (
    p_lead_id,
    'status_change',
    'Heir skip trace synced ' || v_count || ' phone record' || CASE WHEN v_count = 1 THEN '' ELSE 's' END,
    btrim(p_actor),
    jsonb_build_object(
      'source', 'heir_dialer',
      'action', 'sync_heirs',
      'prospect_id', p_prospect_id,
      'phone_records_synced', v_count
    )
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_heir_skip_trace_v1(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_heir_skip_trace_v1(uuid, uuid, text, jsonb)
  TO service_role;
