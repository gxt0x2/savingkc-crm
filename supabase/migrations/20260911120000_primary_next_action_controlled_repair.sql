-- Controlled repair for active opportunities that have no primary next action.
--
-- This migration creates server-only census, promotion, and immediate rollback
-- functions. It does not change task rows when applied. Promotion remains a
-- separate, explicit operation guarded by exact counts and an opaque fingerprint.
-- hygiene-approved-destructive: the server-only rollback function can demote only this repair's fingerprint-locked task metadata; migration application itself mutates no task rows.

CREATE OR REPLACE FUNCTION public.primary_next_action_repair_census_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH active_opportunities AS MATERIALIZED (
    SELECT lead.id
    FROM public.leads AS lead
    WHERE public.lead_is_active_opportunity_v1(lead.id)
  ), missing_primary AS MATERIALIZED (
    SELECT active.id AS lead_id
    FROM active_opportunities AS active
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.work_items AS item
      WHERE item.lead_id = active.id
        AND item.operational_lane = 'current'
        AND item.status IN ('pending', 'blocked')
        AND item.primary_next_action = true
    )
  ), current_nonprimary AS MATERIALIZED (
    SELECT
      item.work_item_key,
      item.source_id,
      item.lead_id,
      item.updated_at,
      public.task_provenance_class_v1(item.source_metadata) AS provenance_class,
      lower(trim(coalesce(item.source_metadata ->> 'source', ''))) AS source_name
    FROM public.work_items AS item
    JOIN missing_primary AS missing ON missing.lead_id = item.lead_id
    WHERE item.source_kind = 'activity'
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = false
  ), trustworthy AS MATERIALIZED (
    SELECT candidate.*
    FROM current_nonprimary AS candidate
    WHERE candidate.provenance_class IN ('governed_human', 'legacy_operator')
  ), candidate_counts AS MATERIALIZED (
    SELECT candidate.lead_id, count(*)::integer AS candidate_count
    FROM trustworthy AS candidate
    GROUP BY candidate.lead_id
  ), eligible AS MATERIALIZED (
    SELECT candidate.*
    FROM trustworthy AS candidate
    JOIN candidate_counts AS counts USING (lead_id)
    WHERE counts.candidate_count = 1
  )
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'missingPrimary', (SELECT count(*)::integer FROM missing_primary),
    'currentNonPrimaryRows', (SELECT count(*)::integer FROM current_nonprimary),
    'eligiblePromotions', (SELECT count(*)::integer FROM eligible),
    'leadsWithNoTrustworthyCandidate', (
      SELECT count(*)::integer
      FROM missing_primary AS missing
      LEFT JOIN candidate_counts AS counts USING (lead_id)
      WHERE coalesce(counts.candidate_count, 0) = 0
    ),
    'leadsWithMultipleTrustworthyCandidates', (
      SELECT count(*)::integer
      FROM candidate_counts
      WHERE candidate_count > 1
    ),
    'eligibleFingerprint', (
      SELECT md5(string_agg(
        eligible.lead_id::text || ':' || eligible.source_id::text || ':' || eligible.updated_at::text,
        ',' ORDER BY eligible.lead_id, eligible.source_id
      ))
      FROM eligible
    ),
    'eligibleByProvenance', coalesce((
      SELECT jsonb_object_agg(grouped.provenance_class, grouped.row_count)
      FROM (
        SELECT eligible.provenance_class, count(*)::integer AS row_count
        FROM eligible
        GROUP BY eligible.provenance_class
      ) AS grouped
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.primary_next_action_repair_census_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.primary_next_action_repair_census_v1()
  TO service_role;

CREATE OR REPLACE FUNCTION public.promote_existing_operator_primary_next_actions_v1(
  p_expected_missing integer,
  p_expected_eligible integer,
  p_expected_fingerprint text,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  census jsonb;
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_fingerprint text := lower(trim(coalesce(p_expected_fingerprint, '')));
  repaired_count integer;
  changed_count integer;
  candidate_fingerprint text;
  post_repair_fingerprint text;
  summary jsonb;
BEGIN
  IF clean_actor = '' THEN
    RAISE EXCEPTION 'repair_actor_required';
  END IF;
  IF p_expected_missing < 1 OR p_expected_eligible < 1 THEN
    RAISE EXCEPTION 'repair_expected_counts_invalid';
  END IF;
  IF clean_fingerprint !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'repair_fingerprint_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-next-action-controlled-repair-v1', 0)
  );
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '15s', true);
  LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.lead_activities IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.work_items IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*)::integer
  INTO repaired_count
  FROM public.work_items AS item
  WHERE item.source_kind = 'activity'
    AND item.operational_lane = 'current'
    AND item.status IN ('pending', 'blocked')
    AND item.primary_next_action = true
    AND item.source_metadata ->> 'primary_next_action_repair' = 'existing_operator_task_v1'
    AND item.source_metadata ->> 'primary_next_action_repair_batch' = clean_fingerprint;

  IF repaired_count = p_expected_eligible THEN
    SELECT md5(string_agg(
      item.lead_id::text || ':' || item.source_id::text || ':' || item.updated_at::text,
      ',' ORDER BY item.lead_id, item.source_id
    ))
    INTO post_repair_fingerprint
    FROM public.work_items AS item
    WHERE item.source_kind = 'activity'
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = true
      AND item.source_metadata ->> 'primary_next_action_repair' = 'existing_operator_task_v1'
      AND item.source_metadata ->> 'primary_next_action_repair_batch' = clean_fingerprint;

    RETURN jsonb_build_object(
      'changed', false,
      'alreadyApplied', true,
      'promoted', repaired_count,
      'batchFingerprint', clean_fingerprint,
      'postRepairFingerprint', post_repair_fingerprint,
      'integrity', public.primary_next_action_integrity_summary_v1()
    );
  ELSIF repaired_count > 0 THEN
    RAISE EXCEPTION 'repair_partial_state_detected';
  END IF;

  census := public.primary_next_action_repair_census_v1();
  IF (census ->> 'missingPrimary')::integer <> p_expected_missing
    OR (census ->> 'eligiblePromotions')::integer <> p_expected_eligible
    OR coalesce(census ->> 'eligibleFingerprint', '') <> clean_fingerprint THEN
    RAISE EXCEPTION 'repair_census_drift';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS primary_next_action_repair_candidates_v1 (
    work_item_key text PRIMARY KEY,
    source_id uuid NOT NULL UNIQUE,
    lead_id uuid NOT NULL UNIQUE,
    candidate_updated_at timestamptz NOT NULL,
    previous_state jsonb NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE primary_next_action_repair_candidates_v1;

  INSERT INTO primary_next_action_repair_candidates_v1 (
    work_item_key, source_id, lead_id, candidate_updated_at, previous_state
  )
  WITH active_opportunities AS MATERIALIZED (
    SELECT lead.id
    FROM public.leads AS lead
    WHERE public.lead_is_active_opportunity_v1(lead.id)
  ), missing_primary AS MATERIALIZED (
    SELECT active.id AS lead_id
    FROM active_opportunities AS active
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.work_items AS primary_item
      WHERE primary_item.lead_id = active.id
        AND primary_item.operational_lane = 'current'
        AND primary_item.status IN ('pending', 'blocked')
        AND primary_item.primary_next_action = true
    )
  ), trustworthy AS MATERIALIZED (
    SELECT item.*
    FROM public.work_items AS item
    JOIN missing_primary AS missing ON missing.lead_id = item.lead_id
    WHERE item.source_kind = 'activity'
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = false
      AND public.task_provenance_class_v1(item.source_metadata)
        IN ('governed_human', 'legacy_operator')
  ), eligible AS MATERIALIZED (
    SELECT candidate.*
    FROM trustworthy AS candidate
    WHERE 1 = (
      SELECT count(*)
      FROM trustworthy AS peer
      WHERE peer.lead_id = candidate.lead_id
    )
  )
  SELECT
    candidate.work_item_key,
    candidate.source_id,
    candidate.lead_id,
    candidate.updated_at,
    to_jsonb(candidate)
  FROM eligible AS candidate
  JOIN public.lead_activities AS activity
    ON activity.id = candidate.source_id
   AND activity.lead_id = candidate.lead_id
   AND coalesce(activity.metadata, '{}'::jsonb) = candidate.source_metadata
  ORDER BY candidate.lead_id, candidate.source_id;

  IF (SELECT count(*) FROM primary_next_action_repair_candidates_v1) <> p_expected_eligible THEN
    RAISE EXCEPTION 'repair_candidate_source_drift';
  END IF;

  SELECT md5(string_agg(
    candidate.lead_id::text || ':' || candidate.source_id::text || ':' || candidate.candidate_updated_at::text,
    ',' ORDER BY candidate.lead_id, candidate.source_id
  ))
  INTO candidate_fingerprint
  FROM primary_next_action_repair_candidates_v1 AS candidate;
  IF candidate_fingerprint <> clean_fingerprint THEN
    RAISE EXCEPTION 'repair_candidate_fingerprint_drift';
  END IF;

  UPDATE public.lead_activities AS activity
  SET metadata = coalesce(activity.metadata, '{}'::jsonb) || jsonb_build_object(
    'primary_next_action', true,
    'primary_next_action_repair', 'existing_operator_task_v1',
    'primary_next_action_repair_version', 1,
    'primary_next_action_repair_batch', clean_fingerprint,
    'primary_next_action_promoted_at', statement_timestamp(),
    'primary_next_action_promoted_by', clean_actor
  )
  FROM primary_next_action_repair_candidates_v1 AS candidate
  WHERE activity.id = candidate.source_id
    AND activity.lead_id = candidate.lead_id
    AND coalesce(activity.metadata, '{}'::jsonb) = candidate.previous_state -> 'source_metadata';
  GET DIAGNOSTICS changed_count = ROW_COUNT;

  IF changed_count <> p_expected_eligible THEN
    RAISE EXCEPTION 'repair_update_count_mismatch';
  END IF;

  INSERT INTO public.work_item_events (
    work_item_key, idempotency_key, action, actor,
    previous_state, next_state, metadata
  )
  SELECT
    candidate.work_item_key,
    'primary-next-action-repair-v1:' || candidate.source_id::text,
    'promote_primary_next_action',
    clean_actor,
    candidate.previous_state,
    to_jsonb(item),
    jsonb_build_object(
      'reason', 'exactly_one_trustworthy_operator_task',
      'repairVersion', 1,
      'batchFingerprint', clean_fingerprint
    )
  FROM primary_next_action_repair_candidates_v1 AS candidate
  JOIN public.work_items AS item
    ON item.work_item_key = candidate.work_item_key;

  SELECT md5(string_agg(
    item.lead_id::text || ':' || item.source_id::text || ':' || item.updated_at::text,
    ',' ORDER BY item.lead_id, item.source_id
  ))
  INTO post_repair_fingerprint
  FROM public.work_items AS item
  JOIN primary_next_action_repair_candidates_v1 AS candidate
    ON candidate.work_item_key = item.work_item_key;

  summary := public.primary_next_action_integrity_summary_v1();
  IF (summary ->> 'opportunitiesWithNoPrimary')::integer <> p_expected_missing - p_expected_eligible
    OR (summary ->> 'opportunitiesWithOnePrimary')::integer < p_expected_eligible THEN
    RAISE EXCEPTION 'repair_postcondition_failed';
  END IF;

  RETURN jsonb_build_object(
    'changed', true,
    'alreadyApplied', false,
    'promoted', changed_count,
    'batchFingerprint', clean_fingerprint,
    'postRepairFingerprint', post_repair_fingerprint,
    'integrity', summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_existing_operator_primary_next_actions_v1(
  integer, integer, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_existing_operator_primary_next_actions_v1(
  integer, integer, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.rollback_existing_operator_primary_next_actions_v1(
  p_expected_count integer,
  p_batch_fingerprint text,
  p_expected_post_repair_fingerprint text,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_batch text := lower(trim(coalesce(p_batch_fingerprint, '')));
  clean_post_fingerprint text := lower(trim(coalesce(p_expected_post_repair_fingerprint, '')));
  current_count integer;
  current_fingerprint text;
  changed_count integer;
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'rollback_actor_required'; END IF;
  IF p_expected_count < 1 THEN RAISE EXCEPTION 'rollback_expected_count_invalid'; END IF;
  IF clean_batch !~ '^[0-9a-f]{32}$' OR clean_post_fingerprint !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'rollback_fingerprint_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-next-action-controlled-repair-v1', 0)
  );
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '15s', true);
  LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.lead_activities IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.work_items IN SHARE ROW EXCLUSIVE MODE;

  CREATE TEMP TABLE IF NOT EXISTS primary_next_action_rollback_candidates_v1 (
    work_item_key text PRIMARY KEY,
    source_id uuid NOT NULL UNIQUE,
    lead_id uuid NOT NULL UNIQUE,
    previous_state jsonb NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE primary_next_action_rollback_candidates_v1;

  INSERT INTO primary_next_action_rollback_candidates_v1 (
    work_item_key, source_id, lead_id, previous_state
  )
  SELECT item.work_item_key, item.source_id, item.lead_id, to_jsonb(item)
  FROM public.work_items AS item
  WHERE item.source_kind = 'activity'
    AND item.operational_lane = 'current'
    AND item.status IN ('pending', 'blocked')
    AND item.primary_next_action = true
    AND item.source_metadata ->> 'primary_next_action_repair' = 'existing_operator_task_v1'
    AND item.source_metadata ->> 'primary_next_action_repair_batch' = clean_batch
  ORDER BY item.lead_id, item.source_id;

  SELECT count(*)::integer, md5(string_agg(
    candidate.lead_id::text || ':' || candidate.source_id::text || ':' || item.updated_at::text,
    ',' ORDER BY candidate.lead_id, candidate.source_id
  ))
  INTO current_count, current_fingerprint
  FROM primary_next_action_rollback_candidates_v1 AS candidate
  JOIN public.work_items AS item USING (work_item_key);

  IF current_count <> p_expected_count OR current_fingerprint <> clean_post_fingerprint THEN
    RAISE EXCEPTION 'rollback_state_drift';
  END IF;

  UPDATE public.lead_activities AS activity
  SET metadata = (
    coalesce(activity.metadata, '{}'::jsonb)
      - 'primary_next_action_repair'
      - 'primary_next_action_repair_version'
      - 'primary_next_action_repair_batch'
      - 'primary_next_action_promoted_at'
      - 'primary_next_action_promoted_by'
  ) || jsonb_build_object('primary_next_action', false)
  FROM primary_next_action_rollback_candidates_v1 AS candidate
  WHERE activity.id = candidate.source_id
    AND activity.lead_id = candidate.lead_id
    AND coalesce(activity.metadata, '{}'::jsonb) = candidate.previous_state -> 'source_metadata';
  GET DIAGNOSTICS changed_count = ROW_COUNT;

  IF changed_count <> p_expected_count THEN
    RAISE EXCEPTION 'rollback_update_count_mismatch';
  END IF;

  INSERT INTO public.work_item_events (
    work_item_key, idempotency_key, action, actor,
    previous_state, next_state, metadata
  )
  SELECT
    candidate.work_item_key,
    'primary-next-action-repair-v1-rollback:' || candidate.source_id::text,
    'rollback_primary_next_action_promotion',
    clean_actor,
    candidate.previous_state,
    to_jsonb(item),
    jsonb_build_object(
      'reason', 'controlled_repair_verification_failed',
      'repairVersion', 1,
      'batchFingerprint', clean_batch
    )
  FROM primary_next_action_rollback_candidates_v1 AS candidate
  JOIN public.work_items AS item
    ON item.work_item_key = candidate.work_item_key;

  RETURN jsonb_build_object(
    'changed', true,
    'rolledBack', changed_count,
    'batchFingerprint', clean_batch,
    'integrity', public.primary_next_action_integrity_summary_v1()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_existing_operator_primary_next_actions_v1(
  integer, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_existing_operator_primary_next_actions_v1(
  integer, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.primary_next_action_repair_census_v1() IS
  'Returns aggregate-only, PII-free eligibility evidence for controlled primary next-action repair.';
COMMENT ON FUNCTION public.promote_existing_operator_primary_next_actions_v1(integer, integer, text, text) IS
  'Promotes only the sole current pending operator-entered task for an active opportunity after exact census verification.';
COMMENT ON FUNCTION public.rollback_existing_operator_primary_next_actions_v1(integer, text, text, text) IS
  'Immediately rolls back one controlled promotion batch only when its post-repair fingerprint is unchanged.';
