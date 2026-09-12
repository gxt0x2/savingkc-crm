# SavingKC Email build status

Updated: 2026-09-12
Overall: **Approved design; EM-001/EM-002 baseline plus EM-003 local configuration/auth implementation are ready for review. Migration/RLS verification and all live feature work remain pending.**

## Implementation baseline · 2026-09-12

- Reviewable checkpoint: `8190412c` (`Add email workspace configuration foundation`) on `codex/email-foundation-20260912`. It includes EM-001/EM-002 local foundation work and EM-003 local implementation. The working tree was clean after the commit; no remote push, migration or deployment occurred.
- Authoritative implementation checkout: `/Users/ernestdodson/Documents/New project/savingkc-crm-email-foundation`, branch `codex/email-foundation-20260912`, starting SHA `d03bb95e16e92da67530d62bc911589951833ba0` fetched from main. Original unrelated edits remain untouched.
- [Baseline and exact model handoff](implementation-baseline.md) records canonical CRM identities, lifecycle/qualification rules, shared Conversations controls and all existing email send paths. These current-source findings supersede older checkout assumptions in the design.
- Locked dependencies installed; Next 16.3.4 guides read. Six selected existing CRM test files passed: **41 tests**, exit 0. This is baseline regression evidence, not evidence the email product works.
- EM-001 is partially complete: local source/runtime evidence recorded; authenticated target schema, deployed function versions and hosting/provider capabilities remain unverified. The available public credential returned HTTP 401 on a metadata-only request. No live rows were queried or schema changed.
- EM-002 is locally complete: src/lib/email/contracts.ts exposes strict Zod 3 discriminated command schemas for all 83 server-side Email actions, strict command result envelopes and no client workspace authority. Its seven focused tests passed. The two excluded action IDs are read-only report query and public external contact navigation.
- The test:email:db command now requires an explicitly marked disposable email_test_* schema and makes a read-only reachability check; test:email:ui requires an explicit authenticated non-production target and runs a dedicated Playwright contract. Both fail closed when configuration is absent. No database, browser, provider or live-email evidence is claimed.
- EM-003 local implementation is complete: an unapplied additive configuration migration creates private workspace, membership, setup-state, audit, receipt and user-removal-hold records; server-only configuration commands require the verified immutable subject and active membership. Emergency pause disables dispatch immediately; enable requires the exact current readiness run/hash; deactivation creates a human hold and never assigns work to AI. Focused unit tests passed (**13 tests**) together with command-schema coverage. The migration also passed in a disposable PostgreSQL 16 fixture with the verified minimal `agent_profiles` prerequisite: one disabled workspace/owner seeded, RLS enabled and zero browser-role table privileges. No SavingKC SQL was applied.
- The isolated worktree is linked to the verified Vercel `savingkc-crm` project. Vercel environment pulls still contained blank server-side keys, but an existing matching local server credential was used only for deployed API metadata. It confirmed `agent_profiles` (including `user_id`, active/admin/role fields), canonical CRM tables and current function signatures. No data rows were read or changed. Database transaction/RLS verification remains pending.
- Next: review the EM-003 diff and execute its additive migration only against an approved disposable target, then run the fail-closed database harness and direct authorization/RLS cases before beginning EM-004.

## Deliverables

| Artifact | State | Evidence / scope |
| --- | --- | --- |
| 00–01 blueprint and decisions | Written; reconciled to detailed design | Outside domains, initial Resend connection, wizard, AI boundaries, Lead/Opportunity meanings |
| 02 data and states | Written | Local CRM mapping, additive tables, identity, permissions, locking, suppression and migrations |
| 03 integrations and jobs | Written | Secure onboarding, provider contracts, durable queue, retry/reconciliation, costs and readiness |
| 04 pages and interactions | Written | 19 surfaces, 88 action contracts including shared controls, failure/conflict/responsive behavior |
| 05 AI policy and fixtures | Written | Exact output/policy, promotion requirements, 40 fabricated seed scenarios |
| 06 tests and release | Written | 62 acceptance cases, component vs full-journey evidence, controlled foundation, rollout and rollback |
| EM-001 through EM-035 | EM-001 and EM-002 local work complete; EM-003 local work complete but unapplied/unverified. EM-004–EM-035 not started | Bounded dependency-ordered packets, allowed paths, required behavior and verification |
| Interactive walkthrough | Written; sample-only | Setup, audience, campaign review, inbox scenarios, takeover, handoff, qualification, playbooks, sending, reports and recovery |
| Design validation | Passed | Python validator: references, dependency graph, 19 pages, 88 actions, 35 packets, 62 acceptance IDs and 40 seed cases |

