-- Listed/sold market check for the calling-pool dialer export.
--
-- The Heartland Matrix saved search must cover the whole metro (Jackson,
-- Clay, Platte, Johnson, and Wyandotte). target_zips limits only expired
-- intake and the high-price tag. A pool row whose zip or parcel is missing
-- from that metro export is listing_check_unknown and stays blocked.
--
-- MLS_MARKET_CHECK_ENABLED defaults false so the export scrub is unchanged
-- until that one flag is turned on. EXPIRED_OWNER_CONFIRMED defaults false
-- and is the only switch for expired_owner_confirm_pending.
--
-- This does not read or write the dialer queue. It does not load a Matrix file.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.mls_market_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mls_market_config_key_check CHECK (char_length(key) BETWEEN 1 AND 80),
  CONSTRAINT mls_market_config_value_check CHECK (char_length(value) <= 200)
);

INSERT INTO public.mls_market_config (key, value) VALUES
  ('MLS_MARKET_CHECK_ENABLED', 'false'),
  ('EXPIRED_OWNER_CONFIRMED', 'false'),
  ('MLS_EXPIRED_WINDOW_DAYS', '90')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.mls_market_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mls_market_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.mls_market_config TO service_role;

CREATE OR REPLACE FUNCTION public.mls_config_flag_v1(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce((
    SELECT config.value = 'true'
    FROM public.mls_market_config AS config
    WHERE config.key = p_key
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.mls_market_check_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT public.mls_config_flag_v1('MLS_MARKET_CHECK_ENABLED');
$function$;

CREATE OR REPLACE FUNCTION public.expired_owner_confirmed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT public.mls_config_flag_v1('EXPIRED_OWNER_CONFIRMED');
$function$;

REVOKE ALL ON FUNCTION public.mls_config_flag_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mls_market_check_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expired_owner_confirmed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mls_config_flag_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mls_market_check_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.expired_owner_confirmed() TO service_role;

CREATE OR REPLACE FUNCTION public.sync_mls_market_flags_v1(
  p_market_check_enabled text DEFAULT NULL,
  p_expired_owner_confirmed text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_market_check_enabled IN ('true', 'false') THEN
    UPDATE public.mls_market_config
    SET value = p_market_check_enabled, updated_at = clock_timestamp()
    WHERE key = 'MLS_MARKET_CHECK_ENABLED';
  END IF;
  IF p_expired_owner_confirmed IN ('true', 'false') THEN
    UPDATE public.mls_market_config
    SET value = p_expired_owner_confirmed, updated_at = clock_timestamp()
    WHERE key = 'EXPIRED_OWNER_CONFIRMED';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_mls_market_flags_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mls_market_flags_v1(text, text) TO service_role;

CREATE TABLE IF NOT EXISTS public.property_market_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id text,
  addr_norm text,
  zip5 text,
  source text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  list_day date NOT NULL,
  export_file_sha256 text,
  mls_number text,
  list_status_raw text,
  listing_status text NOT NULL,
  close_date date,
  list_price numeric,
  owner_on_roll text,
  owner_changed boolean NOT NULL DEFAULT false,
  CONSTRAINT property_market_checks_status_check CHECK (
    listing_status IN (
      'listed_active', 'listed_pending', 'sold_new_owner',
      'off_market_ok', 'listing_check_unknown', 'listing_expired'
    )
  ),
  CONSTRAINT property_market_checks_source_check CHECK (source IN ('crm_lead', 'heartland_matrix')),
  CONSTRAINT property_market_checks_zip_check CHECK (zip5 IS NULL OR zip5 ~ '^[0-9]{5}$'),
  CONSTRAINT property_market_checks_sha_check CHECK (
    export_file_sha256 IS NULL OR export_file_sha256 ~ '^[a-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_property_market_checks_parcel
  ON public.property_market_checks (parcel_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_market_checks_addr
  ON public.property_market_checks (addr_norm, zip5, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_market_checks_day
  ON public.property_market_checks (list_day, listing_status);

ALTER TABLE public.property_market_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.property_market_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.property_market_checks TO service_role;

CREATE OR REPLACE FUNCTION public.property_market_checks_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'property_market_checks is append-only';
END;
$function$;

DROP TRIGGER IF EXISTS property_market_checks_no_update ON public.property_market_checks;
CREATE TRIGGER property_market_checks_no_update
  BEFORE UPDATE OR DELETE ON public.property_market_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.property_market_checks_append_only();

CREATE OR REPLACE FUNCTION public.market_zip5(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT substring(coalesce(p_text, '') FROM '([0-9]{5})');
$function$;

CREATE OR REPLACE FUNCTION public.normalize_market_address(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  raw text := upper(split_part(coalesce(p_text, ''), ',', 1));
  unit text;
  word text;
  words text[] := ARRAY[]::text[];
BEGIN
  unit := substring(raw FROM '(?:#|UNIT[[:space:]]*#?|APT\.?[[:space:]]*#?|STE\.?[[:space:]]*#?|SUITE[[:space:]]*#?)([A-Z0-9-]+)');
  IF unit IS NOT NULL THEN
    unit := regexp_replace(unit, '^0+', '');
    raw := regexp_replace(raw, '(?:#|UNIT[[:space:]]*#?|APT\.?[[:space:]]*#?|STE\.?[[:space:]]*#?|SUITE[[:space:]]*#?)[A-Z0-9-]+', ' ', 'g');
  END IF;
  FOREACH word IN ARRAY regexp_split_to_array(regexp_replace(raw, '[^A-Z0-9 ]', ' ', 'g'), '[[:space:]]+')
  LOOP
    IF word IS NULL OR word = '' THEN
      CONTINUE;
    END IF;
    word := CASE word
      WHEN 'STREET' THEN 'ST' WHEN 'AVENUE' THEN 'AVE' WHEN 'TERRACE' THEN 'TER'
      WHEN 'ROAD' THEN 'RD' WHEN 'DRIVE' THEN 'DR' WHEN 'BOULEVARD' THEN 'BLVD'
      WHEN 'LANE' THEN 'LN' WHEN 'PLACE' THEN 'PL' WHEN 'COURT' THEN 'CT'
      WHEN 'CIRCLE' THEN 'CIR' WHEN 'PARKWAY' THEN 'PKWY' WHEN 'HIGHWAY' THEN 'HWY'
      WHEN 'EXTENSION' THEN 'EXT' WHEN 'TRAIL' THEN 'TRL'
      WHEN 'NORTH' THEN 'N' WHEN 'SOUTH' THEN 'S' WHEN 'EAST' THEN 'E' WHEN 'WEST' THEN 'W'
      WHEN 'NORTHEAST' THEN 'NE' WHEN 'NORTHWEST' THEN 'NW'
      WHEN 'SOUTHEAST' THEN 'SE' WHEN 'SOUTHWEST' THEN 'SW'
      ELSE regexp_replace(word, '^([0-9]+)(ST|ND|RD|TH)$', '\1')
    END;
    words := words || word;
  END LOOP;
  IF cardinality(words) = 0 OR substring(words[1], 1, 1) !~ '[0-9]' THEN
    RETURN '';
  END IF;
  RETURN array_to_string(words, ' ') || CASE WHEN coalesce(unit, '') <> '' THEN ' UNIT ' || unit ELSE '' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_owner_name(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT nullif(btrim(regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]+', ' ', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.owner_names_differ(p_roll text, p_prospect text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  WITH names AS (
    SELECT public.normalize_owner_name(p_roll) AS roll_name,
           public.normalize_owner_name(p_prospect) AS prospect_name
  ), sorted AS (
    SELECT (
      SELECT string_agg(token, ' ' ORDER BY token)
      FROM regexp_split_to_table(names.roll_name, ' ') AS token
      WHERE token <> ''
    ) AS roll_key,
    (
      SELECT string_agg(token, ' ' ORDER BY token)
      FROM regexp_split_to_table(names.prospect_name, ' ') AS token
      WHERE token <> ''
    ) AS prospect_key
    FROM names
  )
  SELECT roll_key IS NOT NULL AND prospect_key IS NOT NULL AND roll_key IS DISTINCT FROM prospect_key
  FROM sorted;
$function$;

CREATE OR REPLACE FUNCTION public.market_owner_changed_v1(p_parcel_id text, p_prospect_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  changed boolean := false;
BEGIN
  IF to_regclass('public.parcel_inventory') IS NULL THEN
    RETURN false;
  END IF;
  IF nullif(btrim(coalesce(p_parcel_id, '')), '') IS NULL AND p_prospect_id IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE $compare$
    SELECT EXISTS (
      SELECT 1
      FROM public.parcel_inventory AS inventory
      JOIN public.prospects AS prospect
        ON upper(regexp_replace(coalesce(inventory.parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))
         = upper(regexp_replace(coalesce(prospect.parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))
      WHERE nullif(inventory.parcel_id, '') IS NOT NULL
        AND (
          prospect.id = $1
          OR (
            $1 IS NULL
            AND upper(regexp_replace(coalesce(prospect.parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))
              = upper(regexp_replace(coalesce($2, ''), '[^A-Za-z0-9]', '', 'g'))
          )
        )
        AND public.owner_names_differ(inventory.owner_name, prospect.owner_1)
    )
  $compare$
  INTO changed
  USING p_prospect_id, p_parcel_id;
  RETURN coalesce(changed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.market_zip5(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_market_address(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_owner_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_names_differ(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_owner_changed_v1(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_zip5(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_market_address(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_owner_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_names_differ(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_owner_changed_v1(text, uuid) TO service_role;

CREATE OR REPLACE VIEW public.property_market_status_v1
WITH (security_invoker = true) AS
SELECT DISTINCT ON (keyed.property_key)
  keyed.id,
  keyed.parcel_id,
  keyed.addr_norm,
  keyed.zip5,
  keyed.source,
  keyed.checked_at,
  keyed.list_day,
  keyed.export_file_sha256,
  keyed.mls_number,
  keyed.list_status_raw,
  keyed.listing_status,
  keyed.close_date,
  keyed.list_price,
  keyed.owner_on_roll,
  keyed.owner_changed,
  keyed.property_key
FROM (
  SELECT
    checks.*,
    CASE
      WHEN nullif(btrim(checks.parcel_id), '') IS NOT NULL
        THEN 'parcel:' || upper(regexp_replace(checks.parcel_id, '[^A-Za-z0-9]', '', 'g'))
      WHEN nullif(btrim(checks.addr_norm), '') IS NOT NULL AND checks.zip5 IS NOT NULL
        THEN 'addr:' || checks.addr_norm || '|' || checks.zip5
      ELSE 'check:' || checks.id::text
    END AS property_key
  FROM public.property_market_checks AS checks
) AS keyed
ORDER BY keyed.property_key, keyed.checked_at DESC, keyed.id DESC;

REVOKE ALL ON TABLE public.property_market_status_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.property_market_status_v1 TO service_role;

COMMENT ON VIEW public.property_market_status_v1 IS
  'Latest market check per parcel, or per normalized street and zip when the parcel is blank.';

CREATE TABLE IF NOT EXISTS public.target_zips (
  zip5 text PRIMARY KEY CHECK (zip5 ~ '^[0-9]{5}$'),
  county text NOT NULL,
  state text NOT NULL,
  status text NOT NULL CHECK (status IN ('core', 'keep', 'parked', 'avoid')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.target_zips (zip5, county, state, status) VALUES
  ('64030', 'jackson', 'MO', 'core'),
  ('64055', 'jackson', 'MO', 'core'),
  ('64063', 'jackson', 'MO', 'core'),
  ('64114', 'jackson', 'MO', 'core'),
  ('64133', 'jackson', 'MO', 'core'),
  ('64134', 'jackson', 'MO', 'core'),
  ('64138', 'jackson', 'MO', 'core'),
  ('64014', 'jackson', 'MO', 'keep'),
  ('64015', 'jackson', 'MO', 'keep'),
  ('64016', 'jackson', 'MO', 'keep'),
  ('64029', 'jackson', 'MO', 'keep'),
  ('64034', 'jackson', 'MO', 'keep'),
  ('64054', 'jackson', 'MO', 'keep'),
  ('64056', 'jackson', 'MO', 'keep'),
  ('64057', 'jackson', 'MO', 'keep'),
  ('64058', 'jackson', 'MO', 'keep'),
  ('64064', 'jackson', 'MO', 'keep'),
  ('64070', 'jackson', 'MO', 'keep'),
  ('64075', 'jackson', 'MO', 'keep'),
  ('64081', 'jackson', 'MO', 'keep'),
  ('64082', 'jackson', 'MO', 'keep'),
  ('64086', 'jackson', 'MO', 'keep'),
  ('64105', 'jackson', 'MO', 'keep'),
  ('64106', 'jackson', 'MO', 'keep'),
  ('64108', 'jackson', 'MO', 'keep'),
  ('64109', 'jackson', 'MO', 'keep'),
  ('64110', 'jackson', 'MO', 'keep'),
  ('64111', 'jackson', 'MO', 'keep'),
  ('64112', 'jackson', 'MO', 'keep'),
  ('64113', 'jackson', 'MO', 'keep'),
  ('64136', 'jackson', 'MO', 'keep'),
  ('64137', 'jackson', 'MO', 'keep'),
  ('64139', 'jackson', 'MO', 'keep'),
  ('64145', 'jackson', 'MO', 'keep'),
  ('64146', 'jackson', 'MO', 'keep'),
  ('64131', 'jackson', 'MO', 'parked'),
  ('64125', 'jackson', 'MO', 'avoid'),
  ('64126', 'jackson', 'MO', 'avoid'),
  ('64127', 'jackson', 'MO', 'avoid'),
  ('64128', 'jackson', 'MO', 'avoid'),
  ('64129', 'jackson', 'MO', 'avoid'),
  ('64130', 'jackson', 'MO', 'avoid')
ON CONFLICT (zip5) DO NOTHING;

ALTER TABLE public.target_zips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.target_zips FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.target_zips TO service_role;

CREATE TABLE IF NOT EXISTS public.mls_price_thresholds (
  zip5 text PRIMARY KEY CHECK (zip5 ~ '^[0-9]{5}$'),
  min_list_price numeric NOT NULL CHECK (min_list_price >= 0),
  method text NOT NULL CHECK (method IN ('compiled', 'trailing_12_month_override'))
);

INSERT INTO public.mls_price_thresholds (zip5, min_list_price, method) VALUES
  ('64030', 265000, 'compiled'),
  ('64055', 225000, 'compiled'),
  ('64063', 340000, 'compiled'),
  ('64114', 345000, 'compiled'),
  ('64133', 235000, 'compiled'),
  ('64134', 180000, 'trailing_12_month_override'),
  ('64138', 210000, 'compiled'),
  ('64014', 320000, 'compiled'),
  ('64015', 315000, 'compiled'),
  ('64016', 240000, 'compiled'),
  ('64029', 355000, 'compiled'),
  ('64034', 390000, 'compiled'),
  ('64054', 175000, 'compiled'),
  ('64056', 250000, 'compiled'),
  ('64057', 315000, 'compiled'),
  ('64058', 260000, 'compiled'),
  ('64064', 440000, 'compiled'),
  ('64070', 425000, 'compiled'),
  ('64075', 360000, 'compiled'),
  ('64081', 435000, 'compiled'),
  ('64082', 525000, 'compiled'),
  ('64086', 385000, 'compiled'),
  ('64105', 240000, 'compiled'),
  ('64106', 170000, 'compiled'),
  ('64108', 330000, 'compiled'),
  ('64109', 270000, 'compiled'),
  ('64110', 295000, 'compiled'),
  ('64111', 320000, 'compiled'),
  ('64112', 450000, 'compiled'),
  ('64113', 610000, 'compiled'),
  ('64136', 300000, 'compiled'),
  ('64137', 230000, 'compiled'),
  ('64139', 530000, 'compiled'),
  ('64145', 430000, 'compiled'),
  ('64146', 245000, 'compiled'),
  ('64131', 230000, 'compiled'),
  ('64125', 110000, 'compiled'),
  ('64126', 95000, 'compiled'),
  ('64127', 115000, 'compiled'),
  ('64128', 115000, 'compiled'),
  ('64129', 160000, 'compiled'),
  ('64130', 105000, 'compiled')
ON CONFLICT (zip5) DO NOTHING;

ALTER TABLE public.mls_price_thresholds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mls_price_thresholds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mls_price_thresholds TO service_role;

CREATE TABLE IF NOT EXISTS public.mls_export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_file_sha256 text NOT NULL CHECK (export_file_sha256 ~ '^[a-f0-9]{64}$'),
  chicago_day date NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('loaded', 'missed_deadline')),
  covered_zips text[] NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.mls_market_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('missed_export')),
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (alert_day, kind)
);

ALTER TABLE public.mls_export_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mls_market_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mls_export_runs, public.mls_market_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mls_export_runs, public.mls_market_alerts TO service_role;

ALTER TABLE public.source_lists DROP CONSTRAINT IF EXISTS source_lists_list_type_check;
ALTER TABLE public.source_lists ADD CONSTRAINT source_lists_list_type_check CHECK (
  list_type IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property',
    'foreclosure', 'code_violation', 'mls_expired'
  )
);
ALTER TABLE public.source_lists DROP CONSTRAINT IF EXISTS source_lists_lane_check;
ALTER TABLE public.source_lists ADD CONSTRAINT source_lists_lane_check CHECK (
  (list_type = 'tax_delinquent' AND county IS NOT NULL AND state IS NOT NULL)
  OR (list_type = 'foreclosure' AND state IS NOT NULL)
  OR (
    list_type = 'code_violation'
    AND state = 'MO'
    AND (county IS NULL OR county IN ('jackson', 'clay', 'platte'))
  )
  OR (
    list_type IN ('probate_estate', 'probate_no_property')
    AND (state IS NULL OR state = 'MO')
  )
  OR list_type = 'mls_expired'
);
ALTER TABLE public.source_lists DROP CONSTRAINT IF EXISTS source_lists_file_bytes_check;
ALTER TABLE public.source_lists ADD CONSTRAINT source_lists_file_bytes_check
  CHECK (source_file_bytes >= 0 AND source_file_bytes <= 30000000);

ALTER TABLE public.source_list_rows
  ADD COLUMN IF NOT EXISTS list_day date,
  ADD COLUMN IF NOT EXISTS requires_licensee_disclosure boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'wholesale';

ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_strategy_check;
ALTER TABLE public.source_list_rows
  ADD CONSTRAINT source_list_rows_strategy_check CHECK (strategy IN ('wholesale', 'novation_traditional'));

ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_list_type_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_list_type_check CHECK (
  list_type IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property',
    'foreclosure', 'code_violation', 'mls_expired'
  )
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_lane_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_lane_check CHECK (
  (list_type = 'tax_delinquent' AND county IS NOT NULL AND state IS NOT NULL)
  OR (list_type = 'foreclosure' AND state IS NOT NULL)
  OR (
    list_type = 'code_violation'
    AND state = 'MO'
    AND (county IS NULL OR county IN ('jackson', 'clay', 'platte'))
  )
  OR (
    list_type IN ('probate_estate', 'probate_no_property')
    AND (state IS NULL OR state = 'MO')
  )
  OR list_type = 'mls_expired'
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_status_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_status_check CHECK (
  status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'new_needs_skip')
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_match_key_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_match_key_check CHECK (
  match_key ~ '^(parcel|case|addr):[A-Z0-9][A-Z0-9:./_-]{0,79}$'
);
ALTER TABLE public.source_list_rows DROP CONSTRAINT IF EXISTS source_list_rows_match_alignment_check;
ALTER TABLE public.source_list_rows ADD CONSTRAINT source_list_rows_match_alignment_check CHECK (
  (left(match_key, 7) = 'parcel:' AND parcel_id = substr(match_key, 8))
  OR (left(match_key, 5) = 'case:' AND case_id = substr(match_key, 6))
  OR (left(match_key, 5) = 'addr:' AND parcel_id IS NULL AND case_id IS NULL)
);

CREATE TABLE IF NOT EXISTS public.source_list_row_mls_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_row_id uuid NOT NULL REFERENCES public.source_list_rows(id) ON DELETE RESTRICT,
  mls_tag text NOT NULL CHECK (mls_tag IN ('expired_listing', 'active_high_price')),
  strategy text NOT NULL CHECK (strategy IN ('wholesale', 'novation_traditional')),
  source_check_id uuid NOT NULL REFERENCES public.property_market_checks(id) ON DELETE RESTRICT,
  list_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_list_row_id, mls_tag)
);

ALTER TABLE public.source_list_row_mls_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.source_list_row_mls_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.source_list_row_mls_tags TO service_role;

CREATE OR REPLACE FUNCTION public.source_list_market_block_reason_v1(
  p_row_id uuid,
  p_parcel_id text,
  p_address text,
  p_prospect_id uuid,
  p_list_type text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_today date := (timezone('America/Chicago', clock_timestamp()))::date;
  v_addr text := public.normalize_market_address(p_address);
  v_zip text := public.market_zip5(p_address);
  v_status text;
  v_day date;
  v_owner_changed boolean := false;
  v_relist boolean := false;
  v_expired boolean := false;
  v_local timestamp := timezone('America/Chicago', clock_timestamp());
  v_minutes integer;
BEGIN
  IF NOT public.mls_market_check_enabled() THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.source_list_row_mls_tags AS tag
    WHERE tag.source_list_row_id = p_row_id
      AND tag.mls_tag = 'active_high_price'
      AND tag.strategy = 'novation_traditional'
      AND tag.list_day <= v_today
  ) THEN
    RETURN 'active_high_price';
  END IF;

  SELECT status.listing_status, status.list_day, status.owner_changed
  INTO v_status, v_day, v_owner_changed
  FROM public.property_market_status_v1 AS status
  WHERE (
    nullif(btrim(coalesce(p_parcel_id, '')), '') IS NOT NULL
    AND upper(regexp_replace(coalesce(status.parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))
      = upper(regexp_replace(p_parcel_id, '[^A-Za-z0-9]', '', 'g'))
  ) OR (
    v_addr <> '' AND v_zip IS NOT NULL
    AND status.addr_norm = v_addr
    AND status.zip5 = v_zip
  )
  ORDER BY status.checked_at DESC
  LIMIT 1;

  v_owner_changed := v_owner_changed OR public.market_owner_changed_v1(p_parcel_id, p_prospect_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.property_market_checks AS checks
    WHERE checks.list_day = v_today
      AND (
        (
          nullif(btrim(coalesce(p_parcel_id, '')), '') IS NOT NULL
          AND upper(regexp_replace(coalesce(checks.parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))
            = upper(regexp_replace(p_parcel_id, '[^A-Za-z0-9]', '', 'g'))
        )
        OR (v_addr <> '' AND v_zip IS NOT NULL AND checks.addr_norm = v_addr AND checks.zip5 = v_zip)
      )
  ) INTO v_relist;

  v_expired := p_list_type = 'mls_expired' OR EXISTS (
    SELECT 1
    FROM public.source_list_row_mls_tags AS tag
    WHERE tag.source_list_row_id = p_row_id
      AND tag.mls_tag = 'expired_listing'
      AND tag.strategy = 'wholesale'
      AND tag.list_day <= v_today
  );

  IF v_expired THEN
    -- #812 is not merged. Do not copy its classifier. Fail closed until its ledger exists;
    -- after that, source_list_phone_block_reason_v1 owns the line-check reason.
    IF to_regclass('public.phone_line_checks') IS NULL THEN
      RETURN 'line_check_unknown';
    END IF;
    IF v_owner_changed THEN
      RETURN 'owner_changed';
    END IF;
    IF NOT v_relist THEN
      RETURN 'relist_check_missing';
    END IF;
    IF v_status IN ('listed_active', 'listed_pending') THEN
      RETURN v_status;
    END IF;
    v_minutes := (EXTRACT(HOUR FROM v_local) * 60 + EXTRACT(MINUTE FROM v_local))::integer;
    IF EXTRACT(DOW FROM v_local) = 0 OR v_minutes < 540 OR v_minutes >= 1140 THEN
      RETURN 'outside_calling_hours';
    END IF;
    IF NOT public.expired_owner_confirmed() THEN
      RETURN 'expired_owner_confirm_pending';
    END IF;
    RETURN NULL;
  END IF;

  IF v_owner_changed THEN
    RETURN 'owner_changed';
  END IF;
  IF v_status IN ('listed_active', 'listed_pending', 'sold_new_owner', 'listing_check_unknown') THEN
    RETURN v_status;
  END IF;
  IF v_status = 'off_market_ok' AND v_day = v_today THEN
    RETURN NULL;
  END IF;
  RETURN 'market_check_missing';
END;
$function$;

REVOKE ALL ON FUNCTION public.source_list_market_block_reason_v1(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_market_block_reason_v1(uuid, text, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.source_list_market_block_reason_v1(uuid, text, text, uuid, text) IS
  'Market half of the dialer export scrub. Phone DNC, fan-out, and line checks stay in source_list_phone_block_reason_v1, which reads dialer_suppression_class_v1. This adds owner_changed, active_high_price, relist_check_missing, expired_owner_confirm_pending, and the listed/sold fail-closed statuses. It is a no-op until MLS_MARKET_CHECK_ENABLED is true.';

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
  COALESCE(
    public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id),
    public.source_list_market_block_reason_v1(
      dialed.source_list_row_id,
      dialed.parcel_id,
      dialed.address,
      dialed.prospect_id,
      dialed.list_type
    )
  ) AS block_reason,
  (
    public.mls_market_check_enabled()
    AND (
      dialed.list_type = 'mls_expired'
      OR EXISTS (
        SELECT 1
        FROM public.source_list_row_mls_tags AS tag
        WHERE tag.source_list_row_id = dialed.source_list_row_id
          AND tag.mls_tag = 'expired_listing'
          AND tag.list_day <= (timezone('America/Chicago', clock_timestamp()))::date
      )
    )
  ) AS requires_licensee_disclosure,
  (dialed.state = 'KS') AS ks_license_unconfirmed,
  CASE
    WHEN dialed.list_type = 'mls_expired' OR EXISTS (
      SELECT 1
      FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = dialed.source_list_row_id
        AND tag.mls_tag = 'expired_listing'
        AND tag.list_day <= (timezone('America/Chicago', clock_timestamp()))::date
    ) THEN 'owner_override_2026-11-14'
    ELSE dialed.list_type
  END AS basis
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
    list.source_file_name
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
  WHERE (
    row.status IN ('ready', 'loaded_to_dialer')
    OR (
      public.mls_market_check_enabled()
      AND row.list_type = 'mls_expired'
      AND row.status = 'new_needs_skip'
    )
  )
  AND (
    row.list_day IS NULL
    OR row.list_day <= (timezone('America/Chicago', clock_timestamp()))::date
  )
  ORDER BY
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
    (phone.phone_origin = 'prospect_phone') DESC
) AS dialed;

CREATE OR REPLACE VIEW public.source_list_dialer_export
WITH (security_invoker = true) AS
SELECT
  source_list_row_id,
  source_list_id,
  list_type,
  county,
  state,
  violation_kind,
  parcel_id,
  case_id,
  address,
  owner_names,
  amount_owed,
  property_id,
  prospect_id,
  row_status,
  phone_e164,
  phone_origin,
  pull_date,
  source_file_name,
  requires_licensee_disclosure,
  ks_license_unconfirmed,
  basis
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL;

CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
WITH (security_invoker = true) AS
SELECT *
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NOT NULL;

CREATE OR REPLACE VIEW public.review_high_price
WITH (security_invoker = true) AS
SELECT
  row.id AS source_list_row_id,
  row.address,
  row.parcel_id,
  row.state,
  row.list_type AS basis,
  tag.strategy,
  tag.list_day,
  tag.source_check_id,
  checks.mls_number,
  checks.list_price,
  checks.zip5,
  threshold.min_list_price,
  threshold.method
FROM public.source_list_row_mls_tags AS tag
JOIN public.source_list_rows AS row ON row.id = tag.source_list_row_id
JOIN public.property_market_checks AS checks ON checks.id = tag.source_check_id
LEFT JOIN public.mls_price_thresholds AS threshold ON threshold.zip5 = checks.zip5
WHERE tag.mls_tag = 'active_high_price'
  AND tag.strategy = 'novation_traditional';

COMMENT ON VIEW public.review_high_price IS
  'Active listings at or above the per-zip min_list_price. They stay out of the wholesale dialer export.';

REVOKE ALL ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed, public.review_high_price
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed, public.review_high_price
  TO service_role;

COMMENT ON VIEW public.source_list_dialer_export IS
  'Wholesale dialer file. Drops phones blocked by dialer_suppression_class_v1 and, when MLS_MARKET_CHECK_ENABLED is true, by the market check. basis is the lead source. ks_license_unconfirmed is true for KS rows.';

DO $seed$
DECLARE
  parcel_sql text := 'NULL::text';
  parcel_present boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'parcel_id'
  ) INTO parcel_present;
  IF parcel_present THEN
    parcel_sql := 'nullif(btrim(lead.parcel_id), '''')';
  END IF;
  EXECUTE format($insert$
    INSERT INTO public.property_market_checks (
      parcel_id, addr_norm, zip5, source, checked_at, list_day,
      export_file_sha256, mls_number, list_status_raw, listing_status,
      close_date, list_price, owner_on_roll, owner_changed
    )
    SELECT
      %s,
      nullif(public.normalize_market_address(lead.property_address), ''),
      public.market_zip5(coalesce(lead.zip, lead.property_address)),
      'crm_lead',
      coalesce(lead.dead_at, lead.updated_at, clock_timestamp()),
      (coalesce(lead.dead_at, lead.updated_at, clock_timestamp()) AT TIME ZONE 'America/Chicago')::date,
      NULL,
      NULL,
      coalesce(lead.dead_reason, lead.call_result),
      CASE
        WHEN lower(coalesce(lead.dead_reason, '')) IN ('listed', 'listed_agent')
          OR lower(regexp_replace(coalesce(lead.call_result, ''), '[[:space:]-]+', '_', 'g')) IN ('listed', 'listed_agent')
          THEN 'listed_active'
        ELSE 'sold_new_owner'
      END,
      NULL,
      NULL,
      NULL,
      false
    FROM public.leads AS lead
    WHERE (
      lower(coalesce(lead.dead_reason, '')) IN ('listed', 'listed_agent', 'already_sold', 'sold', 'sold_or_competitor')
      OR lower(regexp_replace(coalesce(lead.call_result, ''), '[[:space:]-]+', '_', 'g')) IN (
        'listed', 'listed_agent', 'already_sold', 'sold', 'sold_or_competitor'
      )
    )
    AND (
      (%s) IS NOT NULL
      OR nullif(public.normalize_market_address(lead.property_address), '') IS NOT NULL
    )
  $insert$, parcel_sql, parcel_sql);
END
$seed$;

COMMENT ON TABLE public.property_market_checks IS
  'Append-only Heartland Matrix and CRM lead market checks. off_market_ok counts for its list_day only. The Matrix file itself is never stored here.';
