-- Counsel §4h / §4k. Lane comes from the caller: campaign.lane, the export
-- row's list_type, or a probate/inherited link. A title is not a lane.
-- Does not write campaign members or mojo_call_queue.

DO $lane_column$
BEGIN
  IF to_regclass('public.prospecting_campaigns') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.prospecting_campaigns ADD COLUMN IF NOT EXISTS lane text;
  UPDATE public.prospecting_campaigns
  SET lane = 'tax'
  WHERE lane IS NULL AND name ~* 'tax';
END;
$lane_column$;

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
      AND (
        public.dialer_label_key_v1(row.list_type) IN ('probate_estate', 'inherited_deed')
        OR public.dialer_label_key_v1(row.list_type) LIKE 'probate%'
        OR public.dialer_label_key_v1(row.list_type) LIKE 'inherited%'
      )
  ) AS found
  WHERE found.value IS NOT NULL;
$function$;

-- The export row's list_type is the caller lane. A code-violation row is not a lane.
CREATE OR REPLACE FUNCTION public.dialer_export_list_types_v1(p_prospect_id uuid)
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
      AND public.dialer_label_key_v1(row.list_type) IS DISTINCT FROM 'code_violation'
  ) AS found
  WHERE found.value IS NOT NULL;
$function$;

-- Ready contacts on a campaign use that campaign's lane. Missing tables fail closed.
CREATE OR REPLACE FUNCTION public.dialer_campaign_lanes_v1(p_prospect_id uuid, p_key text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  lanes text[];
BEGIN
  IF to_regclass('public.prospecting_campaigns') IS NULL
    OR to_regclass('public.prospecting_campaign_members') IS NULL
    OR to_regclass('public.prospecting_campaign_member_contacts') IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  EXECUTE $sql$
    SELECT coalesce(array_agg(DISTINCT nullif(btrim(campaign.lane), '')), ARRAY[]::text[])
    FROM public.prospecting_campaigns AS campaign
    JOIN public.prospecting_campaign_members AS member ON member.campaign_id = campaign.id
    JOIN public.prospecting_campaign_member_contacts AS contact ON contact.member_id = member.id
    LEFT JOIN public.prospect_phones AS phone ON phone.id = contact.prospect_phone_id
    WHERE contact.status = 'ready'
      AND (
        contact.prospect_id = $1
        OR member.prospect_id = $1
        OR public.prospecting_phone_key_v1(coalesce(phone.phone, contact.phone_snapshot)) = $2
      )
  $sql$ INTO lanes USING p_prospect_id, p_key;
  RETURN coalesce(lanes, ARRAY[]::text[]);
END;
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
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p_lanes, ARRAY[]::text[])) AS lane(value)
      WHERE public.dialer_label_key_v1(lane.value) IS NOT NULL
    ) THEN 'closed'
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
  has_name integer := 0;
