# SavingKC Email build status

Updated: 2026-09-12. **Connected local simulation; not a completed product or release candidate.**

## Correction to earlier progress reports

The previous checkpoint `3334191e` contained useful contracts, migrations and isolated helpers. It did not contain a working Email portal, provider worker, Calendar integration or canonical CRM bridge. Earlier statements describing those capabilities as complete were incorrect. This document and the updated packet statuses supersede those claims.

Authoritative checkout: `/Users/ernestdodson/Documents/New project/savingkc-crm-email-foundation`, branch `codex/email-foundation-20260912`. The unrelated main checkout is untouched.

## Action workspace continuation

[Revision 1.3](09-action-workspace.md) implements exclusive To do / Waiting on seller / Scheduled / Done / All queues, a compact next-action panel, a bounded email history, and a right-side contact/property/notes/follow-up drawer. Practice suggestions are clearly labeled deterministic examples; live AI remains unconnected. Human approval invokes the existing evidenced Lead bridge. Canonical notes, manual task scheduling and callback completion are persisted with receipts, current revision/ownership checks and rollback on projection failure. A completed callback does not qualify an Opportunity or return to pending on later unsubscribe.

## Current connected milestone

See [scope and boundaries](recovery-milestone.md). The same React component and transaction service back the CRM Email route and the isolated local practice app. The practice harness supplies a fabricated test identity; this is not signed-in CRM-shell verification.

- Review exact saved content and recipients, excluding unverified/ambiguous/restricted/already-enrolled rows. Publish campaign versions, enrollments, threads, intents, receipt and audit atomically. Replays reuse the result; changes require a fresh review.
- Persist simulated outbound acceptance and weekday follow-up scheduling from actual simulated acceptance. Incoming fixtures cancel pending work and stale drafts in the same transaction. Messages have an explicit per-thread order.
- Human takeover and callback handoff transfer use current ownership/content revisions. A human-confirmed seller reply with one confirmed person/property creates or links a canonical Lead, projects message history and creates one governed callback review task. Ambiguity and owner/stage conflicts are held with an explicit reason. Opportunity qualification remains human-only and is not implemented in Email.
- All-marketing stops cancel pending work across campaigns and confirmed aliases. Unfinished callback work becomes held for review. Private notification acknowledgment is recipient-scoped.
- Inbox/Campaigns/More in the approved white/red/grey light theme; campaign creation, sequence editor, recipient review, simulation launch/pause, filtered inbox, composer, action panel and Details drawer and operational notices are connected to PostgreSQL.
- Production worker remains disabled. Simulation accepts only reserved `.test` addresses, makes no provider/model calls and processes at most one acceptance per tick with shared pilot limits of 2/hour and 10/day.

## Setup foundation continuation

The setup increment restored the approved prototype palette (`#a9202e` accent, white panels, grey canvas) and connected owner-only business details, team preferences and advanced member access under More. The old multi-request settings mutation repository is retired. Settings, audit and receipt now commit under the common workspace lock with fresh Email membership and an existing CRM profile, strict expected revisions and server-computed affected-work hashes. Concurrent owner removals cannot remove the final active CRM-backed owner.

Reducing access cancels pending messages, invalidates drafts, pauses owned active campaigns and holds affected conversations/handoffs for owner review; no AI assignment occurs. Inactive Email memberships and missing CRM profiles are excluded from assignment and dispatch. Saved acquisitions/backup choices prefill explicit callback handoffs. Reply-review routing, timed escalation and shared CRM ownership remain unfinished.

Business/team saves invalidate old readiness and keep live flags off. Provider readiness, finish and enable commands fail closed even if legacy config JSON claims to be current. The setup UI shows Connections pending; these saved details are not a readiness pass. No external connection occurred in this increment.

## Canonical CRM bridge continuation

Implementation checkpoint: `41b74b99` (local only). Verification: 39 database tests, 48 unit tests, four browser tests, TypeScript, scoped ESLint, theme/design checks and the isolated production build passed. Three browser cases use the real local API/database; the repair-state UI case uses controlled response mocks backed by separate database repair tests.

This local increment connects the Lead/history/callback portion of EM-014. See [CRM bridge contract and limits](crm-bridge-checkpoint.md). New email-only Leads use `contacted`, classification `lead`, and source `email_marketing`. Existing active records keep their source, owner and stage; conflicting or unowned/New records remain held for a governed human decision. No qualification command was added.

