-- First-party PPC event log and Google Ads export approval gate.
--
-- ppc_tracking_events is intentionally separate from leads. It records paid
-- visit and funnel behavior before a homeowner becomes a CRM lead.

CREATE TABLE IF NOT EXISTS public.ppc_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL DEFAULT 'web',
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT,
  visitor_id TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  manifest_id UUID REFERENCES public.manifests(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  page_path TEXT,
  page_location TEXT,
  page_referrer TEXT,
  traffic_source TEXT,
  campaign TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  gad_source TEXT,
  gad_campaignid TEXT,
  gad_adgroupid TEXT,
  form_step INTEGER,
  form_status TEXT,
  situation_raw TEXT,
  timeline_raw TEXT,
  condition_raw TEXT,
  situation_tag TEXT,
  timeline_urgency TEXT,
  condition_overall TEXT,
  phone_number TEXT,
  sms_consent BOOLEAN,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_tracking_events_unique_event_id UNIQUE (event_id),
  CONSTRAINT ppc_tracking_events_category_check
    CHECK (event_category IN ('visit', 'form', 'phone', 'call', 'conversion', 'error', 'web'))
);

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_time
  ON public.ppc_tracking_events(event_time DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_session
  ON public.ppc_tracking_events(session_id, event_time DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_lead
  ON public.ppc_tracking_events(lead_id, event_time DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_name_time
  ON public.ppc_tracking_events(event_name, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_click_id
  ON public.ppc_tracking_events(gclid, gbraid, wbraid)
  WHERE gclid IS NOT NULL OR gbraid IS NOT NULL OR wbraid IS NOT NULL;

DROP TRIGGER IF EXISTS ppc_tracking_events_updated_at ON public.ppc_tracking_events;
CREATE TRIGGER ppc_tracking_events_updated_at
  BEFORE UPDATE ON public.ppc_tracking_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.ppc_tracking_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.ppc_tracking_events;
CREATE POLICY "Authenticated full access"
  ON public.ppc_tracking_events
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.ppc_tracking_events;
CREATE POLICY "Service role full access"
  ON public.ppc_tracking_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ppc_conversion_outbox
  ADD COLUMN IF NOT EXISTS approved_for_google_ads BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approval_note TEXT;

CREATE INDEX IF NOT EXISTS idx_ppc_conversion_outbox_approved_pending
  ON public.ppc_conversion_outbox(status, event_time)
  WHERE approved_for_google_ads IS TRUE AND status IN ('pending', 'failed');
