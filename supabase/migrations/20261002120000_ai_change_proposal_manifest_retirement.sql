-- AI-proposed lead changes are governed against canonical typed columns only.
-- Manifest JSON remains historical compatibility data and is never mutated by
-- a new approval decision.

CREATE OR REPLACE FUNCTION public.decide_ai_change_proposal_v1(
  p_proposal_id uuid,
  p_decision text,
  p_decision_key text,
  p_decided_by text,
  p_note text DEFAULT NULL
)
RETURNS public.ai_change_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target public.ai_change_proposals;
  lead_row public.leads;
  field_name text;
  clean_actor text := trim(coalesce(p_decided_by, ''));
  clean_key text := trim(coalesce(p_decision_key, ''));
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid_ai_change_decision'; END IF;
  IF char_length(clean_key) NOT BETWEEN 8 AND 160 THEN RAISE EXCEPTION 'invalid_ai_change_decision_key'; END IF;
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_ai_change_actor'; END IF;
  IF clean_note IS NOT NULL AND char_length(clean_note) > 1000 THEN RAISE EXCEPTION 'invalid_ai_change_note'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-change-proposal:' || p_proposal_id::text, 0));
  SELECT * INTO target FROM public.ai_change_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_change_proposal_not_found'; END IF;

  IF target.status <> 'proposed' THEN
    IF target.decision_key = clean_key
      AND ((p_decision = 'approved' AND target.status = 'applied')
        OR (p_decision = 'approved' AND target.status = 'conflict')
        OR (p_decision = 'rejected' AND target.status = 'rejected'))
    THEN
      RETURN target;
    END IF;
    RAISE EXCEPTION 'ai_change_proposal_already_decided';
  END IF;

  IF p_decision = 'rejected' THEN
    UPDATE public.ai_change_proposals SET
      status = 'rejected', decision_key = clean_key, decided_by = clean_actor,
      decision_note = clean_note, decided_at = now(), updated_at = now()
    WHERE id = target.id RETURNING * INTO target;

    INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
    VALUES (target.entity_id, 'note', 'AI-proposed CRM changes rejected', clean_actor,
      jsonb_build_object('source', 'ai_change_proposal', 'proposal_id', target.id,
        'decision', 'rejected', 'decision_note', clean_note));
    RETURN target;
  END IF;

  FOR field_name IN SELECT jsonb_object_keys(target.proposed_changes) LOOP
    IF field_name NOT IN ('motivation_score', 'property_condition', 'asking_price', 'opportunity_score', 'classification') THEN
      RAISE EXCEPTION 'invalid_ai_change_field';
    END IF;
  END LOOP;

  SELECT * INTO lead_row FROM public.leads WHERE id = target.entity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ai_change_entity_not_found'; END IF;

  FOR field_name IN SELECT jsonb_object_keys(target.proposed_changes) LOOP
    IF (to_jsonb(lead_row) -> field_name) IS DISTINCT FROM (target.base_snapshot -> field_name) THEN
      UPDATE public.ai_change_proposals SET
        status = 'conflict', decision_key = clean_key, decided_by = clean_actor,
        decision_note = clean_note, decided_at = now(), error_code = 'lead_changed_since_proposal',
        updated_at = now()
      WHERE id = target.id RETURNING * INTO target;

      INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
      VALUES (target.entity_id, 'note', 'AI-proposed CRM changes not applied because the lead changed', clean_actor,
        jsonb_build_object('source', 'ai_change_proposal', 'proposal_id', target.id,
          'decision', 'conflict', 'conflicting_field', field_name));
      RETURN target;
    END IF;
  END LOOP;

  IF target.proposed_changes ? 'motivation_score'
    AND ((target.proposed_changes->>'motivation_score')::integer NOT BETWEEN 1 AND 10)
  THEN RAISE EXCEPTION 'invalid_ai_change_value'; END IF;
  IF target.proposed_changes ? 'opportunity_score'
    AND ((target.proposed_changes->>'opportunity_score')::integer NOT BETWEEN 0 AND 100)
  THEN RAISE EXCEPTION 'invalid_ai_change_value'; END IF;
  IF target.proposed_changes ? 'asking_price'
    AND ((target.proposed_changes->>'asking_price')::numeric <= 0 OR (target.proposed_changes->>'asking_price')::numeric > 100000000)
  THEN RAISE EXCEPTION 'invalid_ai_change_value'; END IF;
  IF target.proposed_changes ? 'classification'
    AND (target.proposed_changes->>'classification') NOT IN ('opportunity', 'lead')
  THEN RAISE EXCEPTION 'invalid_ai_change_value'; END IF;
  IF target.proposed_changes ? 'property_condition'
    AND (target.proposed_changes->>'property_condition') NOT IN ('excellent', 'good', 'fair', 'poor', 'uninhabitable')
  THEN RAISE EXCEPTION 'invalid_ai_change_value'; END IF;

  UPDATE public.leads SET
    motivation_score = CASE WHEN target.proposed_changes ? 'motivation_score' THEN (target.proposed_changes->>'motivation_score')::integer ELSE motivation_score END,
    property_condition = CASE WHEN target.proposed_changes ? 'property_condition' THEN target.proposed_changes->>'property_condition' ELSE property_condition END,
    asking_price = CASE WHEN target.proposed_changes ? 'asking_price' THEN (target.proposed_changes->>'asking_price')::numeric ELSE asking_price END,
    opportunity_score = CASE WHEN target.proposed_changes ? 'opportunity_score' THEN (target.proposed_changes->>'opportunity_score')::integer ELSE opportunity_score END,
    classification = CASE WHEN target.proposed_changes ? 'classification' THEN target.proposed_changes->>'classification' ELSE classification END,
    updated_at = now()
  WHERE id = target.entity_id;

  UPDATE public.ai_change_proposals SET
    status = 'applied', decision_key = clean_key, decided_by = clean_actor,
    decision_note = clean_note, decided_at = now(), applied_at = now(), error_code = NULL,
    updated_at = now()
  WHERE id = target.id RETURNING * INTO target;

  INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
  VALUES (target.entity_id, 'note', 'AI-proposed CRM changes reviewed and applied', clean_actor,
    jsonb_build_object('source', 'ai_change_proposal', 'proposal_id', target.id,
      'decision', 'approved', 'changes', target.proposed_changes, 'decision_note', clean_note));
  RETURN target;
END
$$;

REVOKE ALL ON FUNCTION public.decide_ai_change_proposal_v1(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_ai_change_proposal_v1(uuid,text,text,text,text)
  TO service_role;

COMMENT ON FUNCTION public.decide_ai_change_proposal_v1(uuid,text,text,text,text) IS
  'Reviews model-proposed changes and atomically applies approved values to canonical lead columns only.';
