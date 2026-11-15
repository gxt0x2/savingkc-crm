#!/usr/bin/env bash
# Applies the dialer suppression migrations on stub tables and asserts the SQL
# function, not the TypeScript twin. Does not touch mojo_call_queue or Atlas.
set -euo pipefail
# Market checks use America/Chicago. Keep CURRENT_DATE on that clock.
export TZ=America/Chicago
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
  situs_city text,
  situs_state text,
  situs_zip text,
  parcel_id text,
  owner_1 text,
  owner_1_last text,
  owner_1_type text,
  is_skip_traced boolean NOT NULL DEFAULT false
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
  contact_name text,
  verified_source text,
  attempted boolean,
  last_attempt_at timestamptz,
  last_attempt_by text
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  phone text,
  call_result text,
  dead_reason text,
  property_address text,
  zip text,
  dead_at timestamptz,
  updated_at timestamptz,
  parcel_id text
);
CREATE TABLE public.sms_opt_outs (phone text, is_opted_out boolean);
CREATE TABLE public.crm_contact_methods (
  method_type text,
  normalized_value text,
  sms_consent_status text,
  deliverability_status text
);
CREATE TABLE public.crm_mojo_call_events (
  record_id text,
  normalized_phone text,
  outcome text,
  disposition_raw text,
  provider_contact_id text
);
CREATE TABLE public.crm_mojo_calls (
  record_id text,
  phone_last4 text,
  result_label text,
  provider_contact_id text,
  lead_id uuid
);
CREATE TABLE public.system_config (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz
);
CREATE TABLE public.source_lists (
  id uuid PRIMARY KEY,
  pull_date date,
  source_file_name text,
  list_type text,
  county text,
  state text,
  violation_kind text,
  source_url text,
  notes text,
  source_file_sha256 text,
  source_file_bytes integer,
  imported_by text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.source_list_row_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_row_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  status_reason text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
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
  phones text[],
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_key text,
  status_reason text,
  updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status_changed_at timestamptz DEFAULT now(),
  loaded_at timestamptz,
  loaded_export_batch_id uuid,
  list_day date,
  requires_licensee_disclosure boolean NOT NULL DEFAULT false,
  strategy text
);
CREATE TABLE public.crm_properties (id uuid PRIMARY KEY, county text, parcel_id text);
CREATE TABLE public.mortgage_foreclosure_prospects (id uuid PRIMARY KEY);
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

