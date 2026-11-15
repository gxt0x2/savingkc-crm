-- Calling pool v1 checks on the suppression rehearsal database.
-- Does not touch Atlas or mojo_call_queue.
\set ON_ERROR_STOP on
SET ROLE service_role;
SET jit = off;

INSERT INTO public.source_lists (id, pull_date, source_file_name) VALUES
  ('81000000-0000-4000-8000-000000000101', DATE '2026-11-14', 'clay-fresh.csv'),
  ('81000000-0000-4000-8000-000000000102', DATE '2026-01-01', 'clay-old.csv'),
  ('81000000-0000-4000-8000-000000000201', DATE '2026-11-14', 'platte.csv'),
  ('81000000-0000-4000-8000-000000000301', DATE '2026-11-14', 'wyandotte.csv'),
  ('81000000-0000-4000-8000-000000000401', DATE '2026-11-14', 'johnson.csv');

INSERT INTO public.prospects (
  id, county, situs_street, situs_zip, parcel_id, owner_1, owner_1_last, owner_1_type,
  delinquent_years_category, occupancy_status
) VALUES
  ('81000000-0000-4000-8000-000000000001', 'clay', '1 Tier', '64116', 'CLAY-T1', 'Ada Tier', 'Tier', 'Individual', '3yr_plus', 'vacant'),
  ('81000000-0000-4000-8000-000000000002', 'clay', '2 Mid', '64118', 'CLAY-T2', 'Bea Mid', 'Mid', 'Individual', NULL, 'vacant'),
  ('81000000-0000-4000-8000-000000000003', 'clay', '3 Clean', '64119', 'CLAY-CLEAN', 'Cara Clean', 'Clean', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-000000000004', 'clay', '4 Unknown', '64119', 'CLAY-UNK', 'Dee Unknown', 'Unknown', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000a1', 'platte', '10 Lock A', '64079', 'PLT-A', 'Eve Lock', 'Lock', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000a2', 'platte', '11 Lock B', '64079', 'PLT-B', 'Fay Hold', 'Hold', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000a3', 'platte', '12 Lock C', '64079', 'PLT-C', 'Gia Add', 'Add', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000a4', 'platte', '13 Lock D', '64079', 'PLT-D', 'Hana Late', 'Late', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000b1', 'wyandotte', '20 Audit', '66101', 'WY-AUDIT', 'Ivy Audit', 'Audit', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000c1', 'johnson', '21 Once', '66202', 'JO-ONCE', 'Jen Once', 'Once', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000d1', 'jackson', '22 Pending', '64105', 'JA-PEND', 'Kay Pend', 'Pend', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000e1', 'cass', '23 Cass', '64701', 'CASS-1', 'Lila Cass', 'Cass', 'Individual', NULL, NULL),
  ('81000000-0000-4000-8000-0000000000f1', 'jackson', '24 Encode', '64106', 'JA-ENC', 'Mia Encode', 'Encode', 'Individual', NULL, NULL);

INSERT INTO public.mortgage_foreclosure_prospects (id, prospect_id, absentee_owner) VALUES
  ('81100000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', true),
  ('81100000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', true);

INSERT INTO public.prospect_phones (id, prospect_id, phone, last_disposition, relationship) VALUES
  ('81200000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '+18165552101', NULL, 'owner'),
  ('81200000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '+18165552102', NULL, 'owner'),
  ('81200000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', '+18165552103', NULL, 'owner'),
  ('81200000-0000-4000-8000-000000000009', '81000000-0000-4000-8000-000000000003', '+18165552109', NULL, 'owner'),
  ('81200000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', '+19995550199', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000a1', '81000000-0000-4000-8000-0000000000a1', '+18165552201', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000a2', '81000000-0000-4000-8000-0000000000a2', '+18165552202', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000a3', '81000000-0000-4000-8000-0000000000a3', '+18165552203', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000a4', '81000000-0000-4000-8000-0000000000a4', '+18165552204', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000b1', '81000000-0000-4000-8000-0000000000b1', '+18165552301', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000c1', '81000000-0000-4000-8000-0000000000c1', '+18165552401', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000d1', '81000000-0000-4000-8000-0000000000d1', '+18165552501', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000e1', '81000000-0000-4000-8000-0000000000e1', '+18165552601', NULL, 'owner'),
  ('81200000-0000-4000-8000-0000000000f1', '81000000-0000-4000-8000-0000000000f1', '+18165552701', NULL, 'owner');

INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, owner_names, amount_owed, prospect_id, status, phones
) VALUES
  ('81300000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000101', 'tax_delinquent', 'clay', 'MO', 'CLAY-T1', '1 Tier', 'Tier', 300, '81000000-0000-4000-8000-000000000001', 'ready', ARRAY['+18165552101']),
  ('81300000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000102', 'tax_delinquent', 'clay', 'MO', 'CLAY-T2', '2 Mid', 'Mid', 200, '81000000-0000-4000-8000-000000000002', 'ready', ARRAY['+18165552102']),
  ('81300000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000102', 'tax_delinquent', 'clay', 'MO', 'CLAY-CLEAN', '3 Clean', 'Clean', 100, '81000000-0000-4000-8000-000000000003', 'ready', ARRAY['+18165552103', '+18165552109']),
  ('81300000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000102', 'tax_delinquent', 'clay', 'MO', 'CLAY-UNK', '4 Unknown', 'Unknown', 50, '81000000-0000-4000-8000-000000000004', 'ready', ARRAY['+19995550199']),
  ('81300000-0000-4000-8000-0000000000a1', '81000000-0000-4000-8000-000000000201', 'tax_delinquent', 'platte', 'MO', 'PLT-A', '10 Lock A', 'Lock', 10, '81000000-0000-4000-8000-0000000000a1', 'ready', ARRAY['+18165552201']),
  ('81300000-0000-4000-8000-0000000000a2', '81000000-0000-4000-8000-000000000201', 'tax_delinquent', 'platte', 'MO', 'PLT-B', '11 Lock B', 'Hold', 10, '81000000-0000-4000-8000-0000000000a2', 'ready', ARRAY['+18165552202']),
  ('81300000-0000-4000-8000-0000000000b1', '81000000-0000-4000-8000-000000000301', 'tax_delinquent', 'wyandotte', 'KS', 'WY-AUDIT', '20 Audit', 'Audit', 10, '81000000-0000-4000-8000-0000000000b1', 'ready', ARRAY['+18165552301']),
  ('81300000-0000-4000-8000-0000000000c1', '81000000-0000-4000-8000-000000000401', 'tax_delinquent', 'johnson', 'KS', 'JO-ONCE', '21 Once', 'Once', 10, '81000000-0000-4000-8000-0000000000c1', 'ready', ARRAY['+18165552401']);

INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost)
SELECT prospect.parcel_id, prospect.county, 'tax_delinquent', prospect.id, now(),
  CASE prospect.county
    WHEN 'clay' THEN 'clay_collector'
    WHEN 'platte' THEN 'platte_collector'
    WHEN 'johnson' THEN 'johnson_taxbill'
    WHEN 'wyandotte' THEN 'wyandotte_tax'
    ELSE 'jackson_tax_portal'
  END,
  'delinquent',
  0
FROM public.prospects AS prospect
WHERE prospect.id IN (
  '81000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-0000000000a1',
  '81000000-0000-4000-8000-0000000000a2',
  '81000000-0000-4000-8000-0000000000a3',
  '81000000-0000-4000-8000-0000000000a4',
  '81000000-0000-4000-8000-0000000000b1',
  '81000000-0000-4000-8000-0000000000c1'
);

-- Friday 10:00pm and 10:30pm CT are outside 9am-8pm. The Johnson call is Wednesday night.
INSERT INTO public.crm_mojo_call_events (record_id, normalized_phone, outcome, disposition_raw, call_at, sender_line, consent_basis, optout_verbatim) VALUES
  ('pool-audit-1', '+18165552301', 'no_answer', 'No Answer', '2026-11-14 04:00:00+00', '+18165550000', 'policy_8_29', NULL),
  ('pool-audit-2', '+18165552301', 'no_answer', 'No Answer', '2026-11-14 04:30:00+00', '+18165550000', 'policy_8_29', NULL),
  ('pool-once-1', '+18165552401', 'no_answer', 'No Answer', '2026-11-12 04:00:00+00', '+18165550000', 'policy_8_29', NULL);

DO $$
DECLARE
  pool_row record;
  report jsonb;
  order_text text;
  saved jsonb;
  ledger_id uuid;
BEGIN
  PERFORM set_config('dialer.pool_now', '2026-11-14 15:00:00+00', true);

  SELECT pool.pool_status, pool.owner_status, pool.tier, pool.signal_count, pool.block_reason, pool.household_key, pool.intake_date
  INTO pool_row
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165552103'
    AND pool.prospect_id = '81000000-0000-4000-8000-000000000003';
  IF pool_row.pool_status IS DISTINCT FROM 'eligible'
    OR pool_row.owner_status IS DISTINCT FROM 'owner'
    OR pool_row.tier IS DISTINCT FROM 'single'
    OR pool_row.block_reason IS NOT NULL
    OR pool_row.household_key IS NULL THEN
    RAISE EXCEPTION 'clean clay owner was not eligible: %', to_jsonb(pool_row);
  END IF;

  SELECT pool.tier, pool.signal_count, pool.pool_status
  INTO pool_row
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165552101'
    AND pool.prospect_id = '81000000-0000-4000-8000-000000000001';
  IF pool_row.tier IS DISTINCT FROM 'tier1' OR pool_row.signal_count < 3 OR pool_row.pool_status IS DISTINCT FROM 'eligible' THEN
    RAISE EXCEPTION 'tax 3yr + vacant + absentee was not tier 1: %', to_jsonb(pool_row);
  END IF;

  SELECT pool.pool_status, pool.block_reason
  INTO pool_row
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.prospect_id = '81000000-0000-4000-8000-0000000000e1';
  IF pool_row.pool_status IS DISTINCT FROM 'blocked' OR pool_row.block_reason IS DISTINCT FROM 'county_unresolved' THEN
    RAISE EXCEPTION 'outside-area phone was not blocked: %', to_jsonb(pool_row);
  END IF;
  IF (SELECT county FROM public.prospects WHERE id = '81000000-0000-4000-8000-0000000000e1') IS DISTINCT FROM 'unresolved' THEN
    RAISE EXCEPTION 'cass was stored as a callable county';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165552901', 'cass', 'cass') IS DISTINCT FROM 'out_of_service_area' THEN
    RAISE EXCEPTION 'a cass county argument was not out of the service area';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-11-14 18:00:00+00', true);
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'clay', NULL, NULL, NULL, 1);
  SELECT string_agg(item->>'phone_e164', ',' ORDER BY ordinality)
  INTO order_text
  FROM jsonb_array_elements(report->'rows') WITH ORDINALITY AS rows(item, ordinality);
  IF order_text IS DISTINCT FROM '+18165552101,+18165552102,+18165552103,+19995550199' THEN
    RAISE EXCEPTION 'export order %', order_text;
  END IF;
  IF (report->'rows')::text LIKE '%+18165552109%' THEN
    RAISE EXCEPTION 'per-person cap kept a second single-factor phone';
  END IF;
  IF coalesce((report->'excluded_counts'->>'daily_phone_cap')::integer, 0) < 1 THEN
    RAISE EXCEPTION 'daily phone cap was not counted: %', report->'excluded_counts';
  END IF;
  IF (report->'rows'->0->>'tz_window') IS DISTINCT FROM 'America/Chicago'
    OR (report->'rows'->3->>'tz_window') IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'time zone segments % / %', report->'rows'->0->>'tz_window', report->'rows'->3->>'tz_window';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.source_list_rows
    WHERE prospect_id = '81000000-0000-4000-8000-000000000003'
      AND status IS DISTINCT FROM 'ready'
  ) THEN
    RAISE EXCEPTION 'a pool row auto-loaded into the dialer';
  END IF;

  -- 2:00am and 3:30am CT are outside the calling window, so the dial file is empty,
  -- but the batch still keeps the scrubbed phones for the 4:00am lock.
  PERFORM set_config('dialer.pool_now', '2026-11-14 08:00:00+00', true);
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'platte', NULL, NULL, NULL, 1);
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'pre-window export returned % phones', report->>'phone_count';
  END IF;
  IF (
    SELECT count(*) FROM public.source_list_export_batch_phones
    WHERE export_batch_id = (report->>'export_batch_id')::uuid
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '2:00am lock batch did not keep the scrubbed phones';
  END IF;

  INSERT INTO public.source_list_rows (
    id, source_list_id, list_type, county, state, parcel_id, address, owner_names, amount_owed, prospect_id, status, phones
  ) VALUES (
    '81300000-0000-4000-8000-0000000000a3', '81000000-0000-4000-8000-000000000201', 'tax_delinquent', 'platte', 'MO', 'PLT-C', '12 Lock C', 'Add', 10, '81000000-0000-4000-8000-0000000000a3', 'ready', ARRAY['+18165552203']
  );
  PERFORM set_config('dialer.pool_now', '2026-11-14 09:30:00+00', true);
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'platte', NULL, NULL, NULL, 1);
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION '3:30am dial file was not empty';
  END IF;
  IF (
    SELECT count(*) FROM public.source_list_export_batch_phones
    WHERE export_batch_id = (report->>'export_batch_id')::uuid
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '3:30am lock batch did not add the new phone';
  END IF;

  UPDATE public.prospect_phones
  SET last_disposition = 'dnc'
  WHERE phone = '+18165552202';
  INSERT INTO public.source_list_rows (
    id, source_list_id, list_type, county, state, parcel_id, address, owner_names, amount_owed, prospect_id, status, phones
  ) VALUES (
    '81300000-0000-4000-8000-0000000000a4', '81000000-0000-4000-8000-000000000201', 'tax_delinquent', 'platte', 'MO', 'PLT-D', '13 Lock D', 'Late', 10, '81000000-0000-4000-8000-0000000000a4', 'ready', ARRAY['+18165552204']
  );
  PERFORM set_config('dialer.pool_now', '2026-11-14 16:00:00+00', true);
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'platte', NULL, NULL, NULL, 1);
  IF (report->'rows')::text LIKE '%+18165552202%' OR (report->'rows')::text LIKE '%+18165552204%' THEN
    RAISE EXCEPTION 'post-lock export added or kept a suppressed phone: %', report->'rows';
  END IF;
  IF (report->'rows')::text NOT LIKE '%+18165552201%' OR (report->'rows')::text NOT LIKE '%+18165552203%' THEN
    RAISE EXCEPTION 'post-lock export dropped a locked clear phone: %', report->'rows';
  END IF;
  IF coalesce((report->'excluded_counts'->>'list_locked')::integer, 0) < 1 THEN
    RAISE EXCEPTION 'list_locked was not counted: %', report->'excluded_counts';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-11-14 15:00:00+00', true);
  IF (
    SELECT count(*)
    FROM public.dialer_pool_morning_audit_v1
    WHERE source_list_id = '81000000-0000-4000-8000-000000000301'
      AND finding_code = 'outside_tz_window'
  ) < 2 THEN
    RAISE EXCEPTION 'yesterday audit did not return two hour findings';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dialer_audit_blocked_lists_v1()
    WHERE source_list_id = '81000000-0000-4000-8000-000000000301'
  ) THEN
    RAISE EXCEPTION 'two findings did not block the list';
  END IF;
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'wyandotte', NULL, NULL, NULL, 1);
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'blocked list still exported %', report->>'phone_count';
  END IF;
  report := public.record_source_list_export_batch_v1('pool-rehearsal', 'tax_delinquent', 'johnson', NULL, NULL, NULL, 1);
  IF report->>'phone_count' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'one finding blocked a list: %', report->>'phone_count';
  END IF;

  INSERT INTO public.source_lists (id, pull_date, source_file_name) VALUES
    ('81000000-0000-4000-8000-000000000501', DATE '2026-11-14', 'window.csv'),
    ('81000000-0000-4000-8000-000000000601', DATE '2026-11-14', 'expired.csv');
  INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1, owner_1_last, owner_1_type) VALUES
    ('81000000-0000-4000-8000-000000000501', 'clay', '30 Window', 'WIN-1', 'Ned Window', 'Window', 'Individual'),
    ('81000000-0000-4000-8000-000000000502', 'clay', '31 Ported', 'WIN-2', 'Ora Ported', 'Ported', 'Individual');
  INSERT INTO public.prospect_phones (id, prospect_id, phone, relationship) VALUES
    ('81200000-0000-4000-8000-000000000501', '81000000-0000-4000-8000-000000000501', '+18165553001', 'owner'),
    ('81200000-0000-4000-8000-000000000502', '81000000-0000-4000-8000-000000000502', '+19995553002', 'owner');
  INSERT INTO public.source_list_rows (
    id, source_list_id, list_type, county, state, parcel_id, address, owner_names, prospect_id, status, phones
  ) VALUES
    ('81300000-0000-4000-8000-000000000501', '81000000-0000-4000-8000-000000000501', 'foreclosure', 'clay', 'MO', 'WIN-1', '30 Window', 'Window', '81000000-0000-4000-8000-000000000501', 'ready', ARRAY['+18165553001']),
    ('81300000-0000-4000-8000-000000000502', '81000000-0000-4000-8000-000000000501', 'foreclosure', 'clay', 'MO', 'WIN-2', '31 Ported', 'Ported', '81000000-0000-4000-8000-000000000502', 'ready', ARRAY['+19995553002']),
    ('81300000-0000-4000-8000-000000000601', '81000000-0000-4000-8000-000000000601', 'mls_expired', 'clay', 'MO', 'MLS-1', '32 Expired', 'Expired', NULL, 'ready', ARRAY['+18165553901']);

  PERFORM set_config('dialer.pool_now', '2026-11-14 15:30:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000501', 1
  );
  IF (report->'rows')::text NOT LIKE '%+18165553001%' OR (report->'rows')::text LIKE '%+19995553002%' THEN
    RAISE EXCEPTION '9:30am CT kept an unknown area code or dropped a local phone: %', report->'rows';
  END IF;
  IF coalesce((report->'excluded_counts'->>'outside_tz_window')::integer, 0) < 1 THEN
    RAISE EXCEPTION 'outside window was not counted: %', report->'excluded_counts';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-11-14 18:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000501', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'noon CT did not export both window phones: %', report->>'phone_count';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-11-15 16:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000501', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Sunday 10am CT exported % phones', report->>'phone_count';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-11-15 20:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000501', 1
  );
  IF (report->'rows')::text NOT LIKE '%+18165553001%' OR (report->'rows')::text NOT LIKE '%+19995553002%' THEN
    RAISE EXCEPTION 'Sunday 2pm CT dropped an open window: %', report->'rows';
  END IF;

  PERFORM set_config('dialer.pool_now', '2026-07-04 18:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000501', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'July 4 exported % phones', report->>'phone_count';
  END IF;

  RESET ROLE;
  ALTER TABLE public.source_list_rows
    ADD COLUMN IF NOT EXISTS status_reason text,
    ADD COLUMN IF NOT EXISTS updated_by text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS loaded_at timestamptz,
    ADD COLUMN IF NOT EXISTS loaded_export_batch_id uuid,
    ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
  SET ROLE service_role;
  PERFORM set_config('dialer.pool_now', '2026-11-15 16:00:00+00', true);
  BEGIN
    PERFORM public.set_source_list_row_status_v1(
      '81300000-0000-4000-8000-000000000501',
      'loaded_to_dialer',
      NULL,
      'pool-rehearsal',
      (report->>'export_batch_id')::uuid
    );
    RAISE EXCEPTION 'Sunday 10am load was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%outside_tz_window%' THEN
        RAISE;
      END IF;
  END;
  PERFORM set_config('dialer.pool_now', '2026-11-15 20:00:00+00', true);
  UPDATE public.prospect_phones SET last_disposition = 'dnc' WHERE phone = '+18165553001';
  BEGIN
    PERFORM public.set_source_list_row_status_v1(
      '81300000-0000-4000-8000-000000000501',
      'loaded_to_dialer',
      NULL,
      'pool-rehearsal',
      (
        SELECT id FROM public.source_list_export_batches
        WHERE source_list_id = '81000000-0000-4000-8000-000000000501'
          AND phone_count = 2
        ORDER BY created_at DESC
        LIMIT 1
      )
    );
    RAISE EXCEPTION 'a blocked phone was loaded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%phone_blocked%' THEN
        RAISE;
      END IF;
  END;
  UPDATE public.prospect_phones SET last_disposition = NULL WHERE phone = '+18165553001';
  PERFORM public.set_source_list_row_status_v1(
    '81300000-0000-4000-8000-000000000501',
    'loaded_to_dialer',
    NULL,
    'pool-rehearsal',
    (
      SELECT id FROM public.source_list_export_batches
      WHERE source_list_id = '81000000-0000-4000-8000-000000000501'
        AND phone_count = 2
      ORDER BY created_at DESC
      LIMIT 1
    )
  );

  UPDATE public.system_config SET value = 'false'::jsonb WHERE key = 'dialer_multi_line_suspended';
  BEGIN
    PERFORM public.record_source_list_export_batch_v1('pool-rehearsal', NULL, NULL, NULL, NULL, NULL, 2);
    RAISE EXCEPTION 'line mode 2 was accepted while the flag was false';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%multi_line_suspended%' THEN
        RAISE;
      END IF;
  END;
  UPDATE public.system_config SET value = 'true'::jsonb WHERE key = 'dialer_multi_line_suspended';

  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', NULL, NULL, NULL, NULL, '81000000-0000-4000-8000-000000000601', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' OR (report->'rows')::text LIKE '%mls_expired%' THEN
    RAISE EXCEPTION 'expired lane leaked into the export';
  END IF;
  PERFORM public.set_source_list_row_status_v1(
    '81300000-0000-4000-8000-000000000502',
    'out_of_area',
    'outside the service area',
    'pool-rehearsal',
    NULL
  );
  IF (
    SELECT status FROM public.source_list_rows WHERE id = '81300000-0000-4000-8000-000000000502'
  ) IS DISTINCT FROM 'out_of_area' THEN
    RAISE EXCEPTION 'out_of_area status was rejected';
  END IF;
  PERFORM public.record_source_list_export_batch_v1(
    'pool-rehearsal', 'code_violation', 'johnson', 'KS', 'open_to_entry', NULL, 1
  );
  PERFORM public.record_source_list_export_batch_v1(
    'pool-rehearsal', 'code_violation', 'wyandotte', 'KS', 'nuisance', NULL, 1
  );

  PERFORM public.record_source_list_export_batch_v1('pool-rehearsal', 'mls_expired', NULL, NULL, NULL, NULL, 1);
  PERFORM public.set_source_list_row_status_v1(
    '81300000-0000-4000-8000-000000000601',
    'new_needs_skip',
    NULL,
    'pool-rehearsal',
    NULL
  );
  IF EXISTS (
    SELECT 1
    FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = '+18165553901'
      AND pool.pool_status IN ('eligible', 'eligible_pending_scrub')
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = '+18165553901'
      AND pool.pool_status = 'held'
  ) THEN
    RAISE EXCEPTION 'an expired-only phone was dropped or stayed eligible';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.dialer_pool_v1 AS pool
    WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub')
      AND pool.block_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a suppressed phone is eligible in the calling pool';
  END IF;

  SELECT value INTO saved FROM public.system_config WHERE key = 'dialer_pool_caps_v1';
  UPDATE public.system_config
  SET value = jsonb_set(
    jsonb_set(value, '{tiers,single,attempt_cap_cycle}', '1'::jsonb),
    '{tiers,single,cooldown_days}',
    '[1]'::jsonb
  )
  WHERE key = 'dialer_pool_caps_v1';
  INSERT INTO public.crm_mojo_call_events (record_id, normalized_phone, outcome, disposition_raw, call_at) VALUES
    ('pool-pending-1', '+18165552501', 'no_answer', 'No Answer', '2026-11-01 18:00:00+00');
  SELECT pool.pool_status, pool.cap_hits, pool.next_eligible_at
  INTO pool_row
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165552501'
    AND pool.prospect_id = '81000000-0000-4000-8000-0000000000d1';
  IF pool_row.pool_status IS DISTINCT FROM 'eligible_pending_scrub' OR coalesce(pool_row.cap_hits, 0) < 1 THEN
    RAISE EXCEPTION 'elapsed cap did not become eligible_pending_scrub: %', to_jsonb(pool_row);
  END IF;
  UPDATE public.system_config SET value = saved WHERE key = 'dialer_pool_caps_v1';

  INSERT INTO public.mojo_dnc_ledger (e164, scope, mojo_contact_id, prospect_id, source, note)
  VALUES ('+18165552701', 'number', 'cid-pool', '81000000-0000-4000-8000-0000000000f1', 'rehearsal', 'stop')
  RETURNING id INTO ledger_id;
  IF NOT EXISTS (SELECT 1 FROM public.mojo_dnc_pending WHERE id = ledger_id) THEN
    RAISE EXCEPTION 'pending view missed an unencoded row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mojo_encode_queue
    WHERE phone = '+18165552701' AND encoded_at IS NULL
  ) THEN
    RAISE EXCEPTION 'encode queue view did not expose phone, encoded_at';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165552701', '81000000-0000-4000-8000-0000000000f1')
    IS DISTINCT FROM 'mojo_encode_pending' THEN
    RAISE EXCEPTION 'pending ledger did not block: %',
      public.source_list_phone_block_reason_v1('+18165552701', '81000000-0000-4000-8000-0000000000f1');
  END IF;
  BEGIN
    DELETE FROM public.mojo_dnc_ledger WHERE id = ledger_id;
    RAISE EXCEPTION 'ledger delete was allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%mojo_dnc_ledger_append_only%' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    UPDATE public.mojo_dnc_ledger SET e164 = '+18165552702' WHERE id = ledger_id;
    RAISE EXCEPTION 'ledger identity update was allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%mojo_dnc_ledger_append_only%' THEN
        RAISE;
      END IF;
  END;
  UPDATE public.mojo_dnc_ledger
  SET encoded_at = public.dialer_pool_now_v1(), encoder = 'rehearsal', mojo_confirmation = 'ok'
  WHERE id = ledger_id;
  IF EXISTS (SELECT 1 FROM public.mojo_dnc_pending WHERE id = ledger_id) THEN
    RAISE EXCEPTION 'encoded row stayed pending';
  END IF;
  IF public.source_list_phone_block_reason_v1('+18165552701', '81000000-0000-4000-8000-0000000000f1') IS NOT NULL THEN
    RAISE EXCEPTION 'encoded ledger still blocked the phone';
  END IF;

  IF (
    SELECT col_description(attrelid, attnum)
    FROM pg_attribute
    WHERE attrelid = 'public.crm_mojo_call_events'::regclass
      AND attname = 'optout_verbatim'
      AND NOT attisdropped
  ) NOT LIKE '%5 years%' THEN
    RAISE EXCEPTION 'touch log is missing the 5 year retention comment';
  END IF;
  IF obj_description('public.mojo_dnc_ledger'::regclass) NOT LIKE '%5 years%' THEN
    RAISE EXCEPTION 'ledger is missing the 5 year retention comment';
  END IF;
