-- analytics-sync v5 records its GA4 event pull (ga4_event_daily) as source
-- 'ga4_events'. The source check only allowed 'gsc' and 'ga4', so the run row
-- insert failed and the nightly response errored after GSC/GA4 had synced.
-- Applied to Atlas on 2026-11-07 before the v5 function deploy.
ALTER TABLE public.analytics_sync_runs DROP CONSTRAINT IF EXISTS analytics_sync_runs_source_check;
ALTER TABLE public.analytics_sync_runs
  ADD CONSTRAINT analytics_sync_runs_source_check CHECK (source = ANY (ARRAY['gsc'::text, 'ga4'::text, 'ga4_events'::text]));
