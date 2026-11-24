-- Journey stitching: one timeline per person, from first visit to closed deal.
--
-- Before this, ppc_tracking_events.lead_id was only set by the old /ppc
-- landers. Sitewide journey events (page views, form steps, tools, phone
-- clicks) were never tied to the lead they produced, so the lead record could
-- not show the visits before it, and qualified/appointment conversions could
-- not find the ad click (loadPpcLeadConversionContext reads events by lead_id).
--
-- 1. visitor_id index. The website now sends a one-year first-party
--    visitor_id on every event (skc_vid), next to the per-tab session_id.
-- 2. link_journey_to_lead_v1(lead, session, visitor): called by lead and
--    booking intake. Links unclaimed events from that session, from the
--    visitor id, and from every visitor id seen in that session, so a
--    Monday article read and a Thursday form become one journey.
-- 3. BEFORE INSERT trigger: once a visitor is linked, later events from the
--    same visitor (return visits after the lead) inherit the lead_id.
-- 4. lead_journey_timeline view: web events, lead creation, activities
--    (calls, texts, notes), stage changes, appointments, ad conversions and
--    deal outcomes in one ordered list per lead. Service role only.
-- 5. One-shot backfill for leads that already carry a session_id.
--
-- Never links across leads: only rows whose lead_id is still null are claimed.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

CREATE INDEX IF NOT EXISTS idx_ppc_tracking_events_visitor
  ON public.ppc_tracking_events (visitor_id, event_time DESC)
  WHERE visitor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.link_journey_to_lead_v1(
  p_lead_id uuid,
  p_session_id text DEFAULT NULL,
  p_visitor_id text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session text := NULLIF(btrim(COALESCE(p_session_id, '')), '');
  v_visitor text := NULLIF(btrim(COALESCE(p_visitor_id, '')), '');
  v_count integer := 0;
BEGIN
  IF p_lead_id IS NULL OR (v_session IS NULL AND v_visitor IS NULL) THEN
    RETURN 0;
  END IF;

  WITH visitors AS (
    SELECT DISTINCT e.visitor_id
    FROM public.ppc_tracking_events e
    WHERE v_session IS NOT NULL
      AND e.session_id = v_session
      AND e.visitor_id IS NOT NULL
    UNION
    SELECT v_visitor WHERE v_visitor IS NOT NULL
  ),
  claimed AS (
    UPDATE public.ppc_tracking_events e
    SET lead_id = p_lead_id
    WHERE e.lead_id IS NULL
      AND e.event_time > now() - interval '180 days'
      AND (
        (v_session IS NOT NULL AND e.session_id = v_session)
        OR e.visitor_id IN (SELECT visitor_id FROM visitors)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM claimed;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.link_journey_to_lead_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_journey_to_lead_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ppc_tracking_inherit_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.lead_id IS NULL AND NEW.visitor_id IS NOT NULL THEN
    SELECT e.lead_id INTO NEW.lead_id
    FROM public.ppc_tracking_events e
    WHERE e.visitor_id = NEW.visitor_id
      AND e.lead_id IS NOT NULL
    ORDER BY e.event_time DESC
    LIMIT 1;
  END IF;
  IF NEW.lead_id IS NULL AND NEW.session_id IS NOT NULL THEN
    SELECT e.lead_id INTO NEW.lead_id
    FROM public.ppc_tracking_events e
    WHERE e.session_id = NEW.session_id
      AND e.lead_id IS NOT NULL
    ORDER BY e.event_time DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ppc_tracking_events_inherit_lead ON public.ppc_tracking_events;
CREATE TRIGGER ppc_tracking_events_inherit_lead
  BEFORE INSERT ON public.ppc_tracking_events
  FOR EACH ROW EXECUTE FUNCTION public.ppc_tracking_inherit_lead_v1();

CREATE OR REPLACE VIEW public.lead_journey_timeline
WITH (security_invoker = true)
AS
SELECT e.lead_id, e.event_time AS occurred_at, 'web'::text AS kind, e.event_name AS event,
  concat_ws(' · ', e.page_path, e.traffic_source, e.campaign,
    e.payload->>'form_source', e.payload->>'tool', e.payload->>'phone_spot') AS detail,
  e.session_id, e.visitor_id,
  (e.gclid IS NOT NULL OR e.gbraid IS NOT NULL OR e.wbraid IS NOT NULL) AS has_ad_click,
  COALESCE(e.is_test, false) AS is_test
FROM public.ppc_tracking_events e
WHERE e.lead_id IS NOT NULL
UNION ALL
SELECT l.id, l.created_at, 'crm', 'lead_created', concat_ws(' · ', l.source, l.attribution->'first_touch'->>'source', l.attribution->'first_touch'->>'campaign'),
  l.session_id, l.attribution->>'site_visitor_id', false, false
FROM public.leads l
UNION ALL
SELECT a.lead_id, a.created_at, 'activity', a.activity_type, left(a.description, 200), NULL, NULL, false, false
FROM public.lead_activities a
WHERE a.lead_id IS NOT NULL
UNION ALL
SELECT c.lead_id, c.occurred_at, 'stage', c.command_type, concat_ws(' → ', c.from_stage, c.to_stage), NULL, NULL, false, false
FROM public.crm_lifecycle_events c
WHERE c.lead_id IS NOT NULL
UNION ALL
SELECT p.lead_id, p.created_at, 'appointment', 'appointment_booked', concat_ws(' · ', p.type, p.source, p.status, p.scheduled_at::text), NULL, NULL, false, false
FROM public.appointments p
WHERE p.lead_id IS NOT NULL
UNION ALL
SELECT o.lead_id, o.created_at, 'ad_conversion', o.event_name, concat_ws(' · ', o.destination, o.status), NULL, NULL, o.click_id IS NOT NULL, false
FROM public.ppc_conversion_outbox o
WHERE o.lead_id IS NOT NULL
UNION ALL
SELECT m.lead_id, m.occurred_at, 'outcome', m.outcome, concat_ws(' · ', m.lead_source, m.revenue::text), NULL, NULL, false, false
FROM public.crm_marketing_outcomes m
WHERE m.lead_id IS NOT NULL;

COMMENT ON VIEW public.lead_journey_timeline IS
  'One ordered journey per lead: web events, lead creation, activities, stage changes, appointments, ad conversions and outcomes. Service role only.';

REVOKE ALL ON public.lead_journey_timeline FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_journey_timeline TO service_role;

-- One-shot backfill: leads that already carry a website session id.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, session_id FROM public.leads WHERE session_id IS NOT NULL LOOP
    PERFORM public.link_journey_to_lead_v1(r.id, r.session_id, NULL);
  END LOOP;
END;
$$;
