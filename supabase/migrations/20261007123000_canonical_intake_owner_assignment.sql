-- Assign a verified intake owner without overwriting a human decision.
-- The existing lifecycle command remains the only write/audit implementation;
-- this wrapper adds an atomic "only when unassigned" condition for workflows.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.crm_assign_owner_if_unassigned_v1(
  target_lead_id uuid,
  target_command_id uuid,
  target_owner text,
  target_reason text,
  target_evidence_reference text,
  target_actor_email text,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  event_row public.crm_lifecycle_events;
  command_result jsonb;
  clean_owner text := nullif(trim(coalesce(target_owner, '')), '');
BEGIN
  IF target_command_id IS NULL THEN RAISE EXCEPTION 'command_id_required'; END IF;
  IF clean_owner IS NULL THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF nullif(trim(coalesce(target_actor_email, '')), '') IS NULL
    OR nullif(trim(coalesce(target_actor_name, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;

  SELECT * INTO event_row
  FROM public.crm_lifecycle_events
  WHERE command_id = target_command_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'eventId', event_row.id,
      'leadId', lead_row.id,
      'owner', coalesce(nullif(trim(lead_row.assigned_agent), ''), event_row.to_owner, clean_owner),
      'applied', false,
      'replayed', true
    );
  END IF;

  IF nullif(trim(lead_row.assigned_agent), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'eventId', NULL,
      'leadId', lead_row.id,
      'owner', trim(lead_row.assigned_agent),
      'applied', false,
      'replayed', false
    );
  END IF;

  command_result := public.crm_apply_lifecycle_command_v1(
    target_lead_id,
    target_command_id,
    'assign',
    NULL,
    NULL,
    NULL,
    clean_owner,
    NULL,
    NULL,
    nullif(trim(coalesce(target_reason, '')), ''),
    'verified_workflow_event',
    nullif(trim(coalesce(target_evidence_reference, '')), ''),
    lower(trim(target_actor_email)),
    trim(target_actor_name)
  );

  RETURN command_result || jsonb_build_object('applied', true);
END
$$;

REVOKE ALL ON FUNCTION public.crm_assign_owner_if_unassigned_v1(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_assign_owner_if_unassigned_v1(
  uuid, uuid, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.crm_assign_owner_if_unassigned_v1(
  uuid, uuid, text, text, text, text, text
) IS 'Atomically preserves an existing opportunity owner or delegates a first assignment to the governed lifecycle command.';

COMMIT;
