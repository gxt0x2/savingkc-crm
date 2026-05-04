# SavingKC CRM Cleanup: Stabilization Checkpoint

Date: 2026-05-03

No secret values are recorded in this document.

## Scope

This checkpoint captures the current production stabilization work before broader repo cleanup continues.

This is not a delete/move cleanup phase. No dead files are being removed in this checkpoint.

## What Changed

- Twilio dialer initialization was hardened after the browser dialer went offline.
- Lead detail and calendar data were routed through server APIs after Supabase auth/RLS/key containment exposed blank client views.
- Street View and map flows were restored behind server-side Google map routes.
- Deal page photos now use a server image proxy so Supabase image transform limits do not break public deal pages.
- Deal page photo loading was changed to preload quietly after the page settles instead of forcing a slow "load more" path.
- The map tile rollback keeps the stable static map behavior while preserving a future path for better map quality.
- The dialer queue now loads through `/api/dialer/queue` instead of relying on browser-side Supabase reads.
- The default dialer queue now opens with a broad ready-lead list so calling can start.
- Cleanup audit docs and risk register were expanded to reflect the incidents found during stabilization.

## Why

Production was showing live user-facing failures:

- Twilio dialer offline.
- Lead pages showing "Lead not found".
- Calendar blank.
- Street View not opening.
- Deal page photos missing or slow.
- Dialer queue showing no attached leads.

The common pattern was that browser-side integration reads were brittle after security hardening. The stabilization path moves critical reads behind server routes where env handling, service-role access, and response shape can be controlled and tested.

## Risk

Risk level: Medium/High.

Reasons:

- This checkpoint touches production CRM flows, API routes, Supabase access, Twilio checks, and map/photo behavior.
- Some changes were deployed during active incident response before being backfilled into Git.
- Lint is still a known-bad baseline and is not a reliable gate yet.

Current containment:

- No destructive file operations.
- No dead-code deletions.
- Production rollback deployments are documented.
- All changes are being captured on a branch and draft PR for review before merge.

## Production Verification

Current live deployment:

- `dpl_46Y7STSCf6whBFz15iw81KwhARm1`

Previous live checkpoint deployment:

- `dpl_2dudnvs2ha8yfXndy5qdwk9NzwPV`

Verified behavior:

- `/api/dialer/queue` returned 251 leads.
- Live dialer showed 251 ready leads.
- Dialer queue start controls were enabled.
- Deal page map/photo rollback remained stable after deployment.

## Gates Run

Most recent successful gates:

- `npm run build`
- `npm run gate:routes`
- `npm run gate:twilio`
- `npm run gate:edge`

Post-deploy result:

- Production deploy `dpl_46Y7STSCf6whBFz15iw81KwhARm1` was aliased to `https://crm.savingkc.com`.
- `gate:twilio` passed against `https://crm.savingkc.com/api/twilio-token`.
- `gate:edge` passed for `/dialer`, `/api/twilio-token`, and `/api/twiml-voice`.

Known non-blocking baseline:

- `npm run lint` is still failing from pre-existing lint debt and should not be added as a required gate until cleaned or scoped.

## Rollback

If production regresses:

1. Promote the previous known-good Vercel deployment.
2. Revert the specific PR commit after it is pushed.
3. Restore the prior route behavior for only the broken flow.
4. Re-run:
   - `npm run build`
   - `npm run gate:routes`
   - `npm run gate:twilio`
   - `npm run gate:edge`

Known rollback references:

- Current stabilization live deployment: `dpl_46Y7STSCf6whBFz15iw81KwhARm1`
- Final dialer stabilization live deployment: `dpl_2dudnvs2ha8yfXndy5qdwk9NzwPV`
- Previous pre-final-dialer deployment: `dpl_CASBxQbdknqfpM77EETxjUwBdKHk`
- Map rollback deployment: `dpl_5hnq9Xy1viLoehP3M3w8giTBmCBk`

## Next

1. Commit this stabilization checkpoint.
2. Push `codex/dialer-v2-current-crm`.
3. Open a draft PR.
4. Continue cleanup Phase 2 only from the protected branch/PR checkpoint.
5. Quarantine dead or duplicate code later; do not delete it in this checkpoint.
