# Legacy CRM build quarantine

The only deployable SavingKC CRM is defined by `.crm-canonical.json`.

## Canonical identity

- Repository: `gxt0x2/savingkc-crm`
- Production branch: `main`
- Vercel project: `savingkc-crm` (`prj_NOdFDJ328LIAGbIdQ7wwZnMFQTq2`)
- Pipeline: `/contacts?list=new`

## Quarantined behavior

- `/pipeline` is a retired route and must redirect to `/contacts?list=new`.
- The retired `Stage Management` interface must not be deployable.
- A production deployment from any branch other than `main` must fail.
- A checkout linked to another repository or Vercel project must fail its build.
- A local branch that does not contain current `origin/main` must fail its build.

## Required workflow

1. Fetch `origin/main` before beginning visible CRM work.
2. Run `npm run gate:canonical` before creating a preview.
3. Use `npm run preview` rather than invoking `vercel deploy` directly.
4. Hand off the exact canonical route, not a legacy alias.
5. Merge only through a reviewed pull request with all quality gates passing.

Old worktrees and deployments are retained only for recovery. They are not valid design references or deployment sources.
