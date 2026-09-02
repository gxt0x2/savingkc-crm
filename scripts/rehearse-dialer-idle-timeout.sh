#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-dialer-idle.XXXXXX)"
PG_PORT="$((58400 + $$ % 300))"
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
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.dialer_sessions (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  actor_email text NOT NULL,
  agent_name text NOT NULL DEFAULT 'Agent',
  queue_key text NOT NULL DEFAULT 'test',
  saved_queue_id uuid,
  queue_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  queue_size integer NOT NULL DEFAULT 1,
  current_index integer NOT NULL DEFAULT 0,
  current_lead_id uuid,
  current_prospect_id uuid,
  current_subject_kind text,
  current_subject_id uuid,
  current_campaign_member_id uuid,
  caller_id text,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  dials_completed integer NOT NULL DEFAULT 0,
  contacts integer NOT NULL DEFAULT 0,
  skips integer NOT NULL DEFAULT 0,
  outcomes jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  stop_requested_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  state_version integer NOT NULL DEFAULT 1,
  controller_token_hash text,
  controller_label text,
  controller_claimed_at timestamptz,
  controller_heartbeat_at timestamptz,
  controller_lease_expires_at timestamptz,
  controller_generation integer NOT NULL DEFAULT 0,
  controller_operation_id uuid,
  controller_operation_label text,
  controller_operation_expires_at timestamptz
);

