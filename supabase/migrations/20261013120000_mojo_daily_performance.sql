-- Authoritative Mojo daily performance snapshots.
--
-- Contact-level Mojo events remain immutable evidence in crm_mojo_call_events.
-- Dashboard totals such as calls, contacts, and dialing time are provider
-- snapshots and must never be inferred from the filtered event stream.

CREATE TABLE IF NOT EXISTS public.mojo_agent_daily_performance (
  agent_key text NOT NULL,
  metric_date date NOT NULL,
  provider_agent_id text NOT NULL,
  provider_timezone text NOT NULL,
  dialing_seconds numeric(12, 3) NOT NULL DEFAULT 0,
  in_progress_seconds numeric(12, 3) NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  contacts integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  appointments integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'mojo_kpi_historical_daily_v1',
  source_digest text NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_key, metric_date),
  CONSTRAINT mojo_agent_daily_performance_agent_key_check
    CHECK (agent_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT mojo_agent_daily_performance_provider_agent_check
    CHECK (provider_agent_id ~ '^[0-9]{1,32}$'),
  CONSTRAINT mojo_agent_daily_performance_timezone_check
    CHECK (provider_timezone = 'America/Chicago'),
  CONSTRAINT mojo_agent_daily_performance_seconds_check
    CHECK (dialing_seconds >= 0 AND dialing_seconds <= 172800
      AND in_progress_seconds >= 0 AND in_progress_seconds <= 172800),
  CONSTRAINT mojo_agent_daily_performance_counts_check
    CHECK (calls >= 0 AND calls <= 100000
      AND contacts >= 0 AND contacts <= 100000
      AND leads >= 0 AND leads <= 100000
      AND appointments >= 0 AND appointments <= 100000),
  CONSTRAINT mojo_agent_daily_performance_source_check
    CHECK (source = 'mojo_kpi_historical_daily_v1'),
  CONSTRAINT mojo_agent_daily_performance_digest_check
    CHECK (source_digest ~ '^[a-f0-9]{64}$')
);

ALTER TABLE public.mojo_agent_daily_performance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mojo_agent_daily_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mojo_agent_daily_performance TO service_role;

CREATE INDEX IF NOT EXISTS idx_mojo_agent_daily_performance_agent_date
  ON public.mojo_agent_daily_performance(agent_key, metric_date DESC);

