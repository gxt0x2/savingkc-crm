-- agent_profiles contains authorization and telephony identity fields. All app
-- access goes through authenticated server routes using the service role, so
-- browser sessions must not retain direct table privileges.

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.agent_profiles;
REVOKE ALL PRIVILEGES ON TABLE public.agent_profiles FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.agent_profiles TO service_role;
DROP POLICY IF EXISTS "Service role full access" ON public.agent_profiles;
CREATE POLICY "Service role full access"
  ON public.agent_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