Earlier broad walkthrough: `/Users/ernestdodson/.codex/visualizations/2026/09/10/01a08db9-767b-7670-81b0-627312bf30d8/email-marketing-walkthrough.html`. The current focused walkthrough is listed below. No browser rendering or signed-in application verification is claimed by design validation. No application code is supplied by either walkthrough.

## v1.2 focused workspace revision

- Added08 and EM-035: Inbox/Campaigns/More navigation; precise work, outcome and controller filters; personal saved views; campaign list and shared capacity; recipient selection inside campaigns; full drip and date preview. Base UI packets now consume08 before implementation. Added T57–T62 and two saved-view actions; EM-030 depends on EM-035.
- Current focused walkthrough: `/Users/ernestdodson/.codex/visualizations/2026/09/10/01a08db9-767b-7670-81b0-627312bf30d8/email-workspace-focused.html`. It demonstrates fabricated conversations/campaigns, local filtering and takeover, recipient exclusion, separate campaign pause, draft revision and calendar-date preview. More exposes sample repair/configuration details. The earlier broad setup walkthrough remains available as prior design context.
- Official Front, Instantly and HubSpot documentation informed interaction patterns; sources and SavingKC differences are recorded in08. No subscriptions are recommended or connected by this revision.
- No authenticated browser, application, database, scheduler or provider test is claimed for the new walkthrough. Design validation only checks the written specification.
- New fragment read back as literal markup; JavaScript syntax passes `node --check` and the fragment is48,886 bytes. These are static checks, not interaction or rendering evidence.

## v1.1 sales and operations revision

- Added07 with everyday Black Swan voice, contextual initial copy, targeted push/acknowledgment, precise-request automatic scheduling,7–10-calendar-day weekday follow-up and a stable response-line recommendation. Added EM-031–EM-034 before final EM-030 release verification.
- The actual voice examples, audience/offer, alert-channel choice, calendar permissions and phone number remain setup/review inputs. No live capability is claimed. The walkthrough demonstrates selected flows; new alert/calendar/phone automation is specified, not implemented in the sample.
- Recorded the results-first operating principle and checked Google's template/similarity guidance. The first pilot uses simple approved segment copy with verified fields; contextual AI copy is an optional measured comparison. No application scope or implementation status changed.

## Earlier design-stage evidence

- Inspected local baseline: branch `codex/restore-ernest-forwarding`, SHA `cbd2da47e25433d37a95c9ae9f81089953d4276d`. This is a local checkout finding, not live production schema or behavior verification.
- Confirmed local canonical labels `contacted` = Leads and `qualified` = Opportunities in `src/types/pipeline.ts`; identified integration traps in general auto-advance, appointment, Conversations sending, Gmail projection and prospect-to-lead helpers.
- The older design checkout lacked installed Next documentation. The new implementation checkout now has the locked dependencies and guides; see the current baseline above.
- Verified official documentation for Resend idempotency, full received-email retrieval, signatures, threading and domains; Vercel cron cadence; structured AI output; and the proposed verification adapter. Source URLs are in03.
- Specification review corrected missing token/calendar/incident records, clarified enums, assigned migration ownership and separated component evidence from full acceptance to avoid circular verification requirements.
- Walkthrough fragment has valid JavaScript syntax (`node --check`), contains no network calls and is below the inline size limit. These static checks do not establish browser rendering or application behavior.
- This workstream changed only `docs/email-marketing/` and the thread-owned walkthrough. Pre-existing app and other untracked changes were preserved.

## Not performed

No email UI/route or provider implementation, database migration, provider/model probe, domain registration, subscription activation, customer email, campaign launch, external team message or production deployment. Deployed API metadata was inspected with an existing matching server credential, but no data rows or mutations were performed. The 41 existing CRM tests and 13 local Email tests are not live feature evidence. Automatic AI mode is not evaluated or enabled. Proposed volume/budget examples are not approved live settings.

## Next step

EM-003 is locally reviewable but blocked before migration application: the linked Vercel environment still pulls empty server-side keys. Use the approved disposable database path to apply and verify `20260912130000_email_configuration.sql`, then execute direct permission/RLS and transaction cases. Do not count local unit checks or metadata-only access as database/browser verification. Controlled provider access becomes relevant to the early integrated path; final production account/domain/audience/team/budget choices remain in the wizard.

Application progress must be recorded per06 §7 with actual revision, checks and evidence. Designed must never be changed to built or live merely because the documents are complete.
