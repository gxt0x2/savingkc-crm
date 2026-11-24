-- Standard lead attribution audit trail (lead_attribution_v1).
-- Adds leads.attribution JSONB and backfills only what is derivable from
-- existing evidence (lead_activities metadata, ppc_tracking_events). Idempotent:
-- rows that already carry an attribution object are never overwritten.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS attribution jsonb;

COMMENT ON COLUMN public.leads.attribution IS
  'lead_attribution_v1: first/last touch (utm, click ids, referrer, landing), page_history (<=20), ga_client_id, ga_session_id, first_visit_at, device, form, lead_source_type, phone/dialer/import context.';

CREATE INDEX IF NOT EXISTS leads_attribution_ga_client_id_idx
  ON public.leads ((attribution ->> 'ga_client_id'))
  WHERE attribution ? 'ga_client_id';

-- 1) Website form leads: earliest website_form_submit activity = first touch,
--    latest = last touch.
WITH web AS (
  SELECT
    a.lead_id,
    (array_agg(a.metadata ORDER BY a.created_at ASC))[1]  AS first_md,
    (array_agg(a.metadata ORDER BY a.created_at DESC))[1] AS last_md,
    min(a.created_at) AS first_at,
    max(a.created_at) AS last_at
  FROM public.lead_activities a
  WHERE a.metadata ->> 'source' = 'website_form_submit'
  GROUP BY a.lead_id
)
UPDATE public.leads l
SET attribution = jsonb_strip_nulls(jsonb_build_object(
  'schema', 'lead_attribution_v1',
  'lead_source_type', 'website_form',
  'first_touch', jsonb_strip_nulls(jsonb_build_object(
    'source', NULLIF(w.first_md -> 'attribution' ->> 'utm_source', ''),
    'medium', NULLIF(w.first_md -> 'attribution' ->> 'utm_medium', ''),
    'campaign', NULLIF(w.first_md -> 'attribution' ->> 'utm_campaign', ''),
    'gclid', NULLIF(w.first_md -> 'attribution' ->> 'gclid', ''),
    'referrer', NULLIF(w.first_md ->> 'referrer', ''),
    'landing_page', NULLIF(w.first_md ->> 'landing_url', ''),
    'at', w.first_at)),
  'last_touch', jsonb_strip_nulls(jsonb_build_object(
    'source', NULLIF(w.last_md -> 'attribution' ->> 'utm_source', ''),
    'medium', NULLIF(w.last_md -> 'attribution' ->> 'utm_medium', ''),
    'campaign', NULLIF(w.last_md -> 'attribution' ->> 'utm_campaign', ''),
    'gclid', NULLIF(w.last_md -> 'attribution' ->> 'gclid', ''),
    'referrer', NULLIF(w.last_md ->> 'referrer', ''),
    'landing_page', NULLIF(w.last_md ->> 'landing_url', ''),
    'at', w.last_at)),
  'site_session_id', NULLIF(w.last_md ->> 'session_id', ''),
  'form', jsonb_strip_nulls(jsonb_build_object(
    'source', NULLIF(w.last_md ->> 'form_source', ''),
    'step', NULLIF(w.last_md -> 'attribution' ->> 'form_step', ''),
    'status', NULLIF(w.last_md -> 'attribution' ->> 'form_status', ''))),
  'derived_from', 'backfill:lead_activities.website_form_submit',
  'captured_at', now()))
FROM web w
WHERE l.id = w.lead_id AND l.attribution IS NULL;

-- 2) Paid/web leads with ppc_tracking_events but no form activity.
WITH ev AS (
  SELECT DISTINCT ON (e.lead_id) e.*
  FROM public.ppc_tracking_events e
  WHERE e.lead_id IS NOT NULL
  ORDER BY e.lead_id, e.event_time ASC NULLS LAST
)
UPDATE public.leads l
SET attribution = jsonb_strip_nulls(jsonb_build_object(
  'schema', 'lead_attribution_v1',
  'lead_source_type', 'website_form',
  'first_touch', jsonb_strip_nulls(jsonb_build_object(
    'source', ev.utm_source, 'medium', ev.utm_medium, 'campaign', COALESCE(ev.utm_campaign, ev.campaign),
    'term', ev.utm_term, 'content', ev.utm_content,
    'gclid', ev.gclid, 'gbraid', ev.gbraid, 'wbraid', ev.wbraid,
    'referrer', ev.page_referrer, 'landing_page', ev.page_location, 'at', ev.event_time)),
  'derived_from', 'backfill:ppc_tracking_events',
  'captured_at', now()))
