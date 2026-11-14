-- Daily Twilio Lookup v2 line check for prospect phones.
--
-- phone_line_checks is append-only. Retain rows for 5 years. This migration
-- does not update or delete them, and it does not read or write mojo_call_queue.
-- Caps (1,500 phones/day, $15/day, $60/calendar month) are counted in
-- America/Chicago before each batch. A hit stops the batch and inserts a row
-- in phone_line_check_cap_log.
--
-- Lookup price stored on every check is $0.015: Twilio Lookup line status
-- $0.007 plus line type intelligence $0.008 (published October 2026, first tier).

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS line_type text,
  ADD COLUMN IF NOT EXISTS line_status text,
  ADD COLUMN IF NOT EXISTS line_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS line_check_raw jsonb,
  ADD COLUMN IF NOT EXISTS line_recheck_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_suppressed_at timestamptz;

ALTER TABLE public.prospect_phones
  DROP CONSTRAINT IF EXISTS prospect_phones_line_recheck_count_check;

ALTER TABLE public.prospect_phones
  ADD CONSTRAINT prospect_phones_line_recheck_count_check
  CHECK (line_recheck_count >= 0);

COMMENT ON COLUMN public.prospect_phones.line_type IS
  'Twilio Lookup line type: landline, mobile, fixedVoip, nonFixedVoip, personal, tollFree, premium, sharedCost, uan, voicemail, pager, unknown.';
COMMENT ON COLUMN public.prospect_phones.line_status IS
  'Operational line-check status: active, unreachable, unknown, suppressed_lookup_inactive, suppressed_bad_number. Twilio Inactive is a soft suppress, not DNC and not a dial-proven disconnect.';
COMMENT ON COLUMN public.prospect_phones.line_checked_at IS
  'When Lookup last ran for this phone. Unreachable numbers are due again after 7 days. Other results are due after 30 days. A failed unknown result is due again after 1 day.';
COMMENT ON COLUMN public.prospect_phones.line_check_raw IS
  'Latest Lookup decision. reason lookup_inactive is the soft suppress. stale_active_export true means a failed check left a phone active that was confirmed within 90 days.';
COMMENT ON COLUMN public.prospect_phones.line_recheck_count IS
  'Inactive rechecks already performed. The initial inactive result is 0. The 30-day recheck is 1. The 60-day recheck is 2 and, if still inactive, becomes suppressed_bad_number.';
COMMENT ON COLUMN public.prospect_phones.line_suppressed_at IS
  'When a Lookup soft or permanent suppress started. Cleared when a non-suppress result is stored. Never a consent flag.';

CREATE INDEX IF NOT EXISTS prospect_phones_line_checked_at_idx
  ON public.prospect_phones (line_checked_at);

CREATE INDEX IF NOT EXISTS prospect_phones_line_check_key_idx
  ON public.prospect_phones (public.prospecting_phone_key_v1(phone))
  WHERE public.normalize_conversation_phone(phone) IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phone_line_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  prospect_phone_id uuid,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  line_type text,
  line_status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd numeric(10, 4) NOT NULL,
  source text NOT NULL,
  actor text,
  CONSTRAINT phone_line_checks_phone_check CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  CONSTRAINT phone_line_checks_status_check CHECK (
    line_status IS NULL OR line_status IN ('active', 'inactive', 'unreachable', 'unknown')
  ),
  CONSTRAINT phone_line_checks_cost_check CHECK (cost_usd >= 0),
  CONSTRAINT phone_line_checks_source_check CHECK (source IN ('cron', 'manual'))
);

COMMENT ON TABLE public.phone_line_checks IS
  'Append-only Twilio Lookup line checks. Do not update or delete rows. Retain for 5 years. This migration does not purge them.';
COMMENT ON COLUMN public.phone_line_checks.line_status IS
  'Mapped Twilio Line Status: active (Active or Reachable), inactive (Inactive), unreachable, or unknown. The operational suppress status lives on prospect_phones.line_status.';
COMMENT ON COLUMN public.phone_line_checks.cost_usd IS
  'Per-check price. $0.015 is line status $0.007 plus line type intelligence $0.008.';

CREATE INDEX IF NOT EXISTS phone_line_checks_checked_at_idx
  ON public.phone_line_checks (checked_at);

