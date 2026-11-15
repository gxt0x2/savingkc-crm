#!/usr/bin/env bash
# Rehearses the market-check migrations on top of the real service-area, tax-status,
# and #814 dialer chain. Does not stub source_list_phone_block_reason_v1.
# Does not touch mojo_call_queue or Atlas.
set -euo pipefail

PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-market-check.XXXXXX)"
PG_PORT="$((58200 + $$ % 300))"
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
  violation_kind text
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
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
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
SQL


"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261114213919_source_list_service_area_block.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261114215029_tax_status_verification.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010826_dialer_export_suppression.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010849_dialer_export_associate_property_dnc.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010855_dialer_export_mojo_raw_and_rehearsal.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115010911_dialer_export_speed_f1_stamp.sql" >/dev/null

"${PSQL[@]}" >/dev/null <<'SQL'
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS property_address text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS dead_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS parcel_id text;
ALTER TABLE public.source_lists
  ADD COLUMN IF NOT EXISTS list_type text,
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS violation_kind text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS source_file_sha256 text,
  ADD COLUMN IF NOT EXISTS source_file_bytes integer,
  ADD COLUMN IF NOT EXISTS imported_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.source_lists ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.source_list_rows
  ADD COLUMN IF NOT EXISTS match_key text,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS loaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS loaded_export_batch_id uuid;
ALTER TABLE public.source_list_rows ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.prospect_phones ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS public.source_list_row_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_row_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  status_reason text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.parcel_inventory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parcel_id text,
  owner_name text,
  created_at timestamptz DEFAULT clock_timestamp(),
  run_id uuid
);
SQL

# Atlas order after the #814 chain: #826, #827, #817, then #830.
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261115012108_code_violation_county_backfill.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261209120000_dialer_owner_line_release.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215120000_property_market_checks.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215130000_market_check_fix_round.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261218120000_dialer_owner_line_person_skip.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205160000_phone_line_checks.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205170000_phone_line_check_review.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261208120000_mojo_dnc_ledger.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261208130000_calling_pool_v1.sql" >/dev/null
echo "PASS: apply #825 after #817"

SEED_JSON=$(node -e '
const fs = require("fs");
const root = process.argv[1];
function table(name) {
  const lines = fs.readFileSync(root + "/" + name, "utf8").replace(/^\uFEFF/, "").trim().split(/\n/);
  const keys = lines[0].split(",");
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(keys.map((key, index) => [key, cells[index]]));
  });
}
const zips = table("data/mls-seeds/target_zips.csv");
const prices = table("data/mls-seeds/min_list_price_by_zip.csv").map((row) => ({
  zip5: row.zip5,
  minListPrice: Number(row.min_list_price),
  method: row.method,
  confidence: row.confidence,
}));
process.stdout.write(JSON.stringify({ zips, prices }));
' "$ROOT")
"${PSQL[@]}" -c "SELECT public.apply_market_seeds_v1(\$seed\$${SEED_JSON}\$seed\$::jsonb);" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $test$
DECLARE
  v_reason text;
  v_plan jsonb;
  v_count integer;
  v_export jsonb;
  v_started timestamptz;
  v_ms numeric;
  v_plan_text text := '';
