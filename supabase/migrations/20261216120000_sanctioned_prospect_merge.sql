-- Sanctioned prospect merge.
--
-- prospects gain a survivor pointer. prospect_phones keep every row and
-- remember which prospect contributed them. merge_prospects_v1 re-points
-- phones, the lead link, and campaign members. It does not delete rows.
-- Dry run is the default and writes nothing.
--
-- crm_people.merged_into_id is a different table and is not used here.
--
-- The review view is patched in place. It is not replaced from a copy of
-- main, so columns added by later dialer migrations stay:
--   #814 two-argument source_list_phone_block_reason_v1(phone, prospect_id)
--   #812 line_check_flag
--   #817 market-check columns (requires_licensee_disclosure and the rest)
-- Rebase order when those land: #814, then #812, then #817, then this
-- migration. prospect_merge_patch_review_view_v1() can be run again if a
-- later migration replaces the view.
--
-- EXC-002 voice holds: associate_non_family, relationship_unknown,
-- relationship_detail Unknown when the phone is not the owner, and
-- entity_contact without officer or member proof. Other Relative is family.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS merged_into_id uuid,
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_at timestamptz,
  ADD COLUMN IF NOT EXISTS merged_by text;

ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_merged_into_id_fkey;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_merged_into_id_fkey
  FOREIGN KEY (merged_into_id) REFERENCES public.prospects(id) NOT VALID;
ALTER TABLE public.prospects
  VALIDATE CONSTRAINT prospects_merged_into_id_fkey;

ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_record_status_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_record_status_check
  CHECK (record_status IN ('active', 'merged')) NOT VALID;
ALTER TABLE public.prospects
  VALIDATE CONSTRAINT prospects_record_status_check;

ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_merged_into_not_self_check;
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_merged_into_not_self_check
  CHECK (merged_into_id <> id) NOT VALID;
ALTER TABLE public.prospects
  VALIDATE CONSTRAINT prospects_merged_into_not_self_check;

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS source_prospect_id uuid,
  ADD COLUMN IF NOT EXISTS relationship_detail text;

ALTER TABLE public.prospect_phones
  DROP CONSTRAINT IF EXISTS prospect_phones_source_prospect_id_fkey;
ALTER TABLE public.prospect_phones
  ADD CONSTRAINT prospect_phones_source_prospect_id_fkey
  FOREIGN KEY (source_prospect_id) REFERENCES public.prospects(id) NOT VALID;
ALTER TABLE public.prospect_phones
  VALIDATE CONSTRAINT prospect_phones_source_prospect_id_fkey;

