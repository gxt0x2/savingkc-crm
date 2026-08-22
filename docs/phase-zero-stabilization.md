# Phase 0 — Scope Freeze and Stabilization

Date: 2026-08-22  
Baseline: `175ea52f7082137fec544e557f02c0eb82c2f050` (`origin/main`)  
Branch: `codex/phase-zero-stabilization`

## Outcome

Phase 0 establishes a truthful, supportable baseline before any more CRM features are added. It does not redesign the CRM, replace Manifest, or add another workflow surface.

The phase is complete only when the critical operating journeys have production evidence, conflicting definitions have one declared authority, and every discovered defect has an owner and severity.

## Scope Lock

### In scope

- Verify the current production release against the two primary outreach journeys and the seller lifecycle.
- Reconcile the authoritative definitions for contact identity, opportunity stage, owner, consent, conversation attention, primary next action, and operating KPIs.
- Inventory Manifest readers and writers and prevent it from gaining new operational authority.
- Identify duplicate or misleading surfaces and decide whether each is retained, redirected, hidden, or retired.
- Repair only verified P0 or P1 defects required to make the current product safe and truthful.
- Capture desktop and mobile-critical evidence, exact release SHA, automated gates, and rollback notes.

### Out of scope

- Predictive or parallel dialing.
- Automated AI sends, calls, stage changes, or record mutations without confirmation.
- A Manifest rewrite or destructive data migration.
- New dashboards, reports, workflow types, AI personalities, or navigation destinations.
- Cosmetic redesign that does not repair a verified usability failure.
- P2 cleanup unless it is documentation needed to describe the production truth.

### Change rule

No net-new feature work enters Phase 0. A code change requires a reproduced P0/P1 defect, a narrow acceptance test, and proportionate production verification.

## Canonical Authority

| Concern | Operational authority | Compatibility / projection | Phase 0 rule |
|---|---|---|---|
| Contact identity and endpoints | Canonical CRM entity records, with `leads` as the current write-compatible aggregate | Contact directory/workspace projections | Never infer identity from Manifest when a canonical record exists. |
| Consent and phone suppression | Durable consent/suppression records and final server call/send policy | Queue eligibility and UI status | Manifest cannot override DNC, STOP, bad-number, quiet-hours, or provider policy. |
| Opportunity stage | Canonical opportunity stage; current writes remain compatible through `leads.station` | Contact/opportunity projections and translated UI labels | `qualified` may be stored for compatibility but is presented as **Opportunity**. |
| Opportunity owner | Canonical opportunity owner | Contact/opportunity projections | Inbox assignment never silently changes opportunity ownership. |
| Conversation attention | `conversation_thread_state` projection rebuilt from durable activity/consent evidence | Conversations queues and attention counters | UI does not invent unread or attention state. |
| Primary next action | Canonical work-item contract over durable task sources | `work_items` projection | Every non-terminal opportunity should have one primary pending action. |
| Communication history | Durable provider callbacks and `lead_activities` | Conversation timeline/read model | Projections are rebuildable; internal alerts never impersonate seller messages. |
| AI recommendations | Verified CRM evidence plus durable generation/proposal records | Assistant UI, briefs, summaries | Suggestions cite evidence; consequential changes require explicit confirmation. |
| Manifest | Derived seller intelligence, enrichment, historical compatibility, and AI brief context | Manifest renderers and legacy consumers | Freeze schema expansion. Canonical facts win. No compliance or operational decision may depend on Manifest alone. |

## Critical Journey Acceptance Matrix

The production audit is read-only. Provider sends, phone calls, record mutations, and synthetic customer data are prohibited.

| Journey | Required evidence | Pass condition | Status |
|---|---|---|---|
| Campaign setup | Audience, owner, sender, window, rate, suppression, readiness | One bounded campaign command center; launch blockers are explicit; no fake controls | Pass: signed-in draft safely blocked with zero audience |
| Campaign delivery | Durable campaign/member status and attempt history | UI distinguishes queued, sent, delivered, failed, replied, stopped, and canceled | Contract pass; no production delivery exists to inspect |
| Reply handoff | Reply appears in canonical Conversations queue | Reply suppression cancels future campaign work; thread is actionable once | Contract pass; first real campaign requires supervised pilot evidence |
| Conversation follow-up | Assignment, reply state, and primary task | Actor is server-resolved; task persists through one canonical work-item path | Functional; P1 triage/backlog findings remain |
| Dialer queue | Server-ranked eligible contacts and exclusions | Queue is bounded; DNC/dead/bad-number/quiet-hours are fail-closed | Pass: 52 eligible; policy/session suites green |
| Call session | Start, pause, resume, stop, one active line | UI and engine both represent a truthful single-line power dialer | Contract pass; no saved production session history exists |
| Disposition/follow-up | Attempt, outcome, next action, audit actor | Disposition is required before advance; follow-up persists once | Contract pass; first real session requires supervised evidence |
| AI call review | Recording/transcript evidence, draft summary/action | AI is post-call and human-confirmed; provenance and delivery state are visible | Pass with P2 media-duration rendering defect |
| Seller intake | Identity, property, source, consent, owner | One canonical contact/opportunity; no hidden duplicate authority | Pass for current intake workspace |
| Opportunity progression | Stage gates, next action, offer/contract handoff | Canonical stage vocabulary and exactly one primary action remain coherent | Functional; P1 old-work reconciliation remains |
| Closing handoff | Accepted offer, transaction coordination, close state | Operational handoff is explicit and does not depend on Manifest | Functional; P1 closeout reporting mismatch remains |

