# Legacy retirement standard

SavingKC removes legacy code as a controlled product operation, not as an occasional purge.

## Required lifecycle

1. Register every live subsystem in `src/config/system-registry.json` with an owner, status, routes, data, environment, and scheduled work.
2. Mark a superseded subsystem `deprecated` before deleting it. Record the replacement, reason, data-retention boundary, and target retirement date.
3. Move users and callers to the replacement and verify production usage before removing the old route.
4. Retire runtime setup, migration, seed, and synthetic-test endpoints. Use source-controlled migrations, authenticated administration, or local operations scripts instead.
5. Record deleted API handlers under `policies.retiredRuntimeRoutes`. The hygiene gate prevents them from returning.
6. Keep redirects for renamed user-facing routes until bookmarks and external callers have migrated.
7. Remove historical tables only after the named retention date and a production query confirms no active reader or exporter depends on them.

## Pull request requirements

- State the owner and replacement for every deletion.
- Include repository-wide reference searches and relevant production evidence.
- Run `npm run gate:hygiene`, unit tests, TypeScript, and the production build.
- Keep broad cleanup separate from feature work so rollback remains clear.
- Never place real credentials, customer data, or synthetic operational actions in a runtime route.

## Worktree maintenance

Run this after releases and during the monthly code-health review:

```bash
git fetch origin main --prune
npm run audit:worktrees
```

The audit is read-only. A `safe-candidate` is clean, merged into `origin/main`, and not the current worktree. Remove only individually reviewed safe candidates with `git worktree remove <exact-path>`. Anything marked `dirty-review` or `unmerged-review` must be preserved until its changes are reconciled.

## Review cadence

- Every PR: automated hygiene and retired-route checks.
- Monthly: worktree audit, deprecated-feature date review, unused-route review, dependency audit, and build-size review.
- Quarterly: data-retention approval for deprecated integrations and tables.
