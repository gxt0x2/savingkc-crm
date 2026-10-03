-- Give concurrent Twilio retries a database-enforced idempotency boundary.
-- The source/version predicate limits this index to rows written by the
-- versioned webhook path, so historic duplicate provider ids do not block it.
CREATE UNIQUE INDEX IF NOT EXISTS lead_activities_twilio_inbound_message_sid_v2
  ON public.lead_activities ((metadata->>'message_sid'))
  WHERE activity_type = 'sms'
    AND metadata->>'inbound_webhook_source' = 'twilio_sms_webhook'
    AND metadata->>'inbound_webhook_version' = '2'
    AND nullif(metadata->>'message_sid', '') IS NOT NULL;