## Product Surface Decisions

| Capability | Canonical surface | Decision |
|---|---|---|
| Intake and pipeline work | `/contacts` with saved lists | Retain; legacy `/pipeline`, `/leads`, `/opportunities`, and `/in-closing` remain redirects. |
| Launch Control-style prospecting | `/prospecting` | Retain and verify; do not duplicate inside Dialer. |
| Mojo-style power dialing | `/dialer` and server-owned Sessions | Retain and verify; predictive/parallel claims remain excluded. |
| Unified inbox | `/conversations` | Retain; Dialer does not get a separate conversation hub. |
| Work | `/tasks`, My Day, and work-item projections | Retain while consolidating legacy task writers behind one contract. |
| AI operating assistant | `/ai` | Retain; legacy `/ari` redirects here. |
| Reporting | `/reports/*` | Retain; reporting must label time window and source instead of mimicking live queues. |
| Manifest UI/API | Existing compatibility paths only | Contain; no new product surface or schema authority. |

## KPI Definition Gate

Before Phase 1, the following labels must be reconciled across Dashboard, Conversations, Reports, Dialer, and AI:

| Label | Required definition |
|---|---|
| Active lead / active opportunity | Non-terminal opportunity in the canonical active-stage set; any time-windowed variant must say the window. |
| Needs reply | Current canonical conversation attention state, including actionable unmatched callers; never a period-limited activity count unless labeled as such. |
| Ready to call | Current server policy says eligible now and the queue projection is fresh. |
| Overdue | Primary pending work item has a due timestamp earlier than current time in the declared timezone. |
| Unassigned | Canonical opportunity or conversation assignment is null, with the object type named. |
| Contacted / connected | Provider-backed communication outcome using one normalized outcome vocabulary. |

## Severity and Release Rules

- **P0:** unauthorized access, compliance bypass, wrong-recipient communication, destructive corruption, or provider route bypass. Stop release and contain immediately.
- **P1:** a core journey is wrong, unavailable, misleading, unbounded at production scale, or likely to cause duplicate customer contact. Repair in Phase 0.
- **P2:** cleanup, stale documentation, cosmetic inconsistency, or noncritical debt with a safe workaround. Record for a later phase; do not expand Phase 0.

A Phase 0 release must have: focused tests, full typecheck/build, canonical/hygiene gates, signed-in desktop and mobile-critical checks, exact deployment SHA, clean post-deploy error review, and a documented rollback.

## Manifest Containment Gate

The April audit described Manifest as the canonical write path. That language is now historical. The current operating model makes canonical entity records and durable activities authoritative; Manifest is derived compatibility/intelligence context.

Phase 0 will produce a field-level consumer map grouped as:

1. **Retain temporarily:** enrichment, seller situation, historical context, and AI brief inputs unavailable elsewhere.
2. **Migrate:** stage, owner, consent, communication status, task/next action, and other operational facts already represented canonically.
3. **Retire:** unused fields, duplicate derived values, fake authority labels, and legacy UI-only reads.

No Manifest table deletion, broad writer conversion, or historical backfill occurs in this phase.

## Time and Usage Guardrail

- Target: one to two working days, capped at roughly five to six Codex hours.
- Usage brake: stop before the account reaches 30% weekly usage remaining.
- If evidence shows the work cannot finish inside the cap, Phase 0 ends with a precise defect register and release recommendation rather than silently broadening scope.

## Evidence Log

| Evidence | Result |
|---|---|
| Baseline branch is clean and pinned to `175ea52f7082137fec544e557f02c0eb82c2f050` | Pass |
| Only unrelated draft PR #375 remains open and is excluded from Phase 0 | Pass |
| Current Manifest footprint inventory | Pass: 68 direct non-test dependencies grouped by retain, migrate, and retire |
| Desktop production journey audit | Pass: critical surfaces rendered signed-in at 1920×958 |
| Mobile-critical production journey audit | Pass: browser smoke and four sub-second mobile navigation journeys |
| KPI/source reconciliation | Pass for Phase 0: period cohorts are explicitly labeled; live-queue debt moved to Phase 1 |
| P0/P1/P2 defect register | Pass: no P0 reproduced; residual P1/P2 debt is explicit below |
| Final release/no-release decision | Released as `ac290cf47a8ee756fc5b0e9f428bd9f972ad0dfe` |

## Findings Register

