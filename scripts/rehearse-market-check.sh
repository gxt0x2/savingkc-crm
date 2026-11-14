#!/usr/bin/env bash
# Rehearses the market-check migrations on a throwaway Postgres.
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

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE FUNCTION public.normalize_conversation_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR p = '' THEN NULL ELSE p END $$;
CREATE FUNCTION public.prospecting_phone_key_v1(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10) $$;
CREATE FUNCTION public.dialer_label_key_v1(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(lower(btrim(coalesce(p, ''))), '') $$;
CREATE FUNCTION public.dialer_suppression_class_v1(p_source text, p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'allow' $$;
CREATE FUNCTION public.dialer_phone_mask_v1(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '******0000' $$;
CREATE FUNCTION public.dialer_multi_line_suspended_v1() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.source_list_phone_block_reason_v1(p_phone text, p_prospect_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.source_list_phones_valid_v1(p_phones text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id text, property_address text, zip text, dead_reason text, call_result text,
  dead_at timestamptz, updated_at timestamptz, phone text
);
CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcel_id text, owner_1 text
);
CREATE TABLE public.prospect_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prospect_id uuid, phone text,
  relationship text, last_disposition text, phone_connected text, voice_hold boolean
);
CREATE TABLE public.sms_opt_outs (phone text, is_opted_out boolean);
CREATE TABLE public.crm_contact_methods (method_type text, normalized_value text, sms_consent_status text, deliverability_status text);
CREATE TABLE public.crm_mojo_call_events (outcome text, normalized_phone text, disposition_raw text);
CREATE TABLE public.crm_mojo_calls (result_label text);
CREATE TABLE public.parcel_inventory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parcel_id text, owner_name text, created_at timestamptz DEFAULT clock_timestamp(), run_id uuid
);
CREATE TABLE public.source_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type text NOT NULL, county text, state text, violation_kind text,
  pull_date date NOT NULL, source_url text, notes text,
  source_file_name text NOT NULL, source_file_sha256 text NOT NULL,
  source_file_bytes integer NOT NULL, imported_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.source_list_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_id uuid NOT NULL REFERENCES public.source_lists(id),
  list_type text NOT NULL, county text, state text, violation_kind text,
  match_key text NOT NULL, parcel_id text, case_id text, address text, owner_names text,
  amount_owed numeric, phones text[] NOT NULL DEFAULT '{}', raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  property_id uuid, prospect_id uuid, status text NOT NULL DEFAULT 'new',
  status_reason text, updated_by text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), status_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX source_list_rows_natural_key ON public.source_list_rows (list_type, match_key);
CREATE TABLE public.source_list_row_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_row_id uuid NOT NULL REFERENCES public.source_list_rows(id),
  from_status text, to_status text NOT NULL, status_reason text, changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_list_row_status_history_from_check CHECK (from_status IS NULL OR from_status IN ('new', 'ready')),
  CONSTRAINT source_list_row_status_history_to_check CHECK (to_status IN ('new', 'ready'))
);
CREATE FUNCTION public.source_list_row_status_history_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.source_list_row_status_history (source_list_row_id, from_status, to_status, changed_by)
  VALUES (NEW.id, NULL, NEW.status, NEW.updated_by);
  RETURN NEW;
END $$;
CREATE TRIGGER source_list_row_status_history
  AFTER INSERT ON public.source_list_rows
  FOR EACH ROW EXECUTE FUNCTION public.source_list_row_status_history_v1();
CREATE TABLE public.source_list_export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text NOT NULL, list_type text, county text, state text, violation_kind text,
  source_list_id uuid, phone_count integer NOT NULL
);
CREATE TABLE public.source_list_export_batch_phones (
  export_batch_id uuid NOT NULL, source_list_row_id uuid NOT NULL, phone_e164 text NOT NULL
);
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215120000_property_market_checks.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261215130000_market_check_fix_round.sql" >/dev/null

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
  WHERE list_type = 'mls_expired' OR basis = 'owner_override_2026-11-14';
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

  RAISE NOTICE 'market check rehearsal passed in % ms', v_ms;
END
$test$;
SQL

echo "market check rehearsal passed"
