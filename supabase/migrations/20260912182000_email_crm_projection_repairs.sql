-- Durable, server-only repair state for optional Email-to-CRM projections.
-- Core Email commands may commit after these projections fail; the application
-- retries only the recorded local database obligations in a later transaction.

CREATE TABLE public.em_crm_projection_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'resolved')),
  history_required boolean NOT NULL DEFAULT false,
  callback_hold_required boolean NOT NULL DEFAULT false,
  callback_hold_reason text
    CHECK (
      callback_hold_reason IS NULL
      OR callback_hold_reason IN ('marketing_stopped', 'team_role_changed')
    ),
  last_error_code text NOT NULL
    CHECK (
      char_length(last_error_code) BETWEEN 1 AND 100
      AND last_error_code ~ '^[A-Z][A-Z0-9_]*$'
    ),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  first_failed_at timestamptz NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  last_failed_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, thread_id),
  FOREIGN KEY (workspace_id, thread_id)
    REFERENCES public.em_threads(workspace_id, id) ON DELETE CASCADE,
  CHECK (
    (
      state = 'pending'
      AND (history_required OR callback_hold_required)
      AND resolved_at IS NULL
    )
    OR (
      state = 'resolved'
      AND NOT history_required
      AND NOT callback_hold_required
      AND resolved_at IS NOT NULL
    )
  ),
  CHECK (
    (callback_hold_required AND callback_hold_reason IS NOT NULL)
    OR (NOT callback_hold_required AND callback_hold_reason IS NULL)
  )
);

CREATE INDEX em_crm_projection_repairs_pending_idx
  ON public.em_crm_projection_repairs (
    workspace_id,
    last_failed_at,
    thread_id
  )
  WHERE state = 'pending';

ALTER TABLE public.em_crm_projection_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.em_crm_projection_repairs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.em_crm_projection_repairs
  TO service_role;

CREATE POLICY "Service role full access on em_crm_projection_repairs"
  ON public.em_crm_projection_repairs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.em_crm_projection_repairs IS
  'Private retry state for Email history and callback-hold projections that failed after the core Email state changed.';
COMMENT ON COLUMN public.em_crm_projection_repairs.history_required IS
  'True only while immutable Email messages still need projection to canonical Lead history.';
COMMENT ON COLUMN public.em_crm_projection_repairs.callback_hold_required IS
  'True only while an Email-created callback work item still needs its local CRM hold.';
COMMENT ON COLUMN public.em_crm_projection_repairs.last_error_code IS
  'Sanitized application error code only; raw database or message content is never stored.';
