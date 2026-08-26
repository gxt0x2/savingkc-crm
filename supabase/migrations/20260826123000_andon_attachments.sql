-- Private supporting evidence for SavingKC Andons.
-- Files are uploaded directly to Supabase Storage through short-lived signed
-- upload tokens; metadata stays linked to the Andon lifecycle record.

CREATE TABLE IF NOT EXISTS public.feedback_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id UUID NOT NULL REFERENCES public.feedback_submissions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback
  ON public.feedback_attachments(feedback_id, created_at ASC);

ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON TABLE public.feedback_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('andon-attachments', 'andon-attachments', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

COMMENT ON TABLE public.feedback_attachments IS 'Private screenshots, media, voice memos, and documents attached to SavingKC Andons';

NOTIFY pgrst, 'reload schema';
