-- Indexed, read-only operational lanes for Tasks and Conversations.
--
-- This migration is staged beside the v1 RPCs. Existing readers remain valid
-- until the application switches to v2. No task status, conversation state,
-- ownership, lifecycle, or customer communication is changed.

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS operational_lane text;

UPDATE public.work_items AS item
SET operational_lane = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.leads AS lead
    WHERE lead.id = item.lead_id
      AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
      AND lower(coalesce(lead.classification, '')) <> 'dead'
  ) THEN 'current'
  ELSE 'review'
END
WHERE item.operational_lane IS NULL
   OR item.operational_lane NOT IN ('current', 'review');

ALTER TABLE public.work_items
  ALTER COLUMN operational_lane SET DEFAULT 'review',
  ALTER COLUMN operational_lane SET NOT NULL;

ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_operational_lane_check;
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_operational_lane_check
  CHECK (operational_lane IN ('current', 'review')) NOT VALID;

CREATE OR REPLACE FUNCTION public.set_work_item_operational_lane_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.operational_lane := CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE lead.id = NEW.lead_id
        AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
        AND lower(coalesce(lead.classification, '')) <> 'dead'
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
BEFORE INSERT OR UPDATE OF lead_id ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.set_work_item_operational_lane_v1();

CREATE OR REPLACE FUNCTION public.sync_work_item_operational_lane_from_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_lane text;
BEGIN
  next_lane := CASE
    WHEN lower(coalesce(NEW.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
      AND lower(coalesce(NEW.classification, '')) <> 'dead'
    THEN 'current'
    ELSE 'review'
  END;

  UPDATE public.work_items
  SET operational_lane = next_lane,
      updated_at = now()
  WHERE lead_id = NEW.id
    AND operational_lane IS DISTINCT FROM next_lane;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() TO service_role;

DROP TRIGGER IF EXISTS trigger_sync_work_item_operational_lane_from_lead_v1 ON public.leads;
CREATE TRIGGER trigger_sync_work_item_operational_lane_from_lead_v1
AFTER UPDATE OF station, classification ON public.leads
FOR EACH ROW
WHEN (OLD.station IS DISTINCT FROM NEW.station OR OLD.classification IS DISTINCT FROM NEW.classification)
EXECUTE FUNCTION public.sync_work_item_operational_lane_from_lead_v1();

CREATE INDEX IF NOT EXISTS idx_work_items_operational_lane_due
  ON public.work_items (department, operational_lane, due_at ASC NULLS LAST, work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');
CREATE INDEX IF NOT EXISTS idx_work_items_operational_lane_created
  ON public.work_items (department, operational_lane, source_created_at DESC, work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');
CREATE INDEX IF NOT EXISTS idx_work_items_operational_lane_title
  ON public.work_items (department, operational_lane, lower(title), work_item_key)
  WHERE status IN ('pending', 'blocked', 'completed');

CREATE OR REPLACE FUNCTION public.task_worklist_page_v2(
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
  p_cursor_null boolean DEFAULT false,
  p_lane text DEFAULT 'current'
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
  clean_lane text := lower(trim(coalesce(p_lane, 'current')));
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  cursor_timestamp timestamptz;
  cursor_sql text;
  page_order_sql text;
  aggregate_order_sql text;
  page_rows jsonb := '[]'::jsonb;
  page_count integer := 0;
  filtered_total bigint := 0;
  all_count bigint := 0;
  today_count bigint := 0;
  overdue_count bigint := 0;
  upcoming_count bigint := 0;
  completed_count bigint := 0;
  lane_all_count bigint := 0;
  lane_current_count bigint := 0;
  lane_review_count bigint := 0;
BEGIN
  IF clean_department NOT IN ('acquisitions', 'dispositions', 'tc') THEN RAISE EXCEPTION 'invalid_task_department'; END IF;
  IF clean_view NOT IN ('all', 'due_today', 'overdue', 'upcoming', 'completed') THEN RAISE EXCEPTION 'invalid_task_view'; END IF;
  IF clean_status NOT IN ('all', 'active', 'completed') THEN RAISE EXCEPTION 'invalid_task_status_filter'; END IF;
  IF clean_due NOT IN ('any', 'no_due', 'seven_days', 'thirty_days') THEN RAISE EXCEPTION 'invalid_task_due_filter'; END IF;
  IF clean_sort NOT IN ('due_asc', 'due_desc', 'newest', 'title') THEN RAISE EXCEPTION 'invalid_task_sort'; END IF;
  IF clean_lane NOT IN ('current', 'review', 'all') THEN RAISE EXCEPTION 'invalid_task_lane'; END IF;
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

  IF clean_sort = 'due_asc' THEN
    page_order_sql := 'item.due_at ASC NULLS LAST, item.work_item_key ASC';
    aggregate_order_sql := 'row.due_at ASC NULLS LAST, row.work_item_key ASC';
    cursor_sql := '$13 IS NULL OR ((NOT $14 AND (item.due_at > $12 OR (item.due_at = $12 AND item.work_item_key > $13) OR item.due_at IS NULL)) OR ($14 AND item.due_at IS NULL AND item.work_item_key > $13))';
  ELSIF clean_sort = 'due_desc' THEN
    page_order_sql := 'item.due_at DESC NULLS LAST, item.work_item_key ASC';
    aggregate_order_sql := 'row.due_at DESC NULLS LAST, row.work_item_key ASC';
    cursor_sql := '$13 IS NULL OR ((NOT $14 AND (item.due_at < $12 OR (item.due_at = $12 AND item.work_item_key > $13) OR item.due_at IS NULL)) OR ($14 AND item.due_at IS NULL AND item.work_item_key > $13))';
  ELSIF clean_sort = 'newest' THEN
    page_order_sql := 'item.source_created_at DESC, item.work_item_key ASC';
    aggregate_order_sql := 'row.source_created_at DESC, row.work_item_key ASC';
    cursor_sql := '$13 IS NULL OR item.source_created_at < $12 OR (item.source_created_at = $12 AND item.work_item_key > $13)';
  ELSE
    page_order_sql := 'lower(item.title) ASC, item.work_item_key ASC';
    aggregate_order_sql := 'lower(row.title) ASC, row.work_item_key ASC';
    cursor_sql := '$13 IS NULL OR lower(item.title) > $15 OR (lower(item.title) = $15 AND item.work_item_key > $13)';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE item.operational_lane = 'current'),
    count(*) FILTER (WHERE item.operational_lane = 'review')
  INTO lane_all_count, lane_current_count, lane_review_count
  FROM public.work_items AS item
  WHERE item.department = clean_department
    AND item.status IN ('pending', 'blocked', 'completed');

  SELECT
    count(*),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at >= p_today_start AND item.due_at < p_tomorrow_start),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at < p_now),
    count(*) FILTER (WHERE item.status IN ('pending', 'blocked') AND item.due_at >= p_tomorrow_start),
    count(*) FILTER (WHERE item.status = 'completed')
  INTO all_count, today_count, overdue_count, upcoming_count, completed_count
  FROM public.work_items AS item
  WHERE item.department = clean_department
    AND item.status IN ('pending', 'blocked', 'completed')
    AND (clean_lane = 'all' OR item.operational_lane = clean_lane);

  EXECUTE format($query$
    WITH filtered AS (
      SELECT item.*, lead.full_name, lead.phone, lead.email, lead.property_address,
        lead.city, lead.state, lead.zip, lead.station, lead.created_at AS lead_created_at
      FROM public.work_items item
      LEFT JOIN public.leads lead ON lead.id = item.lead_id
      WHERE item.department = $1
        AND item.status IN ('pending', 'blocked', 'completed')
        AND ($16 = 'all' OR item.operational_lane = $16)
        AND ($2 = 'all'
          OR ($2 = 'due_today' AND item.status IN ('pending', 'blocked') AND item.due_at >= $9 AND item.due_at < $10)
          OR ($2 = 'overdue' AND item.status IN ('pending', 'blocked') AND item.due_at < $8)
          OR ($2 = 'upcoming' AND item.status IN ('pending', 'blocked') AND item.due_at >= $10)
          OR ($2 = 'completed' AND item.status = 'completed'))
        AND ($3 = 'all' OR ($3 = 'active' AND item.status IN ('pending', 'blocked')) OR ($3 = 'completed' AND item.status = 'completed'))
        AND ($4 IS NULL OR ($4 = '__unassigned' AND item.assigned_to IS NULL) OR ($4 <> '__unassigned' AND lower(item.assigned_to) = lower($4)))
        AND ($5 = 'any' OR ($5 = 'no_due' AND item.due_at IS NULL) OR ($5 = 'seven_days' AND item.due_at >= $8 AND item.due_at <= $8 + interval '7 days') OR ($5 = 'thirty_days' AND item.due_at >= $8 AND item.due_at <= $8 + interval '30 days'))
        AND ($6 IS NULL OR cardinality($6) = 0 OR item.kind = ANY($6))
        AND ($7 IS NULL
          OR lower(coalesce(item.title, '') || ' ' || coalesce(item.description, '') || ' ' || coalesce(item.assigned_to, '')) LIKE '%%' || $7 || '%%'
          OR lower(coalesce(lead.full_name, '') || ' ' || coalesce(lead.property_address, '') || ' ' || coalesce(lead.phone, '')) LIKE '%%' || $7 || '%%')
    ), page AS (
      SELECT * FROM filtered item
      WHERE %s
      ORDER BY %s
      LIMIT ($11 + 1)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', row.work_item_key, 'sourceKind', row.source_kind, 'sourceId', row.source_id,
      'leadId', row.lead_id, 'tcFileId', row.tc_file_id, 'kind', row.kind, 'title', row.title,
      'description', row.description, 'status', row.status, 'priority', row.priority, 'dueAt', row.due_at,
      'assignedTo', row.assigned_to, 'department', row.department, 'role', row.role,
      'primaryNextAction', row.primary_next_action, 'version', row.version,
      'sourceCreatedAt', row.source_created_at, 'completedAt', row.completed_at, 'updatedAt', row.updated_at,
      'contact', CASE WHEN row.lead_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', row.lead_id, 'fullName', row.full_name, 'phone', row.phone, 'email', row.email,
        'propertyAddress', row.property_address, 'city', row.city, 'state', row.state, 'zip', row.zip,
        'station', row.station, 'createdAt', row.lead_created_at) END
    ) ORDER BY %s), '[]'::jsonb), count(*)
    FROM page row
  $query$, cursor_sql, page_order_sql, aggregate_order_sql)
  INTO page_rows, page_count
  USING clean_department, clean_view, clean_status, clean_assignee, clean_due, p_kinds, clean_query,
    p_now, p_today_start, p_tomorrow_start, safe_limit, cursor_timestamp, p_cursor_key, p_cursor_null, p_cursor_value, clean_lane;

  WITH filtered AS (
    SELECT item.*
    FROM public.work_items item
    LEFT JOIN public.leads lead ON lead.id = item.lead_id
    WHERE item.department = clean_department
      AND item.status IN ('pending', 'blocked', 'completed')
      AND (clean_lane = 'all' OR item.operational_lane = clean_lane)
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
    'counts', jsonb_build_object('all', all_count, 'due_today', today_count, 'overdue', overdue_count,
      'upcoming', upcoming_count, 'completed', completed_count),
    'laneCounts', jsonb_build_object('all', lane_all_count, 'current', lane_current_count, 'review', lane_review_count)
  );
