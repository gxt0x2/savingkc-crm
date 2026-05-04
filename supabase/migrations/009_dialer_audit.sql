-- 009: Dialer audit trail
-- Tracks dialer sessions, queue settings, and per-lead session events.

CREATE TABLE IF NOT EXISTS dialer_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name text NOT NULL,
  queue_key text NOT NULL,
  saved_queue_id uuid REFERENCES dialer_saved_queues(id) ON DELETE SET NULL,
  campaign text NOT NULL DEFAULT 'All sources',
  status_filter text NOT NULL DEFAULT 'Any status',
  priority_filter text NOT NULL DEFAULT 'Any priority',
  min_score integer NOT NULL DEFAULT 0,
  search text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'power',
  lines_per_agent integer NOT NULL DEFAULT 1,
  seconds_between_calls integer NOT NULL DEFAULT 18,
  abandon_rate_limit integer NOT NULL DEFAULT 3,
  queue_size integer NOT NULL DEFAULT 0,
  dials_completed integer NOT NULL DEFAULT 0,
  contacts integer NOT NULL DEFAULT 0,
  appointments integer NOT NULL DEFAULT 0,
  skips integer NOT NULL DEFAULT 0,
  outcomes jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dialer_session_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES dialer_sessions(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  disposition text,
  phone text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dialer_sessions_agent_started
  ON dialer_sessions (agent_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialer_session_events_session
  ON dialer_session_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dialer_session_events_lead
  ON dialer_session_events (lead_id, created_at DESC);
ALTER TABLE dialer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialer_session_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on dialer_sessions" ON dialer_sessions;
CREATE POLICY "Service role full access on dialer_sessions"
  ON dialer_sessions FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated read on dialer_sessions" ON dialer_sessions;
CREATE POLICY "Authenticated read on dialer_sessions"
  ON dialer_sessions FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role full access on dialer_session_events" ON dialer_session_events;
CREATE POLICY "Service role full access on dialer_session_events"
  ON dialer_session_events FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated read on dialer_session_events" ON dialer_session_events;
CREATE POLICY "Authenticated read on dialer_session_events"
  ON dialer_session_events FOR SELECT
  USING (auth.role() = 'authenticated');
