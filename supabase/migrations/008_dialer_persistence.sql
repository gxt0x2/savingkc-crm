-- 008: Dialer persistence
-- Per-agent dialer defaults and reusable saved calling queues.

CREATE TABLE IF NOT EXISTS dialer_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name text NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'power',
  lines_per_agent integer NOT NULL DEFAULT 1,
  seconds_between_calls integer NOT NULL DEFAULT 18,
  abandon_rate_limit integer NOT NULL DEFAULT 3,
  voicemail_drop boolean NOT NULL DEFAULT true,
  recording boolean NOT NULL DEFAULT true,
  auto_tagging boolean NOT NULL DEFAULT true,
  local_presence boolean NOT NULL DEFAULT true,
  skip_dnc boolean NOT NULL DEFAULT true,
  respect_quiet_hours boolean NOT NULL DEFAULT true,
  require_outcome boolean NOT NULL DEFAULT true,
  daily_goal integer NOT NULL DEFAULT 80,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dialer_saved_queues (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  queue_key text NOT NULL DEFAULT 'custom',
  campaign text NOT NULL DEFAULT 'All sources',
  status_filter text NOT NULL DEFAULT 'Any status',
  priority_filter text NOT NULL DEFAULT 'Any priority',
  min_score integer NOT NULL DEFAULT 0,
  search text NOT NULL DEFAULT '',
  owner_agent text,
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (name, owner_agent)
);
CREATE INDEX IF NOT EXISTS idx_dialer_saved_queues_active
  ON dialer_saved_queues (is_active, owner_agent, updated_at DESC);
ALTER TABLE dialer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialer_saved_queues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on dialer_settings" ON dialer_settings;
CREATE POLICY "Service role full access on dialer_settings"
  ON dialer_settings FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated read on dialer_settings" ON dialer_settings;
CREATE POLICY "Authenticated read on dialer_settings"
  ON dialer_settings FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Service role full access on dialer_saved_queues" ON dialer_saved_queues;
CREATE POLICY "Service role full access on dialer_saved_queues"
  ON dialer_saved_queues FOR ALL
  USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Authenticated read on dialer_saved_queues" ON dialer_saved_queues;
CREATE POLICY "Authenticated read on dialer_saved_queues"
  ON dialer_saved_queues FOR SELECT
  USING (auth.role() = 'authenticated');
INSERT INTO dialer_saved_queues (
  name,
  description,
  queue_key,
  owner_agent,
  created_by
) VALUES
  ('Today follow-ups', 'Due and overdue callbacks from ARI tasks', 'followups_today', null, 'system'),
  ('Warm seller follow-ups', 'Hot, high-priority, contacted, and qualified sellers', 'warm_followups', null, 'system'),
  ('2-year tax delinquent', 'Owners around the two-year delinquency mark', 'tax_2yr', null, 'system'),
  ('3+ year deceased tax', 'Deceased-owner records with deeper tax distress', 'deceased_3yr', null, 'system'),
  ('Cold prospecting', 'New or unworked callable leads', 'cold_prospecting', null, 'system')
ON CONFLICT (name, owner_agent) DO NOTHING;
