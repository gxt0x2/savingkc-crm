-- Production stores current_step_position as smallint. Keep the V2 API's
-- JSON-facing integer contract while explicitly widening the selected value.

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
