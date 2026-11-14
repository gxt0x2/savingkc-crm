-- Unified source lists for county and city lead files.
--
-- Tax-delinquent, probate, foreclosure, and code-violation files used to live
-- outside the CRM. This migration adds the file ledger, one current row per
-- parcel or case, and a dialer export that scrubs opt-out and do-not-call
-- data when it is read. It does not change existing rows, and it does not
-- read or write mojo_call_queue.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.source_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type text NOT NULL,
  county text,
  state text,
  violation_kind text,
  pull_date date NOT NULL,
  source_url text,
  notes text,
  source_file_name text NOT NULL,
  source_file_sha256 text NOT NULL,
  source_file_bytes integer NOT NULL,
  imported_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_lists_list_type_check CHECK (
    list_type IN (
      'tax_delinquent',
      'probate_estate',
      'probate_no_property',
      'foreclosure',
      'code_violation'
    )
  ),
  CONSTRAINT source_lists_county_check CHECK (
    county IS NULL OR county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
  ),
  CONSTRAINT source_lists_state_check CHECK (state IS NULL OR state IN ('MO', 'KS')),
  CONSTRAINT source_lists_violation_kind_check CHECK (
    (list_type = 'code_violation' AND violation_kind IN ('dangerous_building', 'board_up', 'structural'))
    OR (list_type <> 'code_violation' AND violation_kind IS NULL)
  ),
  CONSTRAINT source_lists_county_state_pair_check CHECK (
    county IS NULL
    OR (county IN ('jackson', 'clay', 'platte') AND state = 'MO')
    OR (county IN ('johnson', 'wyandotte') AND state = 'KS')
  ),
  CONSTRAINT source_lists_lane_check CHECK (
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
  ),
  CONSTRAINT source_lists_pull_date_check CHECK (pull_date >= DATE '2000-01-01' AND pull_date <= DATE '2100-01-01'),
  CONSTRAINT source_lists_source_url_check CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  CONSTRAINT source_lists_notes_check CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT source_lists_file_name_check CHECK (char_length(source_file_name) BETWEEN 1 AND 200),
  CONSTRAINT source_lists_file_sha_check CHECK (source_file_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_lists_file_bytes_check CHECK (source_file_bytes >= 0 AND source_file_bytes <= 5000000),
  CONSTRAINT source_lists_imported_by_check CHECK (char_length(imported_by) BETWEEN 1 AND 320)
);

CREATE UNIQUE INDEX IF NOT EXISTS source_lists_file_identity
  ON public.source_lists (
    list_type,
    (coalesce(county, '')),
    (coalesce(state, '')),
    (coalesce(violation_kind, '')),
    pull_date,
    source_file_sha256
  );

CREATE INDEX IF NOT EXISTS idx_source_lists_lane_pull
  ON public.source_lists (list_type, county, pull_date DESC);

COMMENT ON TABLE public.source_lists IS
  'One row per imported source file. Re-importing the same bytes for the same lane and pull date reuses this row.';

CREATE OR REPLACE FUNCTION public.source_list_phones_valid_v1(p_phones text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT coalesce(cardinality(p_phones), 0) <= 8
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p_phones, ARRAY[]::text[])) AS phone
      WHERE phone IS NULL OR phone = '' OR phone <> btrim(phone) OR char_length(phone) > 40
    );
$function$;

