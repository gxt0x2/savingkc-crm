-- Preserve historical paid-lead attribution before Manifest read retirement.
-- This is an internal, idempotent evidence backfill only. It does not enqueue
-- or export a conversion to an advertising platform.

WITH latest_manifest AS (
  SELECT DISTINCT ON (m.lead_id)
    m.id,
    m.lead_id,
    m.manifest,
    m.created_at
  FROM public.manifests AS m
  WHERE m.lead_id IS NOT NULL
  ORDER BY m.lead_id, m.created_at DESC, m.id DESC
), candidates AS (
  SELECT
    l.id AS lead_id,
    lm.id AS historical_manifest_id,
    COALESCE(lm.created_at, now()) AS evidence_time,
    COALESCE(lm.manifest -> 'acquisition', '{}'::jsonb) AS acquisition,
    CASE
      WHEN jsonb_typeof(lm.manifest -> 'acquisition' -> 'attribution') = 'object'
        THEN lm.manifest -> 'acquisition' -> 'attribution'
      ELSE '{}'::jsonb
    END AS attribution
  FROM public.leads AS l
  JOIN latest_manifest AS lm ON lm.lead_id = l.id
  WHERE l.source IN (
    'ppc-landing',
    'google_ads',
    'google-ads',
    'google_ads_phone',
    'google_ads_tax_phone',
    'paid-search',
    'openai_ads',
    'openai-ads'
  )
    AND jsonb_typeof(COALESCE(lm.manifest -> 'acquisition', '{}'::jsonb)) = 'object'
    AND COALESCE(lm.manifest -> 'acquisition', '{}'::jsonb) <> '{}'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM public.ppc_tracking_events AS existing_tracking
      WHERE existing_tracking.lead_id = l.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.ppc_conversion_outbox AS existing_outbox
      WHERE existing_outbox.lead_id = l.id
    )
)
INSERT INTO public.ppc_tracking_events (
  event_id,
  event_name,
  event_category,
  event_time,
  lead_id,
  traffic_source,
  campaign,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  gclid,
  gbraid,
  wbraid,
  gad_source,
  gad_campaignid,
  gad_adgroupid,
  page_location,
  page_referrer,
  payload
)
SELECT
  'backfill:manifest-attribution:' || candidate.lead_id::text,
  'legacy_attribution_backfill',
  'web',
  candidate.evidence_time,
  candidate.lead_id,
  COALESCE(
    NULLIF(candidate.attribution ->> 'traffic_source', ''),
    NULLIF(candidate.attribution ->> 'utm_source', ''),
    NULLIF(candidate.acquisition ->> 'source', '')
  ),
  COALESCE(
    NULLIF(candidate.attribution ->> 'campaign', ''),
    NULLIF(candidate.attribution ->> 'utm_campaign', '')
  ),
  NULLIF(candidate.attribution ->> 'utm_source', ''),
  NULLIF(candidate.attribution ->> 'utm_medium', ''),
  NULLIF(candidate.attribution ->> 'utm_campaign', ''),
  NULLIF(candidate.attribution ->> 'utm_term', ''),
  NULLIF(candidate.attribution ->> 'utm_content', ''),
  NULLIF(candidate.attribution ->> 'gclid', ''),
  NULLIF(candidate.attribution ->> 'gbraid', ''),
  NULLIF(candidate.attribution ->> 'wbraid', ''),
  NULLIF(candidate.attribution ->> 'gad_source', ''),
  NULLIF(candidate.attribution ->> 'gad_campaignid', ''),
  NULLIF(candidate.attribution ->> 'gad_adgroupid', ''),
  COALESCE(
    NULLIF(candidate.attribution ->> 'landingUrl', ''),
    NULLIF(candidate.attribution ->> 'page_location', ''),
    NULLIF(candidate.attribution ->> 'source_url', '')
  ),
  COALESCE(
    NULLIF(candidate.attribution ->> 'referrer', ''),
    NULLIF(candidate.attribution ->> 'page_referrer', '')
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'legacy_manifest_attribution_backfill',
    'historical_manifest_id', candidate.historical_manifest_id::text,
    'attribution', candidate.attribution || jsonb_build_object(
      'source', candidate.acquisition ->> 'source',
      'channel', candidate.acquisition ->> 'channel'
    )
  ))
FROM candidates AS candidate
ON CONFLICT (event_id) DO NOTHING;
