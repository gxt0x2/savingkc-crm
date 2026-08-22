-- Correct provenance for the exact audited legacy communication-event tasks.
--
-- This migration changes task metadata only. It does not complete, cancel,
-- delete, rename, reassign, or redate a task. The evidence contract is
-- intentionally narrow and fails closed unless production still matches the
-- approved 2026-08-22 census: 52 legacy SMS/call follow-ups, 15 missed-call
-- callbacks, and 4 voicemail callbacks. Four human or human-edited unknown
-- tasks remain untouched.

CREATE OR REPLACE FUNCTION public.task_provenance_has_event_v1(metadata_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(metadata_value, '{}'::jsonb) ?| ARRAY[
    'call_sid', 'callSid', 'message_sid', 'messageSid', 'booking_id',
    'appointment_id', 'recording_sid', 'recordingSid', 'workflow_run_id',
    'ai_generation_id', 'event_activity_id'
  ]
$$;

REVOKE ALL ON FUNCTION public.task_provenance_has_event_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_provenance_has_event_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.set_work_item_operational_lane_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.operational_lane := CASE
    WHEN public.task_provenance_class_v1(NEW.source_metadata) = 'automation_unreviewed' THEN 'quarantine'
    WHEN lower(coalesce(NEW.source_metadata ->> 'legacy_event_review', 'false')) = 'true' THEN 'review'
    WHEN EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = NEW.lead_id
        AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
        AND lower(coalesce(lead.classification, '')) <> 'dead'
    ) THEN 'current'
    ELSE 'review'
  END;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.set_work_item_operational_lane_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_work_item_operational_lane_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.sync_work_item_operational_lane_from_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_lane text;
