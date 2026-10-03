#!/usr/bin/env bash
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
SMS_REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-sms-continuity.XXXXXX)"
SMS_PG_PORT="$((59000 + $$ % 600))"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$SMS_REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$SMS_REHEARSAL_DIR"
}
trap cleanup EXIT
mkdir -p "$SMS_REHEARSAL_DIR/socket"
"$PG_BIN/initdb" -D "$SMS_REHEARSAL_DIR/data" --no-locale --encoding=UTF8 -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$SMS_REHEARSAL_DIR/data" -o "-F -p $SMS_PG_PORT -k $SMS_REHEARSAL_DIR/socket -h ''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$SMS_REHEARSAL_DIR/socket" -p "$SMS_PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)
"${PSQL[@]}" >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.leads(id uuid PRIMARY KEY, full_name text, phone text, station text, priority text);
CREATE TABLE public.lead_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid,
  activity_type text, description text, metadata jsonb, created_at timestamptz);
SQL
# Execute the actual existing helpers, rather than a reimplemented normalizer.
python3 - <<'PY' > "$SMS_REHEARSAL_DIR/helpers.sql"
from pathlib import Path
source = Path('supabase/migrations/20260819120000_conversation_read_model.sql').read_text()
start = source.index('CREATE OR REPLACE FUNCTION public.normalize_conversation_phone')
end = source.index('CREATE OR REPLACE FUNCTION public.conversation_is_timeline_activity')
print(source[start:end])
PY
"${PSQL[@]}" -f "$SMS_REHEARSAL_DIR/helpers.sql" >/dev/null
"${PSQL[@]}" -f supabase/migrations/20261003170000_inbound_sms_thread_continuity.sql >/dev/null
"${PSQL[@]}" -f supabase/migrations/20261003170000_inbound_sms_thread_continuity.sql >/dev/null
"${PSQL[@]}" <<'SQL'
INSERT INTO public.leads VALUES
 ('09943d23-e3ea-475e-bdb9-47b5a8ba8096','Voicemail Caller 9716','+19137179716','dead','normal'),
 ('68997f70-04be-4119-bb24-c5e959f4d6b1','Ernest Dodson',U&'\202A(913) 717-9716\202C','contacted','normal'),
 ('10000000-0000-4000-8000-000000000001','Unique formatted',U&'\202A(913) 555-0001\202C','new','normal');
CREATE INDEX idx_leads_conversation_phone ON public.leads(public.normalize_conversation_phone(phone))
 WHERE public.normalize_conversation_phone(phone) IS NOT NULL;
INSERT INTO public.lead_activities(id,lead_id,activity_type,description,metadata,created_at) VALUES
 ('88d0ab17-7f3c-49e4-95cb-8031961b0711','68997f70-04be-4119-bb24-c5e959f4d6b1','sms','Hello',
 '{"direction":"outbound","from":"+18166088588","to":"(913) 717-9716","sent":true,"message_sid":"SMeb8bb73937507a28e6eeea55b775981e"}',
 '2026-10-03T15:56:50Z');
