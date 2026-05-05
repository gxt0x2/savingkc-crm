# Reply And Notification Workflow Audit

Date: 2026-05-05
Branch reviewed: `main`
Production URL: `https://crm.savingkc.com`

This is an inventory of the reply, SMS, and notification workflows currently in the CRM, plus the holes that should be fixed or considered next.

## Executive Status

The core Twilio transport is working again. The A2P Messaging Service is approved, production is configured to send through it, inbound SMS webhooks are reachable, and a live test SMS was delivered to the Google Voice test number.

Not every workflow above the transport layer is fully ready. Immediate SMS paths that call `safeSendSMS` should work. Browser push, email, scheduled workers, queued appointment reminders, and Ghost Protocol follow-up have gaps that need attention.

Update: queued SMS has been moved to a forward-only `scheduled_sms_v2` contract. Existing legacy pending SMS rows are intentionally ignored by the sender and should be treated as dead unless manually audited.

## Production Snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Twilio A2P outbound SMS | Verified | Production sends through the approved Messaging Service. Live test SMS delivered. |
| Twilio-owned SMS numbers | Verified with gap | 21 SMS-capable owned numbers are attached to the A2P service and point to `/api/twilio-sms-webhook`. The app static number list only exposes 15 of them. |
| Inbound SMS webhook | Verified | `/api/twilio-sms-webhook` is reachable in production and returns the expected validation/body responses. |
| Missed call webhook | Verified | `/api/twilio-missed-call` is reachable in production. |
| Twilio signature validation | Temporary bypass | `TWILIO_SKIP_SIGNATURE_VALIDATION=true` is enabled in production. Replace the bad/mismatched auth token and turn validation back on. |
| Browser push | Env-gated | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are not configured in production, so push attempts return 0 sent. |
| Email sending | Env-gated | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are not configured in production. Email paths are disabled or fail depending on route. |
| Worker cron coverage | Incomplete | `vercel.json` only schedules `/api/cron/sweep-briefings`. Several workers exist but are not scheduled there. |
| Supabase service key | Verify | Env audit had conflicting signals for `SUPABASE_SERVICE_ROLE_KEY`. Confirm in Vercel before relying on worker/admin flows. |

## Workflow Inventory

### Inbound Replies And Calls

| Workflow | Entry point | Status | What it does | Holes / notes |
| --- | --- | --- | --- | --- |
| General inbound SMS | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Parses inbound SMS, finds or creates a lead, logs activity, triggers agent alerts, and returns TwiML when needed. | Depends on temporary signature bypass until Twilio auth token is corrected. |
| STOP / START compliance | `src/app/api/twilio-sms-webhook/route.ts`, `src/lib/sms-opt-out.ts` | Likely working | STOP-family replies opt out the phone; START/UNSTOP/YES can restore opt-in. | Add periodic opt-out export/check against Twilio compliance records. |
| YES replies | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Treats YES as seller interest, creates/heats lead, enriches from prospect data, sends agent SMS alerts, creates a task, and logs Ari event. | Browser push is attempted but inactive without VAPID keys. |
| CONFIRM replies | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Confirms active appointment when confirmation keywords are received. | Add explicit confirmation notification in the in-app `notifications` table for consistency. |
| Reschedule-style appointment replies | `src/app/api/twilio-sms-webhook/route.ts` | Partial | Detects reschedule language, updates appointment risk/status, and creates a callback task. | Add direct agent notification and a dashboard queue for reschedule requests. |
| Known lead replies | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Logs inbound message and sends Casey/Ernest SMS alerts. | Some alert paths do not inspect `safeSendSMS.success`, so failed alerts can be quiet outside delivery logs. |
| Unknown inbound SMS | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Creates/enriches lead, sends alerts, creates task, logs Ari event, and may send delayed auto-reply. | Add a review queue for unknown inbound messages that could not be enriched. |
| Team number inbound SMS | `src/app/api/twilio-sms-webhook/route.ts` | Likely working | Logs team-number messages and notifies agents without seller auto-reply behavior. | Confirm all team numbers are present in app-side ownership/routing config. |
| Missed calls | `src/app/api/twilio-missed-call/route.ts`, `src/lib/missed-call-messaging.ts` | Likely working | Logs missed calls, sends auto-text follow-up, alerts agents, creates callback task, and enriches unknown callers. | Add a missed-call retry/escalation if no agent task is touched within a target SLA. |
| IVR no answer follow-up | `src/app/api/ivr/dial-result/route.ts` | Likely working | Sends missed-call follow-up texts and agent alerts for no-answer call outcomes. | Verify Twilio voice webhooks are all pointed at production, not only SMS webhooks. |
| IVR cold no-input text | `src/app/api/ivr/cold-no-input/route.ts` | Likely working | Sends "reply YES" style text when a cold outbound IVR gets no input. | Confirm TCPA/A2P copy and opt-out language for this exact flow. |
| Voicemail alerts | `src/app/api/ivr/after-record/route.ts`, `src/app/api/ivr/voicemail-recording/route.ts` | Likely working | Sends urgent SMS alerts and Ari events when voicemail recordings are captured. | Browser push remains inactive until VAPID keys exist. |

