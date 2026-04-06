-- Hot Opportunities Engine: cache + audit trail tables
-- Phase 1.2: Database migration

-- Cache table: one row per active lead, stores composite score + sub-scores + rank
CREATE TABLE IF NOT EXISTS hot_opportunities_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  composite_score INTEGER NOT NULL DEFAULT 0,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  velocity_score INTEGER NOT NULL DEFAULT 0,
  deal_quality_score INTEGER NOT NULL DEFAULT 0,
  time_pressure_score INTEGER NOT NULL DEFAULT 0,
  multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  tier_label TEXT NOT NULL DEFAULT 'long_shot', -- 'favorite', 'caution', 'long_shot'
  tier_capped BOOLEAN NOT NULL DEFAULT FALSE,
  rank INTEGER, -- 1-7 for top deals, NULL otherwise
  on_hot_list BOOLEAN NOT NULL DEFAULT FALSE,
  raw_inputs JSONB NOT NULL DEFAULT '{}',
  promoted_at TIMESTAMPTZ,
  demoted_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  last_scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_trigger_event TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id)
);

-- Index for fast hot list retrieval
CREATE INDEX IF NOT EXISTS idx_hot_cache_on_list ON hot_opportunities_cache(on_hot_list, rank) WHERE on_hot_list = TRUE;
CREATE INDEX IF NOT EXISTS idx_hot_cache_score ON hot_opportunities_cache(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_hot_cache_lead ON hot_opportunities_cache(lead_id);

-- Audit trail: append-only log of every score calculation
CREATE TABLE IF NOT EXISTS hot_score_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  composite_score INTEGER NOT NULL,
  engagement_score INTEGER NOT NULL,
  velocity_score INTEGER NOT NULL,
  deal_quality_score INTEGER NOT NULL,
  time_pressure_score INTEGER NOT NULL,
  multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  tier_label TEXT NOT NULL,
  tier_capped BOOLEAN NOT NULL DEFAULT FALSE,
  on_hot_list BOOLEAN NOT NULL DEFAULT FALSE,
  list_position INTEGER,
  trigger_event TEXT,
  raw_inputs JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying a lead's score history
CREATE INDEX IF NOT EXISTS idx_hot_audit_lead_time ON hot_score_audit_trail(lead_id, created_at DESC);

-- Cleanup function for 90-day retention (called by cron)
CREATE OR REPLACE FUNCTION cleanup_hot_score_audit()
RETURNS void AS $$
BEGIN
  DELETE FROM hot_score_audit_trail
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
