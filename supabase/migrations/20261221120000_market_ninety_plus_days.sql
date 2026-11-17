-- DOM, CDOM, and the expiration/off-market date for each Matrix listing.
-- The 90+ Days lane reads the latest-status view. Pending and under-contract
-- stay out. A confirmed expired stays on the expired lane.
-- 90+ Days is not a license-risk block. The investor offer goes through the
-- listing agent named on the row.
--
-- KS_EXPIRED_RELEASE_APPROVED stays false. Owner Ernest Dodson approved the
-- switch in his own words on 2026-11-17 at 7:10am America/Chicago. The
-- citation below is a placeholder for that approval, not a counsel exception
-- id. record_mls_ks_expired_release_v1 can raise the flag only when the
-- caller cites that placeholder. This migration does not call it.
-- EXC-2026-11-14-003 still cannot raise this flag.
--
-- This does not change out_of_area, the Kansas code-violation lane, the
-- Monday-Saturday 09:00-17:00 America/Chicago window, or the fail-closed
-- line-check and owner-check holds. It does not read or write the dialer queue.

INSERT INTO public.mls_market_config (key, value) VALUES
  ('KS_EXPIRED_RELEASE_APPROVED', 'false'),
  ('KS_EXPIRED_RELEASE_CITATION', 'OWNER-2026-11-17-0710-CT')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.mls_market_config IS
  'Market-check switches. KS_EXPIRED_RELEASE_CITATION is the placeholder for the owner approval on 2026-11-17 at 7:10am America/Chicago. KS_EXPIRED_RELEASE_APPROVED stays false until record_mls_ks_expired_release_v1 is called with that citation.';

