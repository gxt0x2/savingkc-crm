-- Canonical operational work-item projection.
--
-- Existing lead_activities and tc_tasks remain the durable source rows during
-- this compatibility phase. work_items provides one indexed contract for CRM,
-- Ari, and future approved workflows. All mutations flow through audited,
-- idempotent SECURITY DEFINER functions that update the source and projection
-- in the same transaction.
-- hygiene-approved-destructive: trigger deletes remove only rebuildable projection rows when their durable source is deleted or stops being task-shaped.

CREATE TABLE IF NOT EXISTS public.work_items (
  work_item_key text PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('activity', 'tc_task')),
  source_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  tc_file_id uuid REFERENCES public.tc_files(id) ON DELETE SET NULL,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'blocked', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  assigned_to text,
  department text NOT NULL DEFAULT 'acquisitions',
  role text,
  primary_next_action boolean NOT NULL DEFAULT false,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_created_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.work_items TO service_role;

DROP POLICY IF EXISTS "Service role full access on work_items" ON public.work_items;
CREATE POLICY "Service role full access on work_items"
  ON public.work_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_work_items_open_due
  ON public.work_items (due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked');
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_open_due
  ON public.work_items (lower(assigned_to), due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked') AND assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_lead_open
  ON public.work_items (lead_id, due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked') AND lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_department_open
  ON public.work_items (department, due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked');
CREATE INDEX IF NOT EXISTS idx_work_items_completed_at
  ON public.work_items (completed_at DESC, work_item_key)
  WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_key text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL,
  actor text NOT NULL,
  previous_state jsonb,
  next_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_item_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_item_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.work_item_events TO service_role;

DROP POLICY IF EXISTS "Service role full access on work_item_events" ON public.work_item_events;
CREATE POLICY "Service role full access on work_item_events"
  ON public.work_item_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_work_item_events_item_created
  ON public.work_item_events (work_item_key, created_at DESC);

CREATE OR REPLACE FUNCTION public.work_item_safe_timestamp_v1(value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF nullif(trim(value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.work_item_safe_timestamp_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_item_safe_timestamp_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.work_item_status_v1(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE lower(trim(coalesce(value, 'pending')))
    WHEN 'completed' THEN 'completed'
    WHEN 'done' THEN 'completed'
    WHEN 'waived' THEN 'cancelled'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'canceled' THEN 'cancelled'
    WHEN 'blocked' THEN 'blocked'
    ELSE 'pending'
  END
$$;

REVOKE ALL ON FUNCTION public.work_item_status_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_item_status_v1(text) TO service_role;

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
  IF row_value.activity_type NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = row_value.id;
    RETURN NEW;
  END IF;

  metadata_value := coalesce(row_value.metadata, '{}'::jsonb);
  item_status := public.work_item_status_v1(metadata_value ->> 'status');
  projected_department := nullif(lower(trim(metadata_value ->> 'department')), '');
  IF projected_department IS NULL THEN
    SELECT CASE WHEN station IN ('contract_signed', 'under_contract', 'disposition', 'closed')
      THEN 'dispositions' ELSE 'acquisitions' END
    INTO projected_department
    FROM public.leads WHERE id = row_value.lead_id;
  END IF;
  projected_department := coalesce(projected_department, 'acquisitions');

  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, kind, title, description,
    status, priority, due_at, assigned_to, department, role,
    primary_next_action, source_metadata, source_created_at, completed_at
  ) VALUES (
    'activity:' || row_value.id::text,
    'activity', row_value.id, row_value.lead_id, row_value.activity_type,
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

CREATE OR REPLACE FUNCTION public.sync_tc_task_work_item_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_lead_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'tc_task' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT lead_id INTO linked_lead_id FROM public.tc_files WHERE id = NEW.tc_file_id;

  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, tc_file_id, kind, title,
    description, status, priority, due_at, assigned_to, department,
    source_metadata, source_created_at, completed_at
  ) VALUES (
    'tc_task:' || NEW.id::text,
    'tc_task', NEW.id, linked_lead_id, NEW.tc_file_id, NEW.task_type, NEW.label,
    NEW.notes, public.work_item_status_v1(NEW.status),
    CASE WHEN NEW.status = 'blocked' THEN 'high' ELSE 'normal' END,
    NEW.due_at, nullif(trim(NEW.assigned_to), ''), 'tc',
    jsonb_build_object('source', NEW.source, 'tc_status', NEW.status),
    NEW.created_at, NEW.completed_at
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    tc_file_id = EXCLUDED.tc_file_id,
    kind = EXCLUDED.kind,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    due_at = EXCLUDED.due_at,
    assigned_to = EXCLUDED.assigned_to,
    department = EXCLUDED.department,
    source_metadata = EXCLUDED.source_metadata,
    source_created_at = EXCLUDED.source_created_at,
    completed_at = EXCLUDED.completed_at,
    version = public.work_items.version + 1,
    updated_at = now();

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_tc_task_work_item_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tc_task_work_item_v1() TO service_role;

DROP TRIGGER IF EXISTS trigger_sync_activity_work_item_v1 ON public.lead_activities;
CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF activity_type, description, agent, metadata OR DELETE
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

DROP TRIGGER IF EXISTS trigger_sync_tc_task_work_item_v1 ON public.tc_tasks;
CREATE TRIGGER trigger_sync_tc_task_work_item_v1
AFTER INSERT OR UPDATE OF tc_file_id, task_type, label, status, due_at, completed_at, assigned_to, source, notes OR DELETE
ON public.tc_tasks
FOR EACH ROW EXECUTE FUNCTION public.sync_tc_task_work_item_v1();

INSERT INTO public.work_items (
  work_item_key, source_kind, source_id, lead_id, kind, title, description,
  status, priority, due_at, assigned_to, department, role,
  primary_next_action, source_metadata, source_created_at, completed_at
)
SELECT
  'activity:' || activity.id::text,
  'activity', activity.id, activity.lead_id, activity.activity_type,
  coalesce(nullif(trim(activity.metadata ->> 'title'), ''), nullif(trim(activity.description), ''), 'Untitled task'),
  nullif(trim(activity.metadata ->> 'notes'), ''),
  public.work_item_status_v1(activity.metadata ->> 'status'),
  coalesce(nullif(lower(trim(activity.metadata ->> 'priority')), ''), 'normal'),
  public.work_item_safe_timestamp_v1(activity.metadata ->> 'due_date'),
  coalesce(nullif(trim(activity.metadata ->> 'assigned_to'), ''), nullif(trim(activity.agent), '')),
  coalesce(
    nullif(lower(trim(activity.metadata ->> 'department')), ''),
    CASE WHEN lead.station IN ('contract_signed', 'under_contract', 'disposition', 'closed') THEN 'dispositions' END,
    'acquisitions'
  ),
  nullif(trim(activity.metadata ->> 'role'), ''),
  lower(coalesce(activity.metadata ->> 'primary_next_action', 'false')) = 'true',
  coalesce(activity.metadata, '{}'::jsonb), activity.created_at,
  CASE WHEN public.work_item_status_v1(activity.metadata ->> 'status') = 'completed'
    THEN coalesce(public.work_item_safe_timestamp_v1(activity.metadata ->> 'completed_at'), activity.created_at)
    ELSE NULL END
FROM public.lead_activities activity
LEFT JOIN public.leads lead ON lead.id = activity.lead_id
WHERE activity.activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO public.work_items (
  work_item_key, source_kind, source_id, lead_id, tc_file_id, kind, title,
  description, status, priority, due_at, assigned_to, department,
  source_metadata, source_created_at, completed_at
)
SELECT
  'tc_task:' || task.id::text,
  'tc_task', task.id, file.lead_id, task.tc_file_id, task.task_type, task.label,
  task.notes, public.work_item_status_v1(task.status),
  CASE WHEN task.status = 'blocked' THEN 'high' ELSE 'normal' END,
  task.due_at, nullif(trim(task.assigned_to), ''), 'tc',
  jsonb_build_object('source', task.source, 'tc_status', task.status),
  task.created_at, task.completed_at
FROM public.tc_tasks task
JOIN public.tc_files file ON file.id = task.tc_file_id
ON CONFLICT (source_kind, source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_work_item_v1(
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
  p_primary_next_action boolean DEFAULT false
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
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF clean_kind NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  IF nullif(trim(p_title), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN RAISE EXCEPTION 'invalid_lead_id'; END IF;

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
    jsonb_strip_nulls(jsonb_build_object(
      'title', trim(p_title), 'notes', nullif(trim(p_notes), ''),
      'task_type', clean_kind, 'due_date', p_due_at,
      'assigned_to', nullif(trim(p_assigned_to), ''),
      'department', coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions'),
      'role', nullif(trim(p_role), ''),
      'priority', coalesce(nullif(lower(trim(p_priority)), ''), 'normal'),
      'status', 'pending', 'primary_next_action', coalesce(p_primary_next_action, false),
      'source', 'canonical_work_item', 'created_by', clean_actor,
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

REVOKE ALL ON FUNCTION public.create_work_item_v1(text, text, uuid, text, text, text, timestamptz, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_work_item_v1(text, text, uuid, text, text, text, timestamptz, text, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_work_item_v1(
  p_work_item_key text,
  p_actor text,
  p_action text,
  p_idempotency_key text,
  p_expected_version integer DEFAULT NULL,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  item public.work_items;
  next_item public.work_items;
  existing_event public.work_item_events;
  metadata_value jsonb;
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_action text := lower(trim(coalesce(p_action, '')));
  clean_key text := trim(coalesce(p_idempotency_key, ''));
  patch_value jsonb := coalesce(p_patch, '{}'::jsonb);
  due_value timestamptz;
  assignee_value text;
  kind_value text;
  status_value text;
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF clean_action NOT IN ('complete', 'reopen', 'snooze', 'assign', 'cancel', 'edit') THEN RAISE EXCEPTION 'invalid_work_item_action'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF jsonb_typeof(patch_value) <> 'object' THEN RAISE EXCEPTION 'invalid_work_item_patch'; END IF;
  due_value := public.work_item_safe_timestamp_v1(patch_value ->> 'due_at');
  assignee_value := nullif(trim(patch_value ->> 'assigned_to'), '');
  kind_value := nullif(lower(trim(patch_value ->> 'kind')), '');
  status_value := nullif(lower(trim(patch_value ->> 'status')), '');
  IF clean_action = 'snooze' AND due_value IS NULL THEN RAISE EXCEPTION 'due_date_required'; END IF;
  IF clean_action = 'assign' AND assignee_value IS NULL THEN RAISE EXCEPTION 'assignee_required'; END IF;
  IF clean_action = 'edit' AND patch_value = '{}'::jsonb THEN RAISE EXCEPTION 'empty_work_item_patch'; END IF;
  IF patch_value ? 'title' AND nullif(trim(patch_value ->> 'title'), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF kind_value IS NOT NULL AND kind_value NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  IF status_value IS NOT NULL AND status_value NOT IN ('pending', 'completed') THEN RAISE EXCEPTION 'invalid_work_item_status'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item:' || p_work_item_key, 0));
  SELECT * INTO existing_event FROM public.work_item_events WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_event.work_item_key <> p_work_item_key OR existing_event.action <> clean_action THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    SELECT * INTO next_item FROM public.work_items WHERE work_item_key = p_work_item_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found'; END IF;
    RETURN jsonb_build_object('changed', false, 'workItem', to_jsonb(next_item));
  END IF;

  SELECT * INTO item FROM public.work_items WHERE work_item_key = p_work_item_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found'; END IF;
  IF p_expected_version IS NOT NULL AND item.version <> p_expected_version THEN RAISE EXCEPTION 'work_item_version_conflict'; END IF;

  IF item.source_kind = 'activity' THEN
    SELECT coalesce(metadata, '{}'::jsonb) INTO metadata_value
    FROM public.lead_activities WHERE id = item.source_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'work_item_source_missing'; END IF;

    IF clean_action = 'complete' THEN
      metadata_value := jsonb_set(jsonb_set(metadata_value, '{status}', '"completed"'::jsonb, true), '{completed_at}', to_jsonb(now()), true);
    ELSIF clean_action = 'reopen' THEN
      metadata_value := jsonb_set(metadata_value - 'completed_at', '{status}', '"pending"'::jsonb, true);
    ELSIF clean_action = 'snooze' THEN
      metadata_value := jsonb_set(metadata_value, '{due_date}', to_jsonb(due_value), true);
    ELSIF clean_action = 'assign' THEN
      metadata_value := jsonb_set(metadata_value, '{assigned_to}', to_jsonb(assignee_value), true);
    ELSIF clean_action = 'cancel' THEN
      metadata_value := jsonb_set(metadata_value, '{status}', '"cancelled"'::jsonb, true);
    ELSIF clean_action = 'edit' THEN
      IF patch_value ? 'title' THEN metadata_value := jsonb_set(metadata_value, '{title}', to_jsonb(trim(patch_value ->> 'title')), true); END IF;
      IF patch_value ? 'notes' THEN
        metadata_value := CASE WHEN patch_value ->> 'notes' IS NULL OR trim(patch_value ->> 'notes') = ''
          THEN metadata_value - 'notes'
          ELSE jsonb_set(metadata_value, '{notes}', to_jsonb(trim(patch_value ->> 'notes')), true) END;
      END IF;
      IF patch_value ? 'kind' THEN metadata_value := jsonb_set(metadata_value, '{task_type}', to_jsonb(kind_value), true); END IF;
      IF patch_value ? 'due_at' THEN
        metadata_value := CASE WHEN due_value IS NULL THEN metadata_value - 'due_date'
          ELSE jsonb_set(metadata_value, '{due_date}', to_jsonb(due_value), true) END;
      END IF;
      IF patch_value ? 'assigned_to' THEN
        metadata_value := CASE WHEN assignee_value IS NULL THEN metadata_value - 'assigned_to'
          ELSE jsonb_set(metadata_value, '{assigned_to}', to_jsonb(assignee_value), true) END;
      END IF;
      IF status_value = 'completed' THEN
        metadata_value := jsonb_set(jsonb_set(metadata_value, '{status}', '"completed"'::jsonb, true), '{completed_at}', to_jsonb(now()), true);
      ELSIF status_value = 'pending' THEN
        metadata_value := jsonb_set(metadata_value - 'completed_at', '{status}', '"pending"'::jsonb, true);
      END IF;
    END IF;
    metadata_value := jsonb_set(jsonb_set(metadata_value, '{last_changed_by}', to_jsonb(clean_actor), true), '{last_changed_at}', to_jsonb(now()), true);
    UPDATE public.lead_activities
    SET description = CASE WHEN clean_action = 'edit' AND patch_value ? 'title' THEN trim(patch_value ->> 'title') ELSE description END,
        activity_type = CASE WHEN clean_action = 'edit' AND kind_value IS NOT NULL THEN kind_value ELSE activity_type END,
        metadata = metadata_value,
        agent = CASE
          WHEN clean_action = 'assign' THEN assignee_value
          WHEN clean_action = 'edit' AND patch_value ? 'assigned_to' THEN assignee_value
          ELSE agent END
    WHERE id = item.source_id;
  ELSIF item.source_kind = 'tc_task' THEN
    IF clean_action = 'complete' THEN
      UPDATE public.tc_tasks SET status = 'done', completed_at = now(), updated_at = now() WHERE id = item.source_id;
    ELSIF clean_action = 'reopen' THEN
      UPDATE public.tc_tasks SET status = 'open', completed_at = NULL, updated_at = now() WHERE id = item.source_id;
    ELSIF clean_action = 'snooze' THEN
      UPDATE public.tc_tasks SET due_at = due_value, updated_at = now() WHERE id = item.source_id;
    ELSIF clean_action = 'assign' THEN
      UPDATE public.tc_tasks SET assigned_to = assignee_value, updated_at = now() WHERE id = item.source_id;
    ELSIF clean_action = 'cancel' THEN
      UPDATE public.tc_tasks SET status = 'waived', completed_at = now(), updated_at = now() WHERE id = item.source_id;
    ELSIF clean_action = 'edit' THEN
      UPDATE public.tc_tasks SET
        label = CASE WHEN patch_value ? 'title' THEN trim(patch_value ->> 'title') ELSE label END,
        notes = CASE WHEN patch_value ? 'notes' THEN nullif(trim(patch_value ->> 'notes'), '') ELSE notes END,
        task_type = CASE WHEN kind_value IS NOT NULL THEN kind_value ELSE task_type END,
        due_at = CASE WHEN patch_value ? 'due_at' THEN due_value ELSE due_at END,
        assigned_to = CASE WHEN patch_value ? 'assigned_to' THEN assignee_value ELSE assigned_to END,
        status = CASE WHEN status_value = 'completed' THEN 'done' WHEN status_value = 'pending' THEN 'open' ELSE status END,
        completed_at = CASE WHEN status_value = 'completed' THEN now() WHEN status_value = 'pending' THEN NULL ELSE completed_at END,
        updated_at = now()
      WHERE id = item.source_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_work_item_source';
  END IF;

  SELECT * INTO next_item FROM public.work_items WHERE work_item_key = item.work_item_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_projection_failed'; END IF;

  INSERT INTO public.work_item_events (
    work_item_key, idempotency_key, action, actor, previous_state, next_state,
    metadata
  ) VALUES (
    item.work_item_key, clean_key, clean_action, clean_actor, to_jsonb(item), to_jsonb(next_item),
    jsonb_build_object('expected_version', p_expected_version, 'patch', patch_value)
  );

  RETURN jsonb_build_object('changed', true, 'workItem', to_jsonb(next_item));
END
$$;

REVOKE ALL ON FUNCTION public.transition_work_item_v1(text, text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_work_item_v1(text, text, text, text, integer, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_work_items_bulk_v1(
  p_work_item_keys text[],
  p_actor text,
  p_action text,
  p_idempotency_key text,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_keys text[];
  clean_key text := trim(coalesce(p_idempotency_key, ''));
  item_key text;
  result_items jsonb := '[]'::jsonb;
  result jsonb;
  changed_count integer := 0;
BEGIN
  SELECT array_agg(value ORDER BY value) INTO clean_keys
  FROM (
    SELECT DISTINCT trim(value) AS value
    FROM unnest(coalesce(p_work_item_keys, ARRAY[]::text[])) value
    WHERE trim(value) <> ''
    LIMIT 201
  ) selected_keys;

  IF coalesce(cardinality(clean_keys), 0) = 0 THEN RAISE EXCEPTION 'work_item_keys_required'; END IF;
  IF cardinality(clean_keys) > 200 THEN RAISE EXCEPTION 'too_many_work_items'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 150 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;

  FOREACH item_key IN ARRAY clean_keys LOOP
    result := public.transition_work_item_v1(
      item_key,
      p_actor,
      p_action,
      clean_key || ':' || md5(item_key),
      NULL,
      coalesce(p_patch, '{}'::jsonb)
    );
    result_items := result_items || jsonb_build_array(result -> 'workItem');
    IF coalesce((result ->> 'changed')::boolean, false) THEN changed_count := changed_count + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('changed', changed_count, 'workItems', result_items);
END
$$;

REVOKE ALL ON FUNCTION public.transition_work_items_bulk_v1(text[], text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_work_items_bulk_v1(text[], text, text, text, jsonb) TO service_role;

COMMENT ON TABLE public.work_items IS
  'Indexed operational projection over legacy task-shaped lead activities and TC tasks. Source rows remain durable during compatibility cutover.';
COMMENT ON TABLE public.work_item_events IS
  'Append-only idempotency and audit ledger for canonical work-item mutations.';
