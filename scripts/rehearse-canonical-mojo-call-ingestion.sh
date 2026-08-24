#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-canonical-mojo.XXXXXX)"
PG_PORT="$((57400 + $$ % 300))"
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

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  property_address text,
  city text,
  state text,
  zip text,
  source text,
  station text DEFAULT 'new',
  priority text DEFAULT 'normal',
  assigned_agent text,
  mojo_record_id text,
  call_result text,
  call_duration_seconds integer,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  description text,
  agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL
);
CREATE TABLE public.prospect_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  phone text
);
CREATE TABLE public.agent_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  date date NOT NULL,
  calls_made integer DEFAULT 0,
  meaningful_conversations integer DEFAULT 0,
  dispositions_logged integer DEFAULT 0,
  followups_completed integer DEFAULT 0,
  followups_missed integer DEFAULT 0,
  leads_advanced integer DEFAULT 0,
  leads_stagnant integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, date)
);
CREATE TABLE public.mojo_call_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer DEFAULT 0,
  last_error text,
  lead_id uuid,
  manifest_id uuid,
  opportunity_score integer,
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.normalize_conversation_phone(raw_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH normalized AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 THEN '+1' || digits
    WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
    ELSE NULL
  END FROM normalized;
$$;
CREATE INDEX idx_leads_conversation_phone
  ON public.leads(public.normalize_conversation_phone(phone))
  WHERE public.normalize_conversation_phone(phone) IS NOT NULL;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261001120000_canonical_mojo_call_ingestion.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261001120000_canonical_mojo_call_ingestion.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
INSERT INTO public.leads(id, full_name, phone, station, priority)
VALUES ('10000000-0000-4000-8000-000000000001', 'Existing Seller', '+19135550123', 'new', 'normal');
INSERT INTO public.prospects(id, lead_id)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.prospect_phones(prospect_id, phone)
VALUES ('20000000-0000-4000-8000-000000000001', '+19135550124');

INSERT INTO public.mojo_call_queue(record_id, payload) VALUES
  ('queue-a', '{"record_id":"queue-a"}'::jsonb),
  ('queue-b', '{"record_id":"queue-b"}'::jsonb);

DO $$
DECLARE
  claimed record;
  first_claim_record text;
  first jsonb;
  replay jsonb;
  older jsonb;
  heir_call jsonb;
  created jsonb;
  unresolved jsonb;
BEGIN
  SELECT * INTO claimed FROM public.claim_mojo_call_queue_v1(1);
  first_claim_record := claimed.record_id;
  IF claimed.record_id NOT IN ('queue-a', 'queue-b') OR claimed.attempts <> 1 THEN
    RAISE EXCEPTION 'queue claim was not bounded and atomic';
  END IF;
  IF public.finish_mojo_call_queue_v1(claimed.id, true, NULL, NULL, NULL) <> 'completed' THEN
    RAISE EXCEPTION 'queue completion failed';
  END IF;
  SELECT * INTO claimed FROM public.claim_mojo_call_queue_v1(1);
  IF claimed.record_id = first_claim_record OR claimed.record_id NOT IN ('queue-a', 'queue-b') THEN
    RAISE EXCEPTION 'second queue claim was incorrect';
  END IF;
  IF public.finish_mojo_call_queue_v1(claimed.id, false, NULL, NULL, 'temporary') <> 'pending' THEN
    RAISE EXCEPTION 'failed queue claim was not released for retry';
  END IF;

  first := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-new","contact_name":"Existing Seller","phone_number":"(913) 555-0123","property_address":"123 Main","city":"Kansas City","state":"MO","zip":"64111","call_duration":120,"disposition":"Interested","agent_name":"Casey","notes":"Seller wants to discuss an offer"}'::jsonb,
    'meaningful_conversation', '2026-08-24T12:00:00Z', NULL
  );
  replay := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-new","contact_name":"Changed Name","phone_number":"9135550123","call_duration":9,"disposition":"No answer","agent_name":"Casey"}'::jsonb,
    'no_answer', '2026-08-24T12:00:00Z', NULL
  );
  IF first->>'eventId' IS DISTINCT FROM replay->>'eventId'
     OR first->>'activityId' IS DISTINCT FROM replay->>'activityId'
     OR (replay->>'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'exact provider replay duplicated canonical evidence';
  END IF;
  IF (SELECT count(*) FROM public.crm_mojo_call_events WHERE record_id = 'call-new') <> 1
     OR (SELECT count(*) FROM public.lead_activities WHERE metadata->>'record_id' = 'call-new') <> 1 THEN
    RAISE EXCEPTION 'provider replay created duplicates';
  END IF;

  older := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-old","contact_name":"Existing Seller","phone_number":"9135550123","call_duration":10,"disposition":"No answer","agent_name":"Casey"}'::jsonb,
    'no_answer', '2026-08-23T12:00:00Z', NULL
  );
  IF (older->>'latestForLead')::boolean IS DISTINCT FROM false
     OR (SELECT call_result FROM public.leads WHERE id = '10000000-0000-4000-8000-000000000001') <> 'Interested' THEN
    RAISE EXCEPTION 'older import overwrote newer provider facts';
  END IF;

  heir_call := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-heir","contact_name":"Associated Heir","phone_number":"9135550124","call_duration":55,"disposition":"Callback requested","agent_name":"Casey"}'::jsonb,
    'callback_scheduled', '2026-08-24T12:30:00Z', '2026-08-25T15:00:00Z'
  );
  IF heir_call->>'leadId' <> '10000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'associated heir phone did not resolve to the canonical lead';
  END IF;

  created := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-created","contact_name":"New Seller","phone_number":"8165550101","property_address":"456 Oak","call_duration":80,"disposition":"Appointment Set","agent_name":"Casey"}'::jsonb,
    'appointment_set', '2026-08-24T13:00:00Z', '2026-08-26T15:00:00Z'
  );
  IF created->>'leadId' IS NULL
     OR (SELECT source FROM public.leads WHERE id = (created->>'leadId')::uuid) <> 'mojo_call' THEN
    RAISE EXCEPTION 'meaningful unknown caller did not create canonical lead';
  END IF;

  unresolved := public.ingest_crm_mojo_call_v1(
    '{"record_id":"call-unknown","contact_name":"Unknown","phone_number":"8165550199","call_duration":0,"disposition":"No answer","agent_name":"Casey"}'::jsonb,
    'no_answer', '2026-08-24T14:00:00Z', NULL
  );
  IF unresolved->>'leadId' IS NOT NULL OR unresolved->>'unresolvedReason' <> 'unknown_contact' THEN
    RAISE EXCEPTION 'nonmeaningful unknown caller was promoted into CRM';
  END IF;

  IF (SELECT calls_made FROM public.agent_daily_stats WHERE agent_id = 'casey' AND date = '2026-08-24') <> 4
     OR (SELECT meaningful_conversations FROM public.agent_daily_stats WHERE agent_id = 'casey' AND date = '2026-08-24') <> 3
     OR (SELECT dispositions_logged FROM public.agent_daily_stats WHERE agent_id = 'casey' AND date = '2026-08-24') <> 4
     OR (SELECT calls_made FROM public.agent_daily_stats WHERE agent_id = 'casey' AND date = '2026-08-23') <> 1 THEN
    RAISE EXCEPTION 'factual Mojo reporting projection was inaccurate or replayed';
  END IF;

  IF has_table_privilege('authenticated', 'public.crm_mojo_call_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mojo_call_queue', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles retained Mojo evidence access';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.crm_mojo_call_events', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'service role lost Mojo evidence access';
  END IF;
  IF has_function_privilege('authenticated', 'public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser role can execute Mojo ingestion';
  END IF;
END $$;
SQL

echo "Canonical Mojo call ingestion rehearsal passed"
