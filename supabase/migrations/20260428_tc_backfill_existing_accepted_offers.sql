-- Backfill TC files for accepted offers that existed before the TC layer shipped.

INSERT INTO tc_files (
  lead_id,
  dispo_deal_id,
  buyer_offer_id,
  status,
  opened_at,
  closing_scheduled_at,
  assignment_fee,
  next_action,
  risk_level
)
SELECT
  bo.lead_id,
  dd.id,
  bo.id,
  CASE
    WHEN bo.assignment_signed_at IS NOT NULL THEN 'opening_package_needed'
    ELSE 'not_opened'
  END,
  CASE
    WHEN bo.assignment_signed_at IS NOT NULL THEN COALESCE(bo.assignment_signed_at, NOW())
    ELSE NULL
  END,
  CASE
    WHEN bo.close_days IS NOT NULL THEN bo.submitted_at + (bo.close_days || ' days')::interval
    ELSE NULL
  END,
  dd.assignment_fee,
  CASE
    WHEN bo.assignment_signed_at IS NOT NULL THEN 'Send opening package to title'
    ELSE 'Send assignment contract and open with title'
  END,
  'normal'
FROM buyer_offers bo
LEFT JOIN LATERAL (
  SELECT id, assignment_fee
  FROM dispo_deals
  WHERE lead_id = bo.lead_id
  ORDER BY
    CASE WHEN accepted_offer_id = bo.id THEN 0 ELSE 1 END,
    updated_at DESC
  LIMIT 1
) dd ON true
WHERE bo.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM tc_files existing
    WHERE existing.buyer_offer_id = bo.id
  );

WITH standard_tasks(task_type, label) AS (
  VALUES
    ('send_opening_package', 'Send opening package to title'),
    ('confirm_assignment_signed', 'Confirm assignment contract fully signed'),
    ('confirm_emd', 'Confirm EMD receipt'),
    ('confirm_file_number', 'Confirm title file number'),
    ('confirm_title_clear', 'Confirm title clear'),
    ('schedule_closing', 'Schedule closing'),
    ('collect_hud', 'Collect HUD / settlement statement'),
    ('log_assignment_revenue', 'Log assignment revenue')
)
INSERT INTO tc_tasks (tc_file_id, task_type, label, source)
SELECT tf.id, st.task_type, st.label, 'backfill'
FROM tc_files tf
CROSS JOIN standard_tasks st
WHERE tf.status <> 'not_opened'
ON CONFLICT (tc_file_id, task_type) DO NOTHING;

INSERT INTO tc_events (tc_file_id, event_type, payload, actor)
SELECT
  tf.id,
  'backfill_existing_offer',
  jsonb_build_object('buyer_offer_id', tf.buyer_offer_id, 'lead_id', tf.lead_id, 'status', tf.status),
  'migration'
FROM tc_files tf
WHERE tf.buyer_offer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tc_events e
    WHERE e.tc_file_id = tf.id
      AND e.event_type = 'backfill_existing_offer'
  );
