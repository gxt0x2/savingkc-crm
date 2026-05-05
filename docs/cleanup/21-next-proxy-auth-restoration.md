# Next Proxy Auth Restoration

Date: 2026-05-04

## What Changed

- Moved the Next.js proxy from `proxy.ts` to `src/proxy.ts` so it sits beside `src/app`.
- Narrowed unauthenticated access to known public pages, buyer-facing deal routes, booking/intake routes, maps/static image support, and signed external webhooks.
- Added a CI gate that fails if the production build does not register the proxy.
- Added a local Playwright-only bypass header for smoke tests. The bypass requires `AUTH_PROXY_TEST_BYPASS_SECRET` and is disabled on Vercel production.
- Added `TWILIO_HEALTH_BEARER` to GitHub Actions and Vercel Production so protected Twilio/edge health checks can still run safely.

## Why

The app uses `src/app`, but the proxy file was at the repository root. Next.js did not register it in the build manifest, so protected CRM pages and internal APIs were reachable without a logged-in user.

## Risk

Medium. Restoring auth can expose callers that were accidentally relying on public API access. Public buyer/deal/webhook routes were explicitly preserved to reduce production breakage.

## Rollback

Revert the proxy move and related CI/test changes. If production login protection blocks a necessary external integration, temporarily restore that route as a narrow public or signed-bearer exception and document the owner.

## Validation Plan

- `npm run build`
- `npm run gate:proxy`
- `npm run gate:routes`
- `npm run gate:theme`
- `npm run test:ci`
- `npm run test:smoke:theme`
- `TWILIO_HEALTH_BEARER=<configured secret> npm run gate:twilio`
- `TWILIO_HEALTH_BEARER=<configured secret> npm run gate:edge`
- Local unauthenticated checks:
  - Protected CRM pages redirect to `/login`.
  - Protected internal APIs return `401`.
  - Public deal/map/webhook support routes remain reachable.
