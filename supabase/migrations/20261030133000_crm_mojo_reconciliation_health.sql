-- Reconcile legacy CRM lifecycle/appointment drift and expose a bounded,
-- service-only health snapshot for the existing Mojo monitor.

-- A lead was already treated as inactive when either station or classification
-- said dead. Align the two fields without inventing a more specific historical
-- reason, and retain the original values in an immutable activity.
INSERT INTO public.lead_activities (
  lead_id, activity_type, description, agent, metadata
)
SELECT
  lead.id,
  'status_change',
  'CRM reconciliation aligned lifecycle fields for an existing dead lead.',
  'CRM Reconciliation',
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'crm_reconciliation_v1',
    'reconciliation_key', '2026-09-09-lifecycle-v1:' || lead.id::text,
    'old_station', lead.station,
    'old_classification', lead.classification,
    'old_priority', lead.priority,
    'old_dead_reason', lead.dead_reason,
    'old_dead_at', lead.dead_at,
    'new_station', 'dead',
    'new_classification', 'dead',
    'new_priority', 'cold',
    'dead_reason_fallback', CASE
      WHEN nullif(btrim(coalesce(lead.dead_reason, '')), '') IS NULL THEN 'other'
      ELSE NULL
    END
  ))
FROM public.leads AS lead
WHERE (
    lower(coalesce(lead.station, '')) = 'dead'
    AND lower(coalesce(lead.classification, '')) <> 'dead'
  ) OR (
    lower(coalesce(lead.classification, '')) = 'dead'
    AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed_lost')
  );

UPDATE public.leads AS lead SET
  station = 'dead',
  classification = 'dead',
  priority = 'cold',
  opportunity_score = 0,
  dead_reason = coalesce(nullif(btrim(coalesce(lead.dead_reason, '')), ''), 'other'),
  dead_at = coalesce(lead.dead_at, lead.updated_at, now()),
  dead_by = coalesce(nullif(btrim(coalesce(lead.dead_by, '')), ''), 'CRM Reconciliation'),
  updated_at = now()
WHERE (
    lower(coalesce(lead.station, '')) = 'dead'
    AND lower(coalesce(lead.classification, '')) <> 'dead'
  ) OR (
    lower(coalesce(lead.classification, '')) = 'dead'
    AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed_lost')
  );

-- Close six historical AI-extracted appointments that were still marked
-- active after their scheduled date. Jill Woods' appointment is completed;
-- the other five have no completed outcome evidence and are cancelled.
WITH repair(appointment_id, repaired_status) AS (
  VALUES
    ('3bb8963e-9238-4866-9262-86c01f295ec0'::uuid, 'cancelled'::text),
    ('9e95f796-dc70-440b-a307-d42f206f0317'::uuid, 'cancelled'::text),
    ('2b025c81-1e85-49ff-97f1-d09f040eaa9e'::uuid, 'cancelled'::text),
    ('1fd03a44-4341-4f30-bcb2-3fc71c3beb30'::uuid, 'completed'::text),
    ('142085f9-22a9-45a8-b150-93341ea95cf3'::uuid, 'cancelled'::text),
    ('66d405ed-bada-4669-9b82-98b51910013b'::uuid, 'cancelled'::text)
)
INSERT INTO public.lead_activities (
  lead_id, activity_type, description, agent, metadata
)
SELECT
  appointment.lead_id,
  'appointment_outcome',
  CASE repair.repaired_status
    WHEN 'completed' THEN 'Historical appointment reconciled as completed.'
    ELSE 'Historical appointment reconciled as cancelled.'
  END,
  'CRM Reconciliation',
  jsonb_build_object(
    'source', 'crm_reconciliation_v1',
    'reconciliation_key', '2026-09-09-appointment-v1:' || appointment.id::text,
    'appointment_id', appointment.id,
    'outcome', repair.repaired_status,
    'previous_status', appointment.status,
    'scheduled_at', appointment.scheduled_at,
    'reason', 'stale_historical_appointment'
  )
FROM repair
JOIN public.appointments AS appointment ON appointment.id = repair.appointment_id
WHERE appointment.status IN ('scheduled', 'confirmed')
  AND NOT EXISTS (
    SELECT 1
    FROM public.lead_activities AS existing
    WHERE existing.metadata ->> 'reconciliation_key'
      = '2026-09-09-appointment-v1:' || appointment.id::text
  );

