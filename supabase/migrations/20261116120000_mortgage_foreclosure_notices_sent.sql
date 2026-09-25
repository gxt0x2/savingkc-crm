-- Count of notices already sent for a mortgage foreclosure prospect.
-- Unknown imports store 0 so the sale queue never leaves the cell blank.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS notices_sent integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_notices_sent_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_notices_sent_check
      CHECK (notices_sent >= 0 AND notices_sent <= 999);
  END IF;
END
$$;

COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notices_sent IS
  'How many notices have been sent for this prospect. Unknown rows store 0.';