CREATE INDEX IF NOT EXISTS phone_line_checks_phone_idx
  ON public.phone_line_checks (phone_e164, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.phone_line_check_cap_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cap_name text NOT NULL,
  source text NOT NULL,
  actor text,
  phones_today integer NOT NULL,
  cost_today_usd numeric(12, 4) NOT NULL,
  cost_month_usd numeric(12, 4) NOT NULL,
  batch_size integer NOT NULL,
  accepted integer NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT phone_line_check_cap_log_name_check CHECK (
    cap_name IN ('daily_phones', 'daily_cost', 'monthly_cost')
  ),
  CONSTRAINT phone_line_check_cap_log_source_check CHECK (source IN ('cron', 'manual'))
);

COMMENT ON TABLE public.phone_line_check_cap_log IS
  'Append-only log of Lookup batches stopped by the daily phone cap, the daily dollar cap, or the calendar-month dollar cap.';

CREATE OR REPLACE FUNCTION public.phone_line_checks_append_only_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'phone_line_checks_append_only';
END;
$$;

DROP TRIGGER IF EXISTS phone_line_checks_append_only ON public.phone_line_checks;
CREATE TRIGGER phone_line_checks_append_only
  BEFORE UPDATE OR DELETE ON public.phone_line_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.phone_line_checks_append_only_v1();

DROP TRIGGER IF EXISTS phone_line_check_cap_log_append_only ON public.phone_line_check_cap_log;
CREATE TRIGGER phone_line_check_cap_log_append_only
  BEFORE UPDATE OR DELETE ON public.phone_line_check_cap_log
  FOR EACH ROW
  EXECUTE FUNCTION public.phone_line_checks_append_only_v1();

ALTER TABLE public.phone_line_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_line_check_cap_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.phone_line_checks, public.phone_line_check_cap_log
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.phone_line_checks, public.phone_line_check_cap_log
  TO service_role;

-- RND HOOK: the FCC Reassigned Numbers Database is not connected.
-- Replace this function when it is. Return 'clear' only when RND shows no
-- permanent disconnect after p_skip_trace_at. Return 'permanent_disconnect'
-- when it does. Any other result, including today's 'unavailable', keeps a
-- recheck that comes back active on suppressed_bad_number. A fresh skip trace
-- is required before that phone can be dialed again. Lookup is not consent.
CREATE OR REPLACE FUNCTION public.phone_line_rnd_clear_v1(
  p_phone_e164 text,
  p_skip_trace_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM p_phone_e164, p_skip_trace_at;
  RETURN 'unavailable';
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_line_row_is_dial_disconnect_v1(
  p_last_disposition text,
  p_phone_connected text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    lower(regexp_replace(coalesce(p_last_disposition, ''), '[[:space:]-]+', '_', 'g'))
      IN ('disconnected', 'bad_number', 'not_in_service')
    OR lower(btrim(coalesce(p_phone_connected, '')))
      IN ('false', 'no', 'disconnected', 'bad_number');
$$;

CREATE OR REPLACE FUNCTION public.phone_line_is_due_v1(
  p_line_status text,
  p_line_checked_at timestamptz,
  p_line_recheck_count integer,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    p_line_checked_at IS NULL
    OR (
      p_line_status = 'unreachable'
      AND p_line_checked_at <= p_now - interval '7 days'
    )
    OR (
      p_line_status = 'unknown'
      AND p_line_checked_at <= p_now - interval '1 day'
    )
    OR (
      coalesce(p_line_status, '') NOT IN ('unreachable', 'unknown', 'suppressed_bad_number')
      AND NOT (
        p_line_status = 'suppressed_lookup_inactive'
        AND coalesce(p_line_recheck_count, 0) >= 2
      )
      AND p_line_checked_at <= p_now - interval '30 days'
    );
$$;

CREATE OR REPLACE FUNCTION public.phone_line_skip_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN public.normalize_conversation_phone(p_phone) IS NULL THEN 'invalid_phone'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g'))
          IN ('dnc', 'do_not_call', 'dnc_contact', 'dnc_number')
    ) OR EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(coalesce(lead.dead_reason, '')) IN ('dnc_refused', 'dnc', 'do_not_call')
          OR lower(regexp_replace(coalesce(lead.call_result, ''), '[[:space:]-]+', '_', 'g'))
            IN ('dnc', 'do_not_call')
        )
    ) THEN 'dnc'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g'))
          IN ('take_me_off', 'take_me_off_the_list')
    ) THEN 'take_me_off'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) = 'wrong_number'
          OR lower(btrim(coalesce(phone.phone_connected::text, ''))) = 'wrong_number'
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
        AND public.phone_line_row_is_dial_disconnect_v1(phone.last_disposition, phone.phone_connected::text)
    ) THEN 'dial_disconnect'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_bad_number'
    ) THEN 'suppressed_bad_number'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.phone_line_check_budget_v1()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_unit numeric := 0.015;
  v_phones integer := 0;
  v_cost_today numeric := 0;
  v_cost_month numeric := 0;
  v_by_phones integer;
  v_by_day integer;
  v_by_month integer;
  v_remaining integer;
  v_binding text;
  v_today date := (clock_timestamp() AT TIME ZONE 'America/Chicago')::date;
  v_month timestamp := date_trunc('month', clock_timestamp() AT TIME ZONE 'America/Chicago');
