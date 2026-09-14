-- Align import_prospecting_campaign_members_v1 with the current leads schema.
--
-- 20260920120000 wrote leads.pipeline_intent_source on insert. That column was
-- never added to public.leads. Pipeline intent is computed by
-- contact_workspace_pipeline_intent_source(lead_source, activity_type, metadata)
-- and is not stored. Atlas currently fails this RPC with Postgres 42703.
--
-- After that insert succeeds, import calls enroll_prospecting_campaign_members_v1.
-- 20261006120000 replaced the members unique key with a partial unique index on
-- (campaign_id, lead_id) WHERE subject_kind = 'lead'. The original enroll
-- command still uses ON CONFLICT (campaign_id, lead_id), which is 42P10 on Atlas.
-- hygiene-approved-destructive: only existing function bodies are replaced;
-- no lead, campaign, or activity rows are deleted.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

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
      station, classification, priority, is_parked
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
      'new', NULL, 'cold', false
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

CREATE OR REPLACE FUNCTION public.enroll_prospecting_campaign_members_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_lead_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  requested_count integer := coalesce(array_length(p_lead_ids, 1), 0);
  eligible_count integer := 0;
  suppressed_count integer := 0;
  missing_count integer := 0;
BEGIN
  IF requested_count < 1 OR requested_count > 1000 THEN RAISE EXCEPTION 'invalid_campaign_member_count'; END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  WITH requested AS (
    SELECT DISTINCT value AS lead_id FROM unnest(p_lead_ids) value
  ), evaluated AS (
    SELECT
      requested.lead_id,
      lead.phone,
      CASE
        WHEN lead.id IS NULL THEN 'missing_lead'
        WHEN coalesce(public.prospecting_phone_key_v1(lead.phone), '') = '' THEN 'missing_phone'
        WHEN lower(coalesce(lead.classification, '')) = 'dead' OR lower(coalesce(lead.station, '')) IN ('dead', 'closed_lost') THEN 'dead_lead'
        WHEN EXISTS (
          SELECT 1 FROM public.sms_opt_outs opt_out
          WHERE opt_out.is_opted_out = true
            AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(lead.phone)
        ) THEN 'do_not_contact'
        ELSE NULL
      END AS blocked_reason
    FROM requested
    LEFT JOIN public.leads lead ON lead.id = requested.lead_id
  ), upserted AS (
    INSERT INTO public.prospecting_campaign_members (
      campaign_id, subject_kind, lead_id, prospect_id, enrollment_source,
      phone_snapshot, timezone, status, suppression_reason, enrolled_by
    )
    SELECT
      p_campaign_id,
      'lead',
      evaluated.lead_id,
      NULL,
      'crm_lead',
      evaluated.phone,
      campaign_row.default_timezone,
      CASE WHEN evaluated.blocked_reason IS NULL THEN 'active' ELSE 'suppressed' END,
      evaluated.blocked_reason,
      coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email))
    FROM evaluated
    WHERE evaluated.blocked_reason IS DISTINCT FROM 'missing_lead'
      AND evaluated.blocked_reason IS DISTINCT FROM 'missing_phone'
    ON CONFLICT (campaign_id, lead_id) WHERE subject_kind = 'lead' DO UPDATE SET
      phone_snapshot = EXCLUDED.phone_snapshot,
      timezone = EXCLUDED.timezone,
      enrollment_source = EXCLUDED.enrollment_source,
      status = EXCLUDED.status,
      suppression_reason = EXCLUDED.suppression_reason,
      enrolled_by = EXCLUDED.enrolled_by,
      enrolled_at = now(),
      completed_at = NULL
    RETURNING status
  )
  SELECT
    count(*) FILTER (WHERE status = 'active'),
    count(*) FILTER (WHERE status = 'suppressed')
  INTO eligible_count, suppressed_count
  FROM upserted;

  SELECT count(*) INTO missing_count
  FROM unnest(p_lead_ids) requested(lead_id)
  LEFT JOIN public.leads lead ON lead.id = requested.lead_id
  WHERE lead.id IS NULL OR coalesce(public.prospecting_phone_key_v1(lead.phone), '') = '';

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'members_enrolled',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object('requested', requested_count, 'eligible', eligible_count, 'suppressed', suppressed_count, 'missing', missing_count)
  );

  RETURN jsonb_build_object(
    'requested', requested_count,
    'eligible', eligible_count,
    'suppressed', suppressed_count,
    'missing', missing_count
  );
END
$$;

REVOKE ALL ON FUNCTION public.enroll_prospecting_campaign_members_v1(uuid, text, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_prospecting_campaign_members_v1(uuid, text, text, uuid[])
  TO service_role;
