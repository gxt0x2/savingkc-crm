-- agent_profiles contains authorization and telephony identity fields. All app
-- access goes through authenticated server routes using the service role, so
-- browser sessions must not retain direct table privileges.

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.agent_profiles;
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.agent_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.agent_profiles;
DROP POLICY IF EXISTS "authenticated_all" ON public.agent_profiles;
REVOKE ALL PRIVILEGES ON TABLE public.agent_profiles FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.agent_profiles TO service_role;
DROP POLICY IF EXISTS "Service role full access" ON public.agent_profiles;
CREATE POLICY "Service role full access"
  ON public.agent_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'agent_profiles'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'agent_profiles still grants browser-accessible table privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_profiles'
      AND (
        'public' = ANY (roles)
        OR 'anon' = ANY (roles)
        OR 'authenticated' = ANY (roles)
      )
  ) THEN
    RAISE EXCEPTION 'agent_profiles still has browser-accessible RLS policies';
  END IF;
END
$$;