BEGIN
  SELECT count(*)::integer, coalesce(sum(cost_usd), 0)
  INTO v_phones, v_cost_today
  FROM public.phone_line_checks
  WHERE (checked_at AT TIME ZONE 'America/Chicago')::date = v_today;

  SELECT coalesce(sum(cost_usd), 0)
  INTO v_cost_month
  FROM public.phone_line_checks
  WHERE date_trunc('month', checked_at AT TIME ZONE 'America/Chicago') = v_month;

  v_by_phones := greatest(0, 1500 - v_phones);
  v_by_day := greatest(0, floor(greatest(0, 15 - v_cost_today) / v_unit))::integer;
  v_by_month := greatest(0, floor(greatest(0, 60 - v_cost_month) / v_unit))::integer;
  v_remaining := least(v_by_phones, v_by_day, v_by_month);
  v_binding := CASE
    WHEN v_by_phones <= v_by_day AND v_by_phones <= v_by_month THEN 'daily_phones'
    WHEN v_by_day <= v_by_month THEN 'daily_cost'
    ELSE 'monthly_cost'
  END;

  RETURN jsonb_build_object(
    'remaining', v_remaining,
    'cap', CASE WHEN v_remaining > 0 THEN NULL ELSE v_binding END,
    'binding_cap', v_binding,
    'phones_today', v_phones,
    'cost_today_usd', v_cost_today,
    'cost_month_usd', v_cost_month
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_line_decide_v1(
  p_mapped_status text,
  p_failed boolean,
  p_prior_status text,
  p_prior_checked_at timestamptz,
  p_recheck_count integer,
  p_dial_disconnect boolean,
  p_phone_e164 text,
  p_skip_trace_at timestamptz,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer := greatest(0, coalesce(p_recheck_count, 0));
  v_rnd text;
  v_status text;
  v_reason text;
  v_next integer;
  v_stale boolean := false;
  v_fill boolean := false;
BEGIN
  IF p_dial_disconnect THEN
    v_status := 'suppressed_bad_number';
    v_reason := 'dial_disconnect';
  ELSIF p_prior_status = 'suppressed_bad_number' THEN
    v_status := 'suppressed_bad_number';
    v_reason := 'permanent_bad_number';
  ELSIF p_failed OR p_mapped_status IS DISTINCT FROM 'active' AND p_mapped_status IS DISTINCT FROM 'inactive' AND p_mapped_status IS DISTINCT FROM 'unreachable' THEN
    IF p_prior_status = 'active'
      AND p_prior_checked_at IS NOT NULL
      AND p_prior_checked_at >= p_now - interval '90 days'
    THEN
      v_status := 'active';
      v_reason := 'check_failed_stale_active';
      v_stale := true;
    ELSE
      v_status := 'unknown';
      v_reason := 'check_failed';
    END IF;
  ELSIF p_mapped_status = 'unreachable' THEN
    v_status := 'unreachable';
    v_reason := 'unreachable_hold';
  ELSIF p_mapped_status = 'inactive' THEN
    IF p_prior_status = 'suppressed_lookup_inactive' THEN
      v_next := v_count + 1;
      v_count := v_next;
      IF v_next >= 2 THEN
        v_status := 'suppressed_bad_number';
        v_reason := 'recheck_still_inactive';
      ELSE
        v_status := 'suppressed_lookup_inactive';
        v_reason := 'lookup_inactive';
      END IF;
    ELSE
      v_count := 0;
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
    ELSIF v_rnd = 'permanent_disconnect' THEN
      v_status := 'suppressed_bad_number';
      v_reason := 'rnd_permanent_disconnect';
    ELSE
      v_status := 'suppressed_bad_number';
      v_reason := 'recheck_active_rnd_unavailable';
      v_rnd := 'unavailable';
    END IF;
  ELSE
    v_status := 'active';
    v_reason := 'lookup_active';
    v_count := 0;
    v_fill := true;
  END IF;

  RETURN jsonb_build_object(
    'line_status', v_status,
    'reason', v_reason,
    'recheck_count', v_count,
    'stale_active_export', v_stale,
    'fill_phone_connected', v_fill,
    'rnd', v_rnd
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
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer;
  v_budget jsonb;
  v_remaining integer;
  v_candidates jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
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

  v_budget := public.phone_line_check_budget_v1();
  v_remaining := coalesce((v_budget->>'remaining')::integer, 0);
  v_limit := least(v_limit, v_remaining);

  IF v_limit > 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'phone_e164', picked.phone_e164,
      'prospect_phone_id', picked.id
    ) ORDER BY picked.line_checked_at NULLS FIRST, picked.id), '[]'::jsonb)
    INTO v_candidates
    FROM (
      SELECT picked_inner.id, picked_inner.phone_e164, picked_inner.line_checked_at
      FROM (
        SELECT DISTINCT ON (public.prospecting_phone_key_v1(phone.phone))
          phone.id,
          public.normalize_conversation_phone(phone.phone) AS phone_e164,
          phone.line_checked_at
        FROM public.prospect_phones AS phone
        WHERE public.normalize_conversation_phone(phone.phone) IS NOT NULL
          AND public.phone_line_skip_reason_v1(phone.phone) IS NULL
          AND public.phone_line_is_due_v1(
            phone.line_status,
            phone.line_checked_at,
            phone.line_recheck_count,
            clock_timestamp()
          )
          AND (
            p_prospect_phone_ids IS NULL
            OR phone.id = ANY (p_prospect_phone_ids)
          )
          AND (
            p_source_list_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.source_list_rows AS row
              WHERE row.source_list_id = p_source_list_id
                AND (
                  (row.prospect_id IS NOT NULL AND row.prospect_id = phone.prospect_id)
                  OR EXISTS (
                    SELECT 1
                    FROM unnest(row.phones) AS phone_value
                    WHERE public.prospecting_phone_key_v1(phone_value) = public.prospecting_phone_key_v1(phone.phone)
                  )
                )
            )
          )
        ORDER BY
          public.prospecting_phone_key_v1(phone.phone),
          phone.line_checked_at NULLS FIRST,
          phone.id
      ) AS picked_inner
      ORDER BY picked_inner.line_checked_at NULLS FIRST, picked_inner.id
      LIMIT v_limit
    ) AS picked;
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
          WHEN public.phone_line_skip_reason_v1(phone.phone) IS NOT NULL
            THEN public.phone_line_skip_reason_v1(phone.phone)
          WHEN NOT public.phone_line_is_due_v1(
            phone.line_status,
            phone.line_checked_at,
            phone.line_recheck_count,
            clock_timestamp()
          ) THEN 'not_due'
          WHEN v_remaining = 0 THEN coalesce(v_budget->>'cap', 'daily_phones')
          ELSE NULL
        END AS reason
      FROM unnest(p_prospect_phone_ids) AS requested_id(id)
      LEFT JOIN public.prospect_phones AS phone ON phone.id = requested_id.id
    ) AS requested
    WHERE requested.reason IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'remaining', v_remaining,
    'cap', CASE WHEN v_remaining = 0 THEN v_budget->>'cap' ELSE NULL END,
    'candidates', v_candidates,
    'skipped', v_skipped
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_phone_line_checks_v1(
  p_results jsonb,
  p_source text,
  p_actor text,
  p_report_cap boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_budget jsonb;
  v_remaining integer;
  v_allowed integer;
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
  v_skip_trace_at timestamptz;
  v_dial boolean;
  v_decision jsonb;
  v_status text;
  v_reason text;
  v_recheck integer;
  v_raw jsonb;
  v_fill boolean;
  v_blocked boolean;
  v_stopped boolean := false;
  v_cap text;
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

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-line-check-cap', 0));
  v_budget := public.phone_line_check_budget_v1();
  v_remaining := coalesce((v_budget->>'remaining')::integer, 0);
  v_allowed := least(jsonb_array_length(p_results), v_remaining);
  v_stopped := v_allowed < jsonb_array_length(p_results) OR (p_report_cap AND v_remaining = 0 AND jsonb_array_length(p_results) = 0);
  v_cap := CASE
    WHEN v_stopped THEN coalesce(v_budget->>'cap', v_budget->>'binding_cap')
    ELSE NULL
  END;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_results)
  LOOP
    EXIT WHEN v_accepted >= v_allowed;
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

    v_prior_status := NULL;
    v_prior_checked := NULL;
    v_prior_count := 0;
    v_skip_trace_at := NULL;
    v_phone_id := NULL;
    SELECT phone.id
    INTO v_phone_id
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164
    ORDER BY phone.id
    LIMIT 1;
    SELECT
      phone.line_status,
      phone.line_checked_at,
      coalesce(phone.line_recheck_count, 0),
      phone.created_at
    INTO v_prior_status, v_prior_checked, v_prior_count, v_skip_trace_at
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164
    ORDER BY phone.line_recheck_count DESC NULLS LAST, phone.line_checked_at DESC NULLS LAST, phone.id
    LIMIT 1;
    SELECT min(phone.created_at)
    INTO v_skip_trace_at
    FROM public.prospect_phones AS phone
    WHERE public.normalize_conversation_phone(phone.phone) = v_e164;
    SELECT EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.normalize_conversation_phone(phone.phone) = v_e164
        AND public.phone_line_row_is_dial_disconnect_v1(phone.last_disposition, phone.phone_connected::text)
    ) INTO v_dial;

    v_decision := public.phone_line_decide_v1(
      v_mapped,
      v_failed,
      v_prior_status,
      v_prior_checked,
      coalesce(v_prior_count, 0),
      coalesce(v_dial, false),
      v_e164,
      v_skip_trace_at,
      v_checked_at
    );
    v_status := v_decision->>'line_status';
    v_reason := v_decision->>'reason';
    v_recheck := coalesce((v_decision->>'recheck_count')::integer, 0);
    v_fill := coalesce((v_decision->>'fill_phone_connected')::boolean, false);
    v_blocked := public.phone_line_skip_reason_v1(v_e164) IS NOT NULL;
    v_raw := coalesce(v_item->'raw', '{}'::jsonb) || jsonb_build_object(
      'failed', v_failed,
      'mapped_status', v_mapped,
      'mapped_type', v_line_type,
      'reason', v_reason,
      'decision_status', v_status,
      'stale_active_export', coalesce((v_decision->>'stale_active_export')::boolean, false),
      'rnd', v_decision->'rnd',
      'cost_usd', 0.015
    );

    INSERT INTO public.phone_line_checks (
      phone_e164, prospect_phone_id, checked_at, line_type, line_status, raw, cost_usd, source, actor
    ) VALUES (
      v_e164, v_phone_id, v_checked_at, v_line_type, v_mapped, v_raw, 0.015, p_source, v_actor
    );

    UPDATE public.prospect_phones AS phone
    SET
      line_type = v_line_type,
      line_status = v_status,
      line_checked_at = v_checked_at,
      line_check_raw = v_raw,
      line_recheck_count = v_recheck,
      line_suppressed_at = CASE
        WHEN v_status IN ('suppressed_lookup_inactive', 'suppressed_bad_number')
          THEN coalesce(phone.line_suppressed_at, v_checked_at)
        ELSE NULL
      END,
      phone_connected = CASE
        WHEN v_fill
          AND NOT v_blocked
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

  IF v_stopped AND v_cap IS NOT NULL THEN
    INSERT INTO public.phone_line_check_cap_log (
      cap_name, source, actor, phones_today, cost_today_usd, cost_month_usd, batch_size, accepted, detail
    ) VALUES (
      v_cap,
      p_source,
      v_actor,
      coalesce((v_budget->>'phones_today')::integer, 0) + v_accepted,
      coalesce((v_budget->>'cost_today_usd')::numeric, 0) + (v_accepted * 0.015),
      coalesce((v_budget->>'cost_month_usd')::numeric, 0) + (v_accepted * 0.015),
      jsonb_array_length(p_results),
      v_accepted,
      jsonb_build_object('allowed', v_allowed)
    );
  END IF;

  RETURN jsonb_build_object(
    'accepted', v_accepted,
    'stopped', v_stopped,
    'cap', v_cap,
    'batch_size', jsonb_array_length(p_results),
    'phones_today', coalesce((v_budget->>'phones_today')::integer, 0) + v_accepted,
    'cost_today_usd', coalesce((v_budget->>'cost_today_usd')::numeric, 0) + (v_accepted * 0.015),
    'cost_month_usd', coalesce((v_budget->>'cost_month_usd')::numeric, 0) + (v_accepted * 0.015)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.phone_line_rnd_clear_v1(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_row_is_dial_disconnect_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_is_due_v1(text, timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_skip_reason_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_check_budget_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_decide_v1(text, boolean, text, timestamptz, integer, boolean, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.select_phone_line_check_candidates_v1(integer, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_phone_line_checks_v1(jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_line_checks_append_only_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.phone_line_rnd_clear_v1(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_row_is_dial_disconnect_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_is_due_v1(text, timestamptz, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_skip_reason_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_check_budget_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_line_decide_v1(text, boolean, text, timestamptz, integer, boolean, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.select_phone_line_check_candidates_v1(integer, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_phone_line_checks_v1(jsonb, text, text, boolean) TO service_role;

COMMENT ON FUNCTION public.phone_line_rnd_clear_v1(text, timestamptz) IS
  'RND HOOK. Returns unavailable until the Reassigned Numbers Database is connected. A clear result is the only path that lets a soft-suppressed phone become active again.';
COMMENT ON FUNCTION public.apply_phone_line_checks_v1(jsonb, text, text, boolean) IS
  'Writes Lookup results and prospect phone line status. Counts the 1500-phone, $15/day, and $60/calendar-month caps before the batch. Does not change last_disposition, voice_hold, opt-out, or mojo_call_queue.';

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
      WHERE lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) IN ('dnc', 'do_not_call')
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'prospect_dnc'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) = 'wrong_number'
          OR lower(btrim(coalesce(phone.phone_connected::text, ''))) = 'wrong_number'
        )
    ) THEN 'wrong_number'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) IN ('disconnected', 'bad_number', 'not_in_service')
          OR lower(btrim(coalesce(phone.phone_connected::text, ''))) IN ('false', 'no', 'disconnected', 'bad_number')
        )
    ) THEN 'disconnected'
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
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_bad_number'
    ) THEN 'suppressed_bad_number'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'suppressed_lookup_inactive'
    ) THEN 'suppressed_lookup_inactive'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'unreachable'
    ) THEN 'line_status_unreachable'
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND phone.line_status = 'active'
    ) THEN 'line_check_unknown'
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text) IS
  'Live scrub. Existing opt-out, hold, DNC, wrong-number, and dial-disconnect reasons still win. Lookup adds suppressed_bad_number, suppressed_lookup_inactive, line_status_unreachable, and line_check_unknown. A landline is not blocked here. sms_requires_mobile is source_list_phone_sms_block_reason_v1.';

