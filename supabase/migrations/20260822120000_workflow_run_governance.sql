-- Durable workflow execution, approval, retry, and provenance ledger.
--
-- Workflow definitions remain code/configuration owned. Each run captures an
-- immutable definition snapshot so later catalog changes cannot rewrite the
-- historical meaning of work that already ran. This migration activates no
-- schedule and executes no existing workflow.

CREATE TABLE IF NOT EXISTS public.workflow_definition_versions (
  workflow_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition_hash text NOT NULL CHECK (length(definition_hash) BETWEEN 16 AND 128),
  definition_snapshot jsonb NOT NULL CHECK (jsonb_typeof(definition_snapshot) = 'object'),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  approval_policy text NOT NULL CHECK (approval_policy IN ('automatic', 'user_confirmation', 'admin_only')),
  mutates_data boolean NOT NULL,
  registered_by text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id text NOT NULL,
  workflow_version integer NOT NULL,
  definition_hash text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'awaiting_approval', 'queued', 'running', 'retry_scheduled',
    'succeeded', 'failed', 'rejected', 'cancelled'
  )),
  approval_policy text NOT NULL CHECK (approval_policy IN ('automatic', 'user_confirmation', 'admin_only')),
  mutates_data boolean NOT NULL,
  trigger_kind text NOT NULL,
  trigger_key text,
  idempotency_key text NOT NULL UNIQUE,
  requested_by text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  output jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, workflow_version)
    REFERENCES public.workflow_definition_versions(workflow_id, version)
);

CREATE TABLE IF NOT EXISTS public.workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id),
  step_index integer NOT NULL CHECK (step_index >= 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  step_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  idempotency_key text NOT NULL UNIQUE,
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  output jsonb,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index, attempt)
);

CREATE TABLE IF NOT EXISTS public.workflow_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  idempotency_key text NOT NULL UNIQUE,
  decided_by text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id),
  event_type text NOT NULL,
  actor text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workflow_definition_versions, public.workflow_runs,
  public.workflow_run_steps, public.workflow_approvals, public.workflow_run_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_definition_versions, public.workflow_runs,
  public.workflow_run_steps, public.workflow_approvals, public.workflow_run_events
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_claimable
  ON public.workflow_runs (available_at, created_at, id)
  WHERE status IN ('queued', 'retry_scheduled');