### Outbound SMS, Email, And App Notifications

| Workflow | Entry point | Status | What it does | Holes / notes |
| --- | --- | --- | --- | --- |
| Manual CRM conversation SMS | `src/app/api/conversations/send/route.ts` | Likely working | Sends SMS from the conversation UI, checks opt-out/dedup, logs activity, and syncs manifest. | Email side of this route is skipped without Resend env. |
| Conversation email | `src/app/api/conversations/send/route.ts` | Env-gated | Sends email through Resend if configured. | Production lacks Resend env, so email is not active. |
| Website booking confirmation | `src/app/api/book/route.ts` | Likely working | Sends seller confirmation SMS, Casey alert SMS, and push attempt after booking. | Push inactive without VAPID keys; consider adding Ernest or assignment-based alerting. |
| Website lead alert | `src/app/api/leads/route.ts` | Likely working | Sends Casey/Ernest SMS alerts for new website leads. | Add in-app notification row so alerts are visible even if SMS fails. |
| Offer notification | `src/app/api/deals/[slug]/offer/route.ts` | Partial | Creates in-app notification, attempts push, and sends SMS to Ernest company number. | Push inactive without VAPID keys; consider notifying assigned owner/team instead of one fixed number. |
| Buyer broadcast SMS | `src/app/api/broadcasts/send/route.ts` | Partial | Sends SMS broadcasts with round-robin Twilio numbers. | Uses static `TWILIO_NUMBERS`, which only contains 15 of 21 owned SMS-capable numbers. |
| Buyer broadcast email | `src/app/api/broadcasts/send/route.ts` | Env-gated | Sends broadcast email through Resend. | Production lacks Resend env. |
| TC draft SMS | `src/app/api/tc/drafts/[id]/send/route.ts` | Likely working | Sends draft SMS with opt-out/dedup behavior. | Confirm recipient routing and delivery logging in real TC workflow. |
| TC draft email | `src/app/api/tc/drafts/[id]/send/route.ts` | Env-gated / blocking | Requires `RESEND_API_KEY`; route throws when email is requested without it. | Configure Resend or hide/disable email send until configured. |
| EOD SMS | `src/app/api/eod/route.ts` | Likely working if invoked | Sends end-of-day SMS messages through `safeSendSMS`. | Confirm whether anything actually invokes this endpoint. |
| Mojo sync alerts | `src/app/api/mojo/sync/route.ts` | Likely working if invoked | Sends selected sync/error/status SMS notifications. | Confirm scheduling and make failures visible in app, not only SMS/logs. |
| Browser push notifications | `src/lib/push-notifications.ts`, `src/app/api/push/*` | Env-gated | Stores subscriptions and sends push payloads to agents. | Configure VAPID keys, then test `/api/push/test`. |
| In-app notifications | `src/app/api/notifications/*` | Partial | Reads/writes `notifications` table; offer workflow inserts rows. | Most reply/call workflows use SMS, tasks, or `ari_briefing_events` instead of the unified notifications table. |

### Queues, Workers, And Scheduled Jobs