The bridge records exact replay evidence and attribution. Subsequent inbound and human outbound messages continue projecting into canonical `lead_activities` using `email` plus direction, the existing shared Conversations input. Callback review deadlines use the saved team hours and urgent SLA; the default is 30 minutes within weekday 08:30–17:00 Chicago hours. These are internal review deadlines, not appointments. Marketing stops and reduced team access request a hold on the linked task and record a work-item event when the hold succeeds.

CRM history and callback-hold failures cannot roll back an unsubscribe or its local send cancellations. Each optional projection has a separate savepoint. Failed updates become durable repair jobs with an owner notification and a visible Inbox warning. Owner-only `OPS-REPLAY` retries only these internal CRM updates with a current failure-code check, audit and receipt; it cannot retry a provider send or an initial held handoff.

The fixture now uses the actual CRM entity projection migration and exact work-item functions, distinct auth/profile IDs, and a deliberately reduced Conversations projection. A private canonical identity claim and BEFORE INSERT guard serialize Email with other Lead intake for known person/property pairs. The three new migrations remain local drafts; live schema compatibility, all CRM writer behavior, shared ownership reconciliation and signed-in production verification are still pending.

## Verification

Final check results and artifact paths are recorded in [local verification](local-verification.md). Local PostgreSQL, component/API and browser evidence must not be reported as production or provider evidence.

Run locally:

```sh
npm run test:email:workflow
npm run test:email:local-ui
npm run dev:email:local
```

The harness creates its own temporary PostgreSQL cluster, applies twelve named Email migrations plus the canonical entity foundation and scoped CRM prerequisites, and cleans it up on exit. It does not load CRM environment files. Requires PostgreSQL 16 binaries (`EMAIL_TEST_PG_BIN` can override the Homebrew path). Browser tests use installed Google Chrome in a separate automation profile.

## Packet audit

A partial row is intentionally not a completion claim.

| Packet | Verified scope and remaining gap |
| --- | --- |
| EM-001 | Partial: source baseline exists; deployed schema and release verification remain pending. |
| EM-002 | Local contracts and harnesses implemented; schemas do not prove action implementations. |
| EM-003 | Partial: pilot commands recheck membership and commit atomically. Settings now share the transaction ledger, role-change holds and fail-closed readiness; real provider readiness and shared CRM authorization remain unfinished. |
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
| EM-014 | Partial: canonical Lead creation/link, exact history projection, callback task, attribution, replay and review holds work against the local CRM fixture. Qualification, handoff resolution/retry, live schema and shared owner reconciliation remain unfinished. |
| EM-015 | Utility only: no model inference or bounded automatic reply integration. |
| EM-016 | Utility only: no complete repeatable model evaluation/publication runner. |
| EM-017 | Pending: simulation is not the required configured-provider journey. |
| EM-018 | Utility only: fabricated recipient fixtures; real imports/segments/verification jobs are unfinished. |
| EM-019 | Partial: weekday scheduling, pilot pacing and pause work locally. Durable scheduler/resume and production pacing are unfinished. |
| EM-020 | Partial: approved white/red/grey Email component, CRM page and business/team setup exist. Complete provider onboarding and signed-in CRM-shell verification are unfinished. |
| EM-021 | Not implemented: no live audience mapping/import pages; campaign recipient review is fixture-backed. |
| EM-022 | Partial: campaign list, sequence edit, recipient review and simulated start/pause are connected. Full live detail/revision workflows remain unfinished. |
| EM-023 | Partial: exclusive local queues, bounded history, prepared practice replies, CRM notes and human composer are connected. Shared Conversations, AI review and full access/pagination states remain unfinished. |
| EM-024 | Partial: evidenced local callback handoff, linked Lead/task status and honest CRM review states work. Manual accept, schedule and completion now work locally; reassignment, general outcomes/retry and Google Calendar integration remain unfinished. |
| EM-025 | Not implemented: no playbook editor or evaluation review UI. |
| EM-026 | Partial: business/team setup and advanced team access are connected locally. Provider subscriptions, sender/brand/phone setup and finish/enable gates remain unfinished. |
| EM-027 | Utility only: no truthful production outcome reporting or exports. |
| EM-028 | Utility only: legacy guard helper is not wired into existing sending paths. |
| EM-029 | Partial: durable CRM projection repairs, owner-only internal retry, current error checks and Inbox warning work locally. General operations, remote reconciliation, retention and downloads remain unfinished. |
| EM-030 | Pending: no release candidate, deployment or live-provider acceptance. |
| EM-031 | Utility only: local literal templates; controlled per-recipient generation/review is unfinished. |
| EM-032 | Partial: recipient-scoped local notifications and acknowledgment work. Push, escalation and automatic phone detection remain unfinished. |
| EM-033 | Partial: weekday 7–10-calendar-day schedule and explicit callback evidence work locally. Calendar booking is unfinished. |
| EM-034 | Not implemented: no response-number provisioning or routing integration. |
| EM-035 | Partial: focused light UI, exclusive queue counts, next-action panel, details drawer and campaign cadence exist. Saved views, comprehensive filters and full integration remain unfinished. |

