-- OpenAI Ads reporting import cache for the Ads Command dashboard.
-- These tables are read-model storage only. They do not send conversions or
-- mutate OpenAI Ads.

CREATE TABLE IF NOT EXISTS public.openai_ads_campaign_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  spend_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
  conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  all_conversions NUMERIC(18, 6) NOT NULL DEFAULT 0,
  currency_code TEXT,
  timezone TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT openai_ads_campaign_daily_unique UNIQUE (date, account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_openai_ads_campaign_daily_date
  ON public.openai_ads_campaign_daily(date DESC);

CREATE INDEX IF NOT EXISTS idx_openai_ads_campaign_daily_campaign
  ON public.openai_ads_campaign_daily(account_id, campaign_id, date DESC);

DROP TRIGGER IF EXISTS openai_ads_campaign_daily_updated_at ON public.openai_ads_campaign_daily;
CREATE TRIGGER openai_ads_campaign_daily_updated_at
  BEFORE UPDATE ON public.openai_ads_campaign_daily
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.openai_ads_campaign_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read openai ads campaign daily" ON public.openai_ads_campaign_daily;
CREATE POLICY "Authenticated read openai ads campaign daily"
  ON public.openai_ads_campaign_daily
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access openai ads campaign daily" ON public.openai_ads_campaign_daily;
CREATE POLICY "Service role full access openai ads campaign daily"
  ON public.openai_ads_campaign_daily
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.openai_ads_reporting_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  since_date DATE NOT NULL,
  until_date DATE NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  campaign_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_openai_ads_reporting_sync_runs_started
  ON public.openai_ads_reporting_sync_runs(started_at DESC);

ALTER TABLE public.openai_ads_reporting_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read openai ads sync runs" ON public.openai_ads_reporting_sync_runs;
CREATE POLICY "Authenticated read openai ads sync runs"
  ON public.openai_ads_reporting_sync_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access openai ads sync runs" ON public.openai_ads_reporting_sync_runs;
CREATE POLICY "Service role full access openai ads sync runs"
  ON public.openai_ads_reporting_sync_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