END
$$;

REVOKE ALL ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_known_inbox
  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_unmatched_inbox
  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC)
  WHERE lead_id IS NULL;

CREATE OR REPLACE FUNCTION public.conversation_thread_page_v2(
  page_limit integer DEFAULT 51,
  page_queue text DEFAULT 'needs_reply',
  page_actor text DEFAULT NULL,
  page_channel text DEFAULT NULL,
  page_query text DEFAULT NULL,
  page_kind text DEFAULT 'all',
  after_attention_rank smallint DEFAULT NULL,
  after_activity_at timestamptz DEFAULT NULL,
  after_thread_key text DEFAULT NULL
)
RETURNS SETOF public.conversation_thread_state
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_kind text := lower(trim(coalesce(page_kind, 'all')));
BEGIN
  IF clean_kind NOT IN ('all', 'known', 'unmatched') THEN
    RAISE EXCEPTION 'invalid_conversation_kind';
  END IF;

  RETURN QUERY
  SELECT thread.*
  FROM public.conversation_thread_state AS thread
  WHERE (
      page_queue = 'all'
      OR (page_queue = 'needs_reply' AND thread.attention_state = 'needs_reply')
      OR (page_queue = 'mine' AND NULLIF(btrim(page_actor), '') IS NOT NULL AND lower(thread.owner) = lower(page_actor))
      OR (page_queue = 'unassigned' AND NULLIF(btrim(thread.owner), '') IS NULL)
    )
    AND (clean_kind = 'all'
      OR (clean_kind = 'known' AND thread.lead_id IS NOT NULL)
      OR (clean_kind = 'unmatched' AND thread.lead_id IS NULL))
    AND (page_channel IS NULL OR thread.last_channel = page_channel)
    AND (NULLIF(btrim(page_query), '') IS NULL OR thread.search_text ILIKE '%' || btrim(page_query) || '%')
    AND (
      after_attention_rank IS NULL
      OR thread.attention_rank > after_attention_rank
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at < after_activity_at)
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at = after_activity_at AND thread.thread_key < after_thread_key)
    )
  ORDER BY thread.attention_rank ASC, thread.last_activity_at DESC, thread.thread_key DESC
  LIMIT least(greatest(coalesce(page_limit, 51), 1), 101);
END
$$;

REVOKE ALL ON FUNCTION public.conversation_thread_page_v2(integer, text, text, text, text, text, smallint, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_thread_page_v2(integer, text, text, text, text, text, smallint, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text) IS
  'Returns one response-capped, cursor-paginated task page filtered by the indexed current/review operational lane.';
COMMENT ON FUNCTION public.conversation_thread_page_v2(integer, text, text, text, text, text, smallint, timestamptz, text) IS
  'Returns one response-capped conversation page filtered by the indexed known/unmatched contact kind.';
