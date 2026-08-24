-- Human-owned four-pillar qualification. Legacy Manifest values are review hints,
-- never verified CRM facts and never sufficient to move a lead to Opportunity.

CREATE TABLE IF NOT EXISTS public.crm_lead_qualification_pillars (
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pillar text NOT NULL CHECK (pillar IN ('TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE')),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 2000),
  status text NOT NULL CHECK (status IN ('needs_review', 'verified')),
  source_type text NOT NULL CHECK (source_type IN ('operator', 'legacy_manifest', 'imported')),
  source_reference text,
  verified_by_email text,
  verified_by_name text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, pillar),
  CHECK (
    status <> 'verified'
    OR (verified_at IS NOT NULL AND nullif(btrim(verified_by_email), '') IS NOT NULL)
  )
);

ALTER TABLE public.crm_lead_qualification_pillars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_lead_qualification_pillars FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_lead_qualification_pillars TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_lead_qualification_status
  ON public.crm_lead_qualification_pillars (status, lead_id);

CREATE OR REPLACE FUNCTION public.set_crm_lead_qualification_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.set_crm_lead_qualification_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_crm_lead_qualification_updated_at
  ON public.crm_lead_qualification_pillars;
CREATE TRIGGER set_crm_lead_qualification_updated_at
BEFORE UPDATE ON public.crm_lead_qualification_pillars
FOR EACH ROW EXECUTE FUNCTION public.set_crm_lead_qualification_updated_at();

-- Preserve useful legacy material as explicitly unverified review hints. An
-- operator must review and save each pillar before qualification can pass.
WITH latest_manifest AS (
  SELECT DISTINCT ON (lead_id)
    id,
    lead_id,
    manifest
  FROM public.manifests
  WHERE lead_id IS NOT NULL
  ORDER BY lead_id, created_at DESC, id DESC
), legacy_evidence AS (
  SELECT
    source.lead_id,
    source.id::text AS source_reference,
    evidence.pillar,
    left(btrim(evidence.evidence), 2000) AS evidence
  FROM latest_manifest AS source
  CROSS JOIN LATERAL (
    VALUES
      ('TIMELINE', concat_ws(' · ',
        nullif(source.manifest #>> '{situation,timeline,preferredClosing}', ''),
        nullif(source.manifest #>> '{situation,timeline,targetCloseDate}', ''),
        nullif(source.manifest #>> '{situation,timeline,sellerDeadline}', ''),
        nullif(source.manifest #>> '{situation,timeline,urgency}', ''),
        nullif(source.manifest #>> '{situation,timeline,flexibility}', '')
      )),
      ('CONDITION', concat_ws(' · ',
        nullif(source.manifest #>> '{property,condition,overall}', ''),
        nullif(source.manifest #>> '{property,condition,notes}', ''),
        nullif(source.manifest #>> '{property,occupancy}', ''),
        CASE WHEN source.manifest #>> '{property,vacant}' = 'true' THEN 'Vacant' END
      )),
      ('MOTIVATION', concat_ws(' · ',
        nullif(source.manifest #>> '{situation,motivation,primary}', ''),
        nullif(source.manifest #>> '{situation,motivation,score}', ''),
        nullif(source.manifest #>> '{situation,motivation,urgencyLevel}', ''),
        nullif(source.manifest #>> '{situation,motivation,signals}', '')
      )),
      ('PRICE', concat_ws(' · ',
        nullif(source.manifest #>> '{situation,priceExpectations,askingPrice}', ''),
        nullif(source.manifest #>> '{situation,priceExpectations,minimumAcceptable}', ''),
        nullif(source.manifest #>> '{situation,priceExpectations,sellerAsking}', ''),
        nullif(source.manifest #>> '{situation,priceExpectations,sellerFloor}', ''),
        nullif(source.manifest #>> '{situation,priceExpectations,priceFlexibility}', ''),
        nullif(source.manifest #>> '{financials,asking_price}', ''),
        nullif(source.manifest #>> '{deal,offerRange}', '')
      ))
  ) AS evidence(pillar, evidence)
  WHERE nullif(btrim(evidence.evidence), '') IS NOT NULL
)
INSERT INTO public.crm_lead_qualification_pillars (
  lead_id,
  pillar,
  evidence,
  status,
  source_type,
  source_reference
)
SELECT
  lead_id,
  pillar,
  evidence,
  'needs_review',
  'legacy_manifest',
  source_reference
FROM legacy_evidence
ON CONFLICT (lead_id, pillar) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_crm_lead_qualification_v1(
  p_lead_id uuid,
  p_pillars jsonb,
  p_actor_email text,
  p_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_pillar text;
  target_evidence text;
  saved_pillars text[] := ARRAY[]::text[];
  verified_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'lead not found';
  END IF;
  IF jsonb_typeof(p_pillars) <> 'object' THEN
    RAISE EXCEPTION 'pillars must be an object';
  END IF;
  IF nullif(btrim(p_actor_email), '') IS NULL OR nullif(btrim(p_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'verified actor required';
  END IF;

  FOREACH target_pillar IN ARRAY ARRAY['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE']
  LOOP
    target_evidence := btrim(p_pillars ->> target_pillar);
    IF nullif(target_evidence, '') IS NULL THEN
      CONTINUE;
    END IF;
    IF length(target_evidence) > 2000 THEN
      RAISE EXCEPTION '% evidence exceeds 2000 characters', target_pillar;
    END IF;

    INSERT INTO public.crm_lead_qualification_pillars (
      lead_id,
      pillar,
      evidence,
      status,
      source_type,
      source_reference,
      verified_by_email,
      verified_by_name,
      verified_at
    ) VALUES (
      p_lead_id,
      target_pillar,
      target_evidence,
      'verified',
      'operator',
      NULL,
      lower(btrim(p_actor_email)),
      btrim(p_actor_name),
      now()
    )
    ON CONFLICT (lead_id, pillar) DO UPDATE SET
      evidence = EXCLUDED.evidence,
      status = EXCLUDED.status,
      source_type = EXCLUDED.source_type,
      source_reference = NULL,
      verified_by_email = EXCLUDED.verified_by_email,
      verified_by_name = EXCLUDED.verified_by_name,
      verified_at = EXCLUDED.verified_at;

    saved_pillars := array_append(saved_pillars, target_pillar);
  END LOOP;

  IF cardinality(saved_pillars) = 0 THEN
    RAISE EXCEPTION 'at least one pillar is required';
  END IF;

  INSERT INTO public.lead_activities (
    lead_id,
    activity_type,
    description,
    agent,
    metadata
  ) VALUES (
    p_lead_id,
    'qualification',
    'Qualification evidence verified',
    btrim(p_actor_name),
    jsonb_build_object(
      'source', 'canonical_qualification_v1',
      'pillars', to_jsonb(saved_pillars),
      'verified_by_email', lower(btrim(p_actor_email))
    )
  );

  SELECT count(*) INTO verified_count
  FROM public.crm_lead_qualification_pillars
  WHERE lead_id = p_lead_id AND status = 'verified';

  RETURN jsonb_build_object(
    'leadId', p_lead_id,
    'savedPillars', to_jsonb(saved_pillars),
    'complete', verified_count = 4
  );
END
$$;

REVOKE ALL ON FUNCTION public.save_crm_lead_qualification_v1(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_lead_qualification_v1(uuid, jsonb, text, text)
  TO service_role;

COMMENT ON TABLE public.crm_lead_qualification_pillars IS
  'Human-owned Timeline, Condition, Motivation, and Price evidence. Legacy hints never qualify a lead.';
