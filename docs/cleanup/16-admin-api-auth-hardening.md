# SavingKC CRM Cleanup: Admin API Auth Hardening

Date: 2026-05-04

No secret values are recorded in this document.

## Scope

This checkpoint covers the first small PR-sized slice of issue #95: hardening broad API auth bypasses.

This phase protects the `/api/admin/*` route namespace at the route-handler level. It does not remove the proxy bypass yet.

## What Changed

- Added one shared admin API guard for admin route handlers.
- Guard accepts an authenticated CRM admin user or a server-side admin secret.
- Guard supports `Authorization: Bearer ...`, `x-admin-secret`, and existing `?secret=...` calls.
- Added the guard to every current `/api/admin/*` route handler.
- Updated Mojo sync scripts so admin config calls include the configured admin secret header when available.

## Why

The proxy still allows `/api/admin/*` requests through without the normal app auth redirect. That made admin endpoints depend on each route implementing its own protection, and several routes did not.

This phase reduces exposure without changing the proxy rules yet, which keeps the blast radius smaller for production.

## Risk

Risk level: Medium.

Main risk:

- Any automation that calls `/api/admin/*` without a valid admin session or admin secret will now receive `401 Unauthorized`.

Contained risk:

- No destructive commands.
- No database migrations.
- No route deletes.
- No proxy rule removals.
- One PR revert restores the old behavior.

## Rollback

Preferred rollback:

1. Revert the admin API auth hardening PR.
2. Re-run build and gates.
3. Let Vercel redeploy `main`.

Emergency rollback:

1. Promote the previous known-good Vercel production deployment.
2. Open a rollback PR documenting the deployment ID and failing endpoint.

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

- Confirm unauthenticated `/api/admin/system-config?key=last_mojo_sync_timestamp` returns `401`.
- Confirm Twilio token health still passes.
- Confirm edge integrity still passes.
- Confirm TC portal still loads.

## Next

If this phase deploys cleanly, continue issue #95 with the next namespace:

- `/api/workers/*`
- `/api/cron/*`
- `/api/enrich/*`
- `/api/ari/*`

Only remove broad proxy bypasses after each route namespace has its own explicit guard and live checks pass.
