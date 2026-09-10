-- Restricted immutable evidence for reviewed corrections. This migration does
-- not alter a call, lead, task, proposal or recording.
CREATE TABLE public.mojo_evidence_corrections (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  actor text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  source_evidence jsonb NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL
);
ALTER TABLE public.mojo_evidence_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mojo_evidence_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mojo_evidence_corrections TO service_role;
