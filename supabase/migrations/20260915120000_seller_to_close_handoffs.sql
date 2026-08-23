-- Seller-to-Close V1: connect governed lifecycle events to the existing
-- Dispositions, TC, and Marketing outcome records without replacing them.

CREATE TABLE IF NOT EXISTS public.dispo_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  stage text NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new','marketing','offers_in','negotiating','under_contract','closed','dead')),
  entered_at timestamptz NOT NULL DEFAULT now(),
  assignment_fee numeric,
  close_date date,
  accepted_offer_id uuid,
  accepted_buyer_id uuid,
  notes text,
  closeout_status text NOT NULL DEFAULT 'not_started',
  closeout jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz,
  debrief_due_at timestamptz,
  debrief_completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dispo_deals
  ADD COLUMN IF NOT EXISTS closeout_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS closeout jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS debrief_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS debrief_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_dispo_deals_stage ON public.dispo_deals(stage);
CREATE INDEX IF NOT EXISTS idx_dispo_deals_lead ON public.dispo_deals(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispo_deals_one_per_lead
  ON public.dispo_deals(lead_id);

ALTER TABLE public.crm_lifecycle_events
  DROP CONSTRAINT IF EXISTS crm_lifecycle_events_command_type_check;
ALTER TABLE public.crm_lifecycle_events
  ADD CONSTRAINT crm_lifecycle_events_command_type_check
  CHECK (command_type IN ('transition', 'assign', 'handoff'));

ALTER TABLE public.crm_department_handoffs
  ADD COLUMN IF NOT EXISTS source_record_type text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS target_record_type text,
  ADD COLUMN IF NOT EXISTS target_record_id uuid,
  ADD COLUMN IF NOT EXISTS evidence_type text,
  ADD COLUMN IF NOT EXISTS evidence_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_department_handoffs_source
  ON public.crm_department_handoffs(from_department, to_department, source_record_type, source_record_id)
  WHERE source_record_type IS NOT NULL AND source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_marketing_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_key text NOT NULL UNIQUE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('closed_won', 'fell_through')),
  revenue numeric NOT NULL DEFAULT 0,
  lead_source text,
  acquisition_owner text,
  evidence_type text NOT NULL,
  evidence_id uuid,
  occurred_at timestamptz NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_marketing_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_marketing_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_marketing_outcomes TO service_role;
