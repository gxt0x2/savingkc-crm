-- hygiene-approved-destructive: Preserve the existing activity-projection cleanup when its source is deleted or ceases to be a task; replace only named triggers to include Prospect linkage. No table or historical source deletion.
-- Prospect-aware canonical work items for the Prospecting wrap-up workflow.
--
-- Source Prospects must be able to own follow-ups, appointments, and physical
-- mail work without creating a shadow Lead. The existing lead_activities row
-- remains the durable source and work_items remains the canonical projection.
-- When a Prospect is promoted, the same source row is linked to the Lead so
-- history and task identity survive the transition without duplication.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.lead_activities
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL;

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_activities_prospect_history
  ON public.lead_activities (prospect_id, created_at DESC, id DESC)
  WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_prospect_open
  ON public.work_items (prospect_id, due_at ASC NULLS LAST, work_item_key)
  WHERE prospect_id IS NOT NULL AND status IN ('pending', 'blocked');

-- Preserve existing source-Prospect notes that already carry their durable
-- subject in metadata.
UPDATE public.lead_activities AS activity
SET prospect_id = prospect.id
FROM public.prospects AS prospect
WHERE activity.prospect_id IS NULL
  AND activity.activity_type IN ('note', 'task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail')
  AND activity.metadata ->> 'prospect_id' = prospect.id::text;

