# SavingKC CRM Cleanup: Enrich API Auth Hardening

Date: 2026-05-04

No secret values are recorded in this document.

## Scope

This checkpoint covers the fourth small PR-sized slice of issue #95: hardening broad API auth bypasses.

This phase protects the `/api/enrich/*` route namespace at the route-handler level. It does not remove the proxy bypass yet.

## What Changed

- Added signed-in user or secret auth to `POST /api/enrich`.
- Replaced the one-off batch enrichment cron-secret check with the shared admin/secret guard.
- Preserved existing script compatibility for `Authorization: Bearer ...` calls.

## Why

The proxy still allows `/api/enrich/*` through as an external namespace. The batch route had its own check, but the root enrichment handler did not have route-level auth of its own.

This phase makes both handlers explicit before any later proxy narrowing.

## Risk

Risk level: Low/Medium.

Main risks:

- Batch enrichment calls without a configured secret now return `401 Unauthorized`.
- Direct root enrichment calls now require a CRM session or configured secret.

Contained risk:

- No destructive commands.
- No database migrations.
- No enrichment logic changes.
- No proxy rule removals.
- One PR revert restores the old behavior.

## Rollback

Preferred rollback:

1. Revert the enrich API auth hardening PR.
2. Re-run build and gates.
3. Let Vercel redeploy `main`.

Emergency rollback:

1. Promote the previous known-good Vercel production deployment.
2. Open a rollback PR documenting the deployment ID and failing enrich endpoint.

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

- Confirm unauthenticated `/api/enrich` returns `401`.
- Confirm unauthenticated `/api/enrich/batch` returns `401`.
- Confirm Twilio token health still passes.
- Confirm edge integrity still passes.
- Confirm TC portal still loads.

## Next

If this phase deploys cleanly, continue issue #95 with the final high-risk namespace:

- `/api/ari/*`

Only remove broad proxy bypasses after each route namespace has its own explicit guard and live checks pass.