CREATE INDEX IF NOT EXISTS idx_prospects_merged_into_id
  ON public.prospects (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_phones_source_prospect_id
  ON public.prospect_phones (source_prospect_id)
  WHERE source_prospect_id IS NOT NULL;

COMMENT ON COLUMN public.prospects.merged_into_id IS
  'Surviving prospect after a sanctioned merge. Null while record_status is active.';
COMMENT ON COLUMN public.prospects.record_status IS
  'active, or merged when this row has been folded into merged_into_id. Merged rows are not dialable.';
COMMENT ON COLUMN public.prospects.merged_at IS
  'When this prospect was merged into the survivor.';
COMMENT ON COLUMN public.prospects.merged_by IS
  'Actor recorded by merge_prospects_v1.';
COMMENT ON COLUMN public.prospect_phones.source_prospect_id IS
  'Prospect that owned this phone before a sanctioned merge. Null when the phone has always been on its current prospect.';
COMMENT ON COLUMN public.prospect_phones.relationship_detail IS
  'owner_1_type from the contributing prospect (Friend, Coworker, In-law, and the rest). Kept when the phone is re-pointed.';

CREATE OR REPLACE FUNCTION public.prospect_associate_relationship_v1(p_detail text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT regexp_replace(lower(btrim(coalesce(p_detail, ''))), '[[:space:]-]+', '_', 'g') = ANY (
    ARRAY['friend', 'coworker', 'neighbor', 'past_neighbor', 'landlord', 'tenant']
  );
$function$;

COMMENT ON FUNCTION public.prospect_associate_relationship_v1(text) IS
  'EXC-002 associate_non_family. True for Friend, Coworker, Neighbor, Past neighbor, Landlord, and Tenant.';

CREATE OR REPLACE FUNCTION public.prospect_relationship_label_v1(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT nullif(
    regexp_replace(lower(btrim(coalesce(p_label, ''))), '[[:space:]-]+', '_', 'g'),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.prospect_voice_hold_force_v1(
  p_relationship text,
  p_relationship_detail text,
  p_owner_type text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH labels AS (
    SELECT ARRAY_REMOVE(ARRAY[
      public.prospect_relationship_label_v1(p_relationship),
      public.prospect_relationship_label_v1(p_relationship_detail),
      public.prospect_relationship_label_v1(p_owner_type)
    ], NULL) AS label
  )
  SELECT CASE
    WHEN public.prospect_associate_relationship_v1(p_relationship)
      OR public.prospect_associate_relationship_v1(p_relationship_detail)
      OR public.prospect_associate_relationship_v1(p_owner_type)
      THEN 'associate_relationship'
    WHEN label && ARRAY['entity_contact', 'entity', 'llc', 'trust', 'company', 'corporation']
      AND NOT label && ARRAY['officer', 'member', 'manager', 'registered_agent']
      THEN 'entity_contact'
    WHEN public.prospect_relationship_label_v1(p_relationship) = 'relationship_unknown'
      OR public.prospect_relationship_label_v1(p_relationship_detail) = 'relationship_unknown'
      OR (
        public.prospect_relationship_label_v1(p_relationship_detail) = 'unknown'
        AND public.prospect_relationship_label_v1(p_relationship) IS DISTINCT FROM 'owner'
        AND public.prospect_relationship_label_v1(p_relationship) IS DISTINCT FROM 'self'
      )
      THEN 'relationship_unknown'
    ELSE NULL
  END
  FROM labels;
$function$;

COMMENT ON FUNCTION public.prospect_voice_hold_force_v1(text, text, text) IS
  'EXC-002 force reason, or null. Other Relative, In-law, Spouse, and Owner are not forced. Unknown is forced only when the phone is not the owner. entity_contact is forced unless officer or member proof is present.';

CREATE OR REPLACE FUNCTION public.prospect_property_match_v1(
  p_left_parcel text,
  p_left_county text,
  p_left_street text,
  p_left_zip text,
  p_right_parcel text,
  p_right_county text,
  p_right_street text,
  p_right_zip text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  WITH norm AS (
    SELECT
      nullif(regexp_replace(lower(btrim(coalesce(p_left_parcel, ''))), '[^[:alnum:]]+', '', 'g'), '') AS left_parcel,
      nullif(regexp_replace(lower(btrim(coalesce(p_right_parcel, ''))), '[^[:alnum:]]+', '', 'g'), '') AS right_parcel,
      nullif(lower(btrim(coalesce(p_left_county, ''))), '') AS left_county,
      nullif(lower(btrim(coalesce(p_right_county, ''))), '') AS right_county,
      nullif(btrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p_left_street, ''))), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '') AS left_street,
      nullif(btrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p_right_street, ''))), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '') AS right_street,
      nullif(left(regexp_replace(coalesce(p_left_zip, ''), '[^0-9]', '', 'g'), 5), '') AS left_zip,
      nullif(left(regexp_replace(coalesce(p_right_zip, ''), '[^0-9]', '', 'g'), 5), '') AS right_zip
  )
  SELECT CASE
    WHEN left_parcel IS NOT NULL AND right_parcel IS NOT NULL THEN left_parcel = right_parcel
    WHEN left_county IS NULL OR right_county IS NULL
      OR left_street IS NULL OR right_street IS NULL
      OR left_zip IS NULL OR right_zip IS NULL THEN false
    ELSE left_county = right_county AND left_street = right_street AND left_zip = right_zip
  END
  FROM norm;
