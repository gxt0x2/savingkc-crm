-- Aggregate-only provenance census for canonical work items.
--
-- This migration does not update, quarantine, complete, or delete any source
-- task. It gives the authenticated server a PII-free way to measure which
-- backlog rows are governed, event-backed, legacy operator-entered,
-- automation-generated, or unattributed before a human reviews quarantine.

CREATE OR REPLACE FUNCTION public.task_provenance_class_v1(metadata_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) = 'governed_workflow'
      THEN 'approved_workflow'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN (
      'canonical_work_item', 'conversation_hub'
    ) THEN 'governed_human'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN (
      'lead_detail_task', 'calendar', 'calendar_new_task'
    ) THEN 'legacy_operator'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN (
      'mojo', 'mojo_auto_evaluate', 'mojo_sync', 'mojo_batch_evaluation',
      'batch-briefing-v2', 'appointment-reminder-worker', 'system'
    ) OR lower(trim(coalesce(metadata_value ->> 'source', ''))) LIKE 'mojo\_%' ESCAPE '\'
      THEN 'automation_unreviewed'
    WHEN lower(trim(coalesce(metadata_value ->> 'source', ''))) IN (
      'website_form', 'operating_model', 'direct_inbound_intake',
      'carrier_sms_fallback', 'twilio_missed_call', 'twilio_sms_event',
      'twilio_dial_result', 'twilio_voicemail', 'twilio_after_record',
      'google_ads_missed_call', 'website_booking_event', 'call_disposition'
    ) THEN 'event_derived'
    WHEN coalesce(metadata_value, '{}'::jsonb) ?| ARRAY[
      'call_sid', 'callSid', 'message_sid', 'messageSid', 'booking_id',
      'appointment_id', 'recording_sid', 'recordingSid', 'workflow_run_id'
    ] THEN 'event_derived'
    ELSE 'unknown'
  END
$$;

REVOKE ALL ON FUNCTION public.task_provenance_class_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_provenance_class_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.task_provenance_has_event_v1(metadata_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(metadata_value, '{}'::jsonb) ?| ARRAY[
    'call_sid', 'callSid', 'message_sid', 'messageSid', 'booking_id',
    'appointment_id', 'recording_sid', 'recordingSid', 'workflow_run_id',
    'ai_generation_id'
  ]
$$;

REVOKE ALL ON FUNCTION public.task_provenance_has_event_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_provenance_has_event_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.task_provenance_summary_v1(
  p_department text DEFAULT 'acquisitions'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH scoped AS (
    SELECT
      item.work_item_key,
      item.lead_id,
      item.kind,
      item.title,
      item.status,
      item.due_at,
      item.source_created_at,
      coalesce(item.source_metadata, '{}'::jsonb) AS metadata_value,
      public.task_provenance_class_v1(item.source_metadata) AS provenance_class,
      public.task_provenance_has_event_v1(item.source_metadata) AS has_event,
      lower(trim(coalesce(item.source_metadata ->> 'source', ''))) AS source_name
    FROM public.work_items item
    WHERE item.department = coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions')
      AND item.status IN ('pending', 'blocked', 'completed')
  ), class_counts AS (
    SELECT provenance_class,
      count(*)::integer AS total,
      count(*) FILTER (WHERE status IN ('pending', 'blocked'))::integer AS active
    FROM scoped
    GROUP BY provenance_class
  ), possible_duplicates AS (
    SELECT greatest(count(*) - 1, 0)::integer AS duplicate_count
    FROM scoped
    WHERE status IN ('pending', 'blocked')
    GROUP BY lead_id, kind, lower(trim(title)), due_at::date
    HAVING count(*) > 1
  )
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'department', coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions'),
    'total', count(*)::integer,
    'active', count(*) FILTER (WHERE status IN ('pending', 'blocked'))::integer,
    'completed', count(*) FILTER (WHERE status = 'completed')::integer,
    'classes', coalesce((
      SELECT jsonb_object_agg(provenance_class, jsonb_build_object('total', total, 'active', active))
      FROM class_counts
    ), '{}'::jsonb),
    'knownSources', jsonb_build_object(
      'mojo_auto_evaluate', count(*) FILTER (WHERE source_name = 'mojo_auto_evaluate')::integer,
      'mojo_sync', count(*) FILTER (WHERE source_name = 'mojo_sync')::integer,
      'mojo_batch_evaluation', count(*) FILTER (WHERE source_name = 'mojo_batch_evaluation')::integer,
      'mojo', count(*) FILTER (WHERE source_name = 'mojo')::integer,
      'batch_briefing_v2', count(*) FILTER (WHERE source_name = 'batch-briefing-v2')::integer,
      'lead_detail_task', count(*) FILTER (WHERE source_name = 'lead_detail_task')::integer,
      'calendar', count(*) FILTER (WHERE source_name IN ('calendar', 'calendar_new_task'))::integer,
      'website_form', count(*) FILTER (WHERE source_name = 'website_form')::integer,
      'direct_inbound_intake', count(*) FILTER (WHERE source_name = 'direct_inbound_intake')::integer
    ),
    'quality', jsonb_build_object(
      'missingSource', count(*) FILTER (WHERE source_name = '')::integer,
      'missingActor', count(*) FILTER (
        WHERE nullif(trim(metadata_value ->> 'created_by'), '') IS NULL
      )::integer,
      'withoutEventEvidence', count(*) FILTER (WHERE NOT has_event)::integer,
      'missingDueDate', count(*) FILTER (WHERE due_at IS NULL)::integer,
      'unlinked', count(*) FILTER (WHERE lead_id IS NULL)::integer,
      'possibleDuplicateRows', coalesce((SELECT sum(duplicate_count) FROM possible_duplicates), 0)::integer,
      'olderThan60DaysActive', count(*) FILTER (
        WHERE status IN ('pending', 'blocked') AND source_created_at < now() - interval '60 days'
      )::integer
    )
  )
  FROM scoped
$$;

REVOKE ALL ON FUNCTION public.task_provenance_summary_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_provenance_summary_v1(text) TO service_role;

COMMENT ON FUNCTION public.task_provenance_summary_v1(text) IS
  'Returns aggregate-only task provenance evidence without exposing task text, contact identifiers, or customer data.';
