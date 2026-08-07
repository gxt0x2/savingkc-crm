-- Governed retention controls for high-growth operational tables.
-- All policies start in monitor-only mode. A policy cannot delete until both
-- deletion_enabled is true and, when required, its archive has been verified.
-- hygiene-approved-destructive: bounded policy-driven retention; disabled by default and protected by archive gates.

CREATE TABLE IF NOT EXISTS public.data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL UNIQUE,
  timestamp_column TEXT NOT NULL,
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  batch_size INTEGER NOT NULL DEFAULT 500 CHECK (batch_size BETWEEN 1 AND 5000),
  monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deletion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  archive_required BOOLEAN NOT NULL DEFAULT TRUE,
  archive_reference TEXT,
  archive_verified_at TIMESTAMPTZ,
  owner TEXT NOT NULL,
  rationale TEXT NOT NULL,
  last_preview_at TIMESTAMPTZ,
  last_apply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_archive_gate CHECK (
    NOT deletion_enabled
    OR NOT archive_required
    OR (archive_reference IS NOT NULL AND archive_verified_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.data_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'blocked')),
  invoked_by TEXT NOT NULL,
  release_sha TEXT,
  summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_retention_runs_started
  ON public.data_retention_runs(started_at DESC);

ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.data_retention_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.data_retention_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.data_retention_policies TO service_role;
GRANT ALL ON public.data_retention_runs TO service_role;

INSERT INTO public.data_retention_policies (
  table_name,
  timestamp_column,
  retention_days,
  batch_size,
  archive_required,
  owner,
  rationale
) VALUES
  ('manifest_history', 'updated_at', 365, 500, TRUE, 'Operations', 'Preserve one year of manifest audit history while preventing unbounded storage growth.'),
  ('hot_score_audit_trail', 'created_at', 90, 1000, FALSE, 'Acquisitions', 'Keep current scoring evidence while bounding recalculation history.'),
  ('google_ads_reporting_sync_runs', 'started_at', 90, 500, FALSE, 'Marketing', 'Retain recent sync diagnostics; campaign reporting facts live in the reporting tables.'),
  ('openai_ads_reporting_sync_runs', 'started_at', 30, 500, FALSE, 'Marketing', 'Legacy OpenAI Ads sync diagnostics are deprecated and no longer scheduled.'),
  ('sms_delivery_log', 'created_at', 180, 500, TRUE, 'Operations', 'Preserve six months of delivery evidence and require an archive before any removal.')
ON CONFLICT (table_name) DO UPDATE SET
  timestamp_column = EXCLUDED.timestamp_column,
  retention_days = EXCLUDED.retention_days,
  batch_size = EXCLUDED.batch_size,
  archive_required = EXCLUDED.archive_required,
  owner = EXCLUDED.owner,
  rationale = EXCLUDED.rationale,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.preview_data_retention()
RETURNS TABLE (
  policy_id UUID,
  table_name TEXT,
  cutoff_at TIMESTAMPTZ,
  candidate_count BIGINT,
  batch_full BOOLEAN,
  deletion_enabled BOOLEAN,
  archive_ready BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  policy RECORD;
  candidate_total BIGINT;
  cutoff_value TIMESTAMPTZ;
BEGIN
  FOR policy IN
    SELECT retention_policy.*
    FROM public.data_retention_policies AS retention_policy
    WHERE retention_policy.monitoring_enabled = TRUE
    ORDER BY retention_policy.table_name
  LOOP
    IF policy.table_name !~ '^[a-z][a-z0-9_]*$'
      OR policy.timestamp_column !~ '^[a-z][a-z0-9_]*$'
      OR to_regclass(format('public.%I', policy.table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    cutoff_value := NOW() - make_interval(days => policy.retention_days);
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I WHERE %I < $1 LIMIT $2) bounded',
      policy.table_name,
      policy.timestamp_column
    ) INTO candidate_total USING cutoff_value, policy.batch_size;

    UPDATE public.data_retention_policies
    SET last_preview_at = NOW(), updated_at = NOW()
    WHERE id = policy.id;

    RETURN QUERY SELECT
      policy.id,
      policy.table_name,
      cutoff_value,
      candidate_total,
      candidate_total >= policy.batch_size,
      policy.deletion_enabled,
      (NOT policy.archive_required OR (policy.archive_reference IS NOT NULL AND policy.archive_verified_at IS NOT NULL));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_data_retention()
RETURNS TABLE (
  policy_id UUID,
  table_name TEXT,
  cutoff_at TIMESTAMPTZ,
  deleted_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  policy RECORD;
  removed BIGINT;
  cutoff_value TIMESTAMPTZ;
BEGIN
  FOR policy IN
    SELECT retention_policy.*
    FROM public.data_retention_policies AS retention_policy
    WHERE retention_policy.monitoring_enabled = TRUE AND retention_policy.deletion_enabled = TRUE
    ORDER BY retention_policy.table_name
  LOOP
    IF policy.archive_required
      AND (policy.archive_reference IS NULL OR policy.archive_verified_at IS NULL) THEN
      RAISE EXCEPTION 'Archive verification is required for %', policy.table_name;
    END IF;
    IF policy.table_name !~ '^[a-z][a-z0-9_]*$'
      OR policy.timestamp_column !~ '^[a-z][a-z0-9_]*$'
      OR to_regclass(format('public.%I', policy.table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    cutoff_value := NOW() - make_interval(days => policy.retention_days);
    EXECUTE format(
      'DELETE FROM public.%I WHERE ctid IN (SELECT ctid FROM public.%I WHERE %I < $1 ORDER BY %I ASC LIMIT $2)',
      policy.table_name,
      policy.table_name,
      policy.timestamp_column,
      policy.timestamp_column
    ) USING cutoff_value, policy.batch_size;
    GET DIAGNOSTICS removed = ROW_COUNT;

    UPDATE public.data_retention_policies
    SET last_apply_at = NOW(), updated_at = NOW()
    WHERE id = policy.id;

    RETURN QUERY SELECT policy.id, policy.table_name, cutoff_value, removed;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_data_retention() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_data_retention() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_data_retention() TO service_role;
