-- Review fixes for the Lookup line check. Builds on
-- 20261202140000_dialer_export_suppression.sql (dialer_suppression_class_v1).
-- Counsel ruling §4a, 2026-11-14 (Lookup inactive).
--
-- An active recheck becomes eligible only when phone_line_rnd_clear_v1 returns
-- clear. That hook returns unavailable, so an active recheck stays
-- suppressed_bad_number. A dial-proven disconnect is permanent and is not
-- rechecked. Line type is not consent.

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS line_last_active_at timestamptz;

COMMENT ON COLUMN public.prospect_phones.line_last_active_at IS
  'Set only by a real active Lookup result. A failed or errored check does not bump it. Export grace is 90 days from this timestamp. Counsel ruling §4a, 2026-11-14 (Lookup inactive).';

CREATE TABLE IF NOT EXISTS public.phone_line_check_budget (
  id integer PRIMARY KEY,
  reserved_phones integer NOT NULL DEFAULT 0,
  reserved_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
  reserved_until timestamptz,
  CONSTRAINT phone_line_check_budget_singleton CHECK (id = 1),
  CONSTRAINT phone_line_check_budget_reserved_check CHECK (
    reserved_phones >= 0 AND reserved_cost_usd >= 0
  )
);

INSERT INTO public.phone_line_check_budget (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.phone_line_check_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_line_check_budget FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.phone_line_check_budget TO service_role;

INSERT INTO public.system_config (key, value, updated_at)
VALUES ('LINE_CHECK_BLOCK_ENABLED', jsonb_build_object('enabled', false), clock_timestamp())
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.phone_line_check_block_enabled_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce((
    SELECT value->>'enabled' IN ('true', 't', '1', 'on', 'yes')
    FROM public.system_config
    WHERE key = 'LINE_CHECK_BLOCK_ENABLED'
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.phone_line_check_unit_cost_v1()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN cost > 0 THEN cost
    ELSE NULL
  END
  FROM (
    SELECT (value->>'usd')::numeric AS cost
    FROM public.system_config
    WHERE key = 'LINE_CHECK_COST_USD'
      AND value ? 'usd'
      AND (value->>'usd') ~ '^[0-9]+(\.[0-9]+)?$'
  ) AS configured;
$$;

CREATE OR REPLACE FUNCTION public.sync_phone_line_check_config_v1(
  p_block_enabled boolean,
  p_cost_usd numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.system_config (key, value, updated_at)
  VALUES ('LINE_CHECK_BLOCK_ENABLED', jsonb_build_object('enabled', coalesce(p_block_enabled, false)), clock_timestamp())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  IF p_cost_usd IS NOT NULL AND p_cost_usd > 0 THEN
    INSERT INTO public.system_config (key, value, updated_at)
    VALUES ('LINE_CHECK_COST_USD', jsonb_build_object('usd', p_cost_usd), clock_timestamp())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_line_classifier_skip_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition)
          IN ('prospect_dnc', 'person_dnc')
    ) OR EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          public.dialer_suppression_class_v1('lead_call_result', lead.call_result) IN ('lead_dnc', 'person_dnc')
          OR public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) IN ('lead_dnc', 'person_dnc')
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.crm_mojo_call_events AS event
      WHERE public.prospecting_phone_key_v1(event.normalized_phone) = public.prospecting_phone_key_v1(p_phone)
        AND public.dialer_suppression_class_v1('mojo_outcome', event.outcome) = 'mojo_dnc'
    ) THEN 'dnc'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition) = 'disconnected'
          OR public.dialer_suppression_class_v1('phone_connected', phone.phone_connected::text) = 'disconnected'
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          public.dialer_suppression_class_v1('lead_call_result', lead.call_result) IN ('dead_number', 'disconnected')
          OR public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'disconnected'
        )
    ) THEN 'disconnected'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition) = 'wrong_number'
          OR public.dialer_suppression_class_v1('phone_connected', phone.phone_connected::text) = 'wrong_number'
        )
    ) THEN 'wrong_number'
    WHEN EXISTS (
      SELECT 1
      FROM public.sms_opt_outs AS opt_out
      WHERE opt_out.is_opted_out IS TRUE
        AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(p_phone)
    ) OR EXISTS (
      SELECT 1
      FROM public.crm_contact_methods AS method
      WHERE method.method_type = 'phone'
        AND method.sms_consent_status = 'opted_out'
        AND public.prospecting_phone_key_v1(method.normalized_value) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'opted_out'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.voice_hold IS TRUE
    ) THEN 'voice_hold'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_bad_number'
    ) THEN 'suppressed_bad_number'
    ELSE NULL
  END;
$$;

