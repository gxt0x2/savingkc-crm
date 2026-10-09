CREATE OR REPLACE FUNCTION public.guard_prospecting_member_dead_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Deceased dialer campaigns intentionally dial heirs/relatives on deceased prospects.
  -- Do not auto-suppress those members just because the linked lead is station=dead.
  IF EXISTS (
    SELECT 1 FROM public.prospecting_campaigns c
    WHERE c.id = NEW.campaign_id
      AND c.kind = 'dialer'
      AND c.name ILIKE '%Deceased%'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('active', 'needs_review')
    AND EXISTS (SELECT 1 FROM public.prospecting_campaigns WHERE id = NEW.campaign_id AND kind = 'dialer')
    AND public.prospecting_member_dead_lead_v1(NEW.lead_id, NEW.prospect_id) IS NOT NULL
  THEN
    NEW.status := 'suppressed';
    NEW.suppression_reason := 'dead_lead';
    NEW.next_action_at := NULL;
  END IF;
  RETURN NEW;
END
$function$;
