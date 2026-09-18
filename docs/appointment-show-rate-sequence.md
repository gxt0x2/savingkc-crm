# Appointment show-rate sequence

Ghost Protocol v3 is enrolled atomically when the CRM appointment editor saves with reminders enabled. Existing appointments are not enrolled by the migration. Imported, public booking and inferred appointments retain their current behavior until those entry points explicitly adopt this opt-in contract.

| Step | Timing | Behavior |
| --- | --- | --- |
| Booking | Next worker tick | SMS and transactional email, using seller first name, assigned rep and CRM reply number. Rep photo is included when available. |
| Confirmation | 24 hours before | Ask for YES. Skip if within two hours of booking or already confirmed. Overnight requests move into daytime. |
| Silence | Four hours after actual SMS acceptance | Create one rep callback, set appointment risk, retain the risk for reporting. Call work starts no earlier than 8:30 AM Central. |
| Morning | 8 AM America/Chicago | Reminder; skip if booked within two hours, appointment passed, or too close to arrival. |
| Escalation | Morning | Raise the open confirmation callback to urgent and create a CRM notification naming the rep. |
| Arrival | 52 minutes before | Automatic “On my way” SMS for in-person visits. Short-notice or pre-8 AM sends are skipped. |

The existing `/api/workers/workflow-runs` worker runs once per minute. Due timestamps are exact; provider submission can follow by one tick and delivery depends on the provider. Reminders more than 15 minutes late are skipped. No separate cron endpoint is added.

Short-notice booking SMS asks for YES directly. Unclear responses stay in Conversations for rep review. Explicit negatives or reschedule requests stop reminders and create a callback. Requests do not assert that a new time has been booked. Cancellation and completion stop queued steps. Editing the selected appointment atomically increments its sequence version and stops old steps. Confirmations are idempotent by inbound message ID; ambiguous multiple appointments require rep review.

Call completion requires a line in task notes such as `Call outcome: confirmed`, `Call outcome: voicemail`, or `Call outcome: reschedule requested`. Confirmed calls update the appointment; reschedule requests stop reminders. Historical risk remains attached to the appointment and is included in outcome activity metadata and the service-only `appointment_show_rate_facts` reporting view.

Each step records queue, skip, failure, uncertain, and provider-accepted results on the lead activity timeline. SMS/email content is also recorded. `sent` means provider acceptance, not handset/inbox delivery. A worker interrupted after claiming a step records an uncertain outcome and raises a CRM alert; it does not automatically submit the same message again.

## Release requirements

1. Apply `20261106120000_appointment_show_rate_sequence.sql` before deploying the code. It adds columns, step storage, triggers, and service-role-only functions; it creates no historical sends.
2. Verify production `RESEND_API_KEY` and `RESEND_FROM_EMAIL` identify the intended verified transactional sender. This sequence does not enable marketing sending. Verify each assigned rep's canonical CRM number accepts SMS and inbound replies.
3. Deploy the reviewed code and once-per-minute existing worker schedule with its existing authorization.
4. Run a newly authorized controlled appointment using the owner's number/email. Verify provider acceptance, physical receipt, YES, reschedule, cancellation, escalation and rep task completion. Do not replay the September 14 appointment.

## Verification

- Vitest: appointment sequence worker/copy/replies, booking/outcome commands, modal, Twilio webhook and workflow catalog/worker tests.
- TypeScript and scoped ESLint.
- PostgreSQL: `createdb <disposable_database>` then `psql -d <disposable_database> -f tests/appointment-sequence-db.sql`. The fixture uses lightweight existing-table stand-ins and exercises the actual migration functions and triggers. It must only run in an empty local database; it does not prove production schema compatibility.
