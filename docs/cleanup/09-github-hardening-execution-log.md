# GitHub Hardening Execution Log

Date: 2026-05-01

Scope: first reversible GitHub/CI hardening step after Phase 1 audit and security containment prep.

## What Changed

Merged PR #82:

```text
https://github.com/gxt0x2/savingkc-crm/pull/82
```

PR #82 changed:

- `quality-gates.yml` now runs on PRs and pushes for `main` and `codex/dialer-v2-current-crm`.
- `secret-scan.yml` now runs on PRs and pushes for `main` and `codex/dialer-v2-current-crm`.
- Both workflows now support manual dispatch.
- Twilio health no longer passes as a no-op when `TWILIO_HEALTH_BASE_URL` is missing.
- Added `.github/CODEOWNERS`.
- Added a pull request template.
- Added issue templates for bug reports, tasks, and security hardening.

Configured repository Actions variable:

```text
TWILIO_HEALTH_BASE_URL=https://crm.savingkc.com
```

Applied branch protection to:

```text
codex/dialer-v2-current-crm
```

Protected-branch settings applied:

| Control | State |
| --- | --- |
| Required status checks | `gate-build-and-theme`, `gate-twilio-token-health`, `gitleaks` |
| Require branch up to date | Enabled |
| Require pull request review object | Enabled |
| Required approving reviews | `0` |
| Code owner review requirement | Disabled for now |
| Dismiss stale reviews | Enabled |
| Conversation resolution | Enabled |
| Admin enforcement | Enabled |
| Force pushes | Disabled |
| Branch deletion | Disabled |

## Why

The active dialer branch was receiving production-relevant fixes while only `main` had GitHub Actions coverage and branch protection. This created a gap where production changes could bypass the real build/theme/Twilio/secret-scan gates.

## Validation

PR #82 checks passed before merge:

- Vercel preview passed.
- `gate-build-and-theme` passed.
- `gate-twilio-token-health` passed.
- `gitleaks` passed.

After merge, push checks on `codex/dialer-v2-current-crm` passed:

- Quality Gates passed.
- Secret Scan passed.

Branch protection was queried after the change and confirmed active.

## Risk

Risk: Medium.

The branch is safer now, but emergency pushes directly to the active branch may be blocked by required checks. This is intentional for normal work, but emergency deployment paths should be documented before reviewer requirements are increased.

Reviewer requirements were not raised yet because there is no confirmed second reviewer/team flow. Setting required approvals to `1` with admin enforcement could block the founder during emergencies.

## Rollback

To roll back workflow/template changes:

```text
Revert PR #82.
```

To roll back the non-secret Actions variable:

```text
gh variable delete TWILIO_HEALTH_BASE_URL --repo gxt0x2/savingkc-crm
```

To relax branch protection in an emergency:

1. Remove required status checks from `codex/dialer-v2-current-crm`, or
2. Temporarily remove branch protection from `codex/dialer-v2-current-crm`, then
3. Reapply protection after the emergency fix is merged/backfilled.

Do not permanently remove branch protection without recording the reason and replacement control.

## Next Hardening Steps

1. Rotate/restrict exposed credentials in service dashboards.
2. Require at least one approval only after reviewer/team flow is confirmed.
3. Decide whether `codex/dialer-v2-current-crm` should merge into `main` and make `main` the only production source of truth.
4. Configure edge integrity only after Vercel/Cloudflare access is confirmed.
