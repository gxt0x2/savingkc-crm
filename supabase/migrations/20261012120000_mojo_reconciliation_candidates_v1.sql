-- Give the Mojo dry-run the same normalized, service-only identity resolver
-- used by canonical ingestion. This function is read-only and returns IDs only.

CREATE OR REPLACE FUNCTION public.resolve_mojo_reconciliation_candidates_v1(
  p_phones text[]
)
RETURNS TABLE (
  normalized_phone text,
  lead_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $$
BEGIN
  IF p_phones IS NULL OR cardinality(p_phones) > 5000 THEN
    RAISE EXCEPTION 'invalid_mojo_reconciliation_phone_set';
  END IF;

  RETURN QUERY
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT public.normalize_conversation_phone(value) AS phone
    FROM unnest(p_phones) AS value
    WHERE public.normalize_conversation_phone(value) IS NOT NULL
  ), candidates AS (
    SELECT requested.phone, lead.id
    FROM requested
    JOIN public.leads AS lead
      ON public.normalize_conversation_phone(lead.phone) = requested.phone
    UNION
    SELECT requested.phone, prospect.lead_id
    FROM requested
    JOIN public.prospect_phones AS prospect_phone
      ON public.normalize_conversation_phone(prospect_phone.phone) = requested.phone
    JOIN public.prospects AS prospect ON prospect.id = prospect_phone.prospect_id
    WHERE prospect.lead_id IS NOT NULL
  )
  SELECT candidates.phone, candidates.id
  FROM candidates
  ORDER BY candidates.phone, candidates.id;
END
$$;

REVOKE ALL ON FUNCTION public.resolve_mojo_reconciliation_candidates_v1(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_mojo_reconciliation_candidates_v1(text[])
  TO service_role;

COMMENT ON FUNCTION public.resolve_mojo_reconciliation_candidates_v1(text[]) IS
  'Read-only normalized identity candidates for bounded Mojo dry-run reconciliation; service role only.';
