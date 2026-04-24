-- Add manual top-pick flag to buyer_offers. When set, overrides the
-- auto-computed best-offer scoring for the lead's group in the UI.
ALTER TABLE buyer_offers
  ADD COLUMN IF NOT EXISTS is_top_pick BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_offers_lead_top_pick
  ON buyer_offers(lead_id)
  WHERE is_top_pick = true;
