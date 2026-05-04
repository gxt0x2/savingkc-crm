# SavingKC CRM Cleanup: Risk Register

No secret values are recorded in this document.

| ID | Risk | Severity | Evidence | Immediate next action | Rollback/containment |
| --- | --- | --- | --- | --- | --- |
| R-001 | CRM repo is public while GitHub secret-scanning has open public-leak alerts | Critical | `gxt0x2/savingkc-crm` is public; Supabase alert #2 is resolved as revoked; Google API key and Twilio Account SID alerts remain open | Confirm Google key restrictions; confirm Twilio credential rotation; resolve remaining alerts only after containment | Revoke/rotate credentials; temporarily make repo private if needed |
| R-002 | Website has hardcoded browser keys in public/static code | High | `savingkc-website/public/partial-capture.js` now uses a modern publishable key; `savingkc-website/src/components/LeadForm.astro` still needs review | Move config to build-time env where appropriate; verify RLS/domain restrictions for lead capture | Rotate/restrict key; deploy previous Cloudflare/Vercel build if breakage occurs |
| R-003 | Local env files include production-like secrets | High | `.env`, `savingkc-crm-fix/.env.local`, `.env.live`, `.env.local.bak.*`, `.vercel/.env.production.local` | Keep ignored; move backups out of repo tree; document owner machine policy | Restore env files from password manager or Vercel/Supabase dashboard |
| R-004 | GitHub CLI token on this machine has broad scopes | High | `gh auth status` shows scopes including `repo`, `workflow`, and `delete_repo` | Replace with least-privilege token or GitHub app auth; remove `delete_repo` unless needed | Revoke token from GitHub settings; re-auth with narrower scopes |
| R-005 | Branch protection requires zero approving reviews | High | `required_approving_review_count: 0`; CODEOWNERS missing | Add CODEOWNERS and require at least one approval | Temporarily relax branch protection if emergency hotfix blocked |
| R-006 | Edge integrity gate exists but is not required | High | Workflow has `gate-edge-integrity`; branch protection requires only build/theme, Twilio, gitleaks | Add edge gate to required checks after variables are configured | Remove required check if false failures block emergency deploy |
| R-007 | CI gates can pass as no-ops when vars/secrets are missing | High | Repo Actions secrets and variables are empty; Twilio/edge jobs skip when base URLs are empty | Add required Actions vars/secrets or make missing config fail for protected branches | Revert workflow change if env provisioning is not ready |
| R-008 | Dependabot alerts are open, including a high Next.js advisory | High | 6 open Dependabot alerts in CRM, including Next.js direct dependency | Merge/test dependency PRs in small order; prioritize Next.js | Revert dependency PR if build/runtime breaks |
| R-009 | Active CRM worktree is dirty and ahead of origin | High | `codex/dialer-v2-current-crm` ahead 4 with many local modified/untracked files | Snapshot status; avoid broad formatting/moves until committed or isolated | Use current branch/worktree as rollback reference; do not reset without approval |
| R-010 | Top-level workspace repo has no commits and no remote | Medium | Root Git repo reports "No commits yet on main" and all files untracked | Do not use root as canonical repo; document active CRM repo path | Ignore root repo or archive after active repo is confirmed |
| R-011 | Broad auth bypass prefixes include sensitive API namespaces | High | `proxy.ts` bypasses `/api/admin/`, `/api/ari/`, `/api/workers/`, `/api/enrich/`, `/api/cron/` | Audit each bypassed route for its own auth/secret check | Remove bypass route-by-route; restore if external webhook breaks |
| R-012 | Website direct Supabase partial capture depends entirely on RLS | High | Browser JS posts directly to Supabase REST with anon key | Verify production RLS policies for `leads`; consider routing through CRM API | Disable partial capture or point it to CRM API if RLS is wrong |
| R-013 | Private repos lack visible branch protection/security scanning | Medium | GitHub reports branch protection/secret scanning/dependabot unavailable or disabled for private repos | Decide whether to upgrade GitHub plan, make selected repos public/private differently, or add CI scanners | Keep private repos isolated until scanning exists |
| R-014 | Vercel live project inventory is blocked | Medium | Vercel connector returned 403 for CRM project and no teams | Confirm Vercel access/team; export env/domain/deploy settings | Use Vercel dashboard manual inventory if API blocked |
| R-015 | Cloudflare production settings are not inventoried | Medium | Website deploy script references Cloudflare Pages; no live Cloudflare data inspected | Confirm Pages project, DNS records, proxy rules, cache rules | Roll back via Cloudflare Pages deployment history |
| R-016 | Script sprawl can cause accidental live data mutations | Medium | 85 CRM scripts; many names imply backfill, fix, migration, Twilio, Supabase writes | Catalog scripts and mark safe/dangerous before running | Revert DB changes from backups/migration rollback where possible |
| R-017 | Deployment docs advise copying `.env.local` manually | Medium | `DEPLOY.md` tells operator to copy values from local env into Vercel | Replace with safer env runbook and password-manager source of truth | Restore old docs if new process incomplete |
| R-018 | Generated/audit/data files sit in app repo root | Medium | XLSX/CSV/log/mission docs in CRM root | Move to docs/archive or secure data storage after confirmation | Quarantine move is reversible in Git |
| R-019 | Supabase RLS was recently repaired by broad migration | Medium | `20260429_enable_rls_public_tables.sql` enables RLS across public tables and drops legacy anon policies | Verify production applied state; avoid changing DB policies without test | Use SQL migration rollback/restore plan |
| R-020 | Website and CRM use multiple hosting paths | Medium | CRM Vercel, website Vercel project file, Cloudflare Pages deploy, edge integrity check | Create one hosting/domain map | Promote previous deployment or revert DNS/proxy config |
| R-021 | Some health gates are not purely read-only | Medium | `gate:twilio` and `gate:edge` call live production endpoints; `/api/twilio-token` can update the Twilio TwiML app URL | Separate read-only checks from repair/update checks; add explicit dry-run mode | Do not run these gates during audit-only phases without approval |
| R-022 | Lint is not a usable quality gate yet | Medium | `npm run lint` failed with 475 errors and 181 warnings, mostly existing `any` types, CommonJS scripts, and React hook/compiler rules | Decide whether to scope lint to app code first or fix by category in small PRs | Do not add lint as required CI until the baseline is cleaned or scoped |
| R-023 | Production can be deployed from a dirty local worktree | High | Apr 30 Twilio incident was fixed live with `vercel deploy --prod` from local `codex/dialer-v2-current-crm`; live branch had missed the Twilio env sanitizing already present on `main` | Require production deploys from protected GitHub branches except documented emergencies; backfill emergency fixes into PRs immediately | Promote previous Vercel deployment or revert the single emergency commit |
| R-024 | Twilio health gate can miss invalid Voice tokens | High | `gate:twilio` passed while the live token contained hidden whitespace in the Account SID; the browser dialer still failed to initialize | Update gate to decode JWT claims without printing secrets and fail on malformed `sub`, `iss`, Voice grant, or cache headers | Keep stronger gate warn-only until stable, then require it in CI |
| R-025 | Supabase legacy key exposure contained; local cleanup still pending | Medium | Vercel Production/Preview and the public website now use modern Supabase publishable/secret keys; Supabase legacy keys were disabled for `apikey` header use; legacy HS256 signing key was revoked; production gates passed | Clean local ignored env backups; monitor Supabase/GitHub for any residual legacy-key use; keep Supabase alert evidence documented | Move revoked key back to standby/rotate back if Supabase allows; re-enable legacy API keys only if production breaks |
| R-026 | Google Maps API key is broad and not browser-restricted | High | Google Cloud active key has API restrictions but no browser/referrer restrictions and allows many APIs beyond CRM map usage; Vercel uses the key for `NEXT_PUBLIC_GMAPS_KEY` and `GOOGLE_MAPS_API_KEY` | Create separate browser/server map keys with narrow API/referrer restrictions; update Vercel; test maps; then retire old key | Restore previous Vercel env values and re-enable old key if map flows break |
| R-027 | Twilio SMS webhooks point to temporary Cloudflare tunnel | High | Twilio inventory shows incoming numbers use `crm.savingkc.com` for voice but a `trycloudflare.com` host for SMS callbacks | Update all incoming-number SMS webhook URLs to `https://crm.savingkc.com/api/twilio-sms-webhook` after action-time confirmation | Revert SMS webhook URLs to prior value if CRM SMS ingestion breaks |
| R-028 | Browser-side Supabase reads can silently return empty after auth/RLS/key changes | High | The dialer showed zero attached leads while a server-side queue route returned 251 leads, 97 followups, 236 contacts, and 228 prospects | Move critical CRM reads behind server route handlers that use the controlled Supabase admin client; audit remaining browser-side Supabase reads | Roll back the affected route/component changes or promote the previous Vercel deployment if a server route regresses |
| R-029 | Active live dialer branch is unprotected and misses GitHub Actions gates | High | `codex/dialer-v2-current-crm` reports "Branch not protected"; `.github/workflows/quality-gates.yml` only triggers PRs/pushes to `main` | Decide whether to promote work to `main` or protect the live branch; expand workflow triggers while branch remains active | Temporarily remove a required check only if emergency fixes are blocked |

