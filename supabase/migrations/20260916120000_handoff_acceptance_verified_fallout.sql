-- Seller-to-Close V2: operator acceptance and verified fallout.

CREATE OR REPLACE FUNCTION public.crm_accept_department_handoff_v1(
  target_handoff_id uuid,
  target_actor_email text,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  handoff_row public.crm_department_handoffs;
BEGIN
  IF nullif(trim(target_actor_email), '') IS NULL OR nullif(trim(target_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  SELECT * INTO handoff_row
  FROM public.crm_department_handoffs
  WHERE id = target_handoff_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'handoff_not_found'; END IF;
  IF handoff_row.status = 'accepted' THEN
    RETURN jsonb_build_object('handoffId', handoff_row.id, 'status', handoff_row.status, 'replayed', true);
  END IF;
  IF handoff_row.status <> 'pending' THEN RAISE EXCEPTION 'handoff_not_pending'; END IF;

  UPDATE public.crm_department_handoffs SET
    status = 'accepted',
    accepted_by = trim(target_actor_name),
    accepted_at = now(),
    updated_at = now()
  WHERE id = target_handoff_id
  RETURNING * INTO handoff_row;

  INSERT INTO public.lead_activities(lead_id, activity_type, description, agent, metadata)
  VALUES (
    handoff_row.lead_id, 'status_change',
    'Department handoff accepted by ' || trim(target_actor_name), trim(target_actor_name),
    jsonb_build_object(
      'source', 'crm_department_handoff_v1', 'handoff_id', handoff_row.id,
      'from_department', handoff_row.from_department, 'to_department', handoff_row.to_department,
      'status', 'accepted', 'actor_email', lower(trim(target_actor_email))
    )
  );

  RETURN jsonb_build_object('handoffId', handoff_row.id, 'status', handoff_row.status, 'replayed', false);
END
$$;

REVOKE ALL ON FUNCTION public.crm_accept_department_handoff_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_accept_department_handoff_v1(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.crm_finalize_verified_fallout_v1(
  target_deal_id uuid,
  target_reason text,
  target_notes text,
  target_evidence_reference text,
  target_occurred_at timestamptz,
  target_actor_email text,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deal_row public.dispo_deals;
  lead_row public.leads;
  lifecycle_result jsonb;
  outcome_result jsonb;
  allowed_reasons constant text[] := ARRAY[
    'seller_cancelled', 'buyer_default', 'title_issue',
    'inspection_issue', 'financing_failed', 'other'
  ];
BEGIN
  IF target_reason IS NULL OR NOT (target_reason = ANY(allowed_reasons)) THEN RAISE EXCEPTION 'invalid_fallout_reason'; END IF;
  IF nullif(trim(target_notes), '') IS NULL THEN RAISE EXCEPTION 'fallout_notes_required'; END IF;
  IF nullif(trim(target_evidence_reference), '') IS NULL THEN RAISE EXCEPTION 'fallout_evidence_required'; END IF;

  SELECT * INTO deal_row FROM public.dispo_deals WHERE id = target_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispo_deal_not_found'; END IF;
  IF deal_row.stage = 'closed' THEN RAISE EXCEPTION 'funded_deal_cannot_fall_out'; END IF;
  SELECT * INTO lead_row FROM public.leads WHERE id = deal_row.lead_id FOR UPDATE;

  SELECT public.crm_apply_lifecycle_command_v1(
    deal_row.lead_id, target_deal_id, 'transition', 'closed_lost', 'dead',
    coalesce(lead_row.priority, 'normal'), NULL, NULL, NULL,
    'Verified transaction fallout: ' || target_reason, 'verified_fallout',
    trim(target_evidence_reference), target_actor_email, target_actor_name
  ) INTO lifecycle_result;

  UPDATE public.dispo_deals SET
    stage = 'dead',
    closeout_status = 'complete',
    closeout = coalesce(closeout, '{}'::jsonb) || jsonb_build_object(
      'version', 1,
      'fallout', jsonb_build_object(
        'reason', target_reason,
        'notes', trim(target_notes),
        'evidenceReference', trim(target_evidence_reference),
        'occurredAt', target_occurred_at,
        'recordedBy', trim(target_actor_name),
        'recordedAt', now()
      )
    ),
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
  WHERE id = target_deal_id
  RETURNING * INTO deal_row;

  UPDATE public.tc_files SET
    status = 'cancelled',
    next_action = NULL,
    risk_level = 'normal',
    risk_reason = NULL,
    updated_at = now()
  WHERE dispo_deal_id = target_deal_id AND status <> 'closed';

  UPDATE public.deal_pages SET is_active = false, updated_at = now()
  WHERE lead_id = deal_row.lead_id AND is_active = true;

  SELECT public.crm_record_marketing_outcome_v1(
    'fallout:' || target_deal_id::text, deal_row.lead_id, 'fell_through', 0,
    target_occurred_at, 'verified_fallout', target_deal_id, target_actor_name
  ) INTO outcome_result;

  RETURN jsonb_build_object(
    'deal', to_jsonb(deal_row), 'lifecycle', lifecycle_result, 'marketingOutcome', outcome_result
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_finalize_verified_fallout_v1(
  uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finalize_verified_fallout_v1(
  uuid, text, text, text, timestamptz, text, text
) TO service_role;

-- Preserve the current owner/priority when a funded close reaches the canonical lifecycle.
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
  lead_row public.leads;
  lifecycle_result jsonb;
  outcome_result jsonb;
BEGIN
  SELECT * INTO deal_row FROM public.dispo_deals WHERE id = target_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispo_deal_not_found'; END IF;
  SELECT * INTO lead_row FROM public.leads WHERE id = deal_row.lead_id FOR UPDATE;

  SELECT public.crm_apply_lifecycle_command_v1(
    deal_row.lead_id, target_deal_id, 'transition', 'closed_won', 'opportunity',
    coalesce(lead_row.priority, 'normal'), NULL, NULL, NULL,
    'Verified funded transaction closeout', 'funding_confirmed',
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
