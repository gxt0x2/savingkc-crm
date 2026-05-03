# SavingKC CRM Cleanup: Target Repo Structure

This is the target shape. It is not implemented in Phase 1.

## Target Single Source Of Truth

Primary CRM source of truth:

```text
gxt0x2/savingkc-crm
```

Local working tree should be one obvious folder, ideally not a `-fix` folder long term:

```text
/Users/ernestdodson/savingkc-crm
```

The current active folder is a worktree:

```text
/Users/ernestdodson/Documents/New project/savingkc-crm-fix
```

Do not rename or move it until the dirty branch is safely committed/pushed or intentionally parked.

## Target CRM Layout

```text
savingkc-crm/
  src/
    app/                 # Next.js App Router pages and API routes
    components/          # Reusable UI and workflow components
    hooks/               # Client hooks
    lib/                 # Domain logic and service clients
    middleware/          # Auth/proxy helpers if kept outside proxy.ts
    types/               # Shared TypeScript types
  supabase/
    migrations/          # Canonical DB migrations
  scripts/
    ci/                  # CI gates only
    migration/           # DB migration/verification helpers
    ops/                 # Safe operator scripts
    archive/             # Historical scripts, not run by default
  tests/
    unit/
    smoke/
    e2e/
  docs/
    architecture/
    cleanup/
    runbooks/
    security/
    archive/
  infra/
    vercel/
    cloudflare/
    github/
  public/
  package.json
  README.md
```

## Workspace Target

```text
New project/
  savingkc-crm/                  # active CRM checkout/worktree
  savingkc-website/              # active marketing site checkout
  services/
    jackson-county-parcel-scraper/
  quarantine/
    2026-05-cleanup/
```

This workspace target is only for local organization. GitHub repos should remain separate unless there is a deliberate monorepo decision.

## Documentation Target

| Doc area | Purpose |
| --- | --- |
| `docs/architecture/` | Source-of-truth architecture, integration map, domain map |
| `docs/runbooks/` | Founder-safe operating instructions |
| `docs/security/` | Rotation, incident response, env ownership, access matrix |
| `docs/cleanup/` | This cleanup program and audit evidence |
| `docs/archive/` | Historical mission logs and completed audits |

README target:

1. What this app does.
2. Where production lives.
3. How to run locally.
4. How to deploy.
5. How to roll back.
6. What not to touch without approval.

## Script Target

Scripts should have one of these labels in filename or header:

| Label | Meaning |
| --- | --- |
| `ci` | Safe in CI; no production mutation |
| `verify` | Read-only or local-only check |
| `ops` | Operator script with documented env requirements |
| `migration` | DB migration support; requires backup/approval |
| `danger` | Can mutate production or send messages; not runnable by accident |
| `archive` | Historical; not part of normal workflow |

Every production-touching script should state:

1. Required env vars.
2. Whether it reads or writes production.
3. Dry-run support.
4. Rollback.

## GitHub Target

Branch strategy:

| Branch type | Purpose |
| --- | --- |
| `main` | Production source of truth |
| `codex/*` | Small agent-created cleanup/fix branches |
| `fix/*` | Human or agent bugfixes |
| `feat/*` | Feature work |
| `restore/*` | Temporary rollback/restore branches |
| `archive/*` | Branches kept only for historical reference |

Required GitHub files:

```text
.github/
  CODEOWNERS
  pull_request_template.md
  ISSUE_TEMPLATE/
    bug_report.yml
    task.yml
    security_hardening.yml
  workflows/
    quality-gates.yml
    secret-scan.yml
    tag-baseline.yml
```

Target branch protection for `main`:

1. Require pull request before merge.
2. Require at least one approving review.
3. Require CODEOWNERS review for sensitive paths.
4. Dismiss stale approvals.
5. Require conversation resolution.
6. Require up-to-date branch.
7. Require these checks:
   - build
   - route integrity
   - theme smoke
   - Twilio health
   - edge integrity
   - secret scan
   - tests
8. Disable force pushes and deletions.
9. Restrict bypass to emergency admins only.

Suggested CODEOWNERS paths:

```text
* @gxt0x2
/src/app/api/twilio* @gxt0x2
/src/app/api/ivr/ @gxt0x2
/src/app/api/workers/ @gxt0x2
/src/app/api/cron/ @gxt0x2
/src/lib/supabase/ @gxt0x2
/supabase/migrations/ @gxt0x2
/.github/ @gxt0x2
/vercel.json @gxt0x2
```

## Repo Boundaries

| Repo | Boundary |
| --- | --- |
| `savingkc-crm` | CRM, internal API, database migrations, telephony, workers, runbooks |
| `savingkc-website` | Public marketing site, forms, content, SEO, website deploy |
| Data/scraper repos | External enrichment/data services only |
| Ops/library repos | SOPs, templates, operating docs |

No CRM production code should live only in the local workspace root.
