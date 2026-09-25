-- Mortgage foreclosure prospecting. These rows are not tax-delinquent
-- county inventory. Dialing copies on public.prospects use prospect_track
-- mortgage_foreclosure, a null delinquency category, and an mfc: parcel id
-- so Jackson parcel enrollment cannot pull them into a tax campaign.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS prospect_track text NOT NULL DEFAULT 'tax';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prospects'::regclass
      AND conname = 'prospects_prospect_track_check'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_prospect_track_check
      CHECK (prospect_track IN ('tax', 'mortgage_foreclosure')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prospects'::regclass
      AND conname = 'prospects_foreclosure_isolated_from_tax_lists'
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_foreclosure_isolated_from_tax_lists
      CHECK (
        prospect_track <> 'mortgage_foreclosure'
        OR (
          (delinquent_years_category IS NULL OR delinquent_years_category NOT IN ('2yr', '3yr_plus'))
          AND (parcel_id IS NULL OR parcel_id LIKE 'mfc:%')
        )
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.prospects VALIDATE CONSTRAINT prospects_prospect_track_check;
ALTER TABLE public.prospects VALIDATE CONSTRAINT prospects_foreclosure_isolated_from_tax_lists;

COMMENT ON COLUMN public.prospects.prospect_track IS
  'tax feeds county tax lists. mortgage_foreclosure is a dialing copy and cannot carry a real county parcel id or a 2yr/3yr+ delinquency category.';

CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_row_id text,
  county text NOT NULL,
  state text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  notice_lifecycle text NOT NULL DEFAULT 'unknown',
  source_name text,
  source_url text,
  source_layer text,
  pull_date date,
  notice_or_filing_date date,
  sale_date date,
  sale_time text,
  sale_location text,
  case_number text,
  instrument_number text,
  book_page text,
  doc_type text,
  owner_name text NOT NULL,
  owner_entity text NOT NULL DEFAULT 'unknown',
  plaintiff_lender text,
  trustee_or_firm text,
  situs text NOT NULL,
  city text,
  zip text,
  legal_description text,
  parcel_id text,
  opening_bid numeric,
  min_bid numeric,
  amount_claimed numeric,
  notes text,
  tax_or_dlt_flag boolean NOT NULL DEFAULT false,
  recorder_confirmed boolean NOT NULL DEFAULT false,
  court_confirmed boolean NOT NULL DEFAULT false,
  est_value numeric,
  est_value_source text,
  est_debt numeric,
  est_debt_source text,
  est_equity numeric,
  equity_band text NOT NULL DEFAULT 'unknown',
  preferable boolean NOT NULL DEFAULT false,
  skiptrace_vendor text,
  skiptrace_date date,
  skiptrace_batch_id text,
  phone_1 text,
  phone_2 text,
  phone_3 text,
  email_1 text,
  deceased_flag boolean NOT NULL DEFAULT false,
  skiptrace_notes text,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mortgage_foreclosure_county_check CHECK (county ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT mortgage_foreclosure_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT mortgage_foreclosure_status_check CHECK (
    status IN ('new', 'equity_screened', 'skip_traced', 'callable', 'contacted', 'dnc', 'dead')
  ),
  CONSTRAINT mortgage_foreclosure_notice_check CHECK (
    notice_lifecycle IN ('unknown', 'notice', 'confirmed', 'scheduled_sale', 'sold', 'cancelled', 'reinstated')
  ),
  CONSTRAINT mortgage_foreclosure_owner_entity_check CHECK (
    owner_entity IN ('person', 'llc', 'trust', 'estate', 'unknown')
  ),
  CONSTRAINT mortgage_foreclosure_equity_band_check CHECK (
    equity_band IN ('strong_100k+', 'ideal_75k+', 'thin_40_74', 'kill_lt40', 'unknown')
  ),
  CONSTRAINT mortgage_foreclosure_vendor_check CHECK (skiptrace_vendor IS NULL OR skiptrace_vendor = 'smartskip'),
  CONSTRAINT mortgage_foreclosure_no_tax CHECK (tax_or_dlt_flag = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mortgage_foreclosure_external_row
  ON public.mortgage_foreclosure_prospects (external_row_id)
  WHERE external_row_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_queue
  ON public.mortgage_foreclosure_prospects (county, status, est_equity DESC NULLS LAST, id);

COMMENT ON TABLE public.mortgage_foreclosure_prospects IS
  'Mortgage foreclosure prospects for Jackson MO, Johnson KS, and later counties. Equity floor is $75,000. Phones are SmartSkip only, and only for person owners. Separate from tax-delinquent and inheritance lists.';

ALTER TABLE public.mortgage_foreclosure_prospects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mortgage_foreclosure_prospects FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mortgage_foreclosure_prospects TO service_role;
