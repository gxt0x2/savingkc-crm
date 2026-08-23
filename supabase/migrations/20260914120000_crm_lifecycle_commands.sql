-- Seller-to-Close V1: governed lifecycle and department handoff commands.
--
-- `leads` remains the compatibility write aggregate during this release. The
-- command below owns human lifecycle mutations, records an immutable event,
-- and creates a durable department handoff when responsibility changes.

CREATE TABLE IF NOT EXISTS public.crm_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL UNIQUE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL,
  command_type text NOT NULL CHECK (command_type IN ('transition', 'assign')),
  from_stage text,
  to_stage text,
  from_owner text,
  to_owner text,
  from_department text NOT NULL,
  to_department text NOT NULL,
  reason text,
  actor_email text NOT NULL,
  actor_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_department_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_event_id uuid NOT NULL UNIQUE REFERENCES public.crm_lifecycle_events(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL,
  from_department text NOT NULL,
  to_department text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'completed')),
  assigned_to text,
  reason text,
  created_by text NOT NULL,
  accepted_by text,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_department_handoffs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_lifecycle_events, public.crm_department_handoffs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_lifecycle_events, public.crm_department_handoffs
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_lifecycle_events_lead
  ON public.crm_lifecycle_events(lead_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_lifecycle_events_opportunity
  ON public.crm_lifecycle_events(opportunity_id, occurred_at DESC, id DESC)
  WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_department_handoffs_queue
  ON public.crm_department_handoffs(to_department, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_department_handoffs_lead
  ON public.crm_department_handoffs(lead_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.crm_department_for_stage(stage_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(coalesce(stage_value, 'new'))
    WHEN 'new' THEN 'marketing'
    WHEN 'intake' THEN 'marketing'
    WHEN 'not_contacted' THEN 'marketing'
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

CREATE OR REPLACE FUNCTION public.crm_apply_lifecycle_command_v1(
  target_lead_id uuid,
  target_command_id uuid,
  target_command_type text,
  target_stage text,
  target_classification text,
  target_priority text,
  target_owner text,
  target_dead_reason text,
  target_dead_reason_notes text,
  target_reason text,
  target_evidence_type text,
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
  updated_lead public.leads;
  event_row public.crm_lifecycle_events;
  opportunity_value uuid;
  from_department_value text;
  to_department_value text;
  next_stage text;
  next_owner text;
  now_value timestamptz := now();
BEGIN
  IF target_command_id IS NULL THEN RAISE EXCEPTION 'command_id_required'; END IF;
  IF target_command_type NOT IN ('transition', 'assign') THEN RAISE EXCEPTION 'unsupported_command'; END IF;
  IF nullif(trim(target_actor_email), '') IS NULL OR nullif(trim(target_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  SELECT * INTO event_row FROM public.crm_lifecycle_events WHERE command_id = target_command_id;
  IF FOUND THEN
    SELECT * INTO updated_lead FROM public.leads WHERE id = event_row.lead_id;
    RETURN jsonb_build_object(
      'eventId', event_row.id, 'leadId', event_row.lead_id,
      'stage', updated_lead.station, 'classification', updated_lead.classification,
      'priority', updated_lead.priority, 'owner', updated_lead.assigned_agent,
      'deadReason', updated_lead.dead_reason, 'fromStage', event_row.from_stage,
      'replayed', true
    );
  END IF;

  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;

  next_stage := CASE WHEN target_command_type = 'transition' THEN target_stage ELSE lead_row.station END;
  next_owner := CASE WHEN target_command_type = 'assign' THEN nullif(trim(target_owner), '') ELSE lead_row.assigned_agent END;
  IF target_command_type = 'transition' AND nullif(trim(next_stage), '') IS NULL THEN
    RAISE EXCEPTION 'stage_required';
  END IF;
  IF target_command_type = 'transition' AND next_stage = 'under_contract'
    AND target_evidence_type IS DISTINCT FROM 'seller_contract_signed' THEN
    RAISE EXCEPTION 'seller_contract_evidence_required';
  END IF;

  from_department_value := public.crm_department_for_stage(lead_row.station);
  to_department_value := public.crm_department_for_stage(next_stage);

  UPDATE public.leads SET
    station = next_stage,
    classification = CASE WHEN target_command_type = 'transition' THEN target_classification ELSE classification END,
    priority = CASE WHEN target_command_type = 'transition' THEN target_priority ELSE priority END,
    assigned_agent = next_owner,
    opportunity_score = CASE
      WHEN target_command_type = 'transition' AND target_classification = 'dead' THEN 0
      WHEN target_command_type = 'transition' AND target_classification IS NULL THEN 0
      ELSE opportunity_score
    END,
    dead_reason = CASE WHEN next_stage = 'dead' THEN target_dead_reason ELSE NULL END,
    dead_at = CASE WHEN next_stage = 'dead' THEN coalesce(dead_at, now_value) ELSE NULL END,
    dead_by = CASE WHEN next_stage = 'dead' THEN target_actor_name ELSE NULL END,
    updated_at = now_value
  WHERE id = target_lead_id
  RETURNING * INTO updated_lead;

  SELECT opportunity_id INTO opportunity_value
  FROM public.crm_lead_entity_links
  WHERE lead_id = target_lead_id;

  INSERT INTO public.crm_lifecycle_events(
    command_id, lead_id, opportunity_id, command_type,
    from_stage, to_stage, from_owner, to_owner,
    from_department, to_department, reason, actor_email, actor_name, metadata
  ) VALUES (
    target_command_id, target_lead_id, opportunity_value, target_command_type,
    lead_row.station, updated_lead.station, lead_row.assigned_agent, updated_lead.assigned_agent,
    from_department_value, to_department_value, nullif(trim(target_reason), ''),
    lower(trim(target_actor_email)), trim(target_actor_name),
    jsonb_strip_nulls(jsonb_build_object(
      'dead_reason', target_dead_reason,
      'dead_reason_notes', nullif(trim(target_dead_reason_notes), ''),
      'evidence_type', nullif(trim(target_evidence_type), ''),
      'evidence_reference', nullif(trim(target_evidence_reference), '')
    ))
  ) RETURNING * INTO event_row;

  INSERT INTO public.lead_activities(lead_id, activity_type, description, agent, metadata)
  VALUES (
    target_lead_id,
    CASE WHEN updated_lead.station = 'dead' THEN 'outcome' ELSE 'status_change' END,
    CASE
      WHEN target_command_type = 'assign' THEN 'Owner changed from ' || coalesce(lead_row.assigned_agent, 'Unassigned') || ' to ' || coalesce(updated_lead.assigned_agent, 'Unassigned')
      WHEN updated_lead.station = 'dead' THEN 'Marked not a lead — ' || coalesce(target_dead_reason, 'reason not recorded')
      ELSE 'Stage changed from ' || coalesce(lead_row.station, 'unassigned') || ' to ' || updated_lead.station
    END,
    trim(target_actor_name),
    jsonb_build_object(
      'source', 'crm_lifecycle_command_v1', 'command_id', target_command_id,
      'event_id', event_row.id, 'old_station', lead_row.station,
      'new_station', updated_lead.station, 'old_owner', lead_row.assigned_agent,
      'new_owner', updated_lead.assigned_agent, 'from_department', from_department_value,
      'to_department', to_department_value, 'dead_reason', target_dead_reason,
      'dead_reason_notes', nullif(trim(target_dead_reason_notes), '')
    )
  );

  IF from_department_value <> to_department_value THEN
    INSERT INTO public.crm_department_handoffs(
      lifecycle_event_id, lead_id, opportunity_id, from_department, to_department,
      assigned_to, reason, created_by
    ) VALUES (
      event_row.id, target_lead_id, opportunity_value, from_department_value,
      to_department_value, updated_lead.assigned_agent, nullif(trim(target_reason), ''),
      trim(target_actor_name)
    );
  END IF;

  RETURN jsonb_build_object(
    'eventId', event_row.id, 'leadId', target_lead_id,
    'stage', updated_lead.station, 'classification', updated_lead.classification,
    'priority', updated_lead.priority, 'owner', updated_lead.assigned_agent,
    'deadReason', updated_lead.dead_reason, 'fromStage', lead_row.station,
    'fromDepartment', from_department_value,
    'toDepartment', to_department_value, 'handoffCreated', from_department_value <> to_department_value,
    'replayed', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_apply_lifecycle_command_v1(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_lifecycle_command_v1(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) TO service_role;

COMMENT ON TABLE public.crm_lifecycle_events IS 'Immutable, idempotent record of governed human lifecycle and owner commands.';
COMMENT ON TABLE public.crm_department_handoffs IS 'Explicit responsibility transfers created when a lifecycle command crosses departments.';
