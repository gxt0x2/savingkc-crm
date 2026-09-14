# Assigned-agent SMS alerts

Confirmed email callback handoffs enqueue an SMS when CRM Lead linking and assignment succeed. Held reviews do not send. The existing shared Twilio sender is reused; marketing sending remains independently controlled.

Production requires `EMAIL_LEAD_SMS_ENABLED=true`, hosted workflow mode, the receiving worker's configured owner, and existing Twilio credentials. Preview, development and TEST_MODE disable provider sends. The workspace command schedules immediate processing after the response; the existing minute worker drains remaining work and checks escalation deadlines.

One durable outbox row exists per handoff, recipient and owner/backup phase. Before submission, the worker checks active membership/profile, current Lead and task ownership, pending callback state, and notification acknowledgment. Agent phone comes from the linked CRM profile. Missing phones and provider failures create visible CRM alerts for the recipient and workspace owners. Provider ambiguity is held for reconciliation, never automatically resent.

The assigned agent receives a direct link to the email conversation. The backup receives a Lead link after the configured urgent response window, honoring team business hours, if the owner has not acknowledged the notification or accepted the callback. This does not reassign the Lead. Controlled setup test messages are explicitly labeled.

Twilio delivery receipts use `/api/webhooks/email/lead-sms?id=<alert-id>`. Signature, saved destination and provider SID are validated; a delivered receipt cannot be downgraded by an older status. A provider submission is recorded as accepted, not delivered. Delivery does not prove the agent read the SMS.

Apply `20260914190000_email_lead_sms_alerts.sql` before releasing enabled code. It does not backfill old notifications. Disable the feature flag and redeploy to pause new submissions; delivery receipts remain available for already submitted messages. Inspect `em_lead_sms_alerts` and the provider SID before resolving any unknown submission. Do not reset it to queued without confirming the original was not sent.

Validation: database tests cover concurrent workers, duplicate notices, held conversion, stale assignments, revoked membership, acceptance, backup timing, missing phone, provider ambiguity, signed receipt handling, early delivery receipts and preview guards. Live acceptance additionally requires a controlled assigned-agent SMS and a genuine provider delivery receipt.