CREATE OR REPLACE FUNCTION public.record_mls_ks_expired_release_v1(p_value text, p_citation text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_expected text;
BEGIN
  -- Fail closed. A blank placeholder, a blank citation, the Nov 14 exception,
  -- or any other citation does not change the flag and does not write an audit row.
  IF p_value IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'mls_market_flag_raise_only';
  END IF;
  SELECT nullif(btrim(config.value), '')
  INTO v_expected
  FROM public.mls_market_config AS config
  WHERE config.key = 'KS_EXPIRED_RELEASE_CITATION';
  IF v_expected IS NULL
    OR btrim(coalesce(p_citation, '')) = ''
    OR btrim(p_citation) = 'EXC-2026-11-14-003'
    OR btrim(p_citation) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'mls_market_flag_citation_required';
  END IF;
  UPDATE public.mls_market_config
  SET value = 'true', updated_at = clock_timestamp()
  WHERE key = 'KS_EXPIRED_RELEASE_APPROVED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mls_market_flag_unknown';
  END IF;
  INSERT INTO public.mls_market_flag_changes (flag_key, new_value, citation)
  VALUES ('KS_EXPIRED_RELEASE_APPROVED', 'true', btrim(p_citation));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_mls_ks_expired_release_v1(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mls_ks_expired_release_v1(text, text) TO service_role;

COMMENT ON FUNCTION public.record_mls_ks_expired_release_v1(text, text) IS
  'Raises KS_EXPIRED_RELEASE_APPROVED only. Writes the same mls_market_flag_changes audit row as record_mls_market_flag_v1. The citation must match KS_EXPIRED_RELEASE_CITATION. EXC-2026-11-14-003 cannot raise this flag. The migration leaves the flag false.';

ALTER TABLE public.property_market_checks
  ADD COLUMN IF NOT EXISTS dom integer,
  ADD COLUMN IF NOT EXISTS cdom integer,
  ADD COLUMN IF NOT EXISTS expire_date date,
  ADD COLUMN IF NOT EXISTS listing_agent_name text,
  ADD COLUMN IF NOT EXISTS listing_agent_phone text;

ALTER TABLE public.property_market_checks
  DROP CONSTRAINT IF EXISTS property_market_checks_dom_check;
ALTER TABLE public.property_market_checks
  ADD CONSTRAINT property_market_checks_dom_check CHECK (dom IS NULL OR (dom >= 0 AND dom <= 20000));
ALTER TABLE public.property_market_checks
  DROP CONSTRAINT IF EXISTS property_market_checks_cdom_check;
ALTER TABLE public.property_market_checks
  ADD CONSTRAINT property_market_checks_cdom_check CHECK (cdom IS NULL OR (cdom >= 0 AND cdom <= 20000));
ALTER TABLE public.property_market_checks
  DROP CONSTRAINT IF EXISTS property_market_checks_agent_name_check;
ALTER TABLE public.property_market_checks
  ADD CONSTRAINT property_market_checks_agent_name_check CHECK (
    listing_agent_name IS NULL OR char_length(listing_agent_name) <= 200
  );
ALTER TABLE public.property_market_checks
  DROP CONSTRAINT IF EXISTS property_market_checks_agent_phone_check;
ALTER TABLE public.property_market_checks
  ADD CONSTRAINT property_market_checks_agent_phone_check CHECK (
    listing_agent_phone IS NULL OR char_length(listing_agent_phone) <= 80
  );

ALTER TABLE public.property_market_latest
  ADD COLUMN IF NOT EXISTS dom integer,
  ADD COLUMN IF NOT EXISTS cdom integer,
  ADD COLUMN IF NOT EXISTS expire_date date,
  ADD COLUMN IF NOT EXISTS listing_agent_name text,
  ADD COLUMN IF NOT EXISTS listing_agent_phone text;

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
  keyed.property_key,
  keyed.dom,
  keyed.cdom,
  keyed.expire_date,
  keyed.listing_agent_name,
  keyed.listing_agent_phone
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

COMMENT ON VIEW public.property_market_status_v1 IS
  'Latest market check per parcel, or per normalized street and zip when the parcel is blank. Includes DOM, CDOM, the expiration or off-market date, and the listing agent.';

CREATE OR REPLACE VIEW public.market_ninety_plus_days_v1
WITH (security_invoker = true) AS
SELECT
  status.property_key,
  status.mls_number,
  status.addr_norm,
  status.zip5,
  status.listing_status,
  status.dom,
  status.cdom,
  status.expire_date,
  status.listing_agent_name,
  status.listing_agent_phone,
  status.list_day,
  status.list_price,
  'listing_agent'::text AS offer_contact
FROM public.property_market_status_v1 AS status
WHERE status.listing_status IN ('listed_active', 'listed_withdrawn')
  AND status.listing_status IS DISTINCT FROM 'listed_pending'
  AND status.listing_status IS DISTINCT FROM 'listing_expired'
  AND (status.dom >= 90 OR status.cdom >= 90);

COMMENT ON VIEW public.market_ninety_plus_days_v1 IS
  '90+ Days lane. Active or withdrawn listings with DOM or CDOM of 90 or more. Pending and under-contract listings are excluded. Confirmed expireds stay on the expired lane. This lane is not blocked for license risk. The investor offer goes through the listing agent (listing_agent_name, listing_agent_phone). This view does not release a phone and does not bypass the Monday-Saturday 09:00-17:00 America/Chicago window, the line-check hold, or the owner-check hold.';

REVOKE ALL ON TABLE public.property_market_status_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.market_ninety_plus_days_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.property_market_status_v1, public.market_ninety_plus_days_v1 TO service_role;

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
      owner_changed, owner_check_unknown,
      dom, cdom, expire_date, listing_agent_name, listing_agent_phone
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
      coalesce((item->>'ownerCheckUnknown')::boolean, false),
      CASE
        WHEN coalesce(item->>'dom', '') ~ '^[0-9]{1,5}$' THEN (item->>'dom')::integer
        ELSE NULL
      END,
      CASE
        WHEN coalesce(item->>'cdom', '') ~ '^[0-9]{1,5}$' THEN (item->>'cdom')::integer
        ELSE NULL
      END,
      CASE
        WHEN coalesce(item->>'expireDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (item->>'expireDate')::date
        ELSE NULL
      END,
      left(nullif(btrim(item->>'listingAgentName'), ''), 200),
      left(nullif(btrim(item->>'listingAgentPhone'), ''), 80)
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
      owner_changed, owner_check_unknown, checked_at, check_id,
      dom, cdom, expire_date, listing_agent_name, listing_agent_phone
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
      keyed.id,
      keyed.dom,
      keyed.cdom,
      keyed.expire_date,
      keyed.listing_agent_name,
      keyed.listing_agent_phone
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
      check_id = EXCLUDED.check_id,
      dom = EXCLUDED.dom,
      cdom = EXCLUDED.cdom,
      expire_date = EXCLUDED.expire_date,
      listing_agent_name = EXCLUDED.listing_agent_name,
      listing_agent_phone = EXCLUDED.listing_agent_phone;
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