| Workflow | Entry point | Status | What it does | Holes / notes |
| --- | --- | --- | --- | --- |
| SMS sender worker | `src/app/api/workers/sms-sender/route.ts` | Patched; needs live test | Sends pending `scheduled_sms_v2` SMS tasks during office hours, or with `force=true`. | Legacy pending rows are intentionally ignored. Not scheduled in `vercel.json`. |
| Appointment reminder worker | `src/app/api/workers/appointment-reminder/route.ts` | Patched; needs live test | Creates forward-only `scheduled_sms_v2` reminder tasks in `lead_activities`. | Test one new reminder before enabling a schedule. |
| Ghost Protocol appointment follow-up | `src/lib/ghost-protocol-appointment.ts` | Patched; needs live test | Creates forward-only `scheduled_sms_v2` SMS activities for appointment no-show/risk sequences. | Test one newly activated Ghost Protocol path before enabling a schedule. |
| Mojo queue processor | `src/app/api/cron/process-mojo-queue/route.ts` | Needs scheduler verification | Processes Mojo queue work. | File comment says Vercel cron, but `vercel.json` does not schedule it. |
| Mojo sync worker | `src/app/api/workers/mojo-sync/route.ts` | Needs scheduler verification | Runs Mojo sync work. | Not scheduled in `vercel.json`. |
| Hot opportunities cron | `src/app/api/hot-opportunities/cron/route.ts` | Needs scheduler verification | Processes hot opportunity work. | Not scheduled in `vercel.json`. |
| Sweep briefings | `src/app/api/cron/sweep-briefings/route.ts` | Scheduled | Only cron currently present in `vercel.json`, scheduled at `0 13 * * *`. | Confirm the time is still correct for operations. |

## Scheduler Audit

`vercel.json` currently schedules only:

| Endpoint | Schedule |
| --- | --- |
| `/api/cron/sweep-briefings` | `0 13 * * *` |

Endpoints that exist but are not scheduled in `vercel.json`:

| Endpoint | Suggested action |
| --- | --- |
| `/api/workers/sms-sender` | Schedule every 5 minutes during allowed send windows, or run every 5 minutes and let the route enforce office hours. |
| `/api/workers/appointment-reminder` | Schedule every 15-30 minutes after fixing the queued SMS shape. |
| `/api/cron/process-mojo-queue` | Schedule if Mojo queue processing is still required. |
| `/api/workers/mojo-sync` | Schedule based on desired sync freshness. |
| `/api/hot-opportunities/cron` | Schedule if hot opportunity automation is still active. |

If these are already running through an external service such as cron-job.org, document that external scheduler in this repo and add a production health check that shows last successful run.

## Highest Priority Holes

1. Live-test the forward-only queued SMS contract.
   - New producers and `sms-sender` now agree on `scheduled_sms_v2`, `activity_type`, `metadata.status`, due time, rendered body, template, and routing fields.
   - Legacy pending rows are intentionally ignored.

2. Live-test Ghost Protocol appointment SMS tasks.
   - New Ghost Protocol SMS rows use `activity_type: 'sms'` and the forward-only queued SMS contract.
   - Test one new activation before scheduling the worker.

3. Add or verify worker schedules.
   - The app has worker routes, but only one Vercel cron entry.
   - Either add Vercel cron entries or document and monitor the external scheduler.

4. Configure browser push.
   - Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
   - Use `/api/push/test` after deployment.
   - Decide which workflows should also insert durable in-app notification rows.

