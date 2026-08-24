-- Canonical, governed lead briefings. CRM events request durable work; the
-- application worker builds bounded evidence and records every model call in
-- assistant_generations. Historical compatibility data remains untouched.

ALTER TABLE public.briefings
  ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES public.assistant_generations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS input_fingerprint text,
  ADD COLUMN IF NOT EXISTS source_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_revision bigint CHECK (source_revision IS NULL OR source_revision > 0);

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.briefings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.briefings TO service_role;

-- Old dual writes could leave more than one current row. Preserve every row
-- while making the newest record the sole current briefing.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY lead_id ORDER BY generated_at DESC, created_at DESC, id DESC
  ) AS row_number
  FROM public.briefings
  WHERE is_current
)
UPDATE public.briefings AS briefing
SET is_current = false
FROM ranked
WHERE briefing.id = ranked.id AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_briefings_one_current_per_lead
  ON public.briefings(lead_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_briefings_generation
  ON public.briefings(generation_id) WHERE generation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_briefing_jobs (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'failed')),
  reason text NOT NULL DEFAULT 'crm_changed',
  requested_by text NOT NULL DEFAULT 'system:crm',
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_briefing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_briefing_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_briefing_jobs TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_briefing_jobs_claim
  ON public.crm_briefing_jobs(available_at, created_at, lead_id)
  WHERE status IN ('pending', 'retry', 'processing');

