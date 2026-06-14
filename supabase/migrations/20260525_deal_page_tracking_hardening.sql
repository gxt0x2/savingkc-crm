-- Deal page tracking hardening and enterprise analytics fields.
-- Keeps the existing public collector shape but moves new traffic toward
-- hashed request identity, session attribution, and buyer/broadcast linkage.

CREATE TABLE IF NOT EXISTS deal_page_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_page_id UUID NOT NULL REFERENCES deal_pages(id) ON DELETE CASCADE,
  event_id TEXT,
  event_type TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
  broadcast_id UUID REFERENCES deal_broadcasts(id) ON DELETE SET NULL,
  broadcast_recipient_id UUID REFERENCES broadcast_recipients(id) ON DELETE SET NULL,
  share_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  ref_code TEXT,
  page_path TEXT,
  page_location TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  x_pct NUMERIC,
  y_pct NUMERIC,
  scroll_pct NUMERIC,
  section TEXT,
  element_tag TEXT,
  element_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_page_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_page_id UUID NOT NULL REFERENCES deal_pages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  visitor_id TEXT,
  buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL,
  broadcast_id UUID REFERENCES deal_broadcasts(id) ON DELETE SET NULL,
  broadcast_recipient_id UUID REFERENCES broadcast_recipients(id) ON DELETE SET NULL,
  share_id TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  ref_code TEXT,
  page_path TEXT,
  page_location TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  viewport_width INTEGER,
  viewport_height INTEGER,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  active_duration_ms INTEGER,
  max_scroll_pct INTEGER,
  sections_viewed TEXT[] DEFAULT '{}',
  interactions INTEGER DEFAULT 0,
  is_bounced BOOLEAN,
  converted BOOLEAN DEFAULT false,
  conversion_type TEXT
);

ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES deal_broadcasts(id) ON DELETE SET NULL;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS broadcast_recipient_id UUID REFERENCES broadcast_recipients(id) ON DELETE SET NULL;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS share_id TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS page_path TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS page_location TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS request_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE deal_page_events ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES deal_broadcasts(id) ON DELETE SET NULL;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS broadcast_recipient_id UUID REFERENCES broadcast_recipients(id) ON DELETE SET NULL;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS share_id TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS page_path TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS page_location TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS utm_term TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS utm_content TEXT;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS request_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE deal_page_sessions ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_page_events_event_id
  ON deal_page_events(event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_page_events_page_created
  ON deal_page_events(deal_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_page_events_session
  ON deal_page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_deal_page_events_buyer
  ON deal_page_events(buyer_id)
  WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_page_events_internal
  ON deal_page_events(is_internal);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_page_sessions_session
  ON deal_page_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_deal_page_sessions_page_started
  ON deal_page_sessions(deal_page_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_page_sessions_buyer
  ON deal_page_sessions(buyer_id)
  WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_page_sessions_internal
  ON deal_page_sessions(is_internal);

ALTER TABLE deal_page_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_page_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deal_page_events'
      AND policyname = 'Service role full access on deal_page_events'
  ) THEN
    CREATE POLICY "Service role full access on deal_page_events"
      ON deal_page_events FOR ALL USING (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deal_page_events'
      AND policyname = 'Authenticated read on deal_page_events'
  ) THEN
    CREATE POLICY "Authenticated read on deal_page_events"
      ON deal_page_events FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deal_page_sessions'
      AND policyname = 'Service role full access on deal_page_sessions'
  ) THEN
    CREATE POLICY "Service role full access on deal_page_sessions"
      ON deal_page_sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deal_page_sessions'
      AND policyname = 'Authenticated read on deal_page_sessions'
  ) THEN
    CREATE POLICY "Authenticated read on deal_page_sessions"
      ON deal_page_sessions FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;
