-- Canonical county/prospect enrichment. Provider facts and their provenance are
-- stored with the linked property; historical compatibility JSON is untouched.

ALTER TABLE public.crm_properties
  ADD COLUMN IF NOT EXISTS assessed_value numeric,
  ADD COLUMN IF NOT EXISTS land_value numeric,
  ADD COLUMN IF NOT EXISTS improvement_value numeric,
  ADD COLUMN IF NOT EXISTS tax_status text,
  ADD COLUMN IF NOT EXISTS property_owner_name text,
  ADD COLUMN IF NOT EXISTS owner_mailing_address text,
  ADD COLUMN IF NOT EXISTS owner_is_deceased boolean,
  ADD COLUMN IF NOT EXISTS owner_is_out_of_state boolean;

CREATE TABLE IF NOT EXISTS public.crm_property_enrichment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  property_id uuid NOT NULL REFERENCES public.crm_properties(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_reference text,
  mode text NOT NULL CHECK (mode IN ('fill_missing', 'overwrite')),
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'object'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_property_enrichment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_property_enrichment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_property_enrichment_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_property_enrichment_events_property
  ON public.crm_property_enrichment_events(property_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_property_enrichment_events_lead_source
  ON public.crm_property_enrichment_events(lead_id, source, observed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.record_crm_property_enrichment_v1(
  p_lead_id uuid,
  p_source text,
  p_source_reference text,
  p_facts jsonb,
  p_observed_at timestamptz DEFAULT now(),
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  property_id_value uuid;
  event_row public.crm_property_enrichment_events;
  source_value text := lower(nullif(btrim(p_source), ''));
  source_reference_value text := nullif(btrim(p_source_reference), '');
  observed_value timestamptz := coalesce(p_observed_at, now());
  mode_value text := CASE WHEN p_overwrite THEN 'overwrite' ELSE 'fill_missing' END;
  fingerprint_value text;
  changed_row public.crm_properties;
BEGIN
  IF p_lead_id IS NULL THEN RAISE EXCEPTION 'lead_id_required'; END IF;
  IF source_value IS NULL OR source_value !~ '^[a-z][a-z0-9:_-]{1,79}$' THEN
    RAISE EXCEPTION 'invalid_enrichment_source';
  END IF;
  IF source_reference_value IS NOT NULL AND length(source_reference_value) > 300 THEN
    RAISE EXCEPTION 'enrichment_source_reference_too_long';
  END IF;
  IF jsonb_typeof(p_facts) IS DISTINCT FROM 'object' OR p_facts = '{}'::jsonb OR pg_column_size(p_facts) > 32768 THEN
    RAISE EXCEPTION 'invalid_enrichment_facts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_facts) AS fact(key)
    WHERE fact.key NOT IN (
      'parcelId', 'county', 'propertyType', 'bedrooms', 'bathrooms', 'sqft',
      'yearBuilt', 'lotSize', 'basementType', 'garageSpaces', 'roofType',
      'heating', 'appraisedValue', 'assessedValue', 'landValue',
      'improvementValue', 'taxOwed', 'taxStatus', 'ownerName',
      'mailingAddress', 'firstDelinquentYear', 'zestimate', 'totalMarketValue',
      'occupancyStatus', 'ownerIsDeceased', 'ownerIsOutOfState'
    )
  ) THEN
    RAISE EXCEPTION 'unsupported_enrichment_fact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_facts) AS fact(key, value)
    WHERE fact.key IN (
      'bedrooms', 'bathrooms', 'sqft', 'yearBuilt', 'lotSize', 'garageSpaces',
      'appraisedValue', 'assessedValue', 'landValue', 'improvementValue',
      'taxOwed', 'firstDelinquentYear', 'zestimate', 'totalMarketValue'
    ) AND jsonb_typeof(fact.value) <> 'number'
  ) THEN
    RAISE EXCEPTION 'invalid_numeric_enrichment_fact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_facts) AS fact(key, value)
    WHERE fact.key IN (
      'parcelId', 'county', 'propertyType', 'basementType', 'roofType', 'heating',
      'taxStatus', 'ownerName', 'mailingAddress', 'occupancyStatus'
    ) AND (jsonb_typeof(fact.value) <> 'string' OR length(fact.value #>> '{}') > 500)
  ) THEN
    RAISE EXCEPTION 'invalid_text_enrichment_fact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_facts) AS fact(key, value)
    WHERE fact.key IN ('ownerIsDeceased', 'ownerIsOutOfState')
      AND jsonb_typeof(fact.value) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'invalid_boolean_enrichment_fact';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_facts) AS fact(key, value)
    WHERE fact.key IN (
      'bedrooms', 'bathrooms', 'sqft', 'yearBuilt', 'lotSize', 'garageSpaces',
      'appraisedValue', 'assessedValue', 'landValue', 'improvementValue',
      'taxOwed', 'firstDelinquentYear', 'zestimate', 'totalMarketValue'
    ) AND (fact.value::numeric < 0 OR fact.value::numeric > 1000000000)
  ) THEN
    RAISE EXCEPTION 'enrichment_fact_out_of_range';
  END IF;
  IF p_facts ? 'yearBuilt'
    AND ((p_facts ->> 'yearBuilt')::integer < 1600 OR (p_facts ->> 'yearBuilt')::integer > extract(year FROM now())::integer + 1) THEN
    RAISE EXCEPTION 'invalid_year_built';
  END IF;
  IF p_facts ? 'firstDelinquentYear'
    AND ((p_facts ->> 'firstDelinquentYear')::integer < 1900 OR (p_facts ->> 'firstDelinquentYear')::integer > extract(year FROM now())::integer + 1) THEN
    RAISE EXCEPTION 'invalid_delinquent_year';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_facts) AS fact(key, value)
    WHERE fact.key IN ('bedrooms', 'sqft', 'yearBuilt', 'firstDelinquentYear')
      AND fact.value::numeric <> trunc(fact.value::numeric)
  ) THEN
    RAISE EXCEPTION 'integer_enrichment_fact_required';
  END IF;
  IF observed_value < '1900-01-01'::timestamptz OR observed_value > now() + interval '1 day' THEN
    RAISE EXCEPTION 'invalid_enrichment_observed_at';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-property-enrichment:' || p_lead_id::text, 0)
  );

  SELECT property_id INTO property_id_value
  FROM public.crm_lead_entity_links
  WHERE lead_id = p_lead_id;
  IF property_id_value IS NULL THEN
    PERFORM public.refresh_crm_entity_for_lead(p_lead_id);
    SELECT property_id INTO property_id_value
    FROM public.crm_lead_entity_links
    WHERE lead_id = p_lead_id;
  END IF;
  IF property_id_value IS NULL THEN RAISE EXCEPTION 'canonical_property_not_found'; END IF;

  fingerprint_value := md5(
    property_id_value::text || '|' || source_value || '|' || mode_value || '|'
    || coalesce(source_reference_value, '') || '|' || p_facts::text
  );
  INSERT INTO public.crm_property_enrichment_events(
    fingerprint, property_id, lead_id, source, source_reference, mode, facts, observed_at
  ) VALUES (
    fingerprint_value, property_id_value, p_lead_id, source_value,
    source_reference_value, mode_value, p_facts, observed_value
  ) ON CONFLICT (fingerprint) DO NOTHING
  RETURNING * INTO event_row;
  IF event_row.id IS NULL THEN
    SELECT * INTO event_row
    FROM public.crm_property_enrichment_events
    WHERE fingerprint = fingerprint_value;
  END IF;

  UPDATE public.crm_properties AS property SET
    parcel_id = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'parcelId'), ''), property.parcel_id) ELSE coalesce(property.parcel_id, nullif(btrim(p_facts ->> 'parcelId'), '')) END,
    county = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'county'), ''), property.county) ELSE coalesce(property.county, nullif(btrim(p_facts ->> 'county'), '')) END,
    property_type = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'propertyType'), ''), property.property_type) ELSE coalesce(property.property_type, nullif(btrim(p_facts ->> 'propertyType'), '')) END,
    bedrooms = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'bedrooms')::integer, property.bedrooms) ELSE coalesce(property.bedrooms, (p_facts ->> 'bedrooms')::integer) END,
    bathrooms = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'bathrooms')::numeric, property.bathrooms) ELSE coalesce(property.bathrooms, (p_facts ->> 'bathrooms')::numeric) END,
    sqft = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'sqft')::integer, property.sqft) ELSE coalesce(property.sqft, (p_facts ->> 'sqft')::integer) END,
    year_built = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'yearBuilt')::integer, property.year_built) ELSE coalesce(property.year_built, (p_facts ->> 'yearBuilt')::integer) END,
    lot_size = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'lotSize')::numeric, property.lot_size) ELSE coalesce(property.lot_size, (p_facts ->> 'lotSize')::numeric) END,
    basement_type = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'basementType'), ''), property.basement_type) ELSE coalesce(property.basement_type, nullif(btrim(p_facts ->> 'basementType'), '')) END,
    garage_spaces = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'garageSpaces')::numeric, property.garage_spaces) ELSE coalesce(property.garage_spaces, (p_facts ->> 'garageSpaces')::numeric) END,
    roof_type = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'roofType'), ''), property.roof_type) ELSE coalesce(property.roof_type, nullif(btrim(p_facts ->> 'roofType'), '')) END,
    heating = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'heating'), ''), property.heating) ELSE coalesce(property.heating, nullif(btrim(p_facts ->> 'heating'), '')) END,
    tax_assessment = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'appraisedValue')::numeric, property.tax_assessment) ELSE coalesce(property.tax_assessment, (p_facts ->> 'appraisedValue')::numeric) END,
    assessed_value = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'assessedValue')::numeric, property.assessed_value) ELSE coalesce(property.assessed_value, (p_facts ->> 'assessedValue')::numeric) END,
    land_value = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'landValue')::numeric, property.land_value) ELSE coalesce(property.land_value, (p_facts ->> 'landValue')::numeric) END,
    improvement_value = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'improvementValue')::numeric, property.improvement_value) ELSE coalesce(property.improvement_value, (p_facts ->> 'improvementValue')::numeric) END,
    tax_owed = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'taxOwed')::numeric, property.tax_owed) ELSE coalesce(property.tax_owed, (p_facts ->> 'taxOwed')::numeric) END,
    tax_status = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'taxStatus'), ''), property.tax_status) ELSE coalesce(property.tax_status, nullif(btrim(p_facts ->> 'taxStatus'), '')) END,
    property_owner_name = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'ownerName'), ''), property.property_owner_name) ELSE coalesce(property.property_owner_name, nullif(btrim(p_facts ->> 'ownerName'), '')) END,
    owner_mailing_address = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'mailingAddress'), ''), property.owner_mailing_address) ELSE coalesce(property.owner_mailing_address, nullif(btrim(p_facts ->> 'mailingAddress'), '')) END,
    first_delinquent_year = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'firstDelinquentYear')::integer, property.first_delinquent_year) ELSE coalesce(property.first_delinquent_year, (p_facts ->> 'firstDelinquentYear')::integer) END,
    zestimate = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'zestimate')::numeric, property.zestimate) ELSE coalesce(property.zestimate, (p_facts ->> 'zestimate')::numeric) END,
    total_market_value = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'totalMarketValue')::numeric, property.total_market_value) ELSE coalesce(property.total_market_value, (p_facts ->> 'totalMarketValue')::numeric) END,
    occupancy_status = CASE WHEN p_overwrite THEN coalesce(nullif(btrim(p_facts ->> 'occupancyStatus'), ''), property.occupancy_status) ELSE coalesce(property.occupancy_status, nullif(btrim(p_facts ->> 'occupancyStatus'), '')) END,
    owner_is_deceased = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'ownerIsDeceased')::boolean, property.owner_is_deceased) ELSE coalesce(property.owner_is_deceased, (p_facts ->> 'ownerIsDeceased')::boolean) END,
    owner_is_out_of_state = CASE WHEN p_overwrite THEN coalesce((p_facts ->> 'ownerIsOutOfState')::boolean, property.owner_is_out_of_state) ELSE coalesce(property.owner_is_out_of_state, (p_facts ->> 'ownerIsOutOfState')::boolean) END,
    data_source = source_value,
    data_enriched_at = greatest(coalesce(property.data_enriched_at, '-infinity'::timestamptz), observed_value),
    updated_at = now()
  WHERE property.id = property_id_value
  RETURNING property.* INTO changed_row;
  IF changed_row.id IS NULL THEN RAISE EXCEPTION 'canonical_property_not_found'; END IF;

  RETURN jsonb_build_object(
    'propertyId', property_id_value,
    'leadId', p_lead_id,
    'eventId', event_row.id,
    'source', event_row.source,
    'observedAt', event_row.observed_at
  );
END
$$;

REVOKE ALL ON FUNCTION public.record_crm_property_enrichment_v1(
  uuid, text, text, jsonb, timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_crm_property_enrichment_v1(
  uuid, text, text, jsonb, timestamptz, boolean
) TO service_role;

COMMENT ON TABLE public.crm_property_enrichment_events IS
  'Durable provider evidence behind canonical property facts.';
COMMENT ON FUNCTION public.record_crm_property_enrichment_v1(uuid, text, text, jsonb, timestamptz, boolean) IS
  'Validates and atomically records typed property facts with provider provenance.';
