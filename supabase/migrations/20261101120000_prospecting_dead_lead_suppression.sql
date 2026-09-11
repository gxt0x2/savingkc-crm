-- Keep terminal CRM lifecycle decisions out of cold-calling campaign queues.
-- This covers direct lead subjects and source prospects linked to those leads.
-- Suppression is one-way: reopening a lead never silently re-enrolls it.
-- Calls, reservations, outcomes, completed work, and SMS campaigns are retained.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.prospecting_member_dead_lead_v1(
  p_lead_id uuid, p_prospect_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT lead.id
  FROM public.leads lead
  WHERE lead.id = coalesce(p_lead_id, (
    SELECT prospect.lead_id FROM public.prospects prospect WHERE prospect.id = p_prospect_id
  ))
    AND (lower(trim(coalesce(lead.station, ''))) IN ('dead', 'closed_lost')
      OR lower(trim(coalesce(lead.classification, ''))) = 'dead')
$$;

CREATE OR REPLACE FUNCTION public.guard_prospecting_member_dead_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
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
$$;

CREATE OR REPLACE TRIGGER guard_prospecting_member_dead_lead_v1
BEFORE INSERT OR UPDATE OF status, lead_id, prospect_id, campaign_id
ON public.prospecting_campaign_members
FOR EACH ROW EXECUTE FUNCTION public.guard_prospecting_member_dead_lead_v1();

CREATE OR REPLACE FUNCTION public.suppress_prospecting_members_from_dead_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF lower(trim(coalesce(NEW.station, ''))) IN ('dead', 'closed_lost')
    OR lower(trim(coalesce(NEW.classification, ''))) = 'dead'
  THEN
    UPDATE public.prospecting_campaign_members member
    SET status = 'suppressed', suppression_reason = 'dead_lead', next_action_at = NULL, updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE campaign.id = member.campaign_id AND campaign.kind = 'dialer'
      AND member.status IN ('active', 'needs_review')
      AND (member.lead_id = NEW.id OR member.prospect_id IN (
        SELECT prospect.id FROM public.prospects prospect WHERE prospect.lead_id = NEW.id
      ));
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER suppress_prospecting_members_from_dead_lead_v1
AFTER UPDATE OF station, classification ON public.leads
FOR EACH ROW
WHEN (OLD.station IS DISTINCT FROM NEW.station OR OLD.classification IS DISTINCT FROM NEW.classification)
EXECUTE FUNCTION public.suppress_prospecting_members_from_dead_lead_v1();

CREATE OR REPLACE FUNCTION public.suppress_prospecting_members_from_linked_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.prospecting_member_dead_lead_v1(NEW.lead_id, NULL) IS NOT NULL THEN
    UPDATE public.prospecting_campaign_members member
    SET status = 'suppressed', suppression_reason = 'dead_lead', next_action_at = NULL, updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE campaign.id = member.campaign_id AND campaign.kind = 'dialer'
      AND member.prospect_id = NEW.id AND member.status IN ('active', 'needs_review');
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER suppress_prospecting_members_from_linked_lead_v1
AFTER UPDATE OF lead_id ON public.prospects
FOR EACH ROW WHEN (OLD.lead_id IS DISTINCT FROM NEW.lead_id)
EXECUTE FUNCTION public.suppress_prospecting_members_from_linked_lead_v1();

CREATE OR REPLACE FUNCTION public.audit_prospecting_dead_lead_suppression_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'suppressed' AND NEW.suppression_reason = 'dead_lead'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.suppression_reason IS DISTINCT FROM NEW.suppression_reason)
  THEN
    INSERT INTO public.prospecting_campaign_events(campaign_id, member_id, event_type, actor, metadata)
    VALUES (NEW.campaign_id, NEW.id, 'member_lifecycle_suppressed', 'system', jsonb_build_object(
      'reason', 'dead_lead', 'subject_kind', NEW.subject_kind,
      'lead_id', public.prospecting_member_dead_lead_v1(NEW.lead_id, NEW.prospect_id),
      'prospect_id', NEW.prospect_id
    ));
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER audit_prospecting_dead_lead_suppression_v1
AFTER INSERT OR UPDATE OF status, suppression_reason ON public.prospecting_campaign_members
FOR EACH ROW EXECUTE FUNCTION public.audit_prospecting_dead_lead_suppression_v1();

-- Reconcile stale eligibility without resetting completed sellers or sessions.
UPDATE public.prospecting_campaign_members member
SET status = 'suppressed', suppression_reason = 'dead_lead', next_action_at = NULL, updated_at = now()
FROM public.prospecting_campaigns campaign
WHERE campaign.id = member.campaign_id AND campaign.kind = 'dialer'
  AND member.status IN ('active', 'needs_review')
  AND public.prospecting_member_dead_lead_v1(member.lead_id, member.prospect_id) IS NOT NULL;

REVOKE ALL ON FUNCTION public.prospecting_member_dead_lead_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_member_dead_lead_v1(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_prospecting_member_dead_lead_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_prospecting_members_from_dead_lead_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suppress_prospecting_members_from_linked_lead_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_prospecting_dead_lead_suppression_v1() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
