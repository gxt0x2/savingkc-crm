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

-- pg_get_viewdef(..., true) pretty-prints the Kansas stamp as
-- upper(COALESCE(state, ''::text)). Rebuild the view from that live
-- definition and keep every column, in order, with the stamp forced false.
DO $view$
DECLARE
  v_def text;
  v_cols text;
BEGIN
  v_def := regexp_replace(
    pg_get_viewdef('public.source_list_market_phone_review'::regclass, true),
    ';[[:space:]]*$',
    ''
  );
  SELECT string_agg(
    CASE
      WHEN attribute.attname = 'ks_license_unconfirmed' THEN 'false AS ks_license_unconfirmed'
      ELSE format('base.%I', attribute.attname)
    END,
    ', ' ORDER BY attribute.attnum
  )
  INTO v_cols
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.source_list_market_phone_review'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_cols IS NULL OR position('ks_license_unconfirmed' IN v_cols) = 0 THEN
    RAISE EXCEPTION 'source_list_market_phone_review is missing ks_license_unconfirmed';
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE VIEW public.source_list_market_phone_review WITH (security_invoker = true) AS SELECT %s FROM (%s) AS base',
    v_cols,
    v_def
  );
END;
$view$;

CREATE OR REPLACE FUNCTION public.service_county_state_pair_v1(p_county text, p_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $pair$
  SELECT (lower(btrim(coalesce(p_county, ''))), upper(btrim(coalesce(p_state, '')))) IN (
    ('jackson', 'MO'),
    ('clay', 'MO'),
    ('platte', 'MO'),
    ('johnson', 'KS'),
    ('wyandotte', 'KS')
  );
$pair$;

REVOKE ALL ON FUNCTION public.service_county_state_pair_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_county_state_pair_v1(text, text) TO service_role;

-- The row's own state wins. A missing prospect is not a missing state.
-- Prospect situs is only the fallback. A service county with no state at
-- either place stays unresolved instead of out of area.
CREATE OR REPLACE FUNCTION public.service_place_state_v1(p_county text, p_prospect_id uuid, p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $state$
  SELECT coalesce(
    (
      SELECT upper(btrim(row.state))
      FROM public.source_list_rows AS row
      WHERE lower(btrim(coalesce(row.county, ''))) = lower(btrim(coalesce(p_county, '')))
        AND nullif(btrim(row.state), '') IS NOT NULL
        AND (
          (p_prospect_id IS NOT NULL AND row.prospect_id = p_prospect_id)
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(row.phones, ARRAY[]::text[])) AS phone_value
            WHERE length(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)) = 10
              AND right(regexp_replace(coalesce(phone_value, ''), '\D', '', 'g'), 10)
                = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
          )
        )
      ORDER BY (p_prospect_id IS NOT NULL AND row.prospect_id = p_prospect_id) DESC
      LIMIT 1
    ),
    (
      SELECT upper(btrim(prospect.situs_state))
      FROM public.prospects AS prospect
      WHERE prospect.id = p_prospect_id
        AND nullif(btrim(prospect.situs_state), '') IS NOT NULL
    )
  );
$state$;

REVOKE ALL ON FUNCTION public.service_place_state_v1(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_place_state_v1(text, uuid, text) TO service_role;

-- Replace the allow-list before the rejection list. The rejection rewrite
-- mentions that allow-list, and a later replace() would edit the guard.
SELECT public.rewrite_live_function_v1(
  'source_list_phone_block_reasons_v1',
  $old$normalized.slug IN ('jackson', 'clay', 'platte', 'wyandotte', 'johnson')$old$,
  $new$public.service_county_state_pair_v1(
            normalized.slug,
            public.service_place_state_v1(normalized.slug, input.prospect_id, input.phone)
          )$new$
);

-- County name alone is not a service place. Johnson with no state is not Johnson KS.
-- A service county with no state stays unresolved. A different state, or a
-- county outside the five, is out of the service area.
SELECT public.rewrite_live_function_v1(
  'source_list_phone_block_reasons_v1',
  $old$normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')$old$,
  $new$normalized.slug NOT IN ('unknown', 'unresolved')
            AND NOT (
              normalized.slug IN ('jackson', 'clay', 'platte', 'wyandotte', 'johnson')
              AND public.service_place_state_v1(normalized.slug, input.prospect_id, input.phone) IS NULL
            )
            AND NOT public.service_county_state_pair_v1(
              normalized.slug,
              public.service_place_state_v1(normalized.slug, input.prospect_id, input.phone)
            )$new$
);

CREATE OR REPLACE FUNCTION public.market_service_place_v1(p_zip text, p_parcel text)
RETURNS TABLE(county text, state text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_county text;
  v_state text;
  v_zip text := nullif(substring(coalesce(p_zip, '') from '[0-9]{5}'), '');
  v_parcel text := nullif(upper(regexp_replace(coalesce(p_parcel, ''), '[^A-Za-z0-9]', '', 'g')), '');
BEGIN
  IF v_zip IS NOT NULL AND to_regclass('public.target_zips') IS NOT NULL THEN
    SELECT lower(btrim(z.county)), upper(btrim(z.state))
    INTO v_county, v_state
    FROM public.target_zips AS z
    WHERE z.zip5 = v_zip;
  END IF;
  IF (v_county IS NULL OR v_state IS NULL) AND v_parcel IS NOT NULL AND to_regclass('public.prospects') IS NOT NULL THEN
    SELECT lower(btrim(prospect.county)), upper(btrim(prospect.situs_state))
    INTO v_county, v_state
    FROM public.prospects AS prospect
    WHERE upper(regexp_replace(coalesce(prospect.parcel_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_parcel
      AND nullif(btrim(coalesce(prospect.county, '')), '') IS NOT NULL
      AND nullif(btrim(coalesce(prospect.situs_state, '')), '') IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_county IN ('unknown', 'unresolved') OR v_county IS NULL OR v_state IS NULL THEN
    county := NULL;
    state := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF public.service_county_state_pair_v1(v_county, v_state) THEN
    county := v_county;
    state := v_state;
    RETURN NEXT;
    RETURN;
  END IF;
  county := NULL;
  state := NULL;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.market_service_place_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_service_place_v1(text, text) TO service_role;

DROP FUNCTION public.rewrite_live_function_v1(text, text, text);
