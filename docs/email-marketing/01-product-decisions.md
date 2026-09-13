# SavingKC Email: product decisions and ownership

Date: 2026-09-12
Status: Design decisions recorded. The detailed v1 package is complete for review through [README](README.md); application implementation has not started in this workstream.

## Immediate next step

Codex owns preparing the detailed build specification from the high-level blueprint. The user does not need to choose databases, job runners, API structures, or buy subscriptions before that work begins. The next user-facing milestone is a walkthrough of setup, campaign creation, incoming replies, human takeover, and acquisition handoff.

The walkthrough must let Ernest assess business behavior without reading technical specifications. Representative scenarios include an interested seller, someone asking to talk now, a question outside the AI playbook, an unsubscribe, a failed connection, and a paused campaign. Present any proposed business defaults clearly instead of describing them as already approved.

## Established direction

v1.1 user requirements and operating recommendations are recorded in [07 Sales voice and response operations](07-sales-voice-and-response-operations.md). Accepted: everyday-language Chris Voss/Black Swan approach and7–10-day no-response follow-up without weekend sends. Proposed setup choices: controlled individual copy, targeted alerts, policy-controlled automatic scheduling and one stable response phone line. Actual accounts/numbers/permissions remain setup inputs.

| Decision | Basis | Product consequence |
| --- | --- | --- |
| Email operates inside SavingKC CRM | Conversation direction | Existing people, properties, conversations, acquisition work, and outcomes remain connected |
| Use independently registered sending domains | Explicit user requirement | Main business domain (`savingkc.com`) is not offered as a campaign sender; intended outreach domains are `talktosavingkc.com`, `savingkcteam.com` and `yourkchomebuyer.com` (owned; live Resend/DNS is a parallel ops lane and is not product readiness) |
| Resend is the initial provider | User reports checking suitability | Build one replaceable provider integration; verify the actual configured scope and capabilities during setup/integration testing |
| AI manages routine conversations with human intervention | Explicit user requirement | Published rules define automatic actions, review cases, takeover, and return to AI |
| Lead and Opportunity are the two business stages | Explicit user clarification | Replies and callback requests are activity/status milestones, not extra business stages |
| Detailed task instructions support smaller Codex models | Explicit user requirement | Each implementation task has fixed interfaces, scope, dependencies, and observable acceptance criteria |
| Configuration happens through a guided setup experience | User suggestion and subsequent discussion | Collect launch-specific choices in a resumable wizard; build and test its integrations alongside the application |
| Simplicity and measured outcomes determine the approach | Explicit user preference | Start with approved segment copy; test added personalization against qualified outcomes, cost and human effort. Surface known material problems before dependent actions; see07 §8 |

## Focused portal revision

Accepted in v1.2: agents open Inbox with precise work filters; Campaigns opens a multi-campaign list; recipient selection is part of campaign setup; all drip steps and calendar-day timing are visible. Administrative and repair tools remain in More. [08](08-focused-workspace-and-cadence.md) is the controlling presentation contract.

## Business meanings

- **Prospect / audience member:** a sourced or existing record being considered for contact. Importing or sending an email does not make the person a Lead.
- **Lead:** a person expressing interest in discussing the sale of a property. Preserve the message supporting that classification. An ambiguous response remains for review.
- **Opportunity:** a Lead acquisitions has qualified as a real potential transaction worth pursuing. A phone number, scheduled callback, or completed call alone is insufficient.
- **Handoff:** ownership of the next action transfers to the human team. It can happen while the person is still a Lead and does not itself convert the record to an Opportunity.

Qualification criteria and CRM field mapping must be made explicit in the detailed data/state specification. Do not create a parallel pipeline or automatically overwrite an existing opportunity's stage.

## Who handles what

