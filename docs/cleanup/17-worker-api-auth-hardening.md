# SavingKC CRM Cleanup: Worker API Auth Hardening

Date: 2026-05-04

No secret values are recorded in this document.

## Scope

This checkpoint covers the second small PR-sized slice of issue #95: hardening broad API auth bypasses.

This phase protects the `/api/workers/*` route namespace at the route-handler level. It does not remove the proxy bypass yet.

## What Changed

- Added explicit auth to the Mojo sync worker `GET` and `POST` handlers.
- Added explicit auth to the SMS sender worker status `GET` handler.
- Left the SMS sender worker `POST` cron-secret guard in place.
- Left the appointment reminder worker cron-secret guard in place.
- Updated the EOD route's internal Mojo sync trigger to send the configured worker/admin secret when available.

## Why

The proxy still allows `/api/workers/*` requests through without the normal app auth redirect. Some worker endpoints already had cron-secret checks, but Mojo sync and SMS worker status were exposed.

This phase closes those gaps without changing proxy behavior yet.

## Risk

Risk level: Medium.

Main risk:

- Any automation that calls `/api/workers/mojo-sync` or `GET /api/workers/sms-sender` without an admin session or configured secret will now receive `401 Unauthorized`.

Contained risk:

- No destructive commands.
- No database migrations.
- No worker logic changes.
- No proxy rule removals.
- One PR revert restores the old behavior.

## Rollback

Preferred rollback:

1. Revert the worker API auth hardening PR.
2. Re-run build and gates.
3. Let Vercel redeploy `main`.

Emergency rollback:

1. Promote the previous known-good Vercel production deployment.
2. Open a rollback PR documenting the deployment ID and failing worker endpoint.

## Verification Plan

Before merge:

- `git diff --check`
- `npm run build`
- `npm run gate:routes`
- `npm run gate:theme`
- `npm run test:ci`
- `npm run test:smoke:theme`
- `npm run gate:twilio`
- `npm run gate:edge`

After production deploy:

- Confirm unauthenticated `/api/workers/mojo-sync` returns `401`.
- Confirm unauthenticated `/api/workers/sms-sender` returns `401`.
- Confirm Twilio token health still passes.
- Confirm edge integrity still passes.
- Confirm TC portal still loads.

## Next

If this phase deploys cleanly, continue issue #95 with the next namespace:

- `/api/cron/*`
- `/api/enrich/*`
- `/api/ari/*`

Only remove broad proxy bypasses after each route namespace has its own explicit guard and live checks pass.
