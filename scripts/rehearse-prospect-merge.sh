#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(dirname "$(find /usr/lib/postgresql -name initdb -print -quit)")"
  fi
fi

REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-prospect-merge.XXXXXX)"
PG_PORT="$((58600 + $$ % 300))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
"$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X \
  -v migration="$ROOT/supabase/migrations/20261216120000_sanctioned_prospect_merge.sql" \
  -f "$ROOT/tests/prospect-merge-db.sql"
echo "prospect merge rehearsal passed"
