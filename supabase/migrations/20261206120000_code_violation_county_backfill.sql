-- Code-violation county placement, prospect county cleanup, and the
-- parcel-match situs the dialer view was missing.
--
-- Does not replace source_list_phone_block_reason_v1. Pull request 814 owns
-- that function, including migration 20261205150000. NULL, blank, and
-- 'unresolved' must block as county_unresolved there, not as
-- out_of_service_area, and must not pass. 'unknown' is removed here.
-- 814's source_list_dialer_phone_review replacement must keep
-- source_list_parcel_match_county_v1 in the situs_county coalesce.
-- 814's record_source_list_export_batch_v1 copies must allow violation kinds
-- open_to_entry and nuisance.
--
-- Does not read or write mojo_call_queue. Does not change Twilio, Mojo, or
-- Mercury settings.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.prospect_county_canonical_v1(p_county text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN slug IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte') THEN slug
    ELSE 'unresolved'
  END
  FROM (
    SELECT NULLIF(
      regexp_replace(
        btrim(
          regexp_replace(
            regexp_replace(lower(btrim(coalesce(p_county, ''))), '[''’.]', '', 'g'),
            '\y(county|missouri|kansas|mo|ks)\y',
            '',
            'g'
          )
        ),
        '\s+',
        '',
        'g'
      ),
      ''
    ) AS slug
  ) AS normalized;
$function$;

CREATE OR REPLACE FUNCTION public.service_county_from_situs_v1(
  p_city text,
  p_state text,
  p_zip text,
  p_address text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  WITH loc AS (
    SELECT
      NULLIF(btrim(regexp_replace(
        regexp_replace(lower(coalesce(p_city, '')), '[''’.]', '', 'g'),
        '[^a-z0-9]+', ' ', 'g'
      )), '') AS city,
      CASE
        WHEN upper(btrim(coalesce(p_state, ''))) IN ('MO', 'MISSOURI') THEN 'MO'
        WHEN upper(btrim(coalesce(p_state, ''))) IN ('KS', 'KANSAS') THEN 'KS'
        ELSE NULL
      END AS state,
      NULLIF((regexp_match(coalesce(p_zip, '') || ' ' || coalesce(p_address, ''), '(6[46][0-9]{3})'))[1], '')::integer AS zip
  )
  SELECT CASE
    WHEN zip IN (64012, 64078, 64083, 64701) THEN NULL
    WHEN zip IN (
      64024, 64068, 64069, 64073, 64089,
      64116, 64117, 64118, 64119, 64144, 64155, 64156, 64157, 64158, 64161, 64162, 64165, 64166, 64167
    ) THEN 'clay'
    WHEN zip IN (
      64079, 64098, 64150, 64151, 64152, 64153, 64154, 64163, 64164, 64168, 64190, 64195
    ) THEN 'platte'
    WHEN zip IN (
      64013, 64014, 64015, 64030,
      64050, 64051, 64052, 64053, 64054, 64055, 64056, 64057, 64058,
      64064, 64081, 64082, 64086,
      64101, 64102, 64105, 64106, 64108, 64109, 64110, 64111, 64112, 64113, 64114,
      64120, 64121, 64123, 64124, 64125, 64126, 64127, 64128, 64129, 64130, 64131, 64132, 64133, 64134,
      64136, 64137, 64138, 64139, 64145, 64146, 64147, 64148, 64149
    ) THEN 'jackson'
    WHEN zip BETWEEN 66200 AND 66299 OR zip IN (66013, 66018, 66019, 66021, 66030, 66031, 66061, 66062, 66083, 66085) THEN 'johnson'
    WHEN zip BETWEEN 66100 AND 66119 THEN 'wyandotte'
    WHEN city IN ('kansas city', 'kc') AND state = 'KS' THEN 'wyandotte'
    WHEN city IN ('kansas city', 'kc') THEN NULL
    WHEN city IN ('independence', 'blue springs', 'raytown', 'grandview', 'lees summit', 'sugar creek', 'grain valley', 'oak grove')
      AND (state IS NULL OR state = 'MO') THEN 'jackson'
    WHEN city IN ('liberty', 'kearney', 'smithville', 'excelsior springs', 'north kansas city', 'gladstone', 'pleasant valley', 'claycomo')
      AND (state IS NULL OR state = 'MO') THEN 'clay'
    WHEN city IN ('platte city', 'parkville', 'weston', 'riverside', 'weatherby lake', 'platte woods')
      AND (state IS NULL OR state = 'MO') THEN 'platte'
    WHEN city IN (
      'overland park', 'olathe', 'shawnee', 'lenexa', 'leawood', 'prairie village', 'merriam', 'gardner',
      'de soto', 'spring hill', 'stilwell', 'roeland park', 'fairway', 'westwood', 'mission hills',
      'mission woods', 'lake quivira', 'mission'
    ) AND (state IS NULL OR state = 'KS') THEN 'johnson'
    WHEN city IN ('bonner springs', 'edwardsville') AND (state IS NULL OR state = 'KS') THEN 'wyandotte'
    ELSE NULL
  END
  FROM loc;
$function$;

CREATE OR REPLACE FUNCTION public.source_list_parcel_match_county_v1(p_raw jsonb)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE WHEN count(DISTINCT county) = 1 THEN min(county) ELSE NULL END
  FROM (
    SELECT CASE
      WHEN key ~ '(^|_)jackson($|_)' THEN 'jackson'
      WHEN key ~ '(^|_)clay($|_)' THEN 'clay'
      WHEN key ~ '(^|_)platte($|_)' THEN 'platte'
      WHEN key ~ '(^|_)wyandotte($|_)' THEN 'wyandotte'
      WHEN key ~ '(^|_)johnson($|_)' THEN 'johnson'
      ELSE NULL
    END AS county
    FROM jsonb_object_keys(coalesce(p_raw, '{}'::jsonb)) AS key
    WHERE key ~ '(^|_)(jackson|clay|platte|johnson|wyandotte)($|_)'
      AND (key ~ 'parcel|match|pin' OR left(key, 1) = '_')
      AND nullif(btrim(coalesce(p_raw->>key, '')), '') IS NOT NULL
  ) AS hit
  WHERE county IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.situs_is_outside_service_area_v1(p_raw jsonb, p_address text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH loc AS (
    SELECT
      NULLIF(btrim(regexp_replace(
        regexp_replace(lower(coalesce(
          p_raw->>'situs_county', p_raw->>'county', p_raw->>'property_county', ''
        )), '[''’.]', '', 'g'),
        '[^a-z0-9]+', ' ', 'g'
      )), '') AS county_words,
      NULLIF(btrim(regexp_replace(
        regexp_replace(lower(coalesce(p_raw->>'city', p_raw->>'situs_city', '')), '[''’.]', '', 'g'),
        '[^a-z0-9]+', ' ', 'g'
      )), '') AS city,
      NULLIF((regexp_match(coalesce(p_raw->>'zip_code', p_raw->>'zip', p_raw->>'situs_zip', '') || ' ' || coalesce(p_address, p_raw->>'address', p_raw->>'incident_address', ''), '(6[46][0-9]{3})'))[1], '')::integer AS zip
  )
  SELECT
    public.source_list_parcel_match_county_v1(p_raw) IS NULL
    AND (
      regexp_replace(coalesce(county_words, ''), '\y(county|missouri|kansas|mo|ks)\y', '', 'g') ~ '(^| )cass( |$)'
      OR city IN ('belton', 'raymore', 'peculiar', 'harrisonville', 'pleasant hill', 'garden city', 'archie', 'cleveland', 'drexel')
      OR zip IN (64012, 64078, 64083, 64701)
      OR (
        county_words IS NOT NULL
        AND public.prospect_county_canonical_v1(county_words) = 'unresolved'
        AND regexp_replace(county_words, '\s+', '', 'g') NOT IN ('unknown', 'unresolved', '')
      )
    )
  FROM loc;
$function$;

CREATE OR REPLACE FUNCTION public.source_list_import_county_v1(
  p_list_type text,
  p_lane_county text,
  p_lane_state text,
  p_raw jsonb,
  p_row_county text,
  p_address text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_list_type IS DISTINCT FROM 'code_violation' THEN nullif(lower(btrim(coalesce(p_lane_county, ''))), '')
    WHEN picked IS NULL THEN nullif(lower(btrim(coalesce(p_lane_county, ''))), '')
    WHEN p_lane_state = 'MO' AND picked IN ('jackson', 'clay', 'platte') THEN picked
    WHEN p_lane_state = 'KS' AND picked IN ('johnson', 'wyandotte') THEN picked
    WHEN p_lane_state IS NULL THEN picked
    ELSE NULL
  END
  FROM (
    SELECT COALESCE(
      CASE
        WHEN public.prospect_county_canonical_v1(p_row_county) IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
          THEN public.prospect_county_canonical_v1(p_row_county)
      END,
      public.source_list_parcel_match_county_v1(p_raw),
      public.service_county_from_situs_v1(
        coalesce(p_raw->>'city', p_raw->>'situs_city'),
        coalesce(p_raw->>'state', p_raw->>'situs_state', p_lane_state),
        coalesce(p_raw->>'zip_code', p_raw->>'zip', p_raw->>'situs_zip'),
        coalesce(p_address, p_raw->>'address', p_raw->>'incident_address', p_raw->>'situs_address')
      )
    ) AS picked
  ) AS choice;
$function$;

REVOKE ALL ON FUNCTION public.prospect_county_canonical_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_county_from_situs_v1(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_parcel_match_county_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.situs_is_outside_service_area_v1(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_import_county_v1(text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospect_county_canonical_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_county_from_situs_v1(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_parcel_match_county_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.situs_is_outside_service_area_v1(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_import_county_v1(text, text, text, jsonb, text, text) TO service_role;

-- Dry run (read only). These selects do not write. They use the same mapping
-- as the UPDATEs below. Run them before applying this file on a database that
-- does not already have the backfill.
--
-- SELECT 'source_list_rows' AS scope,
--        coalesce(public.source_list_parcel_match_county_v1(raw), '(null)') AS county,
--        count(*) AS row_count
-- FROM public.source_list_rows
-- WHERE list_type = 'code_violation'
-- GROUP BY 1, 2
-- ORDER BY 3 DESC;
--
-- SELECT 'prospects' AS scope,
--        COALESCE(
--          CASE
--            WHEN lower(btrim(county)) IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
--              THEN lower(btrim(county))
--          END,
--          public.service_county_from_situs_v1(situs_city, situs_state, situs_zip, situs_address),
--          'unresolved'
--        ) AS county,
--        count(*) AS row_count
-- FROM public.prospects
-- WHERE county IS NULL
--    OR btrim(county) = ''
--    OR lower(btrim(county)) NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte', 'unresolved')
--    OR county <> lower(btrim(county))
-- GROUP BY 1, 2
-- ORDER BY 3 DESC;

ALTER TABLE public.source_lists DROP CONSTRAINT IF EXISTS source_lists_violation_kind_check;
ALTER TABLE public.source_lists ADD CONSTRAINT source_lists_violation_kind_check CHECK (
  (list_type = 'code_violation' AND violation_kind IN ('dangerous_building', 'board_up', 'open_to_entry', 'structural', 'nuisance'))
  OR (list_type <> 'code_violation' AND violation_kind IS NULL)
);
ALTER TABLE public.source_lists DROP CONSTRAINT IF EXISTS source_lists_lane_check;
ALTER TABLE public.source_lists ADD CONSTRAINT source_lists_lane_check CHECK (
  (list_type = 'tax_delinquent' AND county IS NOT NULL AND state IS NOT NULL)
  OR (list_type = 'foreclosure' AND state IS NOT NULL)
  OR (
    list_type = 'code_violation'
    AND (
      (state = 'MO' AND (county IS NULL OR county IN ('jackson', 'clay', 'platte')))
      OR (state = 'KS' AND (county IS NULL OR county IN ('johnson', 'wyandotte')))
    )
  )
  OR (
    list_type IN ('probate_estate', 'probate_no_property')
    AND (state IS NULL OR state = 'MO')
  )
);

ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_violation_kind_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_violation_kind_check CHECK (
  (list_type = 'code_violation' AND violation_kind IN ('dangerous_building', 'board_up', 'open_to_entry', 'structural', 'nuisance'))
  OR (list_type <> 'code_violation' AND violation_kind IS NULL)
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_lane_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_lane_check CHECK (
  (list_type = 'tax_delinquent' AND county IS NOT NULL AND state IS NOT NULL)
  OR (list_type = 'foreclosure' AND state IS NOT NULL)
  OR (
    list_type = 'code_violation'
    AND (
      (state = 'MO' AND (county IS NULL OR county IN ('jackson', 'clay', 'platte')))
      OR (state = 'KS' AND (county IS NULL OR county IN ('johnson', 'wyandotte')))
    )
  )
  OR (
    list_type IN ('probate_estate', 'probate_no_property')
    AND (state IS NULL OR state = 'MO')
  )
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_status_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_status_check CHECK (
  status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'out_of_area')
);

ALTER TABLE public.source_list_row_status_history DROP CONSTRAINT IF EXISTS source_list_row_status_history_from_check;
ALTER TABLE public.source_list_row_status_history ADD CONSTRAINT source_list_row_status_history_from_check CHECK (
  from_status IS NULL
  OR from_status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'out_of_area')
);
ALTER TABLE public.source_list_row_status_history DROP CONSTRAINT IF EXISTS source_list_row_status_history_to_check;
ALTER TABLE public.source_list_row_status_history ADD CONSTRAINT source_list_row_status_history_to_check CHECK (
  to_status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'out_of_area')
);

ALTER TABLE public.source_list_export_batches DROP CONSTRAINT IF EXISTS source_list_export_batches_violation_kind_check;
ALTER TABLE public.source_list_export_batches ADD CONSTRAINT source_list_export_batches_violation_kind_check CHECK (
  violation_kind IS NULL OR violation_kind IN ('dangerous_building', 'board_up', 'open_to_entry', 'structural', 'nuisance')
);

CREATE OR REPLACE FUNCTION public.source_list_normalize_lane_v1(
  p_list_type text,
  p_county text,
  p_state text,
  p_violation_kind text,
  OUT list_type text,
  OUT county text,
  OUT state text,
  OUT violation_kind text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  list_type := lower(btrim(coalesce(p_list_type, '')));
  county := nullif(lower(btrim(coalesce(p_county, ''))), '');
  state := nullif(upper(btrim(coalesce(p_state, ''))), '');
  violation_kind := nullif(
    regexp_replace(lower(btrim(coalesce(p_violation_kind, ''))), '[[:space:]-]+', '_', 'g'),
    ''
  );

  IF list_type NOT IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation'
  ) OR (county IS NOT NULL AND county NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte'))
    OR (state IS NOT NULL AND state NOT IN ('MO', 'KS'))
    OR (
      violation_kind IS NOT NULL
      AND violation_kind NOT IN ('dangerous_building', 'board_up', 'open_to_entry', 'structural', 'nuisance')
    )
  THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;

  IF county IS NOT NULL AND NOT (
    (county IN ('jackson', 'clay', 'platte') AND state = 'MO')
    OR (county IN ('johnson', 'wyandotte') AND state = 'KS')
  ) THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;

  IF list_type = 'code_violation' AND violation_kind IS NULL THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF list_type <> 'code_violation' AND violation_kind IS NOT NULL THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;

  IF NOT (
    (list_type = 'tax_delinquent' AND county IS NOT NULL AND state IS NOT NULL)
    OR (list_type = 'foreclosure' AND state IS NOT NULL)
    OR (
      list_type = 'code_violation'
      AND (
        (state = 'MO' AND (county IS NULL OR county IN ('jackson', 'clay', 'platte')))
        OR (state = 'KS' AND (county IS NULL OR county IN ('johnson', 'wyandotte')))
      )
    )
    OR (
      list_type IN ('probate_estate', 'probate_no_property')
      AND (state IS NULL OR state = 'MO')
    )
  ) THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.source_list_normalize_lane_v1(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_normalize_lane_v1(text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.source_list_row_lane_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.source_lists AS list
    WHERE list.id = NEW.source_list_id
      AND list.list_type = NEW.list_type
      AND list.state IS NOT DISTINCT FROM NEW.state
      AND list.violation_kind IS NOT DISTINCT FROM NEW.violation_kind
      AND (
        list.county IS NOT DISTINCT FROM NEW.county
        OR (
          list.list_type = 'code_violation'
          AND list.county IS NULL
          AND (
            NEW.county IS NULL
            OR (NEW.state = 'MO' AND NEW.county IN ('jackson', 'clay', 'platte'))
            OR (NEW.state = 'KS' AND NEW.county IN ('johnson', 'wyandotte'))
          )
        )
      )
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'source_list_lane_mismatch';
END;
$function$;

REVOKE ALL ON FUNCTION public.source_list_row_lane_guard_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_row_lane_guard_v1() TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS source_list_rows_code_case_key
  ON public.source_list_rows (
    list_type,
    (coalesce(state, '')),
    (coalesce(violation_kind, '')),
    match_key
  )
  WHERE list_type = 'code_violation';

CREATE OR REPLACE FUNCTION public.import_source_list_v1(
  p_list_type text,
  p_county text,
  p_state text,
  p_violation_kind text,
  p_pull_date date,
  p_source_url text,
  p_notes text,
  p_source_file_name text,
  p_source_file_sha256 text,
  p_source_file_bytes integer,
  p_imported_by text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_lane record;
  v_list_id uuid;
  v_stamp timestamptz := clock_timestamp();
  v_actor text := nullif(btrim(coalesce(p_imported_by, '')), '');
  v_file_name text := nullif(btrim(coalesce(p_source_file_name, '')), '');
  v_hash text := lower(btrim(coalesce(p_source_file_sha256, '')));
  v_source_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_inserted integer := 0;
  v_updated integer := 0;
  v_case_first boolean;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'source_list_rows_required';
  END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'source_list_too_many_rows';
  END IF;
  IF v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_file_name IS NULL OR char_length(v_file_name) > 200 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_hash !~ '^[a-f0-9]{64}$' OR p_source_file_bytes IS NULL
    OR p_source_file_bytes < 0 OR p_source_file_bytes > 5000000
  THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF p_pull_date IS NULL OR p_pull_date < DATE '2000-01-01' OR p_pull_date > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_source_url IS NOT NULL AND (
    char_length(v_source_url) > 2000
    OR v_source_url !~ '^https?://'
  ) THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;

  SELECT * INTO v_lane
  FROM public.source_list_normalize_lane_v1(p_list_type, p_county, p_state, p_violation_kind);
  v_case_first := v_lane.list_type IN ('probate_estate', 'probate_no_property', 'foreclosure', 'code_violation');

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS item
    WHERE jsonb_typeof(item) <> 'object'
      OR (item->'raw' IS NOT NULL AND jsonb_typeof(item->'raw') <> 'object')
  ) THEN
    RAISE EXCEPTION 'source_list_raw_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS item
    WHERE item->'phones' IS NOT NULL AND jsonb_typeof(item->'phones') <> 'array'
  ) THEN
    RAISE EXCEPTION 'source_list_phones_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS item
    WHERE (
      SELECT count(*)
      FROM jsonb_array_elements_text(coalesce(item->'phones', '[]'::jsonb)) AS phone_value
      WHERE btrim(phone_value) <> ''
    ) > 8
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(item->'phones', '[]'::jsonb)) AS phone_value
      WHERE char_length(btrim(phone_value)) > 40
    )
  ) THEN
    RAISE EXCEPTION 'source_list_phones_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS item
    WHERE nullif(btrim(coalesce(item->>'amount_owed', '')), '') IS NOT NULL
      AND btrim(item->>'amount_owed') !~ '^-?[0-9]+(\.[0-9]+)?$'
  ) THEN
    RAISE EXCEPTION 'source_list_amount_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinal)
    CROSS JOIN LATERAL (
      SELECT
        nullif(upper(regexp_replace(btrim(coalesce(value->>'parcel_id', '')), '[[:space:]]+', '', 'g')), '') AS parcel_body,
        nullif(upper(regexp_replace(btrim(coalesce(value->>'case_id', '')), '[[:space:]]+', '', 'g')), '') AS case_body
    ) AS body
    WHERE body.parcel_body IS NULL AND body.case_body IS NULL
      OR body.parcel_body IS NOT NULL AND body.parcel_body !~ '^[A-Z0-9][A-Z0-9:./_-]{0,79}$'
      OR body.case_body IS NOT NULL AND body.case_body !~ '^[A-Z0-9][A-Z0-9:./_-]{0,79}$'
      OR char_length(btrim(coalesce(value->>'address', ''))) > 500
      OR char_length(btrim(coalesce(value->>'owner_names', ''))) > 500
  ) THEN
    RAISE EXCEPTION 'source_list_match_key_invalid';
  END IF;

  INSERT INTO public.source_lists (
    list_type, county, state, violation_kind, pull_date, source_url, notes,
    source_file_name, source_file_sha256, source_file_bytes, imported_by
  ) VALUES (
    v_lane.list_type, v_lane.county, v_lane.state, v_lane.violation_kind, p_pull_date,
    v_source_url, v_notes, v_file_name, v_hash, p_source_file_bytes, v_actor
  )
  ON CONFLICT (
    list_type,
    (coalesce(county, '')),
    (coalesce(state, '')),
    (coalesce(violation_kind, '')),
    pull_date,
    source_file_sha256
  )
  DO UPDATE SET
    source_url = coalesce(EXCLUDED.source_url, public.source_lists.source_url),
    notes = coalesce(EXCLUDED.notes, public.source_lists.notes),
    source_file_name = EXCLUDED.source_file_name,
    source_file_bytes = EXCLUDED.source_file_bytes,
    imported_by = EXCLUDED.imported_by
  RETURNING id INTO v_list_id;

  CREATE TEMP TABLE source_list_import_batch ON COMMIT DROP AS
  WITH incoming AS (
    SELECT deduped.*
    FROM (
      SELECT DISTINCT ON (parsed.match_key)
        parsed.*
      FROM (
        SELECT
          item.ordinal::integer AS ordinal,
          body.parcel_body AS parcel_id,
          body.case_body AS case_id,
          nullif(btrim(coalesce(item.value->>'address', '')), '') AS address,
          nullif(btrim(coalesce(item.value->>'owner_names', '')), '') AS owner_names,
          CASE
            WHEN nullif(btrim(coalesce(item.value->>'amount_owed', '')), '') IS NULL THEN NULL
            ELSE btrim(item.value->>'amount_owed')::numeric
          END AS amount_owed,
          (
            SELECT coalesce(array_agg(phone.phone ORDER BY phone.ord), '{}'::text[])
            FROM (
              SELECT btrim(phone_item.phone_value) AS phone, phone_item.ord
              FROM jsonb_array_elements_text(coalesce(item.value->'phones', '[]'::jsonb))
                WITH ORDINALITY AS phone_item(phone_value, ord)
            ) AS phone
            WHERE phone.phone <> ''
          ) AS phones,
          coalesce(item.value->'raw', '{}'::jsonb) AS raw,
          public.source_list_import_county_v1(
            v_lane.list_type,
            v_lane.county,
            v_lane.state,
            coalesce(item.value->'raw', '{}'::jsonb),
            item.value->>'county',
            item.value->>'address'
          ) AS row_county,
          (
            coalesce(item.value->>'out_of_area', '') IN ('true', 't', '1')
            OR public.situs_is_outside_service_area_v1(
              coalesce(item.value->'raw', '{}'::jsonb),
              item.value->>'address'
            )
          ) AS out_of_area,
          CASE
            WHEN v_case_first AND body.case_body IS NOT NULL THEN 'case:' || body.case_body
            WHEN v_case_first AND body.parcel_body IS NOT NULL THEN 'parcel:' || body.parcel_body
            WHEN body.parcel_body IS NOT NULL THEN 'parcel:' || body.parcel_body
            ELSE 'case:' || body.case_body
          END AS match_key,
          body.parcel_body,
          body.case_body
        FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinal)
        CROSS JOIN LATERAL (
          SELECT
            nullif(upper(regexp_replace(btrim(coalesce(item.value->>'parcel_id', '')), '[[:space:]]+', '', 'g')), '') AS parcel_body,
            nullif(upper(regexp_replace(btrim(coalesce(item.value->>'case_id', '')), '[[:space:]]+', '', 'g')), '') AS case_body
        ) AS body
      ) AS parsed
      ORDER BY parsed.match_key, parsed.ordinal DESC
    ) AS deduped
  ),
  property_hits AS (
    SELECT
      incoming.ordinal,
      count(*)::integer AS match_count,
      CASE WHEN count(*) = 1 THEN (array_agg(property.id))[1] ELSE NULL END AS property_id
    FROM incoming
    JOIN public.crm_properties AS property
      ON incoming.parcel_body IS NOT NULL
     AND incoming.parcel_body NOT LIKE 'MFC:%'
     AND property.parcel_id IS NOT NULL
     AND upper(regexp_replace(btrim(property.parcel_id), '[[:space:]]+', '', 'g')) = incoming.parcel_body
    GROUP BY incoming.ordinal
  ),
  prospect_hits AS (
    SELECT
      incoming.ordinal,
      count(*)::integer AS match_count,
      CASE WHEN count(*) = 1 THEN (array_agg(prospect.id))[1] ELSE NULL END AS prospect_id
    FROM incoming
    JOIN public.prospects AS prospect
      ON incoming.parcel_body IS NOT NULL
     AND incoming.parcel_body NOT LIKE 'MFC:%'
     AND prospect.parcel_id IS NOT NULL
     AND upper(regexp_replace(btrim(prospect.parcel_id), '[[:space:]]+', '', 'g')) = incoming.parcel_body
     AND coalesce(prospect.prospect_track, 'tax') <> 'mortgage_foreclosure'
     AND (
       v_lane.county IS NULL
       OR lower(btrim(coalesce(prospect.county, ''))) = v_lane.county
     )
    GROUP BY incoming.ordinal
  ),
  case_hits AS (
    SELECT
      incoming.ordinal,
      count(DISTINCT foreclosure.prospect_id)::integer AS match_count,
      CASE
        WHEN count(DISTINCT foreclosure.prospect_id) = 1 THEN (array_agg(DISTINCT foreclosure.prospect_id))[1]
        ELSE NULL
      END AS prospect_id
    FROM incoming
    JOIN public.mortgage_foreclosure_prospects AS foreclosure
      ON incoming.case_body IS NOT NULL
     AND foreclosure.prospect_id IS NOT NULL
     AND foreclosure.case_number IS NOT NULL
     AND upper(regexp_replace(btrim(foreclosure.case_number), '[[:space:]]+', '', 'g')) = incoming.case_body
    GROUP BY incoming.ordinal
  ),
  resolved AS (
    SELECT
      incoming.ordinal,
      incoming.parcel_id,
      incoming.case_id,
      incoming.address,
      incoming.owner_names,
      incoming.amount_owed,
      incoming.phones,
      CASE
        WHEN incoming.out_of_area THEN incoming.raw
        WHEN incoming.row_county IS NOT NULL THEN incoming.raw || jsonb_build_object('situs_county', incoming.row_county)
        ELSE incoming.raw
      END AS raw,
      incoming.match_key,
      CASE WHEN incoming.out_of_area THEN NULL ELSE incoming.row_county END AS row_county,
      incoming.out_of_area,
      (
        coalesce(property_hits.match_count, 0) > 1
        OR coalesce(prospect_hits.match_count, 0) > 1
        OR (
          coalesce(prospect_hits.match_count, 0) = 0
          AND coalesce(case_hits.match_count, 0) > 1
        )
        OR (
          coalesce(prospect_hits.match_count, 0) = 1
          AND coalesce(case_hits.match_count, 0) = 1
          AND prospect_hits.prospect_id IS DISTINCT FROM case_hits.prospect_id
        )
      ) AS ambiguous,
      CASE
        WHEN coalesce(property_hits.match_count, 0) > 1 THEN NULL
        ELSE property_hits.property_id
      END AS property_id,
      CASE
        WHEN coalesce(prospect_hits.match_count, 0) > 1 THEN NULL
        WHEN coalesce(prospect_hits.match_count, 0) = 0 AND coalesce(case_hits.match_count, 0) > 1 THEN NULL
        WHEN coalesce(prospect_hits.match_count, 0) = 1
          AND coalesce(case_hits.match_count, 0) = 1
          AND prospect_hits.prospect_id IS DISTINCT FROM case_hits.prospect_id THEN NULL
        WHEN coalesce(prospect_hits.match_count, 0) = 1 THEN prospect_hits.prospect_id
        WHEN coalesce(case_hits.match_count, 0) = 1 THEN case_hits.prospect_id
        ELSE NULL
      END AS prospect_id,
      CASE
        WHEN coalesce(property_hits.match_count, 0) > 1 AND coalesce(prospect_hits.match_count, 0) > 1
          THEN 'ambiguous_property_and_prospect_match'
        WHEN coalesce(property_hits.match_count, 0) > 1 THEN 'ambiguous_property_match'
        WHEN coalesce(prospect_hits.match_count, 0) > 1
          OR (coalesce(prospect_hits.match_count, 0) = 0 AND coalesce(case_hits.match_count, 0) > 1)
          THEN 'ambiguous_prospect_match'
        WHEN coalesce(prospect_hits.match_count, 0) = 1
          AND coalesce(case_hits.match_count, 0) = 1
          AND prospect_hits.prospect_id IS DISTINCT FROM case_hits.prospect_id
          THEN 'prospect_link_conflict'
        ELSE NULL
      END AS status_reason
    FROM incoming
    LEFT JOIN property_hits ON property_hits.ordinal = incoming.ordinal
    LEFT JOIN prospect_hits ON prospect_hits.ordinal = incoming.ordinal
    LEFT JOIN case_hits ON case_hits.ordinal = incoming.ordinal
  )
  SELECT * FROM resolved;

  UPDATE public.source_list_rows AS existing
  SET county = batch.row_county
  FROM source_list_import_batch AS batch
  WHERE v_lane.list_type = 'code_violation'
    AND existing.list_type = v_lane.list_type
    AND existing.violation_kind IS NOT DISTINCT FROM v_lane.violation_kind
    AND coalesce(existing.state, '') = coalesce(v_lane.state, '')
    AND existing.match_key = batch.match_key
    AND existing.county IS NULL
    AND batch.row_county IS NOT NULL;

  WITH upserted AS (
    INSERT INTO public.source_list_rows (
      source_list_id, list_type, county, state, violation_kind, match_key,
      parcel_id, case_id, address, owner_names, amount_owed, phones, raw,
      property_id, prospect_id, status, status_reason, updated_by,
      created_at, updated_at, status_changed_at
    )
    SELECT
      v_list_id, v_lane.list_type,
      CASE WHEN v_lane.list_type = 'code_violation' THEN resolved.row_county ELSE v_lane.county END,
      v_lane.state, v_lane.violation_kind,
      resolved.match_key, resolved.parcel_id, resolved.case_id, resolved.address,
      resolved.owner_names, resolved.amount_owed, resolved.phones, resolved.raw,
      CASE
        WHEN v_lane.list_type = 'code_violation' THEN NULL
        WHEN resolved.ambiguous THEN NULL
        ELSE resolved.property_id
      END,
      CASE
        WHEN v_lane.list_type = 'code_violation' THEN NULL
        WHEN resolved.ambiguous THEN NULL
        ELSE resolved.prospect_id
      END,
      CASE
        WHEN v_lane.list_type = 'code_violation' AND resolved.out_of_area THEN 'out_of_area'
        WHEN v_lane.list_type = 'code_violation' THEN 'new'
        WHEN resolved.ambiguous THEN 'needs_check'
        ELSE 'new'
      END,
      CASE
        WHEN v_lane.list_type = 'code_violation' AND resolved.out_of_area THEN 'out_of_service_area'
        WHEN v_lane.list_type = 'code_violation' THEN NULL
        ELSE resolved.status_reason
      END,
      v_actor, v_stamp, v_stamp, v_stamp
    FROM source_list_import_batch AS resolved
    ON CONFLICT (
      list_type,
      (coalesce(county, '')),
      (coalesce(state, '')),
      (coalesce(violation_kind, '')),
      match_key
    )
    DO UPDATE SET
      county = CASE
        WHEN public.source_list_rows.county IS NULL THEN EXCLUDED.county
        ELSE public.source_list_rows.county
      END,
      source_list_id = EXCLUDED.source_list_id,
      parcel_id = coalesce(EXCLUDED.parcel_id, public.source_list_rows.parcel_id),
      case_id = coalesce(EXCLUDED.case_id, public.source_list_rows.case_id),
      address = coalesce(EXCLUDED.address, public.source_list_rows.address),
      owner_names = coalesce(EXCLUDED.owner_names, public.source_list_rows.owner_names),
      amount_owed = coalesce(EXCLUDED.amount_owed, public.source_list_rows.amount_owed),
      phones = CASE
        WHEN cardinality(EXCLUDED.phones) = 0 THEN public.source_list_rows.phones
        ELSE EXCLUDED.phones
      END,
      raw = EXCLUDED.raw,
      property_id = CASE
        WHEN public.source_list_rows.status <> 'new' AND EXCLUDED.status = 'needs_check' THEN public.source_list_rows.property_id
        WHEN EXCLUDED.status = 'needs_check' THEN NULL
        ELSE coalesce(EXCLUDED.property_id, public.source_list_rows.property_id)
      END,
      prospect_id = CASE
        WHEN public.source_list_rows.status <> 'new' AND EXCLUDED.status = 'needs_check' THEN public.source_list_rows.prospect_id
        WHEN EXCLUDED.status = 'needs_check' THEN NULL
        ELSE coalesce(EXCLUDED.prospect_id, public.source_list_rows.prospect_id)
      END,
      status = CASE
        WHEN public.source_list_rows.status = 'new' THEN EXCLUDED.status
        ELSE public.source_list_rows.status
      END,
      status_reason = CASE
        WHEN public.source_list_rows.status = 'new' THEN EXCLUDED.status_reason
        ELSE public.source_list_rows.status_reason
      END,
      updated_by = EXCLUDED.updated_by,
      updated_at = clock_timestamp()
    RETURNING id, (created_at = v_stamp) AS inserted
  ),
  filed AS (
    INSERT INTO public.source_list_row_files (source_list_id, source_list_row_id)
    SELECT v_list_id, upserted.id FROM upserted
    ON CONFLICT DO NOTHING
    RETURNING source_list_row_id
  )
  SELECT
    count(*) FILTER (WHERE upserted.inserted)::integer,
    count(*) FILTER (WHERE NOT upserted.inserted)::integer
  INTO v_inserted, v_updated
  FROM upserted;

  RETURN jsonb_build_object(
    'source_list_id', v_list_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'row_count', v_inserted + v_updated
  );
END;
$function$;



COMMENT ON FUNCTION public.import_source_list_v1(
  text, text, text, text, date, text, text, text, text, integer, text, jsonb
) IS
  'Idempotent source-file import. Code violations dedupe on the source case id and land as new, except a row placed outside the service area, which is out_of_area. County comes from the parcel-match key or the situs. Does not create prospects or properties.';

CREATE OR REPLACE FUNCTION public.set_source_list_row_status_v1(
  p_row_id uuid,
  p_status text,
  p_status_reason text,
  p_actor text,
  p_export_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_reason text := nullif(btrim(coalesce(p_status_reason, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_row public.source_list_rows;
BEGIN
  IF p_row_id IS NULL OR v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_status IS NULL OR v_status NOT IN (
    'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'out_of_area'
  ) THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;
  IF v_status = 'loaded_to_dialer' AND p_export_batch_id IS NULL THEN
    RAISE EXCEPTION 'source_list_export_batch_required';
  END IF;
  IF v_status <> 'loaded_to_dialer' AND p_export_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'source_list_export_batch_mismatch';
  END IF;
  IF v_status = 'loaded_to_dialer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.source_list_export_batches WHERE id = p_export_batch_id
    ) THEN
      RAISE EXCEPTION 'source_list_export_batch_not_found';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.source_list_export_batch_phones AS phone
      WHERE phone.export_batch_id = p_export_batch_id
        AND phone.source_list_row_id = p_row_id
    ) THEN
      RAISE EXCEPTION 'source_list_export_batch_mismatch';
    END IF;
  END IF;

  UPDATE public.source_list_rows
  SET status = v_status,
      status_reason = v_reason,
      updated_by = v_actor,
      updated_at = clock_timestamp(),
      loaded_at = CASE WHEN v_status = 'loaded_to_dialer' THEN clock_timestamp() ELSE loaded_at END,
      loaded_export_batch_id = CASE
        WHEN v_status = 'loaded_to_dialer' THEN p_export_batch_id
        ELSE loaded_export_batch_id
      END
  WHERE id = p_row_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'source_list_row_not_found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'status_reason', v_row.status_reason,
    'status_changed_at', v_row.status_changed_at,
    'loaded_at', v_row.loaded_at,
    'loaded_export_batch_id', v_row.loaded_export_batch_id
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE VIEW public.source_list_dialer_phone_review
WITH (security_invoker = true) AS
SELECT
  dialed.source_list_row_id,
  dialed.source_list_id,
  dialed.list_type,
  dialed.county,
  dialed.state,
  dialed.violation_kind,
  dialed.parcel_id,
  dialed.case_id,
  dialed.address,
  dialed.owner_names,
  dialed.amount_owed,
  dialed.property_id,
  dialed.prospect_id,
  dialed.row_status,
  dialed.phone_value,
  dialed.phone_e164,
  dialed.phone_origin,
  dialed.pull_date,
  dialed.source_file_name,
  public.source_list_phone_block_reason_v1(
    dialed.phone_value,
    dialed.county,
    dialed.situs_county
  ) AS block_reason
FROM (
  SELECT DISTINCT ON (
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value))
  )
    row.id AS source_list_row_id,
    row.source_list_id,
    row.list_type,
    row.county,
    row.state,
    row.violation_kind,
    row.parcel_id,
    row.case_id,
    row.address,
    row.owner_names,
    row.amount_owed,
    row.property_id,
    row.prospect_id,
    row.status AS row_status,
    phone.phone_value,
    public.normalize_conversation_phone(phone.phone_value) AS phone_e164,
    phone.phone_origin,
    list.pull_date,
    list.source_file_name,
    coalesce(
      NULLIF(btrim(row.raw->>'situs_county'), ''),
      public.source_list_parcel_match_county_v1(row.raw),
      NULLIF(btrim(row.raw->>'county'), ''),
      (
        SELECT NULLIF(btrim(prospect.county), '')
        FROM public.prospects AS prospect
        WHERE prospect.id = row.prospect_id
      ),
      (
        SELECT NULLIF(btrim(property.county), '')
        FROM public.crm_properties AS property
        WHERE property.id = row.property_id
      )
    ) AS situs_county
  FROM public.source_list_rows AS row
  JOIN public.source_lists AS list ON list.id = row.source_list_id
  CROSS JOIN LATERAL (
    SELECT phone_value, 'source_row'::text AS phone_origin
    FROM unnest(row.phones) AS phone_value
    WHERE nullif(btrim(phone_value), '') IS NOT NULL
    UNION ALL
    SELECT prospect_phone.phone, 'prospect_phone'::text
    FROM public.prospect_phones AS prospect_phone
    WHERE row.prospect_id IS NOT NULL
      AND prospect_phone.prospect_id = row.prospect_id
      AND nullif(btrim(prospect_phone.phone), '') IS NOT NULL
  ) AS phone
  WHERE row.status IN ('ready', 'loaded_to_dialer')
  ORDER BY
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
    (phone.phone_origin = 'prospect_phone') DESC
) AS dialed;


COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. situs_county prefers raw, then a parcel-match key ending in the county name, then a linked prospect or property. Do not load the dialer from this view.';

-- Idempotent county backfill for KCMO code-violation rows. A parcel-match key
-- ending _jackson, _clay, or _platte sets both county and raw.situs_county.
-- Rows with no match key stay NULL so the dialer gate can block them as
-- county_unresolved once that reason exists. Re-running changes nothing.
UPDATE public.source_list_rows AS row
SET
  county = matched.county,
  raw = row.raw || jsonb_build_object('situs_county', matched.county)
FROM (
  SELECT id, public.source_list_parcel_match_county_v1(raw) AS county
  FROM public.source_list_rows
  WHERE list_type = 'code_violation'
) AS matched
WHERE row.id = matched.id
  AND matched.county IS NOT NULL
  AND (row.county IS NULL OR nullif(btrim(row.raw->>'situs_county'), '') IS NULL)
  AND (row.county IS NULL OR row.county = matched.county);

CREATE OR REPLACE FUNCTION public.prospects_county_canonical_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.county := public.prospect_county_canonical_v1(NEW.county);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prospects_county_canonical ON public.prospects;
CREATE TRIGGER prospects_county_canonical
  BEFORE INSERT OR UPDATE OF county ON public.prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.prospects_county_canonical_v1();

REVOKE ALL ON FUNCTION public.prospects_county_canonical_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospects_county_canonical_v1() TO service_role;

-- Idempotent. 'unknown', blank, NULL, and mixed case are placed from a parcel
-- match, then the situs city or zip, and only into the five service counties.
-- Cass is never chosen. Anything still unresolved is the single value
-- 'unresolved'. A second run finds nothing left to change.
UPDATE public.prospects AS prospect
SET county = resolved.next_county
FROM (
  SELECT
    prospect.id,
    COALESCE(
      CASE
        WHEN lower(btrim(prospect.county)) IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
          THEN lower(btrim(prospect.county))
      END,
      (
        SELECT hit.county
        FROM (
          SELECT public.prospect_county_canonical_v1(property.county) AS county
          FROM public.crm_properties AS property
          WHERE nullif(btrim(prospect.parcel_id), '') IS NOT NULL
            AND property.parcel_id IS NOT NULL
            AND upper(regexp_replace(btrim(property.parcel_id), '[[:space:]]+', '', 'g'))
              = upper(regexp_replace(btrim(prospect.parcel_id), '[[:space:]]+', '', 'g'))
          UNION ALL
          SELECT public.prospect_county_canonical_v1(other.county)
          FROM public.prospects AS other
          WHERE other.id <> prospect.id
            AND nullif(btrim(prospect.parcel_id), '') IS NOT NULL
            AND other.parcel_id IS NOT NULL
            AND upper(regexp_replace(btrim(other.parcel_id), '[[:space:]]+', '', 'g'))
              = upper(regexp_replace(btrim(prospect.parcel_id), '[[:space:]]+', '', 'g'))
        ) AS hit
        WHERE hit.county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
        LIMIT 1
      ),
      public.service_county_from_situs_v1(
        prospect.situs_city,
        prospect.situs_state,
        prospect.situs_zip,
        coalesce(prospect.situs_address, prospect.situs_street)
      ),
      'unresolved'
    ) AS next_county
  FROM public.prospects AS prospect
  WHERE prospect.county IS NULL
    OR btrim(prospect.county) = ''
    OR lower(btrim(prospect.county)) NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte', 'unresolved')
    OR prospect.county <> lower(btrim(prospect.county))
) AS resolved
WHERE prospect.id = resolved.id
  AND prospect.county IS DISTINCT FROM resolved.next_county;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'prospects_county_canonical_check'
      AND conrelid = 'public.prospects'::regclass
  ) THEN
    ALTER TABLE public.prospects
      ADD CONSTRAINT prospects_county_canonical_check
      CHECK (
        county IS NOT NULL
        AND county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte', 'unresolved')
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.prospects VALIDATE CONSTRAINT prospects_county_canonical_check;

COMMENT ON COLUMN public.prospects.county IS
  'Lowercase service county: jackson, clay, platte, johnson, or wyandotte. unresolved blocks export as county_unresolved. Cass is never stored.';
