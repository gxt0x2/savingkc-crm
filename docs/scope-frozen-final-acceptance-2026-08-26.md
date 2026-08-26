# Scope-frozen CRM final acceptance — August 26, 2026

## Decision

The scope-frozen AI-native CRM product boundary is accepted on merge commit
`9a9ee8014776634b166377ceafdbbf4c9e48dfd5`.

The four frozen product pillars pass their contract, migration, rehearsal,
desktop, mobile, and production release checks. No audit step created a Lead,
placed a call, sent a message, started a workflow, or changed production CRM
data.

This is a product-scope acceptance. The two engineering debts recorded at the
acceptance point and the separately approved physical Manifest archive were
subsequently completed on August 26, 2026. None of those closeout operations
reopened or redesigned the accepted CRM scope.

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

## Engineering debt closeout

### 1. Repository-wide lint baseline — complete

The repository-wide lint baseline was repaired without changing CRM behavior.
On the post-archive production head, `npm run lint` exits successfully with zero
errors and zero warnings. Changed-file hygiene and the full hosted quality gate
remain enabled.

This closeout does not authorize business-rule, workflow, or UI changes under a
lint label.

### 2. Expiring mobile dependency exceptions — complete

PR `#571` removed both temporary `image-size` exceptions and pinned the reviewed
hardening commit as version `2.0.3`. The mobile health gate now requires the
patched source, malicious-input termination probes, Expo asset parsing, Expo
Doctor, and mobile TypeScript. `apps/mobile/security-advisory-exceptions.json`
contains no exceptions.

## Physical Manifest archive — complete

The separately reviewed archive export, checksum verification, rollback
rehearsal, merge, deployment verification, and production-migration approval
were completed. Migration `20261020120000_manifest_physical_archive.sql` is
recorded in production. It moved all 367 retained Manifest rows and 10,668
history rows into the private `manifest_archive` schema, preserved the seven PPC
outbox and eight PPC tracking references, recorded the verified archive receipt,
and deleted no rows or tables. Signed-in My Day, Pipeline, and Prospecting smoke
checks passed after the move.

## Next execution order

1. Keep the accepted CRM scope frozen.
2. Run normal operator pilot feedback through Andon evidence; fix verified
   defects without reopening the information architecture.
3. Require a reproduced defect, narrow acceptance test, and proportionate
   production verification for each additional CRM change.
