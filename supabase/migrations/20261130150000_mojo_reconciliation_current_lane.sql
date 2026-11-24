-- Mojo integrity: count only operational ("current") work on dead leads.
--
-- work_items in the 'review' and 'quarantine' lanes are preserved,
-- non-operational evidence (phase_zero_current_work_only). They are not shown
-- to agents and the governed transition_work_item_v1 refuses to touch them.
-- The reconciliation snapshot still counted them in deadCurrentWorkItems, so
-- three review-lane tasks on dead leads kept recovery exhausting on
-- 'integrity' every minute with an issue no agent could clear.
--
-- Guarded in-place patch of the live function body: refuses if the expected
-- clause is missing, and is a no-op once applied.
DO $migration$
DECLARE
  target regprocedure := 'public.crm_mojo_reconciliation_snapshot_base_v1(timestamp with time zone)'::regprocedure;
  definition text := pg_get_functiondef(target);
  needle constant text := 'AND work.primary_next_action = true';
BEGIN
  IF position('work.operational_lane' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION 'mojo reconciliation snapshot no longer matches; dead_current_work_items clause not found exactly once';
  END IF;
  EXECUTE replace(definition, needle, needle || E'\n      AND work.operational_lane = ''current''');
END
$migration$;
