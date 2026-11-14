#!/usr/bin/env bash
# Applies the dialer suppression migrations on stub tables and asserts the SQL
# function, not the TypeScript twin. Does not touch mojo_call_queue or Atlas.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-dialer-suppression.XXXXXX)"
PG_PORT="$((56000 + $$ % 500))"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_DIR"
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

CREATE FUNCTION public.normalize_conversation_phone(raw_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH normalized AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 THEN '+1' || digits
    WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE FUNCTION public.prospecting_phone_key_v1(raw_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH digits AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g') AS value
  )
  SELECT CASE
    WHEN length(value) >= 10 THEN right(value, 10)
    ELSE nullif(value, '')
  END
  FROM digits;
$$;

CREATE TABLE public.prospects (
  id uuid PRIMARY KEY,
  lead_id uuid,
  county text,
  situs_street text,
  situs_address text,
  situs_zip text,
  parcel_id text,
  owner_1 text,
  owner_1_last text,
  owner_1_type text
);
CREATE TABLE public.prospect_phones (
  id uuid PRIMARY KEY,
  prospect_id uuid,
  phone text,
  last_disposition text,
  phone_connected text,
  voice_hold boolean DEFAULT false,
  voice_hold_reason text,
  voice_hold_at timestamptz,
  voice_hold_by text,
  relationship text,
  attempted boolean,
  last_attempt_at timestamptz,
  last_attempt_by text
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  phone text,
  call_result text,
  dead_reason text
);
CREATE TABLE public.sms_opt_outs (phone text, is_opted_out boolean);
CREATE TABLE public.crm_contact_methods (
  method_type text,
  normalized_value text,
  sms_consent_status text,
  deliverability_status text
);
CREATE TABLE public.crm_mojo_call_events (
  normalized_phone text,
  outcome text,
  disposition_raw text,
  provider_contact_id text
);
CREATE TABLE public.crm_mojo_calls (phone_last4 text, result_label text);
CREATE TABLE public.system_config (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz
);
CREATE TABLE public.source_lists (
  id uuid PRIMARY KEY,
  pull_date date,
  source_file_name text
);
CREATE TABLE public.source_list_rows (
  id uuid PRIMARY KEY,
  source_list_id uuid,
  list_type text,
  county text,
  state text,
  violation_kind text,
  parcel_id text,
  case_id text,
  address text,
  owner_names text,
  amount_owed numeric,
  property_id uuid,
  prospect_id uuid,
  status text,
  phones text[]
);
CREATE TABLE public.source_list_export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text,
  list_type text,
  county text,
  state text,
  violation_kind text,
  source_list_id uuid,
  phone_count integer
);
CREATE TABLE public.source_list_export_batch_phones (
  export_batch_id uuid,
  source_list_row_id uuid,
  phone_e164 text
);

CREATE VIEW public.source_list_dialer_phone_review AS
SELECT
  NULL::uuid AS source_list_row_id,
  NULL::uuid AS source_list_id,
  NULL::text AS list_type,
  NULL::text AS county,
  NULL::text AS state,
  NULL::text AS violation_kind,
  NULL::text AS parcel_id,
  NULL::text AS case_id,
  NULL::text AS address,
  NULL::text AS owner_names,
  NULL::numeric AS amount_owed,
  NULL::uuid AS property_id,
  NULL::uuid AS prospect_id,
  NULL::text AS row_status,
  NULL::text AS phone_value,
  NULL::text AS phone_e164,
  NULL::text AS phone_origin,
  NULL::date AS pull_date,
  NULL::text AS source_file_name,
  NULL::text AS block_reason
WHERE false;
CREATE VIEW public.source_list_dialer_export AS
SELECT
  source_list_row_id, source_list_id, list_type, county, state, violation_kind,
  parcel_id, case_id, address, owner_names, amount_owed, property_id, prospect_id,
  row_status, phone_e164, phone_origin, pull_date, source_file_name
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL;
CREATE VIEW public.source_list_dialer_suppressed AS
SELECT * FROM public.source_list_dialer_phone_review WHERE block_reason IS NOT NULL;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261202140000_dialer_export_suppression.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261202150000_dialer_export_associate_property_dnc.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261202160000_dialer_export_mojo_raw_and_rehearsal.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261202160000_dialer_export_mojo_raw_and_rehearsal.sql" >/dev/null

"${PSQL[@]}" >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
SQL

"${PSQL[@]}" <<'SQL'
SET ROLE service_role;

