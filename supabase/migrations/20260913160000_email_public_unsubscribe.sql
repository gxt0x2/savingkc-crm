ALTER TABLE public.em_suppressions ALTER COLUMN created_by DROP NOT NULL;
COMMENT ON COLUMN public.em_suppressions.created_by IS 'Null for recipient initiated public unsubscribe; never attributed to a team member.';
CREATE TABLE public.em_preference_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  address_id uuid NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_used_at timestamptz,
  FOREIGN KEY (workspace_id,address_id) REFERENCES public.em_addresses(workspace_id,id),
  FOREIGN KEY (workspace_id,issued_by) REFERENCES public.em_memberships(workspace_id,auth_user_id)
);
ALTER TABLE public.em_preference_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_preference_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.em_preference_tokens TO service_role;
