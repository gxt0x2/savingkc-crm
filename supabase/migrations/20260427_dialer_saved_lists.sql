-- Persist dialer smart lists so agents can reuse the same queues across
-- browsers and devices.

CREATE TABLE IF NOT EXISTS dialer_saved_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'Team',
  preset TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT 'all',
  status_filter TEXT NOT NULL DEFAULT 'all',
  priority_filter TEXT NOT NULL DEFAULT 'all',
  min_motivation INTEGER NOT NULL DEFAULT 0 CHECK (min_motivation BETWEEN 0 AND 10),
  search TEXT NOT NULL DEFAULT '',
  sort_by TEXT NOT NULL DEFAULT 'recommended',
  visible_limit INTEGER NOT NULL DEFAULT 25 CHECK (visible_limit IN (25, 50, 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_saved_lists_agent ON dialer_saved_lists(agent);
CREATE INDEX IF NOT EXISTS idx_dialer_saved_lists_updated_at ON dialer_saved_lists(updated_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dialer_saved_lists_updated_at ON dialer_saved_lists;
CREATE TRIGGER dialer_saved_lists_updated_at
  BEFORE UPDATE ON dialer_saved_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
