-- Period-first operating reports. These indexes keep the default dashboard
-- from scanning all historical source rows before applying its date window.

CREATE INDEX IF NOT EXISTS idx_leads_operating_report_created
  ON public.leads (created_at DESC, id DESC)
  WHERE is_parked = FALSE;

CREATE INDEX IF NOT EXISTS idx_lead_activities_operating_report_created
  ON public.lead_activities (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_dispo_deals_operating_report_entered
  ON public.dispo_deals (entered_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_dispo_deals_operating_report_closed
  ON public.dispo_deals (close_date DESC, id DESC)
  WHERE close_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_offers_operating_report_submitted
  ON public.buyer_offers (submitted_at DESC, id DESC)
  WHERE submitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buyer_offers_operating_report_created
  ON public.buyer_offers (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_buyers_operating_report_created
  ON public.buyers (created_at DESC, id DESC);
