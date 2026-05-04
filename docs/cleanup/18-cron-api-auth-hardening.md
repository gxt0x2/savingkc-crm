# SavingKC CRM Cleanup: Cron API Auth Hardening

Date: 2026-05-04

No secret values are recorded in this document.

## Scope

This checkpoint covers the third small PR-sized slice of issue #95: hardening broad API auth bypasses.

This phase protects the `/api/cron/*` route namespace at the route-handler level. It does not remove the proxy bypass yet.

## What Changed

- Added required admin/secret auth to the Mojo queue cron route.
- Added required admin/secret auth to the Ari briefing sweep cron route.
- Added required admin/secret auth to the all-account Gmail sync cron route.
- Added signed-in user or secret auth to the manual one-user Gmail sync trigger used by Settings.
- Added a shared `requireUserOrSecret()` helper for routes that should allow a normal signed-in CRM user instead of only admins.

## Why

The proxy still allows `/api/cron/*` requests through without the normal app auth redirect. Some cron routes had optional secret checks, which means they could become public if the secret env was missing. The manual Gmail trigger had no route-level auth.

This phase requires explicit auth while preserving Vercel Cron compatibility through the `Authorization: Bearer ...` secret header.

## Risk

Risk level: Medium.

Main risks:

- A scheduled job will return `401 Unauthorized` if the production cron secret is missing or not sent.
- The manual Gmail sync trigger now requires the browser to have a valid CRM session.

Contained risk:

- No destructive commands.
- No database migrations.
- No cron schedule changes.
- No proxy rule removals.
- One PR revert restores the old behavior.

## Rollback

Preferred rollback:

1. Revert the cron API auth hardening PR.
2. Re-run build and gates.
3. Let Vercel redeploy `main`.

Emergency rollback:

1. Promote the previous known-good Vercel production deployment.
2. Open a rollback PR documenting the deployment ID and failing cron endpoint.

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

- Confirm unauthenticated `/api/cron/process-mojo-queue` returns `401`.
- Confirm unauthenticated `/api/cron/sweep-briefings` returns `401`.
- Confirm unauthenticated `/api/cron/sync-gmail` returns `401`.
- Confirm unauthenticated `/api/cron/sync-gmail/trigger` returns `401`.
- Confirm Twilio token health still passes.
- Confirm edge integrity still passes.
- Confirm TC portal still loads.

## Next

If this phase deploys cleanly, continue issue #95 with the next namespace:

- `/api/enrich/*`
- `/api/ari/*`

Only remove broad proxy bypasses after each route namespace has its own explicit guard and live checks pass.
