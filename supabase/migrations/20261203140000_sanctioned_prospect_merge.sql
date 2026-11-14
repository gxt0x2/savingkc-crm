-- Sanctioned prospect merge.
--
-- prospects gain a survivor pointer. prospect_phones keep every row and
-- remember which prospect contributed them. merge_prospects_v1 re-points
-- phones, the lead link, and campaign members. It does not delete rows.
-- Dry run is the default and writes nothing.
--
-- crm_people.merged_into_id is a different table and is not used here.
--
-- PR #814 (cursor/dialer-suppression-labels-a40b) replaces
-- source_list_phone_block_reason_v1 and source_list_dialer_phone_review.
-- This migration does not redefine the block function. The review view
-- resolves phones with prospect_dial_subject_id_v1 and marks a merged
-- row merged_prospect. A rebase onto #814 has to keep both of those.

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
  'True for Friend, Coworker, Neighbor, Past neighbor, Landlord, and Tenant. In-law and Owner are not associate holds.';

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
        'id', item.id,
        'prospect_id', item.prospect_id,
        'lead_id', item.lead_id
      ) ORDER BY item.id)
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
  p_dry_run boolean DEFAULT true
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
      relationship_detail = COALESCE(phone.relationship_detail, source_prospect.owner_1_type),
      prospect_id = p_target,
      voice_hold = phone.voice_hold OR public.prospect_associate_relationship_v1(
        COALESCE(phone.relationship_detail, source_prospect.owner_1_type)
      ),
      voice_hold_reason = CASE
        WHEN phone.voice_hold IS TRUE THEN phone.voice_hold_reason
        WHEN public.prospect_associate_relationship_v1(COALESCE(phone.relationship_detail, source_prospect.owner_1_type))
          AND nullif(btrim(coalesce(phone.voice_hold_reason, '')), '') IS NULL
          THEN 'associate_relationship'
        ELSE phone.voice_hold_reason
      END,
      voice_hold_at = CASE
        WHEN phone.voice_hold_at IS NOT NULL THEN phone.voice_hold_at
        WHEN phone.voice_hold IS NOT TRUE
          AND public.prospect_associate_relationship_v1(COALESCE(phone.relationship_detail, source_prospect.owner_1_type))
          THEN clock_timestamp()
        ELSE phone.voice_hold_at
      END,
      voice_hold_by = CASE
        WHEN nullif(btrim(coalesce(phone.voice_hold_by, '')), '') IS NOT NULL THEN phone.voice_hold_by
        WHEN phone.voice_hold IS NOT TRUE
          AND public.prospect_associate_relationship_v1(COALESCE(phone.relationship_detail, source_prospect.owner_1_type))
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

COMMENT ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean) IS
  'Fold source prospects into a survivor. Re-points phones, one shared lead, and campaign members. Keeps every row. Does not clear voice hold fields or replace a protected DNC label. Associate phones (Friend, Coworker, Neighbor, Past neighbor, Landlord, Tenant) are forced onto voice hold. Dry run is the default.';

REVOKE ALL ON FUNCTION public.prospect_associate_relationship_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_disposition_protected_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_dial_subject_id_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_merge_state_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prospect_associate_relationship_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_disposition_protected_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_dial_subject_id_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.prospect_merge_state_v1(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_prospects_v1(uuid, uuid[], text, boolean) TO service_role;

CREATE OR REPLACE VIEW public.source_list_dialer_phone_review
WITH (security_invoker = true) AS
SELECT
  dialed.source_list_row_id,
  dialed.source_list_id,
  dialed.list_type,
  dialed.county,
  dialed.state,
  dialed.violation_kind,
  dialed.parcel_id,
  dialed.case_id,
  dialed.address,
  dialed.owner_names,
  dialed.amount_owed,
  dialed.property_id,
  dialed.prospect_id,
  dialed.row_status,
  dialed.phone_value,
  dialed.phone_e164,
  dialed.phone_origin,
  dialed.pull_date,
  dialed.source_file_name,
  CASE
    WHEN dialed.prospect_record_status = 'merged' THEN 'merged_prospect'
    ELSE public.source_list_phone_block_reason_v1(dialed.phone_value)
  END AS block_reason
FROM (
  SELECT DISTINCT ON (
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value))
  )
    row.id AS source_list_row_id,
    row.source_list_id,
    row.list_type,
    row.county,
    row.state,
    row.violation_kind,
    row.parcel_id,
    row.case_id,
    row.address,
    row.owner_names,
    row.amount_owed,
    row.property_id,
    row.prospect_id,
    prospect_subject.record_status AS prospect_record_status,
    row.status AS row_status,
    phone.phone_value,
    public.normalize_conversation_phone(phone.phone_value) AS phone_e164,
    phone.phone_origin,
    list.pull_date,
    list.source_file_name
  FROM public.source_list_rows AS row
  JOIN public.source_lists AS list ON list.id = row.source_list_id
  LEFT JOIN public.prospects AS prospect_subject ON prospect_subject.id = row.prospect_id
  CROSS JOIN LATERAL (
    SELECT phone_value, 'source_row'::text AS phone_origin
    FROM unnest(row.phones) AS phone_value
    WHERE nullif(btrim(phone_value), '') IS NOT NULL
    UNION ALL
    SELECT prospect_phone.phone, 'prospect_phone'::text
    FROM public.prospect_phones AS prospect_phone
    WHERE row.prospect_id IS NOT NULL
      AND (
        prospect_phone.prospect_id = public.prospect_dial_subject_id_v1(row.prospect_id)
        OR prospect_phone.prospect_id = row.prospect_id
      )
      AND nullif(btrim(prospect_phone.phone), '') IS NOT NULL
  ) AS phone
  WHERE row.status IN ('ready', 'loaded_to_dialer')
  ORDER BY
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
    (phone.phone_origin = 'prospect_phone') DESC
) AS dialed;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. A merged prospect is non-dialable (merged_prospect). Its phones are read through merged_into_id. Do not load the dialer from this view.';