CREATE FUNCTION pg_temp.assert_identity(p_from text, p_to text, p_expected text, p_lead uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual record;
BEGIN
 SELECT * INTO actual FROM public.resolve_inbound_sms_lead_v1(p_from,p_to,'2026-10-03T15:57:26Z');
 IF actual.resolution IS DISTINCT FROM p_expected OR actual.lead_id IS DISTINCT FROM p_lead THEN
  RAISE EXCEPTION 'Identity assertion failed: %, %, expected %/%, actual %',p_from,p_to,p_expected,p_lead,row_to_json(actual);
 END IF;
END $$;
SET ROLE service_role;
SELECT pg_temp.assert_identity('+19137179716','+18166088588','outbound_thread','68997f70-04be-4119-bb24-c5e959f4d6b1');
SELECT pg_temp.assert_identity('+19135550001','+18166088588','normalized_phone','10000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_identity('+19135550099','+18166088588','unknown');
SELECT pg_temp.assert_identity('+442079460123','+18166088588','unsupported');
SELECT pg_temp.assert_identity('54321','+18166088588','unsupported');
SELECT pg_temp.assert_identity('SenderName','+18166088588','unsupported');
SELECT pg_temp.assert_identity('+19137179716','+442079460123','unsupported');
-- A newer outbound to a different business line must not steal this reply.
RESET ROLE;
INSERT INTO public.lead_activities(lead_id,activity_type,description,metadata,created_at) VALUES
 ('09943d23-e3ea-475e-bdb9-47b5a8ba8096','sms','Different business line',
 '{"direction":"sent","from":"+18167277667","to":"+19137179716","message_sid":"SM11111111111111111111111111111111"}',
 '2026-10-03T15:57:00Z');
SET ROLE service_role;
SELECT pg_temp.assert_identity('+19137179716','+18166088588','outbound_thread','68997f70-04be-4119-bb24-c5e959f4d6b1');
SELECT pg_temp.assert_identity('+19137179716','+18167277667','outbound_thread','09943d23-e3ea-475e-bdb9-47b5a8ba8096');
SELECT pg_temp.assert_identity('+19137179716','+18163077835','ambiguous');
RESET ROLE;
-- Preview, internal/team traffic, failed sends, test SIDs and future messages
-- are each newer than Hello and must not establish outbound continuity.
INSERT INTO public.lead_activities(lead_id,activity_type,description,metadata,created_at)
SELECT '09943d23-e3ea-475e-bdb9-47b5a8ba8096','sms','Excluded candidate',
 '{"direction":"outbound","from":"+18166088588","to":"+19137179716","message_sid":"SM22222222222222222222222222222222"}'::jsonb || extra,
 CASE WHEN extra ? 'future_fixture' THEN '2026-10-03T15:58:00Z'::timestamptz ELSE '2026-10-03T15:57:10Z'::timestamptz END
FROM unnest(ARRAY[
 '{"sent":false}'::jsonb, '{"status":"not_sent_preview"}', '{"direction":"outbound_alert"}',
 '{"is_team":true}', '{"is_internal":true}', '{"to_agents":["Ernest"]}', '{"delivery_status":"failed"}',
 '{"status":"undelivered"}', '{"message_sid":"TEST_MESSAGE_SID"}', '{"future_fixture":true}'
]) extra;
SET ROLE service_role;
SELECT pg_temp.assert_identity('+19137179716','+18166088588','outbound_thread','68997f70-04be-4119-bb24-c5e959f4d6b1');
RESET ROLE;
-- The same current timestamp from two contacts is explicit ambiguity.
INSERT INTO public.lead_activities(lead_id,activity_type,description,metadata,created_at) VALUES
 ('09943d23-e3ea-475e-bdb9-47b5a8ba8096','sms','True tie',
 '{"direction":"outbound","from":"+18166088588","to":"+19137179716","sent":true,"message_sid":"SM33333333333333333333333333333333"}',
 '2026-10-03T15:56:50Z');
SET ROLE service_role;
SELECT pg_temp.assert_identity('+19137179716','+18166088588','ambiguous');
RESET ROLE;
DELETE FROM public.lead_activities WHERE description = 'True tie';
-- Physical contact insertion order never decides identity.
CREATE TEMP TABLE reordered AS SELECT * FROM public.leads ORDER BY id DESC;
DELETE FROM public.leads;
INSERT INTO public.leads SELECT * FROM reordered;
CREATE TEMP TABLE source_snapshot AS SELECT
 (SELECT jsonb_agg(l ORDER BY l.id) FROM public.leads l) AS leads,
 (SELECT jsonb_agg(a ORDER BY a.id) FROM public.lead_activities a) AS activities;
SET ROLE service_role;
SELECT pg_temp.assert_identity('+19137179716','+18166088588','outbound_thread','68997f70-04be-4119-bb24-c5e959f4d6b1');
DO $$ BEGIN
 BEGIN PERFORM public.resolve_inbound_sms_lead_v1('','+18166088588',now());
  RAISE EXCEPTION 'missing number accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(l ORDER BY l.id) FROM public.leads l) IS DISTINCT FROM (SELECT leads FROM source_snapshot)
 OR (SELECT jsonb_agg(a ORDER BY a.id) FROM public.lead_activities a) IS DISTINCT FROM (SELECT activities FROM source_snapshot)
 THEN RAISE EXCEPTION 'read-only resolver changed canonical data'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.resolve_inbound_sms_lead_v1('+19137179716','+18166088588',now());
  RAISE EXCEPTION 'anon execute allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.resolve_inbound_sms_lead_v1('+19137179716','+18166088588',now());
  RAISE EXCEPTION 'authenticated execute allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: Unicode duplicate incident, contact order reversal, exact reverse line pair, unique/unknown/ambiguous/tied matches, unsupported international/shortcode/alphanumeric identity, 10 excluded outbound states, service-only access, repeatable migration, no canonical mutations' AS result;
SQL