CREATE OR REPLACE FUNCTION public.upsert_mojo_agent_daily_performance_v1(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  agent_value text;
  date_value date;
  provider_agent_value text;
  timezone_value text;
  dialing_value numeric(12, 3);
  in_progress_value numeric(12, 3);
  calls_value integer;
  contacts_value integer;
  leads_value integer;
  appointments_value integer;
  source_value text;
  digest_value text;
  fetched_at_value timestamptz;
  applied_row public.mojo_agent_daily_performance;
  current_row public.mojo_agent_daily_performance;
  was_applied boolean := false;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_mojo_performance_snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_snapshot) AS supplied(key)
    WHERE supplied.key NOT IN (
      'agentKey', 'metricDate', 'providerAgentId', 'providerTimezone',
      'dialingSeconds', 'inProgressSeconds', 'calls', 'contacts', 'leads',
      'appointments', 'source', 'sourceDigest', 'sourceFetchedAt'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_mojo_performance_field';
  END IF;

  agent_value := lower(nullif(btrim(p_snapshot->>'agentKey'), ''));
  provider_agent_value := nullif(btrim(p_snapshot->>'providerAgentId'), '');
  timezone_value := nullif(btrim(p_snapshot->>'providerTimezone'), '');
  source_value := nullif(btrim(p_snapshot->>'source'), '');
  digest_value := lower(nullif(btrim(p_snapshot->>'sourceDigest'), ''));

  IF agent_value IS NULL OR agent_value !~ '^[a-z][a-z0-9_-]{0,63}$'
     OR provider_agent_value IS NULL OR provider_agent_value !~ '^[0-9]{1,32}$'
     OR timezone_value IS DISTINCT FROM 'America/Chicago'
     OR source_value IS DISTINCT FROM 'mojo_kpi_historical_daily_v1'
     OR digest_value IS NULL OR digest_value !~ '^[a-f0-9]{64}$'
     OR coalesce(p_snapshot->>'metricDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR coalesce(p_snapshot->>'sourceFetchedAt', '') = ''
  THEN
    RAISE EXCEPTION 'invalid_mojo_performance_identity';
  END IF;

  IF coalesce(p_snapshot->>'dialingSeconds', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
     OR coalesce(p_snapshot->>'inProgressSeconds', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
     OR coalesce(p_snapshot->>'calls', '') !~ '^[0-9]+$'
     OR coalesce(p_snapshot->>'contacts', '') !~ '^[0-9]+$'
     OR coalesce(p_snapshot->>'leads', '') !~ '^[0-9]+$'
     OR coalesce(p_snapshot->>'appointments', '') !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'invalid_mojo_performance_metric';
  END IF;

  BEGIN
    date_value := (p_snapshot->>'metricDate')::date;
    fetched_at_value := (p_snapshot->>'sourceFetchedAt')::timestamptz;
    dialing_value := (p_snapshot->>'dialingSeconds')::numeric(12, 3);
    in_progress_value := (p_snapshot->>'inProgressSeconds')::numeric(12, 3);
    calls_value := (p_snapshot->>'calls')::integer;
    contacts_value := (p_snapshot->>'contacts')::integer;
    leads_value := (p_snapshot->>'leads')::integer;
    appointments_value := (p_snapshot->>'appointments')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_mojo_performance_value';
  END;

  IF date_value < date '2020-01-01' OR date_value > current_date + 1
     OR fetched_at_value < timestamptz '2020-01-01 00:00:00+00'
     OR fetched_at_value > clock_timestamp() + interval '5 minutes'
     OR dialing_value > 172800 OR in_progress_value > 172800
     OR calls_value > 100000 OR contacts_value > 100000
     OR leads_value > 100000 OR appointments_value > 100000
  THEN
    RAISE EXCEPTION 'invalid_mojo_performance_range';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mojo-performance:' || agent_value || ':' || date_value::text, 0)
  );

  INSERT INTO public.mojo_agent_daily_performance (
    agent_key, metric_date, provider_agent_id, provider_timezone,
    dialing_seconds, in_progress_seconds, calls, contacts, leads, appointments,
    source, source_digest, source_fetched_at
  ) VALUES (
    agent_value, date_value, provider_agent_value, timezone_value,
    dialing_value, in_progress_value, calls_value, contacts_value, leads_value,
    appointments_value, source_value, digest_value, fetched_at_value
  )
  ON CONFLICT (agent_key, metric_date) DO UPDATE SET
    provider_agent_id = EXCLUDED.provider_agent_id,
    provider_timezone = EXCLUDED.provider_timezone,
    dialing_seconds = EXCLUDED.dialing_seconds,
    in_progress_seconds = EXCLUDED.in_progress_seconds,
    calls = EXCLUDED.calls,
    contacts = EXCLUDED.contacts,
    leads = EXCLUDED.leads,
    appointments = EXCLUDED.appointments,
    source = EXCLUDED.source,
    source_digest = EXCLUDED.source_digest,
    source_fetched_at = EXCLUDED.source_fetched_at,
    updated_at = now()
  WHERE EXCLUDED.source_fetched_at > public.mojo_agent_daily_performance.source_fetched_at
  RETURNING * INTO applied_row;

  IF applied_row.agent_key IS NOT NULL THEN
    was_applied := true;
    current_row := applied_row;
  ELSE
    SELECT * INTO current_row
    FROM public.mojo_agent_daily_performance
    WHERE agent_key = agent_value AND metric_date = date_value;
  END IF;

  RETURN jsonb_build_object(
    'applied', was_applied,
    'agentKey', current_row.agent_key,
    'metricDate', current_row.metric_date,
    'sourceFetchedAt', current_row.source_fetched_at,
    'sourceDigest', current_row.source_digest
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_mojo_agent_daily_performance_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mojo_agent_daily_performance_v1(jsonb)
  TO service_role;

COMMENT ON TABLE public.mojo_agent_daily_performance IS
  'Authoritative, overwrite-only daily performance totals read from the Mojo KPI dashboard. Contact events remain separate immutable evidence.';
COMMENT ON FUNCTION public.upsert_mojo_agent_daily_performance_v1(jsonb) IS
  'Validates and idempotently upserts one Mojo daily performance snapshot. Older observations cannot overwrite newer snapshots.';
