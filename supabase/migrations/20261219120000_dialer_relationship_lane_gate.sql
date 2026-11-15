-- Counsel §4h / §4k. Lane comes from the source list lane (list_type) or source/lane
-- field, never from a title. Does not write campaign members or mojo_call_queue.
-- #830's owner-line release stays byte-identical and still runs for a name match.

CREATE OR REPLACE FUNCTION public.dialer_source_list_lanes_v1(p_prospect_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce(array_agg(DISTINCT found.value), ARRAY[]::text[])
  FROM (
    SELECT nullif(btrim(row.list_type), '') AS value
    FROM public.source_list_rows AS row
    WHERE row.prospect_id = p_prospect_id
    UNION ALL
    SELECT nullif(btrim(row.raw->>'source'), '')
    FROM public.source_list_rows AS row
    WHERE row.prospect_id = p_prospect_id
    UNION ALL
    SELECT nullif(btrim(row.raw->>'lane'), '')
    FROM public.source_list_rows AS row
    WHERE row.prospect_id = p_prospect_id
  ) AS found
  WHERE found.value IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_lane_class_v1(p_lanes text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(p_lanes, ARRAY[]::text[])) AS lane(value)
      WHERE public.dialer_label_key_v1(lane.value) IN ('probate_estate', 'inherited_deed')
        OR public.dialer_label_key_v1(lane.value) LIKE 'probate%'
        OR public.dialer_label_key_v1(lane.value) LIKE 'inherited%'
    ) THEN 'probate'
    WHEN EXISTS (
      SELECT 1 FROM unnest(coalesce(p_lanes, ARRAY[]::text[])) AS lane(value)
      WHERE public.dialer_label_key_v1(lane.value) = 'deceased'
        OR public.dialer_label_key_v1(lane.value) LIKE 'deceased%'
    ) THEN 'deceased'
    ELSE 'open'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_entity_contact_release_v1(
  p_relationship text,
  p_contact_name text,
  p_owner_name text,
  p_verified_source text,
  p_skip_traced boolean,
  p_lanes text[]
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  rel text := public.dialer_label_key_v1(p_relationship);
  contact text := coalesce(public.dialer_label_key_v1(p_contact_name), '');
  owner text := coalesce(public.dialer_label_key_v1(p_owner_name), '');
  source text := lower(btrim(coalesce(p_verified_source, '')));
  contact_tokens text[] := string_to_array(contact, '_');
  token text;
  has_role boolean := false;
  has_name boolean := false;
BEGIN
  IF public.dialer_lane_class_v1(p_lanes) <> 'open' THEN RETURN false; END IF;
  IF rel = 'registered_agent' OR contact = 'registered_agent' OR contact LIKE '%registered_agent%' THEN RETURN false; END IF;
  IF contact LIKE '%law_firm%' OR contact ~ '(^|_)(law|attorney|attorneys|lawyer|lawyers|esq|firm)($|_)' THEN RETURN false; END IF;
  IF contact <> '' AND contact = owner THEN RETURN false; END IF;
  FOREACH token IN ARRAY contact_tokens LOOP
    IF token IN ('member', 'manager', 'officer') THEN has_role := true; END IF;
    IF length(token) > 1 AND token NOT IN ('member', 'manager', 'officer', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'trust', 'bank', 'lp', 'llp', 'pllc', 'law', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'esq', 'firm') THEN
      has_name := true;
    END IF;
  END LOOP;
  IF rel IN ('member', 'manager', 'officer') THEN has_role := true; END IF;
  IF NOT has_role OR NOT has_name THEN RETURN false; END IF;
  IF source ~ 'sos|secretary_of_state|articles_of_org' THEN RETURN true; END IF;
  RETURN coalesce(p_skip_traced, false) AND (source ~ '^dataskip_run' OR source ~ '^smartskip_');
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_relationship_block_reason_v1(
  p_relationship text,
  p_owner_type text,
  p_lanes text[],
  p_contact_name text,
  p_owner_name text,
  p_owner_last text,
  p_skip_traced boolean,
  p_verified_source text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  rel text := public.dialer_label_key_v1(p_relationship);
  owner text := public.dialer_label_key_v1(p_owner_type);
  contact text := coalesce(public.dialer_label_key_v1(p_contact_name), '');
  class text := public.dialer_lane_class_v1(p_lanes);
  family boolean := owner = ANY (ARRAY['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative']);
  kind text;
BEGIN
  IF rel = 'deceased_owner_line' OR owner = 'deceased_owner_line' THEN RETURN 'deceased_owner_line'; END IF;
  IF rel = 'associate' THEN RETURN 'associate'; END IF;
  IF rel = 'registered_agent' OR contact = 'registered_agent' OR contact LIKE '%registered_agent%' THEN
    RETURN 'relationship_unknown';
  END IF;
  IF rel = 'entity_contact' THEN
    IF public.dialer_entity_contact_release_v1(p_relationship, p_contact_name, p_owner_name, p_verified_source, p_skip_traced, p_lanes) THEN
      RETURN NULL;
    END IF;
    RETURN 'relationship_unknown';
  END IF;
  IF owner = ANY (ARRAY['neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant']) THEN
    IF contact NOT LIKE '%registered_agent%' AND public.dialer_owner_line_release_v1(
      p_relationship, p_contact_name, p_owner_name, p_owner_last, p_skip_traced, p_verified_source, p_owner_type
    ) THEN RETURN NULL; END IF;
    RETURN 'associate_non_family';
  END IF;
  IF rel = ANY (ARRAY['owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner']) THEN
    RETURN NULL;
  END IF;
  IF owner = 'unknown' OR (
    rel IS NOT NULL AND rel <> 'relative' AND rel <> 'unknown'
    AND rel <> ALL (ARRAY['owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner', 'spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative', 'associate', 'entity_contact', 'deceased_owner_line'])
  ) THEN
    RETURN 'relationship_unknown';
  END IF;
  IF rel = 'relative' THEN
    IF family THEN
      IF class = 'probate' AND owner = ANY (ARRAY['parent', 'in_law', 'other_relative']) THEN RETURN 'relative_not_allowed'; END IF;
      RETURN NULL;
    END IF;
    IF public.dialer_owner_line_release_v1(
      p_relationship, p_contact_name, p_owner_name, p_owner_last, p_skip_traced, p_verified_source, p_owner_type
    ) THEN RETURN NULL; END IF;
    RETURN 'relationship_unknown';
  END IF;
  IF rel = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative']) OR (rel IS NULL AND family) THEN
    kind := CASE WHEN rel = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative']) THEN rel ELSE owner END;
    IF class = 'probate' AND kind = ANY (ARRAY['parent', 'in_law', 'other_relative']) THEN RETURN 'relative_not_allowed'; END IF;
    RETURN NULL;
  END IF;
  IF rel IS NULL OR rel = 'unknown' THEN
    IF public.dialer_unknown_tie_release_v1(p_relationship, p_contact_name, p_owner_name, p_owner_last, p_skip_traced, p_verified_source)
      OR public.dialer_owner_line_release_v1(p_relationship, p_contact_name, p_owner_name, p_owner_last, p_skip_traced, p_verified_source, p_owner_type) THEN
      RETURN NULL;
    END IF;
    RETURN 'relationship_unknown';
  END IF;
  RETURN 'relationship_unknown';
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_relationship_bucket_v1(p_relationship text, p_owner_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN public.dialer_label_key_v1(p_relationship) = 'associate'
      OR public.dialer_label_key_v1(p_owner_type) = ANY (ARRAY['neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant']) THEN 'associate_non_family'
    WHEN public.dialer_label_key_v1(p_relationship) = ANY (ARRAY['owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner']) THEN 'owner'
    WHEN public.dialer_label_key_v1(p_relationship) = ANY (ARRAY['unknown', 'entity_contact'])
      OR public.dialer_label_key_v1(p_owner_type) = 'unknown' THEN 'relationship_unknown'
    WHEN public.dialer_label_key_v1(p_relationship) = 'relative' THEN
      CASE WHEN public.dialer_label_key_v1(p_owner_type) = ANY (ARRAY['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative']) THEN 'relative' ELSE 'relationship_unknown' END
    WHEN public.dialer_label_key_v1(p_relationship) = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative'])
      OR public.dialer_label_key_v1(p_owner_type) = ANY (ARRAY['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative']) THEN 'relative'
    ELSE 'relationship_unknown'
  END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_source_list_lanes_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_lane_class_v1(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_entity_contact_release_v1(text, text, text, text, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_relationship_block_reason_v1(text, text, text[], text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_source_list_lanes_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_lane_class_v1(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_entity_contact_release_v1(text, text, text, text, boolean, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_relationship_block_reason_v1(text, text, text[], text, text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_relationship_bucket_v1(text, text) TO service_role;

DO $patch$
DECLARE
  def text := pg_get_functiondef('public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[])'::regprocedure);
  start_at integer;
  hits_at integer;
  cte text := $cte$relationship_blocks AS MATERIALIZED (
    SELECT prospect_id, key10, reason.block_reason,
      CASE reason.block_reason
        WHEN 'deceased_owner_line' THEN 88
        WHEN 'associate' THEN 89
        WHEN 'associate_non_family' THEN 90
        WHEN 'relative_not_allowed' THEN 92
        ELSE 91
      END AS priority
    FROM bucketed_phones
    CROSS JOIN LATERAL (
      SELECT public.dialer_relationship_block_reason_v1(
        relationship, owner_type_key, public.dialer_source_list_lanes_v1(prospect_id),
        contact_name, owner_1, owner_1_last, is_skip_traced, verified_source
      ) AS block_reason
    ) AS reason
    WHERE length(key10) = 10 AND reason.block_reason IS NOT NULL
  ),
  $cte$;
BEGIN
  IF position('owner_type_key IN (''in_law'', ''child'', ''parent'', ''sibling'', ''spouse'', ''other_relative'', ''individual'')' IN def) = 0 THEN
    RAISE EXCEPTION 'family owner-type list was not found';
  END IF;
  def := replace(def,
    'WHEN relationship_key IN (''relative'', ''spouse'', ''parent'', ''child'', ''sibling'', ''in_law'', ''other_relative'')
          OR owner_type_key IN (''in_law'', ''child'', ''parent'', ''sibling'', ''spouse'', ''other_relative'', ''individual'') THEN ''relative''',
    'WHEN relationship_key IN (''spouse'', ''parent'', ''child'', ''sibling'', ''in_law'', ''other_relative'')
          OR (relationship_key = ''relative'' AND owner_type_key IN (''parent'', ''in_law'', ''spouse'', ''child'', ''sibling'', ''other_relative''))
          OR (relationship_key IS NULL AND owner_type_key IN (''parent'', ''in_law'', ''spouse'', ''child'', ''sibling'', ''other_relative'')) THEN ''relative''');
  start_at := position('relationship_blocks AS MATERIALIZED (' IN def);
  hits_at := position('hits AS (' IN def);
  IF start_at = 0 OR hits_at = 0 OR hits_at < start_at THEN
    RAISE EXCEPTION 'relationship block site was not found';
  END IF;
  def := substring(def FROM 1 FOR start_at - 1) || cte || substring(def FROM hits_at);
  def := replace(def,
    'ON blocked.key10 = input.key10
     AND (input.prospect_id IS NULL OR blocked.prospect_id = input.prospect_id)',
    'ON blocked.key10 = input.key10
     AND (input.prospect_id IS NULL OR blocked.prospect_id = input.prospect_id)
     AND NOT (
       blocked.block_reason = ''associate''
       AND EXISTS (
         SELECT 1 FROM bucketed_phones AS owner_row
         WHERE owner_row.key10 = input.key10
           AND owner_row.bucket = ''owner''
           AND owner_row.prospect_id IS DISTINCT FROM blocked.prospect_id
           AND (input.prospect_id IS NULL OR owner_row.prospect_id = input.prospect_id)
       )
     )');
  def := replace(def,
    'SELECT input.ordinal, ''property_owner_dnc_fanout'', 100
    FROM input
    JOIN property_blocked AS blocked',
    'SELECT input.ordinal, ''property_owner_dnc_fanout'', 99
    FROM input
    JOIN bucketed_phones AS relative
      ON relative.key10 = input.key10
     AND (input.prospect_id IS NULL OR relative.prospect_id = input.prospect_id)
     AND relative.bucket = ''relative''
    JOIN bucketed_phones AS owner
      ON owner.bucket = ''owner''
     AND owner.key10 IS DISTINCT FROM relative.key10
     AND (
       owner.prospect_id = relative.prospect_id
       OR (owner.dialer_property_key IS NOT NULL AND owner.dialer_property_key = relative.dialer_property_key)
     )
     AND (
       owner.voice_hold IS TRUE
       OR owner.disposition_key IN (''dnc'', ''do_not_call'', ''dnc_number'', ''dnc_contact'', ''take_me_off'')
       OR EXISTS (
         SELECT 1 FROM public.sms_opt_outs AS opt_out
         WHERE opt_out.is_opted_out IS TRUE AND opt_out.dialer_phone_key = owner.key10
       )
     )
    UNION ALL
    SELECT input.ordinal, ''property_owner_dnc_fanout'', 100
    FROM input
    JOIN property_blocked AS blocked');
  EXECUTE def;
END;
$patch$;

DO $campaign$
BEGIN
  IF to_regclass('public.prospecting_campaign_member_contacts') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.campaign_contact_block_reason_v1(p_contact_id uuid)
    RETURNS text
    LANGUAGE sql
    STABLE
    SET search_path = pg_catalog, public
    AS $body$
      SELECT CASE
        WHEN found.block_reason IN ('associate', 'associate_non_family', 'relationship_unknown', 'relative_not_allowed', 'deceased_owner_line')
          THEN rel.block_reason
        ELSE coalesce(found.block_reason, rel.block_reason)
      END
      FROM public.prospecting_campaign_member_contacts AS contact
      JOIN public.prospecting_campaign_members AS member ON member.id = contact.member_id
      LEFT JOIN public.prospects AS prospect ON prospect.id = coalesce(contact.prospect_id, member.prospect_id)
      LEFT JOIN public.prospect_phones AS phone ON phone.id = contact.prospect_phone_id
      LEFT JOIN LATERAL (
        SELECT found.block_reason
        FROM public.source_list_phone_block_reasons_v1(
          ARRAY[contact.phone_snapshot],
          ARRAY[coalesce(contact.prospect_id, member.prospect_id)]
        ) AS found
        LIMIT 1
      ) AS found ON true
      CROSS JOIN LATERAL (
        SELECT public.dialer_relationship_block_reason_v1(
          coalesce(phone.relationship, contact.relationship),
          prospect.owner_1_type,
          public.dialer_source_list_lanes_v1(coalesce(contact.prospect_id, member.prospect_id)),
          coalesce(phone.contact_name, contact.contact_name),
          prospect.owner_1,
          prospect.owner_1_last,
          prospect.is_skip_traced,
          phone.verified_source
        ) AS block_reason
      ) AS rel
      WHERE contact.id = p_contact_id
        AND contact.status = 'ready';
    $body$
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.campaign_contact_block_reason_v1(uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.campaign_contact_block_reason_v1(uuid) TO service_role';

  IF to_regprocedure('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'start_prospecting_dialer_session_v4 was not found';
  END IF;
  IF position('prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)' IN pg_get_functiondef('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'campaign offer check site was not found';
  END IF;
  EXECUTE replace(
    pg_get_functiondef('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)'::regprocedure),
    'public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)',
    'public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup) AND public.campaign_contact_block_reason_v1(contact.id) IS NULL'
  );
  IF to_regprocedure('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)') IS NULL THEN
    RAISE EXCEPTION 'prospecting_campaign_member_page_v3 was not found';
  END IF;
  IF position('count(contact.id) FILTER (WHERE contact.status = ''ready'')' IN pg_get_functiondef('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'campaign member page check site was not found';
  END IF;
  EXECUTE replace(
    pg_get_functiondef('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)'::regprocedure),
    'count(contact.id) FILTER (WHERE contact.status = ''ready'')',
    'count(contact.id) FILTER (WHERE contact.status = ''ready'' AND public.campaign_contact_block_reason_v1(contact.id) IS NULL)'
  );
END;
$campaign$;
