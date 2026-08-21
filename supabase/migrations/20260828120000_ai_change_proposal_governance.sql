-- Human approval boundary for AI-proposed CRM mutations.
--
-- This first slice governs structured lead fields proposed from recorded call
-- analysis. Transcript and duration remain factual evidence; model output
-- cannot change these lead fields until the session owner explicitly approves.

CREATE TABLE IF NOT EXISTS public.ai_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('lead')),
  entity_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('call_analysis')),
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 160),
  dialer_session_attempt_id uuid REFERENCES public.dialer_session_attempts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'applied', 'rejected', 'conflict')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
  proposed_changes jsonb NOT NULL
    CHECK (jsonb_typeof(proposed_changes) = 'object'
      AND jsonb_array_length(jsonb_path_query_array(proposed_changes, '$.*')) BETWEEN 1 AND 5
      AND octet_length(proposed_changes::text) <= 10000),
  base_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(base_snapshot) = 'object'
      AND jsonb_array_length(jsonb_path_query_array(base_snapshot, '$.*')) BETWEEN 1 AND 5
      AND octet_length(base_snapshot::text) <= 10000),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 160),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 160),
  requested_by text NOT NULL DEFAULT 'system:recording_callback' CHECK (char_length(requested_by) BETWEEN 1 AND 160),
  decision_key text UNIQUE,
  decided_by text,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  decided_at timestamptz,
  applied_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  UNIQUE (dialer_session_attempt_id)
);

ALTER TABLE public.ai_change_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_change_proposals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_change_proposals TO service_role;

CREATE INDEX IF NOT EXISTS idx_ai_change_proposals_pending
  ON public.ai_change_proposals (created_at ASC, id ASC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_ai_change_proposals_entity_recent
  ON public.ai_change_proposals (entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_change_proposals_entity_pending
  ON public.ai_change_proposals (entity_type, entity_id, created_at DESC, id DESC)
  WHERE status = 'proposed';

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
  manifest_id uuid;
  manifest_row jsonb;
  subtrees jsonb := '{}'::jsonb;
  situation_row jsonb;
  motivation_row jsonb;
  price_row jsonb;
  property_row jsonb;
  condition_row jsonb;
  scoring_row jsonb;
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

  SELECT id, manifest INTO manifest_id, manifest_row
  FROM public.manifests WHERE lead_id = target.entity_id ORDER BY updated_at DESC, id DESC LIMIT 1 FOR UPDATE;

  IF manifest_id IS NOT NULL THEN
    IF target.proposed_changes ? 'motivation_score' OR target.proposed_changes ? 'asking_price' THEN
      situation_row := coalesce(manifest_row->'situation', '{}'::jsonb);
      IF target.proposed_changes ? 'motivation_score' THEN
        motivation_row := coalesce(situation_row->'motivation', '{}'::jsonb);
        motivation_row := jsonb_set(motivation_row, '{score}', target.proposed_changes->'motivation_score', true);
        situation_row := jsonb_set(situation_row, '{motivation}', motivation_row, true);
      END IF;
      IF target.proposed_changes ? 'asking_price' THEN
        price_row := coalesce(situation_row->'priceExpectations', '{}'::jsonb);
        price_row := jsonb_set(price_row, '{sellerAsking}', target.proposed_changes->'asking_price', true);
        situation_row := jsonb_set(situation_row, '{priceExpectations}', price_row, true);
      END IF;
      subtrees := subtrees || jsonb_build_object('situation', situation_row);
    END IF;

    IF target.proposed_changes ? 'property_condition' THEN
      property_row := coalesce(manifest_row->'property', '{}'::jsonb);
      condition_row := coalesce(property_row->'condition', '{}'::jsonb);
      condition_row := jsonb_set(condition_row, '{overall}', target.proposed_changes->'property_condition', true);
      property_row := jsonb_set(property_row, '{condition}', condition_row, true);
      subtrees := subtrees || jsonb_build_object('property', property_row);
    END IF;

    IF target.proposed_changes ? 'opportunity_score' OR target.proposed_changes ? 'classification' THEN
      scoring_row := coalesce(manifest_row->'scoring', '{}'::jsonb);
      IF target.proposed_changes ? 'opportunity_score' THEN
        scoring_row := jsonb_set(scoring_row, '{opportunity_score}', target.proposed_changes->'opportunity_score', true);
      END IF;
      IF target.proposed_changes ? 'classification' THEN
        scoring_row := jsonb_set(scoring_row, '{classification}', target.proposed_changes->'classification', true);
      END IF;
      subtrees := subtrees || jsonb_build_object('scoring', scoring_row);
    END IF;

    IF subtrees <> '{}'::jsonb THEN
      PERFORM public.update_manifest_and_cascade(
        manifest_id, subtrees, clean_actor, 'approved_ai_change_proposal:' || target.id::text
      );
    END IF;
  END IF;

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

COMMENT ON TABLE public.ai_change_proposals IS
  'Durable, service-role-only ledger for consequential AI-proposed CRM changes and explicit human decisions.';
