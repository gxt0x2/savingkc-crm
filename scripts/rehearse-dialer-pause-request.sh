#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-dialer-pause.XXXXXX)"
PG_PORT="$((58100 + $$ % 300))"
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

CREATE TABLE public.dialer_sessions (
  id uuid PRIMARY KEY,
  actor_email text NOT NULL,
  status text NOT NULL,
  current_lead_id uuid,
  current_prospect_id uuid,
  current_subject_kind text,
  current_subject_id uuid,
  current_campaign_member_id uuid,
  stop_requested_at timestamptz,
  paused_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  state_version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.dialer_session_attempts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id),
  status text NOT NULL
);

CREATE TABLE public.dialer_session_events (
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id),
  lead_id uuid,
  prospect_id uuid,
  subject_kind text,
  subject_id uuid,
  campaign_member_id uuid,
  event_type text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION public.dialer_session_json_v1(p_session public.dialer_sessions)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT to_jsonb(p_session) $$;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261018120000_dialer_pause_request_lifecycle.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261018120000_dialer_pause_request_lifecycle.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
DECLARE
  v_session_id uuid := '00000000-0000-4000-8000-000000000010';
  result jsonb;
BEGIN
  INSERT INTO public.dialer_sessions (id, actor_email, status)
  VALUES (v_session_id, 'casey@savingkc.com', 'active');
  INSERT INTO public.dialer_session_attempts (id, session_id, status)
  VALUES ('00000000-0000-4000-8000-000000000020', v_session_id, 'awaiting_disposition');

  result := public.request_pause_dialer_session_v1(
    v_session_id, 'casey@savingkc.com', 'Agent paused the calling session'
  );

  IF result->>'requiresDisposition' <> 'true'
     OR result->'session'->>'status' <> 'paused'
     OR (SELECT status FROM public.dialer_session_attempts WHERE session_id = v_session_id) <> 'awaiting_disposition'
  THEN
    RAISE EXCEPTION 'pause did not preserve the unfinished outcome';
  END IF;

  result := public.request_pause_dialer_session_v1(
    v_session_id, 'casey@savingkc.com', 'Agent retried pause'
  );
  IF result->'session'->>'status' <> 'paused' THEN
    RAISE EXCEPTION 'pause replay was not idempotent';
  END IF;

  IF has_function_privilege('anon', 'public.request_pause_dialer_session_v1(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.request_pause_dialer_session_v1(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.request_pause_dialer_session_v1(uuid,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'pause function privileges are incorrect';
  END IF;
END;
$test$;
SQL

"${PSQL[@]}" -Atc "SELECT status || '|' || state_version FROM public.dialer_sessions"