$function$;

COMMENT ON FUNCTION public.prospect_property_match_v1(text, text, text, text, text, text, text, text) IS
  'Same property when both parcel ids are present and equal, otherwise county + normalized situs street + zip. An incomplete fallback key does not match.';

CREATE OR REPLACE FUNCTION public.prospect_disposition_protected_v1(p_label text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  classified text;
BEGIN
  -- PR #814 owns this set once dialer_suppression_class_v1 exists.
  -- Until then, use the never-downgrade labels from apply_mojo_dial_phone_stamp_v1.
  IF to_regprocedure('public.dialer_suppression_class_v1(text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.dialer_suppression_class_v1($1, $2)'
      INTO classified
      USING 'never_downgrade', p_label;
    RETURN coalesce(classified = 'protected', false);
  END IF;

  RETURN regexp_replace(lower(btrim(coalesce(p_label, ''))), '[[:space:]-]+', '_', 'g') = ANY (
    ARRAY['dnc', 'do_not_call', 'dnc_contact', 'dnc_number', 'take_me_off', 'dead']
  );
END
$function$;

COMMENT ON FUNCTION public.prospect_disposition_protected_v1(text) IS
  'True when a phone disposition must not be replaced by a weaker label. Uses dialer_suppression_class_v1(never_downgrade) when that function exists.';

CREATE OR REPLACE FUNCTION public.prospect_dial_subject_id_v1(p_prospect_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH RECURSIVE chain AS (
    SELECT prospect.id, prospect.merged_into_id, prospect.record_status, 0 AS depth
    FROM public.prospects AS prospect
    WHERE prospect.id = p_prospect_id
    UNION ALL
    SELECT next_prospect.id, next_prospect.merged_into_id, next_prospect.record_status, chain.depth + 1
    FROM chain
    JOIN public.prospects AS next_prospect ON next_prospect.id = chain.merged_into_id
    WHERE chain.record_status = 'merged'
      AND chain.merged_into_id IS NOT NULL
      AND chain.depth < 8
  )
  SELECT chain.id
  FROM chain
  ORDER BY chain.depth DESC
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.prospect_dial_subject_id_v1(uuid) IS
  'Active survivor for a prospect. Follows merged_into_id up to 8 hops.';

CREATE OR REPLACE FUNCTION public.prospect_merge_state_v1(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'prospects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', prospect.id,
        'record_status', prospect.record_status,
        'merged_into_id', prospect.merged_into_id,
        'merged_at', prospect.merged_at,
        'merged_by', prospect.merged_by,
        'lead_id', prospect.lead_id,
        'owner_1_type', prospect.owner_1_type
      ) ORDER BY prospect.id)
      FROM public.prospects AS prospect
      WHERE prospect.id = ANY (p_ids)
    ), '[]'::jsonb),
    'phones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', phone.id,
        'prospect_id', phone.prospect_id,
        'source_prospect_id', phone.source_prospect_id,
        'relationship', phone.relationship,
        'relationship_detail', phone.relationship_detail,
        'phone', phone.phone,
        'voice_hold', phone.voice_hold,
        'voice_hold_reason', phone.voice_hold_reason,
        'voice_hold_at', phone.voice_hold_at,
        'voice_hold_by', phone.voice_hold_by,
        'last_disposition', phone.last_disposition
      ) ORDER BY phone.id)
      FROM public.prospect_phones AS phone
      WHERE phone.prospect_id = ANY (p_ids)
         OR phone.source_prospect_id = ANY (p_ids)
    ), '[]'::jsonb),
    'lead_activities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', activity.id,
        'lead_id', activity.lead_id,
        'prospect_id', activity.prospect_id
      ) ORDER BY activity.id)
      FROM public.lead_activities AS activity
      WHERE activity.prospect_id = ANY (p_ids)
    ), '[]'::jsonb),
    'work_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'work_item_key', item.work_item_key,
        'prospect_id', item.prospect_id,
        'lead_id', item.lead_id
      ) ORDER BY item.work_item_key)
      FROM public.work_items AS item
      WHERE item.prospect_id = ANY (p_ids)
    ), '[]'::jsonb),
    'campaign_members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', member.id,
        'campaign_id', member.campaign_id,
        'prospect_id', member.prospect_id,
        'status', member.status,
        'suppression_reason', member.suppression_reason
      ) ORDER BY member.id)
      FROM public.prospecting_campaign_members AS member
      WHERE member.prospect_id = ANY (p_ids)
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.prospect_merge_state_v1(uuid[]) IS
  'Before/after snapshot for merge_prospects_v1. Reads the survivor set and phones that still name a source.';