CREATE TABLE public.prospecting_campaigns (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.prospecting_campaign_members (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  prospect_id uuid
);
CREATE TABLE public.prospecting_campaign_member_contacts (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL,
  prospect_id uuid,
  prospect_phone_id uuid,
  phone_snapshot text,
  relationship text,
  contact_name text,
  status text
);
INSERT INTO public.prospecting_campaigns (id, name) VALUES
  ('40000000-0000-4000-8000-0000000000a1', 'Jackson · Tax 3+ · 7 zips · Aug 30');
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261114213919_source_list_service_area_block.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261114215029_tax_status_verification.sql" >/dev/null
apply() {
  local label="$1"
  shift
  if "$@" >/dev/null; then
    echo "PASS: ${label}"
  else
    echo "FAIL: ${label}"
    exit 1
  fi
}

apply "apply #814 renamed suppression chain" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010826_dialer_export_suppression.sql"
apply "apply #814 associate and property DNC" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010849_dialer_export_associate_property_dnc.sql"
apply "apply #814 mojo raw rehearsal" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010855_dialer_export_mojo_raw_and_rehearsal.sql"
apply "apply #814 speed stamp" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010911_dialer_export_speed_f1_stamp.sql"
apply "apply #814 speed stamp again" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010911_dialer_export_speed_f1_stamp.sql"
apply "apply #826 code-violation county backfill" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115012108_code_violation_county_backfill.sql"
apply "apply #812 phone line checks 20261205160000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205160000_phone_line_checks.sql"
apply "apply #812 phone line check review 20261205170000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205170000_phone_line_check_review.sql"
apply "apply #827 owner-line release 20261209120000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261209120000_dialer_owner_line_release.sql"
apply "apply #830 owner-line person skip 20261218120000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261218120000_dialer_owner_line_person_skip.sql"
apply "apply #817 property market checks 20261215120000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215120000_property_market_checks.sql"
apply "apply #817 market-check fix 20261215130000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215130000_market_check_fix_round.sql"
apply "apply #831 relationship lane gate 20261219120000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261219120000_dialer_relationship_lane_gate.sql"
apply "apply #825 mojo DNC ledger 20261220120000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261220120000_mojo_dnc_ledger.sql"
apply "apply #825 mojo DNC ledger 20261220120000 again" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261220120000_mojo_dnc_ledger.sql"
apply "apply #825 calling pool 20261220130000" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261220130000_calling_pool_v1.sql"
apply "apply #825 calling pool 20261220130000 again" "${PSQL[@]}" -f "$ROOT/supabase/migrations/20261220130000_calling_pool_v1.sql"

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

INSERT INTO public.crm_mojo_call_events (provider_contact_id, normalized_phone, outcome, disposition_raw) VALUES
  ('contact-1099', '+18165551099', 'other', NULL);
INSERT INTO public.crm_mojo_calls (phone_last4, result_label, provider_contact_id) VALUES
  ('1099', 'DNC Number', 'contact-1099'),
  ('1100', 'No Answer', NULL);

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
  probe_got boolean;
  report jsonb;
BEGIN
  PERFORM set_config('dialer.pool_now', '2026-11-14 16:00:00+00', true);
  INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
  SELECT DISTINCT row.parcel_id, 'jackson', 'tax_delinquent', row.prospect_id, now(), 'jackson_tax_portal', 'delinquent', 0
  FROM public.source_list_rows AS row
  WHERE row.status = 'ready' AND row.prospect_id IS NOT NULL;

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
    ('+18165551210', '20000000-0000-4000-8000-000000000060', 'associate'),
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

  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1, owner_1_last, owner_1_type, is_skip_traced) VALUES
    ('20000000-0000-4000-8000-0000000000b1', 'jackson', '11 Home', 'P-F1-HOME', 'Ada Owner', 'Owner', 'Individual', true),
    ('20000000-0000-4000-8000-0000000000b2', 'jackson', '12 Other', 'P-F1-OTHER', 'Other', 'Other', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000b3', 'jackson', '13 Corp', 'P-F1-CORP', 'Oak LLC', 'LLC', 'Corporate', false);
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship, contact_name, verified_source) VALUES
    ('30000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1', '+18165550501', 'no_answer', 'owner', 'Ada Owner', 'dataskip_run1'),
    ('30000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', '+18165550501', 'no_answer', 'associate', NULL, NULL),
    ('30000000-0000-4000-8000-0000000000b3', '20000000-0000-4000-8000-0000000000b1', '+18165550502', 'no_answer', 'owner', 'Ada Owner', 'dataskip_run1'),
    ('30000000-0000-4000-8000-0000000000b4', '20000000-0000-4000-8000-0000000000b2', '+18165550502', 'no_answer', 'unknown', NULL, NULL),
    ('30000000-0000-4000-8000-0000000000b5', '20000000-0000-4000-8000-0000000000b3', '+18165550511', NULL, 'entity_contact', 'Registered Agent', NULL),
    ('30000000-0000-4000-8000-0000000000b6', '20000000-0000-4000-8000-0000000000b3', '+18165550512', NULL, 'entity_contact', 'Officer', NULL),
    ('30000000-0000-4000-8000-0000000000b7', '20000000-0000-4000-8000-0000000000b3', '+18165550513', NULL, 'entity_contact', NULL, NULL),
    ('30000000-0000-4000-8000-0000000000b8', '20000000-0000-4000-8000-0000000000b1', '+18165550514', NULL, 'unknown', 'Ada Owner', 'dataskip_run1'),
    ('30000000-0000-4000-8000-0000000000b9', '20000000-0000-4000-8000-0000000000b1', '+18165550515', 'litigator', 'owner', NULL, NULL);
  IF public.source_list_phone_block_reason_v1('+18165550501', '20000000-0000-4000-8000-0000000000b1') IS NOT NULL THEN
    RAISE EXCEPTION 'owner number blocked by an associate on another record: %',
      public.source_list_phone_block_reason_v1('+18165550501', '20000000-0000-4000-8000-0000000000b1');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550501', '20000000-0000-4000-8000-0000000000b2') IS DISTINCT FROM 'associate' THEN
    RAISE EXCEPTION 'associate copy was released: %',
      public.source_list_phone_block_reason_v1('+18165550501', '20000000-0000-4000-8000-0000000000b2');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550502', '20000000-0000-4000-8000-0000000000b1') IS NOT NULL THEN
    RAISE EXCEPTION 'owner number blocked by an unknown tie on another record';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550502', '20000000-0000-4000-8000-0000000000b2') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'unknown copy was released';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550511', '20000000-0000-4000-8000-0000000000b3') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'registered agent was released';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550512', '20000000-0000-4000-8000-0000000000b3') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'entity contact without an SOS or entity skip was released: %',
      public.source_list_phone_block_reason_v1('+18165550512', '20000000-0000-4000-8000-0000000000b3');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550513', '20000000-0000-4000-8000-0000000000b3') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'unknown entity role was released';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550514', '20000000-0000-4000-8000-0000000000b1') IS NOT NULL THEN
    RAISE EXCEPTION 'owner skip-trace match stayed blocked';
  END IF;
  IF public.dialer_relationship_bucket_v1('other_relative', 'Individual') IS DISTINCT FROM 'relative' THEN
    RAISE EXCEPTION 'other relative was not kept as a relative';
  END IF;
  IF public.dialer_relationship_bucket_v1(NULL, 'Other Relative') IS DISTINCT FROM 'relative' THEN
    RAISE EXCEPTION 'other-relative owner type was not kept as a relative';
  END IF;
  IF (SELECT lane FROM public.prospecting_campaigns WHERE id = '40000000-0000-4000-8000-0000000000a1') IS DISTINCT FROM 'tax' THEN
    RAISE EXCEPTION 'tax campaign lane was not backfilled';
  END IF;
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
    ('20000000-0000-4000-8000-0000000000c8', 'jackson', '22 Tax Parent', 'P-TAX-PARENT', 'Parent', 'Individual'),
    ('20000000-0000-4000-8000-0000000000c9', 'jackson', '23 Tax Relative', 'P-TAX-REL', 'Relative', 'Individual');
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
    ('30000000-0000-4000-8000-0000000000c8', '20000000-0000-4000-8000-0000000000c8', '+18165551711', 'no_answer', 'parent'),
    ('30000000-0000-4000-8000-0000000000c9', '20000000-0000-4000-8000-0000000000c9', '+18165551712', 'no_answer', 'relative');
  INSERT INTO public.prospecting_campaign_members (id, campaign_id, prospect_id) VALUES
    ('41000000-0000-4000-8000-0000000000c8', '40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c8'),
    ('41000000-0000-4000-8000-0000000000c9', '40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000c9');
  INSERT INTO public.prospecting_campaign_member_contacts (
    id, member_id, prospect_id, prospect_phone_id, phone_snapshot, relationship, status
  ) VALUES
    ('42000000-0000-4000-8000-0000000000c8', '41000000-0000-4000-8000-0000000000c8', '20000000-0000-4000-8000-0000000000c8', '30000000-0000-4000-8000-0000000000c8', '+18165551711', 'parent', 'ready'),
    ('42000000-0000-4000-8000-0000000000c9', '41000000-0000-4000-8000-0000000000c9', '20000000-0000-4000-8000-0000000000c9', '30000000-0000-4000-8000-0000000000c9', '+18165551712', 'relative', 'ready');
  IF EXISTS (
    SELECT 1 FROM public.campaign_contacts_block_reasons_v1(ARRAY[
      '42000000-0000-4000-8000-0000000000c8'::uuid,
      '42000000-0000-4000-8000-0000000000c9'::uuid
    ])
  ) THEN
    RAISE EXCEPTION 'tax campaign keeps a parent and a generic relative dialable failed: %',
      (SELECT string_agg(contact_id::text || ':' || block_reason, ',') FROM public.campaign_contacts_block_reasons_v1(ARRAY[
        '42000000-0000-4000-8000-0000000000c8'::uuid,
        '42000000-0000-4000-8000-0000000000c9'::uuid
      ]));
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'Ada Owner', 'OWNER, ADA M', 'Chapman', false, NULL, true, 'Janet'
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION 'contact 8188 was not held when owner_1_last disagrees with owner_1: %',
      public.dialer_relationship_block_reason_v1(
        'owner', 'person', ARRAY['tax'], 'Ada Owner', 'OWNER, ADA M', 'Chapman', false, NULL, true, 'Janet'
      );
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'Ada Owner', NULL, 'Chapman', false, NULL, true, 'Janet'
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION 'null owner_1 on a deceased owner line was released';
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'relative', 'person', ARRAY['tax'], 'Ada Owner', 'OWNER, ADA M', 'Chapman', false, NULL, true, 'Janet'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'generic relative on a tax lane was held: %',
      public.dialer_relationship_block_reason_v1(
        'relative', 'person', ARRAY['tax'], 'Ada Owner', 'OWNER, ADA M', 'Chapman', false, NULL, true, 'Janet'
      );
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'Smith', 'JOHN SMITH AND MARY JONES', NULL, false, NULL, true, NULL
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION 'joint owner Smith was not held';
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'John Smith', 'SMITH JOHN & MARY', NULL, false, NULL, true, NULL
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION 'last-first joint owner was not held';
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'Smith', 'MARY JONES & DAVID CHARLES', 'Smith', false, NULL, true, 'Janet'
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION '756bcafd owner_1_last was not held';
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'owner', 'person', ARRAY['tax'], 'Smith', 'JOHN A SMITH JR TRUSTEE', NULL, false, NULL, true, NULL
  ) IS DISTINCT FROM 'deceased_owner_line' THEN
    RAISE EXCEPTION 'suffixed owner surname was not held';
  END IF;
  IF public.dialer_relationship_block_reason_v1(
    'relative', 'person', ARRAY['tax'], 'Grant Other', 'JOHN SMITH AND MARY JONES', NULL, false, NULL, true, NULL
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'generic relative whose surname matches no owner was held';
  END IF;
  -- Katherine round 3. Real last-4s are comments only: Unknown owner type 7005, surname-only Gus Uno 7006.
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1, owner_1_last, owner_1_type, is_skip_traced) VALUES
    ('20000000-0000-4000-8000-0000000000e1', 'jackson', '15 Unknown', 'P-UNK', 'Pat Unknown', 'Unknown', 'Unknown', false),
    ('20000000-0000-4000-8000-0000000000e2', 'jackson', '16 Uno', 'P-UNO', 'FAY UNO', 'UNO', 'Individual', true);
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship, contact_name, verified_source) VALUES
    ('30000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', '+18165550145', 'no_answer', NULL, NULL, NULL),
    ('30000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e2', '+18165550146', 'no_answer', 'unknown', 'Gus Uno', 'dataskip_run1'),
    ('30000000-0000-4000-8000-0000000000e3', '20000000-0000-4000-8000-0000000000e2', '+18165550147', 'no_answer', 'unknown', 'Fay Uno', 'dataskip_run1');
  IF public.source_list_phone_block_reason_v1('+18165550145', '20000000-0000-4000-8000-0000000000e1') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'unknown owner type was dialable: %',
      public.source_list_phone_block_reason_v1('+18165550145', '20000000-0000-4000-8000-0000000000e1');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550146', '20000000-0000-4000-8000-0000000000e2') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'surname-only skip-trace contact was released: %',
      public.source_list_phone_block_reason_v1('+18165550146', '20000000-0000-4000-8000-0000000000e2');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550147', '20000000-0000-4000-8000-0000000000e2') IS NOT NULL THEN
    RAISE EXCEPTION 'full first-and-last owner match stayed blocked: %',
      public.source_list_phone_block_reason_v1('+18165550147', '20000000-0000-4000-8000-0000000000e2');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550515', '20000000-0000-4000-8000-0000000000b1') IS DISTINCT FROM 'unmapped_label' THEN
    RAISE EXCEPTION 'litigator was not blocked before the stamp';
  END IF;
  IF public.apply_mojo_dial_phone_stamp_v1('+18165550515', 'no_answer', now()) < 1 THEN
    RAISE EXCEPTION 'litigator stamp did not run';
  END IF;
  IF (SELECT last_disposition FROM public.prospect_phones WHERE phone = '+18165550515') IS DISTINCT FROM 'litigator' THEN
    RAISE EXCEPTION 'no_answer overwrote litigator';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550515', '20000000-0000-4000-8000-0000000000b1') IS DISTINCT FROM 'unmapped_label' THEN
    RAISE EXCEPTION 'litigator exported after no_answer';
  END IF;
  DELETE FROM public.prospect_phones WHERE phone = '+18165550515';

  INSERT INTO public.crm_mojo_call_events (record_id, normalized_phone, outcome, disposition_raw) VALUES
    ('full-phone-call', '+18165559944', 'other', 'DNC Number');
  INSERT INTO public.crm_mojo_calls (record_id, phone_last4, result_label) VALUES
    ('full-phone-call', '9944', 'DNC Number');
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
    ('20000000-0000-4000-8000-0000000000c1', 'jackson', '14 Full', 'P-FULL', 'Full', 'Individual');
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
    ('30000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', '+18165551944', 'no_answer', 'owner');
  IF public.source_list_phone_block_reason_v1('+18165551944', '20000000-0000-4000-8000-0000000000c1') IS NOT NULL THEN
    RAISE EXCEPTION 'last-4 hold fired even though the Mojo call has a full phone: %',
      public.source_list_phone_block_reason_v1('+18165551944', '20000000-0000-4000-8000-0000000000c1');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165559944', '20000000-0000-4000-8000-0000000000c1') IS DISTINCT FROM 'mojo_dnc' THEN
    RAISE EXCEPTION 'full DNC number was not blocked';
  END IF;

  -- INC-2026-11-13-001 shapes. Real last-4s are comments only: Robertson 5603, Al-Saady 4857, Shellner 7542, Price 9781.
  INSERT INTO public.sms_opt_outs (phone, is_opted_out) VALUES
    ('+18165550131', true),
    ('+18165550132', true),
    ('+18165550133', true);
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
    ('20000000-0000-4000-8000-0000000000d1', 'jackson', '15 Robertson', 'P-INC-1', 'Robertson', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d2', 'jackson', '16 Alsaady', 'P-INC-2', 'Alsaady', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d3', 'jackson', '17 Shellner', 'P-INC-3', 'Shellner', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d4', 'jackson', '18 Price', 'P-INC-4', 'Price', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d5', 'jackson', '19 Clean', 'P-CLEAN', 'Clean', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d6', 'cass', '20 Cass', 'P-CASS', 'Cass', 'Individual'),
    ('20000000-0000-4000-8000-0000000000d7', 'jackson', '21 Neighbor', 'P-NEIGHBOR', 'Neighbor', 'Individual');
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
    ('30000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', '+18165550131', NULL, 'owner'),
    ('30000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000d2', '+18165550132', 'not_interested', 'owner'),
    ('30000000-0000-4000-8000-0000000000d3', '20000000-0000-4000-8000-0000000000d3', '+18165550133', NULL, 'owner'),
    ('30000000-0000-4000-8000-0000000000d4', '20000000-0000-4000-8000-0000000000d4', '+18165550134', 'dnc', 'owner'),
    ('30000000-0000-4000-8000-0000000000d5', '20000000-0000-4000-8000-0000000000d4', '+18165550134', NULL, 'owner'),
    ('30000000-0000-4000-8000-0000000000d6', '20000000-0000-4000-8000-0000000000d4', '+18165550134', 'wrong_number', 'owner'),
    ('30000000-0000-4000-8000-0000000000d7', '20000000-0000-4000-8000-0000000000d5', '+18165550140', 'no_answer', 'owner'),
    ('30000000-0000-4000-8000-0000000000d8', '20000000-0000-4000-8000-0000000000d6', '+18165550141', 'no_answer', 'owner'),
    ('30000000-0000-4000-8000-0000000000d9', '20000000-0000-4000-8000-0000000000d7', '+18165550142', 'no_answer', 'owner');
  INSERT INTO public.leads (id, phone, dead_reason) VALUES
    ('40000000-0000-4000-8000-0000000000d4', '+18165550134', 'dnc_refused');
  INSERT INTO public.crm_mojo_calls (phone_last4, result_label) VALUES ('0142', 'Fax');
  IF public.source_list_phone_block_reason_v1('+18165550131', '20000000-0000-4000-8000-0000000000d1') IS DISTINCT FROM 'sms_opt_out' THEN
    RAISE EXCEPTION 'Robertson shape was not an sms opt-out';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550132', '20000000-0000-4000-8000-0000000000d2') IS DISTINCT FROM 'sms_opt_out' THEN
    RAISE EXCEPTION 'Al-Saady shape was not an sms opt-out';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550133', '20000000-0000-4000-8000-0000000000d3') IS DISTINCT FROM 'sms_opt_out' THEN
    RAISE EXCEPTION 'Shellner shape was not an sms opt-out';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550134', '20000000-0000-4000-8000-0000000000d4') IS DISTINCT FROM 'prospect_dnc' THEN
    RAISE EXCEPTION 'Price siblings were not blocked: %',
      public.source_list_phone_block_reason_v1('+18165550134', '20000000-0000-4000-8000-0000000000d4');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550142', '20000000-0000-4000-8000-0000000000d7') IS NOT NULL THEN
    RAISE EXCEPTION 'a different number sharing a Fax last-4 was blocked: %',
      public.source_list_phone_block_reason_v1('+18165550142', '20000000-0000-4000-8000-0000000000d7');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550141', 'cass', 'cass') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'Cass was not out of the service area';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', 'jackson', 'jackson') IS NOT NULL THEN
    RAISE EXCEPTION 'Jackson clean phone was blocked by the 3-arg scrub';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', 'Jackson', 'Jackson') IS NOT NULL THEN
    RAISE EXCEPTION 'capitalized Jackson was blocked';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', ' clay ', 'clay') IS NOT NULL
    OR public.source_list_phone_block_reason_v1('+18165550140', 'Platte', 'platte') IS NOT NULL
    OR public.source_list_phone_block_reason_v1('+18165550140', 'Wyandotte', 'wyandotte') IS NOT NULL
    OR public.source_list_phone_block_reason_v1('+18165550140', 'Johnson', 'johnson') IS NOT NULL THEN
    RAISE EXCEPTION 'a service county was blocked';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', 'Bates', 'Bates') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'a named county outside the service area was not out_of_service_area';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', NULL, NULL) IS DISTINCT FROM 'county_unresolved'
    OR public.source_list_phone_block_reason_v1('+18165550140', '   ', '') IS DISTINCT FROM 'county_unresolved'
    OR public.source_list_phone_block_reason_v1('+18165550140', 'unknown', 'unknown') IS DISTINCT FROM 'county_unresolved'
    OR public.source_list_phone_block_reason_v1('+18165550140', 'Unresolved', NULL) IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'an unresolved county was not county_unresolved';
  END IF;

  INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
  SELECT DISTINCT row.parcel_id, 'jackson', 'tax_delinquent', row.prospect_id, now(), 'jackson_tax_portal', 'delinquent', 0
  FROM public.source_list_rows AS row
  WHERE row.status = 'ready' AND row.prospect_id IS NOT NULL;

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

  CREATE TEMP TABLE owner_line_case(
    owner_name text,
    owner_last text,
    contact_name text,
    relationship text,
    skip_traced boolean,
    verified_source text,
    owner_type text,
    expected boolean
  ) ON COMMIT DROP;
  INSERT INTO owner_line_case VALUES
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, true),
    ('John Smith', 'Smith', 'John Smith', 'associate', false, NULL, NULL, true),
    ('Oak LLC', 'LLC', 'Oak LLC', 'entity_contact', false, NULL, NULL, false),
    ('Acme Inc', 'Inc', 'Acme Inc', 'unknown', false, NULL, NULL, false),
    ('Acme Incorporated', 'Incorporated', 'Acme Incorporated', 'unknown', false, NULL, NULL, false),
    ('Smith Family Trust', 'Trust', 'Smith Family', 'unknown', false, NULL, NULL, false),
    ('First National Bank', 'Bank', 'First National', 'unknown', false, NULL, NULL, false),
    ('John Smith, Trustee', 'Smith', 'John Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('John Smith Trustee of the Smith Trust', 'Smith', 'John Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Jimmie C & Nora A-Trustees', 'Alden', 'Nora Alden', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Smith Family Trust', 'Smith', 'Smith Trust', 'unknown', false, NULL, NULL, false),
    ('John Smith & Acme LLC', 'Smith', 'Acme LLC', 'unknown', false, NULL, NULL, false),
    ('John Smith & Acme LLC', 'Smith', 'John Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('John & Mary Smith', 'Smith', 'John Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Marcus S & Nora', 'Alden', 'Nora Alden', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Nancy L & Brook Robert L', 'Alden', 'Robert Brook', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Parker Owen E & E Lila', 'Parker', 'Lila Parker', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Walter C & Nora Jane', 'Alden', 'Nora Alden', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Reginald T & Brook Johnetta', 'Alden', 'Johnetta Brook', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Lynn & Brook Earl M Jr', 'Alden', 'Earl Brook', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Ricky & Alden Ronald', 'Alden', 'Ronald Alden', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Alden Marcus L Jr & Nora', 'Alden Jr', 'Nora Alden', 'owner', true, 'dataskip_run_1', 'person', true),
    ('William & Mary Smith', 'Smith', 'Bill Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Robert Smith', 'Smith', 'Bob Smith', 'unknown', false, NULL, NULL, true),
    ('Elizabeth Smith', 'Smith', 'Liz Smith', 'unknown', false, NULL, NULL, true),
    ('John & Mary Smith', 'Smith', 'Mary Jones', 'unknown', false, NULL, NULL, false),
    ('Fay Uno', 'Uno', 'Gus Uno', 'unknown', true, 'dataskip_run1', NULL, false),
    ('Alden Brenda Sue & Alden Carol Sue', 'Alden', 'Judy Alden', 'unknown', false, NULL, NULL, false),
    ('Dearing John & Diane', 'Dearing', 'Diana Dearing', 'unknown', false, NULL, NULL, false),
    ('Roy Huggins & Christine', 'Huggins', 'Christine Leiker', 'unknown', false, NULL, NULL, false),
    ('Margaret Smith', 'Smith', 'Peggy Smith', 'unknown', false, NULL, NULL, false),
    ('John Smith', 'Smith', 'John Smith', 'registered_agent', false, NULL, NULL, false),
    ('James Robert Smith', 'Smith', 'James Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('James Robert Smith', 'Smith', 'James Q Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('James Robert Smith', 'Smith', 'James Robert Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('Smith James R', 'Smith', 'James Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('James Robert Smith', 'Smith', 'Robert Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('James Robert Smith', 'Smith', 'Bob Smith', 'owner', true, 'dataskip_run_1', 'person', true),
    ('James Robert Smith', 'Smith', 'Robert Smith', 'unknown', false, NULL, NULL, false),
    ('James Robert Smith', 'Smith', 'Robert Smith', 'unknown', false, 'manual', NULL, false),
    ('John Smith et al', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, false),
    ('Heirs of John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, false),
    ('Estate of John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, false),
    ('John Smith deceased', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, false),
    ('John Smith c/o Jane Doe', 'Smith', 'John Smith', 'unknown', false, NULL, NULL, false),
    ('John Smith c/o Jane Doe', 'Smith', 'Jane Doe', 'unknown', false, NULL, NULL, false),
    ('John Smith', 'Smith', 'John Smith et al', 'unknown', false, NULL, NULL, false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'spouse', true, 'dataskip_run_1', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'parent', true, 'dataskip_run_1', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'unknown', true, 'dataskip_run_1', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'mojo_call', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'mojo_import', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, NULL, 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'subject', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'auto', 'person', false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'manual', 'person', false),
    ('Oak LLC', 'LLC', 'Oak LLC', 'owner', true, 'dataskip_run_1', NULL, false),
    ('Jane Smith LLC', 'Smith', 'Jane Smith', 'owner', true, 'dataskip_run_1', NULL, false),
    ('Jane Doe', 'Doe', 'Jane Doe', 'unknown', false, NULL, NULL, true),
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, 'Individual', true),
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, 'individual', true),
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, 'PERSON', true),
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, 'Coworker', false),
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, 'LLC', false),
    ('Oak Properties', 'Properties', 'Oak Properties', 'unknown', false, NULL, NULL, false),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'owner', true, 'dataskip_run_x', 'person', true),
    ('James Robert Smith', 'Smith', 'James Smith', 'owner', true, 'smartskip_batch', 'person', true);
  FOR rec IN SELECT * FROM owner_line_case LOOP
    IF public.dialer_owner_line_release_v1(
      rec.relationship, rec.contact_name, rec.owner_name, rec.owner_last, rec.skip_traced, rec.verified_source, rec.owner_type
    ) IS DISTINCT FROM rec.expected THEN
      RAISE EXCEPTION 'owner line % / % expected % got %', rec.owner_name, rec.contact_name, rec.expected,
        public.dialer_owner_line_release_v1(
          rec.relationship, rec.contact_name, rec.owner_name, rec.owner_last, rec.skip_traced, rec.verified_source, rec.owner_type
        );
    END IF;
  END LOOP;

  -- Original #827 probes with a null owner type. Clean first-and-last names stay
  -- released. Every other #827 release flips off under Pat 4f/4g.
  CREATE TEMP TABLE probe_827(
    owner_name text, owner_last text, contact_name text, relationship text,
    skip_traced boolean, verified_source text, old_expected boolean
  ) ON COMMIT DROP;
  INSERT INTO probe_827 VALUES
    ('John Smith', 'Smith', 'John Smith', 'unknown', false, NULL, true),
    ('John Smith', 'Smith', 'John Smith', 'associate', false, NULL, true),
    ('Robert Smith', 'Smith', 'Bob Smith', 'unknown', false, NULL, true),
    ('Elizabeth Smith', 'Smith', 'Liz Smith', 'unknown', false, NULL, true),
    ('John Smith, Trustee', 'Smith', 'John Smith', 'unknown', false, NULL, true),
    ('John Smith Trustee of the Smith Trust', 'Smith', 'John Smith', 'unknown', false, NULL, true),
    ('Alden Jimmie C & Nora A-Trustees', 'Alden', 'Nora Alden', 'unknown', false, NULL, true),
    ('John Smith & Acme LLC', 'Smith', 'John Smith', 'unknown', false, NULL, true),
    ('John & Mary Smith', 'Smith', 'Mary Smith', 'unknown', false, NULL, true),
    ('John & Mary Smith', 'Smith', 'John Smith', 'associate', false, NULL, true),
    ('William & Mary Smith', 'Smith', 'Bill Smith', 'unknown', false, NULL, true),
    ('James Robert Smith', 'Smith', 'James Smith', 'unknown', false, NULL, true),
    ('James Robert Smith', 'Smith', 'James Q Smith', 'unknown', false, NULL, true),
    ('James Robert Smith', 'Smith', 'James Robert Smith', 'unknown', false, NULL, true),
    ('Smith James R', 'Smith', 'James Smith', 'unknown', false, NULL, true),
    ('James Robert Smith', 'Smith', 'Robert Smith', 'unknown', true, NULL, true),
    ('James Robert Smith', 'Smith', 'Bob Smith', 'unknown', false, 'dataskip_run1', true),
    ('Oak LLC', 'LLC', 'Oak LLC', 'entity_contact', false, NULL, false),
    ('John & Mary Smith', 'Smith', 'Mary Jones', 'unknown', false, NULL, false),
    ('Fay Uno', 'Uno', 'Gus Uno', 'unknown', true, 'dataskip_run1', false),
    ('Margaret Smith', 'Smith', 'Peggy Smith', 'unknown', false, NULL, false),
    ('John Smith', 'Smith', 'John Smith', 'registered_agent', false, NULL, false);
  FOR rec IN SELECT * FROM probe_827 LOOP
    probe_got := public.dialer_owner_line_release_v1(
      rec.relationship, rec.contact_name, rec.owner_name, rec.owner_last, rec.skip_traced, rec.verified_source, NULL
    );
    IF rec.owner_name IN ('John Smith', 'Robert Smith', 'Elizabeth Smith') AND rec.old_expected THEN
      IF probe_got IS NOT TRUE THEN
        RAISE EXCEPTION '#827 clean name flipped off: % / %', rec.owner_name, rec.contact_name;
      END IF;
    ELSIF rec.old_expected THEN
      IF probe_got IS NOT FALSE THEN
        RAISE EXCEPTION '#827 probe did not flip off: % / %', rec.owner_name, rec.contact_name;
      END IF;
    ELSIF probe_got IS NOT FALSE THEN
      RAISE EXCEPTION '#827 blocked probe flipped on: % / %', rec.owner_name, rec.contact_name;
    END IF;
  END LOOP;

  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1, owner_1_last, owner_1_type, is_skip_traced) VALUES
    ('20000000-0000-4000-8000-0000000000f1', 'jackson', '81 Co', 'P-CO', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f2', 'jackson', '82 Middle', 'P-MID', 'James Robert Smith', 'Smith', 'Individual', true),
    ('20000000-0000-4000-8000-0000000000f3', 'jackson', '83 NoSkip', 'P-NOSKIP', 'James Robert Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f4', 'jackson', '84 Hold', 'P-HOLD2', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f5', 'jackson', '85 Dnc', 'P-DNC2', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f6', 'jackson', '86 Opt', 'P-OPT', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f7', 'cass', '87 Cass', 'P-CASS2', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f8', 'jackson', '88 Fan', 'P-FAN', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000f9', 'jackson', '89 Prop', 'P-PROP2', 'John & Mary Smith', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000fa', 'jackson', '90 Marker', 'P-ETAL', 'John Smith et al', 'Smith', 'Individual', false),
    ('20000000-0000-4000-8000-0000000000fb', 'jackson', '91 Tax', 'P-TAX-CO', 'John & Mary Smith', 'Smith', 'Individual', false);
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship, contact_name, voice_hold, verified_source) VALUES
    ('30000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', '+18165550801', 'no_answer', 'associate', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f1', '+18165550802', 'no_answer', 'unknown', 'Mary Jones', false, NULL),
    ('30000000-0000-4000-8000-0000000000f3', '20000000-0000-4000-8000-0000000000f2', '+18165550803', 'no_answer', 'unknown', 'Robert Smith', false, 'dataskip_run1'),
    ('30000000-0000-4000-8000-0000000000f4', '20000000-0000-4000-8000-0000000000f3', '+18165550804', 'no_answer', 'unknown', 'Robert Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000f5', '20000000-0000-4000-8000-0000000000f4', '+18165550805', 'no_answer', 'unknown', 'Mary Smith', true, NULL),
    ('30000000-0000-4000-8000-0000000000f6', '20000000-0000-4000-8000-0000000000f5', '+18165550806', 'dnc', 'unknown', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000f7', '20000000-0000-4000-8000-0000000000f6', '+18165550807', 'no_answer', 'unknown', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000f8', '20000000-0000-4000-8000-0000000000f7', '+18165550808', 'no_answer', 'owner', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000f9', '20000000-0000-4000-8000-0000000000f8', '+18165550809', 'no_answer', 'owner', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000fa', '20000000-0000-4000-8000-0000000000f8', '+18165550810', 'dnc_contact', 'relative', 'John Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000fb', '20000000-0000-4000-8000-0000000000f9', '+18165550811', 'dnc', 'owner', 'John Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000fc', '20000000-0000-4000-8000-0000000000f9', '+18165550812', 'no_answer', 'owner', 'Mary Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000fd', '20000000-0000-4000-8000-0000000000fa', '+18165550813', 'no_answer', 'unknown', 'John Smith', false, NULL),
    ('30000000-0000-4000-8000-0000000000fe', '20000000-0000-4000-8000-0000000000fb', '+18165550814', 'no_answer', 'owner', 'Mary Smith', false, NULL);
  INSERT INTO public.sms_opt_outs (phone, is_opted_out) VALUES ('+18165550807', true);
  IF public.source_list_phone_block_reason_v1('+18165550801', '20000000-0000-4000-8000-0000000000f1') IS DISTINCT FROM 'associate' THEN
    RAISE EXCEPTION 'associate co-owner was released: %',
      public.source_list_phone_block_reason_v1('+18165550801', '20000000-0000-4000-8000-0000000000f1');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550802', '20000000-0000-4000-8000-0000000000f1') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'Mary Jones was released: %',
      public.source_list_phone_block_reason_v1('+18165550802', '20000000-0000-4000-8000-0000000000f1');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550803', '20000000-0000-4000-8000-0000000000f2') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'unknown middle-name tie was released: %',
      public.source_list_phone_block_reason_v1('+18165550803', '20000000-0000-4000-8000-0000000000f2');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550804', '20000000-0000-4000-8000-0000000000f3') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'middle name without skip trace was released: %',
      public.source_list_phone_block_reason_v1('+18165550804', '20000000-0000-4000-8000-0000000000f3');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550805', '20000000-0000-4000-8000-0000000000f4') IS DISTINCT FROM 'voice_hold' THEN
    RAISE EXCEPTION 'owner-line release cleared a voice hold: %',
      public.source_list_phone_block_reason_v1('+18165550805', '20000000-0000-4000-8000-0000000000f4');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550806', '20000000-0000-4000-8000-0000000000f5') IS DISTINCT FROM 'prospect_dnc' THEN
    RAISE EXCEPTION 'owner-line release cleared a DNC: %',
      public.source_list_phone_block_reason_v1('+18165550806', '20000000-0000-4000-8000-0000000000f5');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550807', '20000000-0000-4000-8000-0000000000f6') IS DISTINCT FROM 'sms_opt_out' THEN
    RAISE EXCEPTION 'owner-line release cleared an opt-out: %',
      public.source_list_phone_block_reason_v1('+18165550807', '20000000-0000-4000-8000-0000000000f6');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550808', 'cass', 'cass') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'owner-line release cleared Cass: %',
      public.source_list_phone_block_reason_v1('+18165550808', 'cass', 'cass');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550808', NULL, NULL) IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'owner-line release cleared an unresolved county: %',
      public.source_list_phone_block_reason_v1('+18165550808', NULL, NULL);
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550809', '20000000-0000-4000-8000-0000000000f8') IS DISTINCT FROM 'person_fanout' THEN
    RAISE EXCEPTION 'owner-line release cleared a person fan-out: %',
      public.source_list_phone_block_reason_v1('+18165550809', '20000000-0000-4000-8000-0000000000f8');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550812', '20000000-0000-4000-8000-0000000000f9') IS DISTINCT FROM 'property_owner_dnc_fanout' THEN
    RAISE EXCEPTION 'owner-line release cleared a property fan-out: %',
      public.source_list_phone_block_reason_v1('+18165550812', '20000000-0000-4000-8000-0000000000f9');
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550813', '20000000-0000-4000-8000-0000000000fa') IS DISTINCT FROM 'relationship_unknown' THEN
    RAISE EXCEPTION 'et al was released: %',
      public.source_list_phone_block_reason_v1('+18165550813', '20000000-0000-4000-8000-0000000000fa');
  END IF;

  INSERT INTO public.source_list_rows (
    id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones
  ) VALUES (
    '50000000-0000-4000-8000-0000000000fb',
    '10000000-0000-4000-8000-000000000001',
    'tax_delinquent',
    'jackson',
    'MO',
    'P-TAX-CO',
    '91 Tax',
    'John & Mary Smith',
    '20000000-0000-4000-8000-0000000000fb',
    'ready',
    ARRAY['+18165550814']
  );
  IF public.source_list_phone_block_reason_v1('+18165550814', '20000000-0000-4000-8000-0000000000fb') IS NOT NULL THEN
    RAISE EXCEPTION 'tax row was blocked before the tax gate: %',
      public.source_list_phone_block_reason_v1('+18165550814', '20000000-0000-4000-8000-0000000000fb');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export
    WHERE phone_e164 = '+18165550814' AND prospect_id = '20000000-0000-4000-8000-0000000000fb'
  ) THEN
    RAISE EXCEPTION 'owner-line release exported a tax row without a live delinquent check';
  END IF;
  INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
  VALUES ('P-TAX-CO', 'jackson', 'tax_delinquent', '20000000-0000-4000-8000-0000000000fb', now(), 'jackson_tax_portal', 'delinquent', 0);
  IF NOT EXISTS (
    SELECT 1 FROM public.source_list_dialer_export
    WHERE phone_e164 = '+18165550814' AND prospect_id = '20000000-0000-4000-8000-0000000000fb'
  ) THEN
    RAISE EXCEPTION 'a live delinquent co-owner stayed out of the export';
  END IF;