| Work | Owner | When the user becomes involved |
| --- | --- | --- |
| Inspect existing implementation and choose an isolated implementation baseline | Codex | Only if a material product/release choice cannot be determined from the existing system |
| Design data, jobs, interfaces, permissions, and failure recovery | Codex | Explain business consequences of any meaningful tradeoff |
| Define every page/action contract and implementation packet | Codex | Walk through representative user journeys |
| Build and verify product behavior | Codex | Review the working experience at useful milestones |
| Choose a sending brand/domain and authorize any purchase | User through setup | When production sending is being configured |
| Connect owned accounts and complete provider authentication | User through setup where required | At the relevant connection step; controlled integration access may be needed earlier |
| Choose initial audience, campaign spend, staff owners, and permitted AI actions | User through setup | With recommendations, previews, and examples in plain language |
| Confirm the first live campaign | User through the campaign launch action | After exact scope, recipient exclusions, readiness, and costs are visible |

Do not turn routine implementation decisions into user questionnaires. Use configurable product settings for business choices. When external action is required, explain the actual action and cost/impact and preserve completed setup progress.

## Design defaults

These are implementation proposals, not claims about current configuration:

- Reuse current CRM authentication, contact/property identities, conversation links, and acquisition tasks where their semantics fit.
- Use server-enforced eligibility, ownership, budget, and suppression checks. The AI cannot bypass them.
- Keep setup completion separate from campaign launch. A ready workspace may contain draft campaigns without sending anything.
- Keep sender identity stable within an active conversation. Human takeover changes who controls the reply, not the identity presented to the seller without explanation.
- Permit draft-only or bounded automatic replies by campaign and action category. Promotion to automatic handling depends on demonstrated behavior against the evaluation cases.
- Reuse existing paid service accounts where appropriate. Show incremental costs and actual missing capabilities before suggesting an additional subscription.
- Save setup server-side and allow return to a waiting or failed step. Distinguish missing access, pending DNS, failed verification, and completed verification.
- Use a shared thread and owner for Email and existing Conversations. Needs review is a view of the same underlying work.
- Keep provider acceptance, delivery, replies, seller interest, completed calls, opportunities, and revenue distinct in reporting.

## Delivery sequence and observable results

| Milestone | Result | Evidence of completion |
| --- | --- | --- |
| A. Detailed design | Exact system, data/state, page/action, provider/job, AI/evaluation, and release contracts | Cross-referenced specification and dependency-ordered tasks; uncovered decisions explicitly identified |
| B. User walkthrough | Representative setup, campaign, reply, review, and handoff experience | User can see what each action does, including relevant pending and failure states |
| C. Integrated foundation | Setup plus one complete send/reply/takeover/handoff/unsubscribe path | Controlled provider-backed checks and recovery tests; simulations labeled separately |
| D. Complete application | Audience, campaigns, inbox, AI, domains, reports, and operational controls | Required action contracts pass, permissions hold, and browser behavior matches the design |
| E. Production setup | Final accounts, domains, staff, audience, policies, and budget configured through the wizard | Current, verified connection and readiness records; the first campaign remains reviewable |
| F. Bounded launch | A deliberately activated campaign with accountable human handling | Real provider events, observed reply/handoff behavior, accurate spend, and an available pause control |

Milestone B is a product walkthrough, not proof of production delivery. Early integration checks may overlap design refinements; do not build every screen against invented provider capabilities and defer reality until launch.

## Inputs deferred to setup

Exact domains and sender names; provider account choice and authentication; actual subscription terms; first eligible audience/source; business address and program identity; campaign copy and maximum touches; operating hours; budget and planned volume; reviewer/acquisition owner and backup; optional calendar connection; allowed AI actions.

These inputs do not prevent detailed design. Settings that are still missing must have explicit pending states and dependent actions must stay unavailable until configured. User-reported provider suitability remains an input to document, not evidence that the application already has a working provider connection.

## Next specification work

Complete the remaining documents listed in the blueprint and record their status in `build-status.md`. Resolve contact/Lead/Opportunity mapping first, then conversation ownership and suppression, then scheduling/transport, and finally the page contracts that expose those states. Include the setup wizard in each integration task rather than adding it after the application is finished.
