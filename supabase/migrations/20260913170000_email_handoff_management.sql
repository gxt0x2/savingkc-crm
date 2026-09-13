-- Local handoff-management continuation. Clarification and access-hold
-- reasons stay on the Email handoff. No production apply.
ALTER TABLE public.em_handoffs
  ADD COLUMN clarification_question text,
  ADD COLUMN clarification_reviewer_id uuid,
  ADD COLUMN access_hold_reason text;
ALTER TABLE public.em_handoffs
  ADD CONSTRAINT em_handoffs_access_hold_reason_check CHECK (
    access_hold_reason IS NULL OR access_hold_reason IN (
      'team_role_changed', 'marketing_stopped', 'clarification_required'
    )
  );
ALTER TABLE public.em_handoffs
  ADD CONSTRAINT em_handoffs_clarification_reviewer_fk
  FOREIGN KEY (workspace_id, clarification_reviewer_id)
  REFERENCES public.em_memberships(workspace_id, auth_user_id);