CREATE INDEX IF NOT EXISTS idx_workflow_runs_stale_lease
  ON public.workflow_runs (lease_expires_at, id)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created
  ON public.workflow_runs (workflow_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_created
  ON public.workflow_runs (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run
  ON public.workflow_run_steps (run_id, step_index, attempt);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_run
  ON public.workflow_approvals (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run
  ON public.workflow_run_events (run_id, created_at, id);

CREATE OR REPLACE FUNCTION public.workflow_start_run_v1(
  p_workflow_id text,
  p_workflow_version integer,
  p_definition_hash text,
  p_definition_snapshot jsonb,
  p_workflow_status text,
  p_approval_policy text,
  p_mutates_data boolean,
  p_trigger_kind text,
  p_trigger_key text,
  p_idempotency_key text,
  p_requested_by text,
  p_input jsonb DEFAULT '{}'::jsonb,
  p_max_attempts integer DEFAULT 3
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_run public.workflow_runs;
  existing_definition public.workflow_definition_versions;
  created_run public.workflow_runs;
  initial_status text;
  clean_key text := trim(coalesce(p_idempotency_key, ''));
BEGIN
  IF nullif(trim(p_workflow_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_workflow_id'; END IF;
  IF p_workflow_version < 1 THEN RAISE EXCEPTION 'invalid_workflow_version'; END IF;
  IF length(trim(coalesce(p_definition_hash, ''))) NOT BETWEEN 16 AND 128 THEN RAISE EXCEPTION 'invalid_definition_hash'; END IF;
  IF jsonb_typeof(p_definition_snapshot) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_definition_snapshot'; END IF;
  IF p_workflow_status <> 'active' THEN RAISE EXCEPTION 'workflow_not_active'; END IF;
  IF p_approval_policy NOT IN ('automatic', 'user_confirmation', 'admin_only') THEN RAISE EXCEPTION 'invalid_approval_policy'; END IF;
  IF length(clean_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF nullif(trim(p_requested_by), '') IS NULL THEN RAISE EXCEPTION 'invalid_requested_by'; END IF;
  IF jsonb_typeof(coalesce(p_input, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_max_attempts NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_max_attempts'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workflow-run:' || clean_key, 0));
  SELECT * INTO existing_run FROM public.workflow_runs WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_run.workflow_id <> trim(p_workflow_id)
      OR existing_run.workflow_version <> p_workflow_version
      OR existing_run.definition_hash <> trim(p_definition_hash)
    THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RETURN existing_run;
  END IF;

  INSERT INTO public.workflow_definition_versions (
    workflow_id, version, definition_hash, definition_snapshot, status,
    approval_policy, mutates_data, registered_by
  ) VALUES (
    trim(p_workflow_id), p_workflow_version, trim(p_definition_hash), p_definition_snapshot,
    p_workflow_status, p_approval_policy, p_mutates_data, trim(p_requested_by)
  ) ON CONFLICT (workflow_id, version) DO NOTHING;

  SELECT * INTO existing_definition
  FROM public.workflow_definition_versions
  WHERE workflow_id = trim(p_workflow_id) AND version = p_workflow_version;
  IF existing_definition.definition_hash <> trim(p_definition_hash)
    OR existing_definition.definition_snapshot <> p_definition_snapshot
  THEN
    RAISE EXCEPTION 'definition_version_conflict';
  END IF;

  initial_status := CASE
    WHEN p_mutates_data OR p_approval_policy <> 'automatic' THEN 'awaiting_approval'
    ELSE 'queued'
  END;

  INSERT INTO public.workflow_runs (
    workflow_id, workflow_version, definition_hash, status, approval_policy,
    mutates_data, trigger_kind, trigger_key, idempotency_key, requested_by,
    input, max_attempts
  ) VALUES (
    trim(p_workflow_id), p_workflow_version, trim(p_definition_hash), initial_status,
    p_approval_policy, p_mutates_data, trim(p_trigger_kind), nullif(trim(p_trigger_key), ''),
    clean_key, trim(p_requested_by), coalesce(p_input, '{}'::jsonb), p_max_attempts
  ) RETURNING * INTO created_run;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (created_run.id, 'run_created', trim(p_requested_by), jsonb_build_object(
    'status', initial_status,
    'definition_hash', created_run.definition_hash,
    'trigger_kind', created_run.trigger_kind,
    'trigger_key', created_run.trigger_key
  ));
  RETURN created_run;
END
$$;

CREATE OR REPLACE FUNCTION public.workflow_decide_run_v1(
  p_run_id uuid,
  p_decision text,
  p_idempotency_key text,
  p_decided_by text,
  p_note text DEFAULT NULL
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
  existing_approval public.workflow_approvals;
  clean_decision text := lower(trim(coalesce(p_decision, '')));
  clean_key text := trim(coalesce(p_idempotency_key, ''));
BEGIN
  IF clean_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF length(clean_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF nullif(trim(p_decided_by), '') IS NULL THEN RAISE EXCEPTION 'invalid_decided_by'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workflow-approval:' || clean_key, 0));
  SELECT * INTO existing_approval FROM public.workflow_approvals WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_approval.run_id <> p_run_id OR existing_approval.decision <> clean_decision THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id;
    RETURN target_run;
  END IF;

  SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_run_not_found'; END IF;
  IF target_run.status <> 'awaiting_approval' THEN RAISE EXCEPTION 'workflow_run_not_awaiting_approval'; END IF;

  INSERT INTO public.workflow_approvals (run_id, decision, idempotency_key, decided_by, note)
  VALUES (p_run_id, clean_decision, clean_key, trim(p_decided_by), nullif(trim(p_note), ''));

  UPDATE public.workflow_runs SET
    status = CASE clean_decision WHEN 'approved' THEN 'queued' ELSE 'rejected' END,
    available_at = now(),
    finished_at = CASE clean_decision WHEN 'rejected' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_run_id RETURNING * INTO target_run;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (p_run_id, 'approval_' || clean_decision, trim(p_decided_by),
    jsonb_build_object('note', nullif(trim(p_note), '')));
  RETURN target_run;
END
$$;

CREATE OR REPLACE FUNCTION public.workflow_claim_run_v1(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
BEGIN
  IF nullif(trim(p_worker_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_worker_id'; END IF;
  IF p_lease_seconds NOT BETWEEN 15 AND 900 THEN RAISE EXCEPTION 'invalid_lease_seconds'; END IF;

  SELECT * INTO target_run
  FROM public.workflow_runs
  WHERE (
    (status IN ('queued', 'retry_scheduled') AND available_at <= now())
    OR (status = 'running' AND lease_expires_at <= now())
  )
  ORDER BY available_at, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF target_run.attempt_count >= target_run.max_attempts THEN
    UPDATE public.workflow_runs SET status = 'failed', finished_at = now(), updated_at = now(),
      lease_owner = NULL, lease_expires_at = NULL,
      error_code = 'retry_budget_exhausted', error_message = 'The workflow retry budget was exhausted.'
    WHERE id = target_run.id RETURNING * INTO target_run;
    INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
    VALUES (target_run.id, 'run_failed', trim(p_worker_id), jsonb_build_object('error_code', 'retry_budget_exhausted'));
    RETURN NULL;
  END IF;

  UPDATE public.workflow_runs SET
    status = 'running',
    attempt_count = attempt_count + 1,
    lease_owner = trim(p_worker_id),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(started_at, now()),
    error_code = NULL,
    error_message = NULL,
    updated_at = now()
  WHERE id = target_run.id RETURNING * INTO target_run;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (target_run.id, 'run_claimed', trim(p_worker_id), jsonb_build_object(
    'attempt', target_run.attempt_count,
    'lease_expires_at', target_run.lease_expires_at
  ));
  RETURN target_run;
END
$$;

CREATE OR REPLACE FUNCTION public.workflow_claim_specific_run_v1(
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
BEGIN
  IF nullif(trim(p_worker_id), '') IS NULL THEN RAISE EXCEPTION 'invalid_worker_id'; END IF;
  IF p_lease_seconds NOT BETWEEN 15 AND 900 THEN RAISE EXCEPTION 'invalid_lease_seconds'; END IF;

  SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_run_not_found'; END IF;
  IF NOT (
    (target_run.status IN ('queued', 'retry_scheduled') AND target_run.available_at <= now())
    OR (target_run.status = 'running' AND target_run.lease_expires_at <= now())
  ) THEN
    RETURN NULL;
  END IF;
  IF target_run.attempt_count >= target_run.max_attempts THEN
    UPDATE public.workflow_runs SET status = 'failed', finished_at = now(), updated_at = now(),
      lease_owner = NULL, lease_expires_at = NULL,
      error_code = 'retry_budget_exhausted', error_message = 'The workflow retry budget was exhausted.'
    WHERE id = target_run.id RETURNING * INTO target_run;
    INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
    VALUES (target_run.id, 'run_failed', trim(p_worker_id), jsonb_build_object('error_code', 'retry_budget_exhausted'));
    RETURN NULL;
  END IF;

  UPDATE public.workflow_runs SET
    status = 'running', attempt_count = attempt_count + 1,
    lease_owner = trim(p_worker_id), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    started_at = coalesce(started_at, now()), error_code = NULL, error_message = NULL, updated_at = now()
  WHERE id = target_run.id RETURNING * INTO target_run;
  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (target_run.id, 'run_claimed', trim(p_worker_id), jsonb_build_object(
    'attempt', target_run.attempt_count, 'lease_expires_at', target_run.lease_expires_at
  ));
  RETURN target_run;
END
$$;

CREATE OR REPLACE FUNCTION public.workflow_record_step_v1(
  p_run_id uuid,
  p_worker_id text,
  p_step_index integer,
  p_step_key text,
  p_status text,
  p_idempotency_key text,
  p_started_at timestamptz,
  p_input jsonb DEFAULT '{}'::jsonb,
  p_output jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS public.workflow_run_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
  existing_step public.workflow_run_steps;
  created_step public.workflow_run_steps;
  clean_key text := trim(coalesce(p_idempotency_key, ''));
BEGIN
  IF p_step_index < 0 THEN RAISE EXCEPTION 'invalid_step_index'; END IF;
  IF nullif(trim(p_step_key), '') IS NULL THEN RAISE EXCEPTION 'invalid_step_key'; END IF;
  IF p_status NOT IN ('succeeded', 'failed', 'skipped') THEN RAISE EXCEPTION 'invalid_step_status'; END IF;
  IF length(clean_key) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF jsonb_typeof(coalesce(p_input, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_input'; END IF;

  SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_run_not_found'; END IF;
  IF target_run.status <> 'running' OR target_run.lease_owner <> trim(p_worker_id) THEN RAISE EXCEPTION 'workflow_run_not_leased'; END IF;

  SELECT * INTO existing_step FROM public.workflow_run_steps WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_step.run_id <> p_run_id OR existing_step.step_index <> p_step_index OR existing_step.attempt <> target_run.attempt_count THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RETURN existing_step;
  END IF;

  INSERT INTO public.workflow_run_steps (
    run_id, step_index, attempt, step_key, status, idempotency_key, input, output,
    error_code, error_message, started_at
  ) VALUES (
    p_run_id, p_step_index, target_run.attempt_count, trim(p_step_key), p_status,
    clean_key, coalesce(p_input, '{}'::jsonb), p_output, nullif(trim(p_error_code), ''),
    nullif(trim(p_error_message), ''), p_started_at
  ) RETURNING * INTO created_step;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (p_run_id, 'step_' || p_status, trim(p_worker_id), jsonb_build_object(
    'step_index', p_step_index,
    'step_key', trim(p_step_key),
    'attempt', target_run.attempt_count,
    'error_code', nullif(trim(p_error_code), '')
  ));
  RETURN created_step;
END
$$;

CREATE OR REPLACE FUNCTION public.workflow_finish_run_v1(
  p_run_id uuid,
  p_worker_id text,
  p_outcome text,
  p_output jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS public.workflow_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_run public.workflow_runs;
  next_status text;
  retry_seconds integer;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
  SELECT * INTO target_run FROM public.workflow_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_run_not_found'; END IF;
  IF target_run.status <> 'running' OR target_run.lease_owner <> trim(p_worker_id) THEN RAISE EXCEPTION 'workflow_run_not_leased'; END IF;

  IF p_outcome = 'succeeded' THEN
    next_status := 'succeeded';
  ELSIF target_run.attempt_count < target_run.max_attempts THEN
    next_status := 'retry_scheduled';
  ELSE
    next_status := 'failed';
  END IF;
  retry_seconds := least(3600, 30 * (2 ^ greatest(target_run.attempt_count - 1, 0))::integer);

  UPDATE public.workflow_runs SET
    status = next_status,
    output = CASE WHEN p_outcome = 'succeeded' THEN p_output ELSE output END,
    error_code = CASE WHEN p_outcome = 'failed' THEN coalesce(nullif(trim(p_error_code), ''), 'workflow_failed') ELSE NULL END,
    error_message = CASE WHEN p_outcome = 'failed' THEN left(coalesce(nullif(trim(p_error_message), ''), 'Workflow execution failed.'), 1000) ELSE NULL END,
    available_at = CASE WHEN next_status = 'retry_scheduled' THEN now() + make_interval(secs => retry_seconds) ELSE available_at END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    finished_at = CASE WHEN next_status IN ('succeeded', 'failed') THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_run_id RETURNING * INTO target_run;

  INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
  VALUES (p_run_id, CASE next_status WHEN 'retry_scheduled' THEN 'retry_scheduled' ELSE 'run_' || next_status END,
    trim(p_worker_id), jsonb_build_object(
      'attempt', target_run.attempt_count,
      'error_code', target_run.error_code,
      'available_at', target_run.available_at
    ));
  RETURN target_run;
END
$$;

REVOKE ALL ON FUNCTION public.workflow_start_run_v1(text, integer, text, jsonb, text, text, boolean, text, text, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workflow_decide_run_v1(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workflow_claim_run_v1(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workflow_claim_specific_run_v1(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workflow_record_step_v1(uuid, text, integer, text, text, text, timestamptz, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workflow_finish_run_v1(uuid, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.workflow_start_run_v1(text, integer, text, jsonb, text, text, boolean, text, text, text, text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_decide_run_v1(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_claim_run_v1(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_claim_specific_run_v1(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_record_step_v1(uuid, text, integer, text, text, text, timestamptz, jsonb, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workflow_finish_run_v1(uuid, text, text, jsonb, text, text) TO service_role;

COMMENT ON TABLE public.workflow_definition_versions IS 'Immutable workflow definition snapshots referenced by durable runs.';
COMMENT ON TABLE public.workflow_runs IS 'Durable workflow execution state with approval, lease, retry, and provenance fields.';
COMMENT ON TABLE public.workflow_run_steps IS 'Per-attempt workflow step outcomes with idempotency keys.';
COMMENT ON TABLE public.workflow_approvals IS 'Explicit workflow approval and rejection decisions.';
COMMENT ON TABLE public.workflow_run_events IS 'Append-only workflow run lifecycle audit events.';