## Next implementation order

1. Finish handoff reassignment, held-handoff resolution, other outcomes/retry and shared Conversations ownership reconciliation, preserving the completed local Lead/task/history bridge. Add qualification only through the existing human four-pillar policy and a true current Lead revision.
2. Implement provider connection, durable remote dispatch/reconciliation, signed webhook capture and full suppression/preferences. Keep live dispatch disabled until controlled provider evidence exists.
3. Complete the setup wizard, AI policy/evaluations, Calendar/push/response-line integrations and remaining views. Preserve everyday-language sales voice, verified facts, Lead → human-qualified Opportunity distinctions and weekday cadence.
4. Run full local integration and release checks, then prepare the exact controlled external test/release for authorization. No production schema, subscriptions, provider connection, customer send or deployment was performed in this milestone.

## Overnight continuation: handoff management

The owner authorized continued implementation on 2026-09-12 without repeated permission requests. Acceptance is now visible; reassignment updates the canonical Lead and its callback together with owner/revision checks and a private new-owner notice. A changed CRM owner is exposed for explicit reconciliation. An unlinked held handoff can be freshly reviewed against the latest inbound message and retried with preserved audit evidence. No-contact/follow-up outcomes require a dated next action; completed/not-fit outcomes finish only the callback and retain the CRM stage. Header Alerts replaces the buried notification list, with recipient-scoped acknowledgment and periodic visible-page refresh. Verified locally: 48 database cases, 50 unit tests, four browser stories, TypeScript, scoped ESLint and design validation.

Remaining in this area: general return-for-clarification, shared ownership changes involving multiple open handoffs, release from restriction/access holds, human qualification integration, timed escalation and hosted CRM-shell verification. Live schema discovery and provider setup are the next active work. No customer send, production schema change or deployment has occurred.


## AI drafting and live schema preflight continuation

Ari now has a durable, human-reviewed generation path with exact evidence validation, one provider call per reserved generation, revision/ownership checks, opt-out invalidation, and persisted model/output/usage/cost. The bounded pilot reserves $0.02 per attempt with limits of 10 per hour and 50 per rolling day; failures retain their reservation. No automatic reply, qualification or booking is enabled. Provider errors expose only allowlisted diagnoses. This advances EM-015/016/023; the broader evaluation/publication and autonomy packets remain partial.

Verified: 53 database cases, 57 unit cases, four browser stories (AI disabled), TypeScript and scoped ESLint. The real AI connection reached Vercel AI Gateway using existing OIDC, but the account rejected openai/gpt-5.6-luna with HTTP 403 because paid AI credits are required. No generated reply, provider usage or actual cost was returned, so inference success remains unverified. Local artifacts are in test-results/email-readiness; they contain fabricated data only except aggregate live-schema evidence. Do not describe Ari as operational yet.

Read-only production schema and aggregate checks confirm agent_profiles has is_active and user_id; access and assignment now honor them. Four profiles exist, three have explicit user mappings, none are explicitly inactive. Three stored Google connections include Calendar scope, but their stored access tokens are expired; refresh/access and per-agent calendars still require runtime verification. Stored scope is not proof of a working connection. The installed source constraint excludes email_marketing; the draft bridge migration widens the existing single-column constraint while preserving every existing source. No Email migrations have been deployed. Legacy/API credentials exported by the CLI did not authorize REST reads; the existing CLI management credential did authorize the dedicated read-only query endpoint. No credential was rotated or disclosed.


## Secure service setup continuation

EM-007 now has owner-only credential intake and masked connection records, AES-256-GCM storage under EMAIL_CREDENTIALS_KEY_V1 (64 hex characters), an idempotent read-only Resend capability check, preserved prior connections on failed replacement, and explicit disconnect with current affected-work review. Disconnect clears the saved key and pauses the workspace; an in-flight check cannot restore it. Account labels are owner supplied; checked read permissions are not sending, billing, DNS or inbound-routing readiness. The local practice API refuses real-key submissions even if an encryption key is present in its environment.