BEGIN
  next_lane := CASE
    WHEN lower(coalesce(NEW.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
      AND lower(coalesce(NEW.classification, '')) <> 'dead'
    THEN 'current'
    ELSE 'review'
  END;

  UPDATE public.work_items
  SET operational_lane = CASE
        WHEN lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true' THEN 'review'
        ELSE next_lane
      END,
      updated_at = now()
  WHERE lead_id = NEW.id
    AND public.task_provenance_class_v1(source_metadata) <> 'automation_unreviewed'
    AND operational_lane IS DISTINCT FROM CASE
      WHEN lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true' THEN 'review'
      ELSE next_lane
    END;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() TO service_role;

CREATE TEMP TABLE task_legacy_event_review_candidates_v1 ON COMMIT DROP AS
WITH task_rows AS (
  SELECT
    item.source_id,
    item.lead_id,
    item.source_created_at,
    item.due_at,
    item.source_metadata,
    activity.agent AS activity_agent,
    coalesce((
      SELECT string_agg(metadata_key, ',' ORDER BY metadata_key)
      FROM jsonb_object_keys(coalesce(item.source_metadata, '{}'::jsonb)) AS metadata_key
    ), '(empty)') AS metadata_signature
  FROM public.work_items AS item
  JOIN public.lead_activities AS activity
    ON item.source_kind = 'activity'
   AND activity.id = item.source_id
  WHERE item.department = 'acquisitions'
    AND item.status IN ('pending', 'blocked')
    AND item.kind = 'task'
    AND public.task_provenance_class_v1(item.source_metadata) = 'unknown'
    AND item.due_at IS NOT NULL
    AND item.due_at >= item.source_created_at
    AND item.due_at <= item.source_created_at + interval '15 minutes'
), shaped AS (
  SELECT
    task.*,
    CASE
      WHEN metadata_signature = 'assigned_to,due_date,priority,status,task_type'
        AND activity_agent = 'System'
      THEN 'generic_legacy'
      WHEN metadata_signature = 'assigned_to,due_date,priority,seller_phone,status,task_type'
        AND activity_agent = 'Ari'
      THEN 'seller_phone'
      WHEN metadata_signature = 'assigned_to,due_date,priority,recordingUrl,status,task_type'
        AND activity_agent = 'System'
      THEN 'recording_url'
      ELSE NULL
    END AS legacy_event_shape
  FROM task_rows AS task
)
SELECT
  shaped.source_id,
  evidence.id AS event_activity_id,
  evidence.metadata AS event_metadata,
  shaped.legacy_event_shape,
  CASE
    WHEN shaped.legacy_event_shape = 'seller_phone' THEN 'twilio_dial_result'
    WHEN shaped.legacy_event_shape = 'recording_url' THEN 'twilio_voicemail'
    WHEN evidence.activity_type = 'call' THEN 'twilio_missed_call'
    ELSE 'twilio_sms_event'
  END AS corrected_source
FROM shaped
JOIN LATERAL (
  SELECT
    event.id,
    event.activity_type,
    event.metadata,
    event.created_at
  FROM public.lead_activities AS event
  WHERE event.lead_id = shaped.lead_id
    AND event.id <> shaped.source_id
    AND event.created_at BETWEEN shaped.source_created_at - interval '5 seconds'
      AND shaped.source_created_at + interval '5 seconds'
    AND (
      (
        shaped.legacy_event_shape = 'generic_legacy'
        AND (
          (
            event.activity_type = 'sms'
            AND lower(coalesce(event.metadata ->> 'direction', '')) IN (
              'inbound', 'received', 'outbound_alert', 'outbound'
            )
          )
          OR (
            event.activity_type = 'call'
            AND lower(coalesce(event.metadata ->> 'direction', '')) = 'inbound'
          )
        )
      )
      OR (
        shaped.legacy_event_shape = 'seller_phone'
        AND event.activity_type = 'call'
        AND lower(coalesce(event.metadata ->> 'direction', '')) = 'inbound'
      )
      OR (
        shaped.legacy_event_shape = 'recording_url'
        AND event.activity_type IN ('call', 'voicemail')
        AND lower(coalesce(event.metadata ->> 'direction', '')) = 'inbound'
      )
    )
  ORDER BY
    CASE
      WHEN event.activity_type = 'sms'
        AND lower(coalesce(event.metadata ->> 'direction', '')) IN ('inbound', 'received') THEN 0
      WHEN event.activity_type IN ('call', 'voicemail') THEN 1
      WHEN lower(coalesce(event.metadata ->> 'direction', '')) = 'outbound_alert' THEN 2
      ELSE 3
    END,
    abs(extract(epoch FROM (event.created_at - shaped.source_created_at))),
    event.id
  LIMIT 1
) AS evidence ON shaped.legacy_event_shape IS NOT NULL;

DO $$
DECLARE
  candidate_total integer;
  generic_total integer;
  seller_phone_total integer;
  recording_total integer;
  already_corrected_total integer;
  unknown_active_total integer;
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE legacy_event_shape = 'generic_legacy')::integer,
    count(*) FILTER (WHERE legacy_event_shape = 'seller_phone')::integer,
    count(*) FILTER (WHERE legacy_event_shape = 'recording_url')::integer
  INTO candidate_total, generic_total, seller_phone_total, recording_total
  FROM task_legacy_event_review_candidates_v1;

  SELECT count(*)::integer INTO already_corrected_total
  FROM public.work_items
  WHERE lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true'
    AND source_metadata ->> 'provenance_correction' = 'task_legacy_event_review_v1';

  SELECT count(*)::integer INTO unknown_active_total
  FROM public.work_items
  WHERE department = 'acquisitions'
    AND status IN ('pending', 'blocked')
    AND public.task_provenance_class_v1(source_metadata) = 'unknown';

  IF candidate_total = 0 AND already_corrected_total = 0 AND unknown_active_total = 0 THEN
    RETURN;
  END IF;

  IF candidate_total = 0 AND already_corrected_total = 71 AND unknown_active_total = 4 THEN
    RETURN;
  END IF;

  IF candidate_total <> 71
    OR generic_total <> 52
    OR seller_phone_total <> 15
    OR recording_total <> 4
    OR already_corrected_total <> 0
    OR unknown_active_total <> 75
  THEN
    RAISE EXCEPTION
      'legacy task event review census drifted (candidate %, generic %, seller %, recording %, corrected %, unknown %)',
      candidate_total, generic_total, seller_phone_total, recording_total,
      already_corrected_total, unknown_active_total;
  END IF;
END
$$;

UPDATE public.lead_activities AS activity
SET metadata = jsonb_strip_nulls(
  coalesce(activity.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'source', candidate.corrected_source,
    'event_activity_id', candidate.event_activity_id::text,
    'legacy_event_review', true,
    'legacy_event_shape', candidate.legacy_event_shape,
    'provenance_correction', 'task_legacy_event_review_v1',
    'provenance_corrected_at', now(),
    'call_sid', coalesce(
      nullif(activity.metadata ->> 'call_sid', ''),
      nullif(candidate.event_metadata ->> 'call_sid', ''),
      nullif(candidate.event_metadata ->> 'callSid', '')
    ),
    'message_sid', coalesce(
      nullif(activity.metadata ->> 'message_sid', ''),
      nullif(candidate.event_metadata ->> 'message_sid', ''),
      nullif(candidate.event_metadata ->> 'messageSid', '')
    ),
    'recording_sid', coalesce(
      nullif(activity.metadata ->> 'recording_sid', ''),
      nullif(candidate.event_metadata ->> 'recording_sid', ''),
      nullif(candidate.event_metadata ->> 'recordingSid', '')
    )
  )
)
FROM task_legacy_event_review_candidates_v1 AS candidate
WHERE activity.id = candidate.source_id
  AND activity.metadata IS DISTINCT FROM jsonb_strip_nulls(
    coalesce(activity.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', candidate.corrected_source,
      'event_activity_id', candidate.event_activity_id::text,
      'legacy_event_review', true,
      'legacy_event_shape', candidate.legacy_event_shape,
      'provenance_correction', 'task_legacy_event_review_v1',
      'provenance_corrected_at', now(),
      'call_sid', coalesce(
        nullif(activity.metadata ->> 'call_sid', ''),
        nullif(candidate.event_metadata ->> 'call_sid', ''),
        nullif(candidate.event_metadata ->> 'callSid', '')
      ),
      'message_sid', coalesce(
        nullif(activity.metadata ->> 'message_sid', ''),
        nullif(candidate.event_metadata ->> 'message_sid', ''),
        nullif(candidate.event_metadata ->> 'messageSid', '')
      ),
      'recording_sid', coalesce(
        nullif(activity.metadata ->> 'recording_sid', ''),
        nullif(candidate.event_metadata ->> 'recording_sid', ''),
        nullif(candidate.event_metadata ->> 'recordingSid', '')
      )
    )
  );

DO $$
DECLARE
  corrected_total integer;
  event_backed_total integer;
  review_total integer;
  unknown_active_total integer;
BEGIN
  SELECT count(*)::integer INTO corrected_total
  FROM public.work_items
  WHERE lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true'
    AND source_metadata ->> 'provenance_correction' = 'task_legacy_event_review_v1';

  SELECT count(*)::integer INTO event_backed_total
  FROM public.work_items
  WHERE lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true'
    AND public.task_provenance_class_v1(source_metadata) = 'event_derived'
    AND public.task_provenance_has_event_v1(source_metadata);

  SELECT count(*)::integer INTO review_total
  FROM public.work_items
  WHERE lower(coalesce(source_metadata ->> 'legacy_event_review', 'false')) = 'true'
    AND operational_lane = 'review';

  SELECT count(*)::integer INTO unknown_active_total
  FROM public.work_items
  WHERE department = 'acquisitions'
    AND status IN ('pending', 'blocked')
    AND public.task_provenance_class_v1(source_metadata) = 'unknown';

  IF corrected_total = 0 AND event_backed_total = 0
    AND review_total = 0 AND unknown_active_total = 0
  THEN
    RETURN;
  END IF;

  IF corrected_total <> 71 OR event_backed_total <> 71
    OR review_total <> 71 OR unknown_active_total <> 4
  THEN
    RAISE EXCEPTION
      'legacy task event review postcondition failed (corrected %, event %, review %, unknown %)',
      corrected_total, event_backed_total, review_total, unknown_active_total;
  END IF;
END
$$;

COMMENT ON FUNCTION public.task_provenance_has_event_v1(jsonb) IS
  'Returns true when task provenance contains a durable provider, workflow, AI-generation, or linked CRM activity identifier.';