CREATE OR REPLACE FUNCTION public.merge_prospects_v1(
  p_target uuid,
  p_sources uuid[],
  p_by text,
  p_dry_run boolean DEFAULT true,
  p_allow_cross_property boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_sources uuid[];
  v_scope uuid[];
  v_pending uuid[];
  v_target public.prospects%ROWTYPE;
  v_shared_lead uuid;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_phone_total bigint;
  v_prospect_total bigint;
  v_member_total bigint;
  v_activity_total bigint;
  v_work_item_total bigint;
  v_phones_reponted integer := 0;
  v_leads_reponted integer := 0;
  v_members_reponted integer := 0;
  v_members_left integer := 0;
  v_prospects_merged integer := 0;
  v_dry_run boolean := p_dry_run IS DISTINCT FROM false;
  v_allow_cross_property boolean := p_allow_cross_property IS TRUE;
  v_cross_property jsonb := '[]'::jsonb;
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'prospect_merge_target_required';
  END IF;
  IF p_sources IS NULL OR cardinality(p_sources) < 1 THEN
    RAISE EXCEPTION 'prospect_merge_sources_required';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_sources) AS source_id WHERE source_id IS NULL) THEN
    RAISE EXCEPTION 'prospect_merge_unknown_source';
  END IF;
  IF nullif(btrim(coalesce(p_by, '')), '') IS NULL THEN
    RAISE EXCEPTION 'prospect_merge_actor_required';
  END IF;
  IF p_target = ANY (p_sources) THEN
    RAISE EXCEPTION 'prospect_merge_target_in_sources';
  END IF;

  v_sources := ARRAY(
    SELECT DISTINCT source_id
    FROM unnest(p_sources) AS source_id
    ORDER BY source_id
  );
  v_scope := ARRAY(
    SELECT DISTINCT scoped.id
    FROM (SELECT p_target AS id UNION SELECT unnest(v_sources)) AS scoped
    ORDER BY scoped.id
  );

  PERFORM prospect.id
  FROM public.prospects AS prospect
  WHERE prospect.id = ANY (v_scope)
  ORDER BY prospect.id
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.prospects WHERE id = p_target) THEN
    RAISE EXCEPTION 'prospect_merge_target_missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_sources) AS source_id
    WHERE NOT EXISTS (SELECT 1 FROM public.prospects WHERE id = source_id)
  ) THEN
    RAISE EXCEPTION 'prospect_merge_unknown_source';
  END IF;

  SELECT * INTO v_target FROM public.prospects WHERE id = p_target;
  IF v_target.record_status = 'merged' OR v_target.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'prospect_merge_target_merged';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.prospects AS source
    WHERE source.id = ANY (v_sources)
      AND source.merged_into_id IS NOT NULL
      AND source.merged_into_id IS DISTINCT FROM p_target
  ) THEN
    RAISE EXCEPTION 'prospect_merge_source_already_merged';
  END IF;

  v_pending := ARRAY(
    SELECT source.id
    FROM public.prospects AS source
    WHERE source.id = ANY (v_sources)
      AND NOT (source.record_status = 'merged' AND source.merged_into_id = p_target)
    ORDER BY source.id
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_id', source.id,
    'source_parcel', source.parcel_id,
    'source_county', source.county,
    'source_street', source.situs_street,
    'source_zip', source.situs_zip,
    'target_parcel', target.parcel_id,
    'target_county', target.county,
    'target_street', target.situs_street,
    'target_zip', target.situs_zip
  ) ORDER BY source.id), '[]'::jsonb)
    INTO v_cross_property
  FROM public.prospects AS source
  JOIN public.prospects AS target ON target.id = p_target
  WHERE source.id = ANY (v_pending)
    AND NOT public.prospect_property_match_v1(
      target.parcel_id, target.county, target.situs_street, target.situs_zip,
      source.parcel_id, source.county, source.situs_street, source.situs_zip
    );
  IF jsonb_array_length(v_cross_property) > 0 AND NOT v_allow_cross_property THEN
    RAISE EXCEPTION 'prospect_merge_cross_property';
  END IF;

  v_phone_total := (SELECT count(*) FROM public.prospect_phones);
  v_prospect_total := (SELECT count(*) FROM public.prospects);
  v_member_total := (SELECT count(*) FROM public.prospecting_campaign_members);
  v_activity_total := (SELECT count(*) FROM public.lead_activities);
  v_work_item_total := (SELECT count(*) FROM public.work_items);
  v_before := public.prospect_merge_state_v1(v_scope);

  BEGIN
    UPDATE public.prospect_phones AS phone
    SET
      source_prospect_id = COALESCE(phone.source_prospect_id, phone.prospect_id),
      relationship_detail = COALESCE(phone.relationship_detail, phone.relationship, source_prospect.owner_1_type),
      relationship = COALESCE(phone.relationship, phone.relationship_detail, source_prospect.owner_1_type),
      prospect_id = p_target,
      voice_hold = phone.voice_hold OR public.prospect_voice_hold_force_v1(
        phone.relationship, phone.relationship_detail, source_prospect.owner_1_type
      ) IS NOT NULL,
      voice_hold_reason = CASE
        WHEN phone.voice_hold IS TRUE THEN phone.voice_hold_reason
        WHEN nullif(btrim(coalesce(phone.voice_hold_reason, '')), '') IS NOT NULL THEN phone.voice_hold_reason
        ELSE COALESCE(
          public.prospect_voice_hold_force_v1(phone.relationship, phone.relationship_detail, source_prospect.owner_1_type),
          phone.voice_hold_reason
        )
      END,
      voice_hold_at = CASE
        WHEN phone.voice_hold_at IS NOT NULL THEN phone.voice_hold_at
        WHEN phone.voice_hold IS NOT TRUE
          AND public.prospect_voice_hold_force_v1(phone.relationship, phone.relationship_detail, source_prospect.owner_1_type) IS NOT NULL
          THEN clock_timestamp()
        ELSE phone.voice_hold_at
      END,
      voice_hold_by = CASE
        WHEN nullif(btrim(coalesce(phone.voice_hold_by, '')), '') IS NOT NULL THEN phone.voice_hold_by
        WHEN phone.voice_hold IS NOT TRUE
          AND public.prospect_voice_hold_force_v1(phone.relationship, phone.relationship_detail, source_prospect.owner_1_type) IS NOT NULL
          THEN btrim(p_by)
        ELSE phone.voice_hold_by
      END
    FROM public.prospects AS source_prospect
    WHERE phone.prospect_id = source_prospect.id
      AND source_prospect.id = ANY (v_pending);

    WITH ranked AS (
      SELECT
        member.id,
        row_number() OVER (
          PARTITION BY member.campaign_id
          ORDER BY member.enrolled_at NULLS LAST, member.id
        ) AS rn
      FROM public.prospecting_campaign_members AS member
      WHERE member.prospect_id = ANY (v_pending)
        AND member.subject_kind = 'prospect'
        AND NOT EXISTS (
          SELECT 1
          FROM public.prospecting_campaign_members AS existing
          WHERE existing.campaign_id = member.campaign_id
            AND existing.subject_kind = 'prospect'
            AND existing.prospect_id = p_target
            AND existing.id <> member.id
        )
    )
    UPDATE public.prospecting_campaign_members AS member
    SET prospect_id = p_target,
        updated_at = clock_timestamp()
    FROM ranked
    WHERE member.id = ranked.id
      AND ranked.rn = 1;

    UPDATE public.prospecting_campaign_members AS member
    SET status = 'suppressed',
        suppression_reason = COALESCE(member.suppression_reason, 'prospect_merged'),
        updated_at = clock_timestamp()
    WHERE member.prospect_id = ANY (v_pending)
      AND member.subject_kind = 'prospect'
      AND member.status IN ('active', 'needs_review');

    UPDATE public.prospecting_campaign_member_contacts AS contact
    SET prospect_id = p_target,
        updated_at = clock_timestamp()
    WHERE contact.prospect_id = ANY (v_pending);

    UPDATE public.prospecting_campaign_actions AS action
    SET prospect_id = p_target,
        updated_at = clock_timestamp()
    WHERE action.prospect_id = ANY (v_pending);

    UPDATE public.lead_activities AS activity
    SET prospect_id = p_target
    WHERE activity.prospect_id = ANY (v_pending);

    UPDATE public.work_items AS item
    SET prospect_id = p_target
    WHERE item.prospect_id = ANY (v_pending);

    IF v_target.lead_id IS NULL AND (
      SELECT count(DISTINCT source.lead_id)
      FROM public.prospects AS source
      WHERE source.id = ANY (v_pending)
        AND source.lead_id IS NOT NULL
    ) = 1 THEN
      SELECT min(source.lead_id::text)::uuid
        INTO v_shared_lead
      FROM public.prospects AS source
      WHERE source.id = ANY (v_pending)
        AND source.lead_id IS NOT NULL;
    END IF;

    IF v_shared_lead IS NOT NULL THEN
      UPDATE public.prospects
      SET lead_id = v_shared_lead,
          updated_at = clock_timestamp()
      WHERE id = p_target
        AND lead_id IS NULL;

      UPDATE public.prospects
      SET lead_id = NULL,
          updated_at = clock_timestamp()
      WHERE id = ANY (v_pending)
        AND lead_id = v_shared_lead;
    END IF;

    UPDATE public.prospects AS source
    SET record_status = 'merged',
        merged_into_id = p_target,
        merged_at = COALESCE(source.merged_at, clock_timestamp()),
        merged_by = COALESCE(source.merged_by, btrim(p_by)),
        updated_at = clock_timestamp()
    WHERE source.id = ANY (v_pending);

    IF (SELECT count(*) FROM public.prospect_phones) <> v_phone_total
      OR (SELECT count(*) FROM public.prospects) <> v_prospect_total
      OR (SELECT count(*) FROM public.prospecting_campaign_members) <> v_member_total
      OR (SELECT count(*) FROM public.lead_activities) <> v_activity_total
      OR (SELECT count(*) FROM public.work_items) <> v_work_item_total
    THEN
      RAISE EXCEPTION 'prospect_merge_deleted_rows';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_before -> 'phones') AS prior(
        id uuid,
        voice_hold boolean,
        voice_hold_reason text,
        voice_hold_at timestamptz,
        voice_hold_by text,
        last_disposition text
      )
      JOIN public.prospect_phones AS phone ON phone.id = prior.id
      WHERE (
        public.prospect_disposition_protected_v1(prior.last_disposition)
        AND phone.last_disposition IS DISTINCT FROM prior.last_disposition
      )
      OR (prior.voice_hold IS TRUE AND phone.voice_hold IS DISTINCT FROM true)
      OR (
        nullif(btrim(coalesce(prior.voice_hold_reason, '')), '') IS NOT NULL
        AND phone.voice_hold_reason IS DISTINCT FROM prior.voice_hold_reason
      )
      OR (prior.voice_hold_at IS NOT NULL AND phone.voice_hold_at IS DISTINCT FROM prior.voice_hold_at)
      OR (
        nullif(btrim(coalesce(prior.voice_hold_by, '')), '') IS NOT NULL
        AND phone.voice_hold_by IS DISTINCT FROM prior.voice_hold_by
      )
    ) THEN
      RAISE EXCEPTION 'prospect_merge_hold_or_dnc_changed';
    END IF;

    v_after := public.prospect_merge_state_v1(v_scope);

    SELECT
      (SELECT count(*)::integer
        FROM jsonb_to_recordset(v_before -> 'phones') AS prior(id uuid, prospect_id uuid)
        JOIN jsonb_to_recordset(v_after -> 'phones') AS later(id uuid, prospect_id uuid) ON later.id = prior.id
        WHERE later.prospect_id IS DISTINCT FROM prior.prospect_id),
      (SELECT count(*)::integer
        FROM jsonb_to_recordset(v_before -> 'prospects') AS prior(id uuid, lead_id uuid)
        JOIN jsonb_to_recordset(v_after -> 'prospects') AS later(id uuid, lead_id uuid) ON later.id = prior.id
        WHERE later.lead_id IS DISTINCT FROM prior.lead_id),
      (SELECT count(*)::integer
        FROM jsonb_to_recordset(v_before -> 'campaign_members') AS prior(id uuid, prospect_id uuid)
        JOIN jsonb_to_recordset(v_after -> 'campaign_members') AS later(id uuid, prospect_id uuid) ON later.id = prior.id
        WHERE later.prospect_id IS DISTINCT FROM prior.prospect_id),
      (SELECT count(*)::integer
        FROM jsonb_to_recordset(v_after -> 'campaign_members') AS later(id uuid, prospect_id uuid)
        WHERE later.prospect_id = ANY (v_sources)),
      (SELECT count(*)::integer
        FROM jsonb_to_recordset(v_before -> 'prospects') AS prior(id uuid, record_status text)
        JOIN jsonb_to_recordset(v_after -> 'prospects') AS later(id uuid, record_status text, merged_into_id uuid)
          ON later.id = prior.id
        WHERE prior.record_status IS DISTINCT FROM 'merged'
          AND later.record_status = 'merged'
          AND later.merged_into_id = p_target)
    INTO v_phones_reponted, v_leads_reponted, v_members_reponted, v_members_left, v_prospects_merged;

    v_result := jsonb_build_object(
      'dry_run', v_dry_run,
      'target_id', p_target,
      'merged_by', btrim(p_by),
      'allow_cross_property', v_allow_cross_property,
      'cross_property_overrides', v_cross_property,
      'before', v_before,
      'after', v_after,
      'counts', jsonb_build_object(
        'phones_reponted', v_phones_reponted,
        'phones_deleted', 0,
        'prospects_deleted', 0,
        'leads_reponted', v_leads_reponted,
        'campaign_members_reponted', v_members_reponted,
        'campaign_members_left_on_source', v_members_left,
        'prospects_merged', v_prospects_merged
      )
    );

    IF v_dry_run THEN
      RAISE EXCEPTION 'prospect_merge_dry_run' USING ERRCODE = 'P0004';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0004' THEN
      RETURN v_result;
  END;

  RETURN v_result;
