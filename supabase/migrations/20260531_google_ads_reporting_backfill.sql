-- Google Ads reporting import cache for the Ads Command dashboard.
-- These tables are read-model storage only. They do not send conversions or
-- mutate Google Ads.

CREATE TABLE IF NOT EXISTS public.google_ads_campaign_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_status TEXT,
  advertising_channel_type TEXT,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  conversions_value NUMERIC(18, 6) NOT NULL DEFAULT 0,
  all_conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  all_conversions_value NUMERIC(18, 6) NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT google_ads_campaign_daily_unique UNIQUE (date, customer_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_daily_date
  ON public.google_ads_campaign_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_daily_campaign
  ON public.google_ads_campaign_daily(customer_id, campaign_id, date DESC);

DROP TRIGGER IF EXISTS google_ads_campaign_daily_updated_at ON public.google_ads_campaign_daily;
CREATE TRIGGER google_ads_campaign_daily_updated_at
  BEFORE UPDATE ON public.google_ads_campaign_daily
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.google_ads_campaign_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read google ads campaign daily" ON public.google_ads_campaign_daily;
CREATE POLICY "Authenticated read google ads campaign daily"
  ON public.google_ads_campaign_daily
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access google ads campaign daily" ON public.google_ads_campaign_daily;
CREATE POLICY "Service role full access google ads campaign daily"
  ON public.google_ads_campaign_daily
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.google_ads_search_term_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  ad_group_id TEXT NOT NULL,
  ad_group_name TEXT NOT NULL,
  search_term TEXT NOT NULL,
  keyword_text TEXT,
  keyword_match_type TEXT,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  conversions_value NUMERIC(18, 6) NOT NULL DEFAULT 0,
  all_conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  all_conversions_value NUMERIC(18, 6) NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_ads_search_term_daily_date
  ON public.google_ads_search_term_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_google_ads_search_term_daily_campaign
  ON public.google_ads_search_term_daily(customer_id, campaign_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_google_ads_search_term_daily_clicks
  ON public.google_ads_search_term_daily(date DESC, clicks DESC);

DROP TRIGGER IF EXISTS google_ads_search_term_daily_updated_at ON public.google_ads_search_term_daily;
CREATE TRIGGER google_ads_search_term_daily_updated_at
  BEFORE UPDATE ON public.google_ads_search_term_daily
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.google_ads_search_term_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read google ads search term daily" ON public.google_ads_search_term_daily;
CREATE POLICY "Authenticated read google ads search term daily"
  ON public.google_ads_search_term_daily
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access google ads search term daily" ON public.google_ads_search_term_daily;
CREATE POLICY "Service role full access google ads search term daily"
  ON public.google_ads_search_term_daily
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.google_ads_reporting_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  since_date DATE NOT NULL,
  until_date DATE NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  campaign_rows INTEGER NOT NULL DEFAULT 0,
  search_term_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_google_ads_reporting_sync_runs_started
  ON public.google_ads_reporting_sync_runs(started_at DESC);

ALTER TABLE public.google_ads_reporting_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read google ads sync runs" ON public.google_ads_reporting_sync_runs;
CREATE POLICY "Authenticated read google ads sync runs"
  ON public.google_ads_reporting_sync_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access google ads sync runs" ON public.google_ads_reporting_sync_runs;
CREATE POLICY "Service role full access google ads sync runs"
  ON public.google_ads_reporting_sync_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
