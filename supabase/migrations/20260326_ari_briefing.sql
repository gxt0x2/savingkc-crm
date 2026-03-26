-- ARI CRM - Ari Briefing Events Table
-- Night 3: Ari Briefing Engine - ARI-01
-- Stores proactive intelligence events for the Ari briefing component

CREATE TABLE IF NOT EXISTS ari_briefing_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL, -- 'new_lead', 'incoming_call', 'stage_change', 'contract_event', etc.
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  action_url TEXT, -- Deep link to relevant page/record
  metadata JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE NOT NULL,
  dismissed BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ari_briefing_events_priority ON ari_briefing_events(priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ari_briefing_events_lead ON ari_briefing_events(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ari_briefing_events_unread ON ari_briefing_events(read, dismissed, created_at DESC);

-- Agent Daily Stats Table (ARI-04)
CREATE TABLE IF NOT EXISTS agent_daily_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  date DATE NOT NULL,
  calls_made INTEGER DEFAULT 0,
  meaningful_conversations INTEGER DEFAULT 0,
  dispositions_logged INTEGER DEFAULT 0,
  followups_completed INTEGER DEFAULT 0,
  followups_missed INTEGER DEFAULT 0,
  leads_advanced INTEGER DEFAULT 0,
  leads_stagnant INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(agent_id, date)
);

CREATE INDEX IF NOT EXISTS idx_agent_daily_stats_agent_date ON agent_daily_stats(agent_id, date DESC);

-- Weekly Reviews Table (RHY-03)
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  pipeline_health JSONB, -- leads per stage, net movement, stagnation flags
  agent_scorecard JSONB, -- all KPIs for the week
  active_deals JSONB, -- Stage 4+ leads with MAO, offer, status
  revenue_expense JSONB, -- financial summary
  system_health JSONB, -- error count, worker status, uptime
  top_priorities TEXT[], -- auto-generated top 3 for next week
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_week ON weekly_reviews(week_start DESC);