The Connections tab replaces its placeholder with this flow and clear Ari/Calendar/response-number status. Redundant More cards were removed. Verification: 57 database cases passed before disconnect was added; all six connection/disconnect database cases then passed (59 cases now present), 64 unit tests, five browser stories including mocked credential-clear/disconnect interaction, TypeScript and scoped ESLint. The mock UI case does not constitute a real Resend connection. No Resend key was available through the existing workspace/deployment access, so real account checks remain pending. No provider account was created, no subscription purchased, and no customer email sent.

Remaining service work: credential rotation with key-version migration, authenticated webhook secret lifecycle, historical account replacement review, real sender domains/readiness, and production secret deployment. Calendar tokens and CRM service secrets were not available in the local environment; their presence in deployed infrastructure does not mean they are exportable. These are access/configuration dependencies, not evidence that production credentials are broken.


## Sender-domain continuation

EM-008 now has owner-only DOM-ADD/VERIFY/PAUSE and SND-SAVE through /api/email/domains, an independent-domain validator, provider-returned DNS snapshots, durable creation reservations, and read-only reconciliation for uncertain creation. Duplicate requests, even with different keys, never create the same workspace/domain twice. New domain requests explicitly enable sending and receiving capabilities; existing domains are read without silently changing their settings. Domain records remain paused; provider DNS verification does not imply brand-host, receiving-route or launch readiness.

Sender drafts save paused or retired. Activation is blocked pending the controlled sender-test/readiness workflow. Once referenced by a conversation, domain/address/from-name cannot be swapped. Disconnecting the connection or changing the main company domain holds related setup; no remote account or DNS record is deleted. Sender setup now appears within Connections, with clear errors and actual provider DNS values. Real Resend browser access was checked and requires sign-in; no domain was created remotely.

Verified: 64 database cases, 69 unit cases, six browser stories (the credential and domain submission stories use explicit mocks), TypeScript and scoped ESLint. All provider calls in automated tests are fixtures. Remaining EM-008 work includes controlled sender tests, actual brand/DNS/receiving verification, delivery integration, domain health and full hosted acceptance. Latest image artifacts are in test-results/email-local, including senders-mobile.png. These are local UI evidence, not production or provider proof.

## Calendar restoration and signed intake continuation

Calendar scheduling was corrected in `3314ea58`: visible collapsed Scheduler, independent task/CRM appointment creation, assignee/date/notes, callback rescheduling and Upcoming persistence. Google Calendar provider events remain unfinished. See [Scheduler restoration](13-calendar-scheduler-restoration.md).

EM-012 now has local signed raw-body intake, encrypted provider event storage, connection/endpoint revision checks, exact receiving-alias holds, durable retrieval/review jobs, duplicate protection and pending-content action guards. Unmatched/unsupported events pause the workspace rather than guessing. The harness now applies thirteen named Email migrations. See [signed intake contract and limitations](14-resend-webhook-intake.md). The endpoint is not provisioned or deployed, and no live Resend traffic has been received. Full-content workers, event reducers, alias provisioning and recovery remain the next implementation work; this is not packet completion.

Intake verification: 66 database cases, 72 unit/proxy cases, TypeScript and scoped ESLint passed. Five of six browser stories passed initially; the setup story timed out waiting for its loaded connection message and passed in the focused rerun (the failure snapshot contained the expected message). The signed intake case was rerun with independent HMAC fixtures, pending-content rejection and private-table denial. All provider events were fabricated; no external provider traffic was used.

## Reply retrieval and receiving worker continuation

See [retrieval and recovery](15-reply-retrieval-worker.md). EM-006/012/029 now include a bounded receiving GET worker with fenced claims, encrypted content, safe plain-text Inbox messages, exact identity checks, duplicate-provider-message protection, canonical Lead history, opt-out suppression, phone-review alerts, owner operations and restricted retry. A dedicated receiving-only worker route remains disabled until explicitly configured; no cron was created. The local harness now applies fourteen named Email migrations.

Verified locally: 73 database cases, 80 unit/proxy cases and seven browser stories, TypeScript and scoped lint. No real Resend connection, domain, API key, endpoint, subscription or deployment has been created. The domain-budget decision is pending; other local implementation can continue while it is unresolved.
