-- Durable, actor-scoped post-call AI review state for Dialer attempts.
-- The transcript remains in lead_activities/manifest storage; this projection
-- keeps only the bounded review needed by the disposition and session-history
-- surfaces.

ALTER TABLE public.dialer_session_attempts
  ADD COLUMN IF NOT EXISTS provider_call_sid text,
  ADD COLUMN IF NOT EXISTS recording_sid text,
  ADD COLUMN IF NOT EXISTS post_call_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS post_call_summary text,
  ADD COLUMN IF NOT EXISTS post_call_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS post_call_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_call_updated_at timestamptz;

ALTER TABLE public.dialer_session_attempts
  DROP CONSTRAINT IF EXISTS dialer_attempts_post_call_status_valid,
  ADD CONSTRAINT dialer_attempts_post_call_status_valid
    CHECK (post_call_status IN ('not_requested', 'processing', 'ready', 'unavailable', 'skipped')),
  DROP CONSTRAINT IF EXISTS dialer_attempts_post_call_snapshot_object,
  ADD CONSTRAINT dialer_attempts_post_call_snapshot_object
    CHECK (jsonb_typeof(post_call_snapshot) = 'object');

-- Support the small operational queue used to spot processing failures. The
-- actor/session history paths continue to use their existing keyset indexes.
CREATE INDEX IF NOT EXISTS idx_dialer_attempts_post_call_attention
  ON public.dialer_session_attempts (post_call_updated_at DESC, id DESC)
  WHERE post_call_status IN ('processing', 'unavailable');

