-- Manifest → Leads cascade trigger
-- Safety net: whenever manifests.manifest is updated, sync derived fields to leads table.
-- This catches any code path that writes manifests directly without going through saveManifest().

CREATE OR REPLACE FUNCTION sync_manifest_to_lead()
RETURNS TRIGGER AS $$
DECLARE
  v_station TEXT;
  v_priority TEXT;
  v_motivation_score INT;
  v_lead_id UUID;
BEGIN
  v_lead_id := NEW.lead_id;
  IF v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Extract derived fields from the manifest JSONB
  v_station := NEW.manifest->>'currentStation';
  v_priority := NEW.manifest->>'priority';
  v_motivation_score := (NEW.manifest->'situation'->'motivation'->>'score')::INT;

  -- Build dynamic update (only set fields that exist in manifest)
  UPDATE leads SET
    station = COALESCE(v_station, station),
    priority = COALESCE(v_priority, priority),
    motivation_score = CASE
      WHEN v_motivation_score IS NOT NULL AND v_motivation_score >= 1
      THEN v_motivation_score
      ELSE motivation_score
    END
  WHERE id = v_lead_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to make this idempotent
DROP TRIGGER IF EXISTS trg_manifest_cascade_to_lead ON manifests;

CREATE TRIGGER trg_manifest_cascade_to_lead
  AFTER INSERT OR UPDATE OF manifest ON manifests
  FOR EACH ROW
  EXECUTE FUNCTION sync_manifest_to_lead();
