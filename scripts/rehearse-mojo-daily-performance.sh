#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-mojo-performance.XXXXXX)"
PG_PORT="$((57700 + $$ % 300))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
ROOT="$(pwd)"

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
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261013120000_mojo_daily_performance.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261013120000_mojo_daily_performance.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
DECLARE
  metric_day text := current_date::text;
  digest_a text := repeat('a', 64);
  digest_b text := repeat('b', 64);
  fetched_base timestamptz := clock_timestamp() - interval '2 minutes';
  fetched_new timestamptz := clock_timestamp() - interval '1 minute';
  fetched_stale timestamptz := clock_timestamp() - interval '3 minutes';
  first_result jsonb;
  replay_result jsonb;
  newer_result jsonb;
  stale_result jsonb;
BEGIN
  first_result := public.upsert_mojo_agent_daily_performance_v1(jsonb_build_object(
    'agentKey', 'casey', 'metricDate', metric_day, 'providerAgentId', '1',
    'providerTimezone', 'America/Chicago', 'dialingSeconds', 7667.376,
    'inProgressSeconds', 0, 'calls', 304, 'contacts', 8, 'leads', 0,
    'appointments', 0, 'source', 'mojo_kpi_historical_daily_v1',
    'sourceDigest', digest_a, 'sourceFetchedAt', fetched_base
  ));
  IF coalesce((first_result->>'applied')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'first snapshot was not applied';
  END IF;

  replay_result := public.upsert_mojo_agent_daily_performance_v1(jsonb_build_object(
    'agentKey', 'casey', 'metricDate', metric_day, 'providerAgentId', '1',
    'providerTimezone', 'America/Chicago', 'dialingSeconds', 7667.376,
    'inProgressSeconds', 0, 'calls', 304, 'contacts', 8, 'leads', 0,
    'appointments', 0, 'source', 'mojo_kpi_historical_daily_v1',
    'sourceDigest', digest_a, 'sourceFetchedAt', fetched_base
  ));
  IF coalesce((replay_result->>'applied')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'exact replay was not idempotent';
  END IF;

  newer_result := public.upsert_mojo_agent_daily_performance_v1(jsonb_build_object(
    'agentKey', 'casey', 'metricDate', metric_day, 'providerAgentId', '1',
    'providerTimezone', 'America/Chicago', 'dialingSeconds', 8000,
    'inProgressSeconds', 0, 'calls', 320, 'contacts', 9, 'leads', 1,
    'appointments', 0, 'source', 'mojo_kpi_historical_daily_v1',
    'sourceDigest', digest_b, 'sourceFetchedAt', fetched_new
  ));
  IF coalesce((newer_result->>'applied')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'newer snapshot was not applied';
  END IF;

  stale_result := public.upsert_mojo_agent_daily_performance_v1(jsonb_build_object(
    'agentKey', 'casey', 'metricDate', metric_day, 'providerAgentId', '1',
    'providerTimezone', 'America/Chicago', 'dialingSeconds', 1,
    'inProgressSeconds', 0, 'calls', 1, 'contacts', 0, 'leads', 0,
    'appointments', 0, 'source', 'mojo_kpi_historical_daily_v1',
    'sourceDigest', digest_a, 'sourceFetchedAt', fetched_stale
  ));
  IF coalesce((stale_result->>'applied')::boolean, true) IS NOT FALSE
     OR (SELECT calls FROM public.mojo_agent_daily_performance WHERE agent_key = 'casey' AND metric_date = current_date) <> 320
  THEN
    RAISE EXCEPTION 'stale snapshot overwrote newer provider totals';
  END IF;

  BEGIN
    PERFORM public.upsert_mojo_agent_daily_performance_v1(jsonb_build_object(
      'agentKey', 'casey', 'metricDate', metric_day, 'providerAgentId', '1',
      'providerTimezone', 'UTC', 'dialingSeconds', 1, 'inProgressSeconds', 0,
      'calls', 1, 'contacts', 0, 'leads', 0, 'appointments', 0,
      'source', 'mojo_kpi_historical_daily_v1', 'sourceDigest', digest_a,
      'sourceFetchedAt', clock_timestamp()
    ));
    RAISE EXCEPTION 'invalid timezone was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'invalid timezone was accepted' THEN RAISE; END IF;
  END;

  IF has_table_privilege('authenticated', 'public.mojo_agent_daily_performance', 'SELECT')
     OR has_function_privilege('authenticated', 'public.upsert_mojo_agent_daily_performance_v1(jsonb)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.mojo_agent_daily_performance', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.upsert_mojo_agent_daily_performance_v1(jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Mojo performance privileges are incorrect';
  END IF;
END;
$test$;
SQL

"${PSQL[@]}" -Atc "SELECT agent_key || '|' || metric_date || '|' || calls || '|' || contacts FROM public.mojo_agent_daily_performance"
