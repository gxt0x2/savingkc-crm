-- Import a reviewed CSV batch and enroll it into a draft/paused campaign in
-- one transaction. The existing enrollment command remains the authority for
-- lifecycle, phone, and durable suppression checks.

CREATE INDEX IF NOT EXISTS idx_leads_prospecting_phone
  ON public.leads (public.prospecting_phone_key_v1(phone))
  WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.import_prospecting_campaign_members_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_batch_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  requested_count integer;
  inserted_count integer;
  lead_ids uuid[];
  enrollment jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_prospect_import_rows';
  END IF;

  requested_count := jsonb_array_length(p_rows);
  IF requested_count < 1 OR requested_count > 500 THEN
    RAISE EXCEPTION 'invalid_prospect_import_count';
  END IF;
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'invalid_prospect_import_batch'; END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id
    AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS row_value(id uuid, phone text)
    WHERE row_value.id IS NULL
      OR coalesce(public.prospecting_phone_key_v1(row_value.phone), '') = ''
  ) OR (
    SELECT count(DISTINCT public.prospecting_phone_key_v1(row_value.phone))
    FROM jsonb_to_recordset(p_rows) AS row_value(phone text)
  ) <> requested_count THEN
    RAISE EXCEPTION 'invalid_prospect_import_rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS row_value(phone text)
    JOIN public.crm_contact_methods method
      ON method.method_type = 'phone'
     AND method.normalized_value = row_value.phone
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS row_value(phone text)
    JOIN public.leads lead
      ON public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(row_value.phone)
  ) THEN
    RAISE EXCEPTION 'prospect_import_existing_contact';
  END IF;

  WITH imported AS (
    INSERT INTO public.leads (
      id, full_name, phone, email, property_address, city, state, zip, source,
      station, classification, priority, is_parked, pipeline_intent_source
    )
    SELECT
      row_value.id,
      nullif(trim(row_value.full_name), ''),
      row_value.phone,
      nullif(trim(row_value.email), ''),
      nullif(trim(row_value.property_address), ''),
      nullif(trim(row_value.city), ''),
      nullif(trim(row_value.state), ''),
      nullif(trim(row_value.zip), ''),
      coalesce(nullif(trim(row_value.source), ''), 'csv_import'),
      'new', NULL, 'cold', false, NULL
    FROM jsonb_to_recordset(p_rows) AS row_value(
      id uuid,
      full_name text,
      phone text,
      email text,
      property_address text,
      city text,
      state text,
      zip text,
      source text
    )
    RETURNING id
  )
  SELECT count(*), array_agg(id ORDER BY id)
  INTO inserted_count, lead_ids
  FROM imported;

  IF inserted_count IS DISTINCT FROM requested_count THEN
    RAISE EXCEPTION 'prospect_import_incomplete';
  END IF;

  INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
  SELECT
    lead_id,
    'status_change',
    'Prospect imported from CSV',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object(
      'source', 'contact_csv_import',
      'action', 'import_prospect',
      'import_batch_id', p_batch_id,
      'campaign_id', p_campaign_id
    )
  FROM unnest(lead_ids) AS lead_id;

  enrollment := public.enroll_prospecting_campaign_members_v1(
    p_campaign_id,
    p_actor_email,
    p_actor_name,
    lead_ids
  );

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'campaign_audience_imported',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object(
      'import_batch_id', p_batch_id,
      'imported', inserted_count,
      'eligible', coalesce((enrollment ->> 'eligible')::integer, 0),
      'suppressed', coalesce((enrollment ->> 'suppressed')::integer, 0)
    )
  );

  RETURN jsonb_build_object(
    'imported', inserted_count,
    'batchId', p_batch_id,
    'enrollment', enrollment
  );
END
$$;

REVOKE ALL ON FUNCTION public.import_prospecting_campaign_members_v1(uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_prospecting_campaign_members_v1(uuid, text, text, uuid, jsonb)
  TO service_role;
