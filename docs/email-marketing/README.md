# SavingKC Email: build specification

**The design is approved. A connected local simulation is implemented; the full application and live integrations are unfinished.**

Start with [current build status](build-status.md) and [local verification](local-verification.md). These replace earlier packet-completion claims.

Implementation continues in the isolated checkout named in [the historical source baseline](implementation-baseline.md). Its CRM identity and lifecycle findings remain useful; the current build-status document owns continuation instructions.

Ernest's decisions: email belongs inside the CRM; campaign sending uses separately registered domains; Resend is the initial transport; AI handles routine work with bounded human intervention; expressed seller interest becomes a **Lead**, and acquisitions explicitly qualifies an **Opportunity**. Final subscriptions, domains, team, audience and spend are collected through a guided setup experience.

## What the product will do

1. Guide you through connecting services, verifying a sending domain, assigning your team and reviewing costs.
2. Build an audience with visible source, identity, verification and permission checks; show exactly who is excluded and why.
3. Let you review and launch an exact campaign, with limits on recipients, messages and spend.
4. Capture full replies in the CRM, let AI handle approved routine cases, and send exceptions to the responsible person.
5. Let a human take over immediately, receive a seller handoff, record a conversation and qualify an Opportunity deliberately.
6. Show actual delivery, Leads, Opportunities, human effort, costs and failures, with one place to pause sending.

The interactive walkthrough accompanying this package uses sample data. It demonstrates product decisions; it does not connect services, buy subscriptions, send email or prove live integrations.

## Review without reading technical documents

In the current focused walkthrough, start with Needs action, filter by campaign/review reason, find Unsubscribed under Closed & stopped, and take over the pricing question. Open Campaigns to compare simultaneous campaigns, then inspect Recipients and Sequence, including the date preview. More retains the sample configuration and repair context. The earlier broad walkthrough also demonstrates setup and handoff/qualification. Look for whether the responsible person and next action are obvious without hiding needed details.

Suggested defaults are labeled in setup: one small initial sender/campaign, conservative volume, draft-only until automatic handling passes evaluation, and required owner-entered spending limits. They are not claims about your existing accounts or approved launch settings.

v1.1 adds [the sales voice and response operations contract](07-sales-voice-and-response-operations.md): everyday Black Swan language, optional controlled per-person initial copy,7–10-calendar-day weekday follow-up, targeted phone/callback alerts, automatic booking rules and one stable email-response phone line. The pilot starts with simple approved segment copy and verified fields; extra personalization must justify itself in an outcome-based comparison. These remain design/configuration requirements, not live capabilities.

v1.2 adds [the focused workspace and cadence contract](08-focused-workspace-and-cadence.md): Inbox/Campaigns/More navigation, exact work and outcome filters, multiple concurrent campaigns, recipients inside each campaign, full drip messages and date previews. This is the current walkthrough/design direction.

## Complete specification

| Document | Purpose |
| --- | --- |
| [00 High-level blueprint](00-high-level-blueprint.md) | System direction and rationale |
| [01 Product decisions](01-product-decisions.md) | Accepted choices and who handles each step |
| [02 Data and states](02-data-and-states.md) | Existing CRM mapping, tables, state transitions, identity, access and concurrency |
| [03 Integrations and jobs](03-integrations-and-jobs.md) | Secure connections, provider contracts, command API, jobs, costs and recovery |
| [04 Pages and interactions](04-pages-and-interactions.md) | All19 v1 surfaces, every action, loading/error/conflict behavior, mobile and keyboard behavior |
| [05 AI playbooks and evaluations](05-ai-playbooks-and-evaluations.md) | Exact policy/output contract, human intervention and promotion criteria |
| [AI seed fixtures](ai-fixtures.json) | 40 fabricated reply scenarios with prohibited effects |
| [06 Tests and release](06-tests-and-release.md) | 62 acceptance cases, integrated milestones, production setup and rollback |
| [07 Sales and response operations](07-sales-voice-and-response-operations.md) | Everyday Black Swan voice, personalization, alerts, calendar and response phone |
| [08 Focused workspace and cadence](08-focused-workspace-and-cadence.md) | Inbox views, recipient workflow, concurrent campaigns and visible drip schedule |
| [17 Setup productization](17-productization.md) | Local setup wizard, draft-only AI checks, manual calendar/phone/push and saved views |
| [18 Local #3 packet-complete](18-local-3-packet-complete.md) | Local-software report for #3; packets stay Partial |
| [19 Outreach DNS ops-verify](19-outreach-dns-ops-verify.md) | Robin-landed Resend/DNS snapshot; not sending-ready |
| [20 Hosted secrets contract](20-hosted-secrets-contract.md) | Exact Email env names for Robin; live send stays gated |
| [35 implementation packets](tasks/README.md) | Dependency-ordered, bounded work for smaller coding models; EM-030 remains final release verification |
| [Design manifest](design-manifest.json) | Machine-readable task dependencies and action/test coverage |
| [Build status](build-status.md) | Evidence of what is designed, built, tested or still pending |
| [Implementation baseline](implementation-baseline.md) | Current checkout, CRM integration corrections, 41 existing tests passed, missing live checks and exact next-model handoff |

## Important implementation findings

The existing CRM already labels `contacted` as Leads and `qualified` as Opportunities. This system reuses those records. It must prevent existing appointment/auto-advance helpers from turning a mere callback into qualification or triggering unrelated SMS/ad-conversion behavior. Existing Conversations and buyer email sends also need the same suppression and ownership checks as the new Email workspace.

The economical default is existing CRM database/hosting plus direct email transport. A dedicated AI adapter and optional address verifier are narrow connections, not another campaign platform. OpenAI and ZeroBounce are implementation defaults pending actual account/cost checks; recent verification evidence can be imported to avoid paying twice. Current service prices, subscriptions and exact domains have not been inspected or purchased. Public provider terms and specific account/program scope are recorded in the configuration plan; see03 for source links and evidence boundaries.

## Build sequence

**EM-001's local baseline is complete; live schema preflight remains pending.** Begin EM-002's independent shared contracts and safe harness scaffolding in the isolated checkout. Resolve actual schema evidence before dependent SQL or canonical writes, then prove one complete controlled send/reply/takeover/handoff/opt-out path before finishing every screen. Complete the remaining pages, verify the full product, then use the wizard for production setup and a deliberately launched pilot.

The next implementation stage is distinct from this completed design stage. No technical questionnaire or pre-purchase is required to review this package. Provider test access may be needed when the first real integration is exercised.

## Design validation

Run `python3 docs/email-marketing/validate_design.py` from the repository root to check internal document links, packet dependencies, page/action/test coverage and AI fixture integrity. This checks the specification only; it does not run application, database, model or provider tests. See `design-validation.json` for the most recent result.
