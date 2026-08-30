-- Display-only owner and address cells. First currently swallows MI/suffix,
-- street currently swallows unit, and county values arrive ALL CAPS.
-- These columns do not enroll campaigns or change TCPA/DNC.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS owner_1_mi text,
  ADD COLUMN IF NOT EXISTS owner_1_suffix text,
  ADD COLUMN IF NOT EXISTS situs_unit text,
  ADD COLUMN IF NOT EXISTS mailing_unit text;

COMMENT ON COLUMN public.prospects.owner_1_mi IS
  'Owner 1 middle initial or middle name for display.';
COMMENT ON COLUMN public.prospects.owner_1_suffix IS
  'Owner 1 suffix for display (Jr, Sr, II, III).';
COMMENT ON COLUMN public.prospects.situs_unit IS
  'Situs apartment, suite, or unit for display. Split off situs_street.';
COMMENT ON COLUMN public.prospects.mailing_unit IS
  'Mailing apartment, suite, or unit for display. Split off mailing_street.';
