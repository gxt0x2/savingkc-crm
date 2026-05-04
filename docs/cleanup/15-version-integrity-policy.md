# SavingKC CRM Cleanup: Version Integrity Policy

Date: 2026-05-03

No secret values are recorded in this document.

## Current State

The public CRM at `https://crm.savingkc.com` is currently running production deployment `dpl_46Y7STSCf6whBFz15iw81KwhARm1`.

That deployment was built from the stabilization line, not from `main`.

Temporary active source of truth:

- `codex/stabilization-checkpoint-20260503`

Long-term source of truth:

- `main`, after the live stabilization line is reconciled back into it.

## Policy

Production must map to a reviewed Git commit, not an uncommitted local folder.

Allowed production paths:

1. Merge PR into the protected source-of-truth branch.
2. Let Vercel deploy from that branch, or promote the reviewed preview deployment.
3. Tag the released commit.

Emergency exception:

1. A direct production deploy is allowed only for live outage containment.
2. The deployed commit or local diff must be backfilled into a PR immediately.
3. The PR must document the deployment ID, rollback deployment, gates run, and reason for emergency.

## Required Checks

Required checks for protected production branches:

- `gate-build-and-theme`
- `gate-twilio-token-health`
- `gate-edge-integrity`
- `gitleaks`
- `Vercel`

Local evidence before opening or updating a production PR:

- `npm run build`
- `npm run gate:routes`
- `npm run gate:theme`
- `npm run test:ci`
- `npm run gate:twilio`
- `npm run gate:edge`

For UI/navigation changes, also run:

- `npm run test:smoke:theme`
- A browser smoke check of the changed route or preview URL.

## Branch Rules

`main`:

- Protected.
- Long-term canonical source of truth.
- Production should move back here after stabilization is reconciled.

`codex/stabilization-checkpoint-20260503`:

- Temporary active source of truth while production differs from `main`.
- Must be protected while it represents live production.
- Must require PRs and status checks.

Feature branches:

- Never receive production aliases directly.
- May get Vercel preview deployments.
- Must merge through PR.

## Release Tags

Use production release tags after deployment:

```text
prod-YYYY-MM-DD-short-description
```

Example:

```text
prod-2026-05-03-stabilization
prod-2026-05-04-tc-portal
```

Each tag should point to the Git commit that matches the Vercel production deployment.

## Rollback

Preferred rollback order:

1. Promote the previous known-good Vercel deployment.
2. Revert the one bad PR commit.
3. Open a rollback PR with the deployment ID and failed gate or symptom.

Do not use destructive Git reset commands for rollback unless explicitly approved.

## Open Follow-Up

`main` still needs reconciliation with the current live stabilization line. Until that is done, treat `codex/stabilization-checkpoint-20260503` as the production source-of-truth branch.
