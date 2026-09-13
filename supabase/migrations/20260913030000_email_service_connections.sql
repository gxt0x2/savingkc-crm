-- Private credential candidates. No connection can enable dispatch on its own.
CREATE TABLE public.em_service_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  created_by uuid NOT NULL,
  request_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  provider text NOT NULL CHECK (provider = 'resend'),
  account_label text NOT NULL,
  masked_secret text NOT NULL,
  encrypted_secret jsonb,
  state text NOT NULL CHECK (state IN ('checking','checked','failed','revoked')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_code text,
  workspace_revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  UNIQUE(workspace_id,created_by,request_id),
  UNIQUE(workspace_id,id)
);
CREATE INDEX em_service_connections_workspace ON public.em_service_connections(workspace_id,created_at DESC);
ALTER TABLE public.em_service_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_service_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.em_service_connections TO service_role;
