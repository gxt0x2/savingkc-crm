# SavingKC CRM Cleanup: Dead Code Candidates

Rule: quarantine first, delete later. Nothing below should be deleted in Phase 1.

## Quarantine Policy

Before moving anything:

1. Confirm it is not referenced by production, CI, Vercel, Cloudflare, Supabase, Twilio, or active scripts.
2. Move it into a dated quarantine folder in a small PR.
3. Run gates.
4. Leave it there for a defined hold period.
5. Delete only in a later PR after approval.

Suggested quarantine root after approval:

```text
docs/cleanup/quarantine-log.md
quarantine/2026-05-cleanup/
```

## High-Confidence Candidates

| Candidate | Current path | Why it looks dead or misplaced | Proposed action | Risk |
| --- | --- | --- | --- | --- |
| Legacy root Next app | workspace root `src/`, `prisma/`, `package.json`, `middleware.ts`, `start-dialer.sh` | Separate uncommitted app named `saving-kc-v1`; older Next/Prisma/SQLite stack; overlaps CRM concepts | Quarantine as `legacy-root-next-app/` after comparison | Medium |
| Personal/non-CRM docs | root `ofw_*` files | Not CRM source or ops docs | Move outside CRM workspace | Low |
| Generated context/package dump | `meteorite-package.txt` | Large generated text artifact, not app source | Quarantine | Low |
| Old backup patch | `backups/savingkc-crm-20260426-dialer-cleanup.patch` | Backup artifact, not active code | Keep but move to dated archive | Low |
| Local generated DB | root `prisma/dev.db` | SQLite dev artifact from legacy app | Keep out of Git; quarantine with legacy app if needed | Medium |
| CRM generated output | `savingkc-crm-fix/.next`, `test-results`, logs | Generated artifacts, not source | Ensure ignored; clean only after branch/worktree safety checkpoint | Low |

## Medium-Confidence Candidates

| Candidate | Current path | Why it needs review | Proposed action | Risk |
| --- | --- | --- | --- | --- |
| CRM one-off scripts | `savingkc-crm-fix/scripts/check-*`, `fix-*`, `test-*`, `verify-*`, `backfill-*` | 85 scripts with overlapping purposes; some hit live Supabase/Twilio | Catalog owner/purpose/env before moving | Medium |
| Overnight mission/log docs | `savingkc-crm-fix/OVERNIGHT_*`, `*_AUDIT.md`, `*_STATUS.md` | Valuable history but noisy at repo root | Move durable docs to `docs/archive/`; keep current runbooks in `docs/runbooks/` | Low |
| Audit spreadsheets/CSVs | `savingkc-crm-fix/*.xlsx`, `prospects_import.csv`, `prospect_phones_import.csv` | Operational data mixed with source | Move to secure data archive outside app repo or Git LFS/private storage | High |
| Disabled tunnel script | `savingkc-crm-fix/scripts/restart-tunnel.sh.DISABLED` | Explicitly disabled, may be historical | Quarantine after confirming Vercel/Cloudflare path | Low |
| Old opportunity page | `savingkc-crm-fix/src/app/(app)/opportunities/page-old.tsx` | Name suggests replaced page | Compare routing/imports, then quarantine | Medium |
| Root README templates | CRM and website README files | Still default starter docs, not dead but misleading | Replace with real runbooks, not quarantine | Low |

## Branch And Worktree Candidates

Do not delete branches in this phase. Several local branches are attached to worktrees outside this folder.

Observed branch classes:

| Class | Examples | Proposed handling |
| --- | --- | --- |
| Active cleanup/CRM work | `codex/dialer-v2-current-crm`, `codex/secret-hygiene-hardening` | Protect until merged or explicitly superseded |
| Recent feature/fix branches | `fix/smartskip-*`, `feat/*`, `codex/*` | Map to PRs/issues before pruning |
| Claude worktree branches | many `claude/*` branches | Treat as generated worktrees; confirm merged value before pruning |
| Restore/backup branches | `codex/backup-*`, website `restore/*` | Keep through cleanup as rollback anchors |
| Stacked/stale PR branches | PRs with non-main bases or conflicts | Close or retarget only after founder approval |

## Side Repos To Isolate, Not Delete

| Repo | Why isolate | Current action |
| --- | --- | --- |
| `savingkc-website` | Active marketing site, separate lifecycle from CRM | Keep as separate repo |
| `jackson-county-parcel-scraper` | Dirty side service with scraper/enrichment logic | Keep separate until dependency confirmed |
| `savingkc-library`, `savingkc-ops` | Operational docs/scripts | Inventory later; do not mix into CRM app repo |
| `skip-trace`, `mojo-eod-gather`, scraper repos | Possible service dependencies | Confirm production usage before archive |
| `savingkc-dialer` | Already archived public repo | Keep archived as historical rollback/reference |

## Not Dead

These are messy but appear production-relevant:

| Area | Why it stays |
| --- | --- |
| `savingkc-crm-fix/supabase/migrations` | Canonical DB history |
| `savingkc-crm-fix/scripts/ci` | Wired to npm gates and GitHub Actions |
| `savingkc-crm-fix/src/app/api/twilio-*`, `ivr/*` | Critical Twilio production paths |
| `savingkc-crm-fix/src/app/api/workers/*`, `cron/*` | Background production workflows |
| `savingkc-website/public/partial-capture.js` | Active website lead capture path, even though it needs security review |

## Next Audit Tasks

1. Build a script inventory table with command, required env, reads/writes, and production risk.
2. Check imports/references before moving any candidate file.
3. Compare legacy root app route list against active CRM route list.
4. Confirm data files are not needed for repeatable imports.
5. Confirm side-service usage in Vercel/Supabase/Twilio dashboards before archive decisions.
