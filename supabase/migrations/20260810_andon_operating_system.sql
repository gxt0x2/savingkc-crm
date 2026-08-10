-- Structured Andon intake and root-cause analysis.
-- The application retains a legacy-write fallback until this migration reaches every environment.

ALTER TABLE feedback_submissions
  ADD COLUMN IF NOT EXISTS issue_kind TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS five_whys JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE feedback_submissions
SET issue_kind = CASE
  WHEN type = 'bug' THEN 'system'
  WHEN type = 'feature' THEN 'improvement'
  ELSE 'data'
END
WHERE issue_kind IS NULL;

UPDATE feedback_submissions
SET department = COALESCE(NULLIF(split_part(section, ' · ', 1), ''), 'Other'),
    category = COALESCE(NULLIF(split_part(section, ' · ', 2), ''), 'General')
WHERE department IS NULL OR category IS NULL;

ALTER TABLE feedback_submissions
  ALTER COLUMN issue_kind SET NOT NULL,
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN category SET NOT NULL;

ALTER TABLE feedback_submissions DROP CONSTRAINT IF EXISTS feedback_submissions_issue_kind_check;
ALTER TABLE feedback_submissions
  ADD CONSTRAINT feedback_submissions_issue_kind_check
  CHECK (issue_kind IN ('process', 'system', 'data', 'improvement'));

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_issue_kind
  ON feedback_submissions(issue_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_department
  ON feedback_submissions(department, created_at DESC);
