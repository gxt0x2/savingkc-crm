# Focused workspace, inbox views and campaign cadence

Specification v1.2 · 2026-09-12 · Design only. This revision replaces the navigation and presentation defaults in04, while retaining its action guards and the operating rules in07. It must be read before implementing EM-020–EM-024, EM-027, EM-033 and EM-035.

## 1. What an agent opens

Email opens **Inbox → Needs action → Mine**, across campaigns. The visible navigation is **Inbox · Campaigns · More**. A workspace owner may switch scope to Team; permissions still apply to records, counts and search. Unassigned work has a visible count and belongs to the configured reviewer/backup queue rather than disappearing from responsibility. A new workspace shows a small setup banner with its next concrete action.

More contains Results, Saved recipient lists, AI rules, Sending & phone, Setup & settings, and Operations for permitted roles. Managers can open the existing overview from Results. Calls and acquisitions work are accessible through the inbox Calls & appointments view and the existing handoff deep link. No separate inbox store, task store or pipeline is introduced. Existing routes remain valid; /marketing/email resolves to the focused inbox. Deep links retain campaign, filters and selected thread when navigating back.

Daily work shows the next action, why it is needed, responsible person and due time. Sender diagnostics, evidence and history sit behind a Details disclosure. A failure requiring action appears beside the affected item, with an Operations link; hiding admin navigation must never hide a problem from its responsible user. Campaign creation/configuration is available according to role, not on every agent's opening screen.

## 2. Inbox: work state, outcome and owner are different things

Do not use one editable status dropdown for AI ownership, seller intent, lifecycle and marketing restrictions. They are independent facts. The server derives views from canonical records and returns a reason and next action with every row. Labels only filter; they never transfer ownership, qualify a Lead, clear a restriction or resume sending.

| View | Exact inclusion | Row's primary action |
| --- | --- | --- |
| Needs action | Open, due human reply/review/callback work, overdue work or an unresolved blocking exception assigned to the selected scope; excludes future snoozes unless new inbound/urgent exception wakes them | Earliest responsible next action; urgent callback, overdue, due time, latest inbound, stable ID |
| Needs review | Unresolved human review, including a blocked reply or identification issue; unread alone is insufficient | Review the exact reason and evidence; take over/approve/resolve as permitted |
| Calls & appointments | Unfinished call request, phone-provided work, pending/uncertain booking, future booked callback or missing post-call outcome | Acknowledge, arrange time, view booking or record outcome |
| AI handling | AI controls an eligible open thread and has an actual queued/running permitted action; excludes review holds, suppression, snooze, idle waiting and completed actions | Inspect pending action or Take over |
| Waiting | Waiting for seller, future snooze/reminder, or classified automatic reply on hold, with no due human action | Show who/what is awaited and next check date; wake/take over deliberately |
| Closed & stopped | Conversation completed, no fit, wrong person or a contact restriction is effective | Read history and restriction reason; unresolved obligations still appear in Needs action too |
| All conversations | All authorized matching threads, including closed, stopped and unmatched replies | Context-dependent; not the agent's opening queue |

Visible controls: search person/email/property/message; owner scope Mine/Team/Unassigned/specific authorized teammate; campaign; More filters. More filters exposes review reason, outcome, controller, unread, overdue, date range and sending identity. Views have live counts for the current authorized owner/campaign/search/filter scope. Same-facet selections use OR; different facets use AND. Counts can overlap because one thread may contain review and callback work; never sum badges as unique totals. Show result count and active filter chips, with Clear filters and a useful empty state.

**Review reasons:** price/offer; legal/commitment; identity/property mismatch; conflicting facts; unclear intent; unsupported request; stale approval; reply delivery uncertain. System delivery issues link to Operations rather than asking an agent to guess a retry. AI can propose reasons but deterministic guards and unresolved review records control inclusion.

**Outcome filters:** Interested; Call requested; Not now; Not interested; Unsubscribed; Wrong person; Automatic reply; Unclassified. Provide a visible **Unsubscribed** shortcut under Closed & stopped, with scope and time. These are filters over evidenced outcomes/restrictions, not new pipeline stages. Not interested and Unsubscribed remain distinct. “Not now” requires a next reminder or an explicitly closed conversation, not an endless active sequence. Any inbound first stops/holds pending sequence sends; classification never permits an already queued follow-up to race ahead. An automatic reply does not count as a human reply, Lead or Opportunity.

