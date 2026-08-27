# Worker proxy bearer allowlist

Date: 2026-08-26

## Scope

This slice narrows proxy-level bearer trust for the existing worker endpoints.
It does not change a worker's route-level authorization, schedule, payload,
side effects, or database behavior.

## Change

- Removed the broad `/api/workers/*` namespace from proxy-level bearer trust.
- Exact-listed the six worker routes that exist today:
  - `/api/workers/ppc-conversion-export-alert`
  - `/api/workers/ppc-conversion-export`
  - `/api/workers/property-enrichment`
  - `/api/workers/prospecting-campaigns`
  - `/api/workers/sms-sender`
  - `/api/workers/workflow-runs`
- Retained each route's existing handler authorization. Five use
  `requireAdminOrSecret`; the SMS sender POST continues to require the exact
  configured cron secret.
- Added proxy regression coverage proving an unreviewed worker child route
  fails closed instead of inheriting service-bearer trust.

## Verification

Run:

```bash
npx vitest run src/proxy-workers-bearer.test.ts src/proxy-enrich-bearer.test.ts src/proxy-auth-headers.test.ts src/proxy.test.ts
npm run lint
npx tsc --noEmit
npm run build
npm run gate:routes
npm run gate:proxy
npm run gate:security
```

## Rollback

Restore `/api/workers/` to `TRUSTED_BEARER_API_PREFIXES` and remove the six
exact worker entries. No data rollback is required.
