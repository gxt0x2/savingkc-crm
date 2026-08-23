#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-primary-repair.XXXXXX)"
PG_PORT="$((55000 + $$ % 500))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
INTEGRITY_MIGRATION="$(pwd)/supabase/migrations/20260910120000_primary_next_action_integrity.sql"
REPAIR_MIGRATION="$(pwd)/supabase/migrations/20260911120000_primary_next_action_controlled_repair.sql"

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
  operational_lane text NOT NULL,
  status text NOT NULL,
  primary_next_action boolean NOT NULL,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz NOT NULL,
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
  SELECT CASE lower(btrim(coalesce(value, '')))
    WHEN '' THEN 'new' WHEN 'closed' THEN 'closed_won'
    ELSE lower(btrim(coalesce(value, ''))) END
$$;
CREATE FUNCTION public.contact_workspace_pipeline_intent_source(
  lead_source text, activity_type text, activity_metadata jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(coalesce(lead_source, '')) IN ('website_form', 'google_ads')
    THEN lower(lead_source) ELSE NULL END
$$;
CREATE FUNCTION public.work_item_status_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(value, 'pending'))
    WHEN 'completed' THEN 'completed' WHEN 'blocked' THEN 'blocked'
    WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END
$$;
CREATE FUNCTION public.task_provenance_class_v1(metadata_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) = 'canonical_work_item'
      THEN 'governed_human'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN
      ('lead_detail_task', 'calendar', 'calendar_new_task')
      THEN 'legacy_operator'
    WHEN coalesce(metadata_value, '{}'::jsonb) ? 'call_sid'
      THEN 'event_derived'
    ELSE 'unknown' END