**Controller filters:** AI / Me / Other person / Unassigned, separate from responsible reviewer and acquisitions owner. Show both only when they differ. Opening or reading a thread does not acknowledge its task, resolve review, stop AI or change its stage. Phone provided remains distinct from a request to call.

Store personal saved views in `em_inbox_views`: workspace_id, user_id, id, name (1–60 chars), allowlisted query_version/query_json, timestamps, revision. Owner-only writes; validate referenced campaign/user access every read. URL filters take precedence over a saved preference; role changes invalidate inaccessible values with a visible notice. No shared-view administration in v1. Backend query/counter predicates must be shared; cursor pagination, freshness timestamp and stale/pending labels prevent a loaded page from looking like the full inbox. Invalid filters must not silently widen access or show zero as a verified empty inbox.

## 3. Campaigns means a list of campaigns

Campaigns opens a list, not the last campaign editor. Status filters: All / Running / Scheduled / Draft / Paused / Completed; archived behind More filters. Every row shows name and audience purpose, owner, status or hold reason, progress (unique recipients started/approved), next send or “None — [reason],” needs-action count, Leads and human-qualified Opportunities. Cost and sender details expand on demand. New campaign is the main action. Row Open shows detail; action-needed count opens the same inbox with campaign filter; Pause affects exactly that campaign. Global pause is a separate clearly labeled management action.

Within a campaign use **Summary · Recipients · Sequence · Activity**. Summary has outcomes, actual status, next scheduled work and staffing. Recipients answers who is in/out and why. Sequence exposes every message and delay. Activity contains receipt/event/error evidence, exact versions and troubleshooting links. Keep the campaign name/status visible in every tab.

Multiple active campaigns share workspace/provider/sender limits and spend reservations. A campaign's requested cap cannot multiply the actual account capacity. The scheduler reserves shared capacity atomically and allocates due eligible work fairly across campaigns with a stable ordering; no starvation from a newly launched campaign. Show “Waiting for shared sending capacity” and a labeled estimate when relevant, not a false precise promise. Due conversation replies get priority within the same overall limits; overdue campaign work never bypasses guards or bursts after recovery.

A known canonical person may have at most one active cold-outreach enrollment within the same program. Launches race-safe check enrollment across campaigns/sender domains and show “Already active in [campaign].” Ambiguous shared identity remains excluded for review. Historical appearances are allowed; eligibility, restrictions and current conversations govern later enrollment. A reply is attributed by durable send/thread evidence; ambiguous campaign attribution remains Unknown and opens review, rather than guessing the most recently contacted campaign. Pause one campaign must not pause unrelated campaigns, silently transfer recipients or free an uncertain send's reserved slot prematurely.

## 4. Recipients: a useful step, not a competing contact system

Remove Audiences from the main navigation. Campaign → Recipients is the normal entry point. Choose a saved CRM list/filter or import CSV, then preview **Selected → Duplicates removed → Restricted → Already active elsewhere → Needs review → Ready**. Each count opens its exact rows and reason. Show as-of/source evidence and distinguish original selected people from the frozen approved enrollment. Group totals must reconcile and explicitly document precedence when a row has several exclusion reasons; the detail preserves all reasons.

Operator actions: select source; map CSV columns; preview import; fix identity/source evidence; import existing verification or request a capped check; exclude/restore a row; save as a reusable recipient list; apply the reviewed list to a campaign draft. Existing AUD commands retain their meanings and guards. No side effect is a send or a Lead creation. Restoring a row never removes global suppression. CSV errors retain row evidence and correction workflow. Pending/failed verification cannot become Ready just because a spinner stopped.

An active campaign shows its frozen recipients. Add or replace recipients through a new draft/review; no silent additions from a dynamic CRM segment. More → Saved recipient lists serves managers reusing or repairing lists and retains P03/P04 import/audit behavior. This is the reason the underlying audience capability exists even though agents do not need a daily Audience destination.

## 5. Drip timing must be visible and understandable

Sequence shows an ordered timeline, editable on drafts and readable on active versions:

