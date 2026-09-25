-- notice_number is which filing this is on the living notice (1st, 2nd, 3rd).
-- It is not outreach. notices_sent and outreach_count stay the mailer, text,
-- and call alias synced by sync_mortgage_foreclosure_outreach.
-- skip_phones is this CRM's ranked contact list, closest to the subject first.
-- It is not a relatives-skip vendor product. Sandbox demo contacts are fictional.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS notice_number integer,
  ADD COLUMN IF NOT EXISTS skip_phones jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_notice_number_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_notice_number_check
      CHECK (notice_number IS NULL OR (notice_number >= 1 AND notice_number <= 20));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_skip_phones_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_skip_phones_check
      CHECK (jsonb_typeof(skip_phones) = 'array');
  END IF;
END
$$;

COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notice_number IS
  'Sequence of this legal notice on the living file (1 = first notice). Not outreach.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.skip_phones IS
  'Ranked SmartSkip contacts for a person owner. Closest to the subject first. Not a relatives-skip product.';
