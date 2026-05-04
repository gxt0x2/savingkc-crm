-- Add caller-number + resume-state support for saved dialer lists.

ALTER TABLE dialer_saved_lists
  ADD COLUMN IF NOT EXISTS caller_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS session_lead_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resume_index INTEGER NOT NULL DEFAULT 0 CHECK (resume_index >= 0),
  ADD COLUMN IF NOT EXISTS resume_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS resume_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_completed BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dialer_saved_lists_session_lead_ids_array_check'
  ) THEN
    ALTER TABLE dialer_saved_lists
      ADD CONSTRAINT dialer_saved_lists_session_lead_ids_array_check
      CHECK (jsonb_typeof(session_lead_ids) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dialer_saved_lists_resume_updated_at
  ON dialer_saved_lists (resume_updated_at DESC NULLS LAST);