CREATE OR REPLACE FUNCTION public.source_list_phone_sms_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    public.source_list_phone_block_reason_v1(p_phone),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.prospect_phones AS phone
        WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
          AND phone.line_type IN ('mobile', 'nonFixedVoip')
          AND phone.line_status = 'active'
      ) THEN NULL
      ELSE 'sms_requires_mobile'
    END
  );
$$;

REVOKE ALL ON FUNCTION public.source_list_phone_sms_block_reason_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_phone_sms_block_reason_v1(text) TO service_role;

COMMENT ON FUNCTION public.source_list_phone_sms_block_reason_v1(text) IS
  'Texting scrub. Voice blocks apply first. Otherwise the phone needs an active mobile or nonFixedVoip line. Landlines stay eligible for live voice.';

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
  public.source_list_phone_block_reason_v1(dialed.phone_value) AS block_reason,
  CASE
    WHEN public.source_list_phone_block_reason_v1(dialed.phone_value) IS NULL
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

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. line_check_flag stale_active marks a phone still exported after a failed Lookup because it was active within 90 days. Do not load the dialer from this view.';

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

COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Drops opt-out, do-not-call, voice-hold, wrong-number, disconnected, suppressed_lookup_inactive, suppressed_bad_number, unreachable, and never-checked phones. Landlines remain. stale_active is a flag, not a block.';

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

COMMENT ON VIEW public.source_list_dialer_suppressed IS
  'Phones removed from the dialer export, including suppressed_lookup_inactive, suppressed_bad_number, line_status_unreachable, and line_check_unknown.';

REVOKE ALL ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.source_list_dialer_phone_review, public.source_list_dialer_export,
  public.source_list_dialer_suppressed
  TO service_role;
