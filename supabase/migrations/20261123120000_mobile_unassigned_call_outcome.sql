-- Phone-level mobile call outcomes have no lead. One agent, phone, and
-- clientCallId is one row, so an outbox retry updates the outcome instead of
-- inserting a second call. Lead-attached activities are outside this index.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_activities_mobile_unassigned_call
  ON public.lead_activities (
    (metadata ->> 'userId'),
    (metadata ->> 'phone'),
    (metadata ->> 'clientCallId')
  )
  WHERE lead_id IS NULL
    AND activity_type = 'call'
    AND metadata ->> 'source' = 'savingkc_mobile'
    AND COALESCE(metadata ->> 'userId', '') <> ''
    AND COALESCE(metadata ->> 'phone', '') <> ''
    AND COALESCE(metadata ->> 'clientCallId', '') <> '';
