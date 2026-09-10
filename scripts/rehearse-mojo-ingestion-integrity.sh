#!/usr/bin/env bash
set -euo pipefail
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-mojo-integrity.XXXXXX)"
PG_PORT="$((58000 + $$ % 300))"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
CREATE TABLE public.crm_mojo_call_events (id text, record_id text, call_at timestamptz,
  qualification_status text, follow_up_at timestamptz, lead_id text);
CREATE TABLE public.mojo_call_queue (id text, record_id text, created_at timestamptz, status text);
CREATE FUNCTION public.crm_mojo_reconciliation_snapshot_v1(p_since timestamptz DEFAULT now() - interval '30 days')
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"counts":{"deadLetterQueue":2},"samples":{}}'::jsonb $$;
SQL
"${PSQL[@]}" -f supabase/migrations/20261102120000_mojo_ingestion_integrity.sql >/dev/null
"${PSQL[@]}" <<'SQL'
INSERT INTO crm_mojo_call_events VALUES ('a','old-held',now()-interval '90 days','evidence_pending',null,null),
 ('b','callback',now()-interval '30 days','ineligible',now()+interval '1 day',null);
INSERT INTO mojo_call_queue VALUES ('a','old-held',now()-interval '90 days','waiting_evidence'),
 ('b','queue-held',now()-interval '40 days','waiting_evidence'), ('c','stuck',now()-interval '2 days','pending');
INSERT INTO mojo_source_batches(id,runtime_version,payload,created_at) VALUES (repeat('a',64),'test','{}',now()-interval '2 hours');
DO $$ DECLARE report jsonb; BEGIN
  report := crm_mojo_reconciliation_snapshot_v1();
  IF report#>>'{counts,evidencePendingAllAges}' <> '2' THEN RAISE EXCEPTION 'held evidence disappeared or duplicated: %',report; END IF;
  IF report#>>'{counts,sourceBatchesUnaccepted}' <> '1' THEN RAISE EXCEPTION 'source receipt gap hidden'; END IF;
  IF report#>>'{counts,queueOverdue}' <> '1' THEN RAISE EXCEPTION 'queue backlog hidden'; END IF;
  IF report#>>'{counts,unlinkedFutureFollowups}' <> '1' THEN RAISE EXCEPTION 'unlinked callback hidden'; END IF;
  IF report#>>'{counts,deadLetterQueue}' <> '2' THEN RAISE EXCEPTION 'existing reconciliation lost'; END IF;
END $$;
SET ROLE service_role;
INSERT INTO mojo_source_batches(id,runtime_version,payload) VALUES (repeat('b',64),'test','{"activities":[]}') ON CONFLICT (id) DO NOTHING;
INSERT INTO mojo_source_batches(id,runtime_version,payload) VALUES (repeat('b',64),'test','{"activities":[1]}') ON CONFLICT (id) DO NOTHING;
UPDATE mojo_source_batches SET accepted_at=now(),record_ids='["test"]' WHERE id=repeat('b',64);
DO $$ BEGIN
  IF (SELECT payload FROM mojo_source_batches WHERE id=repeat('b',64)) <> '{"activities":[]}'::jsonb THEN RAISE EXCEPTION 'source overwritten'; END IF;
  BEGIN
    UPDATE mojo_source_batches SET payload='{}' WHERE id=repeat('b',64);
    RAISE EXCEPTION 'source mutation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.mojo_source_batches; RAISE EXCEPTION 'anon source read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.crm_mojo_reconciliation_snapshot_v1(); RAISE EXCEPTION 'anon health read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Mojo source archive, immutable evidence, all-age health, and access checks passed' AS result;
SQL