CREATE OR REPLACE FUNCTION public.sync_activity_work_item_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value public.lead_activities;
  metadata_value jsonb;
  item_status text;
  projected_department text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  row_value := NEW;
  IF row_value.activity_type NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail') THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = row_value.id;
    RETURN NEW;
  END IF;

  metadata_value := coalesce(row_value.metadata, '{}'::jsonb);
  item_status := public.work_item_status_v1(metadata_value ->> 'status');
  projected_department := nullif(lower(trim(metadata_value ->> 'department')), '');
  IF projected_department IS NULL AND row_value.lead_id IS NOT NULL THEN
    SELECT CASE WHEN station IN ('contract_signed', 'under_contract', 'disposition', 'closed')
      THEN 'dispositions' ELSE 'acquisitions' END
    INTO projected_department
    FROM public.leads WHERE id = row_value.lead_id;
  END IF;
  projected_department := coalesce(projected_department, 'acquisitions');

  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, prospect_id, kind, title, description,
    status, priority, due_at, assigned_to, department, role,
    primary_next_action, source_metadata, source_created_at, completed_at
  ) VALUES (
    'activity:' || row_value.id::text,
    'activity', row_value.id, row_value.lead_id, row_value.prospect_id, row_value.activity_type,
    coalesce(nullif(trim(metadata_value ->> 'title'), ''), nullif(trim(row_value.description), ''), 'Untitled task'),
    nullif(trim(metadata_value ->> 'notes'), ''),
    item_status,
    coalesce(nullif(lower(trim(metadata_value ->> 'priority')), ''), 'normal'),
    public.work_item_safe_timestamp_v1(metadata_value ->> 'due_date'),
    coalesce(nullif(trim(metadata_value ->> 'assigned_to'), ''), nullif(trim(row_value.agent), '')),
    projected_department,
    nullif(trim(metadata_value ->> 'role'), ''),
    lower(coalesce(metadata_value ->> 'primary_next_action', 'false')) = 'true',
    metadata_value,
    row_value.created_at,
    CASE WHEN item_status = 'completed'
      THEN coalesce(public.work_item_safe_timestamp_v1(metadata_value ->> 'completed_at'), row_value.created_at)
      ELSE NULL END
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    prospect_id = EXCLUDED.prospect_id,
    kind = EXCLUDED.kind,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    due_at = EXCLUDED.due_at,
    assigned_to = EXCLUDED.assigned_to,
    department = EXCLUDED.department,
    role = EXCLUDED.role,
    primary_next_action = EXCLUDED.primary_next_action,
    source_metadata = EXCLUDED.source_metadata,
    source_created_at = EXCLUDED.source_created_at,
    completed_at = EXCLUDED.completed_at,
    version = public.work_items.version + 1,
    updated_at = now();

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_activity_work_item_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_activity_work_item_v1() TO service_role;

DROP TRIGGER IF EXISTS trigger_sync_activity_work_item_v1 ON public.lead_activities;
CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF lead_id, prospect_id, activity_type, description, agent, metadata OR DELETE
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

-- Source Prospects are current operational work. A promoted Prospect follows
-- the linked Lead's lifecycle lane.
CREATE OR REPLACE FUNCTION public.set_work_item_operational_lane_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.operational_lane := CASE
    WHEN public.task_provenance_class_v1(NEW.source_metadata) IN ('automation_unreviewed', 'unknown') THEN 'quarantine'
    WHEN public.task_provenance_class_v1(NEW.source_metadata) = 'event_derived' THEN 'review'
    WHEN EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = NEW.lead_id
        AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
        AND lower(coalesce(lead.classification, '')) <> 'dead'
    ) THEN 'current'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospects AS prospect
      LEFT JOIN public.leads AS linked_lead ON linked_lead.id = prospect.lead_id
      WHERE prospect.id = NEW.prospect_id
        AND (
          prospect.lead_id IS NULL
          OR (
            lower(coalesce(linked_lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
            AND lower(coalesce(linked_lead.classification, '')) <> 'dead'
          )
        )
    ) THEN 'current'
    ELSE 'review'
  END;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.set_work_item_operational_lane_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_work_item_operational_lane_v1() TO service_role;

DROP TRIGGER IF EXISTS trigger_set_work_item_operational_lane_v1 ON public.work_items;
CREATE TRIGGER trigger_set_work_item_operational_lane_v1
BEFORE INSERT OR UPDATE OF lead_id, prospect_id, source_metadata ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.set_work_item_operational_lane_v1();

-- Reconcile links for historical source-Prospect notes and work without
-- replacing a recorded Lead identity.
UPDATE public.lead_activities AS activity
SET lead_id = prospect.lead_id
FROM public.prospects AS prospect
WHERE activity.prospect_id = prospect.id
  AND activity.activity_type IN ('note', 'task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail')
  AND activity.lead_id IS NULL AND prospect.lead_id IS NOT NULL;

-- Re-project any task-like source Prospect activities that predate the typed
-- prospect_id trigger column. An UPDATE OF trigger fires even when the value is
-- unchanged, which keeps the projection logic in one audited function.
UPDATE public.lead_activities
SET prospect_id = prospect_id
WHERE prospect_id IS NOT NULL
  AND activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail');

-- Link existing Prospect work to the canonical Lead at promotion time. The
-- work-item projection trigger keeps the same work_item_key and source_id.
CREATE OR REPLACE FUNCTION public.sync_prospect_activity_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    UPDATE public.lead_activities
    SET lead_id = NEW.lead_id
    WHERE prospect_id = NEW.id
      AND activity_type IN ('note', 'task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail')
      AND lead_id IS DISTINCT FROM NEW.lead_id;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_prospect_activity_lead_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_prospect_activity_lead_v1() TO service_role;

DROP TRIGGER IF EXISTS trigger_sync_prospect_activity_lead_v1 ON public.prospects;
CREATE TRIGGER trigger_sync_prospect_activity_lead_v1
AFTER UPDATE OF lead_id ON public.prospects
FOR EACH ROW EXECUTE FUNCTION public.sync_prospect_activity_lead_v1();

CREATE OR REPLACE FUNCTION public.create_work_item_v3(
  p_actor text,
  p_idempotency_key text,
  p_lead_id uuid,
  p_prospect_id uuid,
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
  primary_value boolean := coalesce(p_primary_next_action, false) AND p_lead_id IS NOT NULL;
  effective_lead_id uuid := p_lead_id;
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF clean_kind NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer', 'mail') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  IF nullif(trim(p_title), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_lead_id IS NULL AND p_prospect_id IS NULL THEN RAISE EXCEPTION 'work_item_subject_required'; END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN RAISE EXCEPTION 'invalid_lead_id'; END IF;
  IF p_prospect_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prospects WHERE id = p_prospect_id) THEN RAISE EXCEPTION 'invalid_prospect_id'; END IF;
  IF p_lead_id IS NOT NULL AND p_prospect_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.prospects
    WHERE id = p_prospect_id AND lead_id IS DISTINCT FROM p_lead_id
  ) THEN RAISE EXCEPTION 'work_item_subject_mismatch'; END IF;
  IF jsonb_typeof(provenance_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_work_item_provenance'; END IF;

  -- A Prospect that is already linked must follow the linked Lead's lifecycle.
  -- Preserve the Prospect identity as the origin of the work.
  IF effective_lead_id IS NULL AND p_prospect_id IS NOT NULL THEN
    SELECT lead_id INTO effective_lead_id FROM public.prospects WHERE id = p_prospect_id FOR SHARE;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item-idempotency:' || clean_key, 0));
  SELECT * INTO existing_event FROM public.work_item_events WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_event.action <> 'create' OR existing_event.actor <> clean_actor THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    SELECT * INTO item FROM public.work_items WHERE work_item_key = existing_event.work_item_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_work_item_missing'; END IF;
    IF item.prospect_id IS DISTINCT FROM p_prospect_id
      OR (p_prospect_id IS NULL AND item.lead_id IS DISTINCT FROM p_lead_id)
    THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    RETURN jsonb_build_object('created', false, 'workItem', to_jsonb(item));
  END IF;

  INSERT INTO public.lead_activities (lead_id, prospect_id, activity_type, description, agent, metadata)
  VALUES (
    effective_lead_id, p_prospect_id, clean_kind, trim(p_title), nullif(trim(p_assigned_to), ''),
    jsonb_strip_nulls(provenance_value || jsonb_build_object(
      'title', trim(p_title), 'notes', nullif(trim(p_notes), ''),
      'task_type', clean_kind, 'due_date', p_due_at,
      'assigned_to', nullif(trim(p_assigned_to), ''),
      'department', coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions'),
      'role', nullif(trim(p_role), ''),
      'priority', coalesce(nullif(lower(trim(p_priority)), ''), 'normal'),
      'status', 'pending', 'primary_next_action', primary_value,
      'subject_kind', CASE WHEN p_prospect_id IS NULL THEN 'lead' ELSE 'prospect' END,
      'prospect_id', p_prospect_id,
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

REVOKE ALL ON FUNCTION public.create_work_item_v3(text, text, uuid, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_work_item_v3(text, text, uuid, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb)
  TO service_role;

-- Extend the established task read model without copying its large indexed
-- query. The application independently verifies the Prospect before treating
-- the item as current work.
DO $$
DECLARE
  function_signature regprocedure := 'public.task_worklist_page_v2(text,text,text,text,text,text[],text,text,integer,timestamptz,timestamptz,timestamptz,text,text,boolean,text)'::regprocedure;
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(function_signature) INTO function_definition;

  IF position('''prospectId'', row.prospect_id' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      '''leadId'', row.lead_id, ''tcFileId'', row.tc_file_id,',
      '''leadId'', row.lead_id, ''prospectId'', row.prospect_id, ''tcFileId'', row.tc_file_id,'
    );
  END IF;

  IF position('''prospectId'', row.prospect_id' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'task_worklist_page_v2 prospect subject contract could not be installed';
  END IF;

  EXECUTE function_definition;
END
$$;

REVOKE ALL ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  TO service_role;

COMMENT ON COLUMN public.lead_activities.prospect_id IS
  'Optional durable source Prospect subject. Promotion may add lead_id without changing the activity identity.';
COMMENT ON COLUMN public.work_items.prospect_id IS
  'Originating source Prospect for canonical operational work; retained after Lead promotion.';
COMMENT ON FUNCTION public.create_work_item_v3(text, text, uuid, uuid, text, text, text, timestamptz, text, text, text, text, boolean, jsonb) IS
  'Creates an audited canonical work item for a Lead or source Prospect without creating shadow Leads.';

NOTIFY pgrst, 'reload schema';