REVOKE ALL ON FUNCTION public.source_list_phones_valid_v1(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_phones_valid_v1(text[]) TO service_role;

CREATE TABLE IF NOT EXISTS public.source_list_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_id uuid NOT NULL REFERENCES public.source_lists(id) ON DELETE RESTRICT,
  list_type text NOT NULL,
  county text,
  state text,
  violation_kind text,
  match_key text NOT NULL,
  parcel_id text,
  case_id text,
  address text,
  owner_names text,
  amount_owed numeric,
  phones text[] NOT NULL DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  property_id uuid REFERENCES public.crm_properties(id) ON DELETE SET NULL,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new',
  status_reason text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_list_rows_list_type_check CHECK (
    list_type IN (
      'tax_delinquent',
      'probate_estate',
      'probate_no_property',
      'foreclosure',
      'code_violation'
    )
  ),
  CONSTRAINT source_list_rows_county_check CHECK (
    county IS NULL OR county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
  ),
  CONSTRAINT source_list_rows_state_check CHECK (state IS NULL OR state IN ('MO', 'KS')),
  CONSTRAINT source_list_rows_violation_kind_check CHECK (
    (list_type = 'code_violation' AND violation_kind IN ('dangerous_building', 'board_up', 'structural'))
    OR (list_type <> 'code_violation' AND violation_kind IS NULL)
  ),
  CONSTRAINT source_list_rows_county_state_pair_check CHECK (
    county IS NULL
    OR (county IN ('jackson', 'clay', 'platte') AND state = 'MO')
    OR (county IN ('johnson', 'wyandotte') AND state = 'KS')
  ),
  CONSTRAINT source_list_rows_lane_check CHECK (
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
  ),
  CONSTRAINT source_list_rows_match_key_check CHECK (
    match_key ~ '^(parcel|case):[A-Z0-9][A-Z0-9:./_-]{0,79}$'
  ),
  CONSTRAINT source_list_rows_match_alignment_check CHECK (
    (left(match_key, 7) = 'parcel:' AND parcel_id = substr(match_key, 8))
    OR (left(match_key, 5) = 'case:' AND case_id = substr(match_key, 6))
  ),
  CONSTRAINT source_list_rows_status_check CHECK (
    status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer')
  ),
  CONSTRAINT source_list_rows_address_check CHECK (address IS NULL OR char_length(address) <= 500),
  CONSTRAINT source_list_rows_owner_names_check CHECK (owner_names IS NULL OR char_length(owner_names) <= 500),
  CONSTRAINT source_list_rows_status_reason_check CHECK (status_reason IS NULL OR char_length(status_reason) <= 500),
  CONSTRAINT source_list_rows_phones_check CHECK (public.source_list_phones_valid_v1(phones)),
  CONSTRAINT source_list_rows_raw_check CHECK (jsonb_typeof(raw) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS source_list_rows_natural_key
  ON public.source_list_rows (
    list_type,
    (coalesce(county, '')),
    (coalesce(state, '')),
    (coalesce(violation_kind, '')),
    match_key
  );

CREATE INDEX IF NOT EXISTS idx_source_list_rows_list
  ON public.source_list_rows (source_list_id);

CREATE INDEX IF NOT EXISTS idx_source_list_rows_status
  ON public.source_list_rows (list_type, county, status);

CREATE INDEX IF NOT EXISTS idx_source_list_rows_property
  ON public.source_list_rows (property_id)
  WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_list_rows_prospect
  ON public.source_list_rows (prospect_id)
  WHERE prospect_id IS NOT NULL;

COMMENT ON TABLE public.source_list_rows IS
  'Current source-list row for one parcel or case in a lane. Links to crm_properties and prospects when exactly one existing record matches. Does not copy those tables.';

COMMENT ON COLUMN public.source_list_rows.status IS
  'new, needs_check, ready, excluded_entity, dropped, or loaded_to_dialer. Import never promotes a row to ready and never clears excluded_entity, dropped, or loaded_to_dialer.';

CREATE TABLE IF NOT EXISTS public.source_list_row_files (
  source_list_id uuid NOT NULL REFERENCES public.source_lists(id) ON DELETE RESTRICT,
  source_list_row_id uuid NOT NULL REFERENCES public.source_list_rows(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_list_id, source_list_row_id)
);

COMMENT ON TABLE public.source_list_row_files IS
  'Every source file that has upserted a row. The row keeps the latest source_list_id, and this table keeps the earlier files.';

CREATE TABLE IF NOT EXISTS public.source_list_row_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list_row_id uuid NOT NULL REFERENCES public.source_list_rows(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  status_reason text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_list_row_status_history_from_check CHECK (
    from_status IS NULL
    OR from_status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer')
  ),
  CONSTRAINT source_list_row_status_history_to_check CHECK (
    to_status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer')
  ),
  CONSTRAINT source_list_row_status_history_reason_check CHECK (
    status_reason IS NULL OR char_length(status_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_source_list_row_status_history_row
  ON public.source_list_row_status_history (source_list_row_id, changed_at DESC, id DESC);

COMMENT ON TABLE public.source_list_row_status_history IS
  'Append-only status log for source list rows. Written by trigger when status or status_reason changes.';

ALTER TABLE public.source_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_list_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_list_row_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_list_row_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.source_lists, public.source_list_rows, public.source_list_row_files,
  public.source_list_row_status_history
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.source_lists, public.source_list_rows TO service_role;
GRANT SELECT, INSERT ON TABLE public.source_list_row_files, public.source_list_row_status_history TO service_role;

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
      AND violation_kind NOT IN ('dangerous_building', 'board_up', 'structural')
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
      AND state = 'MO'
      AND (county IS NULL OR county IN ('jackson', 'clay', 'platte'))
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

CREATE OR REPLACE FUNCTION public.source_list_identity_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.list_type IS DISTINCT FROM OLD.list_type
    OR NEW.county IS DISTINCT FROM OLD.county
    OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.violation_kind IS DISTINCT FROM OLD.violation_kind
    OR NEW.pull_date IS DISTINCT FROM OLD.pull_date
    OR NEW.source_file_sha256 IS DISTINCT FROM OLD.source_file_sha256
  THEN
    RAISE EXCEPTION 'source_list_identity_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS source_list_identity_guard ON public.source_lists;
CREATE TRIGGER source_list_identity_guard
  BEFORE UPDATE ON public.source_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.source_list_identity_guard_v1();

CREATE OR REPLACE FUNCTION public.source_list_row_lane_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.source_lists AS list
    WHERE list.id = NEW.source_list_id
      AND list.list_type = NEW.list_type
      AND list.county IS NOT DISTINCT FROM NEW.county
      AND list.state IS NOT DISTINCT FROM NEW.state
      AND list.violation_kind IS NOT DISTINCT FROM NEW.violation_kind
  ) THEN
    RAISE EXCEPTION 'source_list_lane_mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS source_list_row_lane_guard ON public.source_list_rows;
CREATE TRIGGER source_list_row_lane_guard
  BEFORE INSERT OR UPDATE OF source_list_id, list_type, county, state, violation_kind
  ON public.source_list_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.source_list_row_lane_guard_v1();

CREATE OR REPLACE FUNCTION public.source_list_row_status_stamp_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := coalesce(NEW.status_changed_at, now());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS source_list_row_status_stamp ON public.source_list_rows;
CREATE TRIGGER source_list_row_status_stamp
  BEFORE INSERT OR UPDATE OF status ON public.source_list_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.source_list_row_status_stamp_v1();

CREATE OR REPLACE FUNCTION public.source_list_row_status_history_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.status_reason IS NOT DISTINCT FROM OLD.status_reason
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.source_list_row_status_history (
    source_list_row_id, from_status, to_status, status_reason, changed_by
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    NEW.status_reason,
    NEW.updated_by
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS source_list_row_status_history ON public.source_list_rows;
CREATE TRIGGER source_list_row_status_history
  AFTER INSERT OR UPDATE OF status, status_reason ON public.source_list_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.source_list_row_status_history_v1();

REVOKE ALL ON FUNCTION public.source_list_identity_guard_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_row_lane_guard_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_row_status_stamp_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_row_status_history_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_identity_guard_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_row_lane_guard_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_row_status_stamp_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_row_status_history_v1() TO service_role;

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
  v_case_first := v_lane.list_type IN ('probate_estate', 'probate_no_property', 'foreclosure');

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
      incoming.raw,
      incoming.match_key,
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
  ),
  upserted AS (
    INSERT INTO public.source_list_rows (
      source_list_id, list_type, county, state, violation_kind, match_key,
      parcel_id, case_id, address, owner_names, amount_owed, phones, raw,
      property_id, prospect_id, status, status_reason, updated_by,
      created_at, updated_at, status_changed_at
    )
    SELECT
      v_list_id, v_lane.list_type, v_lane.county, v_lane.state, v_lane.violation_kind,
      resolved.match_key, resolved.parcel_id, resolved.case_id, resolved.address,
      resolved.owner_names, resolved.amount_owed, resolved.phones, resolved.raw,
      CASE WHEN resolved.ambiguous THEN NULL ELSE resolved.property_id END,
      CASE WHEN resolved.ambiguous THEN NULL ELSE resolved.prospect_id END,
      CASE WHEN resolved.ambiguous THEN 'needs_check' ELSE 'new' END,
      resolved.status_reason,
      v_actor, v_stamp, v_stamp, v_stamp
    FROM resolved
    ON CONFLICT (
      list_type,
      (coalesce(county, '')),
      (coalesce(state, '')),
      (coalesce(violation_kind, '')),
      match_key
    )
    DO UPDATE SET
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

REVOKE ALL ON FUNCTION public.import_source_list_v1(
  text, text, text, text, date, text, text, text, text, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_source_list_v1(
  text, text, text, text, date, text, text, text, text, integer, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.import_source_list_v1(
  text, text, text, text, date, text, text, text, text, integer, text, jsonb
) IS
  'Idempotent source-file import. Upserts by parcel or case inside the lane, records the file, and links an existing property or prospect when exactly one matches. Does not create prospects or properties.';

CREATE OR REPLACE FUNCTION public.set_source_list_row_status_v1(
  p_row_id uuid,
  p_status text,
  p_status_reason text,
  p_actor text
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
    'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer'
  ) THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;

  UPDATE public.source_list_rows
  SET status = v_status,
      status_reason = v_reason,
      updated_by = v_actor,
      updated_at = clock_timestamp()
  WHERE id = p_row_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'source_list_row_not_found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'status_reason', v_row.status_reason,
    'status_changed_at', v_row.status_changed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN public.normalize_conversation_phone(p_phone) IS NULL THEN 'invalid_phone'
    WHEN EXISTS (
      SELECT 1
      FROM public.sms_opt_outs AS opt_out
      WHERE opt_out.is_opted_out IS TRUE
        AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'sms_opt_out'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE phone.voice_hold IS TRUE
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'voice_hold'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE lower(coalesce(phone.last_disposition, '')) IN ('dnc', 'do_not_call')
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'prospect_dnc'
    WHEN EXISTS (
      SELECT 1
      FROM public.crm_contact_methods AS method
      WHERE method.method_type = 'phone'
        AND method.sms_consent_status = 'opted_out'
        AND public.prospecting_phone_key_v1(method.normalized_value) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'contact_opt_out'
    WHEN EXISTS (
      SELECT 1
      FROM public.crm_contact_methods AS method
      WHERE method.method_type = 'phone'
        AND method.deliverability_status = 'blocked'
        AND public.prospecting_phone_key_v1(method.normalized_value) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'contact_blocked'
    WHEN EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(coalesce(lead.dead_reason, '')) IN ('dnc_refused', 'dnc', 'do_not_call')
          OR lower(regexp_replace(coalesce(lead.call_result, ''), '[[:space:]-]+', '_', 'g')) IN ('dnc', 'do_not_call')
        )
    ) THEN 'lead_dnc'
    ELSE NULL
  END;
$function$;

REVOKE ALL ON FUNCTION public.source_list_phone_block_reason_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text) TO service_role;

COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text) IS
  'Live opt-out and do-not-call scrub. Returns a reason, or null when the number may be exported. Evaluated at read time.';

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
  public.source_list_phone_block_reason_v1(dialed.phone_value) AS block_reason
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
  WHERE row.status IN ('ready', 'loaded_to_dialer')
  ORDER BY
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
    (phone.phone_origin = 'prospect_phone') DESC
) AS dialed;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. Do not load the dialer from this view.';

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
  source_file_name
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL;

COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Only ready or loaded_to_dialer rows, and only phones that are clear of opt-out and do-not-call data at the moment of the query.';

CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
WITH (security_invoker = true) AS
SELECT *
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NOT NULL;

COMMENT ON VIEW public.source_list_dialer_suppressed IS
  'Phones removed from the dialer export by the live scrub, with the reason.';

REVOKE ALL ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed
  TO service_role;
