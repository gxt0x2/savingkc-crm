# SavingKC CRM Cleanup: Supabase Key Containment Checkpoint

Date: 2026-05-01

No secret values are recorded in this document.

## Status

Supabase project `Atlas` was confirmed as the active CRM project.

| Item | Status |
| --- | --- |
| Supabase project ref | `fprrknfyzlthbxewnwmi` |
| Supabase org | `Ari's Mobile Home` |
| Vercel production env | Updated to modern Supabase secret/publishable keys |
| Vercel preview env | Updated to modern Supabase secret/publishable keys |
| Modern publishable key | Active in Vercel and present in deployed client bundle |
| Modern secret key | Active in Vercel as `sensitive` |
| Legacy anon/service_role keys | Disabled for Supabase `apikey` header use |
| Legacy HS256 signing key | Revoked |
| Public website partial capture | Updated to modern publishable key and deployed to Cloudflare Pages |
| Production redeploy | `https://savingkc-h20yb1y5f-gxt0x2s-projects.vercel.app`, aliased to `https://crm.savingkc.com` |

## What Changed

Vercel Production and Preview were updated to use modern Supabase keys:

- `SUPABASE_SERVICE_ROLE_KEY` now uses the modern Supabase secret key.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` now uses the modern Supabase publishable key.
- Production was redeployed from the last known-good Vercel deployment, not from the dirty local worktree.
- `crm.savingkc.com` was re-aliased to the new production deployment.

The public website dependency was also moved off the legacy key:

- `savingkc.com/partial-capture.js` now uses the modern Supabase publishable key.
- The website was rebuilt and deployed to Cloudflare Pages.
- Live checks confirmed both `savingkc.com` and `www.savingkc.com` serve the updated capture script.

After the CRM and website were confirmed on modern keys, Supabase legacy JWT-based API keys were disabled in the Supabase dashboard.

After production remained healthy, the previously used legacy HS256 signing key was revoked from the Supabase JWT Signing Keys page.

The attempted Supabase Management API automation failed because the local Supabase CLI credential is not a Management API personal access token. The Supabase dashboard copy flow was used instead.

## Why

GitHub secret scanning reports a public leak tied to Supabase service-role credentials. The app and public website needed to stop depending on legacy JWT-based Supabase keys before any legacy key was disabled.

## Risk

The immediate production dependency on legacy Supabase API keys is contained.

Remaining risk is still high until JWT-secret rotation is planned and completed. Supabase warned in the dashboard that disabling JWT-based API keys disables them for the `apikey` header, but they can still remain valid as JWTs. Because the GitHub alert mentions service-role exposure, the next security step is a carefully planned Supabase JWT secret rotation.

Known residual risks:

1. Local ignored env files and old backups may still contain legacy keys.
2. Any forgotten external automation that sends the old key as a JWT could still need cleanup.
3. Website partial capture still depends on Supabase RLS being correct.
4. JWT secret rotation can break auth/session flows if done without a maintenance plan.

## Verification

Post-migration and post-disable smoke checks passed:

| Check | Result |
| --- | --- |
| `https://crm.savingkc.com/api/system-health?action=summary` | HTTP 200; `success: true`; Supabase-backed summary returned |
| `https://crm.savingkc.com/login` | HTTP 200 |
| `https://crm.savingkc.com/` | HTTP 200 |
| `POST https://crm.savingkc.com/api/twiml-voice` | HTTP 200 XML |
| `npm run gate:twilio -- --base-url=https://crm.savingkc.com` | Passed |
| `npm run gate:edge -- --base-url=https://crm.savingkc.com` | Passed |
| Client bundle key-shape check | Modern `sb_publishable_` key shape found; legacy JWT shape not found near Supabase env usage |
| `https://savingkc.com/` | HTTP 200 |
| `https://savingkc.com/partial-capture.js` | HTTP 200; modern publishable key shape found; legacy JWT shape not found |
| `https://www.savingkc.com/partial-capture.js` | HTTP 200; modern publishable key shape found; legacy JWT shape not found |
| Website production build | Passed before Cloudflare deploy |
| Current source tree legacy-key scan | No legacy JWT-shaped Supabase key found in CRM or website source trees, excluding build output and `.git` |
| Supabase JWKS endpoint | HTTP 200; public key set showed only the current EC/ES256 signing key |
| GitHub Supabase secret alert | Alert #2 resolved as revoked |

## Rollback

If the Vercel env update breaks production:

1. Re-enable or restore the previous Vercel env values from the local ignored env files or Supabase dashboard.
2. Redeploy the last known-good deployment.
3. Keep legacy Supabase keys enabled until the app is confirmed healthy on modern keys.

If legacy Supabase keys are disabled later and production breaks:

1. Re-enable legacy Supabase API keys in the Supabase dashboard or Management API.
2. Redeploy if the failure is tied to bundled public env values.
3. Re-run the CRM smoke checks before continuing containment.

If the website partial capture breaks:

1. Revert the website `partial-capture.js` change.
2. Redeploy the website from the previous Cloudflare Pages deployment.
3. Re-enable legacy Supabase API keys only if the website cannot be restored quickly.

## Action-Time Confirmation

Completed. Disabling legacy Supabase API keys changed live cloud access and was done only after explicit approval.
