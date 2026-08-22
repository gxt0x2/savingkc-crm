# Manifest Containment Audit — August 2026

Baseline: `175ea52f7082137fec544e557f02c0eb82c2f050`

## Decision

Manifest remains in service as a compatibility and seller-intelligence snapshot. It is not the CRM operating system and is not the authority for identity, consent, communication state, opportunity stage, ownership, or work.

Phase 0 freezes new Manifest fields and new Manifest-only decisions. It does not delete the table, rewrite its history, or migrate all consumers.

## Current footprint

Current production source contains 68 non-test files with a direct Manifest table or write-helper dependency:

| Area | Files | Risk |
|---|---:|---|
| Browser components | 8 | Direct client reads can be brittle under RLS and preserve duplicate UI authority. |
| API routes and workers | 38 | Operational writers still update Manifest beside canonical records. |
| Server libraries | 22 | Scoring, enrichment, dial policy, pipeline automation, PPC, and AI still consume it. |

A broader text inventory finds 115 non-test source files mentioning Manifest. That broader number includes types, renderers, and indirect integrations; it is not the direct migration count.

Two active comments still state that Manifest is the only source of truth:

- `src/lib/manifest-sync.ts`
- `src/lib/auto-enrich.ts`

Those comments contradict the released operating model and must not guide new work.

## Authority map

| Manifest subtree / legacy concept | Current use | Authority decision | Destination |
|---|---|---|---|
| Seller name, phone, email | Intake, messaging, enrichment | Migrate/verify against canonical contact methods; canonical wins | CRM entity foundation and `leads` compatibility aggregate |
| Property facts | Enrichment, qualification, lead detail | Retain only as derived/enrichment context until canonical property coverage is complete | Canonical property projection |
| Financials and offer context | Qualification, scoring, briefings | Retain as evidence when source provenance exists; offers/contracts win operationally | Opportunity, offer, and transaction records |
| Situation, motivation, personality | Qualification, scripts, AI briefs | Retain as intelligence; never silently mutate canonical facts | Evidence-backed AI context |
| Pipeline/station/priority | Stage automation and legacy screens | Migrate; Manifest must not be the final stage/owner authority | Canonical opportunity stage/owner |
| Parking and terminal state | Lead lifecycle and queue exclusions | Migrate; server policy and canonical lifecycle win | Opportunity lifecycle and call/send policy |
| Hot eligibility/completeness | Ranking and diagnostics | Retain as rebuildable derived scoring | Ranked projections |
| Next action | Briefings and legacy automation | Retire as operational authority | Canonical `work_items` contract |
| Communication pointers/status | Call, SMS, voicemail, appointments | Retire as communication authority | Durable provider events and `lead_activities` |
| AI briefing stale flag | Briefing regeneration | Retain temporarily as cache invalidation | Durable generation/provenance ledger |
| Sources/meta | Provenance and compatibility | Retain where source IDs are valid; reconcile against durable records | Canonical event/generation provenance |

## Consumer groups

### Retain temporarily

- Enrichment and qualification inputs not yet represented in canonical property/opportunity records.
- Seller situation, motivation signals, derived scoring, and briefing context.
- Historical compatibility for Mojo import/reprocess and legacy records.
- A defensive secondary signal in dial eligibility; it can only block, never bypass durable suppression.

### Migrate behind canonical services

- Stage changes in `stage-logic`, pipeline automation, admin station repair, lead routes, and appointment outcomes.
- Task/next-action reads in operating rhythm, Ghost Protocol, and AI briefings.
- Communication status written by Twilio SMS/call/recording paths.
- Owner/contact identity used by direct browser components and messaging helpers.
- Offer/contract state mirrored from the operational offer and transaction paths.

### Retire after usage proof

- Browser-side Manifest reads in legacy lead cards/components once the server workspace contract supplies the same evidence.
- Old pipeline/Kanban Manifest reads behind redirected routes.
- Direct Manifest CRUD routes after every real caller is moved to typed canonical services.
- Legacy “Manifest is the only source of truth” doctrine and any derived-value cascade that can overwrite a newer canonical fact.

## Containment rules

1. No new top-level or nested Manifest field in Phase 0.
2. No new browser-side Manifest query.
3. No call, text, consent, owner, assignment, stage, or task decision may rely on Manifest alone.
4. New AI context cites canonical evidence first and labels Manifest-derived intelligence.
5. Existing writers remain only where removing them would break compatibility; new writes go to canonical services.
6. Deletion/backfill waits for a consumer-by-field reconciliation and rollback plan.

## Phase 1 exit criteria

- Every Manifest field has an observed reader, writer, replacement, and last-use owner.
- Canonical-to-Manifest drift is measured rather than assumed.
- Operational writers are dual-written or redirected behind one server service.
- Browser components no longer query Manifest directly.
- Manifest can be rebuilt from durable records or is explicitly labeled historical-only before retirement.

