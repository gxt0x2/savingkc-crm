#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-dead-leads.XXXXXX)"
PG_PORT="$((58600 + $$ % 300))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
MIGRATION="$(pwd)/supabase/migrations/20261101120000_prospecting_dead_lead_suppression.sql"
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
CREATE TABLE public.prospects (id uuid PRIMARY KEY, lead_id uuid REFERENCES public.leads);
CREATE TABLE public.prospecting_campaigns (id uuid PRIMARY KEY, kind text NOT NULL);
CREATE TABLE public.prospecting_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text UNIQUE,
  campaign_id uuid REFERENCES public.prospecting_campaigns, subject_kind text,
  lead_id uuid REFERENCES public.leads, prospect_id uuid REFERENCES public.prospects,
  status text DEFAULT 'active', suppression_reason text,
  next_action_at timestamptz, updated_at timestamptz DEFAULT now(),
  dialer_session_id uuid, completed_at timestamptz
);
CREATE TABLE public.prospecting_campaign_events (
  campaign_id uuid REFERENCES public.prospecting_campaigns,
  member_id uuid REFERENCES public.prospecting_campaign_members,
  event_type text, actor text, metadata jsonb
);
INSERT INTO public.leads VALUES
 ('00000000-0000-4000-8000-000000000001', 'dead', 'dead'),
 ('00000000-0000-4000-8000-000000000002', 'new', 'lead');
INSERT INTO public.prospects VALUES
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000013', NULL);
INSERT INTO public.prospecting_campaigns VALUES
 ('00000000-0000-4000-8000-000000000021', 'dialer'),
 ('00000000-0000-4000-8000-000000000022', 'sms');
INSERT INTO public.prospecting_campaign_members(label,campaign_id,subject_kind,lead_id,status,suppression_reason,dialer_session_id,completed_at)
SELECT label, '00000000-0000-4000-8000-000000000021', 'lead', '00000000-0000-4000-8000-000000000001', status, reason, session_id::uuid, completed_at::timestamptz
FROM (VALUES
 ('dead-direct','active',NULL,NULL,NULL),
 ('dead-reserved','active',NULL,'00000000-0000-4000-8000-000000000099',NULL),
 ('completed','completed',NULL,NULL,'2026-09-01T12:00:00Z'),
 ('removed','removed',NULL,NULL,NULL),
 ('dnc','suppressed','do_not_contact',NULL,NULL)
) AS fixture(label,status,reason,session_id,completed_at);
INSERT INTO public.prospecting_campaign_members(label,campaign_id,subject_kind,prospect_id)
VALUES ('dead-source','00000000-0000-4000-8000-000000000021','prospect','00000000-0000-4000-8000-000000000011'),
 ('good-source','00000000-0000-4000-8000-000000000021','prospect','00000000-0000-4000-8000-000000000012'),
 ('unlinked-source','00000000-0000-4000-8000-000000000021','prospect','00000000-0000-4000-8000-000000000013');
INSERT INTO public.prospecting_campaign_members(label,campaign_id,subject_kind,lead_id)
VALUES ('good-direct','00000000-0000-4000-8000-000000000021','lead','00000000-0000-4000-8000-000000000002'),
 ('sms','00000000-0000-4000-8000-000000000022','lead','00000000-0000-4000-8000-000000000001');
SQL

"${PSQL[@]}" -f "$MIGRATION"
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.prospecting_campaign_members WHERE suppression_reason='dead_lead') <> 3 THEN RAISE EXCEPTION 'backfill missed direct, source, or reserved member'; END IF;
 IF (SELECT dialer_session_id FROM public.prospecting_campaign_members WHERE label='dead-reserved') IS DISTINCT FROM '00000000-0000-4000-8000-000000000099'::uuid THEN RAISE EXCEPTION 'reservation was altered'; END IF;
 IF (SELECT status FROM public.prospecting_campaign_members WHERE label='sms') <> 'active' THEN RAISE EXCEPTION 'SMS policy changed'; END IF;
 IF (SELECT status FROM public.prospecting_campaign_members WHERE label='completed') <> 'completed' OR (SELECT completed_at FROM public.prospecting_campaign_members WHERE label='completed') <> '2026-09-01T12:00:00Z'::timestamptz THEN RAISE EXCEPTION 'completed history changed'; END IF;
 IF (SELECT status FROM public.prospecting_campaign_members WHERE label='removed') <> 'removed' THEN RAISE EXCEPTION 'removed member changed'; END IF;
 IF (SELECT suppression_reason FROM public.prospecting_campaign_members WHERE label='dnc') <> 'do_not_contact' THEN RAISE EXCEPTION 'DNC suppression changed'; END IF;
 IF (SELECT count(*) FROM public.prospecting_campaign_events) <> 3 THEN RAISE EXCEPTION 'backfill audit missing'; END IF;
END $$;

INSERT INTO public.prospecting_campaign_members(label,campaign_id,subject_kind,lead_id)
VALUES ('new-dead','00000000-0000-4000-8000-000000000021','lead','00000000-0000-4000-8000-000000000001');
UPDATE public.prospecting_campaign_members SET status='active',suppression_reason=NULL WHERE label='dead-direct';
UPDATE public.leads SET classification='dead' WHERE id='00000000-0000-4000-8000-000000000002';
UPDATE public.prospects SET lead_id='00000000-0000-4000-8000-000000000001' WHERE id='00000000-0000-4000-8000-000000000013';
UPDATE public.leads SET station='new',classification='lead' WHERE id='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.prospecting_campaign_members WHERE label IN ('new-dead','dead-direct','good-direct','good-source','unlinked-source') AND (status<>'suppressed' OR suppression_reason<>'dead_lead')) THEN RAISE EXCEPTION 'enrollment, rerun, lifecycle, linkage or one-way suppression failed'; END IF;
 IF (SELECT count(*) FROM public.prospecting_campaign_events) <> 7 THEN RAISE EXCEPTION 'audit duplicated or missing'; END IF;
 IF has_function_privilege('anon','public.prospecting_member_dead_lead_v1(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anonymous helper access'; END IF;
 IF NOT has_function_privilege('service_role','public.prospecting_member_dead_lead_v1(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'missing service helper access'; END IF;
END $$;
SQL

# A second application must neither reopen records nor duplicate suppression events.
"${PSQL[@]}" -f "$MIGRATION"
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.prospecting_campaign_events) <> 7 THEN RAISE EXCEPTION 'migration replay duplicated audit'; END IF;
END $$;
SELECT 'PASS: dead-lead backfill, enrollment, rerun, lifecycle/link updates, history preservation, permissions, and replay' AS result;
SQL
