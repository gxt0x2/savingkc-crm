-- Bounded operational task worklist.
--
-- work_items remains the canonical projection and lead_activities/tc_tasks
-- remain the durable compatibility sources. This adds one service-only,
-- cursor-paginated read contract for the Tasks workspace without changing
-- Calendar or TC behavior.

CREATE INDEX IF NOT EXISTS idx_work_items_task_worklist_due
  ON public.work_items (department, status, due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');

CREATE INDEX IF NOT EXISTS idx_work_items_task_worklist_created
  ON public.work_items (department, source_created_at DESC, work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');

CREATE INDEX IF NOT EXISTS idx_work_items_task_worklist_title
  ON public.work_items (department, lower(title), work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');

DO $$
DECLARE
  trigram_schema text;
BEGIN
  SELECT namespace.nspname
  INTO trigram_schema
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';

  IF trigram_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension is required for task worklist search';
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_work_items_task_search ON public.work_items USING gin ((lower(coalesce(title, '''') || '' '' || coalesce(description, '''') || '' '' || coalesce(assigned_to, ''''))) %I.gin_trgm_ops)',
    trigram_schema
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_leads_task_search ON public.leads USING gin ((lower(coalesce(full_name, '''') || '' '' || coalesce(property_address, '''') || '' '' || coalesce(phone, ''''))) %I.gin_trgm_ops)',
    trigram_schema
  );
END
$$;

CREATE OR REPLACE FUNCTION public.task_worklist_page_v1(
  p_department text DEFAULT 'acquisitions',
  p_view text DEFAULT 'all',
  p_status_filter text DEFAULT 'all',
  p_assignee text DEFAULT NULL,
  p_due_filter text DEFAULT 'any',
  p_kinds text[] DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_sort text DEFAULT 'due_asc',
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now(),
  p_today_start timestamptz DEFAULT date_trunc('day', now()),
  p_tomorrow_start timestamptz DEFAULT date_trunc('day', now()) + interval '1 day',
  p_cursor_value text DEFAULT NULL,
  p_cursor_key text DEFAULT NULL,
  p_cursor_null boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_department text := lower(trim(coalesce(p_department, 'acquisitions')));
  clean_view text := lower(trim(coalesce(p_view, 'all')));
  clean_status text := lower(trim(coalesce(p_status_filter, 'all')));
  clean_assignee text := nullif(trim(coalesce(p_assignee, '')), '');
  clean_due text := lower(trim(coalesce(p_due_filter, 'any')));
  clean_query text := nullif(lower(trim(coalesce(p_query, ''))), '');
  clean_sort text := lower(trim(coalesce(p_sort, 'due_asc')));
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  cursor_timestamp timestamptz;
  page_rows jsonb := '[]'::jsonb;
  page_count integer := 0;
  filtered_total bigint := 0;
  all_count bigint := 0;
  today_count bigint := 0;
  overdue_count bigint := 0;
  upcoming_count bigint := 0;
  completed_count bigint := 0;
BEGIN
  IF clean_department NOT IN ('acquisitions', 'dispositions', 'tc') THEN RAISE EXCEPTION 'invalid_task_department'; END IF;
  IF clean_view NOT IN ('all', 'due_today', 'overdue', 'upcoming', 'completed') THEN RAISE EXCEPTION 'invalid_task_view'; END IF;
  IF clean_status NOT IN ('all', 'active', 'completed') THEN RAISE EXCEPTION 'invalid_task_status_filter'; END IF;
  IF clean_due NOT IN ('any', 'no_due', 'seven_days', 'thirty_days') THEN RAISE EXCEPTION 'invalid_task_due_filter'; END IF;
  IF clean_sort NOT IN ('due_asc', 'due_desc', 'newest', 'title') THEN RAISE EXCEPTION 'invalid_task_sort'; END IF;
  IF clean_query IS NOT NULL AND length(clean_query) > 100 THEN RAISE EXCEPTION 'task_query_too_long'; END IF;
  IF p_cursor_key IS NOT NULL AND length(p_cursor_key) > 160 THEN RAISE EXCEPTION 'invalid_task_cursor'; END IF;
  IF p_cursor_key IS NOT NULL AND p_cursor_value IS NULL AND NOT p_cursor_null THEN RAISE EXCEPTION 'invalid_task_cursor'; END IF;
  IF p_tomorrow_start <= p_today_start THEN RAISE EXCEPTION 'invalid_task_day_bounds'; END IF;

  IF p_cursor_value IS NOT NULL AND clean_sort IN ('due_asc', 'due_desc', 'newest') THEN
    BEGIN
      cursor_timestamp := p_cursor_value::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_task_cursor';
    END;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at >= p_today_start AND item.due_at < p_tomorrow_start),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at < p_now),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at >= p_tomorrow_start),
    count(*) FILTER (WHERE item.status = 'completed')
  INTO all_count, today_count, overdue_count, upcoming_count, completed_count
  FROM public.work_items item
  WHERE item.department = clean_department
    AND item.status IN ('pending', 'blocked', 'completed');

  WITH filtered AS (
    SELECT item.*, lead.full_name, lead.phone, lead.email, lead.property_address,
      lead.city, lead.state, lead.zip, lead.station, lead.created_at AS lead_created_at
    FROM public.work_items item
    LEFT JOIN public.leads lead ON lead.id = item.lead_id
    WHERE item.department = clean_department
      AND item.status IN ('pending', 'blocked', 'completed')
      AND (
        clean_view = 'all'
        OR (clean_view = 'due_today' AND item.status IN ('pending', 'blocked') AND item.due_at >= p_today_start AND item.due_at < p_tomorrow_start)
        OR (clean_view = 'overdue' AND item.status IN ('pending', 'blocked') AND item.due_at < p_now)
        OR (clean_view = 'upcoming' AND item.status IN ('pending', 'blocked') AND item.due_at >= p_tomorrow_start)
        OR (clean_view = 'completed' AND item.status = 'completed')
      )
      AND (
        clean_status = 'all'
        OR (clean_status = 'active' AND item.status IN ('pending', 'blocked'))
        OR (clean_status = 'completed' AND item.status = 'completed')
      )
      AND (
        clean_assignee IS NULL
        OR (clean_assignee = '__unassigned' AND item.assigned_to IS NULL)
        OR (clean_assignee <> '__unassigned' AND lower(item.assigned_to) = lower(clean_assignee))
      )
      AND (
        clean_due = 'any'
        OR (clean_due = 'no_due' AND item.due_at IS NULL)
        OR (clean_due = 'seven_days' AND item.due_at >= p_now AND item.due_at <= p_now + interval '7 days')
        OR (clean_due = 'thirty_days' AND item.due_at >= p_now AND item.due_at <= p_now + interval '30 days')
      )
      AND (p_kinds IS NULL OR cardinality(p_kinds) = 0 OR item.kind = ANY(p_kinds))
      AND (
        clean_query IS NULL
        OR lower(coalesce(item.title, '') || ' ' || coalesce(item.description, '') || ' ' || coalesce(item.assigned_to, '')) LIKE '%' || clean_query || '%'
        OR lower(coalesce(lead.full_name, '') || ' ' || coalesce(lead.property_address, '') || ' ' || coalesce(lead.phone, '')) LIKE '%' || clean_query || '%'
      )
  ), page AS (
    SELECT *
    FROM filtered item
    WHERE p_cursor_key IS NULL OR (
      (clean_sort = 'due_asc' AND (
        (NOT p_cursor_null AND (item.due_at > cursor_timestamp OR (item.due_at = cursor_timestamp AND item.work_item_key > p_cursor_key) OR item.due_at IS NULL))
        OR (p_cursor_null AND item.due_at IS NULL AND item.work_item_key > p_cursor_key)
      ))
      OR (clean_sort = 'due_desc' AND (
        (NOT p_cursor_null AND (item.due_at < cursor_timestamp OR (item.due_at = cursor_timestamp AND item.work_item_key > p_cursor_key) OR item.due_at IS NULL))
        OR (p_cursor_null AND item.due_at IS NULL AND item.work_item_key > p_cursor_key)
      ))
      OR (clean_sort = 'newest' AND (item.source_created_at < cursor_timestamp OR (item.source_created_at = cursor_timestamp AND item.work_item_key > p_cursor_key)))
      OR (clean_sort = 'title' AND (lower(item.title) > p_cursor_value OR (lower(item.title) = p_cursor_value AND item.work_item_key > p_cursor_key)))
    )
    ORDER BY
      CASE WHEN clean_sort = 'due_asc' THEN item.due_at END ASC NULLS LAST,
      CASE WHEN clean_sort = 'due_desc' THEN item.due_at END DESC NULLS LAST,
      CASE WHEN clean_sort = 'newest' THEN item.source_created_at END DESC,
      CASE WHEN clean_sort = 'title' THEN lower(item.title) END ASC,
      item.work_item_key ASC
    LIMIT safe_limit + 1
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'key', row.work_item_key,
      'sourceKind', row.source_kind,
      'sourceId', row.source_id,
      'leadId', row.lead_id,
      'tcFileId', row.tc_file_id,
      'kind', row.kind,
      'title', row.title,
      'description', row.description,
      'status', row.status,
      'priority', row.priority,
      'dueAt', row.due_at,
      'assignedTo', row.assigned_to,
      'department', row.department,
      'role', row.role,
      'primaryNextAction', row.primary_next_action,
      'version', row.version,
      'sourceCreatedAt', row.source_created_at,
      'completedAt', row.completed_at,
      'updatedAt', row.updated_at,
      'contact', CASE WHEN row.lead_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', row.lead_id,
        'fullName', row.full_name,
        'phone', row.phone,
        'email', row.email,
        'propertyAddress', row.property_address,
        'city', row.city,
        'state', row.state,
        'zip', row.zip,
        'station', row.station,
        'createdAt', row.lead_created_at
      ) END
    ) ORDER BY
      CASE WHEN clean_sort = 'due_asc' THEN row.due_at END ASC NULLS LAST,
      CASE WHEN clean_sort = 'due_desc' THEN row.due_at END DESC NULLS LAST,
      CASE WHEN clean_sort = 'newest' THEN row.source_created_at END DESC,
      CASE WHEN clean_sort = 'title' THEN lower(row.title) END ASC,
      row.work_item_key ASC), '[]'::jsonb),
    count(*)
  INTO page_rows, page_count
  FROM page row;

  WITH filtered AS (
    SELECT item.*
    FROM public.work_items item
    LEFT JOIN public.leads lead ON lead.id = item.lead_id
    WHERE item.department = clean_department
      AND item.status IN ('pending', 'blocked', 'completed')
      AND (clean_view = 'all'
        OR (clean_view = 'due_today' AND item.status IN ('pending', 'blocked') AND item.due_at >= p_today_start AND item.due_at < p_tomorrow_start)
        OR (clean_view = 'overdue' AND item.status IN ('pending', 'blocked') AND item.due_at < p_now)
        OR (clean_view = 'upcoming' AND item.status IN ('pending', 'blocked') AND item.due_at >= p_tomorrow_start)
        OR (clean_view = 'completed' AND item.status = 'completed'))
      AND (clean_status = 'all' OR (clean_status = 'active' AND item.status IN ('pending', 'blocked')) OR (clean_status = 'completed' AND item.status = 'completed'))
      AND (clean_assignee IS NULL OR (clean_assignee = '__unassigned' AND item.assigned_to IS NULL) OR (clean_assignee <> '__unassigned' AND lower(item.assigned_to) = lower(clean_assignee)))
      AND (clean_due = 'any' OR (clean_due = 'no_due' AND item.due_at IS NULL) OR (clean_due = 'seven_days' AND item.due_at >= p_now AND item.due_at <= p_now + interval '7 days') OR (clean_due = 'thirty_days' AND item.due_at >= p_now AND item.due_at <= p_now + interval '30 days'))
      AND (p_kinds IS NULL OR cardinality(p_kinds) = 0 OR item.kind = ANY(p_kinds))
      AND (clean_query IS NULL OR lower(coalesce(item.title, '') || ' ' || coalesce(item.description, '') || ' ' || coalesce(item.assigned_to, '')) LIKE '%' || clean_query || '%' OR lower(coalesce(lead.full_name, '') || ' ' || coalesce(lead.property_address, '') || ' ' || coalesce(lead.phone, '')) LIKE '%' || clean_query || '%')
  )
  SELECT count(*) INTO filtered_total FROM filtered;

  RETURN jsonb_build_object(
    'items', CASE WHEN page_count > safe_limit THEN page_rows - (page_count - 1) ELSE page_rows END,
    'hasMore', page_count > safe_limit,
    'limit', safe_limit,
    'total', filtered_total,
    'counts', jsonb_build_object(
      'all', all_count,
      'due_today', today_count,
      'overdue', overdue_count,
      'upcoming', upcoming_count,
      'completed', completed_count
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.task_worklist_page_v1(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_worklist_page_v1(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.task_worklist_page_v1(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean) IS
  'Returns one server-filtered, cursor-bounded operational task page plus exact smart-list counts.';
