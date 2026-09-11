-- Project retained Mojo contact facts into blank CRM fields without allowing
-- provider data to replace a manual or county-backed property identity.

ALTER TABLE public.crm_mojo_call_events
  ADD COLUMN IF NOT EXISTS provider_emails text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS public.crm_mojo_projection_receipts (
  event_id uuid NOT NULL REFERENCES public.crm_mojo_call_events(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  source_value text,
  result text NOT NULL CHECK (result IN (
    'applied', 'already_present', 'protected_conflict', 'invalid_source', 'unresolved_identity'
  )),
  source_observed_at timestamptz NOT NULL,
  applied_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (event_id, field_name)
);

ALTER TABLE public.crm_mojo_projection_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_mojo_projection_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_mojo_projection_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.apply_crm_mojo_source_projection_v2(
  p_event_id uuid,
  p_provider_emails text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_row public.crm_mojo_call_events;
  lead_row public.leads;
  link_row public.crm_lead_entity_links;
  property_row public.crm_properties;
  person_id_value uuid;
  source_street text;
  source_location text;
  lead_street text;
  property_location text;
  location_result text;
  location_reason text;
  changed_fields text[] := '{}'::text[];
  original_address text;
  original_city text;
  original_state text;
  original_zip text;
  candidate_email text;
  normalized_email text;
  method_row public.crm_contact_methods;
  conflict_fingerprint text;
  receipt_summary jsonb;
BEGIN
  IF p_event_id IS NULL THEN RAISE EXCEPTION 'mojo_event_id_required'; END IF;

  SELECT * INTO event_row
  FROM public.crm_mojo_call_events
  WHERE id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mojo_event_not_found'; END IF;

  IF event_row.lead_id IS NULL THEN
    INSERT INTO public.crm_mojo_projection_receipts(
      event_id, lead_id, field_name, source_value, result, source_observed_at, details
    ) VALUES (
      event_row.id, NULL, 'identity', event_row.normalized_phone,
      'unresolved_identity', event_row.call_at,
      jsonb_build_object('reason', coalesce(event_row.unresolved_reason, 'lead_not_resolved'))
    ) ON CONFLICT (event_id, field_name) DO UPDATE SET
      result = EXCLUDED.result, checked_at = now(), details = EXCLUDED.details;
    RETURN jsonb_build_object('status', 'unresolved_identity', 'eventId', event_row.id);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mojo-source-projection:' || event_row.lead_id::text, 0)
  );
  SELECT * INTO lead_row FROM public.leads WHERE id = event_row.lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mojo_projection_lead_not_found'; END IF;
  original_address := nullif(btrim(lead_row.property_address), '');
  original_city := nullif(btrim(lead_row.city), '');
  original_state := nullif(btrim(lead_row.state), '');
  original_zip := nullif(btrim(lead_row.zip), '');

  SELECT * INTO link_row FROM public.crm_lead_entity_links WHERE lead_id = lead_row.id;
  person_id_value := link_row.person_id;
  IF link_row.property_id IS NOT NULL THEN
    SELECT * INTO property_row FROM public.crm_properties WHERE id = link_row.property_id;
  END IF;

  source_street := public.normalize_crm_address(event_row.property_address, NULL, NULL, NULL);
  source_location := public.normalize_crm_address(
    event_row.property_address, event_row.city, event_row.state, event_row.zip
  );
  lead_street := public.normalize_crm_address(lead_row.property_address, NULL, NULL, NULL);
  property_location := public.normalize_crm_address(
    property_row.address, property_row.city, property_row.state, property_row.zip
  );

  IF source_street IS NULL THEN
    location_result := 'invalid_source';
    location_reason := 'source_address_missing';
  ELSIF property_row.id IS NOT NULL AND property_location IS DISTINCT FROM source_location THEN
    location_result := 'protected_conflict';
    location_reason := 'canonical_property_link_differs';
  ELSIF lead_street IS NOT NULL AND (
    lead_street IS DISTINCT FROM source_street
    OR (original_city IS NOT NULL AND event_row.city IS NOT NULL AND lower(original_city) <> lower(event_row.city))
    OR (original_state IS NOT NULL AND event_row.state IS NOT NULL AND upper(original_state) <> upper(event_row.state))
    OR (original_zip IS NOT NULL AND event_row.zip IS NOT NULL AND original_zip <> event_row.zip)
  ) THEN
    location_result := 'protected_conflict';
    location_reason := 'lead_address_differs';
  ELSE
    UPDATE public.leads SET
      property_address = coalesce(nullif(btrim(property_address), ''), event_row.property_address),
      city = coalesce(nullif(btrim(city), ''), event_row.city),
      state = coalesce(nullif(btrim(state), ''), event_row.state),
      zip = coalesce(nullif(btrim(zip), ''), event_row.zip),
      updated_at = CASE WHEN
        nullif(btrim(property_address), '') IS NULL
        OR (nullif(btrim(city), '') IS NULL AND event_row.city IS NOT NULL)
        OR (nullif(btrim(state), '') IS NULL AND event_row.state IS NOT NULL)
        OR (nullif(btrim(zip), '') IS NULL AND event_row.zip IS NOT NULL)
        THEN now() ELSE updated_at END
    WHERE id = lead_row.id
    RETURNING * INTO lead_row;

    IF original_address IS NULL THEN changed_fields := array_append(changed_fields, 'property_address'); END IF;
    IF original_city IS NULL AND event_row.city IS NOT NULL THEN changed_fields := array_append(changed_fields, 'city'); END IF;
    IF original_state IS NULL AND event_row.state IS NOT NULL THEN changed_fields := array_append(changed_fields, 'state'); END IF;
    IF original_zip IS NULL AND event_row.zip IS NOT NULL THEN changed_fields := array_append(changed_fields, 'zip'); END IF;
    location_result := CASE WHEN cardinality(changed_fields) > 0 THEN 'applied' ELSE 'already_present' END;
    location_reason := CASE WHEN location_result = 'applied' THEN 'blank_location_filled' ELSE 'same_location_retained' END;
  END IF;

  INSERT INTO public.crm_mojo_projection_receipts(
    event_id, lead_id, field_name, source_value, result, source_observed_at, applied_at, details
  )
  SELECT event_row.id, lead_row.id, field_name, source_value,
    CASE WHEN nullif(btrim(source_value), '') IS NULL THEN 'invalid_source' ELSE location_result END,
    event_row.call_at,
    CASE WHEN location_result = 'applied' AND nullif(btrim(source_value), '') IS NOT NULL THEN now() ELSE NULL END,
    jsonb_build_object(
      'reason', CASE WHEN nullif(btrim(source_value), '') IS NULL THEN 'source_field_missing' ELSE location_reason END,
      'bundle', 'property_location'
    )
  FROM (VALUES
    ('property_address', event_row.property_address),
    ('city', event_row.city), ('state', event_row.state), ('zip', event_row.zip)
  ) AS supplied(field_name, source_value)
  ON CONFLICT (event_id, field_name) DO UPDATE SET
    source_value = EXCLUDED.source_value,
    result = CASE WHEN public.crm_mojo_projection_receipts.result = 'applied'
      THEN 'applied' ELSE EXCLUDED.result END,
    applied_at = coalesce(public.crm_mojo_projection_receipts.applied_at, EXCLUDED.applied_at),
    checked_at = now(), details = EXCLUDED.details;

  IF p_provider_emails IS NOT NULL THEN
    UPDATE public.crm_mojo_call_events SET
      provider_emails = ARRAY(
        SELECT DISTINCT public.normalize_crm_email(email_value)
        FROM unnest(coalesce(provider_emails, '{}'::text[]) || p_provider_emails) AS emails(email_value)
        WHERE public.normalize_crm_email(email_value) IS NOT NULL
        ORDER BY 1
      ),
      updated_at = now()
    WHERE id = event_row.id
    RETURNING * INTO event_row;
  END IF;

  IF person_id_value IS NULL THEN
    SELECT person_id INTO person_id_value
    FROM public.crm_lead_entity_links WHERE lead_id = lead_row.id;
  END IF;

  FOREACH candidate_email IN ARRAY coalesce(event_row.provider_emails, '{}'::text[]) LOOP
    normalized_email := public.normalize_crm_email(candidate_email);
    IF normalized_email IS NULL THEN CONTINUE; END IF;

    SELECT * INTO method_row FROM public.crm_contact_methods
    WHERE method_type = 'email' AND normalized_value = normalized_email;

    IF person_id_value IS NULL THEN
      location_result := 'unresolved_identity';
      location_reason := 'canonical_person_missing';
    ELSIF method_row.id IS NULL THEN
      INSERT INTO public.crm_contact_methods(
        person_id, method_type, raw_value, normalized_value, label, is_primary, sms_consent_status
      ) VALUES (
        person_id_value, 'email', candidate_email, normalized_email, 'Mojo', false, 'not_applicable'
      ) ON CONFLICT (method_type, normalized_value) DO NOTHING;
      SELECT * INTO method_row FROM public.crm_contact_methods
      WHERE method_type = 'email' AND normalized_value = normalized_email;
      IF method_row.person_id = person_id_value THEN
        location_result := 'applied';
        location_reason := 'alternate_email_added';
      ELSE
        conflict_fingerprint := md5(
          lead_row.id::text || '|method_claimed_elsewhere|email|' || normalized_email || '|' || method_row.person_id::text
        );
        INSERT INTO public.crm_identity_conflicts(
          lead_id, conflict_type, selected_person_id, conflicting_person_id,
          method_type, normalized_value, fingerprint
        ) VALUES (
          lead_row.id, 'method_claimed_elsewhere', person_id_value, method_row.person_id,
          'email', normalized_email, conflict_fingerprint
        ) ON CONFLICT (fingerprint) DO UPDATE SET detected_at = now();
        location_result := 'protected_conflict';
        location_reason := 'email_claimed_by_other_person';
      END IF;
    ELSIF method_row.person_id = person_id_value THEN
      location_result := 'already_present';
      location_reason := 'email_already_owned';
    ELSE
      conflict_fingerprint := md5(
        lead_row.id::text || '|method_claimed_elsewhere|email|' || normalized_email || '|' || method_row.person_id::text
      );
      INSERT INTO public.crm_identity_conflicts(
        lead_id, conflict_type, selected_person_id, conflicting_person_id,
        method_type, normalized_value, fingerprint
      ) VALUES (
        lead_row.id, 'method_claimed_elsewhere', person_id_value, method_row.person_id,
        'email', normalized_email, conflict_fingerprint
      ) ON CONFLICT (fingerprint) DO UPDATE SET detected_at = now();
      location_result := 'protected_conflict';
      location_reason := 'email_claimed_by_other_person';
    END IF;

    INSERT INTO public.crm_mojo_projection_receipts(
      event_id, lead_id, field_name, source_value, result, source_observed_at, applied_at, details
    ) VALUES (
      event_row.id, lead_row.id, 'email:' || normalized_email, candidate_email,
      location_result, event_row.call_at,
      CASE WHEN location_result = 'applied' THEN now() ELSE NULL END,
      jsonb_build_object('reason', location_reason)
    ) ON CONFLICT (event_id, field_name) DO UPDATE SET
      result = CASE WHEN public.crm_mojo_projection_receipts.result = 'applied'
        THEN 'applied' ELSE EXCLUDED.result END,
      applied_at = coalesce(public.crm_mojo_projection_receipts.applied_at, EXCLUDED.applied_at),
      checked_at = now(), details = EXCLUDED.details;
  END LOOP;

  SELECT coalesce(jsonb_object_agg(result, count), '{}'::jsonb) INTO receipt_summary
  FROM (
    SELECT result, count(*) AS count
    FROM public.crm_mojo_projection_receipts WHERE event_id = event_row.id
    GROUP BY result
  ) AS counts;

  RETURN jsonb_build_object(
    'status', 'checked', 'eventId', event_row.id, 'leadId', lead_row.id,
    'results', receipt_summary
  );
END
$$;

REVOKE ALL ON FUNCTION public.apply_crm_mojo_source_projection_v2(uuid,text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_crm_mojo_source_projection_v2(uuid,text[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.repair_crm_mojo_event_projection_v2(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.apply_crm_mojo_source_projection_v2(p_event_id, NULL);
$$;
REVOKE ALL ON FUNCTION public.repair_crm_mojo_event_projection_v2(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_crm_mojo_event_projection_v2(uuid)
  TO service_role;

DO $projection_wrapper$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamp with time zone,timestamp with time zone)'
  ) IS NULL THEN
    ALTER FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
      RENAME TO ingest_crm_mojo_call_governed_v1;
  END IF;
END
$projection_wrapper$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE VIEW public.crm_mojo_projection_repair_candidates_v2 AS
SELECT
  event.id AS event_id,
  event.lead_id,
  event.record_id,
  event.call_at,
  CASE
    WHEN event.lead_id IS NULL THEN 'ambiguous'
    WHEN nullif(btrim(event.property_address), '') IS NULL THEN 'unavailable_source'
    WHEN link.property_id IS NOT NULL AND
      public.normalize_crm_address(property.address, property.city, property.state, property.zip)
        IS DISTINCT FROM public.normalize_crm_address(event.property_address, event.city, event.state, event.zip)
      THEN 'conflicting'
    WHEN nullif(btrim(lead.property_address), '') IS NOT NULL THEN 'already_corrected'
    ELSE 'repairable'
  END AS repair_class
FROM public.crm_mojo_call_events AS event
LEFT JOIN public.leads AS lead ON lead.id = event.lead_id
LEFT JOIN public.crm_lead_entity_links AS link ON link.lead_id = event.lead_id
LEFT JOIN public.crm_properties AS property ON property.id = link.property_id;

REVOKE ALL ON public.crm_mojo_projection_repair_candidates_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_mojo_projection_repair_candidates_v2 TO service_role;

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('mojo_field_ownership_version', '"mojo_source_projection_v2"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
