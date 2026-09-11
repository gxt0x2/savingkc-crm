#!/usr/bin/env bash
set -euo pipefail
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-mojo-recovery.XXXXXX)"
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
SQL
"${PSQL[@]}" -f supabase/migrations/20261103140000_mojo_automatic_recovery.sql >/dev/null
"${PSQL[@]}" <<'SQL'
SET ROLE service_role;
INSERT INTO mojo_recovery_runs(id,runtime_digest) VALUES ('11111111-1111-4111-8111-111111111111','verified');
INSERT INTO mojo_recovery_incidents(failure_key,failure_message) VALUES ('session','Session renewal failed');
DO $$ DECLARE changed int; BEGIN
  BEGIN
    INSERT INTO mojo_recovery_incidents(failure_key,failure_message) VALUES ('intake','Other concurrent producer');
    RAISE EXCEPTION 'Duplicate open episode allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE mojo_recovery_incidents SET alert_claimed_at=now() WHERE status='open' AND alert_claimed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'First escalation not claimed'; END IF;
  UPDATE mojo_recovery_incidents SET alert_claimed_at=now() WHERE status='open' AND alert_claimed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Duplicate escalation claimed'; END IF;
  UPDATE mojo_recovery_runs SET status='recovered',attempt_count=1 WHERE id='11111111-1111-4111-8111-111111111111' AND status='running';
  UPDATE mojo_recovery_runs SET status='exhausted',attempt_count=3 WHERE id='11111111-1111-4111-8111-111111111111' AND status='running';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'Completed receipt changed'; END IF;
  UPDATE mojo_recovery_incidents SET status='resolved',resolved_at=now() WHERE status='open';
  INSERT INTO mojo_recovery_incidents(failure_key,failure_message) VALUES ('session','Separate new outage');
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM mojo_recovery_runs; RAISE EXCEPTION 'Anonymous receipts readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO mojo_recovery_incidents(failure_key,failure_message) VALUES ('fake','fake'); RAISE EXCEPTION 'Anonymous incident writable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM * FROM mojo_recovery_incidents; RAISE EXCEPTION 'Nonadmin incident readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'Mojo recovery receipts, episode uniqueness, escalation claim, completion CAS and access controls passed' AS result;
SQL