CREATE OR REPLACE FUNCTION public.queue_crm_briefing_v1(
  p_lead_id uuid,
  p_reason text DEFAULT 'crm_changed',
  p_requested_by text DEFAULT 'system:crm',
  p_delay_seconds integer DEFAULT 60
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_revision bigint;
  reason_value text := left(coalesce(nullif(btrim(p_reason), ''), 'crm_changed'), 120);
  actor_value text := left(coalesce(nullif(btrim(p_requested_by), ''), 'system:crm'), 160);
  delay_value integer := greatest(0, least(coalesce(p_delay_seconds, 60), 3600));
BEGIN
  IF p_lead_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'briefing_lead_not_found';
  END IF;

  INSERT INTO public.crm_briefing_jobs(
    lead_id, reason, requested_by, available_at
  ) VALUES (
    p_lead_id, reason_value, actor_value, now() + make_interval(secs => delay_value)
  )
  ON CONFLICT (lead_id) DO UPDATE SET
    revision = public.crm_briefing_jobs.revision + 1,
    status = CASE
      WHEN public.crm_briefing_jobs.status = 'processing'
        AND public.crm_briefing_jobs.claimed_at >= now() - interval '15 minutes'
        THEN 'processing'
      ELSE 'pending'
    END,
    reason = reason_value,
    requested_by = actor_value,
    available_at = now() + make_interval(secs => delay_value),
    attempts = 0,
    completed_at = NULL,
    last_error = NULL,
    updated_at = now()
  RETURNING revision INTO next_revision;

  RETURN next_revision;
END
$$;
REVOKE ALL ON FUNCTION public.queue_crm_briefing_v1(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_crm_briefing_v1(uuid,text,text,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_crm_briefing_jobs_v1(
  p_limit integer DEFAULT 3
)
RETURNS TABLE(
  lead_id uuid,
  revision bigint,
  claim_token uuid,
  reason text,
  requested_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT job.lead_id
    FROM public.crm_briefing_jobs AS job
    WHERE job.attempts < 5
      AND job.available_at <= now()
      AND (
        job.status IN ('pending', 'retry')
        OR (job.status = 'processing' AND job.claimed_at < now() - interval '15 minutes')
      )
    ORDER BY job.available_at, job.created_at, job.lead_id
    LIMIT greatest(1, least(coalesce(p_limit, 3), 5))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.crm_briefing_jobs AS job SET
    status = 'processing',
    attempts = job.attempts + 1,
    claim_token = gen_random_uuid(),
    claimed_at = now(),
    updated_at = now()
  FROM candidates
  WHERE job.lead_id = candidates.lead_id
  RETURNING job.lead_id, job.revision, job.claim_token, job.reason, job.requested_by;
END
$$;
REVOKE ALL ON FUNCTION public.claim_crm_briefing_jobs_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_briefing_jobs_v1(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_crm_briefing_job_v1(
  p_lead_id uuid,
  p_revision bigint,
  p_claim_token uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job public.crm_briefing_jobs;
  next_status text;
BEGIN
  SELECT * INTO job
  FROM public.crm_briefing_jobs
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF job.lead_id IS NULL THEN RAISE EXCEPTION 'briefing_job_not_found'; END IF;
  IF job.status <> 'processing' OR job.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'briefing_job_claim_mismatch';
  END IF;

  IF job.revision <> p_revision THEN
    next_status := 'pending';
  ELSIF p_success THEN
    next_status := 'completed';
  ELSIF job.attempts >= 5 THEN
    next_status := 'failed';
  ELSE
    next_status := 'retry';
  END IF;

  UPDATE public.crm_briefing_jobs SET
    status = next_status,
    available_at = CASE
      WHEN next_status = 'retry' THEN now() + make_interval(mins => least(60, power(2, greatest(job.attempts, 1))::integer))
      ELSE now()
    END,
    claim_token = NULL,
    claimed_at = NULL,
    completed_at = CASE WHEN next_status = 'completed' THEN now() ELSE NULL END,
    last_error = CASE WHEN next_status IN ('retry', 'failed') THEN left(coalesce(p_error, 'unknown_error'), 1000) ELSE NULL END,
    updated_at = now()
  WHERE lead_id = p_lead_id;

  RETURN next_status;
END
$$;
REVOKE ALL ON FUNCTION public.finish_crm_briefing_job_v1(uuid,bigint,uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crm_briefing_job_v1(uuid,bigint,uuid,boolean,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.save_current_briefing_v1(
  p_lead_id uuid,
  p_situation text,
  p_motivation text,
  p_strategy text,
  p_generated_by text,
  p_generated_from jsonb,
  p_generation_id uuid,
  p_prompt_version text,
  p_input_fingerprint text,
  p_source_snapshot_at timestamptz,
  p_source_revision bigint
)
RETURNS public.briefings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  saved public.briefings;
BEGIN
  IF p_lead_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
    RAISE EXCEPTION 'briefing_lead_not_found';
  END IF;
  IF nullif(btrim(p_situation), '') IS NULL
    OR nullif(btrim(p_motivation), '') IS NULL
    OR nullif(btrim(p_strategy), '') IS NULL THEN
    RAISE EXCEPTION 'briefing_content_required';
  END IF;
  IF length(p_situation) > 2000 OR length(p_motivation) > 2000 OR length(p_strategy) > 3000 THEN
    RAISE EXCEPTION 'briefing_content_too_long';
  END IF;
  IF p_generation_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.assistant_generations
    WHERE id = p_generation_id AND status = 'complete'
  ) THEN
    RAISE EXCEPTION 'briefing_generation_not_complete';
  END IF;
  IF jsonb_typeof(coalesce(p_generated_from, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_briefing_sources';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-briefing:' || p_lead_id::text, 0)
  );

  UPDATE public.briefings
  SET is_current = false
  WHERE lead_id = p_lead_id AND is_current;

  INSERT INTO public.briefings(
    lead_id, situation, motivation, strategy, generated_at, generated_by,
    generated_from, is_current, generation_id, prompt_version,
    input_fingerprint, source_snapshot_at, source_revision
  ) VALUES (
    p_lead_id, btrim(p_situation), btrim(p_motivation), btrim(p_strategy), now(),
    left(coalesce(nullif(btrim(p_generated_by), ''), 'system:ari'), 160),
    coalesce(p_generated_from, '{}'::jsonb), true, p_generation_id,
    left(nullif(btrim(p_prompt_version), ''), 160),
    left(nullif(btrim(p_input_fingerprint), ''), 128),
    p_source_snapshot_at, p_source_revision
  )
  RETURNING * INTO saved;

  RETURN saved;
END
$$;
REVOKE ALL ON FUNCTION public.save_current_briefing_v1(
  uuid,text,text,text,text,jsonb,uuid,text,text,timestamptz,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_current_briefing_v1(
  uuid,text,text,text,text,jsonb,uuid,text,text,timestamptz,bigint
) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_briefing_from_lead_change_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.queue_crm_briefing_v1(NEW.id, 'lead_changed', 'system:lead_trigger', 60);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.queue_briefing_from_lead_change_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_lead ON public.leads;
CREATE TRIGGER trigger_queue_briefing_from_lead
AFTER INSERT OR UPDATE OF full_name, property_address, city, state, zip, county,
  source, station, priority, notes, assigned_agent, classification,
  opportunity_score, motivation_score, seller_situation, arv, repair_estimate,
  offer_amount, assignment_fee, property_condition, asking_price
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_change_v1();

CREATE OR REPLACE FUNCTION public.queue_briefing_from_activity_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  activity_lead_id uuid := coalesce(NEW.lead_id, OLD.lead_id);
  activity_type_value text := lower(coalesce(NEW.activity_type, OLD.activity_type, ''));
BEGIN
  IF activity_lead_id IS NOT NULL AND activity_type_value IN (
    'call', 'sms', 'email', 'voicemail', 'missed_call', 'note', 'task',
    'appointment', 'follow_up', 'callback', 'send_offer', 'status_change',
    'contract_sent', 'offer', 'lead_status', 'phone_status'
  ) THEN
    PERFORM public.queue_crm_briefing_v1(activity_lead_id, 'activity_changed', 'system:activity_trigger', 60);
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.queue_briefing_from_activity_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_activity ON public.lead_activities;
CREATE TRIGGER trigger_queue_briefing_from_activity
AFTER INSERT OR DELETE OR UPDATE OF lead_id, activity_type, description, metadata
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_activity_v1();

CREATE OR REPLACE FUNCTION public.queue_briefing_from_lead_child_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  child_lead_id uuid := coalesce(NEW.lead_id, OLD.lead_id);
BEGIN
  IF child_lead_id IS NOT NULL THEN
    PERFORM public.queue_crm_briefing_v1(child_lead_id, TG_TABLE_NAME || '_changed', 'system:' || TG_TABLE_NAME || '_trigger', 60);
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.queue_briefing_from_lead_child_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_appointment ON public.appointments;
CREATE TRIGGER trigger_queue_briefing_from_appointment
AFTER INSERT OR UPDATE OR DELETE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_child_v1();

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_co_owner ON public.lead_co_owners;
CREATE TRIGGER trigger_queue_briefing_from_co_owner
AFTER INSERT OR UPDATE OR DELETE ON public.lead_co_owners
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_child_v1();

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_buyer_offer ON public.buyer_offers;
CREATE TRIGGER trigger_queue_briefing_from_buyer_offer
AFTER INSERT OR UPDATE OR DELETE ON public.buyer_offers
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_child_v1();

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_disposition ON public.dispo_deals;
CREATE TRIGGER trigger_queue_briefing_from_disposition
AFTER INSERT OR UPDATE OR DELETE ON public.dispo_deals
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_child_v1();

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_tc_file ON public.tc_files;
CREATE TRIGGER trigger_queue_briefing_from_tc_file
AFTER INSERT OR UPDATE OR DELETE ON public.tc_files
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_child_v1();

CREATE OR REPLACE FUNCTION public.queue_briefing_from_property_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  property_id_value uuid := coalesce(NEW.id, OLD.id);
  linked_lead_id uuid;
BEGIN
  FOR linked_lead_id IN
    SELECT link.lead_id FROM public.crm_lead_entity_links AS link
    WHERE link.property_id = property_id_value ORDER BY link.lead_id
  LOOP
    PERFORM public.queue_crm_briefing_v1(linked_lead_id, 'property_changed', 'system:property_trigger', 60);
  END LOOP;
  RETURN coalesce(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.queue_briefing_from_property_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_property ON public.crm_properties;
CREATE TRIGGER trigger_queue_briefing_from_property
AFTER UPDATE ON public.crm_properties
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_property_v1();

CREATE OR REPLACE FUNCTION public.queue_briefing_from_opportunity_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  opportunity_lead_id uuid := coalesce(NEW.source_lead_id, OLD.source_lead_id);
BEGIN
  IF opportunity_lead_id IS NOT NULL THEN
    PERFORM public.queue_crm_briefing_v1(opportunity_lead_id, 'opportunity_changed', 'system:opportunity_trigger', 60);
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.queue_briefing_from_opportunity_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_briefing_from_opportunity ON public.crm_opportunities;
CREATE TRIGGER trigger_queue_briefing_from_opportunity
AFTER UPDATE ON public.crm_opportunities
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_opportunity_v1();

COMMENT ON TABLE public.crm_briefing_jobs IS
  'Durable, revision-safe canonical lead briefing requests. No provider I/O occurs in database triggers.';
COMMENT ON FUNCTION public.save_current_briefing_v1(
  uuid,text,text,text,text,jsonb,uuid,text,text,timestamptz,bigint
) IS 'Atomically installs one current briefing backed by a completed governed AI generation.';
