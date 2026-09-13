-- Private Resend endpoint bindings; no secret or payload is exposed to browser roles.
CREATE TABLE public.em_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  connection_id uuid NOT NULL,
  encrypted_secret jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.em_service_connections(workspace_id,id)
);
CREATE TABLE public.em_reply_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  connection_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  address text NOT NULL CHECK(address=lower(address) AND position('@' in address)>1),
  UNIQUE(connection_id,address),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.em_service_connections(workspace_id,id)
);
ALTER TABLE public.em_provider_events ADD COLUMN encrypted_payload jsonb;
ALTER TABLE public.em_provider_events ADD COLUMN endpoint_id uuid REFERENCES public.em_webhook_endpoints(id);
ALTER TABLE public.em_provider_events ADD COLUMN provider_email_id uuid;
ALTER TABLE public.em_provider_events ADD COLUMN provider_created_at timestamptz;
ALTER TABLE public.em_provider_events ADD COLUMN hold_reason text;
ALTER TABLE public.em_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_reply_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_webhook_endpoints,public.em_reply_aliases FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.em_webhook_endpoints,public.em_reply_aliases TO service_role;

ALTER TABLE public.em_threads ADD COLUMN inbound_pending boolean NOT NULL DEFAULT false;
