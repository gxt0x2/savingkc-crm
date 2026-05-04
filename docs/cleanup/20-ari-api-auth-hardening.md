# SavingKC CRM Cleanup: ARI API Auth Hardening

Date: 2026-05-04

No secret values are recorded in this document.

## Scope

This checkpoint covers the final route-namespace slice of issue #95: hardening broad API auth bypasses.

This phase protects the `/api/ari/*` route namespace at the route-handler level. It does not remove the proxy bypass yet.

## What Changed

- Added signed-in user or secret auth to every current `/api/ari/*` route handler.
- Preserved browser callers because same-origin CRM requests include the user's session cookies.
- Updated cron briefing sweep calls to send the configured secret when regenerating ARI briefings.
- Updated server-side eager briefing regeneration to send the configured secret.
- Kept the ARI page stable when secured API calls return `401` by preserving safe empty defaults instead of trusting error response shapes.

## Why

The proxy still allows `/api/ari/*` through without normal app auth. These endpoints expose lead queues, inbox activity, follow-up tasks, pipeline actions, lead chat, briefing data, and AI-generated recommendations.

This phase closes the direct public access path while keeping normal signed-in CRM usage and server-side regeneration flows working.

## Risk

Risk level: High.

Main risks:

- ARI UI calls will return `401 Unauthorized` if the browser session is missing or expired.
- Server-side briefing regeneration will return `401 Unauthorized` if the production secret env is missing.

Contained risk:

- No destructive commands.
- No database migrations.
- No ARI business logic changes.
- No proxy rule removals.
- One PR revert restores the old behavior.
- The ARI page still renders during auth transitions or CI smoke tests where API calls are intentionally unauthorized.

## Rollback

Preferred rollback:

1. Revert the ARI API auth hardening PR.
2. Re-run build and gates.
3. Let Vercel redeploy `main`.

Emergency rollback:

1. Promote the previous known-good Vercel production deployment.
2. Open a rollback PR documenting the deployment ID and failing ARI endpoint.

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

- Confirm unauthenticated `/api/ari/call-queue` returns `401`.
- Confirm unauthenticated `/api/ari/coaching?mode=morning` returns `401`.
- Confirm unauthenticated `/api/ari/generate-briefing?manifestId=test` returns `401`.
- Confirm Twilio token health still passes.
- Confirm edge integrity still passes.
- Confirm TC portal still loads.

## Next

After this phase deploys cleanly, issue #95 can move from route-level hardening to proxy narrowing:

- Replace broad bypasses like `/api/admin/`, `/api/workers/`, `/api/cron/`, `/api/enrich/`, and `/api/ari/` with exact allowlisted external routes.
- Teach proxy-level auth to respect approved secret headers only where needed.
- Keep each proxy change in a small PR and verify live after deploy.
