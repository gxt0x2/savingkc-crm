#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-phase-zero.XXXXXX)"
PG_PORT="$((56500 + $$ % 400))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
MIGRATION="$(pwd)/supabase/migrations/20260913120000_phase_zero_current_work_only.sql"

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
CREATE TABLE public.leads (id uuid PRIMARY KEY, station text, classification text);
CREATE TABLE public.work_items (
  work_item_key text PRIMARY KEY,
  lead_id uuid REFERENCES public.leads(id),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_lane text NOT NULL DEFAULT 'current',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.task_provenance_class_v1(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value ->> 'source' IN ('canonical_work_item', 'conversation_hub') THEN 'governed_human'
    WHEN value ->> 'source' = 'governed_workflow' THEN 'approved_workflow'
    WHEN value ->> 'source' IN ('lead_detail_task', 'calendar') THEN 'legacy_operator'
    WHEN value ->> 'source' = 'mojo' THEN 'automation_unreviewed'
    WHEN value ->> 'source' = 'twilio_sms_event' THEN 'event_derived'
    ELSE 'unknown'
  END
$$;
CREATE FUNCTION public.set_work_item_operational_lane_v1() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.sync_work_item_operational_lane_from_lead_v1() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trigger_set_work_item_operational_lane_v1
BEFORE INSERT OR UPDATE ON public.work_items FOR EACH ROW
EXECUTE FUNCTION public.set_work_item_operational_lane_v1();
CREATE TRIGGER trigger_sync_work_item_operational_lane_from_lead_v1
AFTER UPDATE OF station, classification ON public.leads FOR EACH ROW
EXECUTE FUNCTION public.sync_work_item_operational_lane_from_lead_v1();
CREATE FUNCTION public.transition_work_item_v1(text, text, text, text, integer DEFAULT NULL, jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jsonb_build_object('changed', true, 'workItem', $1)
$$;
GRANT EXECUTE ON FUNCTION public.transition_work_item_v1(text,text,text,text,integer,jsonb) TO service_role;

INSERT INTO public.leads VALUES
  ('10000000-0000-4000-8000-000000000001', 'qualified', 'opportunity'),
  ('10000000-0000-4000-8000-000000000002', 'dead', 'dead');
INSERT INTO public.work_items (work_item_key, lead_id, source_metadata) VALUES
  ('human', '10000000-0000-4000-8000-000000000001', '{"source":"canonical_work_item"}'),
  ('legacy', '10000000-0000-4000-8000-000000000001', '{"source":"lead_detail_task"}'),
  ('event', '10000000-0000-4000-8000-000000000001', '{"source":"twilio_sms_event"}'),
  ('automation', '10000000-0000-4000-8000-000000000001', '{"source":"mojo"}'),
  ('unknown', '10000000-0000-4000-8000-000000000001', '{}'),
  ('terminal', '10000000-0000-4000-8000-000000000002', '{"source":"canonical_work_item"}');
SQL

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $$
BEGIN
  IF (SELECT jsonb_object_agg(work_item_key, operational_lane) FROM public.work_items)
    <> '{"human":"current","legacy":"current","event":"review","automation":"quarantine","unknown":"quarantine","terminal":"review"}'::jsonb THEN
    RAISE EXCEPTION 'unexpected Phase Zero lanes: %', (SELECT jsonb_object_agg(work_item_key, operational_lane) FROM public.work_items);
  END IF;
  IF public.transition_work_item_v1('human','Casey','complete','phase-zero-current',NULL,'{}') ->> 'changed' <> 'true' THEN
    RAISE EXCEPTION 'current work did not transition';
  END IF;
  BEGIN
    PERFORM public.transition_work_item_v1('event','Casey','complete','phase-zero-event',NULL,'{}');
    RAISE EXCEPTION 'historical item transitioned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'historical item transitioned' OR position('work_item_not_current' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  IF has_function_privilege('service_role', 'public.transition_work_item_unchecked_v1(text,text,text,text,integer,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.transition_work_item_v1(text,text,text,text,integer,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'transition grants are incorrect';
  END IF;
END $$;
SQL

echo "Phase Zero current-work rehearsal passed"
