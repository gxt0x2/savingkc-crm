#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-primary-human-review.XXXXXX)"
PG_PORT="$((56000 + $$ % 500))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
INTEGRITY_MIGRATION="$(pwd)/supabase/migrations/20260910120000_primary_next_action_integrity.sql"
REVIEW_MIGRATION="$(pwd)/supabase/migrations/20260912120000_primary_next_action_human_resolution.sql"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  station text,
  classification text,
  source text,
  is_parked boolean NOT NULL DEFAULT false
);
CREATE TABLE public.contact_workspace_activity_state (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id),
  pipeline_intent_activity_type text,
  pipeline_intent_metadata jsonb
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id),
  activity_type text NOT NULL,
  description text,
  agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.work_items (
  work_item_key text PRIMARY KEY,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  lead_id uuid,
  tc_file_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  assigned_to text,
  department text NOT NULL DEFAULT 'acquisitions',
  role text,
  primary_next_action boolean NOT NULL DEFAULT false,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_lane text NOT NULL DEFAULT 'current',
  version integer NOT NULL DEFAULT 1,
  source_created_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);
CREATE TABLE public.work_item_events (
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

CREATE FUNCTION public.contact_workspace_normalize_stage(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(value, ''))) WHEN '' THEN 'new' ELSE lower(btrim(coalesce(value, ''))) END
$$;
CREATE FUNCTION public.contact_workspace_pipeline_intent_source(
  lead_source text, activity_type text, activity_metadata jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(coalesce(lead_source, '')) IN ('website_form', 'google_ads') THEN lower(lead_source) ELSE NULL END
$$;
CREATE FUNCTION public.work_item_status_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(value, 'pending')) WHEN 'completed' THEN 'completed' WHEN 'blocked' THEN 'blocked' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END
$$;
CREATE FUNCTION public.work_item_safe_timestamp_v1(value text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF nullif(trim(value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION public.task_provenance_class_v1(metadata_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN ('canonical_work_item', 'conversation_hub') THEN 'governed_human'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN ('lead_detail_task', 'calendar', 'calendar_new_task') THEN 'legacy_operator'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN ('mojo', 'system') THEN 'automation_unreviewed'
    WHEN coalesce(metadata_value, '{}'::jsonb) ? 'call_sid' THEN 'event_derived'
    ELSE 'unknown' END
$$;
CREATE FUNCTION public.sync_activity_work_item_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  metadata_value jsonb;
  item_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.work_items WHERE source_kind = 'activity' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  metadata_value := coalesce(NEW.metadata, '{}'::jsonb);
  item_status := public.work_item_status_v1(metadata_value ->> 'status');
  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, kind, title, description,
    status, priority, due_at, assigned_to, department, role,
    primary_next_action, source_metadata, operational_lane, source_created_at, completed_at
  ) VALUES (
    'activity:' || NEW.id::text, 'activity', NEW.id, NEW.lead_id, NEW.activity_type,
    coalesce(nullif(trim(metadata_value ->> 'title'), ''), nullif(trim(NEW.description), ''), 'Untitled task'),
    nullif(trim(metadata_value ->> 'notes'), ''), item_status,
    coalesce(nullif(lower(trim(metadata_value ->> 'priority')), ''), 'normal'),
    public.work_item_safe_timestamp_v1(metadata_value ->> 'due_date'),
    coalesce(nullif(trim(metadata_value ->> 'assigned_to'), ''), nullif(trim(NEW.agent), '')),
    'acquisitions', nullif(trim(metadata_value ->> 'role'), ''),
    lower(coalesce(metadata_value ->> 'primary_next_action', 'false')) = 'true',
    metadata_value,
    CASE WHEN public.task_provenance_class_v1(metadata_value) = 'automation_unreviewed' THEN 'quarantine' ELSE 'current' END,
    NEW.created_at,
    CASE WHEN item_status = 'completed' THEN NEW.created_at ELSE NULL END
  ) ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    kind = EXCLUDED.kind,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    due_at = EXCLUDED.due_at,
    assigned_to = EXCLUDED.assigned_to,
    primary_next_action = EXCLUDED.primary_next_action,
    source_metadata = EXCLUDED.source_metadata,
    operational_lane = EXCLUDED.operational_lane,
    version = public.work_items.version + 1,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF lead_id, activity_type, description, agent, metadata OR DELETE
ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

INSERT INTO public.leads (id, station, classification) VALUES
  ('10000000-0000-4000-8000-000000000001', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000002', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000003', 'dead', 'dead'),
  ('10000000-0000-4000-8000-000000000004', 'qualified', 'opportunity');

INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata) VALUES
  ('10000000-0000-4000-8000-000000000001', 'follow_up', 'Call seller', 'Casey', '{"status":"pending","source":"lead_detail_task","assigned_to":"Casey","due_date":"2026-08-24T15:00:00Z"}'),
  ('10000000-0000-4000-8000-000000000001', 'send_offer', 'Send revised offer', 'Ernest', '{"status":"blocked","source":"calendar","assigned_to":"Ernest","due_date":"2026-08-25T15:00:00Z"}'),
  ('10000000-0000-4000-8000-000000000001', 'task', 'AI suggestion', 'System', '{"status":"pending","source":"mojo"}'),
  ('10000000-0000-4000-8000-000000000002', 'task', 'Call event', 'System', '{"status":"pending","call_sid":"CA123"}'),
  ('10000000-0000-4000-8000-000000000003', 'task', 'Inactive task', 'Casey', '{"status":"pending","source":"lead_detail_task"}'),
  ('10000000-0000-4000-8000-000000000004', 'callback', 'Existing primary', 'Casey', '{"status":"pending","source":"canonical_work_item","primary_next_action":true}');
SQL

"${PSQL[@]}" -f "$INTEGRITY_MIGRATION" >/dev/null
"${PSQL[@]}" -f "$REVIEW_MIGRATION" >/dev/null
"${PSQL[@]}" -f "$REVIEW_MIGRATION" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $$
DECLARE
  review jsonb;
  result jsonb;
  retry jsonb;
  selected_key text;
  selected_version integer;
BEGIN
  review := public.primary_next_action_review_v1('10000000-0000-4000-8000-000000000001');
  IF review ->> 'resolutionKind' <> 'select'
    OR jsonb_array_length(review -> 'candidates') <> 2
    OR review ->> 'excludedAdvisoryCount' <> '1' THEN
    RAISE EXCEPTION 'unexpected selection review: %', review;
  END IF;
  selected_key := review #>> '{candidates,0,key}';
  selected_version := (review #>> '{candidates,0,version}')::integer;

  BEGIN
    PERFORM public.resolve_primary_next_action_v1(
      '10000000-0000-4000-8000-000000000001', 'select_existing', 'Casey',
      'forbidden-ai-selection',
      (SELECT work_item_key FROM public.work_items WHERE title = 'AI suggestion'), 1
    );
    RAISE EXCEPTION 'automation candidate was selectable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'automation candidate was selectable' OR position('primary_candidate_not_eligible' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  result := public.resolve_primary_next_action_v1(
    '10000000-0000-4000-8000-000000000001', 'select_existing', 'Casey',
    'human-select-review-1', selected_key, selected_version
  );
  IF result ->> 'changed' <> 'true'
    OR result #>> '{review,resolutionKind}' <> 'resolved'
    OR result #>> '{workItem,source_metadata,primary_next_action_resolution}' <> 'human_selected_existing_v1' THEN
    RAISE EXCEPTION 'unexpected selection result: %', result;
  END IF;
  retry := public.resolve_primary_next_action_v1(
    '10000000-0000-4000-8000-000000000001', 'select_existing', 'Casey',
    'human-select-review-1', selected_key, selected_version
  );
  IF retry ->> 'changed' <> 'false' THEN RAISE EXCEPTION 'selection retry was not idempotent: %', retry; END IF;

  review := public.primary_next_action_review_v1('10000000-0000-4000-8000-000000000002');
  IF review ->> 'resolutionKind' <> 'create'
    OR jsonb_array_length(review -> 'candidates') <> 0
    OR review ->> 'excludedAdvisoryCount' <> '1' THEN
    RAISE EXCEPTION 'unexpected create review: %', review;
  END IF;
  result := public.resolve_primary_next_action_v1(
    '10000000-0000-4000-8000-000000000002', 'create', 'Gertha',
    'human-create-review-1', NULL, NULL, 'callback', 'Call seller with revised offer',
    'Reviewed by Gertha', '2026-08-24T16:00:00Z', 'Gertha'
  );
  IF result ->> 'changed' <> 'true'
    OR result #>> '{review,resolutionKind}' <> 'resolved'
    OR result #>> '{workItem,source_metadata,primary_next_action_resolution}' <> 'human_created_v1' THEN
    RAISE EXCEPTION 'unexpected create result: %', result;
  END IF;

  IF public.primary_next_action_review_v1('10000000-0000-4000-8000-000000000003') ->> 'resolutionKind' <> 'ineligible' THEN
    RAISE EXCEPTION 'inactive lead was not rejected';
  END IF;
  IF public.primary_next_action_review_v1('10000000-0000-4000-8000-000000000004') ->> 'resolutionKind' <> 'resolved' THEN
    RAISE EXCEPTION 'existing primary was not detected';
  END IF;
  IF (SELECT count(*) FROM public.work_item_events WHERE action IN ('select_primary_next_action', 'create_primary_next_action')) <> 2 THEN
    RAISE EXCEPTION 'human resolution audit count mismatch';
  END IF;
  IF has_function_privilege('anon', 'public.primary_next_action_review_v1(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.resolve_primary_next_action_v1(uuid,text,text,text,text,integer,text,text,text,timestamptz,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.primary_next_action_review_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'human resolution function grants are incorrect';
  END IF;
END $$;
SQL

echo "primary next-action human resolution rehearsal passed"
