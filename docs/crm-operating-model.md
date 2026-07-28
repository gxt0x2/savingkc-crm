# SavingKC CRM Operating Model

## Purpose

The CRM is an operating system for moving a seller relationship from first signal to completed outcome. Screens are views of that system; they do not define the system.

Every active opportunity must make five facts explicit:

1. Identity: who the people are and which property is involved.
2. Ownership: which user or team is responsible now.
3. Communication: what happened, what channel it used, and whether a reply is owed.
4. Stage: where the opportunity is and which entry/exit rules apply.
5. Next action: what must happen next, who owns it, and when it is due.

## Canonical record boundaries

| Record | Owns | Does not own |
| --- | --- | --- |
| Contact | Person identity, consent, communication endpoints | Property economics or pipeline stage |
| Property | Address, physical facts, ownership relationships | Conversation state or agent assignment |
| Opportunity | Pipeline stage, value, offer, source, assigned owner | A person's canonical phone/email |
| Conversation | Channel history, unread state, reply state, assignment | Opportunity economics |
| Appointment | Scheduled time, participants, outcome, reminder state | General follow-up sequence |
| Task / next action | A required human action and due time | Reusable automation definition |
| Workflow | Reusable trigger, conditions, actions, safeguards, versions | A lead-specific task |

The current `leads` record may remain as a compatibility aggregate during migration. New features should not add further unrelated responsibilities to it.

## Ownership rules

- An opportunity has exactly one responsible owner or explicitly belongs to an unassigned team queue.
- A conversation may be assigned separately for inbox coverage, but changing conversation assignment does not silently change opportunity ownership.
- Every pending next action has one owner.
- System automations identify themselves as system actors and preserve the initiating user where applicable.
- Reassignment creates an audit event.

## Communication rules

- Inbound communication sets the conversation to `needs_reply` unless a deterministic resolution rule applies.
- A successful human outbound response sets it to `waiting_on_contact`.
- Delivery failure does not count as a response.
- Internal notes never alter reply state and can never be delivered externally.
- Resolution is explicit or caused by a documented terminal event.
- SMS actions always check consent, opt-out, sender eligibility, and protected-number restrictions.
- Google Ads tracking numbers remain unavailable to generic conversation, broadcast, and dialer selection.

## Stage rules

The canonical acquisition stages are:

`new -> contacted -> qualified -> offer_made -> under_contract -> disposition -> closed`

`dead` is a terminal branch with a required reason. Recycling creates a new or reopened opportunity event; it does not erase history.

Each stage definition must include:

- Entry criteria
- Exit criteria
- Required fields
- Permitted next stages
- Required next-action policy
- Timeout/escalation policy
- Automation events
- Reporting meaning

Existing aliases such as `not_contacted`, `qualifying`, `appt_set`, `appointment_set`, `negotiations`, `contract_signed`, `closed_won`, and `closed_lost` must be translated at system boundaries rather than added to the canonical vocabulary.

## Next-action invariant

Every non-terminal opportunity must have exactly one primary pending next action.

Supporting tasks may exist, but the primary action answers:

- What happens next?
- Who owns it?
- When is it due?
- What created it?
- What completion event closes it?

Stage changes must validate the next-action invariant before completion.

## Workflow model

Workflows are versioned operational policies made of:

- One trigger
- Optional conditions or branches
- Ordered actions
- Stop conditions
- Protected resources
- An owner
- Draft, active, paused, or archived status
- Execution history

Initial workflow families:

1. Phone-number call flows
2. Seller lead-form intake
3. Appointment confirmation and reminder flow
4. Missed-call recovery
5. Conversation reply escalation
6. Stage and stale-opportunity policies
7. Nurture and recycling

## Workflow publishing guardrails

No workflow editor should publish until the platform supports:

- Draft and published versions
- Structural validation
- Dry-run or test-contact execution
- Estimated affected scope
- Consent and do-not-contact checks
- Protected phone-number enforcement
- Loop and rate-limit detection
- Execution logs
- Rollback
- An explicit change summary

The first Workflows release is therefore a read-only catalog.

## Migration sequence

1. Establish canonical vocabulary and compatibility mappings.
2. Add read models that project existing lead/activity data into the new contracts.
3. Introduce conversation attention state and per-user unread state.
4. Introduce one primary next action per active opportunity.
5. Move workflow definitions out of scattered code paths into a versioned registry.
6. Add contacts/properties/opportunities relationships without deleting the compatibility `leads` aggregate.
7. Switch UI surfaces one vertical workflow at a time.
8. Retire legacy fields only after parity and production reconciliation.

## First vertical slice

The first production-capable slice should be seller form to first response:

1. Receive seller form.
2. Normalize identity.
3. Resolve or create contact and property.
4. Resolve or create one opportunity.
5. Capture attribution and consent.
6. Assign ownership.
7. Create a primary first-call action.
8. Send an acknowledgment when permitted.
9. Display the conversation in the team inbox.
10. Record every decision in the workflow run log.

This slice exercises identity, ownership, communication, stage, next action, and workflow execution without requiring a wholesale migration.
