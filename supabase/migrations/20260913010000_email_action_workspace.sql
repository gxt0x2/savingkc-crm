-- Local action workspace. Calendar/provider execution remains disabled.
ALTER TABLE public.em_handoffs
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD COLUMN scheduled_for timestamptz;
ALTER TABLE public.em_handoffs DROP CONSTRAINT em_handoffs_state_check;
ALTER TABLE public.em_handoffs ADD CONSTRAINT em_handoffs_state_check
  CHECK (state IN ('needs_contact','acknowledged','held','completed'));
ALTER TABLE public.em_threads DROP CONSTRAINT em_threads_state_check;
ALTER TABLE public.em_threads ADD CONSTRAINT em_threads_state_check
  CHECK (state IN ('waiting','needs_review','human','stopped','done'));