## Highest Priority Sequence

1. Protect the current dirty CRM worktree.
2. Rotate/restrict any credentials tied to open GitHub secret alerts.
3. Configure CI secrets/vars so critical gates actually run.
4. Add CODEOWNERS and real PR review requirement.
5. Require edge integrity after it is configured.
6. Quarantine legacy/duplicate code only after a safe baseline exists.

## Production Incident Notes

### 2026-04-30: Twilio Browser Dialer Offline

Observed symptom: `crm.savingkc.com/dialer` showed "Dialer failed to initialize" and stayed offline.

Finding: Twilio's public status page showed Programmable Voice operational. The CRM's live `/api/twilio-token` endpoint returned HTTP 200, but the JWT payload included hidden whitespace in the Account SID. That made the token look healthy to the current gate while still being unsafe for Twilio Voice SDK registration.

Immediate containment:

- Patched `/api/twilio-token` to sanitize Twilio env values before generating tokens.
- Deployed production deployment `dpl_9K8yAXRnZcfT2tkWNT1dNvFjkkvi`.
- Previous rollback deployment: `dpl_sXwfo8kapp1nxsCdqr3QUaEyeQ4F`.
- Merged PR #78 to backfill the one-file fix into the live dialer branch.
- Merged PR #79 to harden the Twilio health gate.