WITH repair(appointment_id) AS (
  VALUES
    ('3bb8963e-9238-4866-9262-86c01f295ec0'::uuid),
    ('9e95f796-dc70-440b-a307-d42f206f0317'::uuid),
    ('2b025c81-1e85-49ff-97f1-d09f040eaa9e'::uuid),
    ('1fd03a44-4341-4f30-bcb2-3fc71c3beb30'::uuid),
    ('142085f9-22a9-45a8-b150-93341ea95cf3'::uuid),
    ('66d405ed-bada-4669-9b82-98b51910013b'::uuid)
)
UPDATE public.leads AS lead SET
  appointment_date = NULL,
  appointment_notes = NULL,
  updated_at = now()
FROM public.appointments AS appointment
JOIN repair ON repair.appointment_id = appointment.id
WHERE lead.id = appointment.lead_id
  AND lead.appointment_date = appointment.scheduled_at;

WITH repair(appointment_id, repaired_status) AS (
  VALUES
    ('3bb8963e-9238-4866-9262-86c01f295ec0'::uuid, 'cancelled'::text),
    ('9e95f796-dc70-440b-a307-d42f206f0317'::uuid, 'cancelled'::text),
    ('2b025c81-1e85-49ff-97f1-d09f040eaa9e'::uuid, 'cancelled'::text),
    ('1fd03a44-4341-4f30-bcb2-3fc71c3beb30'::uuid, 'completed'::text),
    ('142085f9-22a9-45a8-b150-93341ea95cf3'::uuid, 'cancelled'::text),
    ('66d405ed-bada-4669-9b82-98b51910013b'::uuid, 'cancelled'::text)
)
UPDATE public.appointments AS appointment SET
  status = repair.repaired_status,
  updated_at = now()
FROM repair
WHERE appointment.id = repair.appointment_id
  AND appointment.status IN ('scheduled', 'confirmed');