$$;
CREATE FUNCTION public.sync_activity_work_item_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.work_items WHERE source_kind = 'activity' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, operational_lane,
    status, primary_next_action, source_metadata, source_created_at, updated_at
  ) VALUES (
    'activity:' || NEW.id::text, 'activity', NEW.id, NEW.lead_id, 'current',
    public.work_item_status_v1(NEW.metadata ->> 'status'),
    lower(coalesce(NEW.metadata ->> 'primary_next_action', 'false')) = 'true',
    NEW.metadata, NEW.created_at, statement_timestamp()
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    operational_lane = EXCLUDED.operational_lane,
    status = EXCLUDED.status,
    primary_next_action = EXCLUDED.primary_next_action,
    source_metadata = EXCLUDED.source_metadata,
    updated_at = statement_timestamp();
  RETURN NEW;
END
$$;

INSERT INTO public.leads (id, station, classification)
SELECT ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'qualified', 'opportunity'
FROM generate_series(1, 19) AS value;

-- Four sole operator candidates.
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
SELECT ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'task', 'Sole operator task ' || value,
  jsonb_build_object('status', 'pending', 'primary_next_action', false,
    'source', CASE WHEN value = 4 THEN 'calendar' ELSE 'lead_detail_task' END)
FROM generate_series(1, 4) AS value;

-- Four ambiguous opportunities, each with two operator candidates.
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
SELECT ('10000000-0000-4000-8000-' || lpad(lead_value::text, 12, '0'))::uuid,
  'task', 'Ambiguous operator task ' || lead_value || '-' || task_value,
  '{"status":"pending","primary_next_action":false,"source":"lead_detail_task"}'::jsonb
FROM generate_series(5, 8) AS lead_value
CROSS JOIN generate_series(1, 2) AS task_value;

-- Four event-derived rows are intentionally ineligible; seven leads have none.
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
SELECT ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'task', 'Event task ' || value,
  jsonb_build_object('status', 'pending', 'primary_next_action', false,
    'call_sid', 'CA' || value)
FROM generate_series(9, 12) AS value;

CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF lead_id, activity_type, description, agent, metadata OR DELETE
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

-- Seed rows were inserted before the trigger; build their projection now.
UPDATE public.lead_activities SET metadata = metadata;
SQL

"${PSQL[@]}" -f "$INTEGRITY_MIGRATION" >/dev/null
"${PSQL[@]}" -f "$REPAIR_MIGRATION" >/dev/null
"${PSQL[@]}" -f "$REPAIR_MIGRATION" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $$
DECLARE
  census jsonb;
  result jsonb;
  retry_result jsonb;
  rollback_result jsonb;
  old_fingerprint text;
  current_fingerprint text;
  post_fingerprint text;
BEGIN
  census := public.primary_next_action_repair_census_v1();
  IF census ->> 'missingPrimary' <> '19'
    OR census ->> 'eligiblePromotions' <> '4'
    OR census ->> 'leadsWithNoTrustworthyCandidate' <> '11'
    OR census ->> 'leadsWithMultipleTrustworthyCandidates' <> '4'
    OR census -> 'eligibleByProvenance' <> '{"legacy_operator":4}'::jsonb THEN
    RAISE EXCEPTION 'unexpected repair census: %', census;
  END IF;

  old_fingerprint := census ->> 'eligibleFingerprint';
  UPDATE public.lead_activities
  SET metadata = metadata || '{"notes":"operator clarified"}'::jsonb
  WHERE lead_id = '10000000-0000-4000-8000-000000000001';

  BEGIN
    PERFORM public.promote_existing_operator_primary_next_actions_v1(
      19, 4, old_fingerprint, 'Ernest'
    );
    RAISE EXCEPTION 'drifted repair was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'drifted repair was not blocked'
      OR position('repair_census_drift' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  census := public.primary_next_action_repair_census_v1();
  current_fingerprint := census ->> 'eligibleFingerprint';
  result := public.promote_existing_operator_primary_next_actions_v1(
    19, 4, current_fingerprint, 'Ernest'
  );
  IF result ->> 'changed' <> 'true' OR result ->> 'promoted' <> '4' THEN
    RAISE EXCEPTION 'unexpected repair result: %', result;
  END IF;
  IF result #>> '{integrity,opportunitiesWithNoPrimary}' <> '15'
    OR result #>> '{integrity,opportunitiesWithOnePrimary}' <> '4' THEN
    RAISE EXCEPTION 'unexpected post-repair integrity: %', result;
  END IF;

  retry_result := public.promote_existing_operator_primary_next_actions_v1(
    19, 4, current_fingerprint, 'Ernest'
  );
  IF retry_result ->> 'changed' <> 'false'
    OR retry_result ->> 'alreadyApplied' <> 'true' THEN
    RAISE EXCEPTION 'repair retry was not idempotent: %', retry_result;
  END IF;

  IF (SELECT count(*) FROM public.work_item_events
      WHERE action = 'promote_primary_next_action') <> 4 THEN
    RAISE EXCEPTION 'repair audit event count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.lead_activities
      WHERE metadata ->> 'primary_next_action_repair' = 'existing_operator_task_v1'
        AND metadata ->> 'primary_next_action' = 'true') <> 4 THEN
    RAISE EXCEPTION 'repair source marker count mismatch';
  END IF;

  post_fingerprint := result ->> 'postRepairFingerprint';
  rollback_result := public.rollback_existing_operator_primary_next_actions_v1(
    4, current_fingerprint, post_fingerprint, 'Ernest'
  );
  IF rollback_result ->> 'rolledBack' <> '4'
    OR rollback_result #>> '{integrity,opportunitiesWithNoPrimary}' <> '19' THEN
    RAISE EXCEPTION 'unexpected rollback result: %', rollback_result;
  END IF;
  IF (SELECT count(*) FROM public.work_item_events
      WHERE action = 'rollback_primary_next_action_promotion') <> 4 THEN
    RAISE EXCEPTION 'rollback audit event count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.lead_activities
      WHERE metadata ? 'primary_next_action_repair') <> 0 THEN
    RAISE EXCEPTION 'rollback left repair markers';
  END IF;
END
$$;

-- App roles cannot execute census or either mutation entrypoint.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.primary_next_action_repair_census_v1()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.primary_next_action_repair_census_v1()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.promote_existing_operator_primary_next_actions_v1(integer,integer,text,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.rollback_existing_operator_primary_next_actions_v1(integer,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'repair function grants are too broad';
  END IF;
END
$$;
SQL

echo "controlled primary next-action repair rehearsal passed"
