-- ============================================================
-- LEAD INTAKE / ALERT AUDIT SCHEMA COMPATIBILITY
--   1. Website/PPC form intake persists partial/final form state.
--   2. Session-based partial rows can merge into final submits.
--   3. Dead-lead reason fields are re-asserted for production drift.
--
-- This migration is intentionally narrow and idempotent so environments that
-- already received these columns are unchanged.
-- ============================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS form_status text,
  ADD COLUMN IF NOT EXISTS session_id  text,
  ADD COLUMN IF NOT EXISTS dead_reason text,
  ADD COLUMN IF NOT EXISTS dead_at     timestamptz,
  ADD COLUMN IF NOT EXISTS dead_by     text;

CREATE INDEX IF NOT EXISTS idx_leads_form_status
  ON public.leads (form_status)
  WHERE form_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_session_id
  ON public.leads (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_dead_reason
  ON public.leads (dead_reason)
  WHERE dead_reason IS NOT NULL;