CREATE INDEX IF NOT EXISTS idx_crm_marketing_outcomes_period
  ON public.crm_marketing_outcomes(occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_marketing_outcomes_source
  ON public.crm_marketing_outcomes(lead_source, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.crm_materialize_dispositions_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deal_id uuid;
BEGIN
  IF NEW.to_department <> 'dispositions' THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dispo-deal-lead:' || NEW.lead_id::text, 0));

  SELECT id INTO deal_id
  FROM public.dispo_deals
  WHERE lead_id = NEW.lead_id
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  IF deal_id IS NULL THEN
    INSERT INTO public.dispo_deals(lead_id, stage, notes)
    VALUES (NEW.lead_id, 'new', 'Created from signed seller-contract handoff')
    RETURNING id INTO deal_id;
  END IF;

  UPDATE public.crm_department_handoffs SET
    source_record_type = coalesce(source_record_type, 'lifecycle_event'),
    source_record_id = coalesce(source_record_id, lifecycle_event_id),
    target_record_type = 'dispo_deal',
    target_record_id = deal_id,
    evidence_type = coalesce(evidence_type, 'seller_contract_signed'),
    updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.crm_materialize_dispositions_handoff() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trigger_crm_materialize_dispositions_handoff ON public.crm_department_handoffs;
CREATE TRIGGER trigger_crm_materialize_dispositions_handoff
AFTER INSERT ON public.crm_department_handoffs
FOR EACH ROW EXECUTE FUNCTION public.crm_materialize_dispositions_handoff();

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
    status, assigned_to, reason, created_by, accepted_by, accepted_at,
    source_record_type, source_record_id, target_record_type, target_record_id,
    evidence_type, evidence_reference
  ) VALUES (
    event_id, target_lead_id, opportunity_value, target_from_department, target_to_department,
    'accepted', lead_row.assigned_agent, target_reason, trim(target_actor_name), trim(target_actor_name), now(),
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

CREATE OR REPLACE FUNCTION public.crm_record_marketing_outcome_v1(
  target_outcome_key text,
  target_lead_id uuid,
  target_outcome text,
  target_revenue numeric,
  target_occurred_at timestamptz,
  target_evidence_type text,
  target_evidence_id uuid,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  opportunity_value uuid;
  outcome_row public.crm_marketing_outcomes;
BEGIN
  IF target_outcome NOT IN ('closed_won', 'fell_through') THEN RAISE EXCEPTION 'invalid_marketing_outcome'; END IF;
  IF target_evidence_type NOT IN ('funded_closeout', 'verified_fallout') THEN RAISE EXCEPTION 'invalid_outcome_evidence'; END IF;
  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  SELECT opportunity_id INTO opportunity_value FROM public.crm_lead_entity_links WHERE lead_id = target_lead_id;

  INSERT INTO public.crm_marketing_outcomes(
    outcome_key, lead_id, opportunity_id, outcome, revenue, lead_source,
    acquisition_owner, evidence_type, evidence_id, occurred_at, recorded_by
  ) VALUES (
    target_outcome_key, target_lead_id, opportunity_value, target_outcome,
    greatest(coalesce(target_revenue, 0), 0), lead_row.source, lead_row.assigned_agent,
    target_evidence_type, target_evidence_id, target_occurred_at, trim(target_actor_name)
  ) ON CONFLICT (outcome_key) DO UPDATE SET
    revenue = EXCLUDED.revenue,
    occurred_at = EXCLUDED.occurred_at,
    recorded_by = EXCLUDED.recorded_by,
    recorded_at = now()
  RETURNING * INTO outcome_row;

  RETURN jsonb_build_object('outcomeId', outcome_row.id, 'outcome', outcome_row.outcome, 'revenue', outcome_row.revenue);
END
$$;

REVOKE ALL ON FUNCTION public.crm_record_marketing_outcome_v1(text, uuid, text, numeric, timestamptz, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_record_marketing_outcome_v1(text, uuid, text, numeric, timestamptz, text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.crm_finalize_funded_close_v1(
  target_deal_id uuid,
  target_closeout jsonb,
  target_funded_at timestamptz,
  target_assignment_fee numeric,
  target_close_date date,
  target_debrief_due_at timestamptz,
  target_actor_email text,
  target_actor_name text,
  target_net_revenue numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deal_row public.dispo_deals;
  lifecycle_result jsonb;
  outcome_result jsonb;
BEGIN
  SELECT * INTO deal_row FROM public.dispo_deals WHERE id = target_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispo_deal_not_found'; END IF;

  SELECT public.crm_apply_lifecycle_command_v1(
    deal_row.lead_id, target_deal_id, 'transition', 'closed_won', 'opportunity', 'hot',
    NULL, NULL, NULL, 'Verified funded transaction closeout', 'funding_confirmed',
    target_deal_id::text, target_actor_email, target_actor_name
  ) INTO lifecycle_result;

  UPDATE public.dispo_deals SET
    stage = 'closed', assignment_fee = target_assignment_fee,
    close_date = target_close_date, closeout_status = 'awaiting_debrief',
    closeout = target_closeout, closed_at = target_funded_at,
    debrief_due_at = target_debrief_due_at, archived_at = NULL, updated_at = now()
  WHERE id = target_deal_id
  RETURNING * INTO deal_row;

  UPDATE public.tc_files SET status = 'closed', next_action = NULL, updated_at = now()
  WHERE dispo_deal_id = target_deal_id;

  SELECT public.crm_record_marketing_outcome_v1(
    'funded:' || target_deal_id::text, deal_row.lead_id, 'closed_won',
    target_net_revenue, target_funded_at, 'funded_closeout', target_deal_id, target_actor_name
  ) INTO outcome_result;

  RETURN jsonb_build_object(
    'deal', to_jsonb(deal_row), 'lifecycle', lifecycle_result, 'marketingOutcome', outcome_result
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_finalize_funded_close_v1(
  uuid, jsonb, timestamptz, numeric, date, timestamptz, text, text, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finalize_funded_close_v1(
  uuid, jsonb, timestamptz, numeric, date, timestamptz, text, text, numeric
) TO service_role;

COMMENT ON TABLE public.crm_marketing_outcomes IS 'Verified closed/fallout outcomes and revenue evidence returned to Marketing attribution.';