END $$;
RESET ROLE;
SELECT 'PASS: raw Fax and DNC Number, DNC Contact fan-out, dnc_refused without a prospect link, dead_reason dnc versus DNC Number only, fan-out voice hold, last-4 hold, monotonic stamps, associate and property fan-out, dataskip_dnc export, encode queue no-op, F1 release, litigator stamp' AS result;
SQL
echo "PASS: #827 owner-line probes"

"${PSQL[@]}" -f "$ROOT/scripts/rehearse-calling-pool-v1.sql"

"${PSQL[@]}" <<'SQL'
INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type)
SELECT
  ('70000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'jackson',
  'bg ' || n,
  'BG-' || n,
  'Bg',
  'Individual'
FROM generate_series(1, 4000) AS n;
INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship)
SELECT
  ('71000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('70000000-0000-4000-8000-' || lpad(to_hex(((n - 1) / 2) + 1), 12, '0'))::uuid,
  '+1' || lpad((3000000000 + n)::text, 10, '0'),
  'no_answer',
  'owner'
FROM generate_series(1, 8000) AS n;

INSERT INTO public.source_lists VALUES
  ('60000000-0000-4000-8000-000000000099', DATE '2026-11-14', 'speed.csv');
INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type)
SELECT
  ('72000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'jackson',
  'speed ' || n,
  'SP-' || n,
  'Speed',
  'Individual'
FROM generate_series(1, 500) AS n;
INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship)
SELECT
  ('73000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  ('72000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '+1816556' || lpad(n::text, 4, '0'),
  'no_answer',
  'owner'
FROM generate_series(1, 500) AS n;
INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones
)
SELECT
  ('74000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '60000000-0000-4000-8000-000000000099',
  'tax_delinquent',
  'jackson',
  'MO',
  'SP-' || n,
  'speed ' || n,
  'Speed',
  ('72000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  'ready',
  ARRAY['+1816556' || lpad(n::text, 4, '0')]
FROM generate_series(1, 500) AS n;

ANALYZE public.prospects;
ANALYZE public.prospect_phones;
ANALYZE public.leads;
ANALYZE public.crm_mojo_calls;
ANALYZE public.crm_mojo_call_events;
ANALYZE public.sms_opt_outs;
INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
SELECT 'SP-' || n, 'jackson', 'tax_delinquent',
  ('72000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  now(), 'jackson_tax_portal', 'delinquent', 0
FROM generate_series(1, 500) AS n;
SET statement_timeout = '8s';
SET ROLE service_role;
DO $$
DECLARE
  started timestamptz := clock_timestamp();
  report jsonb;
  elapsed numeric;
BEGIN
  PERFORM set_config('dialer.pool_now', '2026-11-14 16:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'speed', NULL, NULL, NULL, NULL, '60000000-0000-4000-8000-000000000099', 1
  );
  elapsed := round(extract(epoch FROM clock_timestamp() - started)::numeric, 3);
  IF report->>'phone_count' <> '500' THEN
    RAISE EXCEPTION 'speed batch exported % phones', report->>'phone_count';
  END IF;
  IF elapsed > 7 THEN
    RAISE EXCEPTION '500 phone batch took % seconds', elapsed;
  END IF;
  RAISE NOTICE '500 phone batch took % seconds', elapsed;
END $$;
RESET ROLE;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205160000_phone_line_checks.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205170000_phone_line_check_review.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
INSERT INTO public.source_lists VALUES
  ('81000000-0000-4000-8000-000000000001', DATE '2026-11-15', 'line-check-gates.csv');
INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
  ('82000000-0000-4000-8000-000000000001', 'cass', '30 Cass', 'P-LINE-CASS', 'Cass', 'Individual'),
  ('82000000-0000-4000-8000-000000000002', NULL, '31 Blank', 'P-LINE-NULL', 'Blank', 'Individual'),
  ('82000000-0000-4000-8000-000000000003', 'jackson', '32 Tax', 'P-LINE-TAX', 'Tax', 'Individual');
INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '+18165550701', 'no_answer', 'owner'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', '+18165550702', 'no_answer', 'owner'),
  ('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000003', '+18165550703', 'no_answer', 'owner');
INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones, raw
) VALUES
  (
    '84000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'foreclosure', 'Cass', 'MO', 'P-LINE-CASS', '30 Cass', 'Cass',
    '82000000-0000-4000-8000-000000000001', 'ready', ARRAY['+18165550701'], '{}'::jsonb
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000001',
    'foreclosure', NULL, 'MO', 'P-LINE-NULL', '31 Blank', 'Blank',
    '82000000-0000-4000-8000-000000000002', 'ready', ARRAY['+18165550702'], '{}'::jsonb
  ),
  (
    '84000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001',
    'tax_delinquent', 'jackson', 'MO', 'P-LINE-TAX', '32 Tax', 'Tax',
    '82000000-0000-4000-8000-000000000003', 'ready', ARRAY['+18165550703'], '{}'::jsonb
  );

GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

SET ROLE service_role;
DO $$
DECLARE
  report jsonb;
  jit_off boolean;
BEGIN
  IF public.source_list_phone_block_reason_v1('+18165550701', 'Cass', 'Cass') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'Cass was not out_of_service_area after the line-check migration';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550702', NULL, NULL) IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'a null county was not county_unresolved after the line-check migration';
  END IF;

  IF (
    SELECT block_reason FROM public.source_list_dialer_phone_review
    WHERE parcel_id = 'P-LINE-CASS'
  ) IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'Cass parcel review reason was %', (
      SELECT block_reason FROM public.source_list_dialer_phone_review WHERE parcel_id = 'P-LINE-CASS'
    );
  END IF;
  IF (
    SELECT block_reason FROM public.source_list_dialer_phone_review
    WHERE parcel_id = 'P-LINE-NULL'
  ) IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'null-county parcel review reason was %', (
      SELECT block_reason FROM public.source_list_dialer_phone_review WHERE parcel_id = 'P-LINE-NULL'
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export
    WHERE parcel_id IN ('P-LINE-CASS', 'P-LINE-NULL', 'P-LINE-TAX')
  ) THEN
    RAISE EXCEPTION 'a Cass, unresolved, or unchecked tax row was exported';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tax_status_checks WHERE parcel_id = 'P-LINE-TAX'
  ) AND EXISTS (
    SELECT 1 FROM public.source_list_dialer_phone_review
    WHERE parcel_id = 'P-LINE-TAX' AND block_reason IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.source_list_dialer_export WHERE parcel_id = 'P-LINE-TAX'
  ) THEN
    RAISE EXCEPTION 'tax-delinquent row with no status check was exported';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export WHERE parcel_id = 'P-LINE-TAX'
  ) THEN
    RAISE EXCEPTION 'tax-delinquent row with no recent status check was exported';
  END IF;

  report := public.record_source_list_export_batch_v1(
    'line-check-gates', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000001', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'gate batch exported % phones', report->>'phone_count';
  END IF;
  IF (report->'rows')::text LIKE '%1816555070%' THEN
    RAISE EXCEPTION 'gate batch rows included a blocked phone';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'record_source_list_export_batch_v1'
      AND 'jit=off' = ANY (proconfig)
  ) INTO jit_off;
  IF NOT jit_off THEN
    RAISE EXCEPTION 'record_source_list_export_batch_v1 lost jit=off';
  END IF;

  INSERT INTO public.property_market_checks (id, source, list_day, listing_status)
  VALUES ('85000000-0000-4000-8000-000000000001', 'heartland_matrix', CURRENT_DATE, 'listing_expired');
  INSERT INTO public.source_lists (id, pull_date, source_file_name, list_type, county, state) VALUES
    ('81000000-0000-4000-8000-000000000002', CURRENT_DATE, 'expired-tags.csv', 'probate_estate', 'jackson', 'MO'),
    ('81000000-0000-4000-8000-000000000003', CURRENT_DATE, 'tomorrow.csv', 'probate_estate', 'jackson', 'MO');
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
    ('82000000-0000-4000-8000-000000000011', 'jackson', '40 Probate', 'P-EXP-PROBATE', 'Probate', 'Individual'),
    ('82000000-0000-4000-8000-000000000012', 'jackson', '41 Tax', 'P-EXP-TAX', 'TaxTag', 'Individual'),
    ('82000000-0000-4000-8000-000000000013', 'jackson', '42 Tomorrow', 'P-TOMORROW', 'Tomorrow', 'Individual');
  INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
    ('83000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000011', '+18165550711', 'no_answer', 'owner'),
    ('83000000-0000-4000-8000-000000000012', '82000000-0000-4000-8000-000000000012', '+18165550712', 'no_answer', 'owner'),
    ('83000000-0000-4000-8000-000000000013', '82000000-0000-4000-8000-000000000013', '+18165550713', 'no_answer', 'owner');
  INSERT INTO public.source_list_rows (
    id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones, list_day, match_key
  ) VALUES
    (
      '84000000-0000-4000-8000-000000000011',
      '81000000-0000-4000-8000-000000000002',
      'probate_estate', 'jackson', 'MO', 'P-EXP-PROBATE', '40 Probate', 'Probate',
      '82000000-0000-4000-8000-000000000011', 'ready', ARRAY['+18165550711'], CURRENT_DATE, 'parcel:P-EXP-PROBATE'
    ),
    (
      '84000000-0000-4000-8000-000000000012',
      '81000000-0000-4000-8000-000000000002',
      'tax_delinquent', 'jackson', 'MO', 'P-EXP-TAX', '41 Tax', 'TaxTag',
      '82000000-0000-4000-8000-000000000012', 'ready', ARRAY['+18165550712'], CURRENT_DATE, 'parcel:P-EXP-TAX'
    ),
    (
      '84000000-0000-4000-8000-000000000013',
      '81000000-0000-4000-8000-000000000003',
      'probate_estate', 'jackson', 'MO', 'P-TOMORROW', '42 Tomorrow', 'Tomorrow',
      '82000000-0000-4000-8000-000000000013', 'ready', ARRAY['+18165550713'], CURRENT_DATE + 1, 'parcel:P-TOMORROW'
    );
  INSERT INTO public.source_list_row_mls_tags (source_list_row_id, mls_tag, strategy, source_check_id, list_day) VALUES
    ('84000000-0000-4000-8000-000000000011', 'expired_listing', 'wholesale', '85000000-0000-4000-8000-000000000001', CURRENT_DATE),
    ('84000000-0000-4000-8000-000000000012', 'expired_listing', 'wholesale', '85000000-0000-4000-8000-000000000001', CURRENT_DATE);

  IF (
    SELECT block_reason FROM public.source_list_dialer_phone_review
    WHERE parcel_id = 'P-EXP-PROBATE'
  ) IS DISTINCT FROM 'expired_owner_confirm_pending' THEN
    RAISE EXCEPTION 'expired-tag probate reason was %', (
      SELECT block_reason FROM public.source_list_dialer_phone_review WHERE parcel_id = 'P-EXP-PROBATE'
    );
  END IF;
  IF (
    SELECT block_reason FROM public.source_list_dialer_phone_review
    WHERE parcel_id = 'P-EXP-TAX'
  ) IS DISTINCT FROM 'expired_owner_confirm_pending' THEN
    RAISE EXCEPTION 'expired-tag tax reason was %', (
      SELECT block_reason FROM public.source_list_dialer_phone_review WHERE parcel_id = 'P-EXP-TAX'
    );
  END IF;
  report := public.record_source_list_export_batch_v1(
    'line-check-gates', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000003', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'tomorrow-dated row exported % phones', report->>'phone_count';
  END IF;
END $$;
RESET ROLE;
SELECT 'PASS: line-check migration kept Cass, null county, tax-status, and jit=off' AS result;
SELECT 'PASS: expired-tag probate and tax stay expired_owner_confirm_pending, and a tomorrow row stays out of the batch' AS result;
SQL

explain_ms="$("${PSQL[@]}" -tA <<'SQL'
SET jit = off;
EXPLAIN (ANALYZE, FORMAT JSON)
SELECT count(*)
FROM public.source_list_dialer_export
WHERE source_list_id = '60000000-0000-4000-8000-000000000099';
SQL
)"
python3 - "$explain_ms" <<'PY'
import json, sys
raw = sys.argv[1].strip()
raw = raw[raw.find('['):]
plan = json.loads(raw)
elapsed = float(plan[0]["Execution Time"])
print(f"export view explain analyze {elapsed:.1f} ms")
if elapsed >= 4000:
    raise SystemExit(f"export view EXPLAIN took {elapsed:.1f} ms")
PY

echo "PASS: calling-pool export at or under 7s"
bash "$ROOT/scripts/rehearse-market-check.sh"
echo "PASS: #817 market-check rehearsal including B6 after #825"
