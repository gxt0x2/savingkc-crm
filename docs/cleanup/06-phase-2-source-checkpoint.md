# Phase 2 Source Checkpoint

Date: 2026-05-01

Scope: protect the current CRM source of truth before any cleanup moves, deletes, branch pruning, or hardening edits. This phase intentionally does not change app code, deployment config, env files, or production services.

## Decision

Current active CRM source of truth remains:

```text
/Users/ernestdodson/Documents/New project/savingkc-crm-fix
```

This folder is a Git worktree for:

```text
gxt0x2/savingkc-crm
```

Current branch:

```text
codex/dialer-v2-current-crm
```

Do not rename, move, reset, or clean this worktree until the in-flight work is intentionally committed, pushed, or superseded.

## Safety Snapshot

Local snapshot path:

```text
/Users/ernestdodson/Documents/New project/backups/2026-05-01-phase2-source-checkpoint
```

Snapshot contents:

| File | Purpose |
| --- | --- |
| `README.txt` | Plain-English checkpoint note |
| `git-status-short.txt` | Current dirty working tree state |
| `git-worktrees.txt` | All linked worktrees for this repo |
| `git-log-recent.txt` | Recent commit context |
| `tracked-diff-stat.txt` | Summary of tracked local edits |
| `tracked-diff-name-status.txt` | Tracked local edit file list |
| `tracked-working-tree.diff` | Binary-safe patch of tracked local edits |
| `untracked-files.txt` | Untracked file list |
| `untracked-files.tar.gz` | Archive of untracked files |
| `codex-dialer-v2-current-crm.bundle` | Git bundle containing current branch, upstream branch, and `origin/main` |

Verification:

- Git bundle verified successfully.
- Untracked archive was readable.
- Basic token-pattern scan found no obvious secrets in the text snapshot files.
- Working tree status was unchanged after snapshot creation.

## Current Git State

At checkpoint time:

| Item | Value |
| --- | --- |
| Branch | `codex/dialer-v2-current-crm` |
| Upstream | `origin/codex/dialer-v2-current-crm` |
| Ahead/behind | Ahead 4 |
| Tracked modified files | 26 |
| Untracked paths/files | 16 file entries plus directories represented by files |

Tracked modified files:

```text
.env.example
.github/workflows/quality-gates.yml
DEPLOY.md
next.config.ts
package-lock.json
package.json
src/app/(app)/ari/page.tsx
src/app/(app)/dispo/deals/page.tsx
src/app/(app)/leads/[id]/page.tsx
src/app/api/call-log/route.ts
src/app/api/deals/import-photos/route.ts
src/app/api/leads/route.ts
src/app/api/notifications/route.ts
src/app/api/twilio-token/route.ts
src/app/api/twiml-voice/route.ts
src/app/deals/[slug]/page.tsx
src/app/deals/[slug]/photo-gallery.tsx
src/app/globals.css
src/components/ari/inbox-block.tsx
src/components/conversations/message-bubble.tsx
src/components/layout/nav-tab.tsx
src/components/layout/notification-bell.tsx
src/components/telephony/disposition-modal.tsx
src/components/ui/icon.tsx
src/hooks/use-push-notifications.ts
tests/qa-report.json
```

Untracked files captured in the snapshot:

```text
docs/EDGE_INTEGRITY.md
docs/cleanup/00-system-inventory.md
docs/cleanup/01-dead-code-candidates.md
docs/cleanup/02-risk-register.md
docs/cleanup/03-repo-structure-target.md
docs/cleanup/04-execution-plan.md
docs/cleanup/05-rollback-plan.md
scripts/ci/check-edge-integrity.mjs
src/app/api/maps/geocode/route.ts
src/app/api/maps/static/route.ts
src/lib/env-clean.ts
supabase/migrations/008_dialer_persistence.sql
supabase/migrations/009_dialer_audit.sql
supabase/migrations/20260429_enable_rls_public_tables.sql
supabase/migrations/20260430_dialer_saved_lists_resume_state.sql
tests/e2e/dialer-critical-paths.spec.ts
```

This Phase 2 document is an additional untracked file created after the snapshot.

## Worktree Warning

This repo has many linked worktrees, including:

| Worktree | Branch |
| --- | --- |
| `/Users/ernestdodson/savingkc-crm` | `codex/secret-hygiene-hardening` |
| `/private/tmp/savingkc-crm-release-20260430` | `codex/release-scope-20260430` |
| `/Users/ernestdodson/Documents/New project/savingkc-crm-fix` | `codex/dialer-v2-current-crm` |
| `/Users/ernestdodson/savingkc-crm-darklive` | `feat/dark-theme-combined` |
| `/Users/ernestdodson/savingkc-crm-main-import` | detached |
| `/Users/ernestdodson/savingkc-crm/.claude/worktrees/*` | multiple `claude/*` branches |

Do not prune worktrees or delete branches until each is mapped to a PR, deployment, or archive decision.

## Restore Notes

To restore tracked local edits from the snapshot:

```bash
git apply "/Users/ernestdodson/Documents/New project/backups/2026-05-01-phase2-source-checkpoint/tracked-working-tree.diff"
```

To inspect the bundle:

```bash
git bundle verify "/Users/ernestdodson/Documents/New project/backups/2026-05-01-phase2-source-checkpoint/codex-dialer-v2-current-crm.bundle"
```

To recover untracked files:

```bash
tar -xzf "/Users/ernestdodson/Documents/New project/backups/2026-05-01-phase2-source-checkpoint/untracked-files.tar.gz" -C "/Users/ernestdodson/Documents/New project/savingkc-crm-fix"
```

Use restore commands only after confirming what currently exists in the target paths.

## Gates Run

| Check | Result |
| --- | --- |
| Cleanup docs token-pattern scan | Passed |
| `git status --short --branch` | Completed; dirty state unchanged |
| `npm run gate:routes` | Passed |
| `npm run gate:theme` | Passed |
| `npm run test:ci` | Passed: 2 test files, 59 tests |
| `npm run build` | Passed with existing Turbopack NFT tracing warning |
| `npm run lint` | Not run for Phase 2; known failing baseline from Phase 1 |
| `gate:twilio`, `gate:edge` | Not run; live-production checks |

## What Changed / Why / Risk / Rollback

What changed:

- Created a local backup snapshot outside the CRM repo.
- Added this checkpoint document.

Why:

- The CRM worktree is dirty, ahead of origin, and surrounded by other worktrees. Cleanup work needs a reliable restore point before touching structure or security settings.

Risk:

- Low. The snapshot is additive and local. App code and production services were not changed.

Rollback:

- Delete the backup folder and this document if needed.
- No production rollback is required.
