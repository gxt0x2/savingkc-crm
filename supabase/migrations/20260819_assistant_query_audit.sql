-- Append-only observability for SavingKC Assistant reads. This table stores
-- action metadata only; prompts, responses, seller PII, and tool payloads are
-- intentionally excluded.

CREATE TABLE IF NOT EXISTS public.assistant_query_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email TEXT NOT NULL,
  actor_access TEXT NOT NULL CHECK (actor_access IN ('owner', 'admin', 'agent')),
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  thread_id TEXT,
  success BOOLEAN NOT NULL,
  result_count INTEGER,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_query_audit_actor_time
  ON public.assistant_query_audit(actor_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_query_audit_action_time
  ON public.assistant_query_audit(action, created_at DESC);

ALTER TABLE public.assistant_query_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can append assistant audit" ON public.assistant_query_audit;
CREATE POLICY "Service role can append assistant audit"
  ON public.assistant_query_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can read assistant audit" ON public.assistant_query_audit;
CREATE POLICY "Service role can read assistant audit"
  ON public.assistant_query_audit
  FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE public.assistant_query_audit IS
  'Metadata-only audit of permissioned SavingKC Assistant reads. Does not store prompts, responses, or seller PII.';
