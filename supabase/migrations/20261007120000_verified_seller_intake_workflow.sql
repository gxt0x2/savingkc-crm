-- Permit one deterministic, server-owned event workflow to execute without a
-- human approval while preserving the default rule that mutating workflows
-- wait for confirmation. No generic automatic-mutation bypass is introduced.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.workflow_start_verified_seller_intake_v1(
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
  created_run public.workflow_runs;
  clean_trigger_key text := trim(coalesce(p_trigger_key, ''));
  clean_lead_id text := trim(coalesce(p_input ->> 'leadId', ''));
BEGIN
  IF trim(coalesce(p_workflow_id, '')) <> 'seller-form-intake'
    OR p_workflow_version IS DISTINCT FROM 2
    OR p_workflow_status IS DISTINCT FROM 'active'
    OR p_approval_policy IS DISTINCT FROM 'automatic'
    OR p_mutates_data IS DISTINCT FROM true
    OR trim(coalesce(p_trigger_kind, '')) <> 'lead_form_submitted'
    OR lower(trim(coalesce(p_requested_by, ''))) <> 'savingkc operations'
  THEN
    RAISE EXCEPTION 'verified_seller_intake_contract_required';
  END IF;

  IF jsonb_typeof(p_definition_snapshot) IS DISTINCT FROM 'object'
    OR p_definition_snapshot ->> 'id' IS DISTINCT FROM 'seller-form-intake'
    OR p_definition_snapshot ->> 'version' IS DISTINCT FROM '2'
    OR p_definition_snapshot #>> '{implementation,execution}' IS DISTINCT FROM 'worker'
    OR p_definition_snapshot #>> '{implementation,approvalPolicy}' IS DISTINCT FROM 'automatic'
    OR p_definition_snapshot #>> '{implementation,mutatesData}' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'invalid_seller_intake_definition';
  END IF;

  IF clean_trigger_key !~ '^seller-form-intake:[a-f0-9]{24}$'
    OR trim(coalesce(p_idempotency_key, '')) <> clean_trigger_key
    OR p_input ->> 'workflowTriggerKey' IS DISTINCT FROM clean_trigger_key
    OR nullif(trim(coalesce(p_input ->> 'formSource', '')), '') IS NULL
    OR nullif(trim(coalesce(p_input ->> 'dueAt', '')), '') IS NULL
    OR clean_lead_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = clean_lead_id::uuid)
  THEN
    RAISE EXCEPTION 'invalid_seller_intake_event';
  END IF;

  PERFORM (p_input ->> 'dueAt')::timestamptz;

  created_run := public.workflow_start_run_v1(
    p_workflow_id,
    p_workflow_version,
    p_definition_hash,
    p_definition_snapshot,
    p_workflow_status,
    p_approval_policy,
    p_mutates_data,
    p_trigger_kind,
    p_trigger_key,
    p_idempotency_key,
    p_requested_by,
    p_input,
    p_max_attempts
  );

  IF created_run.status = 'awaiting_approval' THEN
    UPDATE public.workflow_runs
    SET status = 'queued', available_at = now(), updated_at = now()
    WHERE id = created_run.id AND status = 'awaiting_approval'
    RETURNING * INTO created_run;

    INSERT INTO public.workflow_run_events (run_id, event_type, actor, data)
    VALUES (
      created_run.id,
      'verified_server_event_authorized',
      trim(p_requested_by),
      jsonb_build_object(
        'workflow_id', created_run.workflow_id,
        'trigger_kind', created_run.trigger_kind,
        'trigger_key', created_run.trigger_key,
        'authority', 'seller_intake_allowlist_v1'
      )
    );
  END IF;

  RETURN created_run;
END
$$;

REVOKE ALL ON FUNCTION public.workflow_start_verified_seller_intake_v1(
  text, integer, text, jsonb, text, text, boolean, text, text, text, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_start_verified_seller_intake_v1(
  text, integer, text, jsonb, text, text, boolean, text, text, text, text, jsonb, integer
) TO service_role;

COMMENT ON FUNCTION public.workflow_start_verified_seller_intake_v1(
  text, integer, text, jsonb, text, text, boolean, text, text, text, text, jsonb, integer
) IS 'Starts only the versioned seller-form intake workflow from a validated server event; all other mutating workflows retain the normal approval boundary.';

COMMIT;