FROM ev
WHERE l.id = ev.lead_id AND l.attribution IS NULL;

-- 3) Phone leads: tracking number (calledNumber) from the first call activity.
WITH calls AS (
  SELECT DISTINCT ON (a.lead_id)
    a.lead_id,
    NULLIF(a.metadata ->> 'calledNumber', '') AS tracking_number,
    NULLIF(a.metadata ->> 'recordingSource', '') AS recording_source
  FROM public.lead_activities a
  WHERE a.metadata ? 'calledNumber' OR a.metadata ? 'recordingSource'
  ORDER BY a.lead_id, a.created_at ASC
)
UPDATE public.leads l
SET attribution = jsonb_strip_nulls(jsonb_build_object(
  'schema', 'lead_attribution_v1',
  'lead_source_type', CASE
    WHEN l.source IN ('web_click_to_call') OR c.recording_source = 'web_click_to_call' THEN 'web_click_to_call'
    WHEN l.source ILIKE '%dialer%' OR l.source ILIKE 'mojo%' THEN 'dialer'
    ELSE 'inbound_call' END,
  'phone', jsonb_strip_nulls(jsonb_build_object('tracking_number', c.tracking_number)),
  'derived_from', 'backfill:lead_activities.call',
  'captured_at', now()))
FROM calls c
WHERE l.id = c.lead_id AND l.attribution IS NULL
  AND (l.source ILIKE '%call%' OR l.source ILIKE '%phone%' OR l.source ILIKE '%ivr%' OR l.source ILIKE '%dialer%' OR l.source ILIKE 'mojo%');

-- 4) CSV / campaign imports: batch id.
WITH imp AS (
  SELECT DISTINCT ON (a.lead_id) a.lead_id, a.metadata ->> 'import_batch_id' AS batch_id
  FROM public.lead_activities a
  WHERE a.metadata ? 'import_batch_id'
  ORDER BY a.lead_id, a.created_at ASC
)
UPDATE public.leads l
SET attribution = jsonb_build_object(
  'schema', 'lead_attribution_v1',
  'lead_source_type', 'import',
  'import', jsonb_build_object('batch_id', imp.batch_id),
  'derived_from', 'backfill:lead_activities.import',
  'captured_at', now())
FROM imp
WHERE l.id = imp.lead_id AND l.attribution IS NULL AND imp.batch_id IS NOT NULL;

-- 5) Everything else: record the source type only (no invented touch data).
UPDATE public.leads l
SET attribution = jsonb_build_object(
  'schema', 'lead_attribution_v1',
  'lead_source_type', CASE
    WHEN l.source IN ('website_form', 'website', 'google_ads', 'ppc-landing', 'ppc_form_submit') THEN 'website_form'
    WHEN l.source = 'web_click_to_call' THEN 'web_click_to_call'
    WHEN l.source IN ('inbound_call', 'inbound_ivr', 'google_ads_phone', 'google_ads_tax_phone') THEN 'inbound_call'
    WHEN l.source ILIKE '%sms%' THEN 'inbound_sms'
    WHEN l.source ILIKE '%dialer%' OR l.source ILIKE 'mojo%' THEN 'dialer'
    WHEN l.source = 'mobile_manual' THEN 'mobile_manual'
    WHEN l.source IN ('manual', 'web_manual') THEN 'manual'
    WHEN l.source = 'prospect_match' THEN 'prospect_promotion'
    ELSE 'other' END,
  'derived_from', 'backfill:leads.source',
  'captured_at', now())
WHERE l.attribution IS NULL;
