# SavingKC CRM Cleanup: Google and Twilio Alert Checkpoint

Date: 2026-05-01

No secret values are recorded in this document.

## GitHub Alerts Covered

Repository: `gxt0x2/savingkc-crm`

| Alert | Type | State | Assessment |
| --- | --- | --- | --- |
| #1 | Google API key | Open | Current source uses env vars, but the active Google Cloud key is too broad and lacks browser/referrer restrictions |
| #3 | Twilio Account SID | Open | Current source no longer needs hardcoded SID values, but Twilio production webhook inventory found stale SMS callback URLs |

## Google API Key Findings

Google Cloud project inspected: `savingkc-chat-bot`.

Only one API key was listed in the active project.

Current key metadata:

- Has API target restrictions.
- Does not show browser/referrer restrictions.
- Allows many APIs beyond current CRM map usage, including storage, BigQuery, logging, monitoring, Chat, YouTube, and broad Google Cloud APIs.
- Vercel has `NEXT_PUBLIC_GMAPS_KEY` and `GOOGLE_MAPS_API_KEY` configured for Production, Preview, and Development.
- Live CRM bundles checked from `crm.savingkc.com`, `/dialer`, and `/login` did not expose a raw Google API key in the scanned script chunks.

Current CRM map usage appears to require:

- Geocoding API.
- Maps Embed API.
- Street View Static API.
- Maps Static API for the server route `src/app/api/maps/static/route.ts`.

## Google Recommendation

Do not resolve GitHub alert #1 yet.

Recommended safer path:

1. Create a new browser-restricted key for `NEXT_PUBLIC_GMAPS_KEY`.
2. Limit browser referrers to SavingKC CRM production and approved preview/dev origins.
3. Limit browser key API targets to the browser-used map APIs only.
4. Create or assign a separate server-only key for `GOOGLE_MAPS_API_KEY`.
5. Limit server key API targets to server-side map APIs only.
6. Update Vercel env vars.
7. Redeploy and test map/street-view flows.
8. Disable or delete the old broad key after the new keys are verified.

This requires action-time confirmation because it creates/changes persistent Google Cloud access keys.

## Twilio Findings

Read-only Twilio inventory using the available API key/secret succeeded for phone numbers and TwiML apps.

Observed state:

- CRM TwiML app `SavingKC CRM` points voice calls to `crm.savingkc.com`.
- All inspected incoming phone numbers point voice callbacks to `crm.savingkc.com`.
- All inspected incoming phone numbers point SMS callbacks to a temporary `trycloudflare.com` tunnel.
- Existing `scripts/set-sms-webhooks.ts` is intended to point SMS webhooks to `https://crm.savingkc.com/api/twilio-sms-webhook`.
- The local account auth token in ignored env files failed Twilio REST authentication, so API key/secret is the reliable automation path for read-only inventory.

## Twilio Recommendation

Do not resolve GitHub alert #3 yet.

Recommended immediate production fix:

1. Update all Twilio incoming-phone-number SMS webhook URLs to `https://crm.savingkc.com/api/twilio-sms-webhook`.
2. Keep voice callbacks unchanged because they already point to `crm.savingkc.com`.
3. Re-run:
   - Twilio incoming-number webhook inventory.
   - `npm run gate:twilio -- --base-url=https://crm.savingkc.com`.
   - `npm run gate:edge -- --base-url=https://crm.savingkc.com`.
4. Send or simulate a low-risk SMS webhook test only after confirming the route behavior.
5. Resolve alert #3 only after Twilio credential rotation/restriction status is confirmed.

This requires action-time confirmation because it changes live Twilio production webhook configuration.

## Rollback

Google:

1. Restore previous Vercel env values.
2. Re-enable the previous Google key if it was disabled.
3. Redeploy and retest map flows.

Twilio:

1. Revert incoming-phone-number SMS webhook URLs to the prior value if CRM SMS ingestion breaks.
2. Re-run Twilio inventory and CRM gates.
3. Keep the old tunnel fallback only as an emergency temporary measure.
