# ARI proxy authentication restoration

Date: 2026-08-26

## Scope

This slice removes obsolete proxy-level service-bearer trust from the four
current `/api/ari/*` routes. It does not change ARI business logic, AI prompts,
payloads, lead access rules, or database behavior.

## Finding

Every current ARI route requires a verified signed-in CRM actor inside its
handler. None of the four handlers accepts a cron, admin, deploy, Twilio
health, or edge health bearer as authentication. Keeping `/api/ari/*` in the
proxy service-bearer prefixes therefore broadened the proxy boundary without
enabling a valid handler flow.

## Change

- Removed `/api/ari/` from `TRUSTED_BEARER_API_PREFIXES`.
- Added proxy coverage for all four current ARI routes:
  - `/api/ari/chat`
  - `/api/ari/deal-score-analysis`
  - `/api/ari/extract-pain-points`
  - `/api/ari/generate-briefing`
- Proved bearer-only requests fail with `401` at the proxy.
- Proved verified signed-in CRM requests continue to reach the handlers.

## Verification

Run:

```bash
npx vitest run src/proxy-ari-auth.test.ts src/proxy-workers-bearer.test.ts src/proxy-enrich-bearer.test.ts src/proxy-auth-headers.test.ts src/proxy.test.ts
npm run lint
npx tsc --noEmit
npm run build
npm run gate:hygiene
npm run gate:routes
npm run gate:proxy
npm run gate:security
```

## Rollback

Restore `/api/ari/` to `TRUSTED_BEARER_API_PREFIXES`. No data rollback is
required.
