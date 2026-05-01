# SavingKC CRM Cleanup: Execution Plan

Principles:

1. Small PR-sized changes only.
2. Quarantine before delete.
3. Every phase has gates and a rollback path.
4. Stop after each phase, summarize, and ask to continue.
5. Do not overwrite the current dirty CRM worktree.

## Phase 1: Audit And Inventory

Risk: Low

Status: in progress in this PR/working tree.

What changes:

- Add cleanup audit docs under `docs/cleanup/`.
- No app code/config/deploy changes.

Gates:

- `git status --short --branch`
- `npm run gate:routes`
- `npm run gate:theme`
- Optional if time allows: `npm run test:ci`
- Do not run `gate:twilio` or `gate:edge` during audit-only work unless approved; they call live production endpoints.

Known baseline: `npm run lint` is currently failing and should not be treated as a required Phase 1 pass condition.

Rollback:

- Delete or revert only the new `docs/cleanup/*` docs.

## Phase 2: Protect The Current Source Of Truth

Risk: Low/Medium

What changes:

- Create a clean safety checkpoint for current CRM work.
- Decide whether `codex/dialer-v2-current-crm` is the active release branch or a working branch.
- Document current dirty files and untracked files.
- Do not move app files yet.

Gates:

- `git status`
- `npm run build`
- `npm run gate:routes`
- `npm run gate:theme`

Rollback:

- Return to the pre-phase branch/checkpoint.
- No destructive reset without explicit approval.

## Phase 3: Security Containment

Risk: High

What changes:

- Confirm/perform rotation for exposed Supabase service key, Twilio credentials, Google API key, and any related keys.
- Restrict public browser keys by referrer/API scope.
- Resolve GitHub secret alerts only after rotation.
- Replace broad local GitHub token with least-privilege auth.
- Harden Twilio token validation so hidden whitespace or malformed JWT claims fail before users discover dialer outage.

Gates:

- GitHub secret scanning has no open unresolved active alerts.
- CRM can still build.
- Twilio token health gate passes against the configured production URL.
- Twilio health gate decodes JWT claims without printing secrets and verifies Account SID/API key shape, Voice grant, and cache behavior.
- Website forms still submit.

Note: Twilio and edge gates must be treated as live-production checks, not static checks.

Rollback:

- Re-apply previous env values only if the new value breaks production and the previous value is confirmed not compromised.
- Prefer service dashboard rollback over committing secrets anywhere.

## Phase 4: GitHub And CI Hardening

Risk: Medium

What changes:

- Add CODEOWNERS.
- Add PR and issue templates.
- Add required review count.
- Configure Actions vars/secrets for Twilio and edge gates.
- Make missing critical gate config fail protected branches instead of no-op.
- Require `gate-edge-integrity`.
- Require production deploys from protected GitHub branches except documented emergency deploys with immediate PR backfill.
- Decide how to make lint enforceable without blocking all work on the current backlog.
- Standardize labels.

Gates:

- Open a test PR and verify required checks appear.
- `quality-gates.yml` completes with real Twilio/edge checks.
- Gitleaks workflow runs.

Rollback:

- Temporarily remove a new required check if it blocks emergency fixes.
- Revert CODEOWNERS/templates if they block normal PR flow.

## Phase 5: Workspace Quarantine

Risk: Low/Medium

What changes:

- Move non-CRM root clutter and legacy root app into quarantine.
- Do not delete.
- Keep a quarantine manifest with original path, reason, and restore path.

Gates:

- CRM build and route gates pass.
- Website build passes if website files are touched.
- No production env files are moved without an operator-safe replacement.

Rollback:

- Move quarantined files back to original paths.

## Phase 6: Script Consolidation

Risk: Medium

What changes:

- Inventory all scripts.
- Mark each as `ci`, `verify`, `ops`, `migration`, `danger`, or `archive`.
- Move historical scripts to `scripts/archive/`.
- Add dry-run guards to dangerous scripts before normal use.

Gates:

- `npm run gate:*` still finds scripts.
- CI workflows still reference valid paths.
- No production-write script runs during cleanup unless explicitly approved.

Rollback:

- Restore script paths from quarantine/archive manifest.

## Phase 7: Runtime Auth And Integration Review

Risk: High

What changes:

- Audit broad proxy auth bypasses.
- Require route-level auth/secret validation for admin, workers, cron, Ari, enrich, and setup routes.
- Verify Twilio webhooks use signature validation or scoped endpoint controls where practical.
- Verify Supabase RLS for website partial capture.

Gates:

- Build.
- Unit tests.
- Route integrity.
- Twilio health.
- Manual inbound/outbound Twilio smoke test.
- Website lead form smoke test.

Rollback:

- Restore previous bypass for a single broken external route only, then add route-specific protection.

## Phase 8: Repo And Branch Cleanup

Risk: Medium

What changes:

- Close/merge stale PRs after review.
- Delete only branches confirmed merged or obsolete.
- Archive repos only after they are classified as dead.
- Keep restore branches/tags through the cleanup window.

Gates:

- No open PR is lost without issue/comment trail.
- Main branch protections still active.

Rollback:

- Restore branch from remote, tag, or local reflog if needed.
- Unarchive repo if a dependency is discovered.

## Phase 9: Founder-Safe Runbooks

Risk: Low

What changes:

- Replace starter READMEs.
- Add runbooks for deploy, rollback, env rotation, Twilio health, website forms, and incident response.
- Make "what not to touch" explicit.

Gates:

- Docs review only.
- Commands in runbooks are tested or clearly marked manual.

Rollback:

- Revert docs PR.

## Required Stop Point After Every Phase

Every phase summary must include:

```text
What changed:
Why:
Risk:
Rollback:
Gates run:
Result:
Continue? yes/no
```
