# Scope-frozen CRM final acceptance — August 26, 2026

## Decision

The scope-frozen AI-native CRM product boundary is accepted on merge commit
`9a9ee8014776634b166377ceafdbbf4c9e48dfd5`.

The four frozen product pillars pass their contract, migration, rehearsal,
desktop, mobile, and production release checks. No audit step created a Lead,
placed a call, sent a message, started a workflow, or changed production CRM
data.

This is a product-scope acceptance, not a claim that all historical repository
debt is complete. The two remaining engineering debts are recorded below and
must not be allowed to reopen or redesign the accepted CRM scope.

## Accepted product boundary

| Pillar | Acceptance evidence | Result |
| --- | --- | --- |
| Event-backed work and workflows | Durable work-item, workflow-run, approval, lease, retry, step, and seller-intake contracts; signed-in Workflows surface exposes registry health, definitions, phone workflows, templates, and entity integrity. | Pass |
| Canonical entities and Manifest retirement | Canonical communication, property, intake, promotion, briefing, and decision contracts pass; application runtime remains off Manifest; retained Manifest history is read-only and no historical table is deleted. | Pass |
| Governed AI | Generation ledger, provenance, confirmation, canonical briefing, and reviewed AI-change decision contracts pass; browser roles cannot directly mutate the protected ledgers. | Pass |
| Department lifecycle and desktop/mobile parity | Acquisitions → Dispositions → Transaction Coordination → Marketing rehearsal passes twice-safe lifecycle, receiver acceptance, and funded-close idempotency; desktop routes build; mobile work, ownership, completion, and handoff contracts pass. | Pass |

## Prospecting and dialer acceptance

- Production Prospecting is signed in and loads the active County Tax
  Delinquent 2-Year pilot.
- `Resume where I stopped` is the default start position.
- Every associated contact remains in the seller context while suppression is
  enforced per number.
- The reviewed session setup, persistent controls, 15-second start sequence,
  ring policy, prospecting dispositions, contact notes, and authoritative daily
  metrics are included in the accepted release.
- The read-only production preflight reports zero active SMS campaigns, zero
  paused SMS campaigns, and zero queued or processing campaign actions.
- Current source inventory remains 24,544 prospects and 24,210 phone rows; the
  pilot has 85 campaign members and 259 reviewed contact snapshots.

## Verification evidence

### Local contracts

- Focused frozen-scope suite: 32 files and 131 tests passed.
- Full repository suite: 470 files and 1,997 tests passed.
- TypeScript passed.
- Production Next.js build passed and emitted 128 static pages plus all dynamic
  CRM/API routes.
- Canonical CRM, control integrity, code hygiene, proxy, theme, terminology,
  route integrity, dialer ringback, performance bundle, security, and secret
  fallback gates passed.
- Root dependency audit reports zero vulnerabilities.
- Mobile health reports 21/21 checks passed and mobile TypeScript passed.
- Isolated PostgreSQL seller-to-close rehearsal passed, including replay-safe
  lifecycle events, Dispositions materialization, receiving-department
  acceptance, TC handoff, funded close, and Marketing revenue attribution.

### Production release

- PR: `#560`
- Reviewed head: `707a2948630c2edeb1c121883bb52ff7facb2c77`
- Merge commit: `9a9ee8014776634b166377ceafdbbf4c9e48dfd5`
- Production deployment: `https://savingkc-9pkusc978-gxt0x2s-projects.vercel.app`
- Production aliases include `https://crm.savingkc.com`.
- Exact-SHA Quality Gates run `32995897273` passed build/theme, mobile,
  production Twilio health, and edge integrity.
- Exact-SHA Secret Scan run `32995897311` passed.
- No error-level or HTTP 500 logs were returned for the merged production
  deployment during the post-release inspection window.
- Production Supabase records migration
  `20261019120000_prospecting_dialer_session_setup.sql` exactly once and reports
  no pending migration after apply.

## Remaining engineering debt

### 1. Repository-wide lint baseline

`npm run lint` currently reports 77 errors and 71 warnings on the unchanged
`main` baseline. The accepted release files remain protected by the changed-file
hygiene gate, and the exact merge SHA passed all required hosted checks, but the
repository as a whole is not lint-clean.

Treat this as a separate bounded hardening train. Do not mix it with CRM feature
work, alter business behavior to satisfy a lint rule, or describe it as a
regression introduced by PR `#560`.

### 2. Expiring mobile dependency exceptions

The mobile security gate passes with two documented upstream `image-size`
exceptions (`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`). Both expire on
September 15, 2026 and are owned by Mobile Platform. Replace or upgrade the
affected upstream dependency before that date; do not silently extend the
exceptions.

## Deferred by design

Physical Manifest archival remains a separately reviewed encrypted-data
operation. Runtime authority and writers are retired, but deleting historical
rows is not part of this acceptance and requires the verified archive receipt,
current row-count match, rollback rehearsal, and separate approval already
defined in `docs/manifest-retirement-plan.md`.

## Next execution order

1. Keep the accepted CRM scope frozen.
2. Complete the bounded repository lint-baseline hardening without behavior
   changes.
3. Remove the two mobile dependency exceptions before September 15, 2026.
4. Run normal operator pilot feedback through Andon evidence; fix verified
   defects without reopening the information architecture.
5. Treat physical Manifest archival as its own approval-gated data operation.