INSERT INTO public.source_lists VALUES
  ('10000000-0000-4000-8000-000000000001', DATE '2026-11-14', 'rehearsal.csv');

INSERT INTO public.prospects (id, lead_id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
  ('20000000-0000-4000-8000-000000000001', NULL, 'jackson', '1 Clear', 'P-CLEAR', 'Clear', 'Individual'),
  ('20000000-0000-4000-8000-000000000002', NULL, 'jackson', '2 Fax', 'P-FAX', 'Fax', 'Individual'),
  ('20000000-0000-4000-8000-000000000003', NULL, 'jackson', '3 Number', 'P-NUM', 'Number', 'Individual'),
  ('20000000-0000-4000-8000-000000000010', NULL, 'jackson', '10 Contact', 'P-CONTACT', 'Contact', 'Individual'),
  ('20000000-0000-4000-8000-000000000020', NULL, 'jackson', '20 Refused', 'P-REFUSED', 'Refused', 'Individual'),
  ('20000000-0000-4000-8000-000000000030', NULL, 'jackson', '30 Dead', 'P-DEAD', 'Dead', 'Individual'),
  ('20000000-0000-4000-8000-000000000040', NULL, 'jackson', '40 Number Only', 'P-ONLY', 'Only', 'Individual'),
  ('20000000-0000-4000-8000-000000000050', NULL, 'jackson', '50 Hold', 'P-HOLD', 'Hold', 'Individual'),
  ('20000000-0000-4000-8000-000000000051', NULL, 'jackson', '51 Copy', 'P-HOLD', 'Copy', 'Individual'),
  ('20000000-0000-4000-8000-000000000052', NULL, 'jackson', '52 Away', 'P-AWAY', 'Away', 'Individual'),
  ('20000000-0000-4000-8000-000000000060', NULL, 'jackson', '60 Associate', 'P-ASSOC', 'Assoc', 'Individual'),
  ('20000000-0000-4000-8000-000000000070', NULL, 'jackson', '70 Owner', 'P-PROP', 'Owner', 'Individual'),
  ('20000000-0000-4000-8000-000000000071', NULL, 'jackson', '71 Relative', 'P-PROP', 'Relative', 'Individual'),
  ('20000000-0000-4000-8000-000000000080', NULL, 'jackson', '80 Stamp', 'P-STAMP', 'Stamp', 'Individual'),
  ('20000000-0000-4000-8000-000000000090', NULL, 'jackson', '90 Last4', 'P-LAST4', 'Last', 'Individual'),
  ('20000000-0000-4000-8000-000000000091', NULL, 'jackson', '91 Answer', 'P-ANSWER', 'Answer', 'Individual'),
  ('20000000-0000-4000-8000-0000000000a1', NULL, 'jackson', '9 Elm', 'P-H1', 'Elm', 'Individual'),
  ('20000000-0000-4000-8000-0000000000a2', NULL, 'jackson', '9 Elm', 'P-H2', 'Elm', 'Individual');

INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, phone_connected, voice_hold, voice_hold_reason, relationship) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '+18165551001', NULL, 'dataskip_dnc', false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '+18165551002', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '+18165551003', NULL, NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000010', '+18165551010', NULL, NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000010', '+18165551011', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000020', '+18165551020', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000020', '+18165551021', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000030', '20000000-0000-4000-8000-000000000030', '+18165551030', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000030', '+18165551031', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000040', '20000000-0000-4000-8000-000000000040', '+18165551040', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000040', '+18165551041', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000050', '20000000-0000-4000-8000-000000000050', '+18165551050', NULL, NULL, true, 'mojo_dnc_contact_fanout', 'owner'),
  ('30000000-0000-4000-8000-000000000051', '20000000-0000-4000-8000-000000000050', '+18165551051', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000052', '20000000-0000-4000-8000-000000000051', '+18165551050', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000053', '20000000-0000-4000-8000-000000000052', '+18165551050', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000060', '20000000-0000-4000-8000-000000000060', '+18165551210', NULL, 'dataskip_dnc', false, NULL, 'associate'),
  ('30000000-0000-4000-8000-000000000070', '20000000-0000-4000-8000-000000000070', '+18165551220', 'dnc', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000071', '20000000-0000-4000-8000-000000000071', '+18165551221', 'no_answer', NULL, false, NULL, 'relative'),
  ('30000000-0000-4000-8000-000000000080', '20000000-0000-4000-8000-000000000080', '+18165551080', 'bad_number', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000081', '20000000-0000-4000-8000-000000000080', '+18165551081', 'dnc_contact', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000082', '20000000-0000-4000-8000-000000000080', '+18165551082', 'dnc', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000090', '20000000-0000-4000-8000-000000000090', '+18165551099', 'no_answer', NULL, false, NULL, 'owner'),
  ('30000000-0000-4000-8000-000000000091', '20000000-0000-4000-8000-000000000091', '+18165551100', NULL, 'dataskip_dnc', false, NULL, 'owner'),
  ('30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', '+18165551201', 'dnc_contact', NULL, false, NULL, 'relative'),
  ('30000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000a2', '+18165551202', 'no_answer', NULL, false, NULL, 'relative');

INSERT INTO public.leads (id, phone, call_result, dead_reason) VALUES
  ('40000000-0000-4000-8000-000000000020', '+18165551020', NULL, 'dnc_refused'),
  ('40000000-0000-4000-8000-000000000030', '+18165551030', 'no_answer', 'dnc'),
  ('40000000-0000-4000-8000-000000000040', '+18165551040', 'DNC Number', 'dnc');

INSERT INTO public.crm_mojo_call_events (normalized_phone, outcome, disposition_raw, provider_contact_id) VALUES
  ('+18165551002', 'other', 'Fax', 'fax-1'),
  ('+18165551003', 'other', 'DNC Number', 'num-1'),
  ('+18165551010', 'other', 'DNC Contact', 'contact-1');

INSERT INTO public.crm_mojo_calls (phone_last4, result_label) VALUES
  ('1099', 'DNC Number'),
  ('1100', 'No Answer');

INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones
)
SELECT
  ('50000000-0000-4000-8000-' || lpad(to_hex(row_number() OVER (ORDER BY phone.id)), 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  'tax_delinquent',
  'jackson',
  'MO',
  prospect.parcel_id,
  prospect.situs_street,
  prospect.owner_1_last,
  prospect.id,
  'ready',
  ARRAY[phone.phone]
FROM public.prospect_phones AS phone
JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
WHERE phone.phone NOT IN ('+18165551080', '+18165551081', '+18165551082');

DO $$
DECLARE
  rec record;
  got text;
  report jsonb;
BEGIN
  IF public.dialer_encode_queue_has_phone_v1('8165551001') THEN
    RAISE EXCEPTION 'missing encode queue blocked a phone';
  END IF;

  IF public.apply_mojo_dial_phone_stamp_v1('+18165551080', 'no_answer', now()) < 1 THEN
    RAISE EXCEPTION 'bad_number stamp did not run';
  END IF;
  IF public.apply_mojo_dial_phone_stamp_v1('+18165551081', 'dnc', now()) < 1 THEN
    RAISE EXCEPTION 'dnc_contact stamp did not run';
  END IF;
  IF public.apply_mojo_dial_phone_stamp_v1('+18165551082', 'dnc_contact', now()) < 1 THEN
    RAISE EXCEPTION 'upgrade stamp did not run';
  END IF;
  IF (SELECT last_disposition FROM public.prospect_phones WHERE phone = '+18165551080') IS DISTINCT FROM 'bad_number' THEN
    RAISE EXCEPTION 'no_answer overwrote bad_number';
  END IF;
  IF (SELECT last_disposition FROM public.prospect_phones WHERE phone = '+18165551081') IS DISTINCT FROM 'dnc_contact' THEN
    RAISE EXCEPTION 'plain dnc overwrote dnc_contact';
  END IF;
  IF (SELECT last_disposition FROM public.prospect_phones WHERE phone = '+18165551082') IS DISTINCT FROM 'dnc_contact' THEN
    RAISE EXCEPTION 'dnc_contact did not upgrade plain dnc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prospect_phones WHERE voice_hold IS FALSE AND phone IN ('+18165551081', '+18165551082')) THEN
    RAISE EXCEPTION 'voice hold was cleared or not set';
  END IF;

  CREATE TEMP TABLE expected(phone text, prospect uuid, reason text) ON COMMIT DROP;
  INSERT INTO expected VALUES
    ('+18165551001', '20000000-0000-4000-8000-000000000001', NULL),
    ('+18165551002', '20000000-0000-4000-8000-000000000002', 'disconnected'),
    ('+18165551003', '20000000-0000-4000-8000-000000000003', 'mojo_dnc'),
    ('+18165551010', '20000000-0000-4000-8000-000000000010', 'mojo_dnc'),
    ('+18165551011', '20000000-0000-4000-8000-000000000010', 'person_fanout'),
    ('+18165551020', '20000000-0000-4000-8000-000000000020', 'lead_dnc'),
    ('+18165551021', '20000000-0000-4000-8000-000000000020', 'person_fanout'),
    ('+18165551030', '20000000-0000-4000-8000-000000000030', 'lead_dnc'),
    ('+18165551031', '20000000-0000-4000-8000-000000000030', 'person_fanout'),
    ('+18165551040', '20000000-0000-4000-8000-000000000040', 'lead_dnc'),
    ('+18165551041', '20000000-0000-4000-8000-000000000040', NULL),
    ('+18165551051', '20000000-0000-4000-8000-000000000050', 'person_fanout'),
    ('+18165551050', '20000000-0000-4000-8000-000000000051', 'person_fanout'),
    ('+18165551050', '20000000-0000-4000-8000-000000000052', 'needs_counsel_review'),
    ('+18165551210', '20000000-0000-4000-8000-000000000060', 'associate_non_family'),
    ('+18165551220', '20000000-0000-4000-8000-000000000070', 'prospect_dnc'),
    ('+18165551221', '20000000-0000-4000-8000-000000000071', 'property_owner_dnc_fanout'),
    ('+18165551099', '20000000-0000-4000-8000-000000000090', 'hold_last4'),
    ('+18165551100', '20000000-0000-4000-8000-000000000091', NULL),
    ('+18165551202', '20000000-0000-4000-8000-0000000000a2', 'household_fanout');

  FOR rec IN SELECT * FROM expected LOOP
    got := public.source_list_phone_block_reason_v1(rec.phone, rec.prospect);
    IF got IS DISTINCT FROM rec.reason THEN
      RAISE EXCEPTION 'block % prospect % expected % got %', rec.phone, rec.prospect, rec.reason, got;
    END IF;
    IF rec.reason IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.source_list_dialer_export
        WHERE phone_e164 = rec.phone AND prospect_id = rec.prospect
      ) THEN
        RAISE EXCEPTION '% was not exported', rec.phone;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.source_list_dialer_export
        WHERE phone_e164 = rec.phone AND prospect_id = rec.prospect
      ) THEN
        RAISE EXCEPTION '% leaked into the export', rec.phone;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.source_list_dialer_suppressed
        WHERE phone_e164 = rec.phone AND prospect_id = rec.prospect AND block_reason = rec.reason
      ) THEN
        RAISE EXCEPTION '% missing from suppressed as %', rec.phone, rec.reason;
      END IF;
    END IF;
  END LOOP;

  report := public.record_source_list_export_batch_v1('rehearsal', NULL, NULL, NULL, NULL, NULL, 1);
  IF report->>'phone_count' IS DISTINCT FROM (
    SELECT count(*)::text FROM public.source_list_dialer_export WHERE phone_e164 IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'export count %', report->>'phone_count';
  END IF;
  IF (SELECT count(*) FROM public.source_list_dialer_export WHERE phone_e164 IN ('+18165551001', '+18165551041', '+18165551100')) < 3 THEN
    RAISE EXCEPTION 'a clear phone was dropped';
  END IF;
  IF (report->'excluded_phones')::text LIKE '%+1%' OR (report->'rows')::text LIKE '%+18165551002%' THEN
    RAISE EXCEPTION 'export leaked a raw blocked phone or an unmasked exclusion';
  END IF;
  IF (report->'excluded_counts'->>'disconnected') IS NULL
    OR (report->'excluded_counts'->>'needs_counsel_review') IS NULL
    OR (report->'excluded_counts'->>'person_fanout') IS NULL THEN
    RAISE EXCEPTION 'excluded counts %', report->'excluded_counts';
  END IF;
  BEGIN
    PERFORM public.record_source_list_export_batch_v1('rehearsal', NULL, NULL, NULL, NULL, NULL, 2);
    RAISE EXCEPTION 'line mode 2 was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%multi_line_suspended%' THEN
        RAISE;
      END IF;
  END;
END $$;
RESET ROLE;
SELECT 'PASS: raw Fax and DNC Number, DNC Contact fan-out, dnc_refused without a prospect link, dead_reason dnc versus DNC Number only, fan-out voice hold, last-4 hold, monotonic stamps, associate and property fan-out, dataskip_dnc export, encode queue no-op' AS result;
SQL
