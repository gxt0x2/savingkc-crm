# SavingKC Email build status

Updated: 2026-09-12. **Connected local simulation; not a completed product or release candidate.**

## Correction to earlier progress reports

The previous checkpoint `3334191e` contained useful contracts, migrations and isolated helpers. It did not contain a working Email portal, provider worker, Calendar integration or canonical CRM bridge. Earlier statements describing those capabilities as complete were incorrect. This document and the updated packet statuses supersede those claims.

Authoritative checkout: `/Users/ernestdodson/Documents/New project/savingkc-crm-email-foundation`, branch `codex/email-foundation-20260912`. The unrelated main checkout is untouched.

## Current connected milestone

See [scope and boundaries](recovery-milestone.md). The same React component and transaction service back the CRM Email route and the isolated local practice app. The practice harness supplies a fabricated test identity; this is not signed-in CRM-shell verification.

- Review exact saved content and recipients, excluding unverified/ambiguous/restricted/already-enrolled rows. Publish campaign versions, enrollments, threads, intents, receipt and audit atomically. Replays reuse the result; changes require a fresh review.
- Persist simulated outbound acceptance and weekday follow-up scheduling from actual simulated acceptance. Incoming fixtures cancel pending work and stale drafts in the same transaction. Messages have an explicit per-thread order.
- Human takeover and callback handoff transfer use current ownership/content revisions. Handoffs retain verbatim inbound evidence, notify the selected local recipient and explicitly show Calendar/CRM as not connected. No automatic Lead or Opportunity is created.
- All-marketing stops cancel pending work across campaigns and confirmed aliases. Unfinished callback work becomes held for review. Private notification acknowledgment is recipient-scoped.
- Inbox/Campaigns/More in a light theme; campaign creation, sequence editor, recipient review, simulation launch/pause, filtered inbox, composer, callback form and operational notices are connected to PostgreSQL.
- Production worker remains disabled. Simulation accepts only reserved `.test` addresses, makes no provider/model calls and processes at most one acceptance per tick with shared pilot limits of 2/hour and 10/day.

## Verification

Final check results and artifact paths are recorded in [local verification](local-verification.md). Local PostgreSQL, component/API and browser evidence must not be reported as production or provider evidence.

Run locally:

```sh
npm run test:email:workflow
npm run test:email:local-ui
npm run dev:email:local
```

The harness creates its own temporary PostgreSQL cluster, applies only five named Email migrations with minimal fabricated CRM prerequisites, and cleans it up on exit. It does not load CRM environment files. Requires PostgreSQL 16 binaries (`EMAIL_TEST_PG_BIN` can override the Homebrew path). Browser tests use installed Google Chrome in a separate automation profile.

## Packet audit

A partial row is intentionally not a completion claim.

| Packet | Verified scope and remaining gap |
| --- | --- |
| EM-001 | Partial: source baseline exists; deployed schema and release verification remain pending. |
| EM-002 | Local contracts and harnesses implemented; schemas do not prove action implementations. |
| EM-003 | Partial: pilot commands recheck membership and commit atomically. Older settings service still needs transaction and readiness repair. |
| EM-004 | Partial: identity schema and resolver tested locally. Real import/link commands remain unfinished. |
| EM-005 | Partial: transaction-backed simulation publication, exact review and frozen versions tested. Live readiness/publication remain unfinished. |
| EM-006 | Partial: simulation ledger is connected. Production lease fencing, event queue and remote reconciliation remain unfinished. |
| EM-007 | Utility only: encryption helpers; secure provider onboarding and rotation are unfinished. |
| EM-008 | Utility only: domain helpers; real sender/domain setup is unfinished. |
| EM-009 | Partial: local all-marketing suppression, alias cancellation and opt-out fixtures work. Public preferences and full scope/release integration are unfinished. |
| EM-010 | Partial: local dispatch guards and shared pilot count caps work. Monetary reservations and provider readiness remain unfinished. |
| EM-011 | Not implemented: simulated acceptance is not Resend dispatch or reconciliation. |
| EM-012 | Partial: synthetic inbound transactions and deduplication work. Authenticated provider webhook/retrieval/correlation are unfinished. |
| EM-013 | Partial: pilot human ownership, transfer on handoff and stale-draft checks work. Shared CRM/mobile integration and AI approval remain unfinished. |
| EM-014 | Not implemented: local handoff records exist, but canonical CRM Lead/task/history writes are not connected. |
| EM-015 | Utility only: no model inference or bounded automatic reply integration. |
| EM-016 | Utility only: no complete repeatable model evaluation/publication runner. |
| EM-017 | Pending: simulation is not the required configured-provider journey. |
| EM-018 | Utility only: fabricated recipient fixtures; real imports/segments/verification jobs are unfinished. |
| EM-019 | Partial: weekday scheduling, pilot pacing and pause work locally. Durable scheduler/resume and production pacing are unfinished. |
| EM-020 | Partial: shared light-theme Email component and CRM page exist. Complete setup wizard and signed-in CRM-shell verification are unfinished. |
| EM-021 | Not implemented: no live audience mapping/import pages; campaign recipient review is fixture-backed. |
| EM-022 | Partial: campaign list, sequence edit, recipient review and simulated start/pause are connected. Full live detail/revision workflows remain unfinished. |
| EM-023 | Partial: filtered local inbox, human composer and review controls are connected. Shared Conversations, AI review and full access/pagination states remain unfinished. |
| EM-024 | Partial: evidenced local callback handoff exists. CRM handoff page and Google Calendar integration are unfinished. |
| EM-025 | Not implemented: no playbook editor or evaluation review UI. |
| EM-026 | Not implemented: connections/settings/brand wizard remains unfinished. |
| EM-027 | Utility only: no truthful production outcome reporting or exports. |
| EM-028 | Utility only: legacy guard helper is not wired into existing sending paths. |
| EM-029 | Utility only: no complete replay, retention or recovery UI. |
| EM-030 | Pending: no release candidate, deployment or live-provider acceptance. |
| EM-031 | Utility only: local literal templates; controlled per-recipient generation/review is unfinished. |
| EM-032 | Partial: recipient-scoped local notifications and acknowledgment work. Push, escalation and automatic phone detection remain unfinished. |
| EM-033 | Partial: weekday 7–10-calendar-day schedule and explicit callback evidence work locally. Calendar booking is unfinished. |
| EM-034 | Not implemented: no response-number provisioning or routing integration. |
| EM-035 | Partial: focused light UI, counts and campaign cadence exist. Saved views, comprehensive filters and full integration remain unfinished. |

## Next implementation order

1. Repair older configuration/settings transactions and readiness authority before connecting them to the wizard. Complete canonical Lead/task/history and shared Conversations ownership integration against an isolated fixture of the actual CRM contracts.
2. Implement provider connection, durable remote dispatch/reconciliation, signed webhook capture and full suppression/preferences. Keep live dispatch disabled until controlled provider evidence exists.
3. Complete the setup wizard, AI policy/evaluations, Calendar/push/response-line integrations and remaining views. Preserve everyday-language sales voice, verified facts, Lead → human-qualified Opportunity distinctions and weekday cadence.
4. Run full local integration and release checks, then prepare the exact controlled external test/release for authorization. No production schema, subscriptions, provider connection, customer send or deployment was performed in this milestone.
