-- Fix round for the listed/sold market check.
-- Expired rows stay on the expired gate even when MLS_MARKET_CHECK_ENABLED is false.
-- EXPIRED_OWNER_CONFIRMED stays false until a recorded SQL change cites EXC-2026-11-14-003.
-- This does not read or write the dialer queue.

INSERT INTO public.mls_market_config (key, value) VALUES
  ('PHONE_LINE_CHECKS_ENFORCED', 'false'),
  ('KS_EXPIRED_RELEASE_APPROVED', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mls_market_flag_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL,
  new_value text NOT NULL,
  citation text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.mls_market_flag_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mls_market_flag_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mls_market_flag_changes TO service_role;

CREATE OR REPLACE FUNCTION public.record_mls_market_flag_v1(p_key text, p_value text, p_citation text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- KS_EXPIRED_RELEASE_APPROVED stays false until a future written release.
  -- This citation cannot raise it.
  IF p_key IS DISTINCT FROM 'EXPIRED_OWNER_CONFIRMED' AND p_key IS DISTINCT FROM 'MLS_MARKET_CHECK_ENABLED'
    AND p_key IS DISTINCT FROM 'PHONE_LINE_CHECKS_ENFORCED' THEN
    RAISE EXCEPTION 'mls_market_flag_unknown';
  END IF;
  IF p_value IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'mls_market_flag_raise_only';
  END IF;
  IF btrim(coalesce(p_citation, '')) IS DISTINCT FROM 'EXC-2026-11-14-003' THEN
    RAISE EXCEPTION 'mls_market_flag_citation_required';
  END IF;
  UPDATE public.mls_market_config
  SET value = 'true', updated_at = clock_timestamp()
  WHERE key = p_key;
  INSERT INTO public.mls_market_flag_changes (flag_key, new_value, citation)
  VALUES (p_key, 'true', 'EXC-2026-11-14-003');
END;
$function$;

REVOKE ALL ON FUNCTION public.record_mls_market_flag_v1(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mls_market_flag_v1(text, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.sync_mls_market_flags_v1(text, text);

CREATE OR REPLACE FUNCTION public.sync_mls_market_flags_v1(
  p_market_check_enabled text DEFAULT NULL,
  p_expired_owner_confirmed text DEFAULT NULL,
  p_ks_expired_release_approved text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Env sync may only lower a flag. Raising one requires record_mls_market_flag_v1.
  -- KS_EXPIRED_RELEASE_APPROVED cannot be raised from env sync.
  IF p_market_check_enabled = 'false' THEN
    UPDATE public.mls_market_config
    SET value = 'false', updated_at = clock_timestamp()
    WHERE key = 'MLS_MARKET_CHECK_ENABLED' AND value IS DISTINCT FROM 'false';
  END IF;
  IF p_expired_owner_confirmed = 'false' THEN
    UPDATE public.mls_market_config
    SET value = 'false', updated_at = clock_timestamp()
    WHERE key = 'EXPIRED_OWNER_CONFIRMED' AND value IS DISTINCT FROM 'false';
  END IF;
  IF p_ks_expired_release_approved = 'false' THEN
    UPDATE public.mls_market_config
    SET value = 'false', updated_at = clock_timestamp()
    WHERE key = 'KS_EXPIRED_RELEASE_APPROVED' AND value IS DISTINCT FROM 'false';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_mls_market_flags_v1(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_mls_market_flags_v1(text, text, text) TO service_role;

ALTER TABLE public.source_list_row_status_history DROP CONSTRAINT IF EXISTS source_list_row_status_history_from_check;
ALTER TABLE public.source_list_row_status_history DROP CONSTRAINT IF EXISTS source_list_row_status_history_to_check;
ALTER TABLE public.source_list_row_status_history
  ADD CONSTRAINT source_list_row_status_history_from_check CHECK (
    from_status IS NULL OR from_status IN (
      'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'new_needs_skip'
    )
  );
ALTER TABLE public.source_list_row_status_history
  ADD CONSTRAINT source_list_row_status_history_to_check CHECK (
    to_status IN (
      'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'new_needs_skip'
    )
  );

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
    'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'new_needs_skip'
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
    IF NOT EXISTS (SELECT 1 FROM public.source_list_export_batches WHERE id = p_export_batch_id) THEN
      RAISE EXCEPTION 'source_list_export_batch_not_found';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.source_list_export_batch_phones AS phone
      WHERE phone.export_batch_id = p_export_batch_id AND phone.source_list_row_id = p_row_id
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
      loaded_export_batch_id = CASE WHEN v_status = 'loaded_to_dialer' THEN p_export_batch_id ELSE loaded_export_batch_id END
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

CREATE TABLE IF NOT EXISTS public.property_market_latest (
  property_key text PRIMARY KEY,
  parcel_key text,
  addr_norm text,
  zip5 text,
  listing_status text NOT NULL,
  list_day date NOT NULL,
  source text NOT NULL,
  owner_changed boolean NOT NULL DEFAULT false,
  owner_check_unknown boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL,
  check_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_property_market_latest_parcel
  ON public.property_market_latest (parcel_key);
CREATE INDEX IF NOT EXISTS idx_property_market_latest_addr
  ON public.property_market_latest (addr_norm, zip5);

ALTER TABLE public.property_market_latest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.property_market_latest FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.property_market_latest TO service_role;

DO $index$
BEGIN
  IF to_regclass('public.parcel_inventory') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS idx_parcel_inventory_owner_latest
      ON public.parcel_inventory (
        (upper(regexp_replace(coalesce(parcel_id, ''), '[^A-Za-z0-9]', '', 'g'))),
        created_at DESC
      )
    $sql$;
  END IF;
END
$index$;

CREATE OR REPLACE FUNCTION public.market_status_rank_v1(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_status
    WHEN 'listed_active' THEN 7
    WHEN 'listed_pending' THEN 6
    WHEN 'sold_new_owner' THEN 5
    WHEN 'listed_withdrawn' THEN 4
    WHEN 'listing_check_unknown' THEN 3
    WHEN 'listing_expired' THEN 2
    WHEN 'off_market_ok' THEN 0
    ELSE 3
  END;
$function$;

CREATE OR REPLACE FUNCTION public.owner_name_verdict_v1(p_roll text, p_prospect text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH tokens AS (
    SELECT public.normalize_owner_name(p_roll) AS roll_name,
           public.normalize_owner_name(p_prospect) AS prospect_name
  ), split AS (
    SELECT
      ARRAY(SELECT token FROM regexp_split_to_table(roll_name, ' ') AS token WHERE token <> '') AS roll_tokens,
      ARRAY(SELECT token FROM regexp_split_to_table(prospect_name, ' ') AS token WHERE token <> '') AS prospect_tokens
    FROM tokens
  )
  SELECT CASE
    WHEN cardinality(roll_tokens) = 0 OR cardinality(prospect_tokens) = 0 THEN 'unknown'
    WHEN roll_tokens <@ prospect_tokens OR prospect_tokens <@ roll_tokens THEN 'same'
    ELSE 'changed'
  END
  FROM split;
$function$;

ALTER TABLE public.mls_export_runs
  ADD COLUMN IF NOT EXISTS complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skipped jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.market_calling_window_open_v1(p_at timestamptz DEFAULT clock_timestamp())
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT EXTRACT(ISODOW FROM timezone('America/Chicago', p_at)) BETWEEN 1 AND 6
    AND (timezone('America/Chicago', p_at))::time >= time '09:00'
    AND (timezone('America/Chicago', p_at))::time < time '17:00';
$function$;

REVOKE ALL ON FUNCTION public.market_calling_window_open_v1(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_calling_window_open_v1(timestamptz) TO service_role;

COMMENT ON FUNCTION public.market_calling_window_open_v1(timestamptz) IS
  'Monday-Saturday 09:00 inclusive through 17:00 exclusive, America/Chicago. Sunday and 17:00 are closed.';

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
    SELECT lower(btrim(prospect.county))
    INTO v_county
    FROM public.prospects AS prospect
    WHERE upper(regexp_replace(coalesce(prospect.parcel_id, ''), '[^A-Za-z0-9]', '', 'g')) = v_parcel
      AND nullif(btrim(coalesce(prospect.county, '')), '') IS NOT NULL
    LIMIT 1;
    v_state := CASE
      WHEN v_county IN ('johnson', 'wyandotte') THEN 'KS'
      WHEN v_county IN ('jackson', 'clay', 'platte') THEN 'MO'
      ELSE NULL
    END;
  END IF;
  IF v_county IN ('unknown', 'unresolved') OR v_county IS NULL OR v_state IS NULL THEN
    county := NULL;
    state := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF (v_county IN ('jackson', 'clay', 'platte') AND v_state = 'MO')
    OR (v_county IN ('wyandotte', 'johnson') AND v_state = 'KS') THEN
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

DROP FUNCTION IF EXISTS public.source_list_market_block_reason_v1(uuid, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.source_list_market_block_reason_v1(
  p_row_id uuid,
  p_parcel_id text,
  p_address text,
  p_prospect_id uuid,
  p_list_type text,
  p_phone_origin text DEFAULT NULL,
  p_phone text DEFAULT NULL
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
  v_parcel text := upper(regexp_replace(coalesce(p_parcel_id, ''), '[^A-Za-z0-9]', '', 'g'));
  v_expired boolean := false;
  v_status text;
  v_day date;
  v_source text;
  v_owner_changed boolean := false;
  v_owner_unknown boolean := false;
  v_digits text;
  v_line text;
  v_row_county text;
  v_row_state text;
BEGIN
  v_expired := p_list_type = 'mls_expired' OR EXISTS (
    SELECT 1
    FROM public.source_list_row_mls_tags AS tag
    WHERE tag.source_list_row_id = p_row_id
      AND tag.mls_tag = 'expired_listing'
      AND tag.list_day <= v_today
  );

  SELECT latest.listing_status, latest.list_day, latest.source, latest.owner_changed, latest.owner_check_unknown
  INTO v_status, v_day, v_source, v_owner_changed, v_owner_unknown
  FROM public.property_market_latest AS latest
  WHERE (v_parcel <> '' AND latest.parcel_key = v_parcel)
     OR (v_addr <> '' AND v_zip IS NOT NULL AND latest.addr_norm = v_addr AND latest.zip5 = v_zip)
  ORDER BY public.market_status_rank_v1(latest.listing_status) DESC, latest.checked_at DESC
  LIMIT 1;

  IF v_expired THEN
    SELECT lower(btrim(coalesce(row.county, ''))), upper(btrim(coalesce(row.state, '')))
    INTO v_row_county, v_row_state
    FROM public.source_list_rows AS row
    WHERE row.id = p_row_id;
    IF NOT public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
      AND (v_row_state = 'KS' OR v_row_county IN ('wyandotte', 'johnson')) THEN
      RETURN 'ks_license_unconfirmed';
    END IF;
    IF NOT public.expired_owner_confirmed() THEN
      RETURN 'expired_owner_confirm_pending';
    END IF;
    IF p_prospect_id IS NULL OR p_phone_origin IS DISTINCT FROM 'prospect_phone' THEN
      RETURN 'owner_match_missing';
    END IF;
    IF to_regclass('public.prospect_phones') IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE phone.prospect_id = p_prospect_id
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND lower(btrim(coalesce(phone.relationship, ''))) IN ('owner', 'self', 'title', 'primary', 'primary_owner')
    ) THEN
      RETURN 'relationship_unknown';
    END IF;
    IF NOT public.mls_config_flag_v1('PHONE_LINE_CHECKS_ENFORCED')
      OR to_regclass('public.phone_line_checks') IS NULL THEN
      RETURN 'line_check_unknown';
    END IF;
    v_digits := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
    SELECT checks.line_status
    INTO v_line
    FROM public.phone_line_checks AS checks
    WHERE right(regexp_replace(checks.phone_e164, '[^0-9]', '', 'g'), 10) = v_digits
      AND length(v_digits) = 10
      AND checks.checked_at >= clock_timestamp() - interval '30 days'
    ORDER BY checks.checked_at DESC
    LIMIT 1;
    IF v_line IS DISTINCT FROM 'active' THEN
      RETURN 'line_check_unknown';
    END IF;
    IF coalesce(v_owner_unknown, false) OR v_parcel = '' THEN
      RETURN 'owner_check_unknown';
    END IF;
    IF coalesce(v_owner_changed, false) THEN
      RETURN 'owner_changed';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.mls_export_runs AS run
      WHERE run.chicago_day = v_today
        AND run.status = 'loaded'
        AND run.complete IS TRUE
    ) OR v_source IS DISTINCT FROM 'heartland_matrix' OR v_day IS DISTINCT FROM v_today THEN
      RETURN 'relist_check_missing';
    END IF;
    IF v_status IS DISTINCT FROM 'listing_expired' AND v_status IS DISTINCT FROM 'off_market_ok' THEN
      RETURN coalesce(v_status, 'relist_check_missing');
    END IF;
    IF NOT public.market_calling_window_open_v1() THEN
      RETURN 'outside_calling_hours';
    END IF;
    RETURN NULL;
  END IF;

  IF NOT public.mls_market_check_enabled() THEN
    RETURN NULL;
  END IF;
  IF v_status = 'listed_active'
    AND v_day = v_today
    AND v_source = 'heartland_matrix'
    AND EXISTS (
      SELECT 1 FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = p_row_id
        AND tag.mls_tag = 'active_high_price'
        AND tag.list_day = v_today
    ) THEN
    RETURN 'active_high_price';
  END IF;
  IF coalesce(v_owner_changed, false) THEN
    RETURN 'owner_changed';
  END IF;
  IF v_status IN ('listed_active', 'listed_pending', 'sold_new_owner', 'listed_withdrawn', 'listing_check_unknown') THEN
    RETURN v_status;
  END IF;
  IF v_status = 'off_market_ok' AND v_day = v_today THEN
    RETURN NULL;
  END IF;
  RETURN 'market_check_missing';
END;
$function$;

REVOKE ALL ON FUNCTION public.source_list_market_block_reason_v1(uuid, text, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_market_block_reason_v1(uuid, text, text, uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.rebuild_market_review_v1()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  base_sql text;
  select_list text;
  extra_select text;
BEGIN
  IF to_regclass('public.source_list_dialer_phone_review') IS NULL THEN
    RAISE EXCEPTION 'source_list_dialer_phone_review is missing';
  END IF;
  base_sql := pg_get_viewdef('public.source_list_dialer_phone_review'::regclass, true);
  base_sql := regexp_replace(base_sql, ';[[:space:]]*$', '');
  IF position('source_list_market_block_reason_v1' IN base_sql) > 0
     AND position('new_needs_skip' IN base_sql) > 0 THEN
    RETURN;
  END IF;

  SELECT string_agg(
    CASE
      WHEN column_name = 'block_reason' THEN
        'COALESCE(dialed.block_reason, public.source_list_market_block_reason_v1(dialed.source_list_row_id, dialed.parcel_id, dialed.address, dialed.prospect_id, dialed.list_type, dialed.phone_origin, dialed.phone_value)) AS block_reason'
      ELSE format('dialed.%I', column_name)
    END,
    ', ' ORDER BY ordinal_position
  )
  INTO select_list
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'source_list_dialer_phone_review';

  SELECT string_agg(
    CASE
      WHEN column_name = 'line_check_flag' THEN 'NULL::text AS line_check_flag'
      WHEN column_name = 'block_reason' THEN 'extra.block_reason'
      ELSE format('extra.%I', column_name)
    END,
    ', ' ORDER BY ordinal_position
  )
  INTO extra_select
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'source_list_dialer_phone_review';

  EXECUTE format($view$
    CREATE OR REPLACE VIEW public.source_list_dialer_phone_review
    WITH (security_invoker = true) AS
    SELECT %s
    FROM (
      %s
    ) AS dialed
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.source_list_rows AS future
      WHERE future.id = dialed.source_list_row_id
        AND future.list_day > (timezone('America/Chicago', clock_timestamp()))::date
    )
    UNION ALL
    SELECT %s
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
        COALESCE(
          (
            SELECT found.block_reason
            FROM public.source_list_phone_block_reasons_v1(
              ARRAY[phone.phone_value],
              ARRAY[row.prospect_id],
              ARRAY[row.county],
              ARRAY[coalesce(
                nullif(btrim(row.raw->>'situs_county'), ''),
                nullif(btrim(row.raw->>'county'), ''),
                (
                  SELECT nullif(btrim(prospect.county), '')
                  FROM public.prospects AS prospect
                  WHERE prospect.id = row.prospect_id
                ),
                (
                  SELECT nullif(btrim(property.county), '')
                  FROM public.crm_properties AS property
                  WHERE property.id = row.property_id
                )
              )]
            ) AS found
            LIMIT 1
          ),
          public.source_list_market_block_reason_v1(
            row.id, row.parcel_id, row.address, row.prospect_id, row.list_type, phone.phone_origin, phone.phone_value
          )
        ) AS block_reason
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
      WHERE row.list_type = 'mls_expired'
        AND row.status = 'new_needs_skip'
        AND (row.list_day IS NULL OR row.list_day <= (timezone('America/Chicago', clock_timestamp()))::date)
      ORDER BY row.id,
        coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
        (phone.phone_origin = 'prospect_phone') DESC
    ) AS extra
  $view$, select_list, base_sql, extra_select);
END;
$function$;

SELECT public.rebuild_market_review_v1();

CREATE OR REPLACE FUNCTION public.rebuild_market_export_views_v1()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  export_cols text;
  suppressed_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO export_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'source_list_dialer_export';
  IF export_cols IS NULL THEN
    export_cols := 'source_list_row_id, source_list_id, list_type, county, state, violation_kind, parcel_id, case_id, address, owner_names, amount_owed, property_id, prospect_id, row_status, phone_e164, phone_origin, pull_date, source_file_name';
  END IF;
  EXECUTE format($view$
    CREATE OR REPLACE VIEW public.source_list_dialer_export
    WITH (security_invoker = true) AS
    SELECT %s
    FROM public.source_list_dialer_phone_review
    WHERE block_reason IS NULL
      AND (
        list_type IS DISTINCT FROM 'tax_delinquent'
        OR public.tax_status_export_allowed_v1(parcel_id, county, prospect_id)
      )
  $view$, export_cols);

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO suppressed_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'source_list_dialer_suppressed';
  IF suppressed_cols IS NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
      WITH (security_invoker = true) AS
      SELECT * FROM public.source_list_dialer_phone_review WHERE block_reason IS NOT NULL
    $view$;
  ELSE
    EXECUTE format($view$
      CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
      WITH (security_invoker = true) AS
      SELECT %s
      FROM public.source_list_dialer_phone_review
      WHERE block_reason IS NOT NULL
    $view$, suppressed_cols);
  END IF;
END;
$function$;

SELECT public.rebuild_market_export_views_v1();

CREATE OR REPLACE VIEW public.source_list_market_phone_review
WITH (security_invoker = true) AS
SELECT
  review.*,
  (
    review.list_type = 'mls_expired'
    OR EXISTS (
      SELECT 1 FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = review.source_list_row_id
        AND tag.mls_tag = 'expired_listing'
        AND tag.list_day <= (timezone('America/Chicago', clock_timestamp()))::date
    )
  ) AS requires_licensee_disclosure,
  (
    upper(coalesce(review.state, '')) = 'KS'
    OR lower(coalesce(review.county, '')) IN ('wyandotte', 'johnson')
  ) AS ks_license_unconfirmed,
  CASE
    WHEN review.list_type = 'mls_expired' OR EXISTS (
      SELECT 1 FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = review.source_list_row_id
        AND tag.mls_tag = 'expired_listing'
        AND tag.list_day <= (timezone('America/Chicago', clock_timestamp()))::date
    ) THEN 'owner_override_2026-11-14'
    ELSE review.list_type
  END AS basis,
  CASE
    WHEN review.list_type = 'mls_expired' OR EXISTS (
      SELECT 1 FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = review.source_list_row_id AND tag.mls_tag = 'expired_listing'
    ) THEN 'mon_sat_0900_1700_america_chicago'
    ELSE NULL
  END AS calling_window
FROM public.source_list_dialer_phone_review AS review;

REVOKE ALL ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed, public.source_list_market_phone_review FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed, public.source_list_market_phone_review TO service_role;

ALTER TABLE public.source_list_export_batches DROP CONSTRAINT IF EXISTS source_list_export_batches_list_type_check;
ALTER TABLE public.source_list_export_batches ADD CONSTRAINT source_list_export_batches_list_type_check CHECK (
  list_type IS NULL OR list_type IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation', 'mls_expired'
  )
);
ALTER TABLE public.source_list_export_batches
  ADD COLUMN IF NOT EXISTS export_label text;
ALTER TABLE public.source_list_export_batch_phones
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS requires_licensee_disclosure boolean,
  ADD COLUMN IF NOT EXISTS ks_license_unconfirmed boolean,
  ADD COLUMN IF NOT EXISTS calling_window text;

CREATE OR REPLACE FUNCTION public.dialer_label_coverage_gaps_v1()
RETURNS TABLE (source text, label text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT DISTINCT labeled.source, labeled.label
  FROM (
    SELECT 'prospect_disposition'::text AS source, public.dialer_label_key_v1(last_disposition) AS label
    FROM public.prospect_phones
    UNION ALL
    SELECT 'phone_connected'::text, public.dialer_label_key_v1(phone_connected) FROM public.prospect_phones
    UNION ALL
    SELECT 'lead_call_result'::text, public.dialer_label_key_v1(call_result) FROM public.leads
    UNION ALL
    SELECT 'lead_dead_reason'::text, public.dialer_label_key_v1(dead_reason) FROM public.leads
    UNION ALL
    SELECT 'mojo_outcome'::text, public.dialer_label_key_v1(outcome) FROM public.crm_mojo_call_events
    UNION ALL
    SELECT 'mojo_disposition_raw'::text, public.dialer_label_key_v1(disposition_raw) FROM public.crm_mojo_call_events
    UNION ALL
    SELECT 'mojo_disposition_raw'::text, public.dialer_label_key_v1(result_label) FROM public.crm_mojo_calls
  ) AS labeled
  WHERE labeled.label IS NOT NULL
    AND labeled.label NOT IN (
      'owner_changed', 'owner_check_unknown', 'relist_check_missing', 'listing_check_unknown',
      'active_high_price', 'outside_calling_hours', 'expired_owner_confirm_pending',
      'market_check_missing', 'line_check_unknown', 'owner_match_missing', 'relationship_unknown',
      'licensee_disclosure_required', 'expired_single_line_only', 'ks_license_unconfirmed',
      'listed_active', 'listed_pending', 'sold_new_owner', 'listed_withdrawn', 'listing_expired', 'off_market_ok'
    )
    AND public.dialer_suppression_class_v1(labeled.source, labeled.label) = 'unmapped';
$function$;

CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1(
  p_actor text,
  p_list_type text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_violation_kind text DEFAULT NULL,
  p_source_list_id uuid DEFAULT NULL,
  p_line_mode integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
SET jit = off
AS $function$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_list_type text := nullif(btrim(coalesce(p_list_type, '')), '');
  v_county text := nullif(lower(btrim(coalesce(p_county, ''))), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_kind text := nullif(lower(btrim(coalesce(p_violation_kind, ''))), '');
  v_rows jsonb;
  v_count integer;
  v_batch_id uuid;
  v_gaps text;
  v_excluded_counts jsonb;
  v_excluded_phones jsonb;
  v_label text := NULL;
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_list_type IS NOT NULL AND v_list_type NOT IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation', 'mls_expired'
  ) THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_county IS NOT NULL AND v_county NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_state IS NOT NULL AND v_state NOT IN ('MO', 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('dangerous_building', 'board_up', 'structural') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_list_type = 'mls_expired' AND coalesce(p_line_mode, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expired_single_line_only';
  END IF;
  IF coalesce(p_line_mode, 1) < 1
    OR (public.dialer_multi_line_suspended_v1() AND coalesce(p_line_mode, 1) > 1) THEN
    RAISE EXCEPTION 'multi_line_suspended';
  END IF;

  SELECT coalesce(string_agg(gap.source || '=' || gap.label, ', ' ORDER BY gap.source, gap.label), '')
  INTO v_gaps
  FROM public.dialer_label_coverage_gaps_v1() AS gap;
  IF v_gaps <> '' THEN
    RAISE EXCEPTION 'dialer_label_unmapped: %', v_gaps;
  END IF;

  WITH reviewed AS MATERIALIZED (
    SELECT *
    FROM public.source_list_market_phone_review AS review
    WHERE (v_county IS NULL OR review.county = v_county)
      AND (v_state IS NULL OR review.state = v_state)
      AND (v_kind IS NULL OR review.violation_kind = v_kind)
      AND (p_source_list_id IS NULL OR review.source_list_id = p_source_list_id)
      AND (
        (v_list_type = 'mls_expired' AND (review.list_type = 'mls_expired' OR review.basis = 'owner_override_2026-11-14'))
        OR (
          coalesce(v_list_type, '') <> 'mls_expired'
          AND review.list_type IS DISTINCT FROM 'mls_expired'
          AND review.basis IS DISTINCT FROM 'owner_override_2026-11-14'
          AND (v_list_type IS NULL OR review.list_type = v_list_type)
        )
      )
  )
  SELECT
    coalesce((
      SELECT jsonb_agg(to_jsonb(export_row) ORDER BY export_row.list_type, export_row.county, export_row.parcel_id, export_row.phone_e164)
      FROM reviewed AS export_row
      WHERE export_row.block_reason IS NULL
        AND export_row.phone_e164 IS NOT NULL
        AND (
          export_row.list_type IS DISTINCT FROM 'tax_delinquent'
          OR public.tax_status_export_allowed_v1(export_row.parcel_id, export_row.county, export_row.prospect_id)
        )
        AND (
          (
            export_row.list_type IS DISTINCT FROM 'mls_expired'
            AND export_row.basis IS DISTINCT FROM 'owner_override_2026-11-14'
          )
          OR (
            public.market_calling_window_open_v1()
            AND (
              public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
              OR (
                upper(coalesce(export_row.state, '')) <> 'KS'
                AND lower(coalesce(export_row.county, '')) NOT IN ('wyandotte', 'johnson')
              )
            )
          )
        )
        AND (
          (export_row.list_type IS DISTINCT FROM 'mls_expired' AND export_row.basis IS DISTINCT FROM 'owner_override_2026-11-14')
          OR (
            export_row.requires_licensee_disclosure IS TRUE
            AND export_row.prospect_id IS NOT NULL
            AND export_row.phone_origin = 'prospect_phone'
          )
        )
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_object_agg(counted.reason, counted.n)
      FROM (
        SELECT blocked.export_reason AS reason, count(*) AS n
        FROM (
          SELECT coalesce(
            review.block_reason,
            CASE
              WHEN review.requires_licensee_disclosure IS DISTINCT FROM true THEN 'licensee_disclosure_required'
              ELSE 'owner_match_missing'
            END
          ) AS export_reason
          FROM reviewed AS review
          WHERE review.block_reason IS NOT NULL
            OR (
              (review.list_type = 'mls_expired' OR review.basis = 'owner_override_2026-11-14')
              AND (
                review.requires_licensee_disclosure IS DISTINCT FROM true
                OR review.prospect_id IS NULL
                OR review.phone_origin IS DISTINCT FROM 'prospect_phone'
              )
            )
        ) AS blocked
        GROUP BY blocked.export_reason
      ) AS counted
    ), '{}'::jsonb),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object('reason', samples.reason, 'phone_masked', samples.phone_masked) ORDER BY samples.reason, samples.phone_masked)
      FROM (
        SELECT samples.reason, samples.phone_masked
        FROM (
          SELECT
            coalesce(
              review.block_reason,
              CASE
                WHEN review.requires_licensee_disclosure IS DISTINCT FROM true THEN 'licensee_disclosure_required'
                ELSE 'owner_match_missing'
              END
            ) AS reason,
            public.dialer_phone_mask_v1(coalesce(review.phone_e164, review.phone_value)) AS phone_masked,
            row_number() OVER (
              PARTITION BY coalesce(
                review.block_reason,
                CASE
                  WHEN review.requires_licensee_disclosure IS DISTINCT FROM true THEN 'licensee_disclosure_required'
                  ELSE 'owner_match_missing'
                END
              )
              ORDER BY public.dialer_phone_mask_v1(coalesce(review.phone_e164, review.phone_value))
            ) AS sample_index
          FROM reviewed AS review
          WHERE review.block_reason IS NOT NULL
            OR (
              (review.list_type = 'mls_expired' OR review.basis = 'owner_override_2026-11-14')
              AND (
                review.requires_licensee_disclosure IS DISTINCT FROM true
                OR review.prospect_id IS NULL
                OR review.phone_origin IS DISTINCT FROM 'prospect_phone'
              )
            )
        ) AS samples
        WHERE samples.sample_index <= 20
      ) AS samples
    ), '[]'::jsonb)
  INTO v_rows, v_excluded_counts, v_excluded_phones;

  IF v_list_type = 'mls_expired' AND coalesce(p_line_mode, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expired_single_line_only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rows) AS item
    WHERE item->>'basis' = 'owner_override_2026-11-14'
       OR item->>'list_type' = 'mls_expired'
  ) AND coalesce(p_line_mode, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expired_single_line_only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rows) AS item
    WHERE (item->>'list_type' = 'mls_expired' OR item->>'basis' = 'owner_override_2026-11-14')
      AND coalesce((item->>'requires_licensee_disclosure')::boolean, false) IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'licensee_disclosure_required';
  END IF;

  v_count := jsonb_array_length(v_rows);
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'source_list_export_too_large';
  END IF;
  IF v_list_type = 'mls_expired' THEN
    v_label := 'EXPIRED · licensee disclosure · single-line';
  END IF;

  INSERT INTO public.source_list_export_batches (
    created_by, list_type, county, state, violation_kind, source_list_id, phone_count, export_label
  ) VALUES (
    v_actor, v_list_type, v_county, v_state, v_kind, p_source_list_id, v_count, v_label
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.source_list_export_batch_phones (
    export_batch_id, source_list_row_id, phone_e164, basis,
    requires_licensee_disclosure, ks_license_unconfirmed, calling_window
  )
  SELECT
    v_batch_id,
    (item->>'source_list_row_id')::uuid,
    item->>'phone_e164',
    CASE WHEN item->>'basis' = 'owner_override_2026-11-14' AND v_list_type = 'mls_expired' THEN item->>'basis' ELSE item->>'basis' END,
    coalesce((item->>'requires_licensee_disclosure')::boolean, false),
    coalesce((item->>'ks_license_unconfirmed')::boolean, false),
    item->>'calling_window'
  FROM jsonb_array_elements(v_rows) AS item;

  RETURN jsonb_build_object(
    'export_batch_id', v_batch_id,
    'phone_count', v_count,
    'rows', v_rows,
    'excluded_counts', v_excluded_counts,
    'excluded_phones', v_excluded_phones,
    'export_label', v_label
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_market_plan_v1(p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_plan->>'actor', '')), '');
  v_sha text := nullif(btrim(coalesce(p_plan->>'sha256', '')), '');
  v_day date := (p_plan->>'pullDate')::date;
  v_list_id uuid;
  v_checks integer := 0;
  v_intakes integer := 0;
  v_enabled boolean := public.mls_market_check_enabled();
  v_skipped jsonb := '[]'::jsonb;
  v_item jsonb;
  v_county text;
  v_state text;
  v_complete boolean := false;
  v_clock timestamp;
  v_expired_rows integer := 0;
  v_sold_rows integer := 0;
BEGIN
  IF v_actor IS NULL OR v_sha IS NULL OR v_day IS NULL THEN
    RAISE EXCEPTION 'market_plan_invalid';
  END IF;

  BEGIN
    INSERT INTO public.property_market_checks (
      parcel_id, addr_norm, zip5, source, list_day, export_file_sha256, mls_number,
      list_status_raw, listing_status, close_date, list_price, owner_on_roll,
      owner_changed, owner_check_unknown
    )
    SELECT
      nullif(item->>'parcelId', ''),
      nullif(item->>'addrNorm', ''),
      nullif(item->>'zip5', ''),
      'heartland_matrix',
      coalesce((item->>'listDay')::date, v_day),
      v_sha,
      nullif(item->>'mlsNumber', ''),
      nullif(item->>'listStatusRaw', ''),
      item->>'listingStatus',
      nullif(item->>'closeDate', '')::date,
      nullif(item->>'listPrice', '')::numeric,
      nullif(item->>'ownerOnRoll', ''),
      coalesce((item->>'ownerChanged')::boolean, false),
      coalesce((item->>'ownerCheckUnknown')::boolean, false)
    FROM jsonb_array_elements(coalesce(p_plan->'checks', '[]'::jsonb)) AS item
    WHERE item->>'listingStatus' IN (
      'listed_active', 'listed_pending', 'sold_new_owner', 'listed_withdrawn',
      'off_market_ok', 'listing_check_unknown', 'listing_expired'
    );
    GET DIAGNOSTICS v_checks = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_checks := 0;
    v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('stage', 'checks', 'reason', 'row_skipped', 'detail', SQLERRM));
  END;

  BEGIN
    INSERT INTO public.property_market_latest (
      property_key, parcel_key, addr_norm, zip5, listing_status, list_day, source,
      owner_changed, owner_check_unknown, checked_at, check_id
    )
    SELECT DISTINCT ON (keyed.property_key)
      keyed.property_key,
      nullif(upper(regexp_replace(coalesce(keyed.parcel_id, ''), '[^A-Za-z0-9]', '', 'g')), ''),
      keyed.addr_norm,
      keyed.zip5,
      keyed.listing_status,
      keyed.list_day,
      keyed.source,
      keyed.owner_changed,
      keyed.owner_check_unknown,
      keyed.checked_at,
      keyed.id
    FROM (
      SELECT checks.*,
        CASE
          WHEN nullif(btrim(checks.parcel_id), '') IS NOT NULL
            THEN 'parcel:' || upper(regexp_replace(checks.parcel_id, '[^A-Za-z0-9]', '', 'g'))
          ELSE 'addr:' || checks.addr_norm || '|' || checks.zip5
        END AS property_key
      FROM public.property_market_checks AS checks
      WHERE checks.list_day = v_day
        AND checks.source = 'heartland_matrix'
    ) AS keyed
    ORDER BY keyed.property_key, public.market_status_rank_v1(keyed.listing_status) DESC, keyed.checked_at DESC
    ON CONFLICT (property_key) DO UPDATE SET
      parcel_key = EXCLUDED.parcel_key,
      listing_status = EXCLUDED.listing_status,
      list_day = EXCLUDED.list_day,
      source = EXCLUDED.source,
      owner_changed = EXCLUDED.owner_changed,
      owner_check_unknown = EXCLUDED.owner_check_unknown,
      checked_at = EXCLUDED.checked_at,
      check_id = EXCLUDED.check_id;
  EXCEPTION WHEN OTHERS THEN
    v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('stage', 'latest', 'reason', 'row_skipped', 'detail', SQLERRM));
  END;

  IF v_enabled THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_plan->'intakes', '[]'::jsonb)) AS value
    LOOP
      BEGIN
        SELECT place.county, place.state
        INTO v_county, v_state
        FROM public.market_service_place_v1(v_item->>'zip5', v_item->>'parcelId') AS place;
        IF v_county IS NULL OR v_state IS NULL THEN
          v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
            'stage', 'intake',
            'zip5', v_item->>'zip5',
            'parcelId', v_item->>'parcelId',
            'reason', 'county_unresolved'
          ));
          CONTINUE;
        END IF;
        SELECT id INTO v_list_id
        FROM public.source_lists
        WHERE list_type = 'mls_expired'
          AND county = v_county
          AND state = v_state
          AND source_file_sha256 = v_sha
          AND pull_date = v_day
        LIMIT 1;
        IF v_list_id IS NULL THEN
          INSERT INTO public.source_lists (
            list_type, county, state, pull_date, source_file_name, source_file_sha256, source_file_bytes, imported_by
          ) VALUES (
            'mls_expired', v_county, v_state, v_day,
            left(coalesce(p_plan->>'fileName', 'matrix.csv'), 200),
            v_sha,
            least(coalesce((p_plan->>'bytes')::integer, 0), 30000000),
            left(v_actor, 320)
          )
          RETURNING id INTO v_list_id;
        END IF;
        INSERT INTO public.source_list_rows (
          source_list_id, list_type, county, state, match_key, parcel_id, address, phones, raw,
          status, list_day, requires_licensee_disclosure, strategy, updated_by
        ) VALUES (
          v_list_id,
          'mls_expired',
          v_county,
          v_state,
          v_item->>'matchKey',
          nullif(v_item->>'parcelId', ''),
          v_item->>'address',
          ARRAY[]::text[],
          jsonb_build_object(
            'mls_number', v_item->>'mlsNumber',
            'basis', 'owner_override_2026-11-14',
            'contact_channel', 'single_line_live_agent',
            'sms_allowed', false,
            'counted_as_829_cleared', false
          ),
          'new_needs_skip',
          coalesce((v_item->>'listDay')::date, v_day),
          true,
          'wholesale',
          left(v_actor, 320)
        );
        v_intakes := v_intakes + 1;
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'stage', 'intake',
          'zip5', v_item->>'zip5',
          'parcelId', v_item->>'parcelId',
          'reason', 'row_skipped',
          'detail', SQLERRM
        ));
      END;
    END LOOP;
  END IF;

  v_clock := timezone('America/Chicago', clock_timestamp());
  v_expired_rows := CASE
    WHEN coalesce(p_plan->'partCounts'->>'expired', '') ~ '^[0-9]+$' THEN (p_plan->'partCounts'->>'expired')::integer
    ELSE 0
  END;
  v_sold_rows := CASE
    WHEN coalesce(p_plan->'partCounts'->>'sold', '') ~ '^[0-9]+$' THEN (p_plan->'partCounts'->>'sold')::integer
    ELSE 0
  END;
  -- Completeness is computed from the clock, the day, the part counts, and the done marker.
  v_complete := v_clock::time < time '04:00'
    AND v_day = v_clock::date
    AND v_expired_rows > 0
    AND v_sold_rows > 0
    AND btrim(coalesce(p_plan->>'doneMarker', '')) = to_char(v_clock::date, 'YYYY-MM-DD')
    AND coalesce(p_plan->'parts', '[]'::jsonb) ? 'expired'
    AND coalesce(p_plan->'parts', '[]'::jsonb) ? 'sold';

  INSERT INTO public.mls_export_runs (
    export_file_sha256, chicago_day, status, covered_zips, row_count, finished_at, complete, parts, skipped
  ) VALUES (
    v_sha, v_day, 'loaded',
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_plan->'coveredZips', '[]'::jsonb))),
    v_checks, clock_timestamp(),
    v_complete,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_plan->'parts', '[]'::jsonb))),
    v_skipped
  );

  RETURN jsonb_build_object('checks', v_checks, 'intakes', v_intakes, 'enabled', v_enabled, 'complete', v_complete, 'skipped', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_market_plan_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_market_plan_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_market_seeds_v1(p_seeds jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.target_zips (zip5, county, state, status)
  SELECT
    item->>'zip5',
    item->>'county',
    item->>'state',
    item->>'status'
  FROM jsonb_array_elements(coalesce(p_seeds->'zips', '[]'::jsonb)) AS item
  ON CONFLICT (zip5) DO UPDATE SET
    county = EXCLUDED.county,
    state = EXCLUDED.state,
    status = EXCLUDED.status;

  INSERT INTO public.mls_price_thresholds (zip5, min_list_price, method, confidence)
  SELECT
    item->>'zip5',
    (item->>'minListPrice')::numeric,
    item->>'method',
    item->>'confidence'
  FROM jsonb_array_elements(coalesce(p_seeds->'prices', '[]'::jsonb)) AS item
  ON CONFLICT (zip5) DO UPDATE SET
    min_list_price = EXCLUDED.min_list_price,
    method = EXCLUDED.method,
    confidence = EXCLUDED.confidence;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_market_seeds_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_market_seeds_v1(jsonb) TO service_role;
