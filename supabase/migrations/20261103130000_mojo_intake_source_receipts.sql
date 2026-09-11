-- Per-call proof binds queue acceptance to an already archived source batch.
CREATE TABLE public.mojo_source_call_receipts (
  source_batch_id text NOT NULL REFERENCES public.mojo_source_batches(id),
  requested_record_id text NOT NULL,
  queue_record_id text NOT NULL REFERENCES public.mojo_call_queue(record_id),
  runtime_digest text NOT NULL CHECK (runtime_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_batch_id, requested_record_id)
);
CREATE INDEX mojo_source_call_receipts_queue_idx ON public.mojo_source_call_receipts(queue_record_id);
ALTER TABLE public.mojo_source_call_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mojo_source_call_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mojo_source_call_receipts TO service_role;

-- Recording identity reuse is a defect at any age, independent of lead/name changes.
CREATE OR REPLACE FUNCTION public.crm_mojo_reconciliation_snapshot_v1(
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
), recording_identities AS MATERIALIZED (
  SELECT id, record_id, call_at,
    coalesce(nullif(provider_recording_id, ''), substring(recording_url from '[?&]record_id=([0-9]+)')) AS recording_id
  FROM public.crm_mojo_call_events
  WHERE nullif(recording_url, '') IS NOT NULL
), reused_recordings AS MATERIALIZED (
  SELECT first.id, first.record_id, second.id AS duplicate_id, second.record_id AS duplicate_record_id,
    first.recording_id
  FROM recording_identities first JOIN recording_identities second
    ON first.id < second.id AND first.recording_id = second.recording_id
), additions AS (
  SELECT jsonb_build_object(
    'strongDuplicateRecordingPairs', (SELECT count(*) FROM reused_recordings),
    'evidencePendingAllAges', (SELECT count(*) FROM held),
    'sourceBatchesUnaccepted', (SELECT count(*) FROM unaccepted),
    'queueOverdue', (SELECT count(*) FROM stuck),
    'unlinkedFutureFollowups', (SELECT count(*) FROM unlinked_followups)
  ) AS counts,
  jsonb_build_object(
    'strongDuplicateRecordingPairs', (SELECT coalesce(jsonb_agg(t), '[]') FROM (SELECT * FROM reused_recordings ORDER BY record_id LIMIT 20) t),
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
