-- Calling pool v1. Caps, cycles, cooldowns, quiet hours, and the 4:00am CT
-- lock live in system_config key dialer_pool_caps_v1 (Pat R-1114). The numbers
-- are not inlined in these functions.
-- Re-eligibility lands on eligible_pending_scrub and does not load a list.
-- Does not read or write mojo_call_queue, and does not change Mojo, Twilio,
-- or Mercury settings. Multi-line stays suspended. Service area stays the
-- five counties already enforced by the scrub.

CREATE OR REPLACE FUNCTION public.dialer_pool_now_v1()
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  raw text := nullif(btrim(current_setting('dialer.pool_now', true)), '');
BEGIN
  IF raw IS NULL THEN
    RETURN clock_timestamp();
  END IF;
  RETURN raw::timestamptz;
EXCEPTION
  WHEN others THEN
    RETURN clock_timestamp();
END;
$function$;

COMMENT ON FUNCTION public.dialer_pool_now_v1() IS
  'Pool clock. Tests set dialer.pool_now; otherwise this is the transaction clock.';

CREATE OR REPLACE FUNCTION public.dialer_pool_later_v1(p_left timestamptz, p_right timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN p_left IS NULL THEN p_right
    WHEN p_right IS NULL THEN p_left
    WHEN p_left > p_right THEN p_left
    ELSE p_right
  END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_easter_v1(p_year integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  month_num integer := (h + l - 7 * m + 114) / 31;
  day_num integer := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN
  RETURN make_date(p_year, month_num, day_num);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_thanksgiving_v1(p_year integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT make_date(p_year, 11, 1)
    + ((4 - extract(dow FROM make_date(p_year, 11, 1))::integer + 7) % 7)
    + 21;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_pool_holiday_v1(p_day date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(coalesce(
      (SELECT value->'holidays' FROM public.system_config WHERE key = 'dialer_pool_caps_v1'),
      '[]'::jsonb
    )) AS holiday(name)
    WHERE CASE holiday.name
      WHEN 'new_year' THEN p_day = make_date(extract(year FROM p_day)::integer, 1, 1)
      WHEN 'july_4' THEN p_day = make_date(extract(year FROM p_day)::integer, 7, 4)
      WHEN 'christmas' THEN p_day = make_date(extract(year FROM p_day)::integer, 12, 25)
      WHEN 'easter' THEN p_day = public.dialer_easter_v1(extract(year FROM p_day)::integer)
      WHEN 'thanksgiving' THEN p_day = public.dialer_thanksgiving_v1(extract(year FROM p_day)::integer)
      ELSE false
    END
  );
$function$;

CREATE OR REPLACE FUNCTION public.dialer_pool_business_window_start_v1(p_end date)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  needed integer;
  seen integer := 0;
  cursor_day date := p_end;
  steps integer := 0;
BEGIN
  SELECT coalesce((value->>'audit_business_days')::integer, 0)
  INTO needed
  FROM public.system_config
  WHERE key = 'dialer_pool_caps_v1';
  IF needed IS NULL OR needed < 1 THEN
    RETURN p_end;
  END IF;
  WHILE seen < needed AND steps < 60 LOOP
    IF extract(dow FROM cursor_day) NOT IN (0, 6)
      AND NOT public.dialer_pool_holiday_v1(cursor_day) THEN
      seen := seen + 1;
    END IF;
    IF seen >= needed THEN
      RETURN cursor_day;
    END IF;
    cursor_day := cursor_day - 1;
    steps := steps + 1;
  END LOOP;
  RETURN cursor_day;
END;
$function$;

INSERT INTO public.system_config(key, value, updated_at)
VALUES (
  'dialer_pool_caps_v1',
  jsonb_build_object(
    'tier1_min_signals', 3,
    'tier2_min_signals', 2,
    'list_lock_ct', '04:00',
    'audit_findings_to_block', 2,
    'audit_business_days', 5,
    'fresh_intake_min_days', 7,
    'cap_hit_lookback_months', 12,
    'retire_on_cap_hit', 3,
    'vm_gap_hours', 72,
    'phones_per_contact', jsonb_build_object('tier1', 3, 'tier2', 2, 'single', 1),
    'number_daily_cap', jsonb_build_object('first_3_days', 30, 'after', 75),
    'quiet_hours', jsonb_build_object(
      'weekday_start', 9,
      'weekday_end', 20,
      'sunday_start', 13,
      'sunday_end', 18,
      'unknown_start_ct', 11,
      'unknown_end_ct', 20
    ),
    'holidays', jsonb_build_array('new_year', 'july_4', 'christmas', 'thanksgiving', 'easter'),
    'not_interested_days', jsonb_build_array(90, 180),
    'tiers', jsonb_build_object(
      'tier1', jsonb_build_object(
        'cycle_days', 14,
        'attempt_cap_cycle', 6,
        'min_gap_hours', 4,
        'attempt_cap_day_number', 2,
        'attempt_cap_day_person', 3,
        'attempt_cap_7d_number', 4,
        'vm_cap_cycle', 2,
        'cooldown_days', jsonb_build_array(30, 60),
        'all_channel', jsonb_build_object('cycle', 10, 'day_one', 3, 'day_after', 2, 'week', 7)
      ),
      'tier2', jsonb_build_object(
        'cycle_days', 21,
        'attempt_cap_cycle', 4,
        'min_gap_hours', 24,
        'attempt_cap_day_number', 1,
        'attempt_cap_day_person', 2,
        'attempt_cap_7d_number', 3,
        'vm_cap_cycle', 1,
        'cooldown_days', jsonb_build_array(45, 90),
        'all_channel', jsonb_build_object('cycle', 7, 'day', 2, 'week', 4)
      ),
      'single', jsonb_build_object(
        'cycle_days', 28,
        'attempt_cap_cycle', 3,
        'min_gap_hours', 48,
        'attempt_cap_day_number', 1,
        'attempt_cap_day_person', 1,
        'attempt_cap_7d_person', 2,
        'vm_cap_cycle', 1,
        'cooldown_days', jsonb_build_array(60, 120),
        'all_channel', jsonb_build_object('cycle', 5, 'day', 1, 'week', 3)
      )
    ),
    'timezones', (
      SELECT jsonb_object_agg(code, zone)
      FROM (
        SELECT unnest(ARRAY[
          '214','254','281','314','316','318','319','320','325','331','334','337','346',
          '361','402','405','409','414','417','430','432','469','479','501','504','507',
          '512','515','531','539','557','563','573','580','601','605','612','614','615',
          '618','620','630','636','641','651','660','662','682','701','708','712','713',
          '715','716','731','737','763','769','773','779','785','806','815','816','817',
          '830','832','847','870','872','901','903','913','918','920','936','940','945',
          '952','956','972','979','985'
        ]) AS code, 'America/Chicago'::text AS zone
        UNION ALL
        SELECT unnest(ARRAY[
          '201','202','203','207','212','215','216','220','223','229','231','234','239',
          '240','248','252','267','269','272','276','301','302','304','305','313','315',
          '321','330','332','336','339','347','351','352','380','386','401','404','407',
          '410','412','413','419','434','440','443','470','475','478','484','502','508',
          '513','516','517','518','540','551','561','567','570','571','585','586','603',
          '607','609','610','617','631','646','667','678','680','681','689','703','704',
          '706','717','718','724','727','732','734','740','754','757','762','770','772',
          '774','781','786','802','803','804','810','813','814','828','835','843','845',
          '848','854','856','857','860','862','863','864','865','878','904','908','910',
          '912','914','917','919','929','934','937','941','947','954','959','973','978',
          '980','984'
        ]), 'America/New_York'
        UNION ALL
        SELECT unnest(ARRAY['303','307','385','406','435','505','575','719','720','801','970','208','986']), 'America/Denver'
        UNION ALL
        SELECT unnest(ARRAY['480','520','602','623','928']), 'America/Phoenix'
        UNION ALL
        SELECT unnest(ARRAY[
          '206','209','213','253','310','323','360','408','415','424','425','442','458',
          '503','509','510','530','541','559','562','564','619','626','628','650','657',
          '661','669','702','707','714','725','747','760','775','805','818','831','858',
          '909','916','925','949','951','971'
        ]), 'America/Los_Angeles'
        UNION ALL
        SELECT unnest(ARRAY['907']), 'America/Anchorage'
        UNION ALL
        SELECT unnest(ARRAY['808']), 'Pacific/Honolulu'
      ) AS zones
    )
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS delinquent_years_category text,
  ADD COLUMN IF NOT EXISTS occupancy_status text,
  ADD COLUMN IF NOT EXISTS is_deceased boolean;

ALTER TABLE public.mortgage_foreclosure_prospects
  ADD COLUMN IF NOT EXISTS prospect_id uuid,
  ADD COLUMN IF NOT EXISTS absentee_owner boolean;

ALTER TABLE public.crm_mojo_call_events
  ADD COLUMN IF NOT EXISTS call_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_call_at
  ON public.crm_mojo_call_events (call_at)
  WHERE call_at IS NOT NULL;

ALTER TABLE public.source_list_export_batches
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lock_batch_id uuid;

COMMENT ON COLUMN public.source_list_export_batches.lock_batch_id IS
  'When an export runs after the CT lock, this is the pre-lock batch it was not allowed to grow past.';

CREATE INDEX IF NOT EXISTS idx_source_list_export_batches_day_lock
  ON public.source_list_export_batches (created_at, county, list_type);

CREATE INDEX IF NOT EXISTS idx_source_list_rows_prospect
  ON public.source_list_rows (prospect_id);

CREATE INDEX IF NOT EXISTS idx_mortgage_foreclosure_prospects_prospect
  ON public.mortgage_foreclosure_prospects (prospect_id);

CREATE OR REPLACE FUNCTION public.dialer_pool_prospect_facts_v1(p_prospects uuid[])
RETURNS TABLE (
  prospect_id uuid,
  signal_count integer,
  tier text,
  intake_date date,
  sources text[]
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH ids AS (
    SELECT DISTINCT prospect_id
    FROM unnest(coalesce(p_prospects, ARRAY[]::uuid[])) AS prospect_id
    WHERE prospect_id IS NOT NULL
  ),
  cfg AS (
    SELECT value AS cfg
    FROM public.system_config
    WHERE key = 'dialer_pool_caps_v1'
  ),
  lists AS (
    SELECT
      row.prospect_id,
      bool_or(row.list_type = 'code_violation') AS code_violation,
      bool_or(row.list_type = 'foreclosure') AS foreclosure,
      max(list.pull_date) FILTER (
        WHERE row.list_type IN ('tax_delinquent', 'foreclosure', 'code_violation')
      ) AS intake_date,
      array_agg(DISTINCT row.list_type) AS sources
    FROM public.source_list_rows AS row
    JOIN public.source_lists AS list ON list.id = row.source_list_id
    JOIN ids ON ids.prospect_id = row.prospect_id
    GROUP BY row.prospect_id
  ),
  absentee AS (
    SELECT DISTINCT foreclosure.prospect_id
    FROM public.mortgage_foreclosure_prospects AS foreclosure
    JOIN ids ON ids.prospect_id = foreclosure.prospect_id
    WHERE foreclosure.absentee_owner IS TRUE
  ),
  scored AS (
    SELECT
      prospect.id AS prospect_id,
      (prospect.delinquent_years_category = '3yr_plus')::integer
        + (prospect.delinquent_years_category = '2yr')::integer
        + (lower(btrim(coalesce(prospect.occupancy_status, ''))) IN ('vacant', 'vacant_lot', 'vacant_structure'))::integer
        + (
          lower(btrim(coalesce(prospect.occupancy_status, ''))) IN ('absentee', 'non_owner_occupied', 'absentee_owner')
          OR absentee.prospect_id IS NOT NULL
        )::integer
        + coalesce(lists.code_violation, false)::integer
        + coalesce(lists.foreclosure, false)::integer
        + coalesce(prospect.is_deceased, false)::integer AS signal_count,
      lists.intake_date,
      coalesce(lists.sources, ARRAY[]::text[]) || ARRAY['prospect_phone']::text[] AS sources
    FROM public.prospects AS prospect
    JOIN ids ON ids.prospect_id = prospect.id
    LEFT JOIN lists ON lists.prospect_id = prospect.id
    LEFT JOIN absentee ON absentee.prospect_id = prospect.id
  )
  SELECT
    scored.prospect_id,
    scored.signal_count,
    CASE
      WHEN scored.signal_count >= (cfg.cfg->>'tier1_min_signals')::integer THEN 'tier1'
      WHEN scored.signal_count >= (cfg.cfg->>'tier2_min_signals')::integer THEN 'tier2'
      ELSE 'single'
    END,
    scored.intake_date,
    scored.sources
  FROM scored
  CROSS JOIN cfg;
$function$;

COMMENT ON FUNCTION public.dialer_pool_prospect_facts_v1(uuid[]) IS
  'Signal families for the pool. Tax 3yr+, vacant, and absentee each count. Tier thresholds are read from dialer_pool_caps_v1. Probate is not a pool signal.';

CREATE OR REPLACE FUNCTION public.dialer_pool_attempt_states_v1(p_items jsonb)
RETURNS TABLE (
  phone_key text,
  prospect_id uuid,
  attempts_in_cycle integer,
  cap_hits integer,
  next_eligible_at timestamptz,
  gate text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mojo_call_events AS call
    WHERE call.call_at IS NOT NULL
      AND (
        call.dialer_phone_key IN (
          SELECT item.phone_key
          FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS item(phone_key text)
          WHERE length(coalesce(item.phone_key, '')) = 10
        )
        OR call.dialer_phone_key IN (
          SELECT phone.dialer_phone_key
          FROM public.prospect_phones AS phone
          WHERE phone.prospect_id IN (
            SELECT item.prospect_id
            FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS item(prospect_id uuid)
            WHERE item.prospect_id IS NOT NULL
          )
        )
      )
  ) THEN
    RETURN QUERY
    SELECT DISTINCT ON (item.phone_key, item.prospect_id)
      item.phone_key, item.prospect_id, 0, 0, NULL::timestamptz, 'clear'::text
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      AS item(phone_key text, prospect_id uuid)
    WHERE length(coalesce(item.phone_key, '')) = 10
    ORDER BY item.phone_key, item.prospect_id;
    RETURN;
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT value AS cfg
    FROM public.system_config
    WHERE key = 'dialer_pool_caps_v1'
  ),
  clock AS (
    SELECT public.dialer_pool_now_v1() AS now_at
  ),
  item AS (
    SELECT
      x.phone_key,
      x.prospect_id,
      coalesce(nullif(x.tier, ''), 'single') AS tier,
      x.intake_date,
      cfg.cfg,
      clock.now_at,
      CASE coalesce(nullif(x.tier, ''), 'single')
        WHEN 'tier1' THEN cfg.cfg->'tiers'->'tier1'
        WHEN 'tier2' THEN cfg.cfg->'tiers'->'tier2'
        ELSE cfg.cfg->'tiers'->'single'
      END AS tier_cfg
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      AS x(phone_key text, prospect_id uuid, tier text, intake_date date)
    CROSS JOIN cfg
    CROSS JOIN clock
    WHERE length(coalesce(x.phone_key, '')) = 10
  ),
  scoped AS (
    SELECT
      item.*,
      greatest(coalesce((item.tier_cfg->>'cycle_days')::integer, 1), 1) AS cycle_days,
      greatest(coalesce((item.tier_cfg->>'attempt_cap_cycle')::integer, 1), 1) AS attempt_cap,
      coalesce((item.tier_cfg->>'min_gap_hours')::integer, 0) AS min_gap_hours,
      (item.tier_cfg->>'attempt_cap_day_number')::integer AS day_cap_number,
      (item.tier_cfg->>'attempt_cap_day_person')::integer AS day_cap_person,
      (item.tier_cfg->>'attempt_cap_7d_number')::integer AS cap_7d_number,
      (item.tier_cfg->>'attempt_cap_7d_person')::integer AS cap_7d_person,
      (item.tier_cfg->>'vm_cap_cycle')::integer AS vm_cap,
      coalesce((item.cfg->>'retire_on_cap_hit')::integer, 3) AS retire_on,
      coalesce((item.cfg->>'fresh_intake_min_days')::integer, 7) AS fresh_gap_days,
      coalesce((item.cfg->>'cap_hit_lookback_months')::integer, 12) AS lookback_months,
      (item.now_at AT TIME ZONE 'America/Chicago')::date AS today_ct
    FROM item
  ),
  anchored AS (
    SELECT
      scoped.*,
      CASE
        WHEN scoped.intake_date IS NULL THEN scoped.now_at - make_interval(months => scoped.lookback_months)
        WHEN EXISTS (
          SELECT 1
          FROM public.crm_mojo_call_events AS prior
          WHERE prior.dialer_phone_key = scoped.phone_key
            AND prior.call_at IS NOT NULL
            AND prior.call_at < (scoped.intake_date::timestamp AT TIME ZONE 'America/Chicago')
            AND prior.call_at >= (scoped.intake_date::timestamp AT TIME ZONE 'America/Chicago')
              - make_interval(days => scoped.fresh_gap_days)
            AND public.dialer_label_key_v1(prior.outcome) IS DISTINCT FROM 'not_interested'
            AND public.dialer_label_key_v1(prior.disposition_raw) IS DISTINCT FROM 'not_interested'
        ) THEN scoped.now_at - make_interval(months => scoped.lookback_months)
        ELSE (scoped.intake_date::timestamp AT TIME ZONE 'America/Chicago')
      END AS anchor
    FROM scoped
  ),
  event AS (
    SELECT
      call.dialer_phone_key AS phone_key,
      call.call_at,
      public.dialer_label_key_v1(call.outcome) AS outcome_key,
      public.dialer_label_key_v1(call.disposition_raw) AS raw_key
    FROM public.crm_mojo_call_events AS call
    CROSS JOIN clock
    WHERE call.call_at IS NOT NULL
      AND call.call_at >= clock.now_at - interval '18 months'
      AND (
        call.dialer_phone_key IN (SELECT anchored.phone_key FROM anchored)
        OR call.dialer_phone_key IN (
          SELECT phone.dialer_phone_key
          FROM public.prospect_phones AS phone
          WHERE phone.prospect_id IN (SELECT anchored.prospect_id FROM anchored WHERE anchored.prospect_id IS NOT NULL)
        )
      )
  ),
  bucketed AS (
    SELECT
      anchored.phone_key,
      anchored.prospect_id,
      floor(extract(epoch FROM (event.call_at - anchored.anchor)) / (anchored.cycle_days * 86400.0))::integer AS bucket,
      count(*)::integer AS n,
      count(*) FILTER (
        WHERE event.outcome_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
          OR event.raw_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
      )::integer AS vms,
      max(event.call_at) AS last_at
    FROM anchored
    JOIN event
      ON event.phone_key = anchored.phone_key
     AND event.call_at >= anchored.anchor
    GROUP BY anchored.phone_key, anchored.prospect_id, bucket
  ),
  hit AS (
    SELECT
      bucketed.phone_key,
      bucketed.prospect_id,
      count(*) FILTER (
        WHERE bucketed.n >= anchored.attempt_cap
          OR (anchored.vm_cap IS NOT NULL AND bucketed.vms >= anchored.vm_cap)
      )::integer AS cap_hits,
      max(bucketed.last_at) FILTER (
        WHERE bucketed.n >= anchored.attempt_cap
          OR (anchored.vm_cap IS NOT NULL AND bucketed.vms >= anchored.vm_cap)
      ) AS last_hit_at
    FROM bucketed
    JOIN anchored
      ON anchored.phone_key = bucketed.phone_key
     AND anchored.prospect_id IS NOT DISTINCT FROM bucketed.prospect_id
    GROUP BY bucketed.phone_key, bucketed.prospect_id
  ),
  current_cycle AS (
    SELECT
      anchored.phone_key,
      anchored.prospect_id,
      coalesce(bucketed.n, 0) AS attempts_in_cycle
    FROM anchored
    LEFT JOIN bucketed
      ON bucketed.phone_key = anchored.phone_key
     AND bucketed.prospect_id IS NOT DISTINCT FROM anchored.prospect_id
     AND bucketed.bucket = floor(
       extract(epoch FROM (anchored.now_at - anchored.anchor)) / (anchored.cycle_days * 86400.0)
     )::integer
  ),
  activity AS (
    SELECT
      anchored.phone_key,
      anchored.prospect_id,
      max(event.call_at) FILTER (WHERE event.call_at >= anchored.anchor) AS last_at,
      count(*) FILTER (
        WHERE event.call_at >= anchored.anchor
          AND (event.call_at AT TIME ZONE 'America/Chicago')::date = anchored.today_ct
      )::integer AS today_n,
      count(*) FILTER (
        WHERE event.call_at >= anchored.anchor
          AND event.call_at >= anchored.now_at - interval '7 days'
      )::integer AS week_n,
      min(event.call_at) FILTER (
        WHERE event.call_at >= anchored.now_at - interval '7 days'
      ) AS week_oldest,
      max(event.call_at) FILTER (
        WHERE event.outcome_key = 'not_interested' OR event.raw_key = 'not_interested'
      ) AS last_ni,
      count(*) FILTER (
        WHERE (event.outcome_key = 'not_interested' OR event.raw_key = 'not_interested')
          AND event.call_at >= anchored.now_at - make_interval(months => anchored.lookback_months)
      )::integer AS ni_n
    FROM anchored
    LEFT JOIN event ON event.phone_key = anchored.phone_key
    GROUP BY anchored.phone_key, anchored.prospect_id
  ),
  person_today AS (
    SELECT phone.prospect_id, count(*)::integer AS n
    FROM public.prospect_phones AS phone
    JOIN event ON event.phone_key = phone.dialer_phone_key
    CROSS JOIN clock
    WHERE phone.prospect_id IN (SELECT anchored.prospect_id FROM anchored WHERE anchored.prospect_id IS NOT NULL)
      AND (event.call_at AT TIME ZONE 'America/Chicago')::date = (clock.now_at AT TIME ZONE 'America/Chicago')::date
    GROUP BY phone.prospect_id
  ),
  decided AS (
    SELECT
      anchored.phone_key,
      anchored.prospect_id,
      coalesce(current_cycle.attempts_in_cycle, 0) AS attempts_in_cycle,
      CASE
        WHEN coalesce(activity.ni_n, 0) >= anchored.retire_on THEN greatest(coalesce(hit.cap_hits, 0), anchored.retire_on)
        ELSE coalesce(hit.cap_hits, 0)
      END AS cap_hits,
      public.dialer_pool_later_v1(
        CASE
          WHEN coalesce(hit.cap_hits, 0) > 0 AND hit.last_hit_at IS NOT NULL THEN
            hit.last_hit_at + make_interval(days => coalesce(
              (anchored.tier_cfg->'cooldown_days'->(
                least(
                  greatest(hit.cap_hits, 1),
                  greatest(jsonb_array_length(anchored.tier_cfg->'cooldown_days'), 1)
                ) - 1
              ))::text::integer,
              0
            ))
        END,
        CASE
          WHEN coalesce(activity.ni_n, 0) BETWEEN 1 AND anchored.retire_on - 1 AND activity.last_ni IS NOT NULL THEN
            activity.last_ni + make_interval(days => coalesce(
              (anchored.cfg->'not_interested_days'->(activity.ni_n - 1))::text::integer,
              0
            ))
        END
      ) AS window_next,
      CASE
        WHEN anchored.min_gap_hours > 0
          AND activity.last_at IS NOT NULL
          AND activity.last_at + make_interval(hours => anchored.min_gap_hours) > anchored.now_at
          THEN activity.last_at + make_interval(hours => anchored.min_gap_hours)
      END AS gap_next,
      CASE
        WHEN (
          anchored.day_cap_number IS NOT NULL AND coalesce(activity.today_n, 0) >= anchored.day_cap_number
        ) OR (
          anchored.day_cap_person IS NOT NULL AND coalesce(person_today.n, 0) >= anchored.day_cap_person
        ) THEN ((anchored.today_ct + 1)::timestamp AT TIME ZONE 'America/Chicago')
      END AS day_next,
      CASE
        WHEN coalesce(
          anchored.cap_7d_number,
          anchored.cap_7d_person
        ) IS NOT NULL
          AND coalesce(activity.week_n, 0) >= coalesce(anchored.cap_7d_number, anchored.cap_7d_person)
          AND activity.week_oldest IS NOT NULL
          AND activity.week_oldest + interval '7 days' > anchored.now_at
          THEN activity.week_oldest + interval '7 days'
      END AS week_next,
      anchored.now_at,
      anchored.retire_on,
      coalesce(activity.ni_n, 0) AS ni_n
    FROM anchored
    LEFT JOIN hit
      ON hit.phone_key = anchored.phone_key
     AND hit.prospect_id IS NOT DISTINCT FROM anchored.prospect_id
    LEFT JOIN current_cycle
      ON current_cycle.phone_key = anchored.phone_key
     AND current_cycle.prospect_id IS NOT DISTINCT FROM anchored.prospect_id
    LEFT JOIN activity
      ON activity.phone_key = anchored.phone_key
     AND activity.prospect_id IS NOT DISTINCT FROM anchored.prospect_id
    LEFT JOIN person_today ON person_today.prospect_id = anchored.prospect_id
  )
  SELECT DISTINCT ON (decided.phone_key, decided.prospect_id)
    decided.phone_key,
    decided.prospect_id,
    decided.attempts_in_cycle,
    decided.cap_hits,
    public.dialer_pool_later_v1(
      decided.window_next,
      public.dialer_pool_later_v1(decided.gap_next, public.dialer_pool_later_v1(decided.day_next, decided.week_next))
    ) AS next_eligible_at,
    CASE
      WHEN decided.ni_n >= decided.retire_on OR decided.cap_hits >= decided.retire_on THEN 'retired'
      WHEN public.dialer_pool_later_v1(decided.gap_next, public.dialer_pool_later_v1(decided.day_next, decided.week_next)) > decided.now_at
        OR decided.window_next > decided.now_at THEN 'blocked'
      WHEN decided.window_next IS NOT NULL THEN 'pending'
      ELSE 'clear'
    END AS gate
  FROM decided
  ORDER BY decided.phone_key, decided.prospect_id, decided.cap_hits DESC;
END;
$function$;

COMMENT ON FUNCTION public.dialer_pool_attempt_states_v1(jsonb) IS
  'Attempt, cap-hit, and next_eligible state from crm_mojo_call_events. Thresholds come from dialer_pool_caps_v1. gate pending means the cooldown has elapsed and the phone still needs a scrub.';

CREATE OR REPLACE FUNCTION public.dialer_pool_audit_findings_v1(p_from date, p_to date)
RETURNS TABLE (
  finding_code text,
  source_list_id uuid,
  phone_key text,
  event_at timestamptz,
  detail text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH cfg AS (
    SELECT value AS cfg
    FROM public.system_config
    WHERE key = 'dialer_pool_caps_v1'
  ),
  event AS (
    SELECT
      call.dialer_phone_key AS phone_key,
      call.call_at,
      public.dialer_label_key_v1(call.outcome) AS outcome_key,
      public.dialer_label_key_v1(call.disposition_raw) AS raw_key,
      coalesce(cfg.cfg->'timezones'->>left(call.dialer_phone_key, 3), 'unknown') AS zone_label
    FROM public.crm_mojo_call_events AS call
    CROSS JOIN cfg
    WHERE call.call_at IS NOT NULL
      AND length(coalesce(call.dialer_phone_key, '')) = 10
      AND call.call_at >= (p_from::timestamp AT TIME ZONE 'America/Chicago') - interval '8 days'
      AND call.call_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Chicago')
  ),
  located AS (
    SELECT
      event.*,
      CASE
        WHEN event.zone_label = 'unknown' THEN 'America/Chicago'
        ELSE event.zone_label
      END AS zone_name,
      event.call_at AT TIME ZONE (
        CASE WHEN event.zone_label = 'unknown' THEN 'America/Chicago' ELSE event.zone_label END
      ) AS local_ts
    FROM event
  ),
  owned AS (
    SELECT DISTINCT ON (phone.dialer_phone_key)
      phone.dialer_phone_key AS phone_key,
      phone.prospect_id
    FROM public.prospect_phones AS phone
    WHERE phone.dialer_phone_key IN (SELECT located.phone_key FROM located)
    ORDER BY phone.dialer_phone_key, phone.prospect_id
  ),
  facts AS (
    SELECT * FROM public.dialer_pool_prospect_facts_v1(ARRAY(SELECT owned.prospect_id FROM owned))
  ),
  tagged AS (
    SELECT
      located.phone_key,
      located.call_at,
      located.outcome_key,
      located.raw_key,
      located.zone_label,
      located.local_ts,
      located.local_ts::date AS local_day,
      extract(dow FROM located.local_ts)::integer AS dow,
      (extract(hour FROM located.local_ts) * 60 + extract(minute FROM located.local_ts))::integer AS minute_of_day,
      coalesce(facts.tier, 'single') AS tier,
      lag(located.call_at) OVER (PARTITION BY located.phone_key ORDER BY located.call_at) AS prev_at,
      (
        SELECT max(earlier.call_at)
        FROM located AS earlier
        WHERE earlier.phone_key = located.phone_key
          AND earlier.call_at < located.call_at
          AND (
            earlier.outcome_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
            OR earlier.raw_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
          )
      ) AS prev_vm
    FROM located
    LEFT JOIN owned ON owned.phone_key = located.phone_key
    LEFT JOIN facts ON facts.prospect_id = owned.prospect_id
  ),
  ruled AS (
    SELECT
      tagged.*,
      cfg.cfg,
      coalesce(
        (cfg.cfg->'tiers'->tagged.tier->>'attempt_cap_day_number')::integer,
        (cfg.cfg->'tiers'->tagged.tier->>'attempt_cap_day_person')::integer
      ) AS day_cap,
      coalesce(
        (cfg.cfg->'tiers'->tagged.tier->>'attempt_cap_7d_number')::integer,
        (cfg.cfg->'tiers'->tagged.tier->>'attempt_cap_7d_person')::integer
      ) AS week_cap,
      (cfg.cfg->'tiers'->tagged.tier->>'attempt_cap_cycle')::integer AS cycle_cap,
      coalesce((cfg.cfg->'tiers'->tagged.tier->>'min_gap_hours')::integer, 0) AS min_gap_hours,
      coalesce((cfg.cfg->>'vm_gap_hours')::integer, 0) AS vm_gap_hours,
      count(*) OVER (
        PARTITION BY tagged.phone_key, tagged.local_day
        ORDER BY tagged.call_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::integer AS day_n
    FROM tagged
    CROSS JOIN cfg
  ),
  emitted AS (
    SELECT ruled.phone_key, ruled.call_at, 'outside_tz_window'::text AS finding_code, 'outside the recipient window'::text AS detail
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND (
        (
          ruled.zone_label = 'unknown'
          AND (
            ruled.minute_of_day < (ruled.cfg->'quiet_hours'->>'unknown_start_ct')::integer * 60
            OR ruled.minute_of_day >= (ruled.cfg->'quiet_hours'->>'unknown_end_ct')::integer * 60
          )
        )
        OR (
          ruled.zone_label <> 'unknown'
          AND ruled.dow = 0
          AND (
            ruled.minute_of_day < (ruled.cfg->'quiet_hours'->>'sunday_start')::integer * 60
            OR ruled.minute_of_day >= (ruled.cfg->'quiet_hours'->>'sunday_end')::integer * 60
          )
        )
        OR (
          ruled.zone_label <> 'unknown'
          AND ruled.dow <> 0
          AND (
            ruled.minute_of_day < (ruled.cfg->'quiet_hours'->>'weekday_start')::integer * 60
            OR ruled.minute_of_day >= (ruled.cfg->'quiet_hours'->>'weekday_end')::integer * 60
          )
        )
      )
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'holiday', 'named no-call holiday'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND public.dialer_pool_holiday_v1(ruled.local_day)
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'min_gap', 'closer than the tier gap'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND ruled.min_gap_hours > 0
      AND ruled.prev_at IS NOT NULL
      AND ruled.call_at < ruled.prev_at + make_interval(hours => ruled.min_gap_hours)
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'vm_gap', 'voicemails closer than the configured gap'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND ruled.vm_gap_hours > 0
      AND ruled.prev_vm IS NOT NULL
      AND (
        ruled.outcome_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
        OR ruled.raw_key IN ('voicemail_left', 'left_voicemail', 'left_vm')
      )
      AND ruled.call_at < ruled.prev_vm + make_interval(hours => ruled.vm_gap_hours)
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'daily_cap', 'over the tier daily cap'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND ruled.day_cap IS NOT NULL
      AND ruled.day_n > ruled.day_cap
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'cap_7d', 'over the tier 7 day cap'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND ruled.week_cap IS NOT NULL
      AND (
        SELECT count(*)
        FROM ruled AS earlier
        WHERE earlier.phone_key = ruled.phone_key
          AND earlier.call_at <= ruled.call_at
          AND earlier.call_at > ruled.call_at - interval '7 days'
      ) > ruled.week_cap
    UNION ALL
    SELECT ruled.phone_key, ruled.call_at, 'cycle_cap', 'over the tier cycle cap'
    FROM ruled
    WHERE ruled.local_day BETWEEN p_from AND p_to
      AND ruled.cycle_cap IS NOT NULL
      AND (
        SELECT count(*)
        FROM ruled AS earlier
        WHERE earlier.phone_key = ruled.phone_key
          AND earlier.call_at <= ruled.call_at
          AND earlier.call_at >= ruled.call_at - make_interval(days => coalesce((ruled.cfg->'tiers'->ruled.tier->>'cycle_days')::integer, 1))
      ) > ruled.cycle_cap
  ),
  lists AS (
    SELECT DISTINCT phone.dialer_phone_key AS phone_key, row.source_list_id
    FROM public.prospect_phones AS phone
    JOIN public.source_list_rows AS row ON row.prospect_id = phone.prospect_id
    WHERE phone.dialer_phone_key IN (SELECT emitted.phone_key FROM emitted)
  )
  SELECT DISTINCT
    emitted.finding_code,
    lists.source_list_id,
    emitted.phone_key,
    emitted.call_at,
    emitted.detail
  FROM emitted
  LEFT JOIN lists ON lists.phone_key = emitted.phone_key;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_audit_blocked_lists_v1()
RETURNS TABLE (source_list_id uuid, findings integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH bounds AS (
    SELECT
      (public.dialer_pool_now_v1() AT TIME ZONE 'America/Chicago')::date - 1 AS day_end,
      coalesce((value->>'audit_findings_to_block')::integer, 2) AS threshold
    FROM public.system_config
    WHERE key = 'dialer_pool_caps_v1'
  )
  SELECT found.source_list_id, count(*)::integer AS findings
  FROM bounds
  JOIN public.dialer_pool_audit_findings_v1(
    public.dialer_pool_business_window_start_v1(bounds.day_end),
    bounds.day_end
  ) AS found ON found.source_list_id IS NOT NULL
  GROUP BY found.source_list_id, bounds.threshold
  HAVING count(*) >= bounds.threshold;
$function$;

COMMENT ON FUNCTION public.dialer_audit_blocked_lists_v1() IS
  'Lists with at least audit_findings_to_block findings across the last audit_business_days. The next export omits them.';

CREATE OR REPLACE VIEW public.dialer_pool_morning_audit_v1
WITH (security_invoker = true) AS
SELECT
  found.finding_code,
  found.source_list_id,
  public.dialer_phone_mask_v1(found.phone_key) AS phone_masked,
  found.event_at,
  found.detail
FROM public.dialer_pool_audit_findings_v1(
  (public.dialer_pool_now_v1() AT TIME ZONE 'America/Chicago')::date - 1,
  (public.dialer_pool_now_v1() AT TIME ZONE 'America/Chicago')::date - 1
) AS found;

COMMENT ON VIEW public.dialer_pool_morning_audit_v1 IS
  'One row per finding from yesterday (America/Chicago): caps, gaps, and calling hours. Phones are masked to the last 4.';

CREATE OR REPLACE FUNCTION public.dialer_expired_hold_active_v1(p_expired_on date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_expired_on IS NULL THEN true
    WHEN p_expired_on > (timezone('America/Chicago', clock_timestamp()))::date THEN false
    ELSE (timezone('America/Chicago', clock_timestamp()))::date - p_expired_on
      <= coalesce((
        SELECT config.value::integer
        FROM public.mls_market_config AS config
        WHERE config.key = 'MLS_EXPIRED_WINDOW_DAYS'
          AND config.value ~ '^[0-9]+$'
      ), 90)
  END;
$function$;

COMMENT ON FUNCTION public.dialer_expired_hold_active_v1(date) IS
  'True while an expired date is still inside MLS_EXPIRED_WINDOW_DAYS, default 90. A null date stays held. A future date is not an expired hold.';

REVOKE ALL ON FUNCTION public.dialer_expired_hold_active_v1(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_expired_hold_active_v1(date) TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_pool_rows_v1()
RETURNS TABLE (
  phone_key text,
  phone_e164 text,
  prospect_id uuid,
  household_key text,
  sources text[],
  owner_status text,
  last_outcome text,
  attempts_in_cycle integer,
  cap_hits integer,
  next_eligible_at timestamptz,
  tier text,
  signal_count integer,
  intake_date date,
  block_reason text,
  pool_status text,
  tz_window text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
SET jit = off
SET enable_nestloop = off
AS $pool$
BEGIN
  RETURN QUERY
  WITH cfg AS (
  SELECT value AS cfg
  FROM public.system_config
  WHERE key = 'dialer_pool_caps_v1'
),
phones AS (
  SELECT DISTINCT ON (sourced.phone_key, sourced.prospect_id)
    sourced.phone_key,
    sourced.phone_e164,
    sourced.prospect_id,
    sourced.relationship,
    sourced.last_disposition,
    sourced.origin,
    sourced.county
  FROM (
    SELECT
      phone.dialer_phone_key AS phone_key,
      public.normalize_conversation_phone(phone.phone) AS phone_e164,
      phone.prospect_id,
      phone.relationship,
      phone.last_disposition,
      'prospect_phone'::text AS origin,
      prospect.county
    FROM public.prospect_phones AS phone
    LEFT JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
    WHERE length(coalesce(phone.dialer_phone_key, '')) = 10
    UNION ALL
    SELECT
      public.prospecting_phone_key_v1(phone_value) AS phone_key,
      public.normalize_conversation_phone(phone_value) AS phone_e164,
      row.prospect_id,
      NULL::text,
      NULL::text,
      'source_row'::text,
      row.county
    FROM public.source_list_rows AS row
    CROSS JOIN LATERAL unnest(row.phones) AS phone_value
    WHERE length(public.prospecting_phone_key_v1(phone_value)) = 10
      AND NOT EXISTS (
        SELECT 1
        FROM public.prospect_phones AS phone
        WHERE phone.prospect_id IS NOT DISTINCT FROM row.prospect_id
          AND phone.dialer_phone_key = public.prospecting_phone_key_v1(phone_value)
      )
    UNION ALL
    SELECT
      call.dialer_phone_key,
      public.normalize_conversation_phone(call.normalized_phone),
      NULL::uuid,
      NULL::text,
      NULL::text,
      'mojo_event'::text,
      NULL::text
    FROM public.crm_mojo_call_events AS call
    WHERE length(coalesce(call.dialer_phone_key, '')) = 10
      AND NOT EXISTS (
        SELECT 1
        FROM public.prospect_phones AS phone
        WHERE phone.dialer_phone_key = call.dialer_phone_key
      )
  ) AS sourced
  WHERE sourced.phone_key IS NOT NULL
  ORDER BY sourced.phone_key, sourced.prospect_id, (sourced.origin = 'prospect_phone') DESC
),
numbered AS MATERIALIZED (
  SELECT row_number() OVER (ORDER BY phones.phone_key, phones.prospect_id) AS ordinal, phones.*
  FROM phones
),
reasons AS (
  SELECT found.ordinal, found.block_reason
  FROM public.source_list_phone_block_reasons_v1(
    ARRAY(SELECT numbered.phone_e164 FROM numbered ORDER BY numbered.ordinal),
    ARRAY(SELECT numbered.prospect_id FROM numbered ORDER BY numbered.ordinal),
    ARRAY(SELECT numbered.county FROM numbered ORDER BY numbered.ordinal),
    ARRAY(SELECT numbered.county FROM numbered ORDER BY numbered.ordinal)
  ) AS found
),
linked_ids AS MATERIALIZED (
  SELECT numbered.ordinal, row.id AS row_id
  FROM numbered
  JOIN public.source_list_rows AS row ON row.prospect_id = numbered.prospect_id
  UNION
  SELECT numbered.ordinal, row_phone.row_id
  FROM numbered
  JOIN (
    SELECT row.id AS row_id, public.prospecting_phone_key_v1(phone_value) AS phone_key
    FROM public.source_list_rows AS row
    CROSS JOIN LATERAL unnest(row.phones) AS phone_value
  ) AS row_phone ON row_phone.phone_key = numbered.phone_key
),
expired_tags AS MATERIALIZED (
  SELECT
    tag.source_list_row_id,
    bool_or(tag.list_day <= (timezone('America/Chicago', clock_timestamp()))::date) AS tagged,
    bool_or(public.dialer_expired_hold_active_v1(tag.list_day)) AS active
  FROM public.source_list_row_mls_tags AS tag
  WHERE tag.mls_tag = 'expired_listing'
  GROUP BY tag.source_list_row_id
),
market_on AS MATERIALIZED (
  SELECT public.mls_market_check_enabled() AS enabled,
    (timezone('America/Chicago', clock_timestamp()))::date AS today
),
linked_rows AS MATERIALIZED (
  SELECT
    numbered.ordinal,
    row.list_type,
    row.list_day,
    row.parcel_id,
    row.county,
    coalesce(row.prospect_id, numbered.prospect_id) AS prospect_id,
    CASE
      WHEN row.list_type = 'mls_expired'
        OR market_on.enabled
        OR coalesce(expired_tags.tagged, false)
      THEN public.source_list_market_block_reason_v1(
        row.id,
        row.parcel_id,
        row.address,
        coalesce(row.prospect_id, numbered.prospect_id),
        row.list_type,
        CASE WHEN numbered.origin = 'prospect_phone' THEN 'prospect_phone' ELSE 'source_row' END,
        numbered.phone_e164
      )
      ELSE NULL
    END AS market_reason,
    (
      row.list_type = 'mls_expired'
      OR coalesce(expired_tags.tagged, false)
    ) AS expired_row,
    (
      (row.list_type = 'mls_expired' AND public.dialer_expired_hold_active_v1(row.list_day))
      OR coalesce(expired_tags.active, false)
    ) AS expired_hold,
    row.list_day > market_on.today AS future_hold
  FROM linked_ids
  JOIN numbered ON numbered.ordinal = linked_ids.ordinal
  JOIN public.source_list_rows AS row ON row.id = linked_ids.row_id
  LEFT JOIN expired_tags ON expired_tags.source_list_row_id = row.id
  CROSS JOIN market_on
),
holds AS MATERIALIZED (
  SELECT
    linked_rows.ordinal,
    bool_or(linked_rows.expired_hold) AS expired_hold,
    (array_agg(linked_rows.market_reason) FILTER (
      WHERE linked_rows.expired_hold AND linked_rows.market_reason IS NOT NULL
    ))[1] AS expired_reason,
    bool_or(NOT linked_rows.expired_row AND linked_rows.market_reason IS NOT NULL) AS market_hold,
    (array_agg(linked_rows.market_reason) FILTER (
      WHERE NOT linked_rows.expired_row AND linked_rows.market_reason IS NOT NULL
    ))[1] AS market_reason,
    bool_or(linked_rows.future_hold) AS future_hold,
    bool_or(
      linked_rows.list_type = 'tax_delinquent'
      AND NOT public.tax_status_export_allowed_v1(
        linked_rows.parcel_id, linked_rows.county, linked_rows.prospect_id
      )
    ) AS tax_hold
  FROM linked_rows
  GROUP BY linked_rows.ordinal
),
facts AS (
  SELECT *
  FROM public.dialer_pool_prospect_facts_v1(
    ARRAY(SELECT DISTINCT numbered.prospect_id FROM numbered WHERE numbered.prospect_id IS NOT NULL)
  )
),
states AS (
  SELECT *
  FROM public.dialer_pool_attempt_states_v1((
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'phone_key', numbered.phone_key,
      'prospect_id', numbered.prospect_id,
      'tier', coalesce(facts.tier, 'single'),
      'intake_date', facts.intake_date
    )), '[]'::jsonb)
    FROM numbered
    LEFT JOIN facts ON facts.prospect_id = numbered.prospect_id
  ))
),
blocked AS (
  SELECT blocked_list.source_list_id
  FROM public.dialer_audit_blocked_lists_v1() AS blocked_list
),
audit_hit AS (
  SELECT DISTINCT phone.prospect_id, phone.dialer_phone_key AS phone_key
  FROM public.prospect_phones AS phone
  JOIN public.source_list_rows AS row ON row.prospect_id = phone.prospect_id
  JOIN blocked ON blocked.source_list_id = row.source_list_id
),
last_outcome AS (
  SELECT DISTINCT ON (call.dialer_phone_key)
    call.dialer_phone_key AS phone_key,
    coalesce(call.outcome, call.disposition_raw) AS outcome
  FROM public.crm_mojo_call_events AS call
  WHERE call.call_at IS NOT NULL
    AND length(coalesce(call.dialer_phone_key, '')) = 10
  ORDER BY call.dialer_phone_key, call.call_at DESC
)
SELECT
  numbered.phone_key,
  numbered.phone_e164,
  numbered.prospect_id,
  prospect.dialer_household_key AS household_key,
  coalesce(facts.sources, ARRAY[numbered.origin]) AS sources,
  public.dialer_relationship_bucket_v1(numbered.relationship, prospect.owner_1_type) AS owner_status,
  coalesce(last_outcome.outcome, numbered.last_disposition) AS last_outcome,
  coalesce(states.attempts_in_cycle, 0) AS attempts_in_cycle,
  coalesce(states.cap_hits, 0) AS cap_hits,
  states.next_eligible_at,
  coalesce(facts.tier, 'single') AS tier,
  coalesce(facts.signal_count, 0) AS signal_count,
  facts.intake_date,
  CASE
    WHEN reasons.block_reason IS NOT NULL THEN reasons.block_reason
    WHEN coalesce(holds.expired_hold, false) THEN coalesce(holds.expired_reason, 'market_expired')
    WHEN coalesce(holds.market_hold, false) THEN holds.market_reason
    WHEN coalesce(holds.future_hold, false) THEN 'future_day'
    WHEN coalesce(holds.tax_hold, false) THEN 'tax_unverified'
    WHEN audit_hit.prospect_id IS NOT NULL THEN 'audit_list_blocked'
    WHEN public.phone_line_check_block_enabled_v1()
      THEN public.phone_line_export_block_reason_v1(numbered.phone_e164)
    ELSE NULL
  END AS block_reason,
  CASE
    WHEN cfg.cfg IS NULL THEN 'blocked'
    WHEN reasons.block_reason IN (
      'sms_opt_out', 'voice_hold', 'prospect_dnc', 'contact_opt_out', 'contact_blocked',
      'lead_dnc', 'mojo_dnc', 'person_fanout', 'household_fanout', 'property_owner_dnc_fanout',
      'mojo_encode_pending', 'hold_last4', 'needs_counsel_review'
    ) THEN 'suppressed'
    WHEN reasons.block_reason IN ('wrong_number', 'disconnected', 'dead_number') THEN 'retired'
    WHEN coalesce(holds.expired_hold, false) OR coalesce(holds.market_hold, false) OR coalesce(holds.future_hold, false) OR coalesce(holds.tax_hold, false) THEN 'held'
    WHEN reasons.block_reason IS NOT NULL THEN 'blocked'
    WHEN audit_hit.prospect_id IS NOT NULL THEN 'blocked'
    WHEN public.phone_line_check_block_enabled_v1()
      AND public.phone_line_export_block_reason_v1(numbered.phone_e164) IS NOT NULL THEN 'blocked'
    WHEN states.gate = 'retired' THEN 'retired'
    WHEN states.gate = 'blocked' THEN 'blocked'
    WHEN states.gate = 'pending' AND NOT EXISTS (
      SELECT 1
      FROM public.source_list_export_batch_phones AS batch_phone
      JOIN public.source_list_export_batches AS batch ON batch.id = batch_phone.export_batch_id
      WHERE states.next_eligible_at IS NOT NULL
        AND public.prospecting_phone_key_v1(batch_phone.phone_e164) = numbered.phone_key
        AND batch.created_at >= states.next_eligible_at
        AND (batch.created_at AT TIME ZONE 'America/Chicago')::time < (cfg.cfg->>'list_lock_ct')::time
    ) THEN 'eligible_pending_scrub'
    ELSE 'eligible'
  END AS pool_status,
  coalesce(cfg.cfg->'timezones'->>left(numbered.phone_key, 3), 'unknown') AS tz_window
FROM numbered
LEFT JOIN cfg ON true
LEFT JOIN public.prospects AS prospect ON prospect.id = numbered.prospect_id
LEFT JOIN reasons ON reasons.ordinal = numbered.ordinal
LEFT JOIN holds ON holds.ordinal = numbered.ordinal
LEFT JOIN facts ON facts.prospect_id = numbered.prospect_id
LEFT JOIN states
  ON states.phone_key = numbered.phone_key
 AND states.prospect_id IS NOT DISTINCT FROM numbered.prospect_id
LEFT JOIN audit_hit
  ON audit_hit.prospect_id IS NOT DISTINCT FROM numbered.prospect_id
 AND audit_hit.phone_key = numbered.phone_key
LEFT JOIN last_outcome ON last_outcome.phone_key = numbered.phone_key;
END;
$pool$;

COMMENT ON FUNCTION public.dialer_pool_rows_v1() IS
  'Calling pool rows. Nested loops are off because the phone-key join is a hash join; a nested loop made this minutes on a 31k list.';

REVOKE ALL ON FUNCTION public.dialer_pool_rows_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_pool_rows_v1() TO service_role;

CREATE OR REPLACE VIEW public.dialer_pool_v1
WITH (security_invoker = true) AS
SELECT * FROM public.dialer_pool_rows_v1();

COMMENT ON VIEW public.dialer_pool_v1 IS
  'One row per phone last-10 and prospect. Source-row holds come from the market review, including an expired row or tag, a future list day, and an unverified tax row. Those rows stay visible with pool_status held and return when the hold lapses. A line-check reason applies only when LINE_CHECK_BLOCK_ENABLED is on. pool_status eligible_pending_scrub is not an auto-load.';

REVOKE ALL ON TABLE public.dialer_pool_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dialer_pool_morning_audit_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dialer_pool_v1, public.dialer_pool_morning_audit_v1 TO service_role;

CREATE OR REPLACE VIEW public.dialer_master_pool_v1
WITH (security_invoker = true) AS
SELECT pool.*
FROM public.dialer_pool_v1 AS pool
WHERE pool.pool_status IN ('eligible', 'eligible_pending_scrub');

COMMENT ON VIEW public.dialer_master_pool_v1 IS
  'Every eligible calling-pool row, across the saved lane filters. Read only. Nothing here loads a dialer queue.';

CREATE OR REPLACE VIEW public.dialer_saved_filters_v1
WITH (security_invoker = true) AS
SELECT
  filter.priority,
  filter.name,
  filter.lane_key,
  filter.single_line,
  coalesce((cfg.value->'number_daily_cap'->>'first_3_days')::integer, 30) AS daily_cap_first_3_days,
  coalesce((cfg.value->'number_daily_cap'->>'after')::integer, 75) AS daily_cap
FROM (
  VALUES
    (1, 'Deceased', 'deceased', true),
    (2, 'Tax 3+', 'tax_delinquent', false),
    (3, 'Probate', 'probate_estate', false),
    (4, 'Inherited', 'probate_no_property', false),
    (5, 'Code Violation', 'code_violation', false),
    (6, 'Expired (single-line, disclosure)', 'mls_expired', true)
) AS filter(priority, name, lane_key, single_line)
LEFT JOIN public.system_config AS cfg ON cfg.key = 'dialer_pool_caps_v1';

COMMENT ON VIEW public.dialer_saved_filters_v1 IS
  'Lane sets Casey can pick, in priority order. Deceased is the living contacts on a deceased owner property. daily_cap is the per-number cap after the first 3 days.';

CREATE OR REPLACE VIEW public.dialer_deceased_pool_v1
WITH (security_invoker = true) AS
SELECT pool.*
FROM public.dialer_master_pool_v1 AS pool
JOIN public.prospects AS prospect ON prospect.id = pool.prospect_id
WHERE prospect.is_deceased IS TRUE
  AND EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    WHERE phone.prospect_id = pool.prospect_id
      AND public.prospecting_phone_key_v1(phone.phone) = pool.phone_key
      AND public.dialer_label_key_v1(phone.relationship) IS NOT NULL
      AND public.dialer_label_key_v1(phone.relationship) NOT IN ('decedent', 'deceased', 'owner', 'subject')
  );

COMMENT ON VIEW public.dialer_deceased_pool_v1 IS
  'Eligible pool rows for the Deceased set: living heir, spouse, co-owner, or PR phones on an is_deceased prospect. The decedent and any owner or subject phone stay out. Blocks, holds, and caps are already applied by the master pool.';

REVOKE ALL ON TABLE public.dialer_master_pool_v1, public.dialer_saved_filters_v1, public.dialer_deceased_pool_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dialer_master_pool_v1, public.dialer_saved_filters_v1, public.dialer_deceased_pool_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.dialer_multi_line_suspended_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT true;
$function$;

COMMENT ON FUNCTION public.dialer_multi_line_suspended_v1() IS
  'Multi-line dialing stays suspended. This does not read or write dialer_multi_line_suspended, so the export path cannot turn multi-line back on.';

CREATE OR REPLACE FUNCTION public.dialer_pool_call_window_open_v1(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH cfg AS (
    SELECT value AS cfg
    FROM public.system_config
    WHERE key = 'dialer_pool_caps_v1'
  ),
  parsed AS (
    SELECT
      cfg.cfg,
      public.prospecting_phone_key_v1(p_phone) AS phone_key,
      coalesce(cfg.cfg->'timezones'->>left(public.prospecting_phone_key_v1(p_phone), 3), 'unknown') AS zone_label,
      public.dialer_pool_now_v1() AS now_at
    FROM cfg
  ),
  local_time AS (
    SELECT
      parsed.*,
      parsed.now_at AT TIME ZONE (
        CASE WHEN parsed.zone_label = 'unknown' THEN 'America/Chicago' ELSE parsed.zone_label END
      ) AS local_ts
    FROM parsed
    WHERE length(coalesce(parsed.phone_key, '')) >= 3
  )
  SELECT coalesce(
    (
      SELECT
        NOT public.dialer_pool_holiday_v1(local_time.local_ts::date)
        AND minute_of_day >= start_minute
        AND minute_of_day < end_minute
      FROM local_time
      CROSS JOIN LATERAL (
        SELECT
          (extract(hour FROM local_time.local_ts) * 60 + extract(minute FROM local_time.local_ts))::integer AS minute_of_day,
          CASE
            WHEN local_time.zone_label = 'unknown' THEN (local_time.cfg->'quiet_hours'->>'unknown_start_ct')::integer * 60
            WHEN extract(dow FROM local_time.local_ts)::integer = 0 THEN (local_time.cfg->'quiet_hours'->>'sunday_start')::integer * 60
            ELSE (local_time.cfg->'quiet_hours'->>'weekday_start')::integer * 60
          END AS start_minute,
          CASE
            WHEN local_time.zone_label = 'unknown' THEN (local_time.cfg->'quiet_hours'->>'unknown_end_ct')::integer * 60
            WHEN extract(dow FROM local_time.local_ts)::integer = 0 THEN (local_time.cfg->'quiet_hours'->>'sunday_end')::integer * 60
            ELSE (local_time.cfg->'quiet_hours'->>'weekday_end')::integer * 60
          END AS end_minute
      ) AS bounds
    ),
    false
  );
$function$;

COMMENT ON FUNCTION public.dialer_pool_call_window_open_v1(text) IS
  'True only inside the counsel calling window: 9am-8pm recipient local Mon-Sat, 1pm-6pm Sunday, 11am-8pm CT for an unknown area code, and never on the five named holidays.';

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
  v_lock_rows jsonb;
  v_count integer;
  v_batch_id uuid;
  v_excluded_counts jsonb;
  v_excluded_phones jsonb;
  v_label text := NULL;
  v_gaps text;
  v_config jsonb;
  v_now timestamptz;
  v_local timestamp;
  v_lock_at timestamptz;
  v_day_start timestamptz;
  v_after boolean;
  v_lock_id uuid;
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
  IF v_kind IS NOT NULL AND v_kind NOT IN ('dangerous_building', 'board_up', 'open_to_entry', 'structural', 'nuisance') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_list_type = 'mls_expired' AND coalesce(p_line_mode, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expired_single_line_only';
  END IF;
  IF coalesce(p_line_mode, 1) < 1
    OR (public.dialer_multi_line_suspended_v1() AND coalesce(p_line_mode, 1) > 1) THEN
    RAISE EXCEPTION 'multi_line_suspended';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    to_char((public.dialer_pool_now_v1() AT TIME ZONE 'America/Chicago')::date, 'YYYYMMDD')
      || '|' || coalesce(v_list_type, '')
      || '|' || coalesce(v_county, '')
      || '|' || coalesce(v_state, '')
      || '|' || coalesce(v_kind, '')
      || '|' || coalesce(p_source_list_id::text, ''),
    0
  ));

  SELECT coalesce(string_agg(gap.source || '=' || gap.label, ', ' ORDER BY gap.source, gap.label), '')
  INTO v_gaps
  FROM public.dialer_label_coverage_gaps_v1() AS gap;
  IF v_gaps <> '' THEN
    RAISE EXCEPTION 'dialer_label_unmapped: %', v_gaps;
  END IF;

  IF v_list_type = 'mls_expired' THEN
    WITH reviewed AS MATERIALIZED (
      SELECT *
      FROM public.source_list_market_phone_review AS review
      WHERE (v_county IS NULL OR review.county = v_county)
        AND (v_state IS NULL OR review.state = v_state)
        AND (v_kind IS NULL OR review.violation_kind = v_kind)
        AND (p_source_list_id IS NULL OR review.source_list_id = p_source_list_id)
        AND (review.list_type = 'mls_expired' OR review.basis = 'owner_override_2026-11-14')
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
          AND public.market_calling_window_open_v1()
          AND (
            public.mls_config_flag_v1('KS_EXPIRED_RELEASE_APPROVED')
            OR (
              upper(coalesce(export_row.state, '')) <> 'KS'
              AND lower(coalesce(export_row.county, '')) NOT IN ('wyandotte', 'johnson')
            )
          )
          AND export_row.requires_licensee_disclosure IS TRUE
          AND export_row.prospect_id IS NOT NULL
          AND export_row.phone_origin = 'prospect_phone'
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
              OR review.requires_licensee_disclosure IS DISTINCT FROM true
              OR review.prospect_id IS NULL
              OR review.phone_origin IS DISTINCT FROM 'prospect_phone'
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
              OR review.requires_licensee_disclosure IS DISTINCT FROM true
              OR review.prospect_id IS NULL
              OR review.phone_origin IS DISTINCT FROM 'prospect_phone'
          ) AS samples
          WHERE samples.sample_index <= 20
        ) AS samples
      ), '[]'::jsonb)
    INTO v_rows, v_excluded_counts, v_excluded_phones;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) AS item
      WHERE coalesce((item->>'requires_licensee_disclosure')::boolean, false) IS DISTINCT FROM true
    ) THEN
      RAISE EXCEPTION 'licensee_disclosure_required';
    END IF;

    v_count := jsonb_array_length(v_rows);
    IF v_count > 10000 THEN
      RAISE EXCEPTION 'source_list_export_too_large';
    END IF;
    v_label := 'EXPIRED · licensee disclosure · single-line';

    INSERT INTO public.source_list_export_batches (
      created_at, created_by, list_type, county, state, violation_kind, source_list_id, phone_count, export_label
    ) VALUES (
      public.dialer_pool_now_v1(), v_actor, v_list_type, v_county, v_state, v_kind, p_source_list_id, v_count, v_label
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
      item->>'basis',
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
  END IF;

  SELECT value INTO v_config
  FROM public.system_config
  WHERE key = 'dialer_pool_caps_v1';
  IF v_config IS NULL OR nullif(v_config->>'list_lock_ct', '') IS NULL THEN
    RAISE EXCEPTION 'dialer_pool_caps_missing';
  END IF;

  v_now := public.dialer_pool_now_v1();
  v_local := v_now AT TIME ZONE 'America/Chicago';
  v_day_start := v_local::date::timestamp AT TIME ZONE 'America/Chicago';
  v_lock_at := (v_local::date + (v_config->>'list_lock_ct')::time) AT TIME ZONE 'America/Chicago';
  v_after := v_now >= v_lock_at;

  SELECT batch.id INTO v_lock_id
  FROM public.source_list_export_batches AS batch
  WHERE batch.created_at >= v_day_start
    AND batch.created_at < v_lock_at
    AND batch.list_type IS NOT DISTINCT FROM v_list_type
    AND batch.county IS NOT DISTINCT FROM v_county
    AND batch.state IS NOT DISTINCT FROM v_state
    AND batch.violation_kind IS NOT DISTINCT FROM v_kind
    AND batch.source_list_id IS NOT DISTINCT FROM p_source_list_id
  ORDER BY batch.created_at DESC
  LIMIT 1;

  WITH reviewed AS MATERIALIZED (
    SELECT *
    FROM public.source_list_market_phone_review AS review
    WHERE review.list_type IS DISTINCT FROM 'mls_expired'
      AND review.basis IS DISTINCT FROM 'owner_override_2026-11-14'
      AND (v_list_type IS NULL OR review.list_type = v_list_type)
      AND (v_county IS NULL OR review.county = v_county)
      AND (v_state IS NULL OR review.state = v_state)
      AND (v_kind IS NULL OR review.violation_kind = v_kind)
      AND (p_source_list_id IS NULL OR review.source_list_id = p_source_list_id)
  ),
  expired_keys AS MATERIALIZED (
    SELECT public.prospecting_phone_key_v1(phone_value) AS phone_key, expired_row.prospect_id
    FROM public.source_list_rows AS expired_row
    CROSS JOIN LATERAL unnest(expired_row.phones) AS phone_value
    WHERE (
      expired_row.list_type = 'mls_expired'
      AND public.dialer_expired_hold_active_v1(expired_row.list_day)
    ) OR EXISTS (
      SELECT 1
      FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = expired_row.id
        AND tag.mls_tag = 'expired_listing'
        AND public.dialer_expired_hold_active_v1(tag.list_day)
    )
    UNION
    SELECT public.prospecting_phone_key_v1(phone.phone), phone.prospect_id
    FROM public.prospect_phones AS phone
    JOIN public.source_list_rows AS expired_row ON expired_row.prospect_id = phone.prospect_id
    WHERE (
      expired_row.list_type = 'mls_expired'
      AND public.dialer_expired_hold_active_v1(expired_row.list_day)
    ) OR EXISTS (
      SELECT 1
      FROM public.source_list_row_mls_tags AS tag
      WHERE tag.source_list_row_id = expired_row.id
        AND tag.mls_tag = 'expired_listing'
        AND public.dialer_expired_hold_active_v1(tag.list_day)
    )
  ),
  clear AS MATERIALIZED (
    SELECT *
    FROM reviewed
    WHERE reviewed.block_reason IS NULL
      AND reviewed.phone_e164 IS NOT NULL
      AND reviewed.list_type IN (
        'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation'
      )
      AND (
        reviewed.list_type IS DISTINCT FROM 'tax_delinquent'
        OR public.tax_status_export_allowed_v1(reviewed.parcel_id, reviewed.county, reviewed.prospect_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM expired_keys AS expired_key
        WHERE expired_key.phone_key = public.prospecting_phone_key_v1(reviewed.phone_e164)
          OR (
            reviewed.prospect_id IS NOT NULL
            AND expired_key.prospect_id = reviewed.prospect_id
          )
      )
  ),
  facts AS MATERIALIZED (
    SELECT *
    FROM public.dialer_pool_prospect_facts_v1(
      ARRAY(SELECT DISTINCT clear.prospect_id FROM clear WHERE clear.prospect_id IS NOT NULL)
    )
  ),
  states AS MATERIALIZED (
    SELECT *
    FROM public.dialer_pool_attempt_states_v1((
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'phone_key', public.prospecting_phone_key_v1(clear.phone_e164),
        'prospect_id', clear.prospect_id,
        'tier', coalesce(facts.tier, 'single'),
        'intake_date', facts.intake_date
      )), '[]'::jsonb)
      FROM clear
      LEFT JOIN facts ON facts.prospect_id = clear.prospect_id
    ))
  ),
  blocked AS MATERIALIZED (
    SELECT blocked_list.source_list_id
    FROM public.dialer_audit_blocked_lists_v1() AS blocked_list
  ),
  shaped AS MATERIALIZED (
    SELECT
      clear.*,
      coalesce(facts.tier, 'single') AS tier,
      facts.intake_date,
      coalesce(
        v_config->'timezones'->>left(public.prospecting_phone_key_v1(clear.phone_e164), 3),
        'unknown'
      ) AS tz_window,
      coalesce(states.gate, 'clear') AS gate
    FROM clear
    LEFT JOIN facts ON facts.prospect_id = clear.prospect_id
    LEFT JOIN states
      ON states.phone_key = public.prospecting_phone_key_v1(clear.phone_e164)
     AND states.prospect_id IS NOT DISTINCT FROM clear.prospect_id
  ),
  open AS (
    SELECT shaped.*
    FROM shaped
    WHERE shaped.gate IN ('clear', 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM blocked WHERE blocked.source_list_id = shaped.source_list_id
      )
  ),
  ranked AS (
    SELECT
      open.*,
      dense_rank() OVER (
        PARTITION BY coalesce(open.prospect_id::text, open.source_list_row_id::text)
        ORDER BY open.phone_e164
      ) AS phone_rank,
      coalesce((v_config->'phones_per_contact'->>open.tier)::integer, 0) AS phone_cap
    FROM open
  ),
  capped AS (
    SELECT * FROM ranked WHERE ranked.phone_rank <= ranked.phone_cap
  ),
  final_rows AS (
    SELECT capped.*
    FROM capped
    WHERE v_lock_id IS NULL
      OR NOT v_after
      OR EXISTS (
        SELECT 1
        FROM public.source_list_export_batch_phones AS locked_phone
        WHERE locked_phone.export_batch_id = v_lock_id
          AND locked_phone.source_list_row_id = capped.source_list_row_id
          AND locked_phone.phone_e164 = capped.phone_e164
      )
  ),
  windowed AS (
    SELECT
      final_rows.*,
      NOT public.dialer_pool_holiday_v1(zoned.local_ts::date)
        AND bounds.minute_of_day >= bounds.start_minute
        AND bounds.minute_of_day < bounds.end_minute AS window_open
    FROM final_rows
    CROSS JOIN LATERAL (
      SELECT final_rows_now.now_at AT TIME ZONE (
        CASE WHEN final_rows.tz_window = 'unknown' THEN 'America/Chicago' ELSE final_rows.tz_window END
      ) AS local_ts
      FROM (SELECT v_now AS now_at) AS final_rows_now
    ) AS zoned
    CROSS JOIN LATERAL (
      SELECT
        (extract(hour FROM zoned.local_ts) * 60 + extract(minute FROM zoned.local_ts))::integer AS minute_of_day,
        CASE
          WHEN final_rows.tz_window = 'unknown' THEN (v_config->'quiet_hours'->>'unknown_start_ct')::integer * 60
          WHEN extract(dow FROM zoned.local_ts)::integer = 0 THEN (v_config->'quiet_hours'->>'sunday_start')::integer * 60
          ELSE (v_config->'quiet_hours'->>'weekday_start')::integer * 60
        END AS start_minute,
        CASE
          WHEN final_rows.tz_window = 'unknown' THEN (v_config->'quiet_hours'->>'unknown_end_ct')::integer * 60
          WHEN extract(dow FROM zoned.local_ts)::integer = 0 THEN (v_config->'quiet_hours'->>'sunday_end')::integer * 60
          ELSE (v_config->'quiet_hours'->>'weekday_end')::integer * 60
        END AS end_minute
    ) AS bounds
  ),
  dial_rows AS (
    SELECT windowed.*
    FROM windowed
    WHERE windowed.window_open
  )
  SELECT
    coalesce((
      SELECT jsonb_agg(
        to_jsonb(dial_rows) || jsonb_build_object(
          'tier', dial_rows.tier,
          'intake_date', dial_rows.intake_date,
          'tz_window', dial_rows.tz_window
        )
        ORDER BY
          dial_rows.intake_date DESC NULLS LAST,
          CASE dial_rows.tier WHEN 'tier1' THEN 1 WHEN 'tier2' THEN 2 ELSE 3 END,
          CASE WHEN dial_rows.tz_window = 'unknown' THEN 1 ELSE 0 END,
          dial_rows.tz_window,
          dial_rows.amount_owed DESC NULLS LAST,
          dial_rows.phone_e164
      )
      FROM dial_rows
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source_list_row_id', final_rows.source_list_row_id,
        'phone_e164', final_rows.phone_e164,
        'basis', final_rows.basis,
        'requires_licensee_disclosure', final_rows.requires_licensee_disclosure,
        'ks_license_unconfirmed', final_rows.ks_license_unconfirmed,
        'calling_window', final_rows.calling_window
      ))
      FROM final_rows
    ), '[]'::jsonb),
    coalesce((
      SELECT jsonb_object_agg(counted.reason, counted.n)
      FROM (
        SELECT blocked_row.block_reason AS reason, count(*) AS n
        FROM reviewed AS blocked_row
        WHERE blocked_row.block_reason IS NOT NULL
        GROUP BY blocked_row.block_reason
        UNION ALL
        SELECT
          CASE shaped.gate WHEN 'retired' THEN 'retired_until_fresh' ELSE 'attempt_cap' END,
          count(*)
        FROM shaped
        WHERE shaped.gate NOT IN ('clear', 'pending')
        GROUP BY 1
        UNION ALL
        SELECT 'audit_list_blocked', count(*)
        FROM shaped
        WHERE shaped.gate IN ('clear', 'pending')
          AND EXISTS (SELECT 1 FROM blocked WHERE blocked.source_list_id = shaped.source_list_id)
        UNION ALL
        SELECT 'daily_phone_cap', count(*)
        FROM ranked
        WHERE ranked.phone_rank > ranked.phone_cap
        UNION ALL
        SELECT 'list_locked', count(*)
        FROM capped
        WHERE v_lock_id IS NOT NULL
          AND v_after
          AND NOT EXISTS (
            SELECT 1
            FROM public.source_list_export_batch_phones AS locked_phone
            WHERE locked_phone.export_batch_id = v_lock_id
              AND locked_phone.source_list_row_id = capped.source_list_row_id
              AND locked_phone.phone_e164 = capped.phone_e164
          )
        UNION ALL
        SELECT 'outside_tz_window', count(*)
        FROM windowed
        WHERE NOT windowed.window_open
      ) AS counted
      WHERE counted.n > 0
    ), '{}'::jsonb),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'reason', samples.reason,
        'phone_masked', samples.phone_masked
      ) ORDER BY samples.reason, samples.phone_masked)
      FROM (
        SELECT
          blocked_row.block_reason AS reason,
          public.dialer_phone_mask_v1(coalesce(blocked_row.phone_e164, blocked_row.phone_value)) AS phone_masked,
          row_number() OVER (
            PARTITION BY blocked_row.block_reason
            ORDER BY public.dialer_phone_mask_v1(coalesce(blocked_row.phone_e164, blocked_row.phone_value))
          ) AS sample_index
        FROM reviewed AS blocked_row
        WHERE blocked_row.block_reason IS NOT NULL
      ) AS samples
      WHERE samples.sample_index <= 20
    ), '[]'::jsonb)
  INTO v_rows, v_lock_rows, v_excluded_counts, v_excluded_phones;

  v_count := jsonb_array_length(v_rows);
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'source_list_export_too_large';
  END IF;

  INSERT INTO public.source_list_export_batches (
    created_at, created_by, list_type, county, state, violation_kind, source_list_id, phone_count, lock_batch_id, export_label
  ) VALUES (
    public.dialer_pool_now_v1(),
    v_actor,
    v_list_type,
    v_county,
    v_state,
    v_kind,
    p_source_list_id,
    v_count,
    CASE WHEN v_after AND v_lock_id IS NOT NULL THEN v_lock_id ELSE NULL END,
    NULL
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
    item->>'basis',
    coalesce((item->>'requires_licensee_disclosure')::boolean, false),
    coalesce((item->>'ks_license_unconfirmed')::boolean, false),
    item->>'calling_window'
  FROM jsonb_array_elements(v_lock_rows) AS item;

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

COMMENT ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer) IS
  'Market-check export, plus the calling-pool order, caps, and 4:00am CT lock. mls_expired stays a valid lane and is kept out of the pool file. Two builds for the same CT day and filter take one advisory lock.';

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
    'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer', 'out_of_area', 'new_needs_skip'
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
    IF EXISTS (
      SELECT 1
      FROM public.source_list_export_batch_phones AS phone
      JOIN public.source_list_rows AS row ON row.id = phone.source_list_row_id
      WHERE phone.export_batch_id = p_export_batch_id
        AND phone.source_list_row_id = p_row_id
        AND (
          public.source_list_phone_block_reason_v1(phone.phone_e164, row.prospect_id) IS NOT NULL
          OR public.source_list_phone_block_reason_v1(phone.phone_e164, row.county, row.county) IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'phone_blocked';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.source_list_export_batch_phones AS phone
      WHERE phone.export_batch_id = p_export_batch_id
        AND phone.source_list_row_id = p_row_id
        AND NOT public.dialer_pool_call_window_open_v1(phone.phone_e164)
    ) THEN
      RAISE EXCEPTION 'outside_tz_window';
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

-- #831's lane lookup. The OR across prospect id and phone key made the
-- planner scan every prospect phone once per block-reason call. Same matches,
-- as SQL so the block-reason query can inline them.
CREATE OR REPLACE FUNCTION public.dialer_campaign_lanes_v1(p_prospect_id uuid, p_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce(array_agg(DISTINCT nullif(btrim(found.lane), '')), ARRAY[]::text[])
  FROM (
    SELECT campaign.lane
    FROM public.prospecting_campaigns AS campaign
    JOIN public.prospecting_campaign_members AS member ON member.campaign_id = campaign.id
    JOIN public.prospecting_campaign_member_contacts AS contact ON contact.member_id = member.id
    WHERE contact.status = 'ready'
      AND (contact.prospect_id = p_prospect_id OR member.prospect_id = p_prospect_id)
    UNION
    SELECT campaign.lane
    FROM public.prospecting_campaigns AS campaign
    JOIN public.prospecting_campaign_members AS member ON member.campaign_id = campaign.id
    JOIN public.prospecting_campaign_member_contacts AS contact ON contact.member_id = member.id
    LEFT JOIN public.prospect_phones AS phone ON phone.id = contact.prospect_phone_id
    WHERE contact.status = 'ready'
      AND public.prospecting_phone_key_v1(coalesce(phone.phone, contact.phone_snapshot)) = p_key
  ) AS found;
$function$;

-- #831 attaches the lane gate to every bucketed phone, then filters to the
-- input key. Keep that gate and run it only for the input key.
DO $lane_push$
DECLARE
  def text := pg_get_functiondef('public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[])'::regprocedure);
  old text := $old$    FROM bucketed_phones
    CROSS JOIN LATERAL (
      SELECT public.dialer_relationship_block_reason_v1($old$;
  new text := $new$    FROM (
      SELECT bucketed_phones.*
      FROM bucketed_phones
      WHERE length(bucketed_phones.key10) = 10
        AND bucketed_phones.key10 IN (
          SELECT input.key10 FROM input WHERE length(input.key10) = 10
        )
      OFFSET 0
    ) AS bucketed_phones
    CROSS JOIN LATERAL (
      SELECT public.dialer_relationship_block_reason_v1($new$;
BEGIN
  IF position(old IN def) = 0 THEN
    IF position('bucketed_phones.key10 IN' IN def) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'relationship lane call site was not found';
  END IF;
  EXECUTE replace(def, old, new);
END;
$lane_push$;

COMMENT ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid) IS
  'Status change from the live market-check function, including out_of_area and new_needs_skip. loaded_to_dialer is refused when a phone on that batch row is blocked or outside the calling window.';

REVOKE ALL ON FUNCTION public.dialer_pool_now_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_later_v1(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_easter_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_thanksgiving_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_holiday_v1(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_business_window_start_v1(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_prospect_facts_v1(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_attempt_states_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_audit_findings_v1(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_audit_blocked_lists_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_multi_line_suspended_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_pool_call_window_open_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dialer_pool_now_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_later_v1(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_easter_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_thanksgiving_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_holiday_v1(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_business_window_start_v1(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_prospect_facts_v1(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_attempt_states_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_audit_findings_v1(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_audit_blocked_lists_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_multi_line_suspended_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_pool_call_window_open_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer)
  TO service_role;
