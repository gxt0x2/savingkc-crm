# SmarterContact Clone — Activation Guide

The module is built as `sc_*` tables + `/api/sc/*` routes + pages under a "Texting"
suite (Messenger, Contacts, Campaigns, Workflows, Skiptrace, Reporting) reachable
from the main nav "Texting" tab. It reuses existing Twilio send (`safeSendSMS`),
suppression (`sms_opt_outs`), delivery logging (`sms_delivery_log`), and template
(`sms_templates`) infrastructure.

Three steps activate it. Steps 1–2 are one-time.

## 1. Apply the database migration (additive-only — no existing tables changed)

The migration adds ~15 `sc_*` tables + helper functions. It touches nothing that
exists today.

Option A — run the migration runner (needs the `node scripts/migrate.mjs` bash
permission, or run it yourself):

```bash
node scripts/migrate.mjs supabase/migrations/20260701_smartercontact_foundation.sql
```

Option B — paste `supabase/migrations/20260701_smartercontact_foundation.sql` into
the Supabase SQL editor and run it. (Requires zero permission changes.)

Verify: `select count(*) from sc_sending_numbers;` should succeed (returns 0).

## 2. Seed the sending-number pool

Once the app is running, seed the pool from the existing Twilio numbers:

```bash
curl -X POST http://localhost:3002/api/sc/numbers -H 'Content-Type: application/json' -d '{"action":"seed"}'
```

Or open **Texting → (Settings) Messaging numbers** and click **Seed from Twilio**.
This imports the 15 numbers from `src/lib/twilio-numbers.ts` as an active pool.

## 3. Schedule the two background workers (send + drip)

The campaign sender and workflow runner are cron routes, already registered in
`vercel.json` to run every minute:

- `/api/cron/sc-campaign-sender` — sends queued campaign messages (throttle + number
  rotation + send windows).
- `/api/cron/sc-workflow-runner` — advances due workflow enrollments.

**Self-hosted (Caddy + `next start` on :3002):** Vercel crons do NOT fire here. Add a
system cron (or the existing external pinger) to hit both every minute with the
`CRON_SECRET`:

```cron
* * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://crm.savingkc.com/api/cron/sc-campaign-sender >/dev/null
* * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://crm.savingkc.com/api/cron/sc-workflow-runner >/dev/null
```

## Notes / optional

- **TEST_MODE**: while `TEST_MODE=true` (or `NODE_ENV=development`), `safeSendSMS` logs
  instead of sending — so campaigns/workflows record messages but don't actually text.
  Set real sending only when ready.
- **Skiptrace provider**: address→phone/email append is a pluggable provider. Set
  `SKIPTRACE_API_URL` + `SKIPTRACE_API_KEY` to enable real appends; otherwise the
  Skiptrace page runs jobs but returns rows unchanged (clearly flagged in the UI).
- **Inbound**: the existing `twilio-sms-webhook` now also mirrors every inbound SMS
  into the unified inbox, sets opt-out on STOP, stops active drips on reply, and fires
  keyword-campaign auto-responders — all fire-and-forget so the existing webhook
  behavior is unchanged.
- **Deliverability**: numbers auto-pause when block rate ≥ 10% over ≥ 50 sends; daily
  caps default to 200/number and reset at date rollover.
