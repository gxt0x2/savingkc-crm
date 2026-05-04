# SavingKC CRM Cleanup: Rollback Plan

Default rollback rule: prefer `git revert` or moving quarantined files back. Do not run destructive commands such as `git reset --hard` without explicit approval.

## Universal Safety Checklist

Before each phase:

1. Record current branch and commit.
2. Record `git status --short --branch`.
3. Confirm whether files are tracked, modified, or untracked.
4. Make the smallest possible PR.
5. Run the agreed gates.
6. Stop and ask to continue.

## Rollback Tools

| Tool | Use for | Notes |
| --- | --- | --- |
| `git revert <commit>` | Undo committed code/doc changes | Preferred for merged PRs |
| Quarantine manifest | Restore moved files | Each move should record original path |
| Git tags | Return to known baseline | Existing workflow tags main as `baseline-*` |
| Vercel rollback/promote | Restore prior CRM deployment | Requires Vercel access |
| Cloudflare Pages rollback | Restore prior website deployment | Requires Cloudflare access |
| Supabase backup/migration | Restore DB state | High risk; requires explicit approval |
| Twilio dashboard | Restore webhook URLs/settings | Record old URLs before changes |
| GitHub branch protection export | Restore repo controls | Capture JSON/settings before edits |

## Phase Rollback Matrix

| Phase | Rollback |
| --- | --- |
| Phase 1 audit docs | Revert/delete only `docs/cleanup/*` |
| Phase 2 source checkpoint | Return to pre-phase branch/checkpoint; do not reset dirty work without approval |
| Phase 3 secret rotation | Rotate forward again or restore from password manager only if previous value is safe |
| Phase 4 GitHub/CI hardening | Remove new required checks or revert workflow/CODEOWNERS PR |
| Phase 5 quarantine | Move files back from quarantine manifest |
| Phase 6 scripts | Restore original script paths and package/workflow references |
| Phase 7 auth/integration | Revert route-specific auth change; avoid broad permanent bypass |
| Phase 8 branch/repo cleanup | Restore branches from remote/tags; unarchive repo if needed |
| Phase 9 runbooks | Revert docs PR |

## Vercel Rollback

Needed before changing deploy-impacting files:

1. Record current production deployment URL.
2. Record project, team, domains, env target names.
3. Confirm who can promote previous deployments.

Rollback path:

1. Promote the previous known-good deployment.
2. Re-run edge integrity.
3. Re-run Twilio health.
4. Smoke test login and lead pages.

Access gap: live Vercel connector returned `403 Forbidden` during Phase 1, so this must be confirmed manually or with corrected Vercel access.

## Cloudflare Rollback

Needed before changing website deploy/DNS/proxy behavior:

1. Record Pages project name.
2. Record production deployment ID.
3. Record DNS/proxy/cache rules for `savingkc.com` and any CRM subdomains.

Rollback path:

1. Restore previous Pages deployment.
2. Revert DNS/proxy/cache rule changes.
3. Smoke test lead forms.
4. Confirm CRM receives submitted leads.

## Supabase Rollback

High-risk area. Do not change schema/RLS without an approved rollback.

Before DB changes:

1. Export current migration status.
2. Take or confirm a backup/snapshot.
3. Write a forward migration and a rollback note.
4. Test against a non-production database if available.

Rollback path:

1. Stop writes if data integrity is at risk.
2. Apply rollback SQL only if tested.
3. Restore backup if rollback SQL is unsafe.
4. Re-run app smoke tests and RLS checks.

## Twilio Rollback

Before webhook or credential changes:

1. Record current phone number config.
2. Record voice webhook URL.
3. Record SMS webhook URL.
4. Record status callback URLs.
5. Record TwiML app SID and voice URL.

Rollback path:

1. Restore previous webhook URLs.
2. Re-run `npm run gate:twilio` with production URL.
3. Test inbound SMS.
4. Test inbound call.
5. Test outbound dialer token.

## GitHub Rollback

Before branch protection/workflow changes:

1. Export branch protection JSON.
2. Record required checks.
3. Record Actions secrets/variables names, not values.
4. Record CODEOWNERS and templates if present.

Rollback path:

1. Revert workflow/template/CODEOWNERS PR.
2. Restore branch protection settings.
3. Confirm PR checks still protect `main`.

## Quarantine Restore Template

Each quarantine move should append:

```text
Date:
Original path:
Quarantine path:
Reason:
Moved by:
Validation gates:
Restore command:
Deletion eligible after:
```

## Emergency Stop Conditions

Stop immediately if any of these happen:

1. Production CRM login fails.
2. Twilio inbound/outbound calling fails.
3. Website lead forms stop reaching CRM.
4. Supabase RLS denies legitimate operator workflows.
5. A secret appears in Git, CI logs, docs, issues, or PR comments.
6. A cleanup step touches files outside the approved phase scope.
