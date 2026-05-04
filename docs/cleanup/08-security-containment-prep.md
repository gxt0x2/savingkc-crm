# Security Containment Prep

Date: 2026-05-01

Scope: current security containment inventory and next-action plan. No secrets are recorded here. No credentials were rotated, deleted, or resolved during this prep step.

## Executive Summary

Security containment should happen before broad cleanup or branch pruning. The top concern is not one single exposed key; it is the combination of public secret alerts, incomplete CI wiring, unprotected active release branches, and production deploys that have happened outside the normal protected-branch path.

The immediate goal is to rotate/restrict exposed credentials, make CI gates real, and prevent emergency fixes from living only on a local machine.

## Current GitHub Security Snapshot

Repo:

```text
gxt0x2/savingkc-crm
```

Visibility:

```text
public
```

Open secret-scanning alerts:

| Alert | Type | State | Publicly leaked | Validity |
| --- | --- | --- | --- | --- |
| 1 | Google API Key | Open | Yes | Unknown |
| 2 | Supabase Service Key | Open | Yes | Unknown |
| 3 | Twilio Account String Identifier | Open | Yes | Unknown |

Important notes:

- Do not paste alert details, raw locations, or detected values into issues, PRs, docs, or chat.
- Do not mark alerts resolved until the corresponding credential has been rotated or restricted.
- Treat the Supabase service key exposure as high-risk until confirmed rotated. Service-role keys bypass RLS.
- Twilio Account SID is not a password by itself, but a public Twilio identifier should still trigger audit, token rotation review, and account hardening.

Open Dependabot alerts:

| Alert | Package | Severity | Patched version | Notes |
| --- | --- | --- | --- | --- |
| 1 | `next` | High | `16.2.3` | Prioritize first; direct framework dependency |
| 2 | `follow-redirects` | Medium | `1.16.0` | Often pulled through HTTP clients |
| 3 | `axios` | Medium | `1.15.0` | Same package family as alert 4 |
| 4 | `axios` | Medium | `1.15.0` | Can likely be handled with alert 3 |
| 5 | `uuid` | Medium | `14.0.0` | Major version update; needs compatibility check |
| 6 | `postcss` | Medium | `8.5.10` | Build-tool dependency |

## Current Branch And CI Controls

`main` branch protection:

| Control | State |
| --- | --- |
| Required checks | `gate-build-and-theme`, `gate-twilio-token-health`, `gitleaks` |
| Require branch up to date | Enabled |
| Required approving reviews | `0` |
| Code owner reviews | Disabled |
| Conversation resolution | Enabled |
| Admin enforcement | Enabled |
| Force pushes/deletions | Disabled |

Active live dialer branch:

```text
codex/dialer-v2-current-crm
```

Current state:

| Control | State |
| --- | --- |
| Branch protection | Not protected |
| Required checks | None at branch protection level |
| PR checks observed | Vercel preview only, unless target is `main` |

Workflow trigger gap:

```yaml
pull_request:
  branches: [main]
push:
  branches: [main]
```

This means PRs targeting `codex/dialer-v2-current-crm` do not run the GitHub Actions quality gates. They currently rely on Vercel preview checks plus local validation.

Actions configuration:

| Area | Current state |
| --- | --- |
| Repo Actions secrets | `0` configured |
| Repo Actions variables | `0` configured |
| Allowed actions | All actions allowed |
| SHA pinning | Not required |
| Default workflow permissions | Read |
| PR workflow approval by actions | Disabled |

Environment configuration:

| Environment | Protection rules |
| --- | --- |
| `Preview` | None |
| `Preview - savingkc-crm` | None |
| `Preview - savingkc-crm-clean` | None |
| `Production` | None |
| `Production - savingkc-crm` | None |
| `Production - savingkc-crm-clean` | None |

Repo hygiene:

| File/control | State |
| --- | --- |
| `.github/CODEOWNERS` | Missing |
| `.github/pull_request_template.md` | Missing |
| `.github/ISSUE_TEMPLATE/*` | Missing |

## Immediate Containment Plan

Do these in order.

### Step 1: Credential Ownership And Rotation

Risk: High

Owner action required:

- Identify where each exposed credential is currently configured: Vercel env, Supabase dashboard, Twilio dashboard, Google Cloud console, Cloudflare Pages, local `.env` files, and GitHub Actions if later added.
- Rotate or restrict credentials in service dashboards first.
- Update Vercel/hosting env values from the source of truth.
- Deploy and smoke test.
- Resolve GitHub secret alerts only after the replacement is live and old access is revoked or restricted.

Recommended order:

1. Supabase service-role exposure.
2. Google API key exposure.
3. Twilio account/API/auth token review.
4. Local broad GitHub token replacement.

### Step 2: Make CI Gates Real

Risk: Medium

Current problem:

- `gate:twilio` is now strong, but the workflow can still no-op if `TWILIO_HEALTH_BASE_URL` is missing.
- Repo Actions secrets and variables are empty.
- The active dialer branch does not run the GitHub Actions workflow because the workflow only targets `main`.

Safe sequence:

1. Configure repository variable `TWILIO_HEALTH_BASE_URL`.
2. Configure any required bearer/token secret only if the endpoint becomes protected.
3. Expand workflow pull request triggers to include the live release branch while this branch is active.
4. Change missing critical config from no-op to failure after the variables are set.
5. Add edge integrity only after Vercel/Cloudflare access is confirmed.

### Step 3: Protect The Active Release Branch

Risk: Medium

Current problem:

- `main` has branch protection, but active work is landing on `codex/dialer-v2-current-crm`.

Safe sequence:

1. Decide whether `codex/dialer-v2-current-crm` remains the active release branch or gets merged/promoted into `main`.
2. If it remains active, add temporary branch protection with required Vercel/GitHub checks.
3. If it will be merged, make `main` the release source of truth and stop production deploys from the unprotected branch.

### Step 4: GitHub Hygiene

Risk: Low/Medium

Small PRs:

1. Add CODEOWNERS.
2. Add PR template.
3. Add issue templates.
4. Require at least one approving review after emergency-flow expectations are documented.
5. Standardize labels and milestones after the repo is stabilized.

### Step 5: Dependency Alerts

Risk: Medium

Recommended PR order:

1. Next.js `16.2.3` only, because it is high severity and direct.
2. Axios/follow-redirects together if dependency tree allows.
3. PostCSS.
4. UUID separately because it may be a major-version compatibility change.

## What Changed / Why / Risk / Rollback

What changed:

- Added this security containment prep note.
- Queried GitHub metadata for secret alerts, Dependabot alerts, branch protection, Actions config, environments, and repo hygiene.

Why:

- Security work needs a precise, non-secret inventory before any credential rotation or branch protection change.

Risk:

- Low. This is documentation and metadata inventory only.

Rollback:

- Revert this docs commit. No production rollback is required.
