# SavingKC CRM Cleanup: GitHub Secret Alert Checkpoint

Date: 2026-05-01

No secret values are recorded in this document.

## Current Alerts

Repository: `gxt0x2/savingkc-crm`

| Alert | Type | State | Current assessment |
| --- | --- | --- | --- |
| #1 | Google API key | Open | Historical locations found; current app code uses env vars, but active Google Cloud key is broad and lacks browser/referrer restrictions |
| #2 | Supabase service key | Resolved as revoked | Historical locations found; CRM and website now use modern Supabase keys; legacy API keys disabled; legacy HS256 signing key revoked; production gates passed |
| #3 | Twilio Account SID | Open | Historical locations found; Account SID is an identifier, but Twilio SMS webhooks still point to a temporary tunnel and credential hygiene still needs review |

Repository: `gxt0x2/savingkc-website`

| Item | State |
| --- | --- |
| Secret scanning | Disabled or unavailable through current GitHub API response |
| Current website source scan | No legacy JWT-shaped Supabase key found outside `.git` and build output |
| Production website capture script | Updated to modern Supabase publishable key and deployed |

## Current Alert Locations

Only file paths and line numbers were collected. Secret values were not recorded.

| Alert | Historical locations |
| --- | --- |
| Google API key | `src/components/leads/property-hero.tsx`, `src/app/deals/[slug]/photo-gallery.tsx` |
| Supabase service key | `OVERNIGHT_MISSION.md`, `scripts/apply-migration.mjs`, `scripts/apply-manifests-migration.mjs` |
| Twilio Account SID | `OVERNIGHT_MISSION.md`, `scripts/restart-tunnel.sh`, `scripts/restart-tunnel.sh.DISABLED` |

## Cleanup Status

Completed:

1. Current source scan no longer finds legacy JWT-shaped Supabase keys.
2. Website `partial-capture.js` was moved to the modern Supabase publishable key.
3. CRM Vercel env was moved to modern Supabase publishable/secret keys.
4. Supabase legacy `anon` and `service_role` API keys were disabled.
5. Current Google Maps code reads from `NEXT_PUBLIC_GMAPS_KEY`.
6. Twilio token health and edge gates pass in production.

Pending before resolving GitHub alerts:

1. Confirm Google Maps key restrictions in Google Cloud Console.
2. Confirm Twilio auth token/API key rotation status in Twilio Console.
3. Move Twilio SMS webhooks from the temporary tunnel to `crm.savingkc.com`.
4. Decide whether to rewrite public Git history or accept historical alerts after credential rotation. Rewriting public history is high-risk and not recommended during production stabilization.
5. Enable secret scanning for the private website repo if the GitHub plan/settings allow it.

## Recommended Handling

Alert #2 was resolved as revoked because legacy Supabase API-key use was disabled, the legacy signing key was revoked, and production gates passed.

Do not resolve alert #1 until Google Cloud key restrictions are narrowed or the exposed key is rotated.

Do not resolve alert #3 until Twilio SMS webhooks are fixed and credential rotation/restriction status is confirmed.

## Rollback

Resolving GitHub alerts only changes GitHub alert state. If an alert is resolved too early, reopen it in GitHub Security or create a new tracked risk entry.
