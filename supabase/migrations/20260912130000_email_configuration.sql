-- CRM-owned Email workspace configuration. This migration is additive and is
-- intentionally shipped disabled: no outbound dispatch is enabled by default.

CREATE TABLE IF NOT EXISTS public.em_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  send_enabled boolean NOT NULL DEFAULT false,
  ai_auto_enabled boolean NOT NULL DEFAULT false,
  pause_reason text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  setup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.em_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL,
  agent_profile_id uuid REFERENCES public.agent_profiles(id) ON DELETE SET NULL,
  roles text[] NOT NULL DEFAULT ARRAY['reader']::text[] CHECK (
    cardinality(roles) BETWEEN 1 AND 5 AND roles <@ ARRAY['owner','marketer','reviewer','acquisitions','reader']::text[]
  ),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, auth_user_id)
);

CREATE TABLE IF NOT EXISTS public.em_setup_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 10),
  state text NOT NULL DEFAULT 'not_started' CHECK (state IN ('not_started','in_progress','waiting','complete','blocked')),
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, step)
);

CREATE TABLE IF NOT EXISTS public.em_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL CHECK (char_length(trim(action)) BETWEEN 1 AND 100),
  entity_id uuid NOT NULL,
  request_id uuid NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- This is deliberately a hold, not a reassignment to AI. The thread/handoff
-- packet consumes these records and resolves each affected item explicitly.
CREATE TABLE IF NOT EXISTS public.em_membership_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE CASCADE,
  removed_auth_user_id uuid NOT NULL,
  backup_auth_user_id uuid,
  affected_work_hash text NOT NULL CHECK (char_length(trim(affected_work_hash)) >= 8),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','assigned','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.em_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  command text NOT NULL CHECK (char_length(trim(command)) BETWEEN 1 AND 100),
  payload_hash text NOT NULL CHECK (char_length(trim(payload_hash)) >= 8),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS em_memberships_active_subject_idx ON public.em_memberships (auth_user_id, workspace_id) WHERE active;
CREATE INDEX IF NOT EXISTS em_audit_events_workspace_created_idx ON public.em_audit_events (workspace_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.em_touch_updated_at_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.em_touch_updated_at_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS em_workspaces_touch_updated_at ON public.em_workspaces;
CREATE TRIGGER em_workspaces_touch_updated_at BEFORE UPDATE ON public.em_workspaces FOR EACH ROW EXECUTE FUNCTION public.em_touch_updated_at_v1();
DROP TRIGGER IF EXISTS em_memberships_touch_updated_at ON public.em_memberships;
CREATE TRIGGER em_memberships_touch_updated_at BEFORE UPDATE ON public.em_memberships FOR EACH ROW EXECUTE FUNCTION public.em_touch_updated_at_v1();

ALTER TABLE public.em_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_setup_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_membership_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.em_workspaces, public.em_memberships, public.em_setup_steps, public.em_audit_events, public.em_membership_holds, public.em_command_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.em_workspaces, public.em_memberships, public.em_setup_steps, public.em_audit_events, public.em_membership_holds, public.em_command_receipts TO service_role;

DO $$
DECLARE v_workspace_id uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_profiles' AND column_name = 'email')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_profiles' AND column_name = 'full_name') THEN
    RAISE EXCEPTION 'email configuration requires auth.users and the current CRM agent_profiles email/full_name contract';
  END IF;
  INSERT INTO public.em_workspaces (singleton) VALUES (true) ON CONFLICT (singleton) DO UPDATE SET singleton = EXCLUDED.singleton RETURNING id INTO v_workspace_id;
  INSERT INTO public.em_memberships (workspace_id, auth_user_id, agent_profile_id, roles)
  SELECT v_workspace_id, u.id, p.id, ARRAY['owner']::text[]
  FROM public.agent_profiles p
  JOIN auth.users u ON lower(u.email) = lower(p.email)
  WHERE COALESCE(p.is_admin, false) OR lower(COALESCE(p.role, '')) = 'owner'
  ON CONFLICT (workspace_id, auth_user_id) DO NOTHING;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name IN ('em_workspaces','em_memberships','em_setup_steps','em_audit_events','em_membership_holds','em_command_receipts') AND grantee IN ('PUBLIC','anon','authenticated')) THEN
    RAISE EXCEPTION 'email configuration tables retain browser-accessible privileges';
  END IF;
END $$;