BEGIN
  IF public.dialer_lane_class_v1(p_lanes) <> 'open' THEN RETURN false; END IF;
  IF rel = 'registered_agent' OR contact LIKE '%registered_agent%' OR contact LIKE '%resident_agent%' OR contact LIKE '%ct_corporation%' THEN RETURN false; END IF;
  IF contact ~ '(^|_)(law|attorney|attorneys|lawyer|lawyers|esq|firm|legal|llp|pc|holdings|corporation|resident|agent)($|_)' THEN RETURN false; END IF;
  IF contact <> '' AND contact = owner THEN RETURN false; END IF;
  FOREACH token IN ARRAY contact_tokens LOOP
    IF token IN ('member', 'manager', 'officer') THEN has_role := true; END IF;
    IF length(token) > 1 AND token NOT IN ('member', 'manager', 'officer', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'trust', 'bank', 'lp', 'llp', 'pllc', 'holdings', 'ct', 'resident', 'agent', 'pc', 'legal', 'law', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'esq', 'firm') THEN
      has_name := has_name + 1;
    END IF;
  END LOOP;
  IF rel IN ('member', 'manager', 'officer') THEN has_role := true; END IF;
  IF NOT has_role OR has_name < 2 THEN RETURN false; END IF;
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
  p_verified_source text,
  p_deceased boolean DEFAULT false,
  p_owner_first text DEFAULT NULL
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
  IF rel IN ('deceased_owner_line', 'decedent') OR contact LIKE '%decedent%'
    OR ((rel IN ('owner', 'subject')) AND coalesce(p_deceased, false)
      AND (
        (contact <> '' AND contact = coalesce(public.dialer_label_key_v1(p_owner_name), ''))
        OR (
          public.dialer_label_key_v1(p_owner_last) IS NOT NULL
          AND public.dialer_label_key_v1(p_owner_last) = ANY (regexp_split_to_array(lower(btrim(coalesce(p_owner_name, ''))), '[^a-z]+'))
          AND public.dialer_label_key_v1(p_owner_last) = ANY (regexp_split_to_array(lower(btrim(coalesce(p_contact_name, ''))), '[^a-z]+'))
          AND (
            SELECT count(DISTINCT owner_token)
            FROM unnest(regexp_split_to_array(lower(btrim(coalesce(p_owner_name, ''))), '[^a-z]+')) AS owner_token
            WHERE owner_token <> ''
              AND owner_token = ANY (regexp_split_to_array(lower(btrim(coalesce(p_contact_name, ''))), '[^a-z]+'))
          ) >= 2
        )
        OR (
          public.dialer_label_key_v1(p_owner_first) IS NOT NULL
          AND public.dialer_label_key_v1(p_owner_last) IS NOT NULL
          AND public.dialer_label_key_v1(p_owner_first) = ANY (string_to_array(contact, '_'))
          AND public.dialer_label_key_v1(p_owner_last) = ANY (string_to_array(contact, '_'))
        )
      )) THEN
    RETURN 'deceased_owner_line';
  END IF;
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
  IF rel = 'relative' THEN
    IF class IN ('probate', 'closed') THEN RETURN 'relative_not_allowed'; END IF;
    RETURN NULL;
  END IF;
  IF owner = 'unknown' OR (
    rel IS NOT NULL AND rel <> 'unknown'
    AND rel <> ALL (ARRAY['owner', 'subject', 'co_owner', 'personal_representative', 'pr', 'personal_rep', 'on_title', 'on_title_owner', 'spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative', 'associate', 'entity_contact', 'deceased_owner_line', 'decedent'])
  ) THEN
    RETURN 'relationship_unknown';
  END IF;
  IF rel = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative']) OR (rel IS NULL AND family) THEN
    kind := CASE WHEN rel = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative']) THEN rel ELSE owner END;
    IF class IN ('probate', 'closed') AND kind = ANY (ARRAY['parent', 'in_law', 'other_relative']) THEN RETURN 'relative_not_allowed'; END IF;
    RETURN NULL;
  END IF;
  IF rel IS NULL OR rel = 'unknown' THEN
    IF public.dialer_owner_line_release_v1(p_relationship, p_contact_name, p_owner_name, p_owner_last, p_skip_traced, p_verified_source, p_owner_type) THEN
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
    WHEN public.dialer_label_key_v1(p_relationship) = 'relative' THEN 'relative'
    WHEN public.dialer_label_key_v1(p_relationship) = ANY (ARRAY['unknown', 'entity_contact'])
      OR public.dialer_label_key_v1(p_owner_type) = 'unknown' THEN 'relationship_unknown'
    WHEN public.dialer_label_key_v1(p_relationship) = ANY (ARRAY['spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative'])
      OR public.dialer_label_key_v1(p_owner_type) = ANY (ARRAY['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative']) THEN 'relative'
    ELSE 'relationship_unknown'
  END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_source_list_lanes_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_export_list_types_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_campaign_lanes_v1(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_lane_class_v1(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_entity_contact_release_v1(text, text, text, text, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_relationship_block_reason_v1(text, text, text[], text, text, text, boolean, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_source_list_lanes_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_export_list_types_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_campaign_lanes_v1(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_lane_class_v1(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_entity_contact_release_v1(text, text, text, text, boolean, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_relationship_block_reason_v1(text, text, text[], text, text, text, boolean, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_relationship_bucket_v1(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_prospect_deceased_v1(p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $function$
BEGIN
  IF p_id IS NULL THEN RETURN false; END IF;
  RETURN coalesce((SELECT is_deceased FROM public.prospects WHERE id = p_id), false);
EXCEPTION WHEN undefined_column THEN RETURN false;
END; $function$;

CREATE OR REPLACE FUNCTION public.dialer_prospect_owner_first_v1(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $function$
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT owner_1_first FROM public.prospects WHERE id = p_id);
EXCEPTION WHEN undefined_column THEN RETURN NULL;
END; $function$;

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
        relationship, owner_type_key,
        public.dialer_source_list_lanes_v1(prospect_id)
          || public.dialer_export_list_types_v1(prospect_id)
          || public.dialer_campaign_lanes_v1(prospect_id, key10),
        contact_name, owner_1, owner_1_last, is_skip_traced, verified_source,
        public.dialer_prospect_deceased_v1(prospect_id), public.dialer_prospect_owner_first_v1(prospect_id)
      ) AS block_reason
    ) AS reason
    WHERE length(key10) = 10
      AND key10 IN (SELECT input.key10 FROM input WHERE length(input.key10) = 10)
      AND reason.block_reason IS NOT NULL
  ),
  $cte$;
BEGIN
  IF position('dialer_relationship_block_reason_v1(' IN def) > 0 THEN
    RETURN;
  END IF;
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
           AND input.prospect_id IS NOT NULL
           AND owner_row.prospect_id = input.prospect_id
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

CREATE OR REPLACE FUNCTION public.dialer_prospect_deceased_v1(p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $function$
BEGIN
  IF p_id IS NULL THEN RETURN false; END IF;
  RETURN coalesce((SELECT is_deceased FROM public.prospects WHERE id = p_id), false);
EXCEPTION WHEN undefined_column THEN RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_prospect_owner_first_v1(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $function$
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT owner_1_first FROM public.prospects WHERE id = p_id);
EXCEPTION WHEN undefined_column THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_lead_ask_off_v1(p_dead_reason text, p_notes text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $function$
  SELECT public.dialer_label_key_v1(p_dead_reason) IN ('dnc', 'dnc_refused', 'do_not_call')
    OR lower(coalesce(p_dead_reason, '') || ' ' || coalesce(p_notes, '')) ~ '(stop|refus|take me off|do not call|do_not_contact)';
$function$;

REVOKE ALL ON FUNCTION public.dialer_prospect_deceased_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_prospect_owner_first_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_lead_ask_off_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_prospect_deceased_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_prospect_owner_first_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_lead_ask_off_v1(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_dead_lead_block_v1(p_key text, p_prospect_id uuid)
RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $function$
  WITH lead_row AS (
    SELECT to_jsonb(l) AS body
    FROM public.leads AS l
    WHERE public.prospecting_phone_key_v1(l.phone) = p_key
       OR l.id IN (SELECT prospect.lead_id FROM public.prospects AS prospect WHERE prospect.id = p_prospect_id)
  )
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM lead_row
      WHERE public.dialer_lead_ask_off_v1(body->>'dead_reason', body->>'notes')
        AND public.prospecting_phone_key_v1(body->>'phone') IS DISTINCT FROM p_key
    ) AND EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE phone.prospect_id = p_prospect_id
        AND public.prospecting_phone_key_v1(phone.phone) = p_key
        AND public.dialer_relationship_bucket_v1(phone.relationship, NULL) = 'relative'
    ) THEN 'property_owner_dnc_fanout'
    WHEN EXISTS (
      SELECT 1 FROM lead_row
      WHERE public.prospecting_phone_key_v1(body->>'phone') = p_key
        AND NOT public.dialer_lead_ask_off_v1(body->>'dead_reason', body->>'notes')
        AND (body->>'station' = 'dead' OR body->>'classification' = 'dead' OR nullif(body->>'dead_reason', '') IS NOT NULL)
        AND public.dialer_label_key_v1(body->>'dead_reason') IS DISTINCT FROM 'wrong_or_disconnected'
        AND public.dialer_label_key_v1(body->>'dead_reason') IS DISTINCT FROM 'disconnected'
    ) THEN 'dead_manual_review_unread'
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_dead_lead_block_v1(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_dead_lead_block_v1(text, uuid) TO service_role;

DO $dead$
DECLARE
  def text := pg_get_functiondef('public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[])'::regprocedure);
BEGIN
  IF position('dialer_dead_lead_block_v1' IN def) > 0 THEN
    RETURN;
  END IF;
  def := replace(def,
    'SELECT input.ordinal, ''property_owner_dnc_fanout'', 100
    FROM input
    JOIN property_blocked AS blocked',
    'SELECT input.ordinal, dead.block_reason, 140
    FROM input
    CROSS JOIN LATERAL (
      SELECT public.dialer_dead_lead_block_v1(input.key10, input.prospect_id) AS block_reason
    ) AS dead
    WHERE dead.block_reason IS NOT NULL
    UNION ALL
    SELECT input.ordinal, ''property_owner_dnc_fanout'', 100
    FROM input
    JOIN property_blocked AS blocked');
  IF position('dialer_dead_lead_block_v1' IN def) = 0 THEN
    RAISE EXCEPTION 'dead lead block site was not found';
  END IF;
  EXECUTE def;
END;
$dead$;

DO $campaign$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.campaign_contacts_block_reasons_v1(p_contact_ids uuid[])
    RETURNS TABLE(contact_id uuid, block_reason text)
    LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $body$
    BEGIN
      IF to_regclass('public.prospecting_campaign_member_contacts') IS NULL THEN
        RETURN QUERY SELECT ids.id, 'relationship_unknown'::text FROM unnest(coalesce(p_contact_ids, ARRAY[]::uuid[])) AS ids(id);
        RETURN;
      END IF;
      RETURN QUERY
      SELECT picked.contact_id, picked.block_reason
      FROM (
        SELECT scored.contact_id, scored.block_reason,
          row_number() OVER (PARTITION BY scored.contact_id ORDER BY scored.priority) AS rank
        FROM (
          SELECT contact.id AS contact_id, reason.block_reason,
            CASE reason.block_reason
              WHEN 'deceased_owner_line' THEN 88 WHEN 'associate' THEN 89 WHEN 'associate_non_family' THEN 90
              WHEN 'relationship_unknown' THEN 91 WHEN 'relative_not_allowed' THEN 92
              WHEN 'dead_manual_review_unread' THEN 76 WHEN 'lead_dnc' THEN 70 ELSE 100
            END AS priority
          FROM public.prospecting_campaign_member_contacts AS contact
          JOIN public.prospecting_campaign_members AS member ON member.id = contact.member_id
          JOIN public.prospecting_campaigns AS campaign ON campaign.id = member.campaign_id
          LEFT JOIN public.prospects AS prospect ON prospect.id = coalesce(contact.prospect_id, member.prospect_id)
          LEFT JOIN public.prospect_phones AS phone ON phone.id = contact.prospect_phone_id
          JOIN LATERAL (
            SELECT found.reason AS block_reason
            FROM (
              SELECT public.dialer_relationship_block_reason_v1(
                coalesce(phone.relationship, contact.relationship), prospect.owner_1_type,
                public.dialer_source_list_lanes_v1(prospect.id) || ARRAY[NULLIF(btrim(campaign.lane), '')],
                coalesce(phone.contact_name, contact.contact_name), prospect.owner_1, prospect.owner_1_last,
                prospect.is_skip_traced, phone.verified_source,
                public.dialer_prospect_deceased_v1(prospect.id), public.dialer_prospect_owner_first_v1(prospect.id)
              ) AS reason
              UNION ALL
              SELECT block.block_reason
              FROM public.source_list_phone_block_reasons_v1(ARRAY[contact.phone_snapshot], ARRAY[prospect.id]) AS block
            ) AS found
            WHERE found.reason IS NOT NULL
          ) AS reason ON true
          WHERE contact.id = ANY (coalesce(p_contact_ids, ARRAY[]::uuid[])) AND contact.status = 'ready'
        ) AS scored
        WHERE scored.block_reason IS NOT NULL
      ) AS picked
      WHERE picked.rank = 1;
    END;
    $body$
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.campaign_contacts_block_reasons_v1(uuid[]) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.campaign_contacts_block_reasons_v1(uuid[]) TO service_role';
  IF to_regclass('public.prospecting_campaign_member_contacts') IS NULL
    OR to_regprocedure('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)') IS NULL THEN
    RETURN;
  END IF;
  IF position('campaign_contacts_block_reasons_v1' IN pg_get_functiondef('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)'::regprocedure)) > 0 THEN
    RETURN;
  END IF;
  IF position('prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)' IN pg_get_functiondef('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'campaign offer check site was not found';
  END IF;
  EXECUTE replace(
    pg_get_functiondef('public.start_prospecting_dialer_session_v4(uuid, text, text, text, jsonb)'::regprocedure),
    'public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup)',
    'public.prospecting_dialer_phone_is_eligible_v1(contact.phone_snapshot, setup) AND NOT EXISTS (SELECT 1 FROM public.campaign_contacts_block_reasons_v1(ARRAY(SELECT ready.id FROM public.prospecting_campaign_member_contacts ready JOIN public.prospecting_campaign_members ready_member ON ready_member.id = ready.member_id WHERE ready_member.campaign_id = p_campaign_id AND ready.status = ''ready'')) blocked WHERE blocked.contact_id = contact.id)'
  );
  IF to_regprocedure('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)') IS NOT NULL
    AND position('campaign_contacts_block_reasons_v1' IN pg_get_functiondef('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)'::regprocedure)) = 0
    AND position('count(contact.id) FILTER (WHERE contact.status = ''ready'')' IN pg_get_functiondef('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)'::regprocedure)) > 0 THEN
    EXECUTE replace(
      pg_get_functiondef('public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamp with time zone, uuid)'::regprocedure),
      'count(contact.id) FILTER (WHERE contact.status = ''ready'')',
      'count(contact.id) FILTER (WHERE contact.status = ''ready'' AND NOT EXISTS (SELECT 1 FROM public.campaign_contacts_block_reasons_v1(ARRAY(SELECT ready.id FROM public.prospecting_campaign_member_contacts ready WHERE ready.member_id = member.id AND ready.status = ''ready'')) blocked WHERE blocked.contact_id = contact.id))'
    );
  END IF;
END;
$campaign$;