Prevent recurrence:

- Strengthen `gate:twilio` so it decodes token claims and checks for malformed Account SID/API key values without logging secrets.
- Stop using local dirty worktrees as the normal production deploy path.

### 2026-05-03: Dialer Queue Empty After Supabase Containment

Observed symptom: the dialer page loaded but could not start calling because no leads were attached to the queue.

Finding: the queue builder depended on browser-side Supabase reads. After auth/RLS/key containment, those reads could return an empty client view even though production data still existed.

Immediate containment:

- Added a server route for the dialer queue.
- Updated the dialer page to load queue, cohort, and saved-session leads through the server route.
- Set the default dialer preset to a broad custom queue instead of today's scheduled-only list.
- Verified production `/api/dialer/queue` returned 251 leads.
- Verified the live dialer showed 251 ready leads and enabled queue start controls.

Prevent recurrence:

- Move business-critical reads behind audited server APIs.
- Keep browser Supabase reads only for low-risk UI reads after RLS behavior is verified.

## Security Notes

- GitHub alert details may expose secret values through API responses. Do not paste those values into issues, docs, PRs, or chats.
- Public anon keys are not automatically secret, but they are only safe when Supabase RLS is correct and tested.
- Service-role keys are always high-risk. Treat any historical exposure as compromised until rotated.
