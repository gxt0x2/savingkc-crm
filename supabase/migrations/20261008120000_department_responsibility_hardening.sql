-- Department responsibility hardening.
--
-- Marketing owns demand generation and verified outcome attribution. It does
-- not own a seller record after that record enters the CRM. Acquisitions owns
-- New through the signed seller-contract transition; Dispositions owns the
-- buyer exit; Transaction Coordination explicitly accepts the executed
-- assignment before it owns closing work.

CREATE OR REPLACE FUNCTION public.crm_department_for_stage(stage_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(coalesce(stage_value, 'new'))
    WHEN 'new' THEN 'acquisitions'
    WHEN 'intake' THEN 'acquisitions'
    WHEN 'not_contacted' THEN 'acquisitions'
    WHEN 'contacted' THEN 'acquisitions'
    WHEN 'qualified' THEN 'acquisitions'
    WHEN 'appointment_set' THEN 'acquisitions'
    WHEN 'offer_made' THEN 'acquisitions'
    WHEN 'under_contract' THEN 'dispositions'
    WHEN 'disposition' THEN 'dispositions'
    WHEN 'closing' THEN 'transaction_coordination'
    WHEN 'closed_won' THEN 'closed'
    WHEN 'closed_lost' THEN 'closed'
    WHEN 'dead' THEN 'closed'
    ELSE 'acquisitions'
  END;
$$;

REVOKE ALL ON FUNCTION public.crm_department_for_stage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_department_for_stage(text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_record_department_handoff_v1(
  target_command_id uuid,
  target_lead_id uuid,
  target_from_department text,
  target_to_department text,
  target_source_record_type text,
  target_source_record_id uuid,
  target_record_type text,
  target_record_id uuid,
  target_evidence_type text,
  target_evidence_reference text,
  target_actor_email text,
  target_actor_name text,
  target_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  event_id uuid;
  handoff_row public.crm_department_handoffs;
  opportunity_value uuid;
BEGIN
  IF target_command_id IS NULL OR target_source_record_id IS NULL THEN RAISE EXCEPTION 'handoff_identity_required'; END IF;
  IF target_from_department = target_to_department THEN RAISE EXCEPTION 'handoff_departments_must_differ'; END IF;
  IF nullif(trim(target_actor_email), '') IS NULL OR nullif(trim(target_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crm-handoff:' || target_from_department || ':' || target_to_department || ':' || target_source_record_type || ':' || target_source_record_id::text, 0
  ));

  SELECT * INTO handoff_row
  FROM public.crm_department_handoffs
  WHERE from_department = target_from_department
    AND to_department = target_to_department
    AND source_record_type = target_source_record_type
    AND source_record_id = target_source_record_id;
  IF FOUND THEN
    RETURN jsonb_build_object('handoffId', handoff_row.id, 'status', handoff_row.status, 'replayed', true);
  END IF;

  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  SELECT opportunity_id INTO opportunity_value FROM public.crm_lead_entity_links WHERE lead_id = target_lead_id;

  INSERT INTO public.crm_lifecycle_events(
    command_id, lead_id, opportunity_id, command_type, from_stage, to_stage,
    from_owner, to_owner, from_department, to_department, reason,
    actor_email, actor_name, metadata
  ) VALUES (
    target_command_id, target_lead_id, opportunity_value, 'handoff', lead_row.station, lead_row.station,
    lead_row.assigned_agent, lead_row.assigned_agent, target_from_department, target_to_department,
    target_reason, lower(trim(target_actor_email)), trim(target_actor_name),
    jsonb_build_object('source_record_type', target_source_record_type, 'source_record_id', target_source_record_id,
      'target_record_type', target_record_type, 'target_record_id', target_record_id,
      'evidence_type', target_evidence_type, 'evidence_reference', target_evidence_reference)
  ) RETURNING id INTO event_id;

  INSERT INTO public.crm_department_handoffs(
    lifecycle_event_id, lead_id, opportunity_id, from_department, to_department,
    status, assigned_to, reason, created_by,
    source_record_type, source_record_id, target_record_type, target_record_id,
    evidence_type, evidence_reference
  ) VALUES (
    event_id, target_lead_id, opportunity_value, target_from_department, target_to_department,
    'pending', lead_row.assigned_agent, target_reason, trim(target_actor_name),
    target_source_record_type, target_source_record_id, target_record_type, target_record_id,
    target_evidence_type, target_evidence_reference
  ) RETURNING * INTO handoff_row;

  RETURN jsonb_build_object('handoffId', handoff_row.id, 'status', handoff_row.status, 'replayed', false);
END
$$;

REVOKE ALL ON FUNCTION public.crm_record_department_handoff_v1(
  uuid, uuid, text, text, text, uuid, text, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_department_handoff_v1(
  uuid, uuid, text, text, text, uuid, text, uuid, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.crm_department_for_stage(text) IS
  'Maps seller lifecycle stages to the accountable operating department; Marketing remains attribution, not seller-record ownership.';
COMMENT ON FUNCTION public.crm_record_department_handoff_v1(
  uuid, uuid, text, text, text, uuid, text, uuid, text, text, text, text, text
) IS 'Creates an evidence-backed pending department transfer that the receiving operator must explicitly accept.';
