-- Quarantine explicit automation-generated tasks in the rebuildable work-item
-- projection. Source task rows, status, assignee, due date, and content are not
-- changed. Unknown and unattributed provenance stays visible for human review.

ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_operational_lane_check;

CREATE OR REPLACE FUNCTION public.set_work_item_operational_lane_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.operational_lane := CASE
    WHEN public.task_provenance_class_v1(NEW.source_metadata) = 'automation_unreviewed' THEN 'quarantine'
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

DROP TRIGGER IF EXISTS trigger_set_work_item_operational_lane_v1 ON public.work_items;
CREATE TRIGGER trigger_set_work_item_operational_lane_v1
BEFORE INSERT OR UPDATE OF lead_id, source_metadata ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.set_work_item_operational_lane_v1();

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
  SET operational_lane = next_lane,
      updated_at = now()
  WHERE lead_id = NEW.id
    AND public.task_provenance_class_v1(source_metadata) <> 'automation_unreviewed'
    AND operational_lane IS DISTINCT FROM next_lane;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_work_item_operational_lane_from_lead_v1() TO service_role;

UPDATE public.work_items AS item
SET operational_lane = CASE
  WHEN public.task_provenance_class_v1(item.source_metadata) = 'automation_unreviewed' THEN 'quarantine'
  WHEN EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = item.lead_id
      AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
      AND lower(coalesce(lead.classification, '')) <> 'dead'
  ) THEN 'current'
  ELSE 'review'
END
WHERE item.operational_lane IS DISTINCT FROM CASE
  WHEN public.task_provenance_class_v1(item.source_metadata) = 'automation_unreviewed' THEN 'quarantine'
  WHEN EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.id = item.lead_id
      AND lower(coalesce(lead.station, '')) NOT IN ('dead', 'closed', 'closed_lost')
      AND lower(coalesce(lead.classification, '')) <> 'dead'
  ) THEN 'current'
  ELSE 'review'
END;

ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_operational_lane_check
  CHECK (operational_lane IN ('current', 'review', 'quarantine')) NOT VALID;
ALTER TABLE public.work_items VALIDATE CONSTRAINT work_items_operational_lane_check;

-- Extend the established indexed query without copying its large definition.
-- The exact-string assertions make schema drift fail closed.
DO $$
DECLARE
  function_signature regprocedure := 'public.task_worklist_page_v2(text,text,text,text,text,text[],text,text,integer,timestamptz,timestamptz,timestamptz,text,text,boolean,text)'::regprocedure;
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(function_signature) INTO function_definition;

  IF position('''operationalLane'', row.operational_lane' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      '''primaryNextAction'', row.primary_next_action, ''version'', row.version,',
      '''primaryNextAction'', row.primary_next_action, ''version'', row.version, ''operationalLane'', row.operational_lane,'
    );
  END IF;

  IF position('''quarantine''' IN function_definition) = 0 THEN
    function_definition := replace(
      function_definition,
      'IF clean_lane NOT IN (''current'', ''review'', ''all'')',
      'IF clean_lane NOT IN (''current'', ''review'', ''quarantine'', ''all'')'
    );
  END IF;

  IF position('''operationalLane'', row.operational_lane' IN function_definition) = 0
    OR position('''quarantine''' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'task_worklist_page_v2 quarantine contract could not be installed';
  END IF;

  EXECUTE function_definition;
END
$$;

REVOKE ALL ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_worklist_page_v2(text, text, text, text, text, text[], text, text, integer, timestamptz, timestamptz, timestamptz, text, text, boolean, text)
  TO service_role;

COMMENT ON COLUMN public.work_items.operational_lane IS
  'Read-model lane only: current, lifecycle review debt, or explicit automation quarantine. Source task state is unchanged.';
