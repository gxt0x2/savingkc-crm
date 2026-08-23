-- Human resolution workflow for active opportunities missing a primary next action.
--
-- AI, manifest, event-derived, and unreviewed automation rows are never eligible.
-- The two mutation paths are explicit: select one trustworthy operator task, or
-- create one reviewed, owned, dated task when no trustworthy task exists.

CREATE OR REPLACE FUNCTION public.primary_next_action_review_v1(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH lead_state AS MATERIALIZED (
    SELECT lead.id, public.lead_is_active_opportunity_v1(lead.id) AS active
    FROM public.leads AS lead
    WHERE lead.id = p_lead_id
  ), current_items AS MATERIALIZED (
    SELECT item.*,
      public.task_provenance_class_v1(item.source_metadata) AS provenance_class
    FROM public.work_items AS item
    WHERE item.lead_id = p_lead_id
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
  ), candidates AS MATERIALIZED (
    SELECT item.*
    FROM current_items AS item
    WHERE item.source_kind = 'activity'
      AND item.primary_next_action = false
      AND item.provenance_class IN ('governed_human', 'legacy_operator')
    ORDER BY item.due_at ASC NULLS LAST, item.updated_at DESC, item.work_item_key
    LIMIT 20
  ), primary_item AS MATERIALIZED (
    SELECT item.*
    FROM current_items AS item
    WHERE item.primary_next_action = true
    ORDER BY item.updated_at DESC, item.work_item_key
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'leadId', p_lead_id,
    'activeOpportunity', coalesce((SELECT active FROM lead_state), false),
    'resolutionKind', CASE
      WHEN NOT EXISTS (SELECT 1 FROM lead_state) THEN 'not_found'
      WHEN NOT coalesce((SELECT active FROM lead_state), false) THEN 'ineligible'
      WHEN EXISTS (SELECT 1 FROM primary_item) THEN 'resolved'
      WHEN EXISTS (SELECT 1 FROM candidates) THEN 'select'
      ELSE 'create'
    END,
    'primaryNextAction', (
      SELECT jsonb_build_object(
        'key', item.work_item_key,
        'title', item.title,
        'dueAt', item.due_at,
        'assignedTo', item.assigned_to,
        'version', item.version
      ) FROM primary_item AS item
    ),
    'candidates', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'key', item.work_item_key,
        'kind', item.kind,
        'title', item.title,
        'description', item.description,
        'status', item.status,
        'dueAt', item.due_at,
        'assignedTo', item.assigned_to,
        'version', item.version,
        'provenanceClass', item.provenance_class
      ) ORDER BY item.due_at ASC NULLS LAST, item.updated_at DESC, item.work_item_key)
      FROM candidates AS item
    ), '[]'::jsonb),
    'excludedAdvisoryCount', (
      SELECT count(*)::integer
      FROM public.work_items AS item
      WHERE item.lead_id = p_lead_id
        AND item.status IN ('pending', 'blocked')
        AND item.primary_next_action = false
        AND NOT (
          item.operational_lane = 'current'
          AND item.source_kind = 'activity'
          AND public.task_provenance_class_v1(item.source_metadata) IN ('governed_human', 'legacy_operator')
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.primary_next_action_review_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.primary_next_action_review_v1(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_primary_next_action_v1(
  p_lead_id uuid,
  p_action text,
  p_actor text,
  p_idempotency_key text,
  p_work_item_key text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_assigned_to text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_action text := lower(trim(coalesce(p_action, '')));
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_key text := trim(coalesce(p_idempotency_key, ''));
  clean_kind text := lower(trim(coalesce(p_kind, 'task')));
  clean_title text := trim(coalesce(p_title, ''));
  clean_assignee text := trim(coalesce(p_assigned_to, ''));
  event_action text;
  existing_event public.work_item_events;
  source_item public.work_items;
  next_item public.work_items;
  metadata_value jsonb;
  activity_id uuid;
  trustworthy_count integer;
BEGIN
  IF clean_action NOT IN ('select_existing', 'create') THEN RAISE EXCEPTION 'invalid_primary_resolution_action'; END IF;
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF clean_kind NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  event_action := CASE clean_action WHEN 'select_existing' THEN 'select_primary_next_action' ELSE 'create_primary_next_action' END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-next-action:' || p_lead_id::text, 0)
  );
  PERFORM 1 FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_lead_id'; END IF;

  SELECT * INTO existing_event
  FROM public.work_item_events
  WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_event.action <> event_action
      OR existing_event.metadata ->> 'lead_id' IS DISTINCT FROM p_lead_id::text THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    SELECT * INTO next_item
    FROM public.work_items
    WHERE work_item_key = existing_event.work_item_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_work_item_missing'; END IF;
    RETURN jsonb_build_object(
      'changed', false,
      'resolution', clean_action,
      'workItem', to_jsonb(next_item),
      'review', public.primary_next_action_review_v1(p_lead_id)
    );
  END IF;

  IF NOT public.lead_is_active_opportunity_v1(p_lead_id) THEN
    RAISE EXCEPTION 'lead_not_active_opportunity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_items AS item
    WHERE item.lead_id = p_lead_id
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = true
  ) THEN
    RAISE EXCEPTION 'primary_next_action_exists';
  END IF;

  IF clean_action = 'select_existing' THEN
    SELECT * INTO source_item
    FROM public.work_items AS item
    WHERE item.work_item_key = trim(coalesce(p_work_item_key, ''))
      AND item.lead_id = p_lead_id
      AND item.source_kind = 'activity'
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = false
      AND public.task_provenance_class_v1(item.source_metadata) IN ('governed_human', 'legacy_operator')
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'primary_candidate_not_eligible'; END IF;
    IF p_expected_version IS NULL OR source_item.version <> p_expected_version THEN
      RAISE EXCEPTION 'work_item_version_conflict';
    END IF;

    SELECT coalesce(metadata, '{}'::jsonb) INTO metadata_value
    FROM public.lead_activities
    WHERE id = source_item.source_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'work_item_source_missing'; END IF;

    metadata_value := jsonb_strip_nulls(metadata_value || jsonb_build_object(
      'primary_next_action', true,
      'primary_next_action_resolution', 'human_selected_existing_v1',
      'primary_next_action_reviewed_at', statement_timestamp(),
      'primary_next_action_reviewed_by', clean_actor,
      'last_changed_at', statement_timestamp(),
      'last_changed_by', clean_actor
    ));
    UPDATE public.lead_activities
    SET metadata = metadata_value
    WHERE id = source_item.source_id;

    SELECT * INTO next_item
    FROM public.work_items
    WHERE work_item_key = source_item.work_item_key;
  ELSE
    SELECT count(*)::integer INTO trustworthy_count
    FROM public.work_items AS item
    WHERE item.lead_id = p_lead_id
      AND item.source_kind = 'activity'
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = false
      AND public.task_provenance_class_v1(item.source_metadata) IN ('governed_human', 'legacy_operator');
    IF trustworthy_count <> 0 THEN RAISE EXCEPTION 'primary_candidate_selection_required'; END IF;
    IF clean_title = '' THEN RAISE EXCEPTION 'title_required'; END IF;
    IF clean_assignee = '' THEN RAISE EXCEPTION 'assignee_required'; END IF;
    IF p_due_at IS NULL THEN RAISE EXCEPTION 'due_date_required'; END IF;

    INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
    VALUES (
      p_lead_id,
      clean_kind,
      clean_title,
      clean_assignee,
      jsonb_strip_nulls(jsonb_build_object(
        'title', clean_title,
        'notes', nullif(trim(coalesce(p_notes, '')), ''),
        'task_type', clean_kind,
        'due_date', p_due_at,
        'assigned_to', clean_assignee,
        'department', 'acquisitions',
        'role', 'setter',
        'priority', 'normal',
        'status', 'pending',
        'primary_next_action', true,
        'source', 'canonical_work_item',
        'created_by', clean_actor,
        'idempotency_key', clean_key,
        'primary_next_action_resolution', 'human_created_v1',
        'primary_next_action_reviewed_at', statement_timestamp(),
        'primary_next_action_reviewed_by', clean_actor
      ))
    ) RETURNING id INTO activity_id;

    SELECT * INTO next_item
    FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = activity_id;
  END IF;

  IF next_item.work_item_key IS NULL OR next_item.primary_next_action IS NOT TRUE THEN
    RAISE EXCEPTION 'work_item_projection_failed';
  END IF;

  INSERT INTO public.work_item_events (
    work_item_key, idempotency_key, action, actor, previous_state, next_state, metadata
  ) VALUES (
    next_item.work_item_key,
    clean_key,
    event_action,
    clean_actor,
    CASE WHEN clean_action = 'select_existing' THEN to_jsonb(source_item) ELSE NULL END,
    to_jsonb(next_item),
    jsonb_build_object(
      'lead_id', p_lead_id,
      'resolution', clean_action,
      'policy_version', 'primary_next_action_human_resolution_v1'
    )
  );

  RETURN jsonb_build_object(
    'changed', true,
    'resolution', clean_action,
    'workItem', to_jsonb(next_item),
    'review', public.primary_next_action_review_v1(p_lead_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_primary_next_action_v1(uuid, text, text, text, text, integer, text, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_primary_next_action_v1(uuid, text, text, text, text, integer, text, text, text, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public.primary_next_action_review_v1(uuid) IS
  'Returns the bounded human-review state for one lead without exposing AI, manifest, event-derived, or unreviewed automation rows as selectable tasks.';
COMMENT ON FUNCTION public.resolve_primary_next_action_v1(uuid, text, text, text, text, integer, text, text, text, timestamptz, text) IS
  'Atomically selects a trustworthy operator task or creates a reviewed owned dated task as the sole primary next action.';
