-- Bootstrap a canonical property link from verified enrichment location evidence.
--
-- Phone-only lead shells are intentional for provider call intake. A matched
-- county prospect or successful county-assessor lookup can establish the
-- canonical property without copying provider-owned fields onto `leads`.

-- The compatibility refresh derives properties from `leads.property_address`.
-- Preserve an already verified canonical property when an identity-only lead
-- later changes stage, owner, priority, or another compatibility field.
CREATE OR REPLACE FUNCTION public.refresh_crm_entity_for_lead(target_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  preserved_property_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-entity-lead:' || target_lead_id::text, 0)
  );

  SELECT property_id INTO preserved_property_id
  FROM public.crm_lead_entity_links
  WHERE lead_id = target_lead_id;

  PERFORM public.refresh_crm_entity_for_lead_core(target_lead_id);

  IF preserved_property_id IS NOT NULL THEN
    UPDATE public.crm_lead_entity_links SET
      property_id = coalesce(property_id, preserved_property_id),
      projected_at = now()
    WHERE lead_id = target_lead_id;

    UPDATE public.crm_opportunities AS opportunity SET
      primary_property_id = coalesce(
        opportunity.primary_property_id,
        link.property_id,
        preserved_property_id
      ),
      updated_at = now()
    FROM public.crm_lead_entity_links AS link
    WHERE link.lead_id = target_lead_id
      AND opportunity.id = link.opportunity_id;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.refresh_crm_entity_for_lead(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_crm_entity_for_lead(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_crm_property_link_v1(
  p_lead_id uuid,
  p_source text,
  p_address text,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_zip text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_parcel_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_value text := lower(nullif(btrim(p_source), ''));
  address_value text := nullif(btrim(p_address), '');
  city_value text := nullif(btrim(p_city), '');
  state_value text := upper(nullif(btrim(p_state), ''));
  zip_value text := nullif(btrim(p_zip), '');
  county_value text := nullif(btrim(p_county), '');
  parcel_value text := nullif(btrim(p_parcel_id), '');
  normalized_address_value text;
  property_id_value uuid;
  opportunity_id_value uuid;
BEGIN
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'lead_id_required'; END IF;
  IF source_value IS NULL OR source_value NOT IN ('prospect_match', 'county_assessor') THEN
    RAISE EXCEPTION 'invalid_property_link_source';
  END IF;
  IF address_value IS NULL OR length(address_value) > 500 THEN
    RAISE EXCEPTION 'invalid_property_link_address';
  END IF;
  IF city_value IS NOT NULL AND length(city_value) > 120 THEN
    RAISE EXCEPTION 'invalid_property_link_city';
  END IF;
  IF state_value IS NOT NULL AND state_value !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_property_link_state';
  END IF;
  IF zip_value IS NOT NULL AND zip_value !~ '^[0-9]{5}(-[0-9]{4})?$' THEN
    RAISE EXCEPTION 'invalid_property_link_zip';
  END IF;
  IF county_value IS NOT NULL AND length(county_value) > 120 THEN
    RAISE EXCEPTION 'invalid_property_link_county';
  END IF;
  IF parcel_value IS NOT NULL AND length(parcel_value) > 160 THEN
    RAISE EXCEPTION 'invalid_property_link_parcel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'lead_not_found';
  END IF;

  normalized_address_value := public.normalize_crm_address(
    address_value, city_value, state_value, zip_value
  );
  IF normalized_address_value IS NULL THEN
    RAISE EXCEPTION 'invalid_property_link_address';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-property-enrichment:' || p_lead_id::text, 0)
  );

  SELECT link.property_id, link.opportunity_id
  INTO property_id_value, opportunity_id_value
  FROM public.crm_lead_entity_links AS link
  WHERE link.lead_id = p_lead_id;

  IF opportunity_id_value IS NULL THEN
    PERFORM public.refresh_crm_entity_for_lead(p_lead_id);
    SELECT link.property_id, link.opportunity_id
    INTO property_id_value, opportunity_id_value
    FROM public.crm_lead_entity_links AS link
    WHERE link.lead_id = p_lead_id;
  END IF;
  IF opportunity_id_value IS NULL THEN
    RAISE EXCEPTION 'canonical_entity_link_not_found';
  END IF;

  -- Never replace a property that is already linked to the lead.
  IF property_id_value IS NOT NULL THEN
    UPDATE public.crm_opportunities AS opportunity SET
      primary_property_id = coalesce(opportunity.primary_property_id, property_id_value),
      updated_at = now()
    WHERE opportunity.id = opportunity_id_value;

    RETURN jsonb_build_object(
      'leadId', p_lead_id,
      'propertyId', property_id_value,
      'source', source_value,
      'linked', false
    );
  END IF;

  -- Prefer an existing county parcel before falling back to normalized address.
  IF parcel_value IS NOT NULL AND county_value IS NOT NULL THEN
    SELECT property.id INTO property_id_value
    FROM public.crm_properties AS property
    WHERE property.parcel_id = parcel_value
      AND lower(coalesce(property.county, '')) = lower(county_value)
    ORDER BY property.created_at, property.id
    LIMIT 1;
  END IF;

  IF property_id_value IS NULL THEN
    INSERT INTO public.crm_properties(
      normalized_address, address, city, state, zip, county, parcel_id
    ) VALUES (
      normalized_address_value, address_value, city_value, state_value,
      zip_value, county_value, parcel_value
    )
    ON CONFLICT (normalized_address) DO UPDATE SET
      city = coalesce(public.crm_properties.city, EXCLUDED.city),
      state = coalesce(public.crm_properties.state, EXCLUDED.state),
      zip = coalesce(public.crm_properties.zip, EXCLUDED.zip),
      county = coalesce(public.crm_properties.county, EXCLUDED.county),
      parcel_id = coalesce(public.crm_properties.parcel_id, EXCLUDED.parcel_id),
      updated_at = now()
    RETURNING id INTO property_id_value;
  ELSE
    UPDATE public.crm_properties SET
      city = coalesce(city, city_value),
      state = coalesce(state, state_value),
      zip = coalesce(zip, zip_value),
      county = coalesce(county, county_value),
      parcel_id = coalesce(parcel_id, parcel_value),
      updated_at = now()
    WHERE id = property_id_value;
  END IF;

  UPDATE public.crm_lead_entity_links SET
    property_id = property_id_value,
    projected_at = now()
  WHERE lead_id = p_lead_id AND property_id IS NULL;

  UPDATE public.crm_opportunities SET
    primary_property_id = property_id_value,
    updated_at = now()
  WHERE id = opportunity_id_value AND primary_property_id IS NULL;

  RETURN jsonb_build_object(
    'leadId', p_lead_id,
    'propertyId', property_id_value,
    'source', source_value,
    'linked', true
  );
END
$$;

REVOKE ALL ON FUNCTION public.ensure_crm_property_link_v1(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_crm_property_link_v1(
  uuid, text, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.ensure_crm_property_link_v1(
  uuid, text, text, text, text, text, text, text
) IS 'Creates and links a canonical property from a verified prospect match or county-assessor location.';

-- The application release that first called this function reached production
-- before this migration. Retry only the jobs that failed for that exact schema
-- gap; unrelated failures remain terminal for review.
UPDATE public.crm_property_enrichment_jobs SET
  status = 'pending',
  available_at = now(),
  attempts = 0,
  claim_token = NULL,
  claimed_at = NULL,
  completed_at = NULL,
  last_error = NULL,
  updated_at = now()
WHERE status = 'failed'
  AND last_error LIKE 'Canonical property bootstrap failed:%ensure_crm_property_link_v1%';
