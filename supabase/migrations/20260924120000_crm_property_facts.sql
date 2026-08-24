-- Canonical property facts used by the lead workspace and enrichment routes.
-- Manifest remains historical compatibility data; no values are copied from it.

ALTER TABLE public.crm_properties
  ADD COLUMN IF NOT EXISTS lot_size numeric,
  ADD COLUMN IF NOT EXISTS bathrooms_full numeric,
  ADD COLUMN IF NOT EXISTS bathrooms_half numeric,
  ADD COLUMN IF NOT EXISTS basement_type text,
  ADD COLUMN IF NOT EXISTS stories numeric,
  ADD COLUMN IF NOT EXISTS garage_spaces numeric,
  ADD COLUMN IF NOT EXISTS roof_type text,
  ADD COLUMN IF NOT EXISTS heating text,
  ADD COLUMN IF NOT EXISTS cooling text,
  ADD COLUMN IF NOT EXISTS zoning text,
  ADD COLUMN IF NOT EXISTS hoa_amount numeric,
  ADD COLUMN IF NOT EXISTS tax_assessment numeric,
  ADD COLUMN IF NOT EXISTS tax_owed numeric,
  ADD COLUMN IF NOT EXISTS first_delinquent_year integer,
  ADD COLUMN IF NOT EXISTS last_sale_date date,
  ADD COLUMN IF NOT EXISTS last_sale_price numeric,
  ADD COLUMN IF NOT EXISTS zestimate numeric,
  ADD COLUMN IF NOT EXISTS redfin_estimate numeric,
  ADD COLUMN IF NOT EXISTS total_market_value numeric,
  ADD COLUMN IF NOT EXISTS occupancy_status text,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS data_enriched_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_crm_property_facts_for_lead(target_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads%ROWTYPE;
  prospect_row public.prospects%ROWTYPE;
  target_property_id uuid;
BEGIN
  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT property_id INTO target_property_id
  FROM public.crm_lead_entity_links
  WHERE lead_id = target_lead_id;
  IF target_property_id IS NULL THEN RETURN; END IF;

  SELECT * INTO prospect_row
  FROM public.prospects
  WHERE lead_id = target_lead_id
  ORDER BY id
  LIMIT 1;

  UPDATE public.crm_properties AS property
  SET
    lot_size = coalesce(
      CASE
        WHEN regexp_replace(btrim(lead_row.lot_size::text), ',', '', 'g') ~ '^[0-9]+(?:\.[0-9]+)?$'
          THEN regexp_replace(btrim(lead_row.lot_size::text), ',', '', 'g')::numeric
        ELSE NULL
      END,
      property.lot_size
    ),
    bathrooms_full = coalesce(lead_row.baths_full, property.bathrooms_full),
    bathrooms_half = coalesce(lead_row.baths_half, property.bathrooms_half),
    basement_type = coalesce(lead_row.basement_type, property.basement_type),
    stories = coalesce(lead_row.stories, property.stories),
    garage_spaces = coalesce(lead_row.garage_spaces, property.garage_spaces),
    roof_type = coalesce(lead_row.roof_type, property.roof_type),
    heating = coalesce(lead_row.heating, property.heating),
    cooling = coalesce(lead_row.cooling, property.cooling),
    zoning = coalesce(lead_row.zoning, property.zoning),
    hoa_amount = coalesce(lead_row.hoa_amount, property.hoa_amount),
    tax_assessment = coalesce(lead_row.tax_assessment, property.tax_assessment),
    tax_owed = coalesce(prospect_row.cumulative_due, property.tax_owed),
    first_delinquent_year = coalesce(prospect_row.earliest_delinquent_year, property.first_delinquent_year),
    last_sale_date = coalesce(lead_row.last_sale_date, property.last_sale_date),
    last_sale_price = coalesce(lead_row.last_sale_price, property.last_sale_price),
    zestimate = coalesce(prospect_row.zestimate, property.zestimate),
    total_market_value = coalesce(prospect_row.total_market_value, property.total_market_value),
    occupancy_status = coalesce(prospect_row.occupancy_status, property.occupancy_status),
    data_source = coalesce(lead_row.data_source,
      CASE WHEN prospect_row.id IS NOT NULL THEN 'county_prospect' END,
      property.data_source),
    data_enriched_at = coalesce(lead_row.data_enriched_at, property.data_enriched_at),
    updated_at = now()
  WHERE property.id = target_property_id;
END
$$;

REVOKE ALL ON FUNCTION public.sync_crm_property_facts_for_lead(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_sync_crm_property_facts_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.sync_crm_property_facts_for_lead(NEW.id);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.trigger_sync_crm_property_facts_from_lead()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_sync_crm_property_facts_from_prospect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.sync_crm_property_facts_for_lead(NEW.lead_id);
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.trigger_sync_crm_property_facts_from_prospect()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zz_sync_crm_property_facts_from_lead ON public.leads;
CREATE TRIGGER zz_sync_crm_property_facts_from_lead
AFTER INSERT OR UPDATE OF lot_size, baths_full, baths_half, basement_type,
  stories, garage_spaces, roof_type, heating, cooling, zoning, hoa_amount,
  tax_assessment, last_sale_date, last_sale_price, data_source, data_enriched_at
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_crm_property_facts_from_lead();

DROP TRIGGER IF EXISTS trigger_sync_crm_property_facts_from_prospect ON public.prospects;
CREATE TRIGGER trigger_sync_crm_property_facts_from_prospect
AFTER INSERT OR UPDATE OF lead_id, cumulative_due, earliest_delinquent_year,
  zestimate, total_market_value, occupancy_status
ON public.prospects
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_crm_property_facts_from_prospect();

CREATE OR REPLACE FUNCTION public.update_crm_property_enrichment_v1(
  p_lead_id uuid,
  p_zestimate numeric DEFAULT NULL,
  p_redfin_estimate numeric DEFAULT NULL,
  p_lot_size numeric DEFAULT NULL,
  p_last_sale_date date DEFAULT NULL,
  p_last_sale_price numeric DEFAULT NULL,
  p_tax_assessment numeric DEFAULT NULL,
  p_year_built integer DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_fetched_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_property_id uuid;
  changed_row public.crm_properties;
BEGIN
  SELECT property_id INTO target_property_id
  FROM public.crm_lead_entity_links
  WHERE lead_id = p_lead_id;

  IF target_property_id IS NULL THEN
    RAISE EXCEPTION 'canonical property not found for lead';
  END IF;

  UPDATE public.crm_properties
  SET
    zestimate = coalesce(p_zestimate, zestimate),
    redfin_estimate = coalesce(p_redfin_estimate, redfin_estimate),
    lot_size = coalesce(p_lot_size, lot_size),
    last_sale_date = coalesce(p_last_sale_date, last_sale_date),
    last_sale_price = coalesce(p_last_sale_price, last_sale_price),
    tax_assessment = coalesce(p_tax_assessment, tax_assessment),
    year_built = coalesce(p_year_built, year_built),
    data_source = coalesce(nullif(btrim(p_source), ''), data_source),
    data_enriched_at = coalesce(p_fetched_at, data_enriched_at),
    updated_at = now()
  WHERE id = target_property_id
  RETURNING * INTO changed_row;

  RETURN jsonb_build_object(
    'propertyId', changed_row.id,
    'leadId', p_lead_id,
    'updatedAt', changed_row.updated_at
  );
END
$$;

REVOKE ALL ON FUNCTION public.update_crm_property_enrichment_v1(
  uuid, numeric, numeric, numeric, date, numeric, numeric, integer, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_crm_property_enrichment_v1(
  uuid, numeric, numeric, numeric, date, numeric, numeric, integer, text, timestamptz
) TO service_role;

SELECT public.sync_crm_property_facts_for_lead(link.lead_id)
FROM public.crm_lead_entity_links AS link
WHERE link.property_id IS NOT NULL
ORDER BY link.lead_id;

COMMENT ON FUNCTION public.update_crm_property_enrichment_v1(
  uuid, numeric, numeric, numeric, date, numeric, numeric, integer, text, timestamptz
) IS 'Writes Zillow/Redfin facts to the canonical property linked to a lead.';
