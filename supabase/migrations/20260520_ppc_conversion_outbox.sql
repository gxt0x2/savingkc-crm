-- Durable queue for PPC conversions that need server-side/offline export.
-- The web tags can fire immediately, but this table is the recoverable source
-- for later Google Ads / server-GTM imports.

CREATE TABLE IF NOT EXISTS public.ppc_conversion_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT 'google_ads',
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  optimization_role TEXT NOT NULL DEFAULT 'secondary',
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  manifest_id UUID REFERENCES public.manifests(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  conversion_value NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  click_id TEXT,
  click_id_type TEXT,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ppc_conversion_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter', 'skipped')),
  CONSTRAINT ppc_conversion_outbox_category_check
    CHECK (event_category IN ('form', 'call', 'appointment', 'phone')),
  CONSTRAINT ppc_conversion_outbox_optimization_role_check
    CHECK (optimization_role IN ('primary', 'secondary', 'diagnostic')),
  CONSTRAINT ppc_conversion_outbox_click_id_type_check
    CHECK (click_id_type IS NULL OR click_id_type IN ('gclid', 'gbraid', 'wbraid'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_conversion_outbox_dedupe
  ON public.ppc_conversion_outbox(destination, event_name, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_ppc_conversion_outbox_pending
  ON public.ppc_conversion_outbox(status, event_time)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_ppc_conversion_outbox_lead_id
  ON public.ppc_conversion_outbox(lead_id);

CREATE INDEX IF NOT EXISTS idx_ppc_conversion_outbox_click_id
  ON public.ppc_conversion_outbox(click_id)
  WHERE click_id IS NOT NULL;

DROP TRIGGER IF EXISTS ppc_conversion_outbox_updated_at ON public.ppc_conversion_outbox;
CREATE TRIGGER ppc_conversion_outbox_updated_at
  BEFORE UPDATE ON public.ppc_conversion_outbox
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.ppc_conversion_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.ppc_conversion_outbox;
CREATE POLICY "Authenticated full access"
  ON public.ppc_conversion_outbox
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.ppc_conversion_outbox;
CREATE POLICY "Service role full access"
  ON public.ppc_conversion_outbox
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
