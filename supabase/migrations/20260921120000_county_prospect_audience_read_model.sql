-- Make county-list audience evidence explicit. Property class is intentionally
-- unknown until county/import evidence identifies residential or land; price,
-- occupancy, and Zestimate are not reliable substitutes.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS property_class text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prospects'::regclass
      AND conname = 'prospects_property_class_check'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_property_class_check
      CHECK (property_class IN ('residential', 'land', 'unknown')) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.prospects
  VALIDATE CONSTRAINT prospects_property_class_check;

CREATE INDEX IF NOT EXISTS idx_prospects_county_audience
  ON public.prospects (delinquent_years_category, is_deceased, property_class, id)
  WHERE delinquent_years_category IN ('2yr', '3yr_plus');

CREATE OR REPLACE FUNCTION public.county_prospect_audience_summary_v1()
RETURNS TABLE (
  delinquency text,
  deceased boolean,
  property_class text,
  total bigint,
  with_phone_candidate bigint,
  linked_leads bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    prospect.delinquent_years_category,
    coalesce(prospect.is_deceased, false),
    coalesce(prospect.property_class, 'unknown'),
    count(*)::bigint,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE phone.prospect_id = prospect.id
        AND nullif(trim(phone.phone), '') IS NOT NULL
        AND coalesce(lower(phone.phone_connected), '') NOT IN ('disconnected', 'false', 'bad_number', 'wrong_number')
        AND coalesce(lower(phone.last_disposition), '') NOT IN ('dnc', 'do_not_call', 'wrong_number', 'disconnected', 'bad_number')
    ))::bigint,
    count(prospect.lead_id)::bigint
  FROM public.prospects AS prospect
  WHERE prospect.delinquent_years_category IN ('2yr', '3yr_plus')
  GROUP BY
    prospect.delinquent_years_category,
    coalesce(prospect.is_deceased, false),
    coalesce(prospect.property_class, 'unknown')
  ORDER BY 1, 2, 3;
$$;

REVOKE ALL ON FUNCTION public.county_prospect_audience_summary_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.county_prospect_audience_summary_v1()
  TO service_role;

COMMENT ON COLUMN public.prospects.property_class IS
  'County/import evidence only: residential, land, or unknown. Never infer from valuation or occupancy.';
COMMENT ON FUNCTION public.county_prospect_audience_summary_v1() IS
  'Bounded aggregate inventory for reviewed 2-year/3+-year county prospect audiences; does not enroll or contact anyone.';