| ID | Severity | Finding | Evidence | Phase 0 decision |
|---|---|---|---|---|
| P0-001 | P0 | None reproduced in this audit so far. | Existing token, TwiML, edge, build, security, and mobile gates passed on the production SHA. | Continue read-only verification. |
| P1-001 | P1 | Dashboard “Open issues” counted a selected-period lead cohort but looked like a complete live queue. | At the 30-day setting Dashboard showed 8 Needs reply, 7 overdue next actions, and 20 unassigned. Canonical live surfaces simultaneously showed 128 Needs reply, 175 overdue tasks, and 19 total active leads. | Repaired: headings and every exception label now state that they describe the selected-period cohort. |
| P1-002 | P1 | The Needs Reply queue is materially noisy. | The live first page includes obvious vendor solicitations, auto-service messages, and historical unknown callers as equal-priority seller replies. | Preserve safe inbound capture, but define a bounded triage/irrelevant resolution policy before calling the inbox operationally complete. Do not auto-classify with AI in Phase 0. |
| P1-003 | P1 | Work backlog has no lifecycle reconciliation visible to operators. | Tasks reports 208 total and 175 overdue, many dated April, while the Dialer reports 25 callable follow-ups due and the active CRM has 19 leads. | Audit overdue work against terminal contacts, duplicates, and superseded actions. No bulk close/delete without a reviewed reconciliation. |
| P1-004 | P1 | Closing issue reporting mixed a period cohort with a global-sounding obligation. | Dispositions shows one closed deal with “Close-out required,” while Dashboard showed 0 closeout debriefs due because the deal is outside the selected period. | Repaired for truthfulness by labeling the row “Closeouts due among period deals”; a global obligation queue remains Phase 1 work. |
| P2-001 | P2 | Legacy retirement documentation says `/ari` redirects to Dashboard. | Current code and production redirect `/ari` to `/ai`. | Correct documentation in Phase 0; no runtime change. |
| P2-002 | P2 | Conversation recording control exposes `Infinity:NaN` before media duration resolves. | Reproduced in the selected live conversation with recording controls. | Queue for a small rendering repair after P1 truth work. |
| P2-003 | P2 | Manifest architecture comments contradict the current operating model. | `manifest-sync.ts` and `auto-enrich.ts` still call Manifest the source of truth. | Correct doctrine comments after the containment map is accepted; avoid broad Manifest edits. |

## Production Evidence — Initial Pass

Production deployment `dpl_GFop1qdCERYrEJnzgjaGaJEn6xHT` is READY, targets production, is aliased to `crm.savingkc.com`, and reports Git SHA `175ea52f7082137fec544e557f02c0eb82c2f050` on `main`.

Signed-in read-only checks:

| Surface | Evidence | Result |
|---|---|---|
| `/dashboard` | Period labels render, but Open issues mixes cohort counts with global destinations | P1 mismatch |
| `/contacts?list=new` | Two intentional intake records, canonical identity status, explicit owner and next action | Pass with backlog follow-up |
| `/prospecting` | One draft power-dialer campaign, explicit readiness blocker, single-line human-owned calling floor, server safeguards | Pass |
| `/dialer` | 52 ready, ranked work queues, 25 follow-ups due, no predictive/parallel claim | Pass |
| `/dialer?section=sessions` | No open session, server-saved resume/history contract visible | Pass |
| `/conversations` | Server queues, assignment, typed timeline, composer, details | Functional; P1 triage noise |
| `/tasks` | Bounded worklist and smart lists | Functional; P1 lifecycle/backlog reconciliation |
| `/workflows` | 21 registered numbers, 33 workflow definitions, 0 stated routing decisions needing attention, explicit approval boundary | Pass |
| `/ai` | 19 active leads, 128 Needs reply, 21 phone records, 33 workflow definitions; execution boundary visible | Pass; exposes P1 KPI conflict |
| `/leads/<id>` | Canonical identity linked, typed conversation, stage, next action, human-approved AI draft boundary | Pass |
| `/dispo/pipeline` | Two active deals plus one closed deal; closeout status visible | Functional; P1 exception-count conflict |

The exact-main GitHub run passed 287 test files / 1,361 tests, production build/integrity gates, Twilio token containment, edge integrity, 21/21 Expo checks, mobile typecheck, visual/KPI smoke, and authenticated navigation tests. Recorded iPhone navigation was 475 ms Pipeline, 424 ms Prospecting, 163 ms Task, and 143 ms Dashboard.

## Final Release Evidence

Phase 0 merged through PR #441 as `ac290cf47a8ee756fc5b0e9f428bd9f972ad0dfe` and deployed READY as `dpl_AnMCHLJaCR982K99dSBFQST7iD9x`, aliased to `crm.savingkc.com`.

- Full main suite: 287 files and 1,361 tests passed.
- Production build, route, proxy, theme, terminology, and dialer gates passed.
- Visual smoke: 30 journeys passed; KPI smoke passed.
- Mobile navigation: Pipeline 139 ms, Prospecting 413 ms, Task 134 ms, Dashboard 132 ms.
- Twilio token containment and unsigned edge-request containment passed.
- Signed-in production rendered “Selected-period exceptions” and the corrected period-qualified labels.
- The first post-deploy review returned no error-level or HTTP 500 logs.

Phase 0 made no customer calls, messages, task mutations, bulk lifecycle changes, or Manifest schema changes.