CREATE TABLE public.dialer_session_attempts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id),
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ended_at timestamptz,
  duration_seconds integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
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
  disposition text,
  phone text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.dialer_session_queue_items_v2(value jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;

CREATE FUNCTION public.dialer_controller_hash_v1(value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, extensions
AS $$ SELECT encode(extensions.digest(trim(value), 'sha256'), 'hex') $$;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261027124500_dialer_idle_timeout.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261027124500_dialer_idle_timeout.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
DECLARE
  actor_email text := 'casey@savingkc.com';
  controller_token text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  idle_session uuid := '00000000-0000-4000-8000-000000000010';
  heartbeat_session uuid := '00000000-0000-4000-8000-000000000011';
  connected_session uuid := '00000000-0000-4000-8000-000000000012';
  outcome_session uuid := '00000000-0000-4000-8000-000000000013';
  stale_attempt_session uuid := '00000000-0000-4000-8000-000000000014';
  before_interaction timestamptz;
  after_interaction timestamptz;
BEGIN
  INSERT INTO public.dialer_sessions (
    id, status, actor_email, queue_snapshot, current_subject_kind,
    current_subject_id, started_at, updated_at, last_interaction_at, controller_token_hash
  ) VALUES
    (idle_session, 'active', actor_email, '[]', 'lead', idle_session, now() - interval '12 minutes', now() - interval '12 minutes', now() - interval '12 minutes', public.dialer_controller_hash_v1(controller_token)),
    (heartbeat_session, 'active', actor_email, '[]', 'lead', heartbeat_session, now() - interval '4 minutes', now() - interval '4 minutes', now() - interval '4 minutes', public.dialer_controller_hash_v1(controller_token)),
    (connected_session, 'active', actor_email, '[]', 'lead', connected_session, now() - interval '20 minutes', now() - interval '20 minutes', now() - interval '20 minutes', public.dialer_controller_hash_v1(controller_token)),
    (outcome_session, 'active', actor_email, '[]', 'lead', outcome_session, now() - interval '12 minutes', now() - interval '12 minutes', now() - interval '12 minutes', public.dialer_controller_hash_v1(controller_token)),
    (stale_attempt_session, 'active', actor_email, '[]', 'lead', stale_attempt_session, now() - interval '12 minutes', now() - interval '12 minutes', now() - interval '12 minutes', public.dialer_controller_hash_v1(controller_token));

  INSERT INTO public.dialer_session_attempts (id, session_id, status, created_at, updated_at) VALUES
    ('10000000-0000-4000-8000-000000000012', connected_session, 'connected', now() - interval '15 minutes', now() - interval '15 minutes'),
    ('10000000-0000-4000-8000-000000000013', outcome_session, 'awaiting_disposition', now() - interval '11 minutes', now() - interval '11 minutes'),
    ('10000000-0000-4000-8000-000000000014', stale_attempt_session, 'authorized', now() - interval '11 minutes', now() - interval '11 minutes');
  UPDATE public.dialer_sessions
  SET last_interaction_at = CASE id
    WHEN connected_session THEN now() - interval '20 minutes'
    ELSE now() - interval '12 minutes'
  END
  WHERE id IN (connected_session, outcome_session, stale_attempt_session);

  PERFORM public.expire_dialer_session_if_idle_v1(idle_session, actor_email);
  IF (SELECT status FROM public.dialer_sessions WHERE id = idle_session) <> 'stopped'
    OR abs(extract(epoch FROM (
      (SELECT ended_at FROM public.dialer_sessions WHERE id = idle_session)
      - (SELECT started_at FROM public.dialer_sessions WHERE id = idle_session)
    )) - 300) > 1
  THEN RAISE EXCEPTION 'idle session did not stop at the exact five-minute boundary'; END IF;

  SELECT last_interaction_at INTO before_interaction
  FROM public.dialer_sessions WHERE id = heartbeat_session;
  PERFORM public.heartbeat_dialer_session_control_v2(
    heartbeat_session, actor_email, controller_token, false
  );
  SELECT last_interaction_at INTO after_interaction
  FROM public.dialer_sessions WHERE id = heartbeat_session;
  IF after_interaction IS DISTINCT FROM before_interaction THEN
    RAISE EXCEPTION 'passive heartbeat counted as agent activity';
  END IF;

  PERFORM public.heartbeat_dialer_session_control_v2(
    heartbeat_session, actor_email, controller_token, true
  );
  IF (SELECT last_interaction_at FROM public.dialer_sessions WHERE id = heartbeat_session) <= before_interaction THEN
    RAISE EXCEPTION 'real agent activity did not extend the deadline';
  END IF;

  PERFORM public.expire_dialer_session_if_idle_v1(connected_session, actor_email);
  IF (SELECT status FROM public.dialer_sessions WHERE id = connected_session) <> 'active' THEN
    RAISE EXCEPTION 'connected call was incorrectly expired';
  END IF;

  PERFORM public.expire_dialer_session_if_idle_v1(outcome_session, actor_email);
  IF (SELECT status FROM public.dialer_sessions WHERE id = outcome_session) <> 'paused'
    OR (SELECT stop_requested_at FROM public.dialer_sessions WHERE id = outcome_session) IS NULL
    OR (SELECT status FROM public.dialer_session_attempts WHERE session_id = outcome_session) <> 'awaiting_disposition'
  THEN RAISE EXCEPTION 'pending outcome was not preserved under an idle stop request'; END IF;
  PERFORM public.assert_dialer_session_control_v1(outcome_session, actor_email, controller_token);

  PERFORM public.expire_dialer_session_if_idle_v1(stale_attempt_session, actor_email);
  IF (SELECT status FROM public.dialer_sessions WHERE id = stale_attempt_session) <> 'stopped'
    OR (SELECT status FROM public.dialer_session_attempts WHERE session_id = stale_attempt_session) <> 'cancelled'
  THEN RAISE EXCEPTION 'stale pre-call authorization was not cancelled safely'; END IF;

  IF has_function_privilege('anon', 'public.heartbeat_dialer_session_control_v2(uuid,text,text,boolean)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.expire_dialer_session_if_idle_v1(uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.heartbeat_dialer_session_control_v2(uuid,text,text,boolean)', 'EXECUTE')
  THEN RAISE EXCEPTION 'idle timeout function privileges are incorrect'; END IF;
END;
$test$;
SQL

echo "dialer idle-timeout migration rehearsal passed"
