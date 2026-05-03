# SavingKC CRM Cleanup: Supabase JWT Signing Key Rotation Plan

Date: 2026-05-01

No secret values are recorded in this document.

## Current State

| Item | Status |
| --- | --- |
| Supabase project | `Atlas` / `fprrknfyzlthbxewnwmi` |
| Modern API keys | Active in Vercel CRM and public website |
| Legacy anon/service_role API keys | Disabled for `apikey` header use |
| JWT signing system | New JWT Signing Keys page is active |
| Current signing key | ECC P-256 key shown as current |
| Legacy signing key | Revoked after action-time approval |
| Supabase Edge Functions | None found in repo |
| Direct JWT verification in app code | No `JWT_SECRET`, `jsonwebtoken`, or `jose` verification found |
| Current source legacy Supabase JWT scan | No legacy JWT-shaped Supabase key found in CRM or website source trees, excluding build output and `.git` |

## Official Guidance Used

- Supabase API key docs: `anon` and `service_role` are legacy JWT-based keys tied to the JWT secret; Supabase recommends using `sb_publishable_...` and `sb_secret_...` keys instead.
- Supabase signing-key docs: the newer signing-key system allows rotation and revocation with less downtime than the old legacy JWT secret system.
- Supabase signing-key docs: after rotation, the old key should be revoked after live tokens expire; the docs suggest at least 1 hour and 15 minutes when access-token expiry is 1 hour.
- Supabase signing-key docs: revoking the legacy JWT secret requires disabling legacy `anon` and `service_role` API keys first.

References:

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd

## Completed Action

The previously used legacy HS256 signing key was revoked in Supabase after action-time approval.

This should invalidate any remaining JWT signed by the old legacy secret. Because the key was rotated months ago and legacy API keys are now disabled, the practical downtime risk was low.

## Why

The GitHub secret-scanning alert includes historical Supabase service-role exposure. Disabling the legacy API keys reduces normal API-key use, but Supabase warns that old legacy `anon` and `service_role` keys can still remain valid as JWTs until the legacy signing key is revoked.

## Risk

Risk: Medium.

Possible breakage:

1. A forgotten automation could still rely on a legacy JWT as a bearer token.
2. A client with a very old Supabase Auth access token could be forced to re-authenticate.
3. Any hidden service that verifies tokens against the old shared secret could fail.

Risk reducers already completed:

1. CRM and website are on modern Supabase keys.
2. Legacy API keys are disabled.
3. Current source scans do not show legacy JWT-shaped Supabase keys.
4. No local Supabase Edge Functions were found.
5. The legacy key is shown as previously used for months, well beyond normal token expiry.

## Execution Steps

1. Confirm current production health. Completed.
2. In Supabase Dashboard, open Project Settings > JWT Keys. Completed.
3. On the JWT Signing Keys tab, revoke the previously used legacy HS256 signing key. Completed.
4. Do not delete keys. Completed.
5. Re-run production checks. Completed:
   - CRM system health
   - CRM login/root
   - Twilio token gate
   - Edge integrity gate
   - Website root and `partial-capture.js`
6. Query Supabase JWKS endpoint. Completed; public JWKS showed only the current EC/ES256 signing key.
7. If healthy, update risk register and GitHub alert notes. Completed.

## Rollback

If production breaks after revocation:

1. In Supabase Dashboard, move the revoked legacy key back to standby if the dashboard permits it.
2. Rotate back only if needed to restore production.
3. If API-key use is also affected, re-enable legacy API keys temporarily.
4. Re-run production checks.
5. Re-open containment work with a narrower search for the hidden dependency.

## Action-Time Confirmation

Completed. Revoking the legacy signing key changed live cloud access and was done only after explicit approval.
