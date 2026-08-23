-- Phase Zero: only governed human work and approved workflows may enter the
-- operator-facing current lane. Event-derived rows remain historical evidence;
-- unknown and explicit automation rows remain quarantined. Source activities
-- are preserved unchanged.

CREATE OR REPLACE FUNCTION public.set_work_item_operational_lane_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  provenance_class text := public.task_provenance_class_v1(NEW.source_metadata);
BEGIN
  NEW.operational_lane := CASE
    WHEN provenance_class IN ('automation_unreviewed', 'unknown') THEN 'quarantine'
    WHEN provenance_class = 'event_derived' THEN 'review'
    WHEN provenance_class IN ('approved_workflow', 'governed_human', 'legacy_operator')
      AND EXISTS (
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

REVOKE ALL ON FUNCTION public.set_work_item_operational_lane_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_work_item_operational_lane_v1()
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_work_item_operational_lane_from_lead_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.work_items AS item
  SET operational_lane = CASE
        WHEN public.task_provenance_class_v1(item.source_metadata) IN ('automation_unreviewed', 'unknown')
          THEN 'quarantine'
        WHEN public.task_provenance_class_v1(item.source_metadata) = 'event_derived'
          THEN 'review'
        WHEN public.task_provenance_class_v1(item.source_metadata) IN ('approved_workflow', 'governed_human', 'legacy_operator')
          AND lower(coalesce(NEW.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
          AND lower(coalesce(NEW.classification, '')) <> 'dead'
          THEN 'current'
        ELSE 'review'
      END,
      updated_at = now()
  WHERE item.lead_id = NEW.id
    AND item.operational_lane IS DISTINCT FROM CASE
      WHEN public.task_provenance_class_v1(item.source_metadata) IN ('automation_unreviewed', 'unknown')
        THEN 'quarantine'
      WHEN public.task_provenance_class_v1(item.source_metadata) = 'event_derived'
        THEN 'review'
      WHEN public.task_provenance_class_v1(item.source_metadata) IN ('approved_workflow', 'governed_human', 'legacy_operator')
        AND lower(coalesce(NEW.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
        AND lower(coalesce(NEW.classification, '')) <> 'dead'
        THEN 'current'
      ELSE 'review'
    END;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1()
  TO service_role;

UPDATE public.work_items AS item
SET operational_lane = CASE
      WHEN public.task_provenance_class_v1(item.source_metadata) IN ('automation_unreviewed', 'unknown')
        THEN 'quarantine'
      WHEN public.task_provenance_class_v1(item.source_metadata) = 'event_derived'
        THEN 'review'
      WHEN public.task_provenance_class_v1(item.source_metadata) IN ('approved_workflow', 'governed_human', 'legacy_operator')
        AND EXISTS (
          SELECT 1 FROM public.leads AS lead
          WHERE lead.id = item.lead_id
            AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
            AND lower(coalesce(lead.classification, '')) <> 'dead'
        ) THEN 'current'
      ELSE 'review'
    END,
    updated_at = now()
WHERE item.operational_lane IS DISTINCT FROM CASE
  WHEN public.task_provenance_class_v1(item.source_metadata) IN ('automation_unreviewed', 'unknown')
    THEN 'quarantine'
  WHEN public.task_provenance_class_v1(item.source_metadata) = 'event_derived'
    THEN 'review'
  WHEN public.task_provenance_class_v1(item.source_metadata) IN ('approved_workflow', 'governed_human', 'legacy_operator')
    AND EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = item.lead_id
        AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
        AND lower(coalesce(lead.classification, '')) <> 'dead'
    ) THEN 'current'
  ELSE 'review'
END;

COMMENT ON COLUMN public.work_items.operational_lane IS
  'Internal projection boundary: current is governed human or approved workflow work on an active record; review and quarantine preserve non-operational evidence.';

-- Make the lane boundary atomic with the source mutation. The application
-- preflight provides a useful message; this row lock is the final authority.
DO $$
BEGIN
  IF to_regprocedure('public.transition_work_item_unchecked_v1(text,text,text,text,integer,jsonb)') IS NULL THEN
    ALTER FUNCTION public.transition_work_item_v1(text, text, text, text, integer, jsonb)
      RENAME TO transition_work_item_unchecked_v1;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.transition_work_item_unchecked_v1(text, text, text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transition_work_item_v1(
  p_work_item_key text,
  p_actor text,
  p_action text,
  p_idempotency_key text,
  p_expected_version integer DEFAULT NULL,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lane_value text;
BEGIN
  SELECT item.operational_lane INTO lane_value
  FROM public.work_items AS item
  WHERE item.work_item_key = p_work_item_key
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found'; END IF;
  IF lane_value IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'work_item_not_current'; END IF;

  RETURN public.transition_work_item_unchecked_v1(
    p_work_item_key,
    p_actor,
    p_action,
    p_idempotency_key,
    p_expected_version,
    p_patch
  );
END
$$;

REVOKE ALL ON FUNCTION public.transition_work_item_v1(text, text, text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_work_item_v1(text, text, text, text, integer, jsonb)
  TO service_role;
