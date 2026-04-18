-- Phase 3/4 foundations for the V2.1 manifest refactor.
-- See docs/manifest-v2-1-spec/ for the full specification.
--
-- This migration is ADDITIVE ONLY. It does not revoke any existing permissions,
-- does not enable any triggers, and does not break the existing write path.
-- The lockdown (GRANT revoke + trigger) lands in a separate migration AFTER every
-- caller has migrated to the new API.

-- ─── 1. Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 2. Dedicated roles ───────────────────────────────────────────────────────
-- cascade_writer: owns update_manifest_and_cascade via SECURITY DEFINER.
-- manifest_migrator: time-boxed grant during Phase 7/8 migration only.
-- Both are NOLOGIN; no one authenticates as these roles directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cascade_writer') THEN
    CREATE ROLE cascade_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manifest_migrator') THEN
    CREATE ROLE manifest_migrator NOLOGIN;
  END IF;
END
$$;

-- ─── 3. manifest_history audit table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manifest_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL,
  reason      text,
  diff        jsonb NOT NULL,
  prior_hash  text NOT NULL
);

CREATE INDEX IF NOT EXISTS manifest_history_manifest_id_updated_at_idx
  ON manifest_history (manifest_id, updated_at DESC);

-- Reads open, writes tightly scoped.
GRANT SELECT ON manifest_history TO service_role, authenticated;
GRANT INSERT ON manifest_history TO cascade_writer, manifest_migrator;

-- ─── 4. is_hot_eligible column on manifests ──────────────────────────────────
-- New in V2.1 — mirrors manifest.hot_eligibility.verdict === 'eligible'.
-- Stays nullable until the migration backfills it.
ALTER TABLE manifests
  ADD COLUMN IF NOT EXISTS is_hot_eligible boolean;

CREATE INDEX IF NOT EXISTS manifests_is_hot_eligible_idx
  ON manifests (is_hot_eligible) WHERE is_hot_eligible IS TRUE;

-- ─── 5. update_manifest_and_cascade RPC ──────────────────────────────────────
-- SECURITY DEFINER function owned by cascade_writer. SET search_path closes
-- the search-path hijack vector. The function is the atomic write path:
-- shallow-replace per subtree, history row in the same transaction, denormalized
-- column sync. Callers cannot express a deep merge because they pass discrete
-- subtrees, not a mutator over the full object.
CREATE OR REPLACE FUNCTION update_manifest_and_cascade(
  p_manifest_id uuid,
  p_subtrees    jsonb,
  p_actor       text,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_next       jsonb;
  v_prior_hash text;
  v_subtree    record;
BEGIN
  -- 1. Row-level lock on the existing manifest.
  SELECT manifest INTO v_existing
  FROM manifests
  WHERE id = p_manifest_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'Manifest not found: %', p_manifest_id;
  END IF;

  v_prior_hash := encode(digest(v_existing::text, 'sha256'), 'hex');

  -- 2. Strip derived fields from the caller payload.
  -- Callers cannot write hot_eligibility, completeness, or next_action.description
  -- directly. The TS wrapper is the primary stripper; this is defense in depth.
  p_subtrees := p_subtrees
    - 'hot_eligibility'
    - 'completeness';
  -- next_action is allowed (callers set it) but its derived sub-fields are
  -- recomputed by the wrapper before calling; nothing to strip here.

  -- 3. Shallow per-subtree replacement. NOT a deep merge. If the caller wants
  -- to preserve sibling keys inside a subtree, they must include them in the
  -- payload — this is the doctrine that kills the self-nesting bug class.
  v_next := v_existing;
  FOR v_subtree IN SELECT key, value FROM jsonb_each(p_subtrees) LOOP
    v_next := jsonb_set(v_next, ARRAY[v_subtree.key], v_subtree.value, true);
  END LOOP;

  -- 4. Audit row BEFORE the write. If the insert fails the whole transaction rolls back.
  INSERT INTO manifest_history (manifest_id, actor, reason, diff, prior_hash)
  VALUES (
    p_manifest_id,
    p_actor,
    p_reason,
    jsonb_build_object('before', v_existing, 'after', v_next),
    v_prior_hash
  );

  -- 5. Update the row. Denormalized columns are sync'd from known paths in
  -- the JSONB. Paths match the existing V2 layout (currentStation, priority,
  -- pipeline.appointment, scoring.*). Post-V2.1 migration these paths will
  -- shift to the new layout (pipeline.current_station etc.) and this function
  -- must be updated in lockstep.
  UPDATE manifests
  SET
    manifest             = v_next,
    updated_at           = now(),
    current_station      = COALESCE(v_next->>'currentStation', current_station),
    priority             = COALESCE(v_next->>'priority', priority),
    tier                 = COALESCE(v_next->>'tier', tier),
    qualification_score  = COALESCE(
      NULLIF(v_next->>'qualificationScore', '')::numeric,
      qualification_score
    ),
    next_appointment_at  = COALESCE(
      NULLIF(v_next->'pipeline'->'appointment'->>'scheduledAt', '')::timestamptz,
      next_appointment_at
    ),
    appointment_status   = COALESCE(
      v_next->'pipeline'->'appointment'->>'status',
      appointment_status
    ),
    opportunity_score    = COALESCE(
      NULLIF(v_next->'scoring'->>'opportunity_score', '')::numeric,
      opportunity_score
    ),
    classification       = COALESCE(
      v_next->'scoring'->>'classification',
      classification
    ),
    is_hot_eligible      = CASE
      WHEN v_next->'hot_eligibility'->>'verdict' = 'eligible' THEN TRUE
      WHEN v_next->'hot_eligibility'->>'verdict' IS NOT NULL THEN FALSE
      ELSE is_hot_eligible
    END
  WHERE id = p_manifest_id;

  RETURN v_next;
END;
$$;

-- ─── 6. Ownership and permissions on the RPC ─────────────────────────────────
ALTER FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  OWNER TO cascade_writer;

-- Revoke from defaults; grant EXECUTE only to the app role.
REVOKE EXECUTE ON FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  TO service_role, authenticated;

-- Also grant the writer role the actual table-level write permission it needs
-- when the function runs under its identity. (With SECURITY DEFINER, the
-- function runs as its owner; the owner must have the privileges.)
GRANT INSERT, UPDATE, DELETE ON manifests         TO cascade_writer, manifest_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cascade_writer, manifest_migrator;

-- ─── 7. NOT YET APPLIED in this migration ────────────────────────────────────
-- The GRANT revocations from service_role/authenticated on the manifests table,
-- and the assert_cascade_actor trigger, live in a separate "lockdown" migration
-- that runs ONLY after every caller has been migrated to call this RPC instead
-- of writing directly. That migration is in:
--   supabase/migrations/20260418_manifest_v2_1_lockdown.sql  (to be created in Phase 5)
-- Applying it prematurely would lock the app out of its own database.

COMMENT ON FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text) IS
  'V2.1 canonical write path. Shallow per-subtree replace, atomic history row, denormalized column sync. See docs/manifest-v2-1-spec/05_WRITE_PATH_AUDIT.md.';

COMMENT ON TABLE manifest_history IS
  'Append-only audit log of manifest changes. One row per update_manifest_and_cascade call. See docs/manifest-v2-1-spec/04_MIGRATION_PLAN.md.';