DROP FUNCTION IF EXISTS public.phone_line_decide_v1(text, boolean, text, timestamptz, integer, boolean, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.phone_line_decide_v1(
  p_mapped_status text,
  p_failed boolean,
  p_prior_status text,
  p_prior_checked_at timestamptz,
  p_recheck_count integer,
  p_dial_disconnect boolean,
  p_phone_e164 text,
  p_skip_trace_at timestamptz,
  p_now timestamptz,
  p_last_active_at timestamptz DEFAULT NULL,
  p_suppressed_at timestamptz DEFAULT NULL,
  p_suppress_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer := greatest(0, coalesce(p_recheck_count, 0));
  v_failed boolean := coalesce(p_failed, false) OR (
    p_mapped_status IS DISTINCT FROM 'active'
    AND p_mapped_status IS DISTINCT FROM 'inactive'
    AND p_mapped_status IS DISTINCT FROM 'unreachable'
  );
  v_scheduled boolean := p_suppressed_at IS NOT NULL AND p_suppressed_at <= p_now - CASE
    WHEN v_count <= 0 THEN interval '30 days'
    ELSE interval '60 days'
  END;
  v_fresh boolean := p_last_active_at IS NOT NULL AND p_last_active_at >= p_now - interval '90 days';
  v_qualifying boolean;
  v_rnd text;
  v_status text;
  v_reason text;
  v_next integer;
  v_stale boolean := false;
  v_fill boolean := false;
  v_touch boolean := false;
  v_keep boolean := false;
BEGIN
  PERFORM p_prior_checked_at;
  v_qualifying := v_scheduled AND NOT v_failed AND p_mapped_status IN ('active', 'inactive');
  IF p_dial_disconnect THEN
    v_status := 'suppressed_bad_number';
    v_reason := 'dial_disconnect';
  ELSIF p_prior_status = 'suppressed_bad_number' THEN
    v_status := 'suppressed_bad_number';
    v_reason := 'permanent_bad_number';
    v_keep := true;
  ELSIF p_prior_status = 'suppressed_lookup_inactive' AND NOT v_qualifying THEN
    v_status := 'suppressed_lookup_inactive';
    v_reason := 'lookup_inactive';
    v_keep := true;
  ELSIF p_prior_status = 'suppressed_lookup_inactive' AND p_mapped_status = 'inactive' THEN
    v_next := v_count + 1;
    v_count := v_next;
    IF v_next >= 2 THEN
      v_status := 'suppressed_bad_number';
      v_reason := 'recheck_still_inactive';
    ELSE
      v_status := 'suppressed_lookup_inactive';
      v_reason := 'lookup_inactive';
    END IF;
  ELSIF p_prior_status = 'suppressed_lookup_inactive' THEN
    v_rnd := public.phone_line_rnd_clear_v1(p_phone_e164, p_skip_trace_at);
    IF v_rnd = 'clear' THEN
      v_status := 'active';
      v_reason := 'recheck_active_rnd_clear';
      v_count := 0;
      v_fill := true;
      v_touch := true;
    ELSIF v_rnd = 'permanent_disconnect' THEN
      v_status := 'suppressed_bad_number';
      v_reason := 'rnd_permanent_disconnect';
    ELSE
      v_status := 'suppressed_bad_number';
      v_reason := 'recheck_active_rnd_unavailable';
      v_rnd := 'unavailable';
    END IF;
  ELSIF v_failed THEN
    IF p_prior_status = 'active' AND v_fresh THEN
      v_status := 'active';
      v_reason := 'check_failed_stale_active';
      v_stale := true;
      v_keep := true;
    ELSE
      v_status := 'unknown';
      v_reason := 'check_failed';
    END IF;
  ELSIF p_mapped_status = 'unreachable' THEN
    v_status := 'unreachable';
    v_reason := 'unreachable_hold';
  ELSIF p_mapped_status = 'inactive' THEN
    v_count := 0;
    v_status := 'suppressed_lookup_inactive';
    v_reason := 'lookup_inactive';
  ELSE
    v_status := 'active';
    v_reason := 'lookup_active';
    v_count := 0;
    v_fill := true;
    v_touch := true;
  END IF;

  IF coalesce(p_suppress_only, false) AND (v_status = 'active' OR v_fill OR v_touch) THEN
    v_status := coalesce(p_prior_status, 'unknown');
    v_reason := 'calling_window_lock';
    v_count := greatest(0, coalesce(p_recheck_count, 0));
    v_fill := false;
    v_touch := false;
    v_stale := false;
    v_keep := true;
  END IF;

  RETURN jsonb_build_object(
    'line_status', v_status,
    'reason', v_reason,
    'recheck_count', v_count,
    'stale_active_export', v_stale,
    'fill_phone_connected', v_fill,
    'touch_last_active', v_touch,
    'keep_prior_status', v_keep,
    'rnd', v_rnd
  );
END;
$$;

DROP FUNCTION IF EXISTS public.apply_phone_line_checks_v1(jsonb, text, text, boolean);

CREATE OR REPLACE FUNCTION public.apply_phone_line_checks_v1(
  p_results jsonb,
  p_source text,
  p_actor text,
  p_report_cap boolean DEFAULT false,
  p_suppress_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_cost numeric;
  v_item jsonb;
  v_accepted integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_e164 text;
  v_key text;
  v_twilio_status text;
  v_twilio_type text;
  v_mapped text;
  v_line_type text;
  v_failed boolean;
  v_checked_at timestamptz;
  v_phone_id uuid;
  v_prior_status text;
  v_prior_checked timestamptz;
  v_prior_count integer;
  v_last_active timestamptz;
  v_suppressed_at timestamptz;
  v_skip_trace_at timestamptz;
  v_dial boolean;
  v_hour integer;
  v_suppress_only boolean;
  v_decision jsonb;
  v_status text;
  v_reason text;
  v_recheck integer;
  v_raw jsonb;
  v_fill boolean;
  v_blocked boolean;
  v_keep boolean;
  v_touch boolean;
  v_phones_today integer := 0;
  v_cost_today numeric := 0;
  v_cost_month numeric := 0;
BEGIN
  IF p_source IS DISTINCT FROM 'cron' AND p_source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'phone_line_check_source_invalid';
  END IF;
  IF v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'phone_line_check_actor_invalid';
  END IF;
  IF p_results IS NULL OR jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'phone_line_check_batch_invalid';
  END IF;
  IF jsonb_array_length(p_results) > 100 THEN
    RAISE EXCEPTION 'phone_line_check_batch_too_large';
  END IF;

  v_cost := public.phone_line_check_unit_cost_v1();
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'line_check_cost_unconfigured';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-line-check-cap', 0));
  PERFORM 1 FROM public.phone_line_check_budget WHERE id = 1 FOR UPDATE;

  SELECT count(*)::integer, coalesce(sum(cost_usd), 0)
  INTO v_phones_today, v_cost_today
  FROM public.phone_line_checks
  WHERE (checked_at AT TIME ZONE 'America/Chicago')::date
    = (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  SELECT coalesce(sum(cost_usd), 0) INTO v_cost_month
  FROM public.phone_line_checks
  WHERE date_trunc('month', checked_at AT TIME ZONE 'America/Chicago')
    = date_trunc('month', clock_timestamp() AT TIME ZONE 'America/Chicago');

  IF p_report_cap
    AND jsonb_array_length(p_results) = 0
    AND (v_phones_today >= 1500 OR v_cost_today >= 15 OR v_cost_month >= 60)
  THEN
    INSERT INTO public.phone_line_check_cap_log (
      cap_name, source, actor, phones_today, cost_today_usd, cost_month_usd, batch_size, accepted, detail
    ) VALUES (
      CASE
        WHEN v_phones_today >= 1500 THEN 'daily_phones'
        WHEN v_cost_today >= 15 THEN 'daily_cost'
        ELSE 'monthly_cost'
      END,
      p_source,
      v_actor,
      v_phones_today,
      v_cost_today,
      v_cost_month,
      0,
      0,
      jsonb_build_object('reserved', true)
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    v_e164 := public.normalize_conversation_phone(v_item->>'phone_e164');
    IF v_e164 IS NULL THEN
      CONTINUE;
    END IF;
    v_key := public.prospecting_phone_key_v1(v_e164);
    IF v_key = ANY (v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_twilio_status := coalesce(v_item->'raw'->>'twilio_status', v_item->>'line_status');
    v_twilio_type := coalesce(v_item->'raw'->>'twilio_type', v_item->>'line_type');
    v_mapped := CASE lower(btrim(coalesce(v_twilio_status, '')))
      WHEN 'active' THEN 'active'
      WHEN 'reachable' THEN 'active'
      WHEN 'inactive' THEN 'inactive'
      WHEN 'disconnected' THEN 'inactive'
      WHEN 'unreachable' THEN 'unreachable'
      ELSE 'unknown'
    END;
    v_line_type := CASE lower(btrim(coalesce(v_twilio_type, '')))
      WHEN 'landline' THEN 'landline'
      WHEN 'mobile' THEN 'mobile'
      WHEN 'fixedvoip' THEN 'fixedVoip'
      WHEN 'nonfixedvoip' THEN 'nonFixedVoip'
      WHEN 'personal' THEN 'personal'
      WHEN 'tollfree' THEN 'tollFree'
      WHEN 'premium' THEN 'premium'
      WHEN 'sharedcost' THEN 'sharedCost'
      WHEN 'uan' THEN 'uan'
      WHEN 'voicemail' THEN 'voicemail'
      WHEN 'pager' THEN 'pager'
      WHEN 'unknown' THEN 'unknown'
      ELSE NULL
    END;
    v_failed := coalesce((v_item->>'failed')::boolean, false) OR v_mapped = 'unknown';
    BEGIN
      v_checked_at := nullif(v_item->>'checked_at', '')::timestamptz;
    EXCEPTION
      WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
        v_checked_at := NULL;
    END;
    IF v_checked_at IS NULL THEN
      v_checked_at := clock_timestamp();
    END IF;
    v_hour := EXTRACT(HOUR FROM (v_checked_at AT TIME ZONE 'America/Chicago'))::integer;
    v_suppress_only := coalesce(p_suppress_only, false) OR (v_hour >= 4 AND v_hour < 21);

    v_prior_status := NULL;
    v_prior_checked := NULL;
    v_prior_count := 0;
    v_last_active := NULL;
    v_suppressed_at := NULL;
    v_skip_trace_at := NULL;
    v_phone_id := NULL;
    SELECT phone.id INTO v_phone_id
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164
    ORDER BY phone.id
    LIMIT 1;
    SELECT
      phone.line_status,
      phone.line_checked_at,
      coalesce(phone.line_recheck_count, 0),
      phone.line_last_active_at,
      phone.line_suppressed_at
    INTO v_prior_status, v_prior_checked, v_prior_count, v_last_active, v_suppressed_at
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164
    ORDER BY phone.line_recheck_count DESC NULLS LAST, phone.line_checked_at DESC NULLS LAST, phone.id
    LIMIT 1;
    SELECT min(phone.created_at) INTO v_skip_trace_at
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164;
    SELECT EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.normalize_conversation_phone(phone.phone) = v_e164
        AND (
          public.phone_line_row_is_dial_disconnect_v1(phone.last_disposition, phone.phone_connected::text)
          OR public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition) = 'disconnected'
          OR public.dialer_suppression_class_v1('phone_connected', phone.phone_connected::text) = 'disconnected'
        )
    ) INTO v_dial;

    v_decision := public.phone_line_decide_v1(
      v_mapped, v_failed, v_prior_status, v_prior_checked, coalesce(v_prior_count, 0),
      coalesce(v_dial, false), v_e164, v_skip_trace_at, v_checked_at,
      v_last_active, v_suppressed_at, v_suppress_only
    );
    v_status := v_decision->>'line_status';
    v_reason := v_decision->>'reason';
    v_recheck := coalesce((v_decision->>'recheck_count')::integer, 0);
    v_fill := coalesce((v_decision->>'fill_phone_connected')::boolean, false);
    v_keep := coalesce((v_decision->>'keep_prior_status')::boolean, false);
    v_touch := coalesce((v_decision->>'touch_last_active')::boolean, false);
    v_blocked := public.phone_line_classifier_skip_reason_v1(v_e164) IS NOT NULL;
    v_raw := coalesce(v_item->'raw', '{}'::jsonb) || jsonb_build_object(
      'failed', v_failed,
      'mapped_status', v_mapped,
      'mapped_type', v_line_type,
      'reason', v_reason,
      'decision_status', v_status,
      'stale_active_export', coalesce((v_decision->>'stale_active_export')::boolean, false),
      'touch_last_active', v_touch,
      'suppress_only', v_suppress_only,
      'rnd', v_decision->'rnd',
      'cost_usd', v_cost,
      'line_type_is_consent', false
    );

    INSERT INTO public.phone_line_checks (
      phone_e164, prospect_phone_id, checked_at, line_type, line_status, raw, cost_usd, source, actor
    ) VALUES (
      v_e164, v_phone_id, v_checked_at, v_line_type, v_mapped, v_raw, v_cost, p_source, v_actor
    );

    UPDATE public.prospect_phones AS phone
    SET
      line_type = v_line_type,
      line_status = CASE WHEN v_keep THEN phone.line_status ELSE v_status END,
      line_checked_at = v_checked_at,
      line_check_raw = v_raw,
      line_recheck_count = CASE WHEN v_keep THEN phone.line_recheck_count ELSE v_recheck END,
      line_last_active_at = CASE WHEN v_touch THEN v_checked_at ELSE phone.line_last_active_at END,
      line_suppressed_at = CASE
        WHEN v_keep THEN phone.line_suppressed_at
        WHEN v_status IN ('suppressed_lookup_inactive', 'suppressed_bad_number')
          THEN coalesce(phone.line_suppressed_at, v_checked_at)
        ELSE NULL
      END,
      phone_connected = CASE
        WHEN v_fill
          AND NOT v_blocked
          AND NOT v_suppress_only
          AND nullif(btrim(coalesce(phone.phone_connected::text, '')), '') IS NULL
          AND lower(btrim(coalesce(phone.last_attempt_by, ''))) IS DISTINCT FROM 'mojo'
          AND lower(btrim(coalesce(phone.verified_source, ''))) NOT IN ('mojo', 'mojo_dial')
          AND NOT (
            phone.is_verified_contact IS TRUE
            AND (
              position('casey' IN lower(coalesce(phone.verified_by, ''))) > 0
              OR position('casey' IN lower(coalesce(phone.verified_source, ''))) > 0
            )
          )
        THEN 'connected'
        ELSE phone.phone_connected
      END
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164;

    v_accepted := v_accepted + 1;
  END LOOP;

  UPDATE public.phone_line_check_budget
  SET
    reserved_phones = greatest(0, reserved_phones - v_accepted),
    reserved_cost_usd = greatest(0, reserved_cost_usd - (v_accepted * v_cost))
  WHERE id = 1;

  RETURN jsonb_build_object(
    'accepted', v_accepted,
    'stopped', false,
    'cap', NULL,
    'batch_size', jsonb_array_length(p_results),
    'phones_today', v_phones_today + v_accepted,
    'cost_today_usd', v_cost_today + (v_accepted * v_cost),
    'cost_month_usd', v_cost_month + (v_accepted * v_cost)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_phone_line_check_candidates_v1(
  p_limit integer,
  p_source_list_id uuid DEFAULT NULL,
  p_prospect_phone_ids uuid[] DEFAULT NULL,
  p_fresh_reserve_usd numeric DEFAULT 5,
  p_source text DEFAULT 'cron',
  p_actor text DEFAULT 'line-check'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer;
  v_cost numeric;
  v_budget record;
  v_in_flight_phones integer := 0;
  v_in_flight_cost numeric := 0;
  v_phones integer := 0;
  v_cost_today numeric := 0;
  v_cost_month numeric := 0;
  v_by_phones integer;
  v_by_day integer;
  v_by_month integer;
  v_remaining integer;
  v_fresh_hold integer;
  v_other_room integer;
  v_other integer := 0;
  v_picked integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_row record;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_binding text;
  v_cap text;
BEGIN
  IF p_source_list_id IS NOT NULL AND p_prospect_phone_ids IS NOT NULL THEN
    RAISE EXCEPTION 'phone_line_check_selector_conflict';
  END IF;
  IF p_prospect_phone_ids IS NOT NULL AND cardinality(p_prospect_phone_ids) > 100 THEN
    RAISE EXCEPTION 'phone_line_check_batch_too_large';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    v_limit := 40;
  ELSIF p_limit > 100 THEN
    RAISE EXCEPTION 'phone_line_check_batch_too_large';
  ELSE
    v_limit := p_limit;
  END IF;
  IF p_source_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.source_lists WHERE id = p_source_list_id
  ) THEN
    RAISE EXCEPTION 'source_list_not_found';
  END IF;

  v_cost := public.phone_line_check_unit_cost_v1();
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'line_check_cost_unconfigured';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-line-check-cap', 0));
  SELECT reserved_phones, reserved_cost_usd, reserved_until
  INTO v_budget
  FROM public.phone_line_check_budget
  WHERE id = 1
  FOR UPDATE;

  IF v_budget.reserved_until IS NOT NULL AND v_budget.reserved_until > clock_timestamp() THEN
    v_in_flight_phones := v_budget.reserved_phones;
    v_in_flight_cost := v_budget.reserved_cost_usd;
  END IF;

  SELECT count(*)::integer, coalesce(sum(cost_usd), 0)
  INTO v_phones, v_cost_today
  FROM public.phone_line_checks
  WHERE (checked_at AT TIME ZONE 'America/Chicago')::date = v_today;
  SELECT coalesce(sum(cost_usd), 0) INTO v_cost_month
  FROM public.phone_line_checks
  WHERE date_trunc('month', checked_at AT TIME ZONE 'America/Chicago')
    = date_trunc('month', clock_timestamp() AT TIME ZONE 'America/Chicago');

  v_by_phones := greatest(0, 1500 - v_phones - v_in_flight_phones);
  v_by_day := greatest(0, floor(greatest(0, 15 - v_cost_today - v_in_flight_cost) / v_cost))::integer;
  v_by_month := greatest(0, floor(greatest(0, 60 - v_cost_month - v_in_flight_cost) / v_cost))::integer;
  v_remaining := least(v_by_phones, v_by_day, v_by_month);
  v_fresh_hold := least(v_remaining, greatest(0, floor(greatest(coalesce(p_fresh_reserve_usd, 0), 0) / v_cost))::integer);
  v_other_room := greatest(0, v_remaining - v_fresh_hold);
  v_binding := CASE
    WHEN v_by_phones <= v_by_day AND v_by_phones <= v_by_month THEN 'daily_phones'
    WHEN v_by_day <= v_by_month THEN 'daily_cost'
    ELSE 'monthly_cost'
  END;
  v_cap := CASE WHEN v_remaining > 0 THEN NULL ELSE v_binding END;

  IF v_remaining > 0 THEN
    FOR v_row IN
      SELECT picked.id, picked.phone_e164, picked.lane
      FROM (
        SELECT DISTINCT ON (public.prospecting_phone_key_v1(phone.phone))
          phone.id,
          public.normalize_conversation_phone(phone.phone) AS phone_e164,
          CASE
            WHEN phone.line_checked_at IS NULL
              AND (
                list.pull_date = v_today
                OR (row.created_at AT TIME ZONE 'America/Chicago')::date = v_today
              )
            THEN 0
            WHEN row.status = 'loaded_to_dialer' THEN 1
            ELSE 2
          END AS lane,
          list.pull_date,
          phone.line_checked_at
        FROM public.prospect_phones AS phone
        JOIN public.source_list_rows AS row
          ON row.status IN ('ready', 'loaded_to_dialer')
         AND (
           (row.prospect_id IS NOT NULL AND row.prospect_id = phone.prospect_id)
           OR EXISTS (
             SELECT 1
             FROM unnest(row.phones) AS phone_value
             WHERE public.prospecting_phone_key_v1(phone_value) = public.prospecting_phone_key_v1(phone.phone)
           )
         )
        JOIN public.source_lists AS list ON list.id = row.source_list_id
        WHERE public.normalize_conversation_phone(phone.phone) IS NOT NULL
          AND public.phone_line_classifier_skip_reason_v1(phone.phone) IS NULL
          AND (
            phone.line_checked_at IS NULL
            OR (
              phone.line_status = 'suppressed_lookup_inactive'
              AND coalesce(phone.line_recheck_count, 0) < 2
              AND phone.line_suppressed_at IS NOT NULL
              AND phone.line_suppressed_at <= clock_timestamp() - CASE
                WHEN coalesce(phone.line_recheck_count, 0) <= 0 THEN interval '30 days'
                ELSE interval '60 days'
              END
              AND phone.line_checked_at <= clock_timestamp() - interval '1 day'
            )
            OR (
              phone.line_status = 'unreachable'
              AND phone.line_checked_at <= clock_timestamp() - interval '7 days'
            )
            OR (
              phone.line_status = 'unknown'
              AND phone.line_checked_at <= clock_timestamp() - interval '1 day'
            )
            OR (
              coalesce(phone.line_status, '') NOT IN (
                'unreachable', 'unknown', 'suppressed_bad_number', 'suppressed_lookup_inactive'
              )
              AND phone.line_checked_at <= clock_timestamp() - interval '30 days'
            )
          )
          AND (p_prospect_phone_ids IS NULL OR phone.id = ANY (p_prospect_phone_ids))
          AND (p_source_list_id IS NULL OR row.source_list_id = p_source_list_id)
        ORDER BY
          public.prospecting_phone_key_v1(phone.phone),
          CASE
            WHEN phone.line_checked_at IS NULL AND (list.pull_date = v_today OR (row.created_at AT TIME ZONE 'America/Chicago')::date = v_today) THEN 0
            WHEN row.status = 'loaded_to_dialer' THEN 1
            ELSE 2
          END,
          list.pull_date DESC NULLS LAST,
          phone.id
      ) AS picked
      ORDER BY picked.lane, picked.pull_date DESC NULLS LAST, picked.line_checked_at NULLS FIRST, picked.id
    LOOP
      IF v_row.lane = 0 THEN
        EXIT WHEN v_picked >= least(v_limit, v_remaining);
      ELSE
        EXIT WHEN v_other >= v_other_room OR v_picked >= least(v_limit, v_remaining);
        v_other := v_other + 1;
      END IF;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'phone_e164', v_row.phone_e164,
        'prospect_phone_id', v_row.id,
        'lane', CASE v_row.lane WHEN 0 THEN 'fresh_intake' WHEN 1 THEN 'tier_1' ELSE 'backfill' END
      ));
      v_picked := v_picked + 1;
    END LOOP;
  END IF;

  IF v_picked > 0 THEN
    UPDATE public.phone_line_check_budget
    SET
      reserved_phones = v_in_flight_phones + v_picked,
      reserved_cost_usd = v_in_flight_cost + (v_picked * v_cost),
      reserved_until = clock_timestamp() + interval '10 minutes'
    WHERE id = 1;
  ELSIF v_in_flight_phones = 0 THEN
    UPDATE public.phone_line_check_budget
    SET reserved_phones = 0, reserved_cost_usd = 0, reserved_until = NULL
    WHERE id = 1;
  END IF;

  IF p_prospect_phone_ids IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'prospect_phone_id', requested.id,
      'reason', requested.reason
    ) ORDER BY requested.id), '[]'::jsonb)
    INTO v_skipped
    FROM (
      SELECT
        requested_id.id,
        CASE
          WHEN phone.id IS NULL THEN 'not_found'
          WHEN public.normalize_conversation_phone(phone.phone) IS NULL THEN 'invalid_phone'
          WHEN public.phone_line_classifier_skip_reason_v1(phone.phone) IS NOT NULL
            THEN public.phone_line_classifier_skip_reason_v1(phone.phone)
          WHEN NOT EXISTS (
            SELECT 1
            FROM public.source_list_rows AS row
            WHERE row.status IN ('ready', 'loaded_to_dialer')
              AND (
                (row.prospect_id IS NOT NULL AND row.prospect_id = phone.prospect_id)
                OR EXISTS (
                  SELECT 1 FROM unnest(row.phones) AS phone_value
                  WHERE public.prospecting_phone_key_v1(phone_value) = public.prospecting_phone_key_v1(phone.phone)
                )
              )
          ) THEN 'not_on_live_list'
          WHEN v_remaining = 0 THEN coalesce(v_cap, 'daily_phones')
          ELSE NULL
        END AS reason
      FROM unnest(p_prospect_phone_ids) AS requested_id(id)
      LEFT JOIN public.prospect_phones AS phone ON phone.id = requested_id.id
    ) AS requested
    WHERE requested.reason IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'remaining', v_remaining,
    'cap', v_cap,
    'granted', v_picked,
    'fresh_hold', v_fresh_hold,
    'other_room', v_other_room,
    'unit_cost_usd', v_cost,
    'candidates', v_rows,
    'skipped', v_skipped
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.select_phone_line_check_candidates_v1(
  p_limit integer,
  p_source_list_id uuid DEFAULT NULL,
  p_prospect_phone_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'phone_line_check_reservation_required';
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_line_export_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_bad_number'
    ) THEN 'suppressed_bad_number'
    WHEN EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_lookup_inactive'
    ) THEN 'suppressed_lookup_inactive'
    WHEN EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'unreachable'
    ) THEN 'line_status_unreachable'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_checked_at IS NOT NULL
    ) THEN 'line_check_unknown'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_last_active_at IS NOT NULL
        AND phone.line_last_active_at >= clock_timestamp() - interval '90 days'
    ) THEN 'line_check_stale'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text, p_prospect_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_key text;
  v_class text;
  v_encode text;
  v_bucket text;
  v_line text;
