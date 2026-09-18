#!/usr/bin/env bash
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-mojo-appointments.XXXXXX)"
PG_PORT="$((58000 + $$ % 300))"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_DIR"
}
trap cleanup EXIT
mkdir -p "$REHEARSAL_DIR/socket"
"$PG_BIN/initdb" -D "$REHEARSAL_DIR/data" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -o "-F -p $PG_PORT -k $REHEARSAL_DIR/socket -h ''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)
"${PSQL[@]}" >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE leads(id text, station text, classification text);
CREATE TABLE appointments(id text, lead_id text, scheduled_at timestamptz, status text, source text, source_call_id text);
CREATE TABLE lead_activities(metadata jsonb, created_at timestamptz, activity_type text, description text);
CREATE TABLE crm_mojo_call_events(id text, record_id text, lead_id text, call_at timestamptz, qualification_status text,
  follow_up_at timestamptz, provider_recording_id text, recording_url text);
CREATE TABLE mojo_call_queue(record_id text, created_at timestamptz, status text);
CREATE TABLE mojo_source_batches(id text, created_at timestamptz, last_error text, accepted_at timestamptz);
CREATE FUNCTION crm_mojo_reconciliation_snapshot_base_v1(p_since timestamptz DEFAULT now()-interval '30 days')
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"counts":{"staleActiveAppointments":99,"deadActiveAppointments":99,"cancelledOutcomeActiveAppointments":99,"deadLetterQueue":2},"samples":{"appointments":[{"id":"unrelated"}],"lifecycle":[{"id":"keep"}]}}'::jsonb $$;
INSERT INTO leads VALUES ('manual','active','opportunity'),('mojo','active','opportunity'),('dead','dead','dead');
INSERT INTO crm_mojo_call_events VALUES ('linked','mojo-record','mojo',now(),null,null,null,null);
INSERT INTO crm_mojo_call_events SELECT 'held-'||n,'held-'||n,'mojo',now()-interval '90 days','evidence_pending',null,null,null FROM generate_series(1,6) n;
INSERT INTO mojo_call_queue VALUES ('held-1',now()-interval '90 days','waiting_evidence');
INSERT INTO appointments VALUES
 ('manual-old','manual',now()-interval '2 days','scheduled','manual',null),
 ('manual-on-mojo-lead','mojo',now()-interval '2 days','scheduled','manual',null),
 ('mojo-old','dead',now()-interval '2 days','confirmed','mojo_sync',null),
 ('canonical-linked','mojo',now()-interval '2 days','scheduled','ai_extraction','mojo-record'),
 ('wrong-lead-link','manual',now()-interval '2 days','scheduled','manual','mojo-record'),
 ('booking-id','manual',now()-interval '2 days','scheduled','calendar_sync','booking-uuid'),
 ('current-mojo','mojo',now(),'scheduled','mojo_sync',null),
 ('terminal-mojo','mojo',now()-interval '2 days','completed','mojo_sync',null);
INSERT INTO lead_activities VALUES
 ('{"appointment_id":"canonical-linked","outcome":"cancelled"}',now(),'appointment_outcome',null),
 ('{"appointment_id":"manual-old","outcome":"cancelled"}',now(),'appointment_outcome',null);
CREATE TABLE before_records AS SELECT jsonb_agg(a ORDER BY a.id) AS value FROM appointments a;
SQL
# Apply twice to prove replacing the wrapper is repeatable and data-preserving.
"${PSQL[@]}" -f supabase/migrations/20261109120000_mojo_appointment_reconciliation_provenance.sql >/dev/null
"${PSQL[@]}" -f supabase/migrations/20261109120000_mojo_appointment_reconciliation_provenance.sql >/dev/null
"${PSQL[@]}" <<'SQL'
SET ROLE service_role;
DO $$ DECLARE report jsonb; BEGIN
 report := crm_mojo_reconciliation_snapshot_v1();
 IF report#>>'{counts,staleActiveAppointments}' <> '2' THEN RAISE EXCEPTION 'wrong stale scope: %',report; END IF;
 IF report#>>'{counts,deadActiveAppointments}' <> '1' THEN RAISE EXCEPTION 'lost dead Mojo appointment'; END IF;
 IF report#>>'{counts,cancelledOutcomeActiveAppointments}' <> '1' THEN RAISE EXCEPTION 'lost cancelled Mojo appointment'; END IF;
 IF jsonb_array_length(report#>'{samples,appointments}') <> 2 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(report#>'{samples,appointments}') a WHERE a->>'id' NOT IN ('mojo-old','canonical-linked')
 ) THEN RAISE EXCEPTION 'sample does not match scoped count'; END IF;
 IF report#>>'{counts,evidencePendingAllAges}' <> '6' OR jsonb_array_length(report#>'{samples,evidencePendingAllAges}') <> 6
 THEN RAISE EXCEPTION 'six evidence holds lost or duplicated'; END IF;
 IF report#>>'{counts,deadLetterQueue}' <> '2' OR report#>>'{samples,lifecycle,0,id}' <> 'keep'
 THEN RAISE EXCEPTION 'unrelated base reconciliation changed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(a ORDER BY a.id) FROM appointments a) IS DISTINCT FROM (SELECT value FROM before_records)
 THEN RAISE EXCEPTION 'appointment mutated'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM crm_mojo_reconciliation_snapshot_v1(); RAISE EXCEPTION 'anon allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: manual/calendar exclusions, canonical same-lead link, genuine Mojo stale/dead/cancelled checks, six holds, samples, no mutations, repeatable migration and service-only access' AS result;
SQL
