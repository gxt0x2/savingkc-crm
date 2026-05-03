# Edge Integrity: Vercel + Cloudflare

This checklist keeps `crm.savingkc.com` pinned to the correct deployment and prevents stale dialer/Twilio behavior.

## 1) Vercel Baseline

- Project domain aliases must include:
  - `crm.savingkc.com`
  - `savingkc-crm.vercel.app`
- Production deploy target must be `production` and `READY`.
- Twilio env vars must exist in Vercel Production:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_API_KEY`
  - `TWILIO_API_SECRET`
  - `TWILIO_PHONE_NUMBER`
  - `ERNEST_PHONE`
  - `CASEY_PHONE`

## 2) Cloudflare Baseline

- DNS for `crm.savingkc.com` points to Vercel (CNAME target from Vercel dashboard).
- SSL/TLS mode is `Full (strict)`.
- Do not use a broad `Cache Everything` rule on `crm.savingkc.com`.
- Add explicit bypass rules (top priority):
  - `hostname = crm.savingkc.com AND path starts_with /api/` -> **Bypass cache**
  - `hostname = crm.savingkc.com AND path starts_with /dialer` -> **Bypass cache**
- If you change cache rules, purge Cloudflare cache after saving.

## 3) Runtime Guardrails in App

These routes are forced dynamic and emit no-store headers:

- `/api/twilio-token`
- `/api/twiml-voice`
- `/api/call-log`

This blocks edge/browser caching of call state and token responses.

## 4) CI/CD Verification

Set these GitHub repository variables/secrets:

- `EDGE_INTEGRITY_BASE_URL=https://crm.savingkc.com`
- `EDGE_EXPECT_VERCEL=1`
- `EDGE_EXPECT_CLOUDFLARE=1`
- optional secret: `TWILIO_HEALTH_BEARER`

Then CI runs:

- `npm run gate:twilio`
- `npm run gate:edge`

## 5) Manual Post-Deploy Command

Run this immediately after production deploy:

```bash
EDGE_INTEGRITY_BASE_URL=https://crm.savingkc.com \
EDGE_EXPECT_VERCEL=1 \
EDGE_EXPECT_CLOUDFLARE=1 \
npm run gate:edge
```

Expected result: `Edge integrity gate passed`.