BEGIN
  IF public.normalize_conversation_phone(p_phone) IS NULL THEN
    RETURN 'invalid_phone';
  END IF;
  v_key := public.prospecting_phone_key_v1(p_phone);

  IF EXISTS (
    SELECT 1
    FROM public.sms_opt_outs AS opt_out
    WHERE opt_out.is_opted_out IS TRUE
      AND public.prospecting_phone_key_v1(opt_out.phone) = v_key
  ) THEN
    RETURN 'sms_opt_out';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    WHERE phone.voice_hold IS TRUE
      AND public.prospecting_phone_key_v1(phone.phone) = v_key
  ) THEN
    RETURN 'voice_hold';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition) AS class
    FROM public.prospect_phones AS phone
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'person_dnc' THEN 1
    WHEN 'prospect_dnc' THEN 1
    WHEN 'wrong_number' THEN 2
    WHEN 'disconnected' THEN 3
    WHEN 'unmapped' THEN 4
    ELSE 5
  END
  LIMIT 1;
  IF v_class IN ('person_dnc', 'prospect_dnc') THEN
    RETURN 'prospect_dnc';
  ELSIF v_class = 'wrong_number' THEN
    RETURN 'wrong_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('phone_connected', phone.phone_connected) AS class
    FROM public.prospect_phones AS phone
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'wrong_number' THEN 1
    WHEN 'disconnected' THEN 2
    WHEN 'unmapped' THEN 3
    ELSE 4
  END
  LIMIT 1;
  IF v_class = 'wrong_number' THEN
    RETURN 'wrong_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_contact_methods AS method
    WHERE method.method_type = 'phone'
      AND method.sms_consent_status = 'opted_out'
      AND public.prospecting_phone_key_v1(method.normalized_value) = v_key
  ) THEN
    RETURN 'contact_opt_out';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.crm_contact_methods AS method
    WHERE method.method_type = 'phone'
      AND method.deliverability_status = 'blocked'
      AND public.prospecting_phone_key_v1(method.normalized_value) = v_key
  ) THEN
    RETURN 'contact_blocked';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('lead_call_result', lead.call_result) AS class
    FROM public.leads AS lead
    WHERE public.prospecting_phone_key_v1(lead.phone) = v_key
    UNION ALL
    SELECT public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) AS class
    FROM public.leads AS lead
    WHERE public.prospecting_phone_key_v1(lead.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'person_dnc' THEN 1
    WHEN 'lead_dnc' THEN 1
    WHEN 'dead_number' THEN 2
    WHEN 'disconnected' THEN 3
    WHEN 'unmapped' THEN 4
    ELSE 5
  END
  LIMIT 1;
  IF v_class IN ('person_dnc', 'lead_dnc') THEN
    RETURN 'lead_dnc';
  ELSIF v_class = 'dead_number' THEN
    RETURN 'dead_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('mojo_outcome', event.outcome) AS class
    FROM public.crm_mojo_call_events AS event
    WHERE public.prospecting_phone_key_v1(event.normalized_phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'mojo_dnc' THEN 1
    WHEN 'disconnected' THEN 2
    WHEN 'unmapped' THEN 3
    ELSE 4
  END
  LIMIT 1;
  IF v_class = 'mojo_dnc' THEN
    RETURN 'mojo_dnc';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.bucket
  INTO v_bucket
  FROM (
    SELECT public.dialer_relationship_bucket_v1(phone.relationship, prospect.owner_1_type) AS bucket
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.bucket IN ('associate_non_family', 'relationship_unknown')
  ORDER BY CASE matched.bucket WHEN 'associate_non_family' THEN 1 ELSE 2 END
  LIMIT 1;
  IF v_bucket IS NOT NULL THEN
    RETURN v_bucket;
  END IF;

  IF public.dialer_property_owner_dnc_fanout_v1(v_key, p_prospect_id) THEN
    RETURN 'property_owner_dnc_fanout';
  END IF;

    IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS mine
    JOIN public.prospect_phones AS flagged
      ON flagged.prospect_id = mine.prospect_id
    WHERE public.prospecting_phone_key_v1(mine.phone) = v_key
      AND public.prospecting_phone_key_v1(flagged.phone) IS DISTINCT FROM v_key
      AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
  ) OR (
    p_prospect_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.prospect_phones AS flagged
      WHERE flagged.prospect_id = p_prospect_id
        AND public.prospecting_phone_key_v1(flagged.phone) IS DISTINCT FROM v_key
        AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.prospects AS mine
    JOIN public.leads AS lead ON lead.id = mine.lead_id
    WHERE (
      mine.id = p_prospect_id
      OR EXISTS (
        SELECT 1
        FROM public.prospect_phones AS mine_phone
        WHERE mine_phone.prospect_id = mine.id
          AND public.prospecting_phone_key_v1(mine_phone.phone) = v_key
      )
    )
    AND public.prospecting_phone_key_v1(lead.phone) IS DISTINCT FROM v_key
    AND (
      public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
      OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_mojo_call_events AS mine_event
    JOIN public.crm_mojo_call_events AS other_event
      ON other_event.provider_contact_id = mine_event.provider_contact_id
     AND nullif(btrim(mine_event.provider_contact_id), '') IS NOT NULL
    WHERE public.prospecting_phone_key_v1(mine_event.normalized_phone) = v_key
      AND public.prospecting_phone_key_v1(other_event.normalized_phone) IS DISTINCT FROM v_key
      AND (
        EXISTS (
          SELECT 1
          FROM public.prospect_phones AS flagged
          WHERE public.prospecting_phone_key_v1(flagged.phone) = public.prospecting_phone_key_v1(other_event.normalized_phone)
            AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
        )
        OR EXISTS (
          SELECT 1
          FROM public.leads AS lead
          WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(other_event.normalized_phone)
            AND (
              public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
              OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
            )
        )
      )
  ) THEN
    RETURN 'person_fanout';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospects AS mine
    JOIN public.prospects AS anchor
      ON public.dialer_household_key_v1(anchor.county, coalesce(anchor.situs_street, anchor.situs_address), anchor.owner_1_last, anchor.owner_1)
       = public.dialer_household_key_v1(mine.county, coalesce(mine.situs_street, mine.situs_address), mine.owner_1_last, mine.owner_1)
    WHERE anchor.id IS DISTINCT FROM mine.id
      AND public.dialer_household_key_v1(mine.county, coalesce(mine.situs_street, mine.situs_address), mine.owner_1_last, mine.owner_1) IS NOT NULL
      AND (
        mine.id = p_prospect_id
        OR EXISTS (
          SELECT 1
          FROM public.prospect_phones AS mine_phone
          WHERE mine_phone.prospect_id = mine.id
            AND public.prospecting_phone_key_v1(mine_phone.phone) = v_key
        )
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.prospect_phones AS flagged
          WHERE flagged.prospect_id = anchor.id
            AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
        )
        OR EXISTS (
          SELECT 1
          FROM public.leads AS lead
          WHERE lead.id = anchor.lead_id
            AND (
              public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
              OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
            )
        )
      )
  ) THEN
    RETURN 'household_fanout';
  END IF;

  -- Hook only. The encode queue is not created here. A missing table is not a block.
  IF to_regclass('public.mojo_encode_queue') IS NOT NULL THEN
    BEGIN
      EXECUTE $encode$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.mojo_encode_queue AS pending
            WHERE public.prospecting_phone_key_v1(pending.phone) = $1
              AND pending.encoded_at IS NULL
          ) THEN 'mojo_encode_pending'
          WHEN EXISTS (
            SELECT 1
            FROM public.mojo_encode_queue AS pending
            WHERE length(public.prospecting_phone_key_v1(pending.phone)) BETWEEN 4 AND 9
              AND right(public.prospecting_phone_key_v1(pending.phone), 4) = right($1, 4)
              AND pending.encoded_at IS NULL
          ) THEN 'hold_last4'
          ELSE NULL
        END
      $encode$
      INTO v_encode
      USING v_key;
      IF v_encode IS NOT NULL THEN
        RETURN v_encode;
      END IF;
    EXCEPTION
      WHEN undefined_column OR undefined_table THEN
        RAISE EXCEPTION 'mojo_encode_pending_unreadable'
          USING HINT = 'public.mojo_encode_queue must expose phone and encoded_at';
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    WHERE length(public.prospecting_phone_key_v1(phone.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(phone.phone), 4) = right(v_key, 4)
      AND (
        coalesce(public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition), 'allow') <> 'allow'
        OR coalesce(public.dialer_suppression_class_v1('phone_connected', phone.phone_connected), 'allow') <> 'allow'
        OR phone.voice_hold IS TRUE
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.leads AS lead
    WHERE length(public.prospecting_phone_key_v1(lead.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(lead.phone), 4) = right(v_key, 4)
      AND (
        coalesce(public.dialer_suppression_class_v1('lead_call_result', lead.call_result), 'allow') <> 'allow'
        OR coalesce(public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason), 'allow') <> 'allow'
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_mojo_call_events AS event
    WHERE length(public.prospecting_phone_key_v1(event.normalized_phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(event.normalized_phone), 4) = right(v_key, 4)
      AND coalesce(public.dialer_suppression_class_v1('mojo_outcome', event.outcome), 'allow') <> 'allow'
  ) OR EXISTS (
    SELECT 1
    FROM public.sms_opt_outs AS opt_out
    WHERE opt_out.is_opted_out IS TRUE
      AND length(public.prospecting_phone_key_v1(opt_out.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(opt_out.phone), 4) = right(v_key, 4)
  ) THEN
    RETURN 'hold_last4';
  END IF;

  -- Line-check blocks run only after every DNC, fan-out, and hold check.
  -- Counsel ruling §4a, 2026-11-14 (Lookup inactive). LINE_CHECK_BLOCK_ENABLED
  -- defaults off so applying this migration does not block live phones.
  IF public.phone_line_check_block_enabled_v1() THEN
    v_line := public.phone_line_export_block_reason_v1(p_phone);
    IF v_line IS NOT NULL THEN
      RETURN v_line;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT public.source_list_phone_block_reason_v1(p_phone, NULL::uuid);
$function$;

CREATE OR REPLACE FUNCTION public.source_list_phone_sms_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT public.phone_line_check_block_enabled_v1() THEN public.source_list_phone_block_reason_v1(p_phone)
    ELSE coalesce(
      public.source_list_phone_block_reason_v1(p_phone, NULL::uuid),
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.prospect_phones AS phone
          WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
            AND phone.line_type IN ('mobile', 'nonFixedVoip')
            AND phone.line_last_active_at >= clock_timestamp() - interval '90 days'
        ) THEN NULL
        ELSE 'sms_requires_mobile'
      END
    )
  END;
$$;

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
  public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id) AS block_reason,
  CASE
    WHEN public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id) IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.prospect_phones AS phone
        WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(dialed.phone_value)
          AND phone.line_check_raw->>'stale_active_export' = 'true'
      )
    THEN 'stale_active'
    ELSE NULL
  END AS line_check_flag
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
  line_check_flag
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL;

CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
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
  phone_value,
  phone_e164,
  phone_origin,
  pull_date,
  source_file_name,
  block_reason,
  line_check_flag
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NOT NULL;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows keep the #814 two-argument scrub. Line-check reasons are appended inside that function only while LINE_CHECK_BLOCK_ENABLED is on.';
COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Same columns as before, plus line_check_flag. Block reasons still come from source_list_phone_block_reason_v1(phone, prospect_id).';

COMMENT ON FUNCTION public.phone_line_rnd_clear_v1(text, timestamptz) IS
  'RND HOOK. Counsel ruling §4a, 2026-11-14 (Lookup inactive): an active recheck is eligible only when this returns clear. It returns unavailable until the Reassigned Numbers Database is connected, so the recheck stays suppressed_bad_number.';

REVOKE ALL ON FUNCTION public.phone_line_check_block_enabled_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_check_unit_cost_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_phone_line_check_config_v1(boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_classifier_skip_reason_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_decide_v1(text, boolean, text, timestamptz, integer, boolean, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_phone_line_checks_v1(jsonb, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_phone_line_check_candidates_v1(integer, uuid, uuid[], numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_export_block_reason_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_phone_sms_block_reason_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.phone_line_check_block_enabled_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_check_unit_cost_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_phone_line_check_config_v1(boolean, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_classifier_skip_reason_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_decide_v1(text, boolean, text, timestamptz, integer, boolean, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_phone_line_checks_v1(jsonb, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_phone_line_check_candidates_v1(integer, uuid, uuid[], numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_export_block_reason_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_phone_sms_block_reason_v1(text) TO service_role;

REVOKE ALL ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export, public.source_list_dialer_suppressed
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export, public.source_list_dialer_suppressed
  TO service_role;
