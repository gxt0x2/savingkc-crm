#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PG_BIN:-}" ]]; then
  if [[ -x /opt/homebrew/opt/postgresql@17/bin/psql ]]; then
    PG_BIN=/opt/homebrew/opt/postgresql@17/bin
  else
    PG_BIN="$(pg_config --bindir)"
  fi
fi

REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-mojo-named-shell.XXXXXX)"
PG_PORT="$((58200 + $$ % 300))"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_DIR"
}
trap cleanup EXIT

mkdir -p "$REHEARSAL_DIR/socket"
"$PG_BIN/initdb" -D "$REHEARSAL_DIR/data" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -o "-F -p $PG_PORT -k $REHEARSAL_DIR/socket -h ''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" -f "$ROOT/tests/mojo-named-callback-shell/schema.sql" >/dev/null

sed -n '/CREATE OR REPLACE FUNCTION public.ingest_crm_mojo_call_v1/,/^\$\$;/p' \
  "$ROOT/supabase/migrations/20261011120000_mojo_field_ownership_v1.sql" \
  | sed 's/ingest_crm_mojo_call_v1/ingest_crm_mojo_call_core_v1/g' \
  > "$REHEARSAL_DIR/core.sql"
"${PSQL[@]}" -f "$REHEARSAL_DIR/core.sql" >/dev/null
"${PSQL[@]}" -c "REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_core_v1(jsonb,text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;" >/dev/null

"${PSQL[@]}" -f "$ROOT/tests/mojo-named-callback-shell/baseline.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/mojo-named-callback-shell/before.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261222140002_mojo_named_callback_identity_shell.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261222140002_mojo_named_callback_identity_shell.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/tests/mojo-named-callback-shell/after.sql"
