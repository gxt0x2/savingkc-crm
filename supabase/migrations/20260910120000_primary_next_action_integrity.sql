-- Enforce the operating-model invariant for newly created current work:
-- every active opportunity may have at most one pending primary next action.
--
-- This migration is intentionally non-destructive. It does not update, delete,
-- complete, cancel, demote, or otherwise repair any existing source task or
-- work-item row. Existing exceptions remain visible in the reconciliation UI
-- until a separately reviewed repair is approved.

CREATE OR REPLACE FUNCTION public.lead_is_active_opportunity_v1(target_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads AS lead
    LEFT JOIN public.contact_workspace_activity_state AS activity
      ON activity.lead_id = lead.id
    CROSS JOIN LATERAL (
      SELECT
        public.contact_workspace_normalize_stage(lead.station) AS station,
        CASE
          WHEN lower(coalesce(lead.classification, '')) IN ('lead', 'opportunity', 'dead')
            THEN lower(lead.classification)
          ELSE NULL
        END AS classification,
        public.contact_workspace_pipeline_intent_source(
          lead.source,
          activity.pipeline_intent_activity_type,
          activity.pipeline_intent_metadata
        ) AS pipeline_intent_source
    ) AS normalized
    WHERE lead.id = target_lead_id
      AND coalesce(lead.is_parked, false) = false
      AND coalesce(normalized.classification = 'dead', false) = false
      AND normalized.station NOT IN ('dead', 'closed_lost', 'closed_won')
      AND (
        normalized.classification IN ('lead', 'opportunity')
        OR (
          normalized.station = 'new'
          AND normalized.classification IS NULL
          AND normalized.pipeline_intent_source IS NOT NULL
        )
        OR normalized.station IN ('qualified', 'appointment_set', 'offer_made', 'under_contract')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.lead_is_active_opportunity_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_is_active_opportunity_v1(uuid)
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_work_items_current_primary_by_lead
  ON public.work_items (lead_id, work_item_key)
  WHERE lead_id IS NOT NULL
    AND operational_lane = 'current'
    AND status IN ('pending', 'blocked')
    AND primary_next_action = true;

CREATE INDEX IF NOT EXISTS idx_lead_activities_primary_candidate_by_lead
  ON public.lead_activities (lead_id, id)
  WHERE lead_id IS NOT NULL
    AND activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
    AND lower(coalesce(metadata ->> 'primary_next_action', 'false')) = 'true'
    AND public.work_item_status_v1(metadata ->> 'status') IN ('pending', 'blocked');

CREATE OR REPLACE FUNCTION public.primary_next_action_integrity_summary_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH active_opportunities AS MATERIALIZED (
    SELECT lead.id
    FROM public.leads AS lead
    WHERE public.lead_is_active_opportunity_v1(lead.id)
  ), primary_counts AS MATERIALIZED (
    SELECT item.lead_id, count(*)::integer AS primary_count
    FROM public.work_items AS item
    JOIN active_opportunities AS active ON active.id = item.lead_id
    WHERE item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = true
    GROUP BY item.lead_id
  )
  SELECT jsonb_build_object(
    'activeOpportunities', count(*)::integer,
    'opportunitiesWithNoPrimary', count(*) FILTER (WHERE coalesce(primary_counts.primary_count, 0) = 0)::integer,
    'opportunitiesWithOnePrimary', count(*) FILTER (WHERE primary_counts.primary_count = 1)::integer,
    'opportunitiesWithMultiplePrimary', count(*) FILTER (WHERE primary_counts.primary_count > 1)::integer
  )
  FROM active_opportunities AS active
  LEFT JOIN primary_counts ON primary_counts.lead_id = active.id;
$$;

REVOKE ALL ON FUNCTION public.primary_next_action_integrity_summary_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.primary_next_action_integrity_summary_v1()
  TO service_role;

CREATE OR REPLACE FUNCTION public.activity_is_current_primary_next_action_v1(
  activity_kind text,
  target_lead_id uuid,
  metadata_value jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    target_lead_id IS NOT NULL
    AND activity_kind IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
    AND lower(coalesce(metadata_value ->> 'primary_next_action', 'false')) = 'true'
    AND public.work_item_status_v1(metadata_value ->> 'status') IN ('pending', 'blocked')
    AND public.task_provenance_class_v1(coalesce(metadata_value, '{}'::jsonb)) <> 'automation_unreviewed'
    AND lower(coalesce(metadata_value ->> 'legacy_event_review', 'false')) <> 'true'
    AND public.lead_is_active_opportunity_v1(target_lead_id);
$$;

REVOKE ALL ON FUNCTION public.activity_is_current_primary_next_action_v1(text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activity_is_current_primary_next_action_v1(text, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.guard_primary_next_action_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_is_primary boolean := false;
  new_is_primary boolean;
  first_lock uuid;
  second_lock uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_is_primary := public.activity_is_current_primary_next_action_v1(
      OLD.activity_type,
      OLD.lead_id,
      coalesce(OLD.metadata, '{}'::jsonb)
    );
  END IF;
  new_is_primary := public.activity_is_current_primary_next_action_v1(
    NEW.activity_type,
    NEW.lead_id,
    coalesce(NEW.metadata, '{}'::jsonb)
  );

  IF NOT old_is_primary AND NOT new_is_primary THEN
    RETURN NEW;
  END IF;

  first_lock := CASE
    WHEN old_is_primary AND new_is_primary THEN least(OLD.lead_id, NEW.lead_id)
    WHEN old_is_primary THEN OLD.lead_id
    ELSE NEW.lead_id
  END;
  second_lock := CASE
    WHEN old_is_primary AND new_is_primary AND OLD.lead_id IS DISTINCT FROM NEW.lead_id
      THEN greatest(OLD.lead_id, NEW.lead_id)
    ELSE NULL
  END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-next-action:' || first_lock::text, 0)
  );
  IF second_lock IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('primary-next-action:' || second_lock::text, 0)
    );
  END IF;

  IF NOT new_is_primary THEN
    RETURN NEW;
  END IF;

  -- Editing an existing primary task in place does not create another primary.
  -- This exception deliberately preserves editability of historical duplicates.
  IF TG_OP = 'UPDATE'
    AND old_is_primary
    AND OLD.lead_id = NEW.lead_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.work_items AS item
    WHERE item.lead_id = NEW.lead_id
      AND item.operational_lane = 'current'
      AND item.status IN ('pending', 'blocked')
      AND item.primary_next_action = true
      AND NOT (item.source_kind = 'activity' AND item.source_id = NEW.id)
  ) OR EXISTS (
    SELECT 1
    FROM public.lead_activities AS activity
    WHERE activity.lead_id = NEW.lead_id
      AND activity.id <> NEW.id
      AND activity.activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
      AND lower(coalesce(activity.metadata ->> 'primary_next_action', 'false')) = 'true'
      AND public.work_item_status_v1(activity.metadata ->> 'status') IN ('pending', 'blocked')
      AND public.activity_is_current_primary_next_action_v1(
        activity.activity_type,
        activity.lead_id,
        coalesce(activity.metadata, '{}'::jsonb)
      )
  ) THEN
    RAISE EXCEPTION 'primary_next_action_exists';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_primary_next_action_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_primary_next_action_v1()
  TO service_role;

DROP TRIGGER IF EXISTS trigger_guard_primary_next_action_v1 ON public.lead_activities;
CREATE TRIGGER trigger_guard_primary_next_action_v1
BEFORE INSERT OR UPDATE OF lead_id, activity_type, metadata
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.guard_primary_next_action_v1();

-- Keep the projection aligned if an existing source task is relinked.
-- hygiene-approved-destructive: replacing a trigger definition changes no source or projection rows.
DROP TRIGGER IF EXISTS trigger_sync_activity_work_item_v1 ON public.lead_activities;
CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF lead_id, activity_type, description, agent, metadata OR DELETE
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

COMMENT ON FUNCTION public.guard_primary_next_action_v1() IS
  'Prevents newly created duplicate current primary next actions while preserving all existing task rows and their editability.';