END
$function$;

COMMENT ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean, boolean) IS
  'Fold source prospects into a survivor on the same property. p_allow_cross_property defaults false and is recorded on the diff when true. Re-points phones, one shared lead, and campaign members. Keeps every row, including relationship and relationship_detail. Does not clear voice hold fields or replace a protected DNC label. EXC-002 associate, unknown, and unproved entity contacts are forced onto voice hold. Dry run is the default.';

REVOKE ALL ON FUNCTION public.prospect_associate_relationship_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_relationship_label_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_voice_hold_force_v1(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_property_match_v1(text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_disposition_protected_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_dial_subject_id_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_merge_state_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prospect_associate_relationship_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_relationship_label_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_voice_hold_force_v1(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_property_match_v1(text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_disposition_protected_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_dial_subject_id_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_merge_state_v1(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean, boolean) TO service_role;

-- Delegate until #814/#812 install the real two-argument scrub. Do not
-- replace that function when it is already present.
DO $delegate$
BEGIN
  IF to_regprocedure('public.source_list_phone_block_reason_v1(text,uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.source_list_phone_block_reason_v1(p_phone text, p_prospect_id uuid)
      RETURNS text
      LANGUAGE sql
      STABLE
      SET search_path = pg_catalog, public
      AS $body$
        SELECT public.source_list_phone_block_reason_v1(p_phone);
      $body$
    $fn$;
    REVOKE ALL ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) TO service_role;
  END IF;
END
$delegate$;

CREATE OR REPLACE FUNCTION public.prospect_merge_patch_review_view_v1()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  view_sql text;
BEGIN
  -- pg_get_viewdef quotes the reserved name "row" and drops the dialed. alias,
  -- so the live text is prospect_phone.prospect_id = "row".prospect_id and
  -- source_list_phone_block_reason_v1(phone_value) or (phone_value, prospect_id).
  -- The replacement keeps the two-argument call source_list_phone_block_reason_v1(phone, prospect_id).
  view_sql := pg_catalog.pg_get_viewdef('public.source_list_dialer_phone_review'::regclass, true);
  IF view_sql NOT LIKE '%prospect_dial_subject_id_v1%' THEN
    IF view_sql !~ 'prospect_phone\.prospect_id\s*=\s*"?row"?\.prospect_id' THEN
      RAISE EXCEPTION 'prospect_merge_review_view_join_not_found';
    END IF;
    view_sql := regexp_replace(
      view_sql,
      'prospect_phone\.prospect_id\s*=\s*("?row"?\.prospect_id)',
      '(prospect_phone.prospect_id = public.prospect_dial_subject_id_v1(\1) OR prospect_phone.prospect_id = \1)',
      'g'
    );
  END IF;
  IF view_sql NOT LIKE '%merged_prospect%' THEN
    IF view_sql ~ 'source_list_phone_block_reason_v1\s*\([^)]*,' THEN
      view_sql := regexp_replace(
        view_sql,
        '(?:public\.)?source_list_phone_block_reason_v1\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)',
        '(CASE WHEN EXISTS (SELECT 1 FROM public.prospects AS merged_row WHERE merged_row.id = \2 AND merged_row.record_status = ''merged'') THEN ''merged_prospect'' ELSE public.source_list_phone_block_reason_v1(\1, \2) END)',
        'g'
      );
    ELSIF view_sql ~ 'source_list_phone_block_reason_v1\s*\(' THEN
      view_sql := regexp_replace(
        view_sql,
        '(?:public\.)?source_list_phone_block_reason_v1\s*\(\s*((?:dialed\.)?)phone_value\s*\)',
        '(CASE WHEN EXISTS (SELECT 1 FROM public.prospects AS merged_row WHERE merged_row.id = \1prospect_id AND merged_row.record_status = ''merged'') THEN ''merged_prospect'' ELSE public.source_list_phone_block_reason_v1(\1phone_value, \1prospect_id) END)',
        'g'
      );
    ELSE
      RAISE EXCEPTION 'prospect_merge_review_view_block_not_found';
    END IF;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.source_list_dialer_phone_review WITH (security_invoker = true) AS ' || view_sql;
END
$function$;

COMMENT ON FUNCTION public.prospect_merge_patch_review_view_v1() IS
  'Patches the current dialer review view. Keeps line_check_flag and any other columns already on the view. Calls source_list_phone_block_reason_v1(phone, prospect_id) and adds merged_prospect plus prospect_dial_subject_id_v1.';

REVOKE ALL ON FUNCTION public.prospect_merge_patch_review_view_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospect_merge_patch_review_view_v1() TO service_role;

SELECT public.prospect_merge_patch_review_view_v1();

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. A merged prospect is non-dialable (merged_prospect). Its phones are read through merged_into_id. Extra columns from the line-check and market-check views are left in place. Do not load the dialer from this view.';
