-- ============================================================
-- DIALER REDESIGN
--   1. Verified-contact tracking on heir phones (prospect_phones)
--   2. Dead-lead reason tracking on leads ("mark as dead + why")
--   3. Repair / re-assert dialer_saved_lists resume-state columns so
--      "resume where I left off" actually persists server-side.
-- ============================================================

-- ------------------------------------------------------------
-- 1. prospect_phones: explicit "this number is verified to be the
--    heir's" signal. Auto-set when a "reached" disposition is logged,
--    and manually toggleable by the agent (verified_source = 'manual'
--    wins so a human override is never clobbered by automation).
-- ------------------------------------------------------------
ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS is_verified_contact boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by         text,
  ADD COLUMN IF NOT EXISTS verified_source     text;  -- 'auto' | 'manual' | null

CREATE INDEX IF NOT EXISTS idx_prospect_phones_verified
  ON public.prospect_phones (prospect_id)
  WHERE is_verified_contact = true;

-- ------------------------------------------------------------
-- 2. leads: why a lead was marked dead, plus when/who. The 'dead'
--    station already exists (leads_station_check); this adds the
--    "why" the dialer redesign captures.
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS dead_reason text,
  ADD COLUMN IF NOT EXISTS dead_at     timestamptz,
  ADD COLUMN IF NOT EXISTS dead_by     text;

-- ------------------------------------------------------------
-- 3. dialer_saved_lists resume-state (idempotent re-assert).
--    These were introduced in 20260430_dialer_saved_lists_resume_state.sql
--    but if that migration never reached an environment, "resume where I
--    left off" silently falls back to the start. Re-running here is safe.
-- ------------------------------------------------------------
ALTER TABLE public.dialer_saved_lists
  ADD COLUMN IF NOT EXISTS caller_id         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS session_lead_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resume_index      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_lead_id    TEXT,
  ADD COLUMN IF NOT EXISTS resume_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_completed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_dialer_saved_lists_resume_updated_at
  ON public.dialer_saved_lists (resume_updated_at DESC NULLS LAST);
