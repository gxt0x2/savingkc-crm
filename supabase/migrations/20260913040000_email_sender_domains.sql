CREATE TABLE public.em_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  connection_id uuid NOT NULL,
  name_ascii text NOT NULL,
  provider_domain_id uuid,
  brand_url text NOT NULL,
  state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','needs_dns','provider_verified','uncertain','held')),
  sending_state text NOT NULL DEFAULT 'unknown',
  receiving_state text NOT NULL DEFAULT 'unknown',
  dns_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  paused boolean NOT NULL DEFAULT true,
  failure_code text,
  check_token uuid,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  last_checked_at timestamptz,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,name_ascii),
  FOREIGN KEY(workspace_id,connection_id) REFERENCES public.em_service_connections(workspace_id,id)
);
CREATE TABLE public.em_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  domain_id uuid NOT NULL,
  from_name text NOT NULL,
  local_part text NOT NULL,
  signature text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'paused' CHECK(state IN ('active','paused','retired')),
  hourly_limit integer NOT NULL CHECK(hourly_limit>0),
  daily_limit integer NOT NULL CHECK(daily_limit>=hourly_limit),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(domain_id,local_part),
  FOREIGN KEY(workspace_id,domain_id) REFERENCES public.em_domains(workspace_id,id)
);
ALTER TABLE public.em_threads ADD COLUMN sender_id uuid;
ALTER TABLE public.em_threads ADD CONSTRAINT em_threads_sender_fk FOREIGN KEY(workspace_id,sender_id) REFERENCES public.em_senders(workspace_id,id);
ALTER TABLE public.em_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_senders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_domains,public.em_senders FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.em_domains,public.em_senders TO service_role;
