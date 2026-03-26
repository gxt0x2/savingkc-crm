-- ROL-01: Role Registry
-- ROL-02 + ROL-03: Role KPI Definitions
-- ROL-04: System Worker Registry
-- Night 4 Phase 4: Roles & Accountability Foundation

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  kpi_targets JSONB, -- KPI definitions and targets for this role
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users table modification (add role_id if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role_id'
  ) THEN
    ALTER TABLE users ADD COLUMN role_id UUID REFERENCES roles(id);
  END IF;
END $$;

-- System workers table (for monitoring automation health)
CREATE TABLE IF NOT EXISTS system_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL, -- 'poller', 'cron', 'webhook', 'enrichment', 'sync'
  description TEXT,
  check_interval_minutes INTEGER NOT NULL DEFAULT 15,
  last_run TIMESTAMP,
  last_success TIMESTAMP,
  last_error TEXT,
  failure_count_24h INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
  metadata JSONB, -- worker-specific config (endpoint URL, credentials ref, etc.)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_system_workers_status ON system_workers(status);
CREATE INDEX IF NOT EXISTS idx_system_workers_last_run ON system_workers(last_run DESC);

-- Seed default roles
INSERT INTO roles (name, description, kpi_targets) VALUES
(
  'Owner/Operator',
  'Deal decisions, offer approvals, financial oversight, pipeline review',
  '{
    "deals_reviewed_24h_pct": 100,
    "offer_approval_turnaround_hours": 4,
    "weekly_pipeline_review": "weekly",
    "monthly_revenue_target": 15000,
    "deals_closed_per_month": 2
  }'::jsonb
),
(
  'Acquisition Agent',
  'Outbound calling, lead qualification, follow-ups, dispositions',
  '{
    "daily_call_volume": 50,
    "meaningful_conversation_rate_pct": 10,
    "disposition_logging_rate_pct": 100,
    "followup_completion_rate_pct": 95,
    "pillar_capture_rate_pct": 80,
    "leads_qualified_per_week": 5,
    "appointments_set_per_week": 2
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Seed system workers
INSERT INTO system_workers (name, type, description, check_interval_minutes, status, metadata) VALUES
(
  'Mojo Sync',
  'poller',
  'Polls Mojo Dialer API every 15 minutes for call data, talk time, recordings',
  15,
  'unknown',
  '{
    "endpoint": "/api/mojo-kpis",
    "data_source": "~/.openclaw/workspace/memory/mojo-calls-*.json",
    "active_hours": "8am-5pm CT"
  }'::jsonb
),
(
  'Ari Briefing Poll',
  'poller',
  'Polls for new Ari briefing events every 20 seconds',
  1,
  'unknown',
  '{
    "endpoint": "ari_briefing_events table",
    "poll_interval_seconds": 20
  }'::jsonb
),
(
  'Follow-Up Sequence Runner',
  'cron',
  'Executes scheduled follow-up tasks based on sequences',
  60,
  'unknown',
  '{
    "runs": "hourly",
    "checks": "lead_activities WHERE type=task AND status=pending"
  }'::jsonb
),
(
  'Stage Timeout Checker',
  'cron',
  'Flags leads that have exceeded expected time in current stage',
  360,
  'unknown',
  '{
    "runs": "every 6 hours",
    "timeout_thresholds": {
      "qualifying": 7,
      "negotiations": 14,
      "appt_set": 3
    }
  }'::jsonb
),
(
  'Ghost Protocol Detector',
  'cron',
  'Identifies leads going dark and enrolls them in ghost protocol',
  1440,
  'unknown',
  '{
    "runs": "daily",
    "criteria": "Stage 2+, 2+ unanswered attempts, 7+ days silent"
  }'::jsonb
),
(
  'Dead Lead Recycler',
  'cron',
  'Re-evaluates leads dead for 90/180 days with fresh data checks',
  10080,
  'unknown',
  '{
    "runs": "weekly",
    "thresholds": [90, 180],
    "auto_recycle": false
  }'::jsonb
),
(
  'Temperature Change Detector',
  'cron',
  'Scans all leads for temperature changes and generates alerts',
  1440,
  'unknown',
  '{
    "runs": "daily",
    "generates": "ari_briefing_events"
  }'::jsonb
),
(
  'Twilio Webhook (Inbound SMS)',
  'webhook',
  'Receives inbound SMS from Twilio and logs to lead_activities',
  null,
  'unknown',
  '{
    "endpoint": "/api/twilio-sms-webhook",
    "public_url": "https://crm.savingkc.com/api/twilio-sms-webhook"
  }'::jsonb
),
(
  'Twilio Webhook (Missed Call)',
  'webhook',
  'Receives missed call events from Twilio and executes missed call flow',
  null,
  'unknown',
  '{
    "endpoint": "/api/twilio-missed-call",
    "public_url": "https://crm.savingkc.com/api/twilio-missed-call"
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- Function to update worker status based on health checks
CREATE OR REPLACE FUNCTION update_worker_status()
RETURNS TRIGGER AS $$
DECLARE
  expected_interval_ms BIGINT;
  time_since_last_success_ms BIGINT;
  time_since_last_run_ms BIGINT;
BEGIN
  expected_interval_ms := NEW.check_interval_minutes * 60 * 1000;

  -- Calculate time since last success
  IF NEW.last_success IS NOT NULL THEN
    time_since_last_success_ms := EXTRACT(EPOCH FROM (NOW() - NEW.last_success)) * 1000;
  ELSE
    time_since_last_success_ms := NULL;
  END IF;

  -- Calculate time since last run
  IF NEW.last_run IS NOT NULL THEN
    time_since_last_run_ms := EXTRACT(EPOCH FROM (NOW() - NEW.last_run)) * 1000;
  ELSE
    time_since_last_run_ms := NULL;
  END IF;

  -- Determine status
  IF NEW.failure_count_24h >= 3 THEN
    NEW.status := 'degraded';
  ELSIF time_since_last_success_ms IS NOT NULL AND time_since_last_success_ms > (expected_interval_ms * 2) THEN
    NEW.status := 'down';
  ELSIF time_since_last_run_ms IS NOT NULL AND time_since_last_run_ms < (expected_interval_ms * 1.5) THEN
    NEW.status := 'healthy';
  ELSE
    NEW.status := 'unknown';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_worker_status
  BEFORE INSERT OR UPDATE ON system_workers
  FOR EACH ROW
  EXECUTE FUNCTION update_worker_status();

COMMENT ON TABLE roles IS 'Defines user roles with KPI targets for accountability tracking';
COMMENT ON TABLE system_workers IS 'Monitors automated workers (cron, pollers, webhooks) for health and uptime';
COMMENT ON COLUMN roles.kpi_targets IS 'JSON object with KPI names and target values for this role';
COMMENT ON COLUMN system_workers.check_interval_minutes IS 'Expected interval between runs (null for webhooks)';
COMMENT ON COLUMN system_workers.failure_count_24h IS 'Number of failures in last 24 hours';
COMMENT ON COLUMN system_workers.status IS 'healthy (running), degraded (3+ failures), down (last_success > 2x interval), unknown';
