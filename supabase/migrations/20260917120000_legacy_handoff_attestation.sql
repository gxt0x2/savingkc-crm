-- Seller-to-Close V4: explicit operator attestation for legacy handoff evidence.

ALTER TABLE public.crm_department_handoffs
  ADD COLUMN IF NOT EXISTS evidence_occurred_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_attest_legacy_handoff_v1(
  target_kind text,
  target_lead_id uuid,
  target_record_id uuid,
  target_candidate_id uuid,
  target_evidence_reference text,
  target_evidence_occurred_at timestamptz,
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
  file_row public.tc_files;
  offer_row public.buyer_offers;
  result jsonb;
  handoff_id uuid;
BEGIN
  IF target_kind NOT IN ('seller_handoff', 'assignment_handoff') THEN RAISE EXCEPTION 'invalid_legacy_handoff_kind'; END IF;
  IF nullif(trim(target_evidence_reference), '') IS NULL THEN RAISE EXCEPTION 'legacy_handoff_evidence_required'; END IF;
  IF target_evidence_occurred_at IS NULL OR target_evidence_occurred_at > now() + interval '5 minutes' OR target_evidence_occurred_at < timestamptz '2000-01-01' THEN
    RAISE EXCEPTION 'invalid_legacy_handoff_evidence_date';
  END IF;
  IF nullif(trim(target_actor_email), '') IS NULL OR nullif(trim(target_actor_name), '') IS NULL THEN RAISE EXCEPTION 'actor_required'; END IF;

  IF target_kind = 'seller_handoff' THEN
    SELECT * INTO deal_row FROM public.dispo_deals WHERE id = target_record_id AND lead_id = target_lead_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy_dispo_deal_not_found'; END IF;

    SELECT public.crm_record_department_handoff_v1(
      gen_random_uuid(), target_lead_id, 'acquisitions', 'dispositions',
      'legacy_dispo_deal', deal_row.id, 'dispo_deal', deal_row.id,
      'legacy_seller_contract_verified', trim(target_evidence_reference),
      target_actor_email, target_actor_name,
      'Legacy seller contract reviewed and verified by operator'
    ) INTO result;
  ELSE
    IF target_candidate_id IS NULL THEN RAISE EXCEPTION 'buyer_offer_required'; END IF;
    SELECT * INTO file_row FROM public.tc_files WHERE id = target_record_id AND lead_id = target_lead_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy_tc_file_not_found'; END IF;
    SELECT * INTO offer_row FROM public.buyer_offers WHERE id = target_candidate_id AND lead_id = target_lead_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy_buyer_offer_not_found'; END IF;

    UPDATE public.tc_files
    SET buyer_offer_id = offer_row.id, updated_at = now()
    WHERE id = file_row.id AND (buyer_offer_id IS NULL OR buyer_offer_id = offer_row.id);
    IF NOT FOUND THEN RAISE EXCEPTION 'tc_file_offer_mismatch'; END IF;

    UPDATE public.buyer_offers
    SET assignment_signed_at = coalesce(assignment_signed_at, target_evidence_occurred_at), updated_at = now()
    WHERE id = offer_row.id;

    SELECT public.crm_record_department_handoff_v1(
      gen_random_uuid(), target_lead_id, 'dispositions', 'transaction_coordination',
      'buyer_offer', offer_row.id, 'tc_file', file_row.id,
      'legacy_assignment_verified', trim(target_evidence_reference),
      target_actor_email, target_actor_name,
      'Legacy executed buyer assignment reviewed and verified by operator'
    ) INTO result;
  END IF;

  handoff_id := (result ->> 'handoffId')::uuid;
  UPDATE public.crm_department_handoffs
  SET evidence_occurred_at = coalesce(evidence_occurred_at, target_evidence_occurred_at),
      evidence_reference = coalesce(nullif(evidence_reference, ''), trim(target_evidence_reference)),
      updated_at = now()
  WHERE id = handoff_id;

  IF coalesce((result ->> 'replayed')::boolean, false) = false THEN
    INSERT INTO public.lead_activities(lead_id, activity_type, description, agent, metadata)
    VALUES (
      target_lead_id, 'status_change',
      CASE WHEN target_kind = 'seller_handoff'
        THEN 'Legacy signed seller-contract handoff verified by ' || trim(target_actor_name)
        ELSE 'Legacy executed buyer-assignment handoff verified by ' || trim(target_actor_name)
      END,
      trim(target_actor_name),
      jsonb_build_object(
        'source', 'crm_legacy_handoff_attestation_v1', 'handoff_id', handoff_id,
        'kind', target_kind, 'record_id', target_record_id,
        'candidate_id', target_candidate_id, 'evidence_reference', trim(target_evidence_reference),
        'evidence_occurred_at', target_evidence_occurred_at,
        'actor_email', lower(trim(target_actor_email))
      )
    );
  END IF;

  RETURN result || jsonb_build_object('evidenceOccurredAt', target_evidence_occurred_at);
END
$$;

REVOKE ALL ON FUNCTION public.crm_attest_legacy_handoff_v1(text, uuid, uuid, uuid, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_attest_legacy_handoff_v1(text, uuid, uuid, uuid, text, timestamptz, text, text)
  TO service_role;

COMMENT ON FUNCTION public.crm_attest_legacy_handoff_v1(text, uuid, uuid, uuid, text, timestamptz, text, text)
  IS 'Records an actor-attributed legacy handoff only after explicit evidence reference and occurrence date are supplied.';