5. Configure email or disable email UX.
   - Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` if email workflows should be live.
   - Until then, make email-disabled states visible so operators do not assume email went out.

6. Update Twilio number inventory.
   - `src/lib/twilio-numbers.ts` lists 15 numbers, while Twilio has 21 SMS-capable owned numbers configured.
   - Add the missing six numbers or move the inventory to a database/admin-managed source.

7. Restore Twilio signature validation.
   - Current production bypass is useful for getting A2P live, but it should not be the final state.
   - Correct the Twilio auth token/env value and set `TWILIO_SKIP_SIGNATURE_VALIDATION=false`.

8. Standardize SMS failure visibility.
   - `safeSendSMS` returns `{ success: false }` instead of throwing.
   - Important alert flows should inspect the result and create a visible task/notification when delivery fails.

9. Consolidate notifications.
   - High-value events should use a common notification strategy: SMS for urgent, push for real-time, `notifications` table for durable in-app visibility, and tasks for follow-up.
   - Today many flows use only one or two of those channels.

10. Add a communications health dashboard.
    - Show Twilio service sender count, webhook status, signature validation status, VAPID configured, Resend configured, last worker runs, pending queue age, failed SMS count, and external cron status.

## Workflows To Consider Adding

| Opportunity | Why it matters |
| --- | --- |
| Reply triage dashboard | Put new replies, unknown replies, reschedule requests, and failed alerts in one operator queue. |
| Failed SMS retry queue | Twilio/API failures should retry safely and escalate after repeated failure. |
| Queue age monitor | Pending reminders or Ghost Protocol texts should alert if they sit unsent beyond SLA. |
| HELP keyword response | A2P programs commonly support HELP responses; add a compliant auto-reply if not already handled elsewhere. |
| Assignment-aware alerts | Route alerts to assigned agent first, with Casey/Ernest fallback. |
| In-app notification parity | Any SMS/push alert should usually have a durable in-app notification too. |
| External scheduler registry | If cron-job.org or another scheduler is used, document endpoint, cadence, auth method, and last-success monitoring. |
| Communications test suite | Add tests for STOP/START, YES, CONFIRM, unknown inbound, missed call, queued reminder, and Ghost Protocol task creation. |

## Minimal Test Plan

Run these after the worker fixes and env updates:

1. Send an outbound CRM conversation SMS to the test number and confirm Twilio delivery plus `sms_delivery_log`.
2. Reply `YES` and confirm lead status, agent SMS alerts, task creation, and Ari event.
3. Reply `STOP`, then verify opt-out prevents manual SMS sends.
4. Reply `START`, then verify opt-in restores sends.
5. Trigger a missed call and verify seller auto-text, agent alert, callback task, and lead activity.
6. Create an appointment reminder task, run `/api/workers/sms-sender?force=true`, and verify the actual rendered reminder body is sent.
7. Trigger Ghost Protocol task creation, run the sender, and verify follow-up texts are picked up.
8. Configure VAPID keys, subscribe a browser, and run `/api/push/test`.
9. Configure Resend and send one TC draft email plus one conversation email.
10. Check cron/worker monitoring for last successful run and pending queue age.

## Source Map

Core sending and compliance:

- `src/lib/safe-communications.ts`
- `src/lib/queued-sms.ts`
- `src/lib/twilio-validate.ts`
- `src/lib/sms-opt-out.ts`
- `src/lib/sms-dedup.ts`
- `src/lib/twilio-numbers.ts`

Reply and call handling:

- `src/app/api/twilio-sms-webhook/route.ts`
- `src/app/api/twilio-missed-call/route.ts`
- `src/lib/missed-call-messaging.ts`
- `src/app/api/ivr/dial-result/route.ts`
- `src/app/api/ivr/cold-no-input/route.ts`
- `src/app/api/ivr/after-record/route.ts`
- `src/app/api/ivr/voicemail-recording/route.ts`

Outbound notifications:

- `src/app/api/conversations/send/route.ts`
- `src/app/api/book/route.ts`
- `src/app/api/leads/route.ts`
- `src/app/api/deals/[slug]/offer/route.ts`
- `src/app/api/broadcasts/send/route.ts`
- `src/app/api/tc/drafts/[id]/send/route.ts`
- `src/app/api/eod/route.ts`
- `src/app/api/mojo/sync/route.ts`

Workers and schedules:

- `src/app/api/workers/sms-sender/route.ts`
- `src/app/api/workers/appointment-reminder/route.ts`
- `src/lib/ghost-protocol-appointment.ts`
- `src/app/api/cron/process-mojo-queue/route.ts`
- `src/app/api/workers/mojo-sync/route.ts`
- `src/app/api/hot-opportunities/cron/route.ts`
- `vercel.json`

Push and in-app notification:

- `src/lib/push-notifications.ts`
- `src/hooks/use-push-notifications.ts`
- `src/app/api/push/subscribe/route.ts`
- `src/app/api/push/test/route.ts`
- `src/app/api/notifications/route.ts`
