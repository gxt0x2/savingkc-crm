-- Bounded, actor-owned Dialer history reads.
-- Runtime writes already normalize actor_email to lowercase.

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_actor_history
  ON public.dialer_sessions (actor_email, updated_at DESC, id DESC)
  WHERE actor_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_attempts_session_history
  ON public.dialer_session_attempts (session_id, created_at DESC, id DESC);
