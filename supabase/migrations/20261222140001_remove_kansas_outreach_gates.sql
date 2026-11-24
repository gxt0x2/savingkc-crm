-- Owner ruling 2026-11-24: Kansas is not a calling boundary.
-- Counsel GATE-2026-11-24-005: drop KS_EXPIRED_RELEASE_APPROVED as a gate,
-- and keep licensee disclosure as a field rather than a block.
-- Jackson, Clay, and Johnson exist in both states, so a county filter
-- without its state is not a service place. Cass stays out.
-- Does not touch the dialer queue table.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.rewrite_live_function_v1(p_name text, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $rewrite$
DECLARE
  v_def text;
  v_next text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = p_name
  ORDER BY p.oid DESC
  LIMIT 1;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'missing function %', p_name;
  END IF;
  IF position(p_old IN v_def) = 0 THEN
    RAISE EXCEPTION '% is missing the expected text', p_name;
  END IF;
  v_next := replace(v_def, p_old, p_new);
  EXECUTE v_next;
END;
$rewrite$;

SELECT public.rewrite_live_function_v1(
  'source_list_market_block_reason_v1',
  $old$
    IF NOT public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
      AND (v_row_state = 'KS' OR v_row_county IN ('wyandotte', 'johnson')) THEN
      RETURN 'ks_license_unconfirmed';
    END IF;
$old$,
  ''
);

SELECT public.rewrite_live_function_v1(
  'record_source_list_export_batch_v1',
  $old$
  IF v_state IS NOT NULL AND v_state NOT IN ('MO', 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
$old$,
  $new$
  IF v_state IS NOT NULL AND v_state NOT IN ('MO', 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_county IN ('jackson', 'clay', 'johnson') AND v_state IS NULL THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF (v_county IN ('jackson', 'clay', 'platte') AND v_state IS NOT NULL AND v_state <> 'MO')
    OR (v_county IN ('johnson', 'wyandotte') AND v_state IS NOT NULL AND v_state <> 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
$new$
);

SELECT public.rewrite_live_function_v1(
  'record_source_list_export_batch_v1',
  $old$
          AND public.market_calling_window_open_v1()
          AND (
            public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
            OR (
              upper(coalesce(export_row.state, '')) <> 'KS'
              AND lower(coalesce(export_row.county, '')) NOT IN ('wyandotte', 'johnson')
            )
          )
          AND export_row.requires_licensee_disclosure IS TRUE
$old$,
  $new$
          AND public.market_calling_window_open_v1()
$new$
);

SELECT public.rewrite_live_function_v1(
  'record_source_list_export_batch_v1',
  'WHEN review.requires_licensee_disclosure IS DISTINCT FROM true THEN ''licensee_disclosure_required''',
  'WHEN false THEN NULL'
);

SELECT public.rewrite_live_function_v1(
  'record_source_list_export_batch_v1',
  $old$
              OR review.requires_licensee_disclosure IS DISTINCT FROM true
$old$,
  ''
);

SELECT public.rewrite_live_function_v1(
  'record_source_list_export_batch_v1',
  $old$
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) AS item
      WHERE coalesce((item->>'requires_licensee_disclosure')::boolean, false) IS DISTINCT FROM true
    ) THEN
      RAISE EXCEPTION 'licensee_disclosure_required';
    END IF;
$old$,
  ''
);

DO $view$
DECLARE
  v_def text;
  v_next text;
BEGIN
  v_def := pg_get_viewdef('public.source_list_market_phone_review'::regclass, true);
  v_next := regexp_replace(
    v_def,
    'upper\(coalesce\(review\.state, ''''\)\) = ''KS''[\s\S]*?AS ks_license_unconfirmed',
    'false AS ks_license_unconfirmed',
    'i'
  );
  IF v_next = v_def THEN
    RAISE EXCEPTION 'source_list_market_phone_review still stamps ks_license_unconfirmed from Kansas';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.source_list_market_phone_review WITH (security_invoker = true) AS ' || v_next;
END;
$view$;

UPDATE public.tc_document_templates
SET body = replace(body, 'Missouri and/or Kansas', 'Missouri')
WHERE body LIKE '%Missouri and/or Kansas%';

DROP FUNCTION public.rewrite_live_function_v1(text, text, text);
