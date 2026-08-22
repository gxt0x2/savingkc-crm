-- Full-campaign audience search. Search text is a rebuildable projection kept
-- beside each member so the operator never has to download an audience before
-- finding a seller. The read RPC remains owner-scoped and service-role only.

ALTER TABLE public.prospecting_campaign_members
  ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

UPDATE public.prospecting_campaign_members member
SET search_text = trim(lower(regexp_replace(concat_ws(' ',
  member.phone_snapshot,
  member.suppression_reason,
  lead.full_name,
  lead.property_address,
  lead.phone
), '[[:space:]]+', ' ', 'g')))
FROM public.leads lead
WHERE lead.id = member.lead_id;

CREATE OR REPLACE FUNCTION public.set_prospecting_campaign_member_search_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row record;
BEGIN
  SELECT full_name, property_address, phone
  INTO lead_row
  FROM public.leads
  WHERE id = NEW.lead_id;

  NEW.search_text := trim(lower(regexp_replace(concat_ws(' ',
    NEW.phone_snapshot,
    NEW.suppression_reason,
    lead_row.full_name,
    lead_row.property_address,
    lead_row.phone
  ), '[[:space:]]+', ' ', 'g')));
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.set_prospecting_campaign_member_search_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_prospecting_campaign_member_search_v1 ON public.prospecting_campaign_members;
CREATE TRIGGER set_prospecting_campaign_member_search_v1
BEFORE INSERT OR UPDATE OF lead_id, phone_snapshot, suppression_reason
ON public.prospecting_campaign_members
FOR EACH ROW EXECUTE FUNCTION public.set_prospecting_campaign_member_search_v1();

CREATE OR REPLACE FUNCTION public.refresh_prospecting_campaign_member_search_from_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.prospecting_campaign_members member
  SET search_text = trim(lower(regexp_replace(concat_ws(' ',
    member.phone_snapshot,
    member.suppression_reason,
    NEW.full_name,
    NEW.property_address,
    NEW.phone
  ), '[[:space:]]+', ' ', 'g')))
  WHERE member.lead_id = NEW.id
    AND member.search_text IS DISTINCT FROM trim(lower(regexp_replace(concat_ws(' ',
      member.phone_snapshot,
      member.suppression_reason,
      NEW.full_name,
      NEW.property_address,
      NEW.phone
    ), '[[:space:]]+', ' ', 'g')));
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.refresh_prospecting_campaign_member_search_from_lead_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS refresh_prospecting_campaign_member_search_from_lead_v1 ON public.leads;
CREATE TRIGGER refresh_prospecting_campaign_member_search_from_lead_v1
AFTER UPDATE OF full_name, property_address, phone
ON public.leads
FOR EACH ROW
WHEN (
  OLD.full_name IS DISTINCT FROM NEW.full_name
  OR OLD.property_address IS DISTINCT FROM NEW.property_address
  OR OLD.phone IS DISTINCT FROM NEW.phone
)
EXECUTE FUNCTION public.refresh_prospecting_campaign_member_search_from_lead_v1();

DO $$
DECLARE
  trigram_schema text;
BEGIN
  SELECT namespace.nspname
  INTO trigram_schema
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF trigram_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension is required for campaign audience search';
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_search ON public.prospecting_campaign_members USING gin (search_text %I.gin_trgm_ops)',
    trigram_schema
  );
END
$$;

CREATE OR REPLACE FUNCTION public.prospecting_campaign_member_page_v2(
  p_actor_email text,
  p_campaign_id uuid,
  p_status text DEFAULT 'all',
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_after_enrolled_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  lead_id uuid,
  phone_snapshot text,
  timezone text,
  status text,
  suppression_reason text,
  current_step_position integer,
  next_action_at timestamptz,
  enrolled_at timestamptz,
  lead_full_name text,
  lead_property_address text,
  lead_station text,
  lead_classification text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_status text := lower(trim(coalesce(p_status, 'all')));
  clean_query text := nullif(lower(regexp_replace(trim(coalesce(p_query, '')), '[[:space:]]+', ' ', 'g')), '');
  search_pattern text;
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  IF clean_actor = '' OR p_campaign_id IS NULL THEN RAISE EXCEPTION 'invalid_campaign_member_query'; END IF;
  IF clean_status NOT IN ('all', 'active', 'suppressed', 'replied', 'completed', 'removed') THEN RAISE EXCEPTION 'invalid_campaign_member_status'; END IF;
  IF clean_query IS NOT NULL AND length(clean_query) > 100 THEN RAISE EXCEPTION 'campaign_member_query_too_long'; END IF;
  IF (p_after_enrolled_at IS NULL) <> (p_after_id IS NULL) THEN RAISE EXCEPTION 'invalid_campaign_member_cursor'; END IF;
  search_pattern := replace(replace(replace(clean_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  PERFORM 1
  FROM public.prospecting_campaigns campaign
  WHERE campaign.id = p_campaign_id
    AND lower(campaign.owner_email) = clean_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;

  RETURN QUERY
  SELECT
    member.id,
    member.lead_id,
    member.phone_snapshot,
    member.timezone,
    member.status,
    member.suppression_reason,
    member.current_step_position::integer,
    member.next_action_at,
    member.enrolled_at,
    lead.full_name,
    lead.property_address,
    lead.station,
    lead.classification
  FROM public.prospecting_campaign_members member
  LEFT JOIN public.leads lead ON lead.id = member.lead_id
  WHERE member.campaign_id = p_campaign_id
    AND (
      (clean_status = 'all' AND member.status <> 'removed')
      OR (clean_status <> 'all' AND member.status = clean_status)
    )
    AND (clean_query IS NULL OR member.search_text LIKE '%' || search_pattern || '%' ESCAPE E'\\')
    AND (
      p_after_enrolled_at IS NULL
      OR member.enrolled_at < p_after_enrolled_at
      OR (member.enrolled_at = p_after_enrolled_at AND member.id < p_after_id)
    )
  ORDER BY member.enrolled_at DESC, member.id DESC
  LIMIT safe_limit + 1;
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_campaign_member_page_v2(text, uuid, text, text, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_member_page_v2(text, uuid, text, text, integer, timestamptz, uuid) TO service_role;