BEGIN
  IF public.mls_market_check_enabled() OR public.expired_owner_confirmed() THEN
    RAISE EXCEPTION 'flags must stay false';
  END IF;
  IF public.market_status_rank_v1('listing_check_unknown') <= public.market_status_rank_v1('listing_expired') THEN
    RAISE EXCEPTION 'N3 unknown must outrank expired';
  END IF;
  INSERT INTO public.source_list_export_batches (created_by, list_type, phone_count)
  VALUES ('rehearsal', 'mls_expired', 0);
  IF EXISTS (SELECT 1 FROM public.target_zips WHERE county IS DISTINCT FROM 'jackson' OR state IS DISTINCT FROM 'MO') THEN
    RAISE EXCEPTION 'only the Jackson seed file should be loaded';
  END IF;
  IF (SELECT count(*) FROM public.target_zips) <> 42 THEN
    RAISE EXCEPTION 'Jackson seed count drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mls_price_thresholds
    WHERE zip5 = '64134' AND min_list_price = 180000 AND method = 'owner_override' AND confidence = 'high'
  ) THEN
    RAISE EXCEPTION '64134 seed drifted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.target_zips WHERE county = 'cass') THEN
    RAISE EXCEPTION 'Cass must not be seeded';
  END IF;

  INSERT INTO public.source_lists (list_type, county, state, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by)
  VALUES ('mls_expired', 'jackson', 'MO', CURRENT_DATE, 'matrix.csv', repeat('a', 64), 10, 'rehearsal');
  INSERT INTO public.prospects (id, owner_1) VALUES ('00000000-0000-4000-8000-000000000010', 'ADA OWNER');
  INSERT INTO public.prospect_phones (prospect_id, phone, relationship)
  VALUES ('00000000-0000-4000-8000-000000000010', '+18165550100', 'owner');
  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, match_key, address, phones, status, prospect_id, list_day, requires_licensee_disclosure
  )
  SELECT id, 'mls_expired', 'jackson', 'MO', 'addr:10OAK64114', '10 Oak St', ARRAY['+18165550100'], 'new_needs_skip',
    '00000000-0000-4000-8000-000000000010', CURRENT_DATE, true
  FROM public.source_lists LIMIT 1;

  SELECT public.source_list_market_block_reason_v1(
    row.id, NULL, row.address, row.prospect_id, row.list_type, 'prospect_phone', '+18165550100'
  ) INTO v_reason
  FROM public.source_list_rows AS row;
  IF v_reason IS DISTINCT FROM 'expired_owner_confirm_pending' THEN
    RAISE EXCEPTION 'B1 expected expired_owner_confirm_pending, got %', v_reason;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.source_list_dialer_export
  WHERE list_type = 'mls_expired';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B1 expected 0 expired export rows, got %', v_count;
  END IF;

  v_plan := public.apply_market_plan_v1(jsonb_build_object(
    'actor', 'rehearsal',
    'sha256', repeat('b', 64),
    'bytes', 20,
    'fileName', 'matrix.csv',
    'pullDate', CURRENT_DATE,
    'coveredZips', jsonb_build_array('64114'),
    'checks', jsonb_build_array(jsonb_build_object(
      'parcelId', 'P1', 'addrNorm', '10 OAK ST', 'zip5', '64114', 'listDay', CURRENT_DATE,
      'listingStatus', 'listing_expired', 'ownerChanged', false, 'ownerCheckUnknown', false
    )),
    'intakes', jsonb_build_array(jsonb_build_object(
      'matchKey', 'parcel:P1', 'parcelId', 'P1', 'address', '10 Oak St', 'zip5', '64114', 'listDay', CURRENT_DATE
    )),
    'tags', '[]'::jsonb
  ));
  IF (v_plan->>'checks')::integer < 1 THEN
    RAISE EXCEPTION 'B2 plan did not insert checks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mls_export_runs WHERE status = 'loaded') THEN
    RAISE EXCEPTION 'B2 missing export run';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mls_export_runs WHERE complete IS TRUE) THEN
    RAISE EXCEPTION 'N4 a single file part was marked complete';
  END IF;

  PERFORM public.record_mls_market_flag_v1('EXPIRED_OWNER_CONFIRMED', 'true', 'EXC-2026-11-14-003');
  PERFORM public.record_mls_market_flag_v1('MLS_MARKET_CHECK_ENABLED', 'true', 'EXC-2026-11-14-003');
  SELECT public.source_list_market_block_reason_v1(
    row.id, 'P1', '10 Oak St', row.prospect_id, 'mls_expired', 'prospect_phone', '+18165550100'
  ) INTO v_reason
  FROM public.source_list_rows AS row
  WHERE row.match_key = 'addr:10OAK64114';
  IF v_reason IS DISTINCT FROM 'line_check_unknown' THEN
    RAISE EXCEPTION 'B7 expected line_check_unknown, got %', v_reason;
  END IF;

  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, match_key, address, phones, status, prospect_id, list_day, requires_licensee_disclosure
  )
    SELECT id, 'mls_expired', 'jackson', 'MO', 'addr:12OAK64114', '12 Oak St', ARRAY['+18165550199'], 'new_needs_skip',
    NULL, CURRENT_DATE, false
  FROM public.source_lists
  WHERE list_type = 'mls_expired'
  LIMIT 1;
  SELECT public.source_list_market_block_reason_v1(
    row.id, NULL, row.address, row.prospect_id, row.list_type, 'source_row', '+18165550199'
  ) INTO v_reason
  FROM public.source_list_rows AS row
  WHERE row.match_key = 'addr:12OAK64114';
  IF v_reason IS DISTINCT FROM 'owner_match_missing' THEN
    RAISE EXCEPTION 'B10 expected owner_match_missing, got %', v_reason;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export
    WHERE phone_e164 = '+18165550199'
  ) THEN
    RAISE EXCEPTION 'B10 exported a skip-traced phone with no prospect';
  END IF;
  IF position('licensee_disclosure_required' IN pg_get_functiondef('public.record_source_list_export_batch_v1(text,text,text,text,text,uuid,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'B6 disclosure is not enforced on the export function';
  END IF;
  BEGIN
    PERFORM public.record_source_list_export_batch_v1('rehearsal', 'mls_expired', NULL, NULL, NULL, NULL, 2);
    RAISE EXCEPTION 'B6 multi-line expired export was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%expired_single_line_only%' THEN
        RAISE;
      END IF;
  END;

  v_started := clock_timestamp();
  INSERT INTO public.property_market_latest (property_key, parcel_key, addr_norm, zip5, listing_status, list_day, source, owner_changed, owner_check_unknown, checked_at, check_id)
  SELECT 'parcel:P' || g, 'P' || g, g::text || ' MAIN', '64114', 'off_market_ok', CURRENT_DATE, 'heartland_matrix', false, false, clock_timestamp(), gen_random_uuid()
  FROM generate_series(1, 5000) AS g
  ON CONFLICT (property_key) DO NOTHING;
  PERFORM public.source_list_market_block_reason_v1(
    row.id, 'P1', '10 Oak St', row.prospect_id, 'tax_delinquent', 'source_row', '+18165550100'
  )
  FROM public.source_list_rows AS row LIMIT 1;
  v_ms := extract(epoch FROM clock_timestamp() - v_started) * 1000;
  IF v_ms > 60000 THEN
    RAISE EXCEPTION 'B9 export lookup took % ms', v_ms;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_property_market_latest_parcel'
  ) THEN
    RAISE EXCEPTION 'B9 missing parcel index';
  END IF;


  IF public.source_list_phone_block_reason_v1('+18165550141', 'cass', 'cass') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'Cass was not out_of_service_area after the market migrations';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165550140', NULL, NULL) IS DISTINCT FROM 'county_unresolved'
    OR public.source_list_phone_block_reason_v1('+18165550140', '   ', '') IS DISTINCT FROM 'county_unresolved'
    OR public.source_list_phone_block_reason_v1('+18165550140', 'unresolved', 'unresolved') IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'an unresolved county was not county_unresolved after the market migrations';
  END IF;
  IF pg_get_functiondef('public.record_source_list_export_batch_v1(text,text,text,text,text,uuid,integer)'::regprocedure) NOT ILIKE '%jit%off%' THEN
    RAISE EXCEPTION 'jit=off was dropped from the export batch function';
  END IF;
  IF position('tax_status_export_allowed_v1' IN pg_get_viewdef('public.source_list_dialer_export'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'the tax-status export filter was dropped';
  END IF;

  INSERT INTO public.source_lists (list_type, county, state, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by)
  VALUES ('tax_delinquent', 'jackson', 'MO', CURRENT_DATE, 'tax.csv', repeat('c', 64), 10, 'rehearsal');
  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, match_key, parcel_id, address, phones, status
  )
  SELECT id, 'tax_delinquent', 'jackson', 'MO', 'parcel:TAX1', 'TAX1', '77 Tax St', ARRAY['+18165550177'], 'ready'
  FROM public.source_lists WHERE list_type = 'tax_delinquent' LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export WHERE phone_e164 = '+18165550177' OR parcel_id = 'TAX1'
  ) THEN
    RAISE EXCEPTION 'a tax-delinquent row with no recent status check was exported';
  END IF;

  INSERT INTO public.source_lists (list_type, county, state, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by)
  VALUES ('mls_expired', 'wyandotte', 'KS', CURRENT_DATE, 'ks.csv', repeat('d', 64), 10, 'rehearsal');
  INSERT INTO public.prospects (id, owner_1, county, parcel_id) VALUES ('00000000-0000-4000-8000-0000000000aa', 'KAY OWNER', 'wyandotte', 'KS1');
  INSERT INTO public.prospect_phones (prospect_id, phone, relationship)
  VALUES ('00000000-0000-4000-8000-0000000000aa', '+18165550188', 'owner');
  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, match_key, parcel_id, address, phones, status, prospect_id, list_day, requires_licensee_disclosure
  )
  SELECT id, 'mls_expired', 'wyandotte', 'KS', 'parcel:KS1', 'KS1', '88 State St', ARRAY['+18165550188'], 'new_needs_skip',
    '00000000-0000-4000-8000-0000000000aa', CURRENT_DATE, true
  FROM public.source_lists WHERE county = 'wyandotte' LIMIT 1;
  SELECT public.source_list_market_block_reason_v1(
    row.id, 'KS1', row.address, row.prospect_id, row.list_type, 'prospect_phone', '+18165550188'
  ) INTO v_reason
  FROM public.source_list_rows AS row
  WHERE row.match_key = 'parcel:KS1';
  IF v_reason IS DISTINCT FROM 'ks_license_unconfirmed' THEN
    RAISE EXCEPTION 'KS expired row was not ks_license_unconfirmed, got %', v_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_list_dialer_export WHERE phone_e164 = '+18165550188' OR parcel_id = 'KS1') THEN
    RAISE EXCEPTION 'a Kansas expired row was exported';
  END IF;
  IF public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED') THEN
    RAISE EXCEPTION 'KS_EXPIRED_RELEASE_APPROVED must stay false';
  END IF;

  v_plan := public.apply_market_plan_v1(jsonb_build_object(
    'actor', 'rehearsal',
    'sha256', repeat('e', 64),
    'bytes', 20,
    'fileName', 'matrix.csv',
    'pullDate', CURRENT_DATE,
    'complete', true,
    'parts', jsonb_build_array('expired'),
    'partCounts', jsonb_build_object('expired', 1, 'sold', 0),
    'doneMarker', to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    'checks', '[]'::jsonb,
    'intakes', jsonb_build_array(
      jsonb_build_object('matchKey', 'parcel:BAD', 'parcelId', 'BAD', 'address', '1 Nowhere', 'zip5', '00000', 'county', 'cass'),
      jsonb_build_object('matchKey', 'parcel:GOOD1', 'parcelId', 'GOOD1', 'address', '12 Oak St', 'zip5', '64114')
    )
  ));
  IF coalesce((v_plan->>'complete')::boolean, false) THEN
    RAISE EXCEPTION 'a client complete flag was trusted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mls_export_runs WHERE export_file_sha256 = repeat('e', 64)) THEN
    RAISE EXCEPTION 'a bad intake aborted the run record';
  END IF;

  INSERT INTO public.target_zips (zip5, county, state, status)
  VALUES ('66202', 'johnson', 'KS', 'keep')
  ON CONFLICT (zip5) DO UPDATE SET county = EXCLUDED.county, state = EXCLUDED.state, status = EXCLUDED.status;
  v_plan := public.apply_market_plan_v1(jsonb_build_object(
    'actor', 'rehearsal',
    'sha256', repeat('f', 64),
    'bytes', 40,
    'fileName', 'matrix.csv',
    'pullDate', CURRENT_DATE,
    'complete', true,
    'checks', '[]'::jsonb,
    'intakes', jsonb_build_array(
      jsonb_build_object('matchKey', 'parcel:KSROW', 'parcelId', 'KSROW', 'address', '9 Kansas Ave', 'zip5', '66202', 'county', 'jackson', 'state', 'MO'),
      jsonb_build_object('matchKey', 'parcel:BADROW', 'parcelId', 'BADROW', 'address', '1 Nowhere', 'zip5', '00000', 'county', 'jackson', 'state', 'MO')
    )
  ));
  IF NOT EXISTS (SELECT 1 FROM public.mls_export_runs WHERE export_file_sha256 = repeat('f', 64)) THEN
    RAISE EXCEPTION 'a Kansas intake aborted the load';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.source_list_rows
    WHERE match_key = 'parcel:KSROW' AND county = 'johnson' AND state = 'KS'
  ) THEN
    RAISE EXCEPTION 'Kansas expired row was stored as jackson/MO or dropped';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_dialer_export WHERE parcel_id = 'KSROW'
  ) THEN
    RAISE EXCEPTION 'a Kansas expired row was exported';
  END IF;

  UPDATE public.mls_market_config SET value = 'false', updated_at = clock_timestamp()
  WHERE key IN ('MLS_MARKET_CHECK_ENABLED', 'EXPIRED_OWNER_CONFIRMED', 'KS_EXPIRED_RELEASE_APPROVED');
  INSERT INTO public.source_lists (list_type, county, state, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by)
  VALUES ('tax_delinquent', 'jackson', 'MO', CURRENT_DATE, 'one.csv', repeat('1', 64), 10, 'rehearsal');
  INSERT INTO public.prospects (id, owner_1, county) VALUES ('00000000-0000-4000-8000-0000000000b1', 'ONE OWNER', 'jackson');
  INSERT INTO public.prospect_phones (prospect_id, phone, relationship)
  VALUES ('00000000-0000-4000-8000-0000000000b1', '+18165551001', 'owner');
  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, match_key, parcel_id, address, phones, status, prospect_id
  )
  SELECT id, 'tax_delinquent', 'jackson', 'MO', 'parcel:ONE1', 'ONE1', '1 Oak St', ARRAY['+18165551001'], 'ready',
    '00000000-0000-4000-8000-0000000000b1'
  FROM public.source_lists WHERE source_file_sha256 = repeat('1', 64);
  INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
  VALUES ('ONE1', 'jackson', 'tax_delinquent', '00000000-0000-4000-8000-0000000000b1', now(), 'jackson_tax_portal', 'delinquent', 0);
  PERFORM set_config('dialer.pool_now', '2026-11-14 16:00:00+00', true);
  v_export := public.record_source_list_export_batch_v1(
    'rehearsal', 'tax_delinquent', 'jackson', 'MO', NULL,
    (SELECT id FROM public.source_lists WHERE source_file_sha256 = repeat('1', 64)),
    1
  );
  IF v_export->>'phone_count' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'gate case expected 1 phone, got %', v_export->>'phone_count';
  END IF;

  INSERT INTO public.source_lists (list_type, county, state, violation_kind, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by)
  VALUES ('code_violation', 'johnson', 'KS', 'nuisance', CURRENT_DATE, 'ks-code.csv', repeat('9', 64), 10, 'rehearsal');
  INSERT INTO public.source_list_rows (
    source_list_id, list_type, county, state, violation_kind, match_key, parcel_id, address, phones, status
  )
  SELECT id, 'code_violation', 'johnson', 'KS', 'nuisance', 'parcel:KSCODE', 'KSCODE', '1 Kansas Ave', ARRAY['+19135550101'], 'out_of_area'
  FROM public.source_lists WHERE source_file_sha256 = repeat('9', 64);
  PERFORM public.set_source_list_row_status_v1(
    (SELECT id FROM public.source_list_rows WHERE match_key = 'parcel:KSCODE'),
    'out_of_area', NULL, 'rehearsal'
  );
  PERFORM public.set_source_list_row_status_v1(
    (SELECT id FROM public.source_list_rows WHERE match_key = 'parcel:KSCODE'),
    'new_needs_skip', NULL, 'rehearsal'
  );

  RAISE NOTICE 'market check rehearsal passed in % ms', v_ms;
