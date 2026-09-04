-- Andon Google Chat war room metadata.
-- The CRM button remains the Andon cord. Chat is nominated after submit so
-- Robin / the Google Chat assistant can work status, assignee, and notes.

ALTER TABLE public.feedback_submissions
  ADD COLUMN IF NOT EXISTS chat_space_id TEXT,
  ADD COLUMN IF NOT EXISTS chat_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_chat_thread
  ON public.feedback_submissions(chat_thread_id)
  WHERE chat_thread_id IS NOT NULL;

COMMENT ON COLUMN public.feedback_submissions.chat_space_id IS 'Google Chat space resource name nominated after Andon submit (spaces/...)';
COMMENT ON COLUMN public.feedback_submissions.chat_thread_id IS 'Google Chat thread resource name for the Andon war room';
COMMENT ON COLUMN public.feedback_submissions.notes IS 'Scoped Andon work notes from CRM or the Google Chat assistant write API';

NOTIFY pgrst, 'reload schema';
