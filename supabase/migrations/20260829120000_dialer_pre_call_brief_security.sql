-- Pre-call briefs are assembled server-side. Historical briefing and co-owner
-- context must not remain directly readable or writable by browser roles.

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated full access" ON public.briefings;
DROP POLICY IF EXISTS "Service role full access" ON public.briefings;
REVOKE ALL ON TABLE public.briefings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.briefings TO service_role;
CREATE POLICY "Service role full access" ON public.briefings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.lead_co_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated full access" ON public.lead_co_owners;
DROP POLICY IF EXISTS "Service role full access" ON public.lead_co_owners;
REVOKE ALL ON TABLE public.lead_co_owners FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lead_co_owners TO service_role;
CREATE POLICY "Service role full access" ON public.lead_co_owners
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.briefings IS
  'Server-only historical AI lead briefings. Dialer reads them through an authenticated, bounded pre-call endpoint.';