END
$test$;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205160000_phone_line_checks.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261205170000_phone_line_check_review.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $n2$
DECLARE
  v_def text;
  v_has_flag boolean;
BEGIN
  v_has_flag := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'source_list_dialer_phone_review'
      AND column_name = 'line_check_flag'
  );
  v_def := regexp_replace(pg_get_viewdef('public.source_list_dialer_phone_review'::regclass, true), ';[[:space:]]*$', '');
  DROP VIEW public.source_list_market_phone_review;
  DROP VIEW public.source_list_dialer_export;
  DROP VIEW public.source_list_dialer_suppressed;
  DROP VIEW public.source_list_dialer_phone_review;
  IF v_has_flag THEN
    EXECUTE 'CREATE VIEW public.source_list_dialer_phone_review AS ' || v_def;
  ELSE
    EXECUTE 'CREATE VIEW public.source_list_dialer_phone_review AS SELECT dialed.*, NULL::text AS line_check_flag FROM (' || v_def || ') AS dialed';
  END IF;
  CREATE VIEW public.source_list_dialer_export AS
  SELECT source_list_row_id, source_list_id, list_type, county, state, violation_kind,
    parcel_id, case_id, address, owner_names, amount_owed, property_id, prospect_id,
    row_status, phone_e164, phone_origin, pull_date, source_file_name, line_check_flag
  FROM public.source_list_dialer_phone_review
  WHERE block_reason IS NULL;
  CREATE VIEW public.source_list_dialer_suppressed AS
  SELECT source_list_row_id, block_reason, line_check_flag
  FROM public.source_list_dialer_phone_review
  WHERE block_reason IS NOT NULL;
  PERFORM public.rebuild_market_review_v1();
  PERFORM public.rebuild_market_export_views_v1();
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_list_dialer_phone_review' AND column_name = 'line_check_flag'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_list_dialer_export' AND column_name = 'line_check_flag'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'source_list_dialer_suppressed' AND column_name = 'line_check_flag'
  ) THEN
    RAISE EXCEPTION 'N2 dropped line_check_flag';
  END IF;
END
$n2$;
SQL

echo "market check rehearsal passed"
