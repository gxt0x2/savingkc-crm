#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-primary-integrity.XXXXXX)"
PG_PORT="$((54000 + $$ % 1000))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
MIGRATION="$(pwd)/supabase/migrations/20260910120000_primary_next_action_integrity.sql"

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
  UNIQUE (source_kind, source_id)
);

CREATE FUNCTION public.contact_workspace_normalize_stage(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(value, '')))
    WHEN '' THEN 'new'
    WHEN 'intake' THEN 'new'
    WHEN 'qualifying' THEN 'qualified'
    WHEN 'appt_set' THEN 'appointment_set'
    WHEN 'offer' THEN 'offer_made'
    WHEN 'contract' THEN 'under_contract'
    WHEN 'closed' THEN 'closed_won'
    ELSE lower(btrim(coalesce(value, '')))
  END
$$;

CREATE FUNCTION public.contact_workspace_pipeline_intent_source(
  lead_source text,
  activity_type text,
  activity_metadata jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(coalesce(lead_source, '')) IN ('website_form', 'google_ads', 'inbound_ivr')
      THEN lower(lead_source)
    WHEN activity_metadata ->> 'action' = 'pipeline_intent'
      THEN activity_metadata ->> 'source'
    ELSE NULL
  END
$$;

CREATE FUNCTION public.work_item_status_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(coalesce(value, 'pending'))
    WHEN 'completed' THEN 'completed'
    WHEN 'done' THEN 'completed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'blocked' THEN 'blocked'
    ELSE 'pending'
  END
$$;

CREATE FUNCTION public.task_provenance_class_v1(metadata_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN metadata_value ->> 'source' = 'automation_generated' THEN 'automation_unreviewed'
    ELSE 'human'
  END
$$;

CREATE FUNCTION public.sync_activity_work_item_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_status text;
  item_lane text;
BEGIN
  item_status := public.work_item_status_v1(NEW.metadata ->> 'status');
  item_lane := CASE
    WHEN public.task_provenance_class_v1(NEW.metadata) = 'automation_unreviewed' THEN 'quarantine'
    WHEN lower(coalesce(NEW.metadata ->> 'legacy_event_review', 'false')) = 'true' THEN 'review'
    WHEN public.lead_is_active_opportunity_v1(NEW.lead_id) THEN 'current'
    ELSE 'review'
  END;
  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, operational_lane,
    status, primary_next_action, source_metadata
  ) VALUES (
    'activity:' || NEW.id::text, 'activity', NEW.id, NEW.lead_id, item_lane,
    item_status,
    lower(coalesce(NEW.metadata ->> 'primary_next_action', 'false')) = 'true',
    NEW.metadata
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    operational_lane = EXCLUDED.operational_lane,
    status = EXCLUDED.status,
    primary_next_action = EXCLUDED.primary_next_action,
    source_metadata = EXCLUDED.source_metadata;
  RETURN NEW;
END
$$;

INSERT INTO public.leads (id, station, classification) VALUES
  ('10000000-0000-4000-8000-000000000001', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000002', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000003', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000004', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000005', 'qualified', 'opportunity');

-- Two approved historical exceptions exist before the guard is installed.
INSERT INTO public.lead_activities (id, lead_id, activity_type, description, metadata) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task', 'Historical A', '{"status":"pending","primary_next_action":true}'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'task', 'Historical B', '{"status":"blocked","primary_next_action":true}');
INSERT INTO public.work_items VALUES
  ('activity:20000000-0000-4000-8000-000000000001', 'activity', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'current', 'pending', true, '{"status":"pending","primary_next_action":true}'),
  ('activity:20000000-0000-4000-8000-000000000002', 'activity', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'current', 'blocked', true, '{"status":"blocked","primary_next_action":true}');
SQL

"${PSQL[@]}" -f "$MIGRATION" >/dev/null

"${PSQL[@]}" <<'SQL'
-- Existing duplicate primaries remain editable.
UPDATE public.lead_activities
SET description = 'Historical A edited'
WHERE id = '20000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
    VALUES ('10000000-0000-4000-8000-000000000001', 'task', 'Forbidden third', '{"status":"pending","primary_next_action":true}');
    RAISE EXCEPTION 'duplicate primary was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate primary was not blocked' OR position('primary_next_action_exists' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$$;

-- The first current primary is allowed; a second is denied.
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
VALUES ('10000000-0000-4000-8000-000000000002', 'follow_up', 'Clean first', '{"status":"pending","primary_next_action":true}');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
    VALUES ('10000000-0000-4000-8000-000000000002', 'follow_up', 'Clean second', '{"status":"pending","primary_next_action":true}');
    RAISE EXCEPTION 'duplicate primary was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate primary was not blocked' OR position('primary_next_action_exists' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$$;

-- Completing the old primary and creating its replacement remains valid.
UPDATE public.lead_activities
SET metadata = metadata || '{"status":"completed"}'::jsonb
WHERE lead_id = '10000000-0000-4000-8000-000000000002'
  AND description = 'Clean first';
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
VALUES ('10000000-0000-4000-8000-000000000002', 'follow_up', 'Clean replacement', '{"status":"pending","primary_next_action":true}');

-- Quarantined automation remains reviewable but does not satisfy the invariant.
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
VALUES ('10000000-0000-4000-8000-000000000003', 'task', 'Automation review', '{"status":"pending","primary_next_action":true,"source":"automation_generated"}');

DO $$
DECLARE summary jsonb;
BEGIN
  summary := public.primary_next_action_integrity_summary_v1();
  IF summary <> '{"activeOpportunities":5,"opportunitiesWithNoPrimary":3,"opportunitiesWithOnePrimary":1,"opportunitiesWithMultiplePrimary":1}'::jsonb THEN
    RAISE EXCEPTION 'unexpected integrity summary: %', summary;
  END IF;
END
$$;

-- A single multi-row statement cannot bypass the row guard.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata) VALUES
      ('10000000-0000-4000-8000-000000000005', 'task', 'Batch A', '{"status":"pending","primary_next_action":true}'),
      ('10000000-0000-4000-8000-000000000005', 'task', 'Batch B', '{"status":"pending","primary_next_action":true}');
    RAISE EXCEPTION 'multi-row duplicate primary was not blocked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'multi-row duplicate primary was not blocked' OR position('primary_next_action_exists' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END
$$;
SQL

# Two concurrent first-primary inserts for one lead must serialize; exactly one wins.
"${PSQL[@]}" <<'SQL' &
BEGIN;
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
VALUES ('10000000-0000-4000-8000-000000000004', 'task', 'Race A', '{"status":"pending","primary_next_action":true}');
SELECT pg_sleep(1);
COMMIT;
SQL
FIRST_PID=$!
sleep 0.2
if "${PSQL[@]}" <<'SQL'
INSERT INTO public.lead_activities (lead_id, activity_type, description, metadata)
VALUES ('10000000-0000-4000-8000-000000000004', 'task', 'Race B', '{"status":"pending","primary_next_action":true}');
SQL
then
  echo "concurrent duplicate primary was not blocked" >&2
  exit 1
fi
wait "$FIRST_PID"

"${PSQL[@]}" -Atc "SELECT count(*) FROM public.work_items WHERE lead_id = '10000000-0000-4000-8000-000000000004' AND operational_lane = 'current' AND status IN ('pending','blocked') AND primary_next_action" | grep -qx '1'
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

echo "primary next-action migration rehearsal passed"
