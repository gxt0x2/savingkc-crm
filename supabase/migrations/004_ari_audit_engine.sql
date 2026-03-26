-- ARI CRM - Ari Audit Engine Tables
-- Night 5 Phase 1: AUD-01 through AUD-06
-- Quality control, compliance checking, coaching nudges

-- Audit Findings Table (AUD-01)
CREATE TABLE IF NOT EXISTS ari_audit_findings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_type TEXT NOT NULL, -- 'missing_disposition', 'stage_timeout', 'overdue_task', 'requirement_violation', 'duplicate', 'orphan', 'workflow_compliance', 'data_freshness'
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  description TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  agent_id TEXT, -- Agent responsible (if applicable)
  metadata JSONB DEFAULT '{}', -- Additional context
  resolved BOOLEAN DEFAULT FALSE NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ari_audit_findings_severity ON ari_audit_findings(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ari_audit_findings_resolved ON ari_audit_findings(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ari_audit_findings_lead ON ari_audit_findings(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ari_audit_findings_agent ON ari_audit_findings(agent_id) WHERE agent_id IS NOT NULL;

-- Coaching Nudges Table (AUD-06)
CREATE TABLE IF NOT EXISTS ari_nudges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL,
  nudge_type TEXT NOT NULL, -- 'disposition_rate_low', 'conversation_rate_low', 'followup_rate_low', 'specific_lead_missed'
  message TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  acknowledged BOOLEAN DEFAULT FALSE NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Prevent spam: only one nudge of same type per agent per day
  UNIQUE(agent_id, nudge_type, created_at::date)
);

CREATE INDEX IF NOT EXISTS idx_ari_nudges_agent ON ari_nudges(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ari_nudges_unacknowledged ON ari_nudges(agent_id, acknowledged) WHERE acknowledged = FALSE;

-- Feedback Submissions Table (FBK-01)
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'feedback')),
  section TEXT NOT NULL, -- 'Leads', 'Pipeline', 'Conversations', 'Calendar', 'Dashboard', 'Ari', 'Settings', 'Integrations', 'Other'
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in_progress', 'testing', 'resolved', 'closed')),
  -- Auto-captured fields
  page_url TEXT,
  user_agent TEXT,
  agent_id TEXT,
  agent_name TEXT,
  screenshot_url TEXT,
  -- Status workflow
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status ON feedback_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_type ON feedback_submissions(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_section ON feedback_submissions(section);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_agent ON feedback_submissions(agent_id);

-- Error Log Table (FBK-02)
CREATE TABLE IF NOT EXISTS error_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  error_type TEXT NOT NULL, -- 'frontend_crash', 'api_failure', 'timeout', 'validation_error'
  message TEXT NOT NULL,
  stack_trace TEXT,
  page_url TEXT,
  agent_id TEXT,
  agent_name TEXT,
  request_details JSONB, -- For API errors: endpoint, method, status_code, response
  resolved BOOLEAN DEFAULT FALSE NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_log_error_type ON error_log(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_resolved ON error_log(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_agent ON error_log(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_log_created_date ON error_log(created_at::date DESC);

-- Comments table for feedback/error items (FBK-04)
CREATE TABLE IF NOT EXISTS feedback_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id UUID REFERENCES feedback_submissions(id) ON DELETE CASCADE,
  error_id UUID REFERENCES error_log(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK ((feedback_id IS NOT NULL AND error_id IS NULL) OR (feedback_id IS NULL AND error_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback ON feedback_comments(feedback_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_error ON feedback_comments(error_id, created_at);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_feedback_submissions_updated_at
  BEFORE UPDATE ON feedback_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE ari_audit_findings IS 'Stores data quality, compliance, and workflow violations detected by Ari audit engine';
COMMENT ON TABLE ari_nudges IS 'Stores coaching nudges sent to agents when patterns are detected (max 1 per type per day)';
COMMENT ON TABLE feedback_submissions IS 'Agent-submitted bug reports, feature requests, and feedback';
COMMENT ON TABLE error_log IS 'Auto-captured frontend crashes, API failures, and system errors';
COMMENT ON TABLE feedback_comments IS 'Comment thread for feedback items and errors';
