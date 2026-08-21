-- First mutating governed workflow executor.
--
-- Adds workflow provenance to canonical work-item creation and distinguishes
-- retryable infrastructure failures from deterministic execution failures.
-- No workflow run is created or executed by this migration.

CREATE OR REPLACE FUNCTION public.create_work_item_v2(
  p_actor text,
  p_idempotency_key text,
  p_lead_id uuid,
  p_kind text,
  p_title text,
  p_notes text,
  p_due_at timestamptz,
  p_assigned_to text,
  p_department text,
  p_role text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_primary_next_action boolean DEFAULT false,
  p_provenance jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_event public.work_item_events;
  activity_id uuid;
  item public.work_items;
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_key text := trim(coalesce(p_idempotency_key, ''));
  clean_kind text := lower(trim(coalesce(p_kind, 'task')));
  provenance_value jsonb := coalesce(p_provenance, '{}'::jsonb);
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF clean_kind NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  IF nullif(trim(p_title), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN RAISE EXCEPTION 'invalid_lead_id'; END IF;
  IF jsonb_typeof(provenance_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_work_item_provenance'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item-idempotency:' || clean_key, 0));
  SELECT * INTO existing_event FROM public.work_item_events WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_event.action <> 'create' THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    SELECT * INTO item FROM public.work_items WHERE work_item_key = existing_event.work_item_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_work_item_missing'; END IF;
    RETURN jsonb_build_object('created', false, 'workItem', to_jsonb(item));
  END IF;

  INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
  VALUES (
    p_lead_id, clean_kind, trim(p_title), nullif(trim(p_assigned_to), ''),
    jsonb_strip_nulls(provenance_value || jsonb_build_object(
      'title', trim(p_title), 'notes', nullif(trim(p_notes), ''),
      'task_type', clean_kind, 'due_date', p_due_at,
      'assigned_to', nullif(trim(p_assigned_to), ''),
      'department', coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions'),
      'role', nullif(trim(p_role), ''),
      'priority', coalesce(nullif(lower(trim(p_priority)), ''), 'normal'),
      'status', 'pending', 'primary_next_action', coalesce(p_primary_next_action, false),
      'source', 'governed_workflow', 'created_by', clean_actor,
      'idempotency_key', clean_key
    ))
  ) RETURNING id INTO activity_id;

  SELECT * INTO item FROM public.work_items WHERE source_kind = 'activity' AND source_id = activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_projection_failed'; END IF;

  INSERT INTO public.work_item_events (work_item_key, idempotency_key, action, actor, next_state)
  VALUES (item.work_item_key, clean_key, 'create', clean_actor, to_jsonb(item));
  RETURN jsonb_build_object('created', true, 'workItem', to_jsonb(item));
END
$$;

REVOKE ALL ON FUNCTION public.create_work_item_v2(text, text, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_work_item_v2(text, text, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.workflow_finish_run_v2(
  p_run_id uuid,
  p_worker_id text,
  p_outcome text,
  p_output jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retryable boolean DEFAULT true
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
  next_status text;
  retry_seconds integer;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
  SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_run_not_found'; END IF;
  IF target_run.status <> 'running' OR target_run.lease_owner <> trim(p_worker_id) THEN RAISE EXCEPTION 'workflow_run_not_leased'; END IF;

  IF p_outcome = 'succeeded' THEN
    next_status := 'succeeded';
  ELSIF coalesce(p_retryable, true) AND target_run.attempt_count < target_run.max_attempts THEN
    next_status := 'retry_scheduled';
  ELSE
    next_status := 'failed';
  END IF;
  retry_seconds := least(3600, 30 * (2 ^ greatest(target_run.attempt_count - 1, 0))::integer);

  UPDATE public.workflow_runs SET
    status = next_status,
    output = CASE WHEN p_outcome = 'succeeded' THEN p_output ELSE output END,
    error_code = CASE WHEN p_outcome = 'failed' THEN coalesce(nullif(trim(p_error_code), ''), 'workflow_failed') ELSE NULL END,
    error_message = CASE WHEN p_outcome = 'failed' THEN left(coalesce(nullif(trim(p_error_message), ''), 'Workflow execution failed.'), 1000) ELSE NULL END,
    available_at = CASE WHEN next_status = 'retry_scheduled' THEN now() + make_interval(secs => retry_seconds) ELSE available_at END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    finished_at = CASE WHEN next_status IN ('succeeded', 'failed') THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_run_id RETURNING * INTO target_run;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (p_run_id, CASE next_status WHEN 'retry_scheduled' THEN 'retry_scheduled' ELSE 'run_' || next_status END,
    trim(p_worker_id), jsonb_build_object(
      'attempt', target_run.attempt_count,
      'error_code', target_run.error_code,
      'retryable', coalesce(p_retryable, true),
      'available_at', target_run.available_at
    ));
  RETURN target_run;
END
$$;

REVOKE ALL ON FUNCTION public.workflow_finish_run_v2(uuid, text, text, jsonb, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_finish_run_v2(uuid, text, text, jsonb, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.create_work_item_v2(text, text, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb) IS
  'Creates one canonical work item exactly once and preserves server-owned workflow provenance.';
COMMENT ON FUNCTION public.workflow_finish_run_v2(uuid, text, text, jsonb, text, text, boolean) IS
  'Finishes or reschedules a leased workflow run according to the server-classified retry policy.';
