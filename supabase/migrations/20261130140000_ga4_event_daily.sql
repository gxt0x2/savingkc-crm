-- GA4 event × landing page × source, daily (handoff Item 2, 2026-11-06).
-- Written by the analytics-sync edge function (source 'ga4_events'), read by
-- the Website conversion board. Service-role only, like ga4_landing_daily:
-- RLS on with no policies, no anon/authenticated grants.

CREATE TABLE IF NOT EXISTS public.ga4_event_daily (
  date                  date             NOT NULL,
  event_name            text             NOT NULL,
  landing_page          text             NOT NULL DEFAULT '(not set)',
  session_source_medium text             NOT NULL DEFAULT '(not set)',
  event_count           bigint           NOT NULL DEFAULT 0,
  key_events            double precision NOT NULL DEFAULT 0, -- > 0 only when the event is a GA4 key event
  synced_at             timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (date, event_name, landing_page, session_source_medium)
);

CREATE INDEX IF NOT EXISTS ga4_event_daily_event_date_idx
  ON public.ga4_event_daily (event_name, date DESC);

ALTER TABLE public.ga4_event_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga4_event_daily FROM anon, authenticated;

-- Last-30-day funnel by session source / medium. security_invoker keeps the
-- table's RLS in force for whoever queries the view.
CREATE OR REPLACE VIEW public.ga4_funnel_30d
WITH (security_invoker = true) AS
SELECT
  session_source_medium,
  sum(event_count) FILTER (WHERE event_name = 'page_view')           AS page_views,
  sum(event_count) FILTER (WHERE event_name = 'cta_click')           AS cta_clicks,
  sum(event_count) FILTER (WHERE event_name = 'quiz_started')        AS quiz_started,
  sum(event_count) FILTER (WHERE event_name = 'form_started')        AS form_started,
  sum(event_count) FILTER (WHERE event_name = 'form_step_completed') AS form_steps,
  sum(event_count) FILTER (WHERE event_name = 'contact_started')     AS contact_started,
  sum(event_count) FILTER (WHERE event_name = 'phone_click')         AS phone_clicks,
  sum(event_count) FILTER (WHERE event_name = 'lead_submitted')      AS lead_submitted,
  sum(event_count) FILTER (WHERE event_name = 'generate_lead')       AS generate_lead,
  sum(event_count) FILTER (WHERE event_name = 'appointment_booked')  AS appointment_booked,
  sum(key_events)                                                    AS key_events
FROM public.ga4_event_daily
WHERE date >= current_date - 30
GROUP BY session_source_medium;

REVOKE ALL ON public.ga4_funnel_30d FROM anon, authenticated;

COMMENT ON TABLE public.ga4_event_daily IS
  'GA4 Data API: eventCount/keyEvents by date × eventName × landingPage × sessionSourceMedium (allowlisted events). Synced by analytics-sync source ga4_events.';
