-- Divorce and siteless court filings, plus recorder liens.
-- These rows are not mortgage foreclosure prospects and cannot enroll in the dialer.
-- Probate stays on the existing deceased inheritance audience and is not inserted here.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.court_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  county text NOT NULL,
  state text NOT NULL,
  filing_kind text NOT NULL,
  case_number text,
  party_name text NOT NULL,
  situs text,
  filed_on date,
  source_name text NOT NULL,
  source_url text,
  notes text,
  dialer_enrolled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT court_filings_county_check CHECK (county ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT court_filings_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT court_filings_kind_check CHECK (filing_kind IN ('divorce', 'lis_pendens', 'judicial_foreclosure')),
  CONSTRAINT court_filings_no_dialer CHECK (dialer_enrolled = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_court_filings_case
  ON public.court_filings (county, filing_kind, case_number)
  WHERE case_number IS NOT NULL;

COMMENT ON TABLE public.court_filings IS
  'Jackson and Johnson court filings that are not the foreclosure dial queue. dialer_enrolled must stay false.';

ALTER TABLE public.court_filings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.court_filings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.court_filings TO service_role;

CREATE TABLE IF NOT EXISTS public.recorder_liens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  county text NOT NULL,
  state text NOT NULL,
  lien_kind text NOT NULL,
  instrument_number text,
  debtor_name text NOT NULL,
  situs text,
  recorded_on date,
  source_name text NOT NULL,
  source_url text,
  notes text,
  dialer_enrolled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recorder_liens_county_check CHECK (county ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT recorder_liens_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT recorder_liens_kind_check CHECK (lien_kind IN ('federal_tax_lien', 'hoa_lien')),
  CONSTRAINT recorder_liens_no_dialer CHECK (dialer_enrolled = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recorder_liens_instrument
  ON public.recorder_liens (county, lien_kind, instrument_number)
  WHERE instrument_number IS NOT NULL;

COMMENT ON TABLE public.recorder_liens IS
  'Federal tax liens and HOA liens. Not foreclosure prospects. dialer_enrolled must stay false.';

ALTER TABLE public.recorder_liens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recorder_liens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.recorder_liens TO service_role;
