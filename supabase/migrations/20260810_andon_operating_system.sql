-- SavingKC Andon operating system.
-- This migration is intentionally self-contained because some environments
-- never received the older ARI audit migration that introduced these tables.

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'feedback')),
  section TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'in_progress', 'testing', 'resolved', 'closed')),
  page_url TEXT,
  user_agent TEXT,
  agent_id TEXT,
  agent_name TEXT,
  screenshot_url TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.error_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  page_url TEXT,
  agent_id TEXT,
  agent_name TEXT,
  request_details JSONB,
  five_whys JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee TEXT,
  estimated_resolution_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS issue_kind TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS five_whys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS record_id TEXT,
  ADD COLUMN IF NOT EXISTS record_type TEXT,
  ADD COLUMN IF NOT EXISTS record_url TEXT,
  ADD COLUMN IF NOT EXISTS assignee TEXT,
  ADD COLUMN IF NOT EXISTS estimated_resolution_at TIMESTAMPTZ;

ALTER TABLE public.error_log
  ADD COLUMN IF NOT EXISTS five_whys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assignee TEXT,
  ADD COLUMN IF NOT EXISTS estimated_resolution_at TIMESTAMPTZ;

UPDATE public.feedback_submissions
SET issue_kind = CASE
  WHEN type = 'bug' THEN 'system'
  WHEN type = 'feature' THEN 'improvement'
  ELSE 'data'
END
WHERE issue_kind IS NULL;

UPDATE public.feedback_submissions
SET department = COALESCE(NULLIF(split_part(section, ' · ', 1), ''), 'Acquisitions'),
    category = COALESCE(NULLIF(split_part(section, ' · ', 2), ''), 'AI Text Bot Sequence'),
    record_url = COALESCE(record_url, page_url)
WHERE department IS NULL OR category IS NULL OR record_url IS NULL;

ALTER TABLE public.feedback_submissions
  ALTER COLUMN issue_kind SET NOT NULL,
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE public.feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_issue_kind_check;
ALTER TABLE public.feedback_submissions
  ADD CONSTRAINT feedback_submissions_issue_kind_check
  CHECK (issue_kind IN ('process', 'system', 'data', 'improvement', 'ai_glitch'));

ALTER TABLE public.feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_record_type_check;
ALTER TABLE public.feedback_submissions
  ADD CONSTRAINT feedback_submissions_record_type_check
  CHECK (record_type IS NULL OR record_type IN ('lead', 'property'));

CREATE OR REPLACE FUNCTION public.set_andon_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_feedback_submissions_updated_at ON public.feedback_submissions;
CREATE TRIGGER trigger_feedback_submissions_updated_at
  BEFORE UPDATE ON public.feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_andon_updated_at();

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status
  ON public.feedback_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_issue_kind
  ON public.feedback_submissions(issue_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_department
  ON public.feedback_submissions(department, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_record
  ON public.feedback_submissions(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_assignee
  ON public.feedback_submissions(assignee, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_eta
  ON public.feedback_submissions(estimated_resolution_at)
  WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS idx_error_log_resolved
  ON public.error_log(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_assignee
  ON public.error_log(assignee, resolved, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.error_log TO service_role;

COMMENT ON TABLE public.feedback_submissions IS 'SavingKC Andons from signal through verified resolution';
COMMENT ON TABLE public.error_log IS 'Automatically captured CRM system errors surfaced in the Andon queue';

NOTIFY pgrst, 'reload schema';
