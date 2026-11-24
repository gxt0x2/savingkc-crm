-- G6: deal outcomes carry the full source, and contract / close conversions
-- can be queued for Google Ads.
--
-- crm_marketing_outcomes stored only leads.source. These columns record the
-- first touch, whether an ad click is on the journey, the visit count and the
-- days from first visit to lead. A BEFORE INSERT OR UPDATE trigger fills them
-- from leads.attribution and the linked tracking events, so every writer
-- (crm_record_marketing_outcome_v1, funded close) is covered. Existing rows
-- are backfilled.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

ALTER TABLE public.crm_marketing_outcomes
  ADD COLUMN IF NOT EXISTS first_touch_source text,
  ADD COLUMN IF NOT EXISTS first_touch_medium text,
  ADD COLUMN IF NOT EXISTS first_touch_campaign text,
  ADD COLUMN IF NOT EXISTS had_ad_click boolean,
  ADD COLUMN IF NOT EXISTS visit_count integer,
  ADD COLUMN IF NOT EXISTS days_first_touch_to_lead integer;

CREATE OR REPLACE FUNCTION public.crm_marketing_outcome_fill_source_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_attr jsonb;
  lead_created timestamptz;
  first_event timestamptz;
  sessions integer;
  ad_click boolean;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT l.attribution, l.created_at INTO lead_attr, lead_created
  FROM public.leads l WHERE l.id = NEW.lead_id;

  SELECT min(e.event_time),
         count(DISTINCT e.session_id),
         bool_or(e.gclid IS NOT NULL OR e.gbraid IS NOT NULL OR e.wbraid IS NOT NULL)
    INTO first_event, sessions, ad_click
  FROM public.ppc_tracking_events e
  WHERE e.lead_id = NEW.lead_id AND COALESCE(e.is_test, false) = false;

  NEW.first_touch_source := COALESCE(NULLIF(lead_attr->'first_touch'->>'source', ''), NEW.first_touch_source);
  NEW.first_touch_medium := COALESCE(NULLIF(lead_attr->'first_touch'->>'medium', ''), NEW.first_touch_medium);
  NEW.first_touch_campaign := COALESCE(NULLIF(lead_attr->'first_touch'->>'campaign', ''), NEW.first_touch_campaign);
  NEW.had_ad_click := COALESCE(ad_click, false)
    OR COALESCE(lead_attr->'first_touch'->>'gclid', '') <> ''
    OR COALESCE(lead_attr->'first_touch'->>'source', '') = 'google' AND COALESCE(lead_attr->'first_touch'->>'medium', '') = 'cpc';
  NEW.visit_count := COALESCE(sessions, 0);
  NEW.days_first_touch_to_lead := CASE
    WHEN first_event IS NOT NULL AND lead_created IS NOT NULL
      THEN greatest(0, floor(extract(epoch FROM (lead_created - first_event)) / 86400))::integer
    ELSE NULL END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_marketing_outcome_fill_source_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_marketing_outcomes_fill_source ON public.crm_marketing_outcomes;
CREATE TRIGGER crm_marketing_outcomes_fill_source
  BEFORE INSERT OR UPDATE ON public.crm_marketing_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.crm_marketing_outcome_fill_source_v1();

-- Backfill: touching each row runs the trigger.
UPDATE public.crm_marketing_outcomes SET lead_id = lead_id;

-- Contract signed and deal closed are queued with category 'deal'.
ALTER TABLE public.ppc_conversion_outbox DROP CONSTRAINT IF EXISTS ppc_conversion_outbox_category_check;
ALTER TABLE public.ppc_conversion_outbox ADD CONSTRAINT ppc_conversion_outbox_category_check
  CHECK (event_category = ANY (ARRAY['form'::text, 'call'::text, 'appointment'::text, 'phone'::text, 'deal'::text]));
