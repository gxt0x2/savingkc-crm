-- Source capture is separate from qualification. No historical CRM rows change.
CREATE TABLE public.mojo_source_batches (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  runtime_version text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  accepted_at timestamptz,
  last_error text,
  accepted_runtime_digest text,
  accepted_runtime_revision text,
  record_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX mojo_source_batches_pending_idx ON public.mojo_source_batches(created_at)
  WHERE accepted_at IS NULL;
ALTER TABLE public.mojo_source_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mojo_source_batches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mojo_source_batches TO service_role;
GRANT UPDATE(accepted_at, record_ids, last_error, accepted_runtime_digest, accepted_runtime_revision) ON public.mojo_source_batches TO service_role;

CREATE INDEX mojo_unresolved_evidence_idx ON public.crm_mojo_call_events(call_at, record_id)
  WHERE qualification_status = 'evidence_pending';
CREATE INDEX mojo_unlinked_future_followup_idx ON public.crm_mojo_call_events(follow_up_at)
  WHERE lead_id IS NULL AND follow_up_at IS NOT NULL;

-- Keep the existing reconciliation contract, adding all-age unresolved work.
ALTER FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz)
  RENAME TO crm_mojo_reconciliation_snapshot_base_v1;
CREATE FUNCTION public.crm_mojo_reconciliation_snapshot_v1(
  p_since timestamptz DEFAULT now() - interval '30 days'
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public SET statement_timeout = '20s'
AS $$
WITH base AS (SELECT public.crm_mojo_reconciliation_snapshot_base_v1(p_since) AS value),
held AS MATERIALIZED (
  SELECT e.record_id, e.call_at AS since_at, 'canonical' AS location
  FROM public.crm_mojo_call_events e WHERE e.qualification_status = 'evidence_pending'
  UNION ALL
  SELECT q.record_id, q.created_at, 'queue'
  FROM public.mojo_call_queue q WHERE q.status = 'waiting_evidence'
    AND NOT EXISTS (SELECT 1 FROM public.crm_mojo_call_events e WHERE e.record_id = q.record_id
      AND e.qualification_status = 'evidence_pending')
), unaccepted AS MATERIALIZED (
  SELECT id, created_at, last_error FROM public.mojo_source_batches
  WHERE accepted_at IS NULL AND created_at < now() - interval '60 minutes'
), stuck AS MATERIALIZED (
  SELECT record_id, status, created_at FROM public.mojo_call_queue
  WHERE status IN ('pending', 'failed', 'processing') AND created_at < now() - interval '60 minutes'
), unlinked_followups AS MATERIALIZED (
  SELECT id, record_id, follow_up_at FROM public.crm_mojo_call_events
  WHERE follow_up_at > now() AND lead_id IS NULL
), additions AS (
  SELECT jsonb_build_object(
    'evidencePendingAllAges', (SELECT count(*) FROM held),
    'sourceBatchesUnaccepted', (SELECT count(*) FROM unaccepted),
    'queueOverdue', (SELECT count(*) FROM stuck),
    'unlinkedFutureFollowups', (SELECT count(*) FROM unlinked_followups)
  ) AS counts,
  jsonb_build_object(
    'evidencePendingAllAges', (SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT * FROM held ORDER BY since_at LIMIT 20) t),
    'sourceBatchesUnaccepted', (SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT * FROM unaccepted ORDER BY created_at LIMIT 20) t),
    'queueOverdue', (SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT * FROM stuck ORDER BY created_at LIMIT 20) t),
    'unlinkedFutureFollowups', (SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT * FROM unlinked_followups ORDER BY follow_up_at LIMIT 20) t)
  ) AS samples
)
SELECT base.value || jsonb_build_object('version', 'crm_mojo_reconciliation_integrity_v1', 'counts', (base.value -> 'counts') || additions.counts,
  'samples', (base.value -> 'samples') || additions.samples) FROM base, additions;
$$;
REVOKE ALL ON FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz) TO service_role;