INSERT INTO public.system_config(key, value, updated_at)
VALUES (
  'crm_reconciliation_last_repair',
  jsonb_build_object(
    'version', 'crm_reconciliation_v1',
    'approvedAt', '2026-09-09T00:00:00-05:00',
    'scope', jsonb_build_array('lifecycle_alignment', 'stale_appointments'),
    'actor', 'CRM Reconciliation'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = EXCLUDED.updated_at;

CREATE OR REPLACE FUNCTION public.crm_mojo_reconciliation_snapshot_v1(
  p_since timestamptz DEFAULT now() - interval '30 days'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $$
  WITH parameters AS MATERIALIZED (
    SELECT greatest(
      coalesce(p_since, now() - interval '30 days'),
      now() - interval '90 days'
    ) AS since_at
  ), lifecycle_station_dead AS MATERIALIZED (
    SELECT lead.id, lead.full_name, lead.station, lead.classification
    FROM public.leads AS lead
    WHERE lower(coalesce(lead.station, '')) = 'dead'
      AND lower(coalesce(lead.classification, '')) <> 'dead'
  ), lifecycle_classification_dead AS MATERIALIZED (
    SELECT lead.id, lead.full_name, lead.station, lead.classification
    FROM public.leads AS lead
    WHERE lower(coalesce(lead.classification, '')) = 'dead'
      AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed_lost')
  ), dead_active_appointments AS MATERIALIZED (
    SELECT appointment.id, appointment.lead_id, appointment.scheduled_at, appointment.status
    FROM public.appointments AS appointment
    JOIN public.leads AS lead ON lead.id = appointment.lead_id
    WHERE appointment.status IN ('scheduled', 'confirmed')
      AND (
        lower(coalesce(lead.station, '')) IN ('dead', 'closed_lost')
        OR lower(coalesce(lead.classification, '')) = 'dead'
      )
  ), stale_active_appointments AS MATERIALIZED (
    SELECT appointment.id, appointment.lead_id, appointment.scheduled_at, appointment.status
    FROM public.appointments AS appointment
    WHERE appointment.status IN ('scheduled', 'confirmed')
      AND appointment.scheduled_at < now() - interval '24 hours'
  ), cancelled_outcome_active_appointments AS MATERIALIZED (
    SELECT DISTINCT appointment.id, appointment.lead_id, appointment.scheduled_at, appointment.status
    FROM public.lead_activities AS activity
    CROSS JOIN parameters
    JOIN public.appointments AS appointment
      ON appointment.id::text = coalesce(
        activity.metadata ->> 'appointment_id',
        activity.metadata ->> 'appointmentId'
      )
    WHERE activity.created_at >= parameters.since_at
      AND activity.activity_type = 'appointment_outcome'
      AND appointment.status IN ('scheduled', 'confirmed')
      AND lower(coalesce(
        activity.metadata ->> 'outcome',
        activity.metadata ->> 'status',
        activity.description,
        ''
      )) ~ 'cancel'
  ), dead_current_work_items AS MATERIALIZED (
    SELECT work.work_item_key, work.lead_id, work.kind, work.due_at
    FROM public.work_items AS work
    JOIN public.leads AS lead ON lead.id = work.lead_id
    WHERE work.status IN ('pending', 'blocked')
      AND work.primary_next_action = true
      AND (
        lower(coalesce(lead.station, '')) IN ('dead', 'closed_lost')
        OR lower(coalesce(lead.classification, '')) = 'dead'
      )
  ), followups_missing_work_items AS MATERIALIZED (
    SELECT event.id, event.record_id, event.lead_id, event.follow_up_at
    FROM public.crm_mojo_call_events AS event
    CROSS JOIN parameters
    WHERE event.call_at >= parameters.since_at
      AND event.outcome IN ('callback_scheduled', 'meaningful_conversation')
      AND event.follow_up_at IS NOT NULL
      AND event.lead_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.work_items AS work
        WHERE work.lead_id = event.lead_id
          AND work.kind IN ('callback', 'follow_up')
          AND work.source_metadata ->> 'record_id' = event.record_id
      )
  ), eligible_missing_recording_url AS MATERIALIZED (
    SELECT event.id, event.record_id, event.lead_id, event.call_at
    FROM public.crm_mojo_call_events AS event
    CROSS JOIN parameters
    WHERE event.call_at >= parameters.since_at
      AND event.promotion_eligible = true
      AND nullif(btrim(coalesce(event.recording_url, '')), '') IS NULL
  ), recordings_not_analyzed AS MATERIALIZED (
    SELECT event.id, event.record_id, event.lead_id, event.call_at, event.recording_processing_status
    FROM public.crm_mojo_call_events AS event
    CROSS JOIN parameters
    WHERE event.call_at >= parameters.since_at
      AND event.call_at < now() - interval '30 minutes'
      AND event.promotion_eligible = true
      AND event.recording_url IS NOT NULL
      AND event.recording_processing_status <> 'analyzed'
  ), analyzed_missing_transcript AS MATERIALIZED (
    SELECT event.id, event.record_id, event.lead_id, event.call_at
    FROM public.crm_mojo_call_events AS event
    CROSS JOIN parameters
    WHERE event.call_at >= parameters.since_at
      AND event.recording_processing_status = 'analyzed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_activities AS activity
        WHERE activity.lead_id = event.lead_id
          AND activity.metadata ->> 'source' = 'whisper_transcription'
          AND activity.metadata ->> 'event_id' = event.id::text
      )
  ), analyzed_missing_summary AS MATERIALIZED (
    SELECT event.id, event.record_id, event.lead_id, event.call_at
    FROM public.crm_mojo_call_events AS event
    CROSS JOIN parameters
    WHERE event.call_at >= parameters.since_at
      AND event.recording_processing_status = 'analyzed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_activities AS activity
        WHERE activity.lead_id = event.lead_id
          AND activity.metadata ->> 'source' = 'call_analysis'
          AND activity.metadata ->> 'event_id' = event.id::text
      )
  ), strong_duplicate_recording_pairs AS MATERIALIZED (
    SELECT first.id, first.record_id, second.id AS duplicate_id, second.record_id AS duplicate_record_id
    FROM public.crm_mojo_call_events AS first
    CROSS JOIN parameters
    JOIN public.crm_mojo_call_events AS second
      ON second.id > first.id
      AND second.call_at >= parameters.since_at
      AND second.recording_url = first.recording_url
      AND coalesce(second.normalized_phone, '') = coalesce(first.normalized_phone, '')
      AND lower(btrim(coalesce(second.property_address, '')))
        = lower(btrim(coalesce(first.property_address, '')))
      AND (
        abs(extract(epoch FROM second.call_at - first.call_at)) <= 3600
        OR (
          lower(btrim(coalesce(second.contact_name, '')))
            = lower(btrim(coalesce(first.contact_name, '')))
          AND lower(btrim(coalesce(second.notes, '')))
            = lower(btrim(coalesce(first.notes, '')))
        )
      )
    WHERE first.call_at >= parameters.since_at
      AND nullif(btrim(coalesce(first.recording_url, '')), '') IS NOT NULL
  ), dead_letter_queue AS MATERIALIZED (
    SELECT queue.id, queue.record_id, queue.created_at, queue.last_error
    FROM public.mojo_call_queue AS queue
    WHERE queue.status = 'dead_letter'
  )
  SELECT jsonb_build_object(
    'version', 'crm_mojo_reconciliation_v1',
    'checkedAt', now(),
    'windowSince', parameters.since_at,
    'counts', jsonb_build_object(
      'deadLetterQueue', (SELECT count(*) FROM dead_letter_queue),
      'lifecycleStationDeadConflict', (SELECT count(*) FROM lifecycle_station_dead),
      'lifecycleClassificationDeadConflict', (SELECT count(*) FROM lifecycle_classification_dead),
      'deadActiveAppointments', (SELECT count(*) FROM dead_active_appointments),
      'staleActiveAppointments', (SELECT count(*) FROM stale_active_appointments),
      'cancelledOutcomeActiveAppointments', (SELECT count(*) FROM cancelled_outcome_active_appointments),
      'deadCurrentWorkItems', (SELECT count(*) FROM dead_current_work_items),
      'followupsMissingWorkItems', (SELECT count(*) FROM followups_missing_work_items),
      'eligibleMissingRecordingUrl', (SELECT count(*) FROM eligible_missing_recording_url),
      'recordingsNotAnalyzed', (SELECT count(*) FROM recordings_not_analyzed),
      'analyzedMissingTranscript', (SELECT count(*) FROM analyzed_missing_transcript),
      'analyzedMissingSummary', (SELECT count(*) FROM analyzed_missing_summary),
      'strongDuplicateRecordingPairs', (SELECT count(*) FROM strong_duplicate_recording_pairs)
    ),
    'samples', jsonb_build_object(
      'lifecycle', coalesce((
        SELECT jsonb_agg(sample)
        FROM (
          SELECT id, full_name, station, classification
          FROM (
            SELECT * FROM lifecycle_station_dead
            UNION ALL
            SELECT * FROM lifecycle_classification_dead
          ) AS conflicts
          ORDER BY full_name, id
          LIMIT 10
        ) AS sample
      ), '[]'::jsonb),
      'appointments', coalesce((
        SELECT jsonb_agg(sample)
        FROM (
          SELECT id, lead_id, scheduled_at, status
          FROM stale_active_appointments
          ORDER BY scheduled_at, id
          LIMIT 10
        ) AS sample
      ), '[]'::jsonb),
      'followups', coalesce((
        SELECT jsonb_agg(sample)
        FROM (
          SELECT id, record_id, lead_id, follow_up_at
          FROM followups_missing_work_items
          ORDER BY follow_up_at, id
          LIMIT 10
        ) AS sample
      ), '[]'::jsonb),
      'recordings', coalesce((
        SELECT jsonb_agg(sample)
        FROM (
          SELECT id, record_id, lead_id, call_at
          FROM recordings_not_analyzed
          ORDER BY call_at, id
          LIMIT 10
        ) AS sample
      ), '[]'::jsonb),
      'duplicates', coalesce((
        SELECT jsonb_agg(sample)
        FROM (
          SELECT id, record_id, duplicate_id, duplicate_record_id
          FROM strong_duplicate_recording_pairs
          ORDER BY record_id, duplicate_record_id
          LIMIT 10
        ) AS sample
      ), '[]'::jsonb)
    )
  )
  FROM parameters;
$$;

REVOKE ALL ON FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.crm_mojo_reconciliation_snapshot_v1(timestamptz) IS
  'Read-only, bounded CRM/Mojo consistency snapshot used by the 15-minute service health monitor.';
