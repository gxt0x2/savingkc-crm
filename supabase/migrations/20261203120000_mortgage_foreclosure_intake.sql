-- Holding area for the weekday foreclosure pull.
-- Rows land here and stay out of public.mortgage_foreclosure_prospects
-- until someone approves them. This migration does not update or delete
-- the hand-loaded filings rows.
-- Paid sources are seeded enabled = false. Turning one on is a config
-- change in mortgage_foreclosure_intake_sources. No paid feed is called.
-- hygiene-approved-destructive: none. This file only creates tables and
-- inserts missing control and source rows.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_intake_sources (
  source_key text PRIMARY KEY,
  display_name text NOT NULL,
  is_paid boolean NOT NULL,
  enabled boolean NOT NULL,
  price_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mortgage_foreclosure_intake_sources_key_check CHECK (source_key ~ '^[a-z][a-z0-9_]{0,60}$')
);

COMMENT ON TABLE public.mortgage_foreclosure_intake_sources IS
  'Foreclosure intake source registry. is_paid marks a paid feed. enabled is the on/off. Paid rows ship enabled false. Ingest rejects a disabled or missing source.';
COMMENT ON COLUMN public.mortgage_foreclosure_intake_sources.enabled IS
  'Automatic intake accepts this source only when enabled is true. A paid source stays false until a deliberate config change.';

CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  pull_date date,
  raw_payload jsonb NOT NULL,
  review_status text NOT NULL DEFAULT 'pending',
  county text NOT NULL,
  state text,
  notice_type text,
  case_number text,
  instrument_number text,
  filing_or_notice_date date,
  sale_date date,
  property_address text,
  owner_name text,
  trustee_or_firm text,
  stage text,
  parcel_id text,
  zip text,
  address_key text,
  owner_key text,
  trustee_key text,
  notice_key text,
  notice_lifecycle text,
  sale_status text,
  court_confirmed boolean,
  recorder_confirmed boolean,
  equity_band text,
  notice_timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_prospect_id uuid REFERENCES public.mortgage_foreclosure_prospects(id) ON DELETE SET NULL,
  promoted_prospect_id uuid REFERENCES public.mortgage_foreclosure_prospects(id) ON DELETE SET NULL,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mortgage_foreclosure_intake_county_check CHECK (county ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT mortgage_foreclosure_intake_state_check CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  CONSTRAINT mortgage_foreclosure_intake_review_check CHECK (review_status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT mortgage_foreclosure_intake_notice_type_check CHECK (
    notice_type IS NULL OR notice_type IN ('lis_pendens', 'nod', 'notice_of_sale', 'sheriff_sale')
  ),
  CONSTRAINT mortgage_foreclosure_intake_lifecycle_check CHECK (
    notice_lifecycle IS NULL OR notice_lifecycle IN ('unknown', 'notice', 'confirmed', 'scheduled_sale', 'sold', 'cancelled', 'reinstated')
  ),
  CONSTRAINT mortgage_foreclosure_intake_sale_status_check CHECK (
    sale_status IS NULL OR sale_status IN ('unknown', 'scheduled', 'postponed', 'cancelled', 'sold', 'reinstated')
  ),
  CONSTRAINT mortgage_foreclosure_intake_equity_band_check CHECK (
    equity_band IS NULL OR equity_band IN ('strong_100k+', 'ideal_75k+', 'thin_40_74', 'kill_lt40', 'unknown')
  ),
  CONSTRAINT mortgage_foreclosure_intake_timeline_check CHECK (jsonb_typeof(notice_timeline) = 'array'),
  CONSTRAINT mortgage_foreclosure_intake_payload_check CHECK (jsonb_typeof(raw_payload) = 'object')
);

COMMENT ON TABLE public.mortgage_foreclosure_intake IS
  'Staging for pulled foreclosure notices. Pending and rejected rows are not skip-traced, exported, or dialed. Approval is what creates or updates a live filings row.';
COMMENT ON COLUMN public.mortgage_foreclosure_intake.notice_timeline IS
  'Append-only notice events: date, source, stage, sale_date, url. A republish keeps the prior sale_date here.';
COMMENT ON COLUMN public.mortgage_foreclosure_intake.court_confirmed IS
  'True only when the source is Case.net. Null when the pull does not say.';
COMMENT ON COLUMN public.mortgage_foreclosure_intake.recorder_confirmed IS
  'Null unless a recorder confirmation is actually in the pull. Newspaper and sheriff lists do not set it.';
COMMENT ON COLUMN public.mortgage_foreclosure_intake.equity_band IS
  'Left null. Equity enrichment is a later phase and is not called from intake.';

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_intake_review
  ON public.mortgage_foreclosure_intake (review_status, sale_date NULLS LAST, id);

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_intake_parcel
  ON public.mortgage_foreclosure_intake (parcel_id)
  WHERE parcel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_intake_address
  ON public.mortgage_foreclosure_intake (address_key, zip)
  WHERE address_key IS NOT NULL AND zip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_intake_owner_sale
  ON public.mortgage_foreclosure_intake (owner_key, trustee_key, sale_date)
  WHERE owner_key IS NOT NULL AND trustee_key IS NOT NULL AND sale_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_intake_notice
  ON public.mortgage_foreclosure_intake (notice_key)
  WHERE notice_key IS NOT NULL;

ALTER TABLE public.mortgage_foreclosure_intake_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mortgage_foreclosure_intake ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mortgage_foreclosure_intake_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mortgage_foreclosure_intake FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mortgage_foreclosure_intake_sources TO service_role;
GRANT ALL ON TABLE public.mortgage_foreclosure_intake TO service_role;

INSERT INTO public.mortgage_foreclosure_intake_sources (source_key, display_name, is_paid, enabled, price_note)
VALUES
  ('casenet', 'Case.net', false, true, NULL),
  ('daily_record', 'Daily Record public notices', false, true, NULL),
  ('noticeregistry', 'NoticeRegistry', false, true, NULL),
  ('southlaw', 'SouthLaw', false, true, NULL),
  ('millsap_singer', 'Millsap & Singer', false, true, NULL),
  ('logs_missouri', 'LOGS Missouri trustee lists', false, true, NULL),
  ('ks_efiling', 'KS e-filing', false, true, NULL),
  ('ks_sheriff_lists', 'Johnson and Wyandotte sheriff lists', false, true, NULL),
  ('mopublicnotices_smart_search', 'mopublicnotices Smart Search', true, false, '$75/30 days'),
  ('mlm_foreclosure_property_plus', 'Missouri Lawyers Media Foreclosure Property Plus', true, false, NULL),
  ('trusteesaledata_pro', 'TrusteeSaleData Pro', true, false, NULL),
  ('propertyradar', 'PropertyRadar', true, false, NULL)
ON CONFLICT (source_key) DO NOTHING;

-- Missing control rows stay paused in the ingest path. These seeds give the
-- five counties an explicit paused switch for every notice type. Existing
-- rows are left as the operator set them.
INSERT INTO public.mortgage_foreclosure_ingest_controls (county, notice_type, paused, updated_by)
SELECT county, notice_type, true, 'foreclosure-intake-seed'
FROM (VALUES ('jackson'), ('clay'), ('platte'), ('johnson'), ('wyandotte')) AS counties(county)
CROSS JOIN (VALUES ('lis_pendens'), ('nod'), ('notice_of_sale'), ('sheriff_sale')) AS notices(notice_type)
ON CONFLICT (county, notice_type) DO NOTHING;
