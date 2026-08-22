-- Accelerate the operator-facing campaign activity tabs without changing event ownership or retention.
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_events_type_history
  ON public.prospecting_campaign_events (campaign_id, event_type, created_at DESC, id DESC);
