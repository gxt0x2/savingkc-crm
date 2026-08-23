-- One provider-authorized dial attempt may create several evidence kinds
-- (call, appointment, status changes), but never two rows for the same kind.
-- The action discriminator keeps mark_dead and mark_as_lead independently
-- retryable inside one heir-dialer attempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_dial_attempt_evidence
  ON public.lead_activities (
    lead_id,
    activity_type,
    (metadata ->> 'source'),
    (metadata ->> 'client_attempt_id'),
    (COALESCE(metadata ->> 'action', ''))
  )
  WHERE metadata ->> 'client_attempt_id' IS NOT NULL
    AND metadata ->> 'source' IN ('telephony_bar', 'call_disposition', 'heir_dialer');