END $$;

INSERT INTO public.property_market_checks (id, source, list_day, listing_status)
VALUES ('81400000-0000-4000-8000-000000000001', 'heartland_matrix', (timezone('America/Chicago', clock_timestamp()))::date, 'listing_expired');

INSERT INTO public.source_lists (id, pull_date, source_file_name, list_type, county, state) VALUES
  ('81000000-0000-4000-8000-000000008803', (timezone('America/Chicago', clock_timestamp()))::date, 'expired-row.csv', 'mls_expired', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000009101', (timezone('America/Chicago', clock_timestamp()))::date, 'expired-tag.csv', 'tax_delinquent', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000009104', (timezone('America/Chicago', clock_timestamp()))::date, 'expired-tag-2.csv', 'foreclosure', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000009102', (timezone('America/Chicago', clock_timestamp()))::date + 1, 'future-day.csv', 'tax_delinquent', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000009105', (timezone('America/Chicago', clock_timestamp()))::date + 1, 'future-day-2.csv', 'foreclosure', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000009103', (timezone('America/Chicago', clock_timestamp()))::date, 'unverified-tax.csv', 'tax_delinquent', 'clay', 'MO');

INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
  ('81000000-0000-4000-8000-000000008803', 'clay', '8803 Expired', 'EXP-8803', 'Row', 'Individual'),
  ('81000000-0000-4000-8000-000000009101', 'clay', '9101 Tag', 'TAG-9101', 'Tag', 'Individual'),
  ('81000000-0000-4000-8000-000000009104', 'clay', '9104 Tag', 'TAG-9104', 'Tag', 'Individual'),
  ('81000000-0000-4000-8000-000000009102', 'clay', '9102 Future', 'FUT-9102', 'Future', 'Individual'),
  ('81000000-0000-4000-8000-000000009105', 'clay', '9105 Future', 'FUT-9105', 'Future', 'Individual'),
  ('81000000-0000-4000-8000-000000009103', 'clay', '9103 Tax', 'TAX-9103', 'Tax', 'Individual'),
  ('81000000-0000-4000-8000-000000008801', 'jackson', '8801 Line', 'LINE-8801', 'Line', 'Individual');

INSERT INTO public.prospect_phones (id, prospect_id, phone, relationship, line_status) VALUES
  ('81200000-0000-4000-8000-000000008803', '81000000-0000-4000-8000-000000008803', '+18165558803', 'owner', NULL),
  ('81200000-0000-4000-8000-000000009101', '81000000-0000-4000-8000-000000009101', '+18165559101', 'owner', NULL),
  ('81200000-0000-4000-8000-000000009104', '81000000-0000-4000-8000-000000009104', '+18165559104', 'owner', NULL),
  ('81200000-0000-4000-8000-000000009102', '81000000-0000-4000-8000-000000009102', '+18165559102', 'owner', NULL),
  ('81200000-0000-4000-8000-000000009105', '81000000-0000-4000-8000-000000009105', '+18165559105', 'owner', NULL),
  ('81200000-0000-4000-8000-000000009103', '81000000-0000-4000-8000-000000009103', '+18165559103', 'owner', NULL),
  ('81200000-0000-4000-8000-000000008801', '81000000-0000-4000-8000-000000008801', '+18165558801', 'owner', 'suppressed_bad_number');

INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, prospect_id, status, phones, list_day
) VALUES
  ('81300000-0000-4000-8000-000000008803', '81000000-0000-4000-8000-000000008803', 'mls_expired', 'clay', 'MO', 'EXP-8803', '8803 Expired', '81000000-0000-4000-8000-000000008803', 'new_needs_skip', ARRAY['+18165558803'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000009101', '81000000-0000-4000-8000-000000009101', 'tax_delinquent', 'clay', 'MO', 'TAG-9101', '9101 Tag', '81000000-0000-4000-8000-000000009101', 'ready', ARRAY['+18165559101'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000009104', '81000000-0000-4000-8000-000000009104', 'foreclosure', 'clay', 'MO', 'TAG-9104', '9104 Tag', '81000000-0000-4000-8000-000000009104', 'ready', ARRAY['+18165559104'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000009102', '81000000-0000-4000-8000-000000009102', 'tax_delinquent', 'clay', 'MO', 'FUT-9102', '9102 Future', '81000000-0000-4000-8000-000000009102', 'ready', ARRAY['+18165559102'], (timezone('America/Chicago', clock_timestamp()))::date + 1),
  ('81300000-0000-4000-8000-000000009105', '81000000-0000-4000-8000-000000009105', 'foreclosure', 'clay', 'MO', 'FUT-9105', '9105 Future', '81000000-0000-4000-8000-000000009105', 'ready', ARRAY['+18165559105'], (timezone('America/Chicago', clock_timestamp()))::date + 1),
  ('81300000-0000-4000-8000-000000009103', '81000000-0000-4000-8000-000000009103', 'tax_delinquent', 'clay', 'MO', 'TAX-9103', '9103 Tax', '81000000-0000-4000-8000-000000009103', 'ready', ARRAY['+18165559103'], (timezone('America/Chicago', clock_timestamp()))::date);

INSERT INTO public.source_list_row_mls_tags (source_list_row_id, mls_tag, strategy, source_check_id, list_day) VALUES
  ('81300000-0000-4000-8000-000000009101', 'expired_listing', 'wholesale', '81400000-0000-4000-8000-000000000001', (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000009104', 'expired_listing', 'wholesale', '81400000-0000-4000-8000-000000000001', (timezone('America/Chicago', clock_timestamp()))::date);

INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost) VALUES
  ('TAG-9101', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000009101', now(), 'clay_collector', 'delinquent', 0),
  ('FUT-9102', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000009102', now(), 'clay_collector', 'delinquent', 0);

DO $$
DECLARE
  today date := (timezone('America/Chicago', clock_timestamp()))::date;
  probe record;
  eligible integer;
BEGIN
  FOR probe IN
    SELECT *
    FROM (VALUES
      ('8803', '+18165558803', 'held'),
      ('9101', '+18165559101', 'held'),
      ('9104', '+18165559104', 'held'),
      ('9102', '+18165559102', 'held'),
      ('9105', '+18165559105', 'held'),
      ('9103', '+18165559103', 'held'),
      ('8801', '+18165558801', 'eligible')
    ) AS item(label, phone, expected)
  LOOP
    SELECT count(*) FILTER (WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub'))::integer
    INTO eligible
    FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = probe.phone;
    IF probe.expected = 'held' AND (
      eligible <> 0
      OR NOT EXISTS (
        SELECT 1 FROM public.dialer_pool_v1 AS pool
        WHERE pool.phone_e164 = probe.phone AND pool.pool_status = 'held'
      )
    ) THEN
      RAISE EXCEPTION 'FAIL % expected held, eligible %, row %', probe.label, eligible, (
        SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = probe.phone
      );
    END IF;
    IF probe.expected = 'eligible' AND eligible <> 1 THEN
      RAISE EXCEPTION 'FAIL % flag off expected eligible, count %, row %', probe.label, eligible, (
        SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = probe.phone
      );
    END IF;
    RAISE NOTICE 'PASS % eligible=%', probe.label, eligible;
  END LOOP;

  UPDATE public.system_config
  SET value = jsonb_build_object('enabled', true)
  WHERE key = 'LINE_CHECK_BLOCK_ENABLED';
  SELECT count(*) FILTER (WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub'))::integer
  INTO eligible
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165558801';
  IF eligible <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = '+18165558801'
      AND pool.pool_status = 'blocked'
      AND pool.block_reason = 'suppressed_bad_number'
  ) THEN
    RAISE EXCEPTION 'FAIL 8801 flag on expected blocked, eligible %, row %', eligible, (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165558801'
    );
  END IF;
  RAISE NOTICE 'PASS 8801 flag on eligible=%', eligible;
  UPDATE public.system_config
  SET value = jsonb_build_object('enabled', false)
  WHERE key = 'LINE_CHECK_BLOCK_ENABLED';

  UPDATE public.source_list_row_mls_tags
  SET list_day = today + 40
  WHERE source_list_row_id = '81300000-0000-4000-8000-000000009104';
  SELECT count(*) FILTER (WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub'))::integer
  INTO eligible
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165559104';
  IF eligible <> 1 THEN
    RAISE EXCEPTION 'FAIL 9104 hold did not lapse, eligible %, row %', eligible, (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165559104'
    );
  END IF;
  RAISE NOTICE 'PASS 9104 hold lapsed eligible=%', eligible;
END $$;

INSERT INTO public.source_lists (id, pull_date, source_file_name, list_type, county, state) VALUES
  ('81000000-0000-4000-8000-000000006602', (timezone('America/Chicago', clock_timestamp()))::date, 't1-tax.csv', 'tax_delinquent', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000006603', (timezone('America/Chicago', clock_timestamp()))::date, 't1-expired.csv', 'mls_expired', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000006601', (timezone('America/Chicago', clock_timestamp()))::date, 'market-missing.csv', 'tax_delinquent', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000006604', (timezone('America/Chicago', clock_timestamp()))::date, 'market-listed.csv', 'tax_delinquent', 'clay', 'MO'),
  ('81000000-0000-4000-8000-000000006701', (timezone('America/Chicago', clock_timestamp()))::date, 'expiry-window.csv', 'foreclosure', 'clay', 'MO');

INSERT INTO public.prospects (id, county, situs_street, parcel_id, owner_1_last, owner_1_type) VALUES
  ('81000000-0000-4000-8000-000000006602', 'clay', '6602 Tax', 'T1-6602', 'Tax', 'Individual'),
  ('81000000-0000-4000-8000-000000006601', 'clay', '6601 Missing', 'MKT-6601', 'Missing', 'Individual'),
  ('81000000-0000-4000-8000-000000006604', 'clay', '6604 Listed', 'LIST6604', 'Listed', 'Individual'),
  ('81000000-0000-4000-8000-000000006701', 'clay', '6701 Window', 'WIN-6701', 'Window', 'Individual'),
  ('81000000-0000-4000-8000-000000006801', 'clay', '6801 Deceased', 'DEC-6801', 'Deceased', 'Individual');

INSERT INTO public.prospect_phones (id, prospect_id, phone, relationship) VALUES
  ('81200000-0000-4000-8000-000000006602', '81000000-0000-4000-8000-000000006602', '+18165556602', 'owner'),
  ('81200000-0000-4000-8000-000000006601', '81000000-0000-4000-8000-000000006601', '+18165556601', 'owner'),
  ('81200000-0000-4000-8000-000000006604', '81000000-0000-4000-8000-000000006604', '+18165556604', 'owner'),
  ('81200000-0000-4000-8000-000000006701', '81000000-0000-4000-8000-000000006701', '+18165556701', 'owner'),
  ('81200000-0000-4000-8000-000000006811', '81000000-0000-4000-8000-000000006801', '+18165556811', 'spouse'),
  ('81200000-0000-4000-8000-000000006812', '81000000-0000-4000-8000-000000006801', '+18165556812', 'owner');

INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, parcel_id, address, prospect_id, status, phones, list_day
) VALUES
  ('81300000-0000-4000-8000-000000006602', '81000000-0000-4000-8000-000000006602', 'tax_delinquent', 'clay', 'MO', 'T1-6602', '6602 Tax', '81000000-0000-4000-8000-000000006602', 'ready', ARRAY['+18165556602'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000006612', '81000000-0000-4000-8000-000000006603', 'mls_expired', 'clay', 'MO', 'T1-6602', '6602 Expired', '81000000-0000-4000-8000-000000006602', 'new_needs_skip', ARRAY['+18165556602'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000006601', '81000000-0000-4000-8000-000000006601', 'tax_delinquent', 'clay', 'MO', 'MKT-6601', '6601 Missing', '81000000-0000-4000-8000-000000006601', 'ready', ARRAY['+18165556601'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000006604', '81000000-0000-4000-8000-000000006604', 'tax_delinquent', 'clay', 'MO', 'LIST6604', '6604 Listed', '81000000-0000-4000-8000-000000006604', 'ready', ARRAY['+18165556604'], (timezone('America/Chicago', clock_timestamp()))::date),
  ('81300000-0000-4000-8000-000000006701', '81000000-0000-4000-8000-000000006701', 'foreclosure', 'clay', 'MO', 'WIN-6701', '6701 Window', '81000000-0000-4000-8000-000000006701', 'ready', ARRAY['+18165556701'], (timezone('America/Chicago', clock_timestamp()))::date - 89),
  ('81300000-0000-4000-8000-000000006801', '81000000-0000-4000-8000-000000006601', 'tax_delinquent', 'clay', 'MO', 'DEC-6801', '6801 Deceased', '81000000-0000-4000-8000-000000006801', 'ready', ARRAY['+18165556811', '+18165556812'], (timezone('America/Chicago', clock_timestamp()))::date);

INSERT INTO public.tax_status_checks (parcel_id, county, list_type, prospect_id, checked_at, source, result, rank_boost) VALUES
  ('T1-6602', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000006602', now(), 'clay_collector', 'delinquent', 0),
  ('MKT-6601', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000006601', now(), 'clay_collector', 'delinquent', 0),
  ('LIST6604', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000006604', now(), 'clay_collector', 'delinquent', 0),
  ('DEC-6801', 'clay', 'tax_delinquent', '81000000-0000-4000-8000-000000006801', now(), 'clay_collector', 'delinquent', 0);

UPDATE public.prospects SET is_deceased = true WHERE id = '81000000-0000-4000-8000-000000006801';

INSERT INTO public.source_list_row_mls_tags (source_list_row_id, mls_tag, strategy, source_check_id, list_day)
VALUES (
  '81300000-0000-4000-8000-000000006701',
  'expired_listing',
  'wholesale',
  '81400000-0000-4000-8000-000000000001',
  (timezone('America/Chicago', clock_timestamp()))::date - 89
);

INSERT INTO public.property_market_latest (
  property_key, parcel_key, addr_norm, zip5, listing_status, list_day, source, owner_changed, owner_check_unknown, checked_at, check_id
) VALUES (
  'parcel:LIST6604', 'LIST6604', '6604 LISTED', '64116', 'listed_active',
  (timezone('America/Chicago', clock_timestamp()))::date, 'heartland_matrix', false, false, clock_timestamp(),
  '81400000-0000-4000-8000-000000000001'
);

DO $$
DECLARE
  today date := (timezone('America/Chicago', clock_timestamp()))::date;
  report jsonb;
  eligible integer;
  started timestamptz;
  elapsed numeric;
  pool_count integer;
BEGIN
  PERFORM set_config('dialer.pool_now', '2026-11-14 16:00:00+00', true);
  report := public.record_source_list_export_batch_v1(
    'pool-rehearsal', 'tax_delinquent', 'clay', 'MO', NULL, '81000000-0000-4000-8000-000000006602', 1
  );
  IF report->>'phone_count' IS DISTINCT FROM '0' OR (report->'rows')::text LIKE '%6602%' THEN
    RAISE EXCEPTION 'FAIL T1 tax export leaked an expired owner: %', report->'rows';
  END IF;
  RAISE NOTICE 'PASS T1 tax export phone_count=%', report->>'phone_count';

  SELECT count(*) FILTER (WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub'))::integer
  INTO eligible
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 IN ('+18165556601', '+18165556604');
  IF eligible <> 2 THEN
    RAISE EXCEPTION 'FAIL market flag off changed 6601 or listed_active, eligible %', eligible;
  END IF;
  RAISE NOTICE 'PASS market flag off eligible=%', eligible;

  UPDATE public.mls_market_config SET value = 'true', updated_at = clock_timestamp()
  WHERE key = 'MLS_MARKET_CHECK_ENABLED';
  IF EXISTS (
    SELECT 1 FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = '+18165556601'
      AND (pool.pool_status IN ('eligible', 'eligible_pending_scrub') OR pool.block_reason IS DISTINCT FROM 'market_check_missing')
  ) THEN
    RAISE EXCEPTION 'FAIL 6601 was eligible with the market flag on: %', (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165556601'
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dialer_pool_v1 AS pool
    WHERE pool.phone_e164 = '+18165556604'
      AND (pool.pool_status IN ('eligible', 'eligible_pending_scrub') OR pool.block_reason IS DISTINCT FROM 'listed_active')
  ) THEN
    RAISE EXCEPTION 'FAIL listed_active tax row was eligible with the market flag on: %', (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165556604'
    );
  END IF;
  RAISE NOTICE 'PASS market flag on 6601 and listed_active held';
  UPDATE public.mls_market_config SET value = 'false', updated_at = clock_timestamp()
  WHERE key = 'MLS_MARKET_CHECK_ENABLED';

  SELECT count(*) FILTER (WHERE pool.pool_status = 'held')::integer
  INTO eligible
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165556701';
  IF eligible <> 1 THEN
    RAISE EXCEPTION 'FAIL day 89 expired hold was released: %', (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165556701'
    );
  END IF;
  RAISE NOTICE 'PASS expiry day 89 held';
  UPDATE public.source_list_row_mls_tags
  SET list_day = today - 91
  WHERE source_list_row_id = '81300000-0000-4000-8000-000000006701';
  UPDATE public.source_list_rows
  SET list_day = today - 91
  WHERE id = '81300000-0000-4000-8000-000000006701';
  SELECT count(*) FILTER (WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub'))::integer
  INTO eligible
  FROM public.dialer_pool_v1 AS pool
  WHERE pool.phone_e164 = '+18165556701';
  IF eligible <> 1 THEN
    RAISE EXCEPTION 'FAIL day 91 expired hold stayed on: %', (
      SELECT to_jsonb(pool) FROM public.dialer_pool_v1 AS pool WHERE pool.phone_e164 = '+18165556701'
    );
  END IF;
  RAISE NOTICE 'PASS expiry day 91 released eligible=%', eligible;

  IF (
    SELECT array_agg(name ORDER BY priority) FROM public.dialer_saved_filters_v1
  ) IS DISTINCT FROM ARRAY[
    'Deceased', 'Tax 3+', 'Probate', 'Inherited', 'Code Violation', 'Expired (single-line, disclosure)'
  ]::text[] OR EXISTS (
    SELECT 1 FROM public.dialer_saved_filters_v1
    WHERE daily_cap IS DISTINCT FROM 75
      OR daily_cap_first_3_days IS DISTINCT FROM 30
      OR (name = 'Deceased' AND (priority IS DISTINCT FROM 1 OR single_line IS NOT TRUE OR lane_key IS DISTINCT FROM 'deceased'))
  ) THEN
    RAISE EXCEPTION 'FAIL saved filters are missing Deceased priority or the 30/75 caps';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dialer_saved_filters_v1
    WHERE name = 'Expired (single-line, disclosure)' AND lane_key = 'mls_expired' AND single_line IS TRUE
  ) THEN
    RAISE EXCEPTION 'FAIL expired saved filter is not single-line';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dialer_master_pool_v1 WHERE phone_e164 = '+18165552103'
  ) OR EXISTS (
    SELECT 1 FROM public.dialer_master_pool_v1 WHERE phone_e164 = '+18165558803'
  ) THEN
    RAISE EXCEPTION 'FAIL master pool did not keep only eligible rows';
  END IF;
  RAISE NOTICE 'PASS saved filters and master pool';
  IF NOT EXISTS (
    SELECT 1 FROM public.dialer_deceased_pool_v1 WHERE phone_e164 = '+18165556811'
  ) THEN
    RAISE EXCEPTION 'FAIL living heir was not in the Deceased set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dialer_deceased_pool_v1 WHERE phone_e164 = '+18165556812'
  ) THEN
    RAISE EXCEPTION 'FAIL decedent phone was included in the Deceased set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dialer_deceased_pool_v1 WHERE phone_e164 = '+18165552103'
  ) THEN
    RAISE EXCEPTION 'FAIL a non-deceased tax row was included in the Deceased set';
  END IF;
  RAISE NOTICE 'PASS Deceased filter heir only';
END $$;

RESET ROLE;
ALTER TABLE public.source_list_rows DISABLE TRIGGER ALL;
INSERT INTO public.source_lists (id, pull_date, source_file_name, list_type, county, state)
VALUES ('81000000-0000-4000-8000-000000003104', (timezone('America/Chicago', clock_timestamp()))::date, 'speed.csv', 'foreclosure', 'clay', 'MO');
INSERT INTO public.source_list_rows (id, source_list_id, list_type, county, state, parcel_id, address, status, phones)
SELECT
  ('83000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid,
  '81000000-0000-4000-8000-000000003104',
  'foreclosure',
  'clay',
  'MO',
  'SPD-' || n,
  n::text || ' Speed',
  'ready',
  ARRAY['+1' || lpad((4000000000 + n)::text, 10, '0')]
FROM generate_series(1, 31045) AS n;
ALTER TABLE public.source_list_rows ENABLE TRIGGER ALL;
ANALYZE public.source_list_rows;
ANALYZE public.prospect_phones;
ANALYZE public.prospects;
ANALYZE public.source_list_row_mls_tags;
SET ROLE service_role;
SET jit = off;

DO $$
DECLARE
  started timestamptz;
  elapsed numeric;
  pool_count integer;
  sample_count integer;
BEGIN
  started := clock_timestamp();
  SELECT count(*) INTO sample_count
  FROM public.source_list_phone_block_reasons_v1(
    ARRAY(SELECT '+1' || lpad((4000000000 + n)::text, 10, '0') FROM generate_series(1, 4000) AS n),
    ARRAY(SELECT NULL::uuid FROM generate_series(1, 4000) AS n),
    ARRAY(SELECT 'clay'::text FROM generate_series(1, 4000) AS n),
    ARRAY(SELECT 'clay'::text FROM generate_series(1, 4000) AS n)
  );
  elapsed := round(extract(epoch FROM clock_timestamp() - started)::numeric, 3);
  RAISE NOTICE 'PASS block reasons 4000 took % seconds', elapsed;

  started := clock_timestamp();
  SELECT count(*) INTO pool_count FROM public.dialer_pool_v1;
  elapsed := round(extract(epoch FROM clock_timestamp() - started)::numeric, 3);
  IF pool_count < 31045 THEN
    RAISE EXCEPTION 'FAIL pool view fixture returned % rows', pool_count;
  END IF;
  IF elapsed > 8 THEN
    RAISE EXCEPTION 'FAIL pool view 31045 fixture took % seconds', elapsed;
  END IF;
  RAISE NOTICE 'PASS pool view 31045 fixture took % seconds, rows %', elapsed, pool_count;
END $$;

RESET ROLE;
DELETE FROM public.source_list_rows WHERE source_list_id = '81000000-0000-4000-8000-000000003104';
SET ROLE service_role;

RESET ROLE;
SELECT 'PASS: calling pool v1 ledger, tier, export order, 4am lock, audit block' AS result;
