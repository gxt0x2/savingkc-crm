-- Durable, canonical enrichment scheduling. Lead intake records work here;
-- provider I/O remains in the authenticated application worker.

CREATE TABLE IF NOT EXISTS public.crm_property_enrichment_jobs (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_property_enrichment_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_property_enrichment_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_property_enrichment_jobs TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_property_enrichment_jobs_claim
  ON public.crm_property_enrichment_jobs(available_at, created_at, lead_id)
  WHERE status IN ('pending', 'retry', 'processing');

CREATE OR REPLACE FUNCTION public.queue_crm_property_enrichment_for_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(NEW.is_parked, false)
    OR coalesce(NEW.source, '') LIKE 'tax_delinquent_%'
    OR (nullif(btrim(NEW.phone), '') IS NULL AND nullif(btrim(NEW.property_address), '') IS NULL) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND ROW(NEW.phone, NEW.property_address, NEW.city, NEW.state, NEW.zip, NEW.county, NEW.source, NEW.is_parked)
      IS NOT DISTINCT FROM
      ROW(OLD.phone, OLD.property_address, OLD.city, OLD.state, OLD.zip, OLD.county, OLD.source, OLD.is_parked) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.crm_property_enrichment_jobs(lead_id)
  VALUES (NEW.id)
  ON CONFLICT (lead_id) DO UPDATE SET
    revision = public.crm_property_enrichment_jobs.revision + 1,
    status = CASE
      WHEN public.crm_property_enrichment_jobs.status = 'processing'
        AND public.crm_property_enrichment_jobs.claimed_at >= now() - interval '15 minutes'
        THEN 'processing'
      ELSE 'pending'
    END,
    available_at = now(),
    attempts = 0,
    completed_at = NULL,
    last_error = NULL,
    updated_at = now();

  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.queue_crm_property_enrichment_for_lead_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_queue_crm_property_enrichment ON public.leads;
CREATE TRIGGER trigger_queue_crm_property_enrichment
AFTER INSERT OR UPDATE OF phone, property_address, city, state, zip, county, source, is_parked
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.queue_crm_property_enrichment_for_lead_v1();

CREATE OR REPLACE FUNCTION public.claim_crm_property_enrichment_jobs_v1(
  p_limit integer DEFAULT 3
)
RETURNS TABLE(lead_id uuid, revision bigint, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT job.lead_id
    FROM public.crm_property_enrichment_jobs AS job
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
  UPDATE public.crm_property_enrichment_jobs AS job SET
    status = 'processing',
    attempts = job.attempts + 1,
    claim_token = gen_random_uuid(),
    claimed_at = now(),
    updated_at = now()
  FROM candidates
  WHERE job.lead_id = candidates.lead_id
  RETURNING job.lead_id, job.revision, job.claim_token;
END
$$;
REVOKE ALL ON FUNCTION public.claim_crm_property_enrichment_jobs_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crm_property_enrichment_jobs_v1(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_crm_property_enrichment_job_v1(
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
  job public.crm_property_enrichment_jobs;
  next_status text;
BEGIN
  SELECT * INTO job
  FROM public.crm_property_enrichment_jobs
  WHERE lead_id = p_lead_id
  FOR UPDATE;

  IF job.lead_id IS NULL THEN RAISE EXCEPTION 'enrichment_job_not_found'; END IF;
  IF job.status <> 'processing' OR job.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'enrichment_job_claim_mismatch';
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

  UPDATE public.crm_property_enrichment_jobs SET
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
REVOKE ALL ON FUNCTION public.finish_crm_property_enrichment_job_v1(
  uuid, bigint, uuid, boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crm_property_enrichment_job_v1(
  uuid, bigint, uuid, boolean, text
) TO service_role;

COMMENT ON TABLE public.crm_property_enrichment_jobs IS
  'Durable provider-enrichment work requested by canonical lead intake changes.';
