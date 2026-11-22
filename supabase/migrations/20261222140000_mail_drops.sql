-- G8: direct mail drops and their response.
--
-- One row per mailing. Each drop has a short code used as utm_campaign on its
-- QR / URL (utm_source=direct_mail, utm_medium=mail) and as the campaign on its
-- response phone number in tracking_number_channels (channel direct_mail).
-- mail_drop_performance joins web visits, leads, appointments, contracts and
-- closes back to each drop. (mail_pieces stays the per-lead letter log.)

SET lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.mail_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  list_name text CHECK (list_name IS NULL OR length(list_name) <= 120),
  county text CHECK (county IS NULL OR length(county) <= 60),
  drop_date date NOT NULL,
  pieces integer NOT NULL CHECK (pieces >= 0),
  cost numeric(12, 2) CHECK (cost IS NULL OR cost >= 0),
  piece_type text CHECK (piece_type IS NULL OR length(piece_type) <= 60),
  response_number text CHECK (response_number IS NULL OR response_number ~ '^\+1[0-9]{10}$'),
  landing_path text NOT NULL DEFAULT '/' CHECK (landing_path ~ '^/[A-Za-z0-9/_-]*$'),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_drops IS 'Direct mail drops. code = utm_campaign on the drop QR/URL and campaign on its response number.';

ALTER TABLE public.mail_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_drops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_drops TO service_role;

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_utm_campaign
  ON public.ppc_tracking_events (utm_campaign, event_time DESC)
  WHERE utm_campaign IS NOT NULL;

CREATE OR REPLACE VIEW public.mail_drop_performance
WITH (security_invoker = true)
AS
WITH drop_leads AS (
  SELECT d.id AS drop_id, l.id AS lead_id, l.source
  FROM public.mail_drops d
  JOIN public.leads l
    ON l.attribution->'first_touch'->>'campaign' = d.code
   AND l.created_at >= d.drop_date::timestamptz
)
SELECT
  d.id, d.code, d.name, d.list_name, d.county, d.drop_date, d.pieces, d.cost, d.piece_type, d.response_number, d.landing_path,
  (SELECT count(DISTINCT e.session_id) FROM public.ppc_tracking_events e
    WHERE e.utm_campaign = d.code AND e.utm_source = 'direct_mail' AND COALESCE(e.is_test, false) = false) AS web_visits,
  (SELECT count(*) FROM drop_leads x WHERE x.drop_id = d.id) AS leads,
  (SELECT count(*) FROM drop_leads x WHERE x.drop_id = d.id AND x.source IN ('inbound_call', 'inbound_sms', 'inbound_voicemail', 'inbound_ivr', 'inbound_ivr_no_input')) AS phone_leads,
  (SELECT count(DISTINCT a.lead_id) FROM public.appointments a JOIN drop_leads x ON x.lead_id = a.lead_id WHERE x.drop_id = d.id) AS appointments,
  (SELECT count(DISTINCT c.lead_id) FROM public.crm_lifecycle_events c JOIN drop_leads x ON x.lead_id = c.lead_id WHERE x.drop_id = d.id AND c.to_stage = 'under_contract') AS contracts,
  (SELECT count(*) FROM public.crm_marketing_outcomes m JOIN drop_leads x ON x.lead_id = m.lead_id WHERE x.drop_id = d.id AND m.outcome = 'closed_won') AS closes,
  (SELECT COALESCE(sum(m.revenue), 0) FROM public.crm_marketing_outcomes m JOIN drop_leads x ON x.lead_id = m.lead_id WHERE x.drop_id = d.id AND m.outcome = 'closed_won') AS revenue
FROM public.mail_drops d;

REVOKE ALL ON public.mail_drop_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mail_drop_performance TO service_role;
