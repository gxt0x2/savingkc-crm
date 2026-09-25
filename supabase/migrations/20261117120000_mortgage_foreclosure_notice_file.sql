-- Living legal notice file for mortgage foreclosure.
-- outreach_count is mailers, texts, and calls. notices_sent stays as a
-- backward-compatible alias. Notice type is the filing (lis pendens, NOD,
-- notice of sale, sheriff sale), not the outreach count.
-- Relatives skip is intentionally not stored or purchased here.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS outreach_count integer,
  ADD COLUMN IF NOT EXISTS attorney_name text,
  ADD COLUMN IF NOT EXISTS sale_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS notice_type text,
  ADD COLUMN IF NOT EXISTS notice_type_source text,
  ADD COLUMN IF NOT EXISTS notice_timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS absentee_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_signals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mailing_address text;

UPDATE public.mortgage_foreclosure_prospects
SET outreach_count = notices_sent
WHERE outreach_count IS NULL;

ALTER TABLE public.mortgage_foreclosure_prospects
  ALTER COLUMN outreach_count SET DEFAULT 0;

UPDATE public.mortgage_foreclosure_prospects
SET outreach_count = 0
WHERE outreach_count IS NULL;

ALTER TABLE public.mortgage_foreclosure_prospects
  ALTER COLUMN outreach_count SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_outreach_count_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_outreach_count_check
      CHECK (outreach_count >= 0 AND outreach_count <= 999);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_sale_status_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_sale_status_check
      CHECK (sale_status IN ('unknown', 'scheduled', 'postponed', 'cancelled', 'sold', 'reinstated'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_notice_type_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_notice_type_check
      CHECK (notice_type IS NULL OR notice_type IN ('lis_pendens', 'nod', 'notice_of_sale', 'sheriff_sale'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mortgage_foreclosure_prospects'::regclass
      AND conname = 'mortgage_foreclosure_timeline_check'
  ) THEN
    ALTER TABLE public.mortgage_foreclosure_prospects
      ADD CONSTRAINT mortgage_foreclosure_timeline_check
      CHECK (jsonb_typeof(notice_timeline) = 'array');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sync_mortgage_foreclosure_outreach()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.outreach_count := COALESCE(NEW.outreach_count, NEW.notices_sent, 0);
  ELSIF NEW.outreach_count IS DISTINCT FROM OLD.outreach_count THEN
    NEW.outreach_count := COALESCE(NEW.outreach_count, 0);
  ELSIF NEW.notices_sent IS DISTINCT FROM OLD.notices_sent THEN
    NEW.outreach_count := COALESCE(NEW.notices_sent, 0);
  ELSE
    NEW.outreach_count := COALESCE(NEW.outreach_count, NEW.notices_sent, 0);
  END IF;
  NEW.notices_sent := NEW.outreach_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mortgage_foreclosure_outreach_sync ON public.mortgage_foreclosure_prospects;
CREATE TRIGGER mortgage_foreclosure_outreach_sync
  BEFORE INSERT OR UPDATE ON public.mortgage_foreclosure_prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_mortgage_foreclosure_outreach();

COMMENT ON COLUMN public.mortgage_foreclosure_prospects.outreach_count IS
  'Mailers, texts, and calls already sent. This is not the legal filing.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notices_sent IS
  'Backward-compatible alias of outreach_count. Kept in sync by trigger.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.attorney_name IS
  'Attorney on the living notice file. Changes are appended to notice_timeline.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.sale_status IS
  'Sale status on the living notice file: scheduled, postponed, cancelled, sold, reinstated, or unknown.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notice_type IS
  'Legal filing tag: lis_pendens, nod, notice_of_sale, or sheriff_sale.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notice_type_source IS
  'Source stamp for the notice type (feed, county, or file name).';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.notice_timeline IS
  'Append-only updates when the attorney or sale date changes.';
COMMENT ON COLUMN public.mortgage_foreclosure_prospects.owner_signals IS
  'Owner-name and absentee signals recorded before phones are stored. Relatives are not included.';

CREATE TABLE IF NOT EXISTS public.mortgage_foreclosure_ingest_controls (
  county text NOT NULL,
  notice_type text NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  updated_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (county, notice_type),
  CONSTRAINT mortgage_foreclosure_ingest_county_check CHECK (county ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT mortgage_foreclosure_ingest_notice_type_check CHECK (
    notice_type IN ('lis_pendens', 'nod', 'notice_of_sale', 'sheriff_sale')
  )
);

COMMENT ON TABLE public.mortgage_foreclosure_ingest_controls IS
  'Pause or resume foreclosure ingest by county and notice type. updated_since is the incremental scraper watermark.';
COMMENT ON COLUMN public.mortgage_foreclosure_ingest_controls.updated_since IS
  'Scrapers should request records updated after this timestamp and advance it after a successful pull. Relatives skip is not part of ingest.';

ALTER TABLE public.mortgage_foreclosure_ingest_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mortgage_foreclosure_ingest_controls FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mortgage_foreclosure_ingest_controls TO service_role;

REVOKE ALL ON FUNCTION public.sync_mortgage_foreclosure_outreach() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mortgage_foreclosure_outreach() TO service_role;
