-- Live tax-status gate. Records the latest county balance on the property
-- and an append-only check log. Tax-delinquent dialer export requires a
-- delinquent live check from the last 7 days. This does not change opt-out
-- or do-not-call rules.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.crm_properties
  ADD COLUMN IF NOT EXISTS tax_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS tax_check_source text,
  ADD COLUMN IF NOT EXISTS tax_check_balance numeric,
  ADD COLUMN IF NOT EXISTS tax_check_years_owed integer,
  ADD COLUMN IF NOT EXISTS tax_check_result text;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS tax_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS tax_check_source text,
  ADD COLUMN IF NOT EXISTS tax_check_balance numeric,
  ADD COLUMN IF NOT EXISTS tax_check_years_owed integer,
  ADD COLUMN IF NOT EXISTS tax_check_result text;

ALTER TABLE public.source_list_rows
  ADD COLUMN IF NOT EXISTS tax_rank_boost smallint NOT NULL DEFAULT 0;

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS tax_rank_boost smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.crm_properties'::regclass AND conname = 'crm_properties_tax_check_result_check'
  ) THEN
    ALTER TABLE public.crm_properties
      ADD CONSTRAINT crm_properties_tax_check_result_check
      CHECK (tax_check_result IS NULL OR tax_check_result IN ('delinquent', 'not_delinquent', 'not_verified'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prospects'::regclass AND conname = 'prospects_tax_check_result_check'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_tax_check_result_check
      CHECK (tax_check_result IS NULL OR tax_check_result IN ('delinquent', 'not_delinquent', 'not_verified'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.source_list_rows'::regclass AND conname = 'source_list_rows_tax_rank_boost_check'
  ) THEN
    ALTER TABLE public.source_list_rows
      ADD CONSTRAINT source_list_rows_tax_rank_boost_check
      CHECK (tax_rank_boost IN (0, 1));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_prospects_tax_rank_boost_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_prospects_tax_rank_boost_check
      CHECK (tax_rank_boost IN (0, 1));
  END IF;
END
$$;

COMMENT ON COLUMN public.crm_properties.tax_check_at IS
  'When the live county balance was last read for this property.';
COMMENT ON COLUMN public.crm_properties.tax_check_source IS
  'County balance source: jackson_tax_portal, johnson_taxbill, clay_collector, platte_collector, or wyandotte_tax.';
COMMENT ON COLUMN public.crm_properties.tax_check_balance IS
  'Latest county delinquent balance in dollars.';
COMMENT ON COLUMN public.crm_properties.tax_check_years_owed IS
  'Count of prior tax years still unpaid on that balance.';
COMMENT ON COLUMN public.crm_properties.tax_check_result IS
  'delinquent, not_delinquent, or not_verified. A list tag is not a result.';

CREATE TABLE IF NOT EXISTS public.tax_status_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id text,
  county text,
  list_type text NOT NULL,
  property_id uuid REFERENCES public.crm_properties(id) ON DELETE SET NULL,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  source_list_row_id uuid REFERENCES public.source_list_rows(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL,
  source text NOT NULL,
  balance numeric,
  years_owed integer,
  result text NOT NULL,
  tier_before text,
  tier_after text,
  rank_boost smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_status_checks_result_check CHECK (result IN ('delinquent', 'not_delinquent', 'not_verified')),
  CONSTRAINT tax_status_checks_source_check CHECK (
    source IN ('jackson_tax_portal', 'johnson_taxbill', 'clay_collector', 'platte_collector', 'wyandotte_tax')
  ),
  CONSTRAINT tax_status_checks_county_check CHECK (
    county IS NULL OR county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
  ),
  CONSTRAINT tax_status_checks_tier_before_check CHECK (tier_before IS NULL OR tier_before IN ('2yr', '3yr_plus')),
  CONSTRAINT tax_status_checks_tier_after_check CHECK (tier_after IS NULL OR tier_after IN ('2yr', '3yr_plus')),
  CONSTRAINT tax_status_checks_rank_check CHECK (rank_boost IN (0, 1)),
  CONSTRAINT tax_status_checks_years_check CHECK (years_owed IS NULL OR (years_owed >= 0 AND years_owed <= 50)),
  CONSTRAINT tax_status_checks_balance_check CHECK (balance IS NULL OR (balance >= 0 AND balance <= 100000000)),
  CONSTRAINT tax_status_checks_list_type_check CHECK (char_length(list_type) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_tax_status_checks_parcel
  ON public.tax_status_checks (county, parcel_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_tax_status_checks_prospect
  ON public.tax_status_checks (prospect_id, checked_at DESC)
  WHERE prospect_id IS NOT NULL;

COMMENT ON TABLE public.tax_status_checks IS
  'Append-only live county tax checks. checked_at, source, balance, years_owed, and result. Cass is not a source.';

ALTER TABLE public.tax_status_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tax_status_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.tax_status_checks TO service_role;

CREATE OR REPLACE FUNCTION public.tax_status_checks_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'tax_status_check_immutable';
END;
$function$;

DROP TRIGGER IF EXISTS tax_status_checks_immutable ON public.tax_status_checks;
CREATE TRIGGER tax_status_checks_immutable
  BEFORE UPDATE OR DELETE ON public.tax_status_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.tax_status_checks_immutable_v1();

REVOKE ALL ON FUNCTION public.tax_status_checks_immutable_v1() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tax_status_mojo_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name text NOT NULL,
  phone text NOT NULL,
  mojo_list_name text NOT NULL,
  parcel_id text,
  county text,
  prospect_id uuid,
  property_id uuid,
  source_list_row_id uuid,
  status text NOT NULL DEFAULT 'pending_browser',
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by text,
  CONSTRAINT tax_status_mojo_removals_status_check CHECK (status IN ('pending_browser', 'confirmed')),
  CONSTRAINT tax_status_mojo_removals_name_check CHECK (char_length(contact_name) BETWEEN 1 AND 200),
  CONSTRAINT tax_status_mojo_removals_phone_check CHECK (char_length(phone) BETWEEN 7 AND 40),
  CONSTRAINT tax_status_mojo_removals_list_check CHECK (char_length(mojo_list_name) BETWEEN 1 AND 200),
  CONSTRAINT tax_status_mojo_removals_confirm_check CHECK (
    (status = 'pending_browser' AND confirmed_at IS NULL AND confirmed_by IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_status_mojo_removals_pending
  ON public.tax_status_mojo_removals (phone, mojo_list_name)
  WHERE status = 'pending_browser';

COMMENT ON TABLE public.tax_status_mojo_removals IS
  'Worklist of contacts already on a Mojo list whose parcel is no longer tax delinquent. Pending until a person removes them in Mojo and the CRM stamps confirmed. This table does not call Mojo.';

ALTER TABLE public.tax_status_mojo_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tax_status_mojo_removals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tax_status_mojo_removals TO service_role;

CREATE OR REPLACE FUNCTION public.tax_status_export_allowed_v1(
  p_parcel_id text,
  p_county text,
  p_prospect_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tax_status_checks AS check_row
    WHERE check_row.result = 'delinquent'
      AND check_row.checked_at >= pg_catalog.now() - interval '7 days'
      AND check_row.checked_at <= pg_catalog.now() + interval '5 minutes'
      AND check_row.source IN (
        'jackson_tax_portal',
        'johnson_taxbill',
        'clay_collector',
        'platte_collector',
        'wyandotte_tax'
      )
      AND (
        (p_prospect_id IS NOT NULL AND check_row.prospect_id = p_prospect_id)
        OR (
          nullif(btrim(coalesce(p_parcel_id, '')), '') IS NOT NULL
          AND check_row.parcel_id = btrim(p_parcel_id)
          AND check_row.county = lower(btrim(coalesce(p_county, '')))
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.tax_status_export_allowed_v1(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tax_status_export_allowed_v1(text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.tax_status_export_allowed_v1(text, text, uuid) IS
  'True only when a live county balance in the last 7 days is still delinquent. A historical list tag is not enough.';

CREATE OR REPLACE VIEW public.source_list_dialer_export
WITH (security_invoker = true) AS
SELECT
  source_list_row_id,
  source_list_id,
  list_type,
  county,
  state,
  violation_kind,
  parcel_id,
  case_id,
  address,
  owner_names,
  amount_owed,
  property_id,
  prospect_id,
  row_status,
  phone_e164,
  phone_origin,
  pull_date,
  source_file_name
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL
  AND (
    list_type IS DISTINCT FROM 'tax_delinquent'
    OR public.tax_status_export_allowed_v1(parcel_id, county, prospect_id)
  );

COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Opt-out and do-not-call scrubs still apply. Tax-delinquent rows also need a live delinquent balance from the last 7 days.';

REVOKE ALL ON TABLE public.source_list_dialer_export FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_export TO service_role;
