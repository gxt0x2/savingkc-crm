# Enrichment Proxy Bearer Allowlist

Date: 2026-08-26

No secret values are recorded in this document.

## Scope

This checkpoint covers the first route-by-route proxy narrowing slice of issue
#95. It changes no enrichment logic and no CRM user interface.

## What Changed

- Removed the broad `/api/enrich/*` namespace from proxy-level bearer trust.
- Exact-listed the two reviewed server-to-server endpoints:
  - `POST /api/enrich`
  - `POST /api/enrich/batch`
- Kept each handler's existing defense-in-depth authorization:
  - `/api/enrich` requires a signed-in user or configured service secret.
  - `/api/enrich/batch` requires a CRM admin or configured service secret.
- Added a proxy regression test proving that an unreviewed future child route
  does not silently inherit bearer trust.

## Why

Prefix trust makes a newly added route reachable at the proxy boundary before
that route has been reviewed. Exact allowlisting fails closed: new enrichment
routes require a valid CRM session unless they are deliberately added to the
service-bearer list and retain their own route-level guard.

## Risk and Rollback

Risk level: Low/Medium.

The two current enrichment endpoints keep the same signed-in and service-secret
access. The only intentional behavior change is that an unknown future
`/api/enrich/*` route no longer inherits service-bearer trust automatically.

Rollback is one commit: restore `/api/enrich/` to
`TRUSTED_BEARER_API_PREFIXES` and remove the two exact entries.

## Verification

- Focused proxy tests cover both reviewed endpoints and a denied unreviewed
  child route.
- ESLint and TypeScript pass for the change.
- The production Next.js build passes and registers both enrichment routes.
- Route integrity and credential/security gates pass.
- The live edge gate remains a hosted-CI/post-deploy check because its protected
  bearer is not stored in this isolated worktree.

## Next

Continue issue #95 one namespace at a time. Inventory the exact routes and
callers before narrowing `/api/ari/`, `/api/workers/`, `/api/cron/`, or
`/api/admin/`.
