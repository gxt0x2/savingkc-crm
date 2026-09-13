-- Durable, human-reviewed model output. This enables no outbound transport.
CREATE TABLE public.em_ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  thread_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  content_revision integer NOT NULL,
  controller_revision integer NOT NULL,
  prompt_hash text NOT NULL,
  model text NOT NULL,
  policy_version text NOT NULL,
  input_snapshot jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','running','ready','stale','failed')),
  claim_id uuid,
  output jsonb,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,8),
  reserved_cost_usd numeric(12,8) NOT NULL DEFAULT 0.02 CHECK(reserved_cost_usd=0.02),
  provider_generation_id text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id)
);
CREATE INDEX em_ai_generations_thread ON public.em_ai_generations(workspace_id,thread_id,created_at DESC);
CREATE INDEX em_ai_generations_budget ON public.em_ai_generations(workspace_id,created_at);
ALTER TABLE public.em_ai_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_ai_generations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.em_ai_generations TO service_role;