1. **Email 1 — first eligible weekday send slot.** Subject/body and approved fields visible; an estimate remains an estimate until actual provider acceptance.
2. **Wait 7–10 calendar days after Email 1 is accepted.** Default target is day8; send weekdays only within configured hours/timezone.
3. **Email 2 — only if no reply and still eligible.** Full follow-up body visible in the same thread. At most two total messages in the pilot unless deliberately changed and re-reviewed.
4. **End this sequence.** No automatic loop, recycle into another campaign, call appointment or nurture enrollment.

For each wait show minimum/target/maximum calendar days, allowed weekdays, send window and named timezone. UI text must not call this “business-day delay.” Date preview takes a hypothetical actual acceptance timestamp; changing it recomputes both dates and explains any weekend adjustment. Example: Friday September11,2026 at10:00 America/Chicago → target Saturday September19 → Monday September21 at10:00 (day10). Preview does not enqueue or reserve a send. Actual per-person next send comes from the scheduler after acceptance, not the preview or campaign launch date. No random timing is necessary merely to appear human.

Hold reasons outrank the 10-day window: reply, opt-out, complaint, bounce, uncertain send, pause, expired enrollment, stale incoming-mail health, budget or capacity. Show Stopped/Held with the real reason and revised estimate when known. No forced send on day10. Any actual reply cancels the unanswered drip and moves the conversation to its appropriate handling; fast conversational replies and agreed callbacks do not inherit the 7–10-day wait. Out-of-office is Waiting/automatic reply until an explicitly permitted future action is chosen; it is not silently restarted.

Draft controls: edit subject/body; insert approved field; add/remove/reorder steps within permitted touch limits; edit delay and schedule; preview dates/content; save; review. Required identity/footer and stop rules are shown but cannot be removed. Invalid min/target/max, weekend-only schedules or unsupported touch counts block review with field errors. Changing cadence after copy approval invalidates the campaign review hash. Active campaign Edit creates a new draft version; publish affects only its explicitly reviewed new enrollment cohort. Existing recipients stay pinned to their version. No blanket silent reschedule; stop/re-enroll is a separate future scope unless existing guards explicitly permit it.

## 6. Inspiration and boundaries

Patterns reviewed from official documentation on2026-09-12:

- **Front:** conversation filters can combine assignee, status and tags, with visible indicators and persistent selections. Borrow the distinction between work queues and filters. [Conversation filters](https://help.front.com/en/articles/2163), [Inbox tabs](https://help.front.com/en/articles/2159).
- **Instantly:** Unibox combines replies across accounts and filters by campaign, status, unread and reminders. Borrow the consolidated inbox with campaign context. [Unibox](https://help.instantly.ai/en/articles/6576561-how-to-manage-unibox-best-practices-for-replying-to-leads).
- **HubSpot:** sequence steps show timed messages/tasks, schedule controls and reply/meeting unenrollment. Borrow the visible step-and-delay structure. Our7–10-calendar-day rule remains different from its business-day delay semantics. [Sequences](https://knowledge.hubspot.com/sequences/create-and-edit-sequences).

These are interaction references, not a recommendation to subscribe. Preserve SavingKC's own Lead → human-qualified Opportunity meanings, evidence-based campaign attribution, restrictions and capacity rules. A third-party product's naming or behavior does not override these contracts.

## 7. Acceptance and implementation

04 contains the updated routes/action references. T57–T62 in06 verify this revision; EM-035 reconciles the integrated UX and implements saved views. Base packets consume this contract from the start rather than intentionally building obsolete navigation. The updated walkthrough uses fabricated sample conversations/campaigns and local interactions. It proves design intent only; production search, counts, cadence scheduling, ownership, subscriptions and sending remain unbuilt and require the existing implementation/release gates.

## Approved visual palette

The portal uses the approved white, red and grey light theme. Match the focused prototype: white panels, `#f6f7f9` canvas, `#eef1f5` secondary surfaces, `#202631` text, `#576274` secondary text, `#dce1e8` borders, `#a9202e` primary actions and selection indicators, and `#fff0f2` selection tint. Do not substitute green or introduce an automatic dark theme. Use labels alongside color for operational states.
