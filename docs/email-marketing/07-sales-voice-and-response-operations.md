# Sales voice, personalization and response operations

Specification v1.1 · 2026-09-12 · Design revision following Ernest's sales-training and operating feedback. No application code or live configuration changed.

## 1. Accepted changes and design recommendations

Accepted user requirements: SavingKC sales communication follows Chris Voss / Black Swan principles in everyday language; preserve labels, mirrors, paraphrases and the purpose of favorite-or-fool discovery without corporate phrasing. No-response follow-up is **7–10 calendar days**, with no weekend sends. Calendar-day interpretation and day8 target are explicit design defaults; the user specified the range and weekend exclusion.

Recommendations incorporated for setup review: controlled AI personalization of initial emails, targeted push alerts in addition to persistent CRM work, automatic callback booking when the seller's request is sufficiently precise and policy permits, and one stable email-response business line. Exact telephone number, subscriptions, staff, alert channels, scheduling permissions and spend remain owner choices in setup. No domain/number purchase, notification or calendar write is authorized or performed by this specification revision.

This document extends02–06 and must be read by every affected implementation packet. The first pilot defaults to simple approved segment copy with relevant verified fields. Controlled contextual AI copy remains available for a bounded comparison; it does not become the default merely to make every email different. Initial v1 notification/calendar descriptions have been amended; do not implement the earlier in-app-only interpretation.

## 2. Pain, relevance and everyday language

The goal is to understand the reader's situation and desired relief. Avoid assuming a distressed list record describes the person's feelings or that selling is the right solution. Facts can be accurate yet intrusive in a first email. Use this evidence ladder:

| Context | Permitted use | Prohibited shortcut |
| --- | --- | --- |
| Recent direct seller statement, linked to message/call note | Reflect the actual concern naturally, with attribution retained internally | Turn an asking price into an offer or a concern into proven financial desperation |
| Verified nonsensitive situation, such as owning a rental far away | Conditional relevance: “If managing the place from a distance is becoming a hassle…” | “You're overwhelmed by this rental” without evidence |
| List signal or public record about taxes, probate, age, foreclosure or family events | Segmentation/review input; use neutral property/goal relevance by default | Put sensitive record details in subject/snippet or assert private hardship/intent |
| Missing, stale, shared-person or conflicting evidence | Neutral approved copy or review; ask rather than invent | Fabricate a repair issue, death, deadline, motivation or prior conversation |

A tentative label about a dynamic in an actual conversation is allowed as a **hypothesis**, not stored as a fact. Seller correction overrides the hypothesis and invalidates pending copy based on it. No intentional emotional pressure, invented urgency or manufactured scarcity. The seller's expressed desired outcome matters as much as the problem.

Suggested writing rules: subject3–7 ordinary words with no sensitive personal detail; first email usually50–90 words before required identity/footer; replies as short as needed, maximum120 words. One thought and at most one question/response invitation; a label or paraphrase can stand alone without an added question. No technique quota, repeated “It sounds like” opening in every turn, excessive personalization, false friendliness or invented familiarity. No forced uniqueness just to make every sentence different.

Original examples for review, not approved live copy:

- With verified remote-owner context: “If keeping up with the place from out of town is becoming a hassle, would it be worth looking at what selling could involve?”
- After the seller says repairs are the obstacle: “Sounds like putting more money into repairs is the part you want to avoid.”
- After a seller says timing is flexible but tenants matter: “So you have some room on timing. Making this work for the tenants matters more.”
- Later discovery, when comparing buyers is relevant: “What would make one buyer a better fit for you than another?” This explores decision criteria; it does not prove we are the preferred buyer.

Labels stay tentative where understanding is uncertain. Mirrors use a meaningful phrase from the seller, not boilerplate or invented quotations; paraphrases preserve substance without turning uncertainty into fact. In email, a bare repeated phrase can be read as abrupt, so choose a fuller natural sentence when tone is unclear. Favorite-or-fool is an internal discovery purpose, never a label applied to a seller or an automatic disqualification score. Do not force it into an opening email or a seller's urgent request to speak.

Black Swan describes labels as a way to surface perspective, cautions against overusing a technique, and treats favorite-or-fool discovery as checking whether a genuine deal is possible. Our application to short real-estate emails is a design judgment, not a claim of proven uplift. [Labels](https://www.blackswanltd.com/newsletter/hang-a-label-on-it?hs_amp=true), [proof-of-life discovery](https://www.blackswanltd.com/newsletter/communications-skills-handling-objections). Voss also provides an email mirroring example and emphasizes brevity and a positive ending; it is an example, not evidence every recipient benefits from a mirror. [Email mirroring](https://www.blackswanltd.com/newsletter/how-to-get-a-refund-with-a-simple-email-mirror).

## 3. Precisely what is personalized

The previous v1 design used approved initial templates with name/property fields; incoming AI replies were individually composed from the conversation. It did not specify individually generated first-touch copy for every recipient. v1.1 adds a controlled hybrid:

1. Campaign chooses an approved segment angle, truthful value proposition, plain-language playbook, call to action and required footer. Generic template mode remains available.
2. Gather a small evidence packet per person: confirmed property/context, permitted recent seller statements, sensitivity/use restrictions, prior questions and current program eligibility. There is no unrestricted enrichment or search task.
3. For `contextual_ai` mode, generate each person's subject/body from that packet. People with the same usable context may receive identical wording; uniqueness is not a quality metric. If evidence is sparse, use approved segment copy instead of inventing pain.
4. Guard factual claims, sensitivity, identity, tone, program permission and word/question limits. Show campaign preview by segment,20 deterministic representative samples and **every flagged outlier**. Human review is of the approved pattern, sample and exceptions, rather than mandatory approval of every safe recipient row.
5. Persist the exact reviewed content set and hash before launch. Launch binds audience, generator policy/model version, copy-set hash, exclusions and cost. No creative rewriting at dispatch. Changed content/evidence forces a new review. Failed generation never silently inserts unreviewed generic text after approval.
6. Incoming replies use their complete current thread, not repeated first-touch templates. Evidence/ownership/suppression/maximum-reply rules still govern every response.

Schema addition `em_recipient_copy`: common ID/workspace/time fields; `campaign_id`, `draft_revision`, `snapshot_row_id`, `sequence_step_id`, `mode: template/contextual_ai`, `content_set_id`, `evidence_hash`, `policy_hash`, `model_id?`, `subject`, `text_body`, `content_hash`, `state: generated/flagged/approved/stale`, `guard_results`, `reviewed_by?`, `reviewed_at?`, `cost_entry_id?`. Unique content-set/snapshot-row/step. `em_copy_sets`: campaign/revision/snapshot/policy/model hashes, generation state/cursor, counts, sample row IDs, reviewer, approval timestamp and immutable approved hash. Add `copy_set_id` to campaign versions and `recipient_copy_id` to send intents; exact bytes included in payload hash. Owner-side manual edits create a new copy revision.

Never generate copy for excluded recipients. Charge initial copy generation to the campaign's explicit **draft-generation budget** before launch; show it even if the campaign is never sent. Reuse unchanged content/evidence hashes. For future steps, pre-generate neutral no-response copy; if the seller replies, cancel that sequence rather than using the old copy in a live conversation.

## 4. Phone-provided events and real notifications

Phone extraction is not the same as a callback request. Detect new phone/time information from visible new message text; exclude quoted history, email signatures, business footers and third-party numbers unless explicitly relevant. Persist normalized number plus original text/message span and relationship. Do not replace an existing primary number without reconciliation.

| Incoming event | Automatic record and owner reaction | Calendar behavior |
| --- | --- | --- |
| A new phone number alone | Owner notification: “Phone provided — confirm preferred contact”; review context/identity, no automatic Opportunity | No guessed appointment |
| “Call me” plus usable number | Stop sequence, evidenced Lead if selling interest is clear, urgent handoff and callback task, targeted alert | If no precise time, ask one time question or offer available slots |
| Date only or a range such as “tomorrow after2” | Store stated preference and notify owner | Offer an available exact slot; do not silently call a preference a booking |
| Clear date/time/timezone, number and assigned available agent | Book under enabled automatic scheduling policy, link event/task/thread, notify assigned agent | Confirmed provider event + human-readable confirmation to seller through guarded email |
| Duplicate webhook, repeated phone in signature or old quoted appointment | Deduplicate/no new task or alert | No duplicate event |

Use persistent recipient-scoped CRM notification **plus targeted push** for urgent call requests, confirmed/changed appointments and missed inbound calls. Routine phone-only information is a normal-priority owner alert. Proposed urgent acknowledgment target5 operating minutes, backup escalation when unacknowledged; callback task target30 operating minutes where seller timing permits. Do not spam the entire team. Assignment order: current responsible lead/thread owner if eligible/available → configured campaign acquisitions owner → configured backup. Existing active ownership takes priority over round-robin allocation.

Alert carries event type, due/requested time, owner and deep link. Lockscreen text omits sensitive seller/property details; full evidence is inside CRM. Delivery states: queued/provider_accepted/failed, then user acknowledged separately. Push success is not proof the agent saw it. Missing push subscription or stale delivery opens a visible setup/operations issue and escalation; chosen fallback internal channel must be tested during setup. No staff SMS, Slack or notification-email route is enabled silently. In-app work always persists even when push fails.

Local code already has `sendPushToUser` in `src/lib/push-notifications.ts`; current credential/device readiness is unverified. The existing generic `/api/notifications` appears unscoped in the inspected handler: do not reuse it blindly for private per-agent work. Use recipient-scoped reads/acknowledgment and server auth. Prefer shared existing infrastructure after a narrow reviewed adaptation, not another notification SaaS.

Add `em_notification_deliveries` with event logical key, recipient user, channel, attempt, state, provider reference, queued/accepted/failed times and error; unique event/recipient/channel/attempt. Add `em_notification_acknowledgments` unique event/recipient with acknowledged time. Delivery job dedupe includes event revision; reminders and backup escalation are separate explicit events. Cancel obsolete reminders on reassignment/reschedule.

## 5. Automatic calendar behavior and follow-ups

Google Calendar is scheduling truth; CRM task is the work record. Enable automatic booking in setup only after calendar/account scope, agent mapping, hours, slot availability, conflict behavior and alerts pass a controlled test. Default callback duration15 minutes with10-minute buffer, both configurable and shown to owner. No scheduled business calls before08:30; weekdays only by default. Workload limits cap appointments per agent/day and account for existing CRM/calendar work.

Precise explicit seller request can book automatically without another human approval if within enabled policy and agent availability. Date only, “after2,” “next Friday” when date is ambiguous, unclear timezone, conflicting number or multiple people goes through one clarification or human review. A offered slot accepted by the seller is also sufficient. Calendar insert/recheck uses stable operation key and locks; provider timeout remains uncertain until lookup reconciles. No duplicate invite/event or double booking on replay.

Confirmation email is an allowed scheduling acknowledgment template sent only **after** provider booking succeeds and current suppression/controller rules allow it. If a human owns the thread, queue the confirmation for that owner instead of letting AI interrupt. No automatic guest meeting invitation or SMS by default. Reschedule/cancel updates the same event/task, stops outdated reminders and alerts the assigned agent. If the seller cancels or opts out with a cancellation request, cancel future outreach/tasks consistent with that request; an email-only opt-out without context does not invent a calendar cancellation, so put upcoming contact on review hold.

Automatic follow-up calls require an agreed time or an explicitly enabled internal follow-up-task policy. Unanswered marketing email alone does **not** create a supposed appointment. “Call me next month” becomes a reminder to arrange a time, not a fabricated booked slot. After a completed or missed call, require a disposition and one next action: scheduled callback, date-specific nurture reminder, awaiting response, not a fit or stopped. “No response” cannot leave an endless active task with no owner.

No-response email cadence: use **7–10 calendar days from actual provider acceptance of the preceding sequence email**, send only weekdays in permitted hours. Default target day8; if weekend, advance to the next weekday inside the window (e.g. Friday +8 = Saturday, so Monday/day10). Preview actual date and timezone before launch. Sender/recipient pause, health failure, capacity or opt-out always outranks the window; a delayed item is labeled held/rescheduled and is never forced out to meet day10. Reply ends the sequence. This timing does not delay responses to an active seller conversation, urgent alerts or agreed callbacks. Existing maximum two pilot touches remains unless owner deliberately changes it.

## 6. One email-response business number

Recommendation: one stable voice-capable business number for email-origin calls, routed into the existing CRM phone system. First verify whether an existing number can be dedicated without breaking its present purpose; buy only if needed through setup. A number per email domain or campaign is unnecessary initially. This is call attribution/routing, not email-reputation protection.

Number setup: provider number ID, E.164, purpose `email_marketing`, assigned routing policy, caller-ID permission, hours, owner/backup, timeout and business voicemail greeting. New dialer/marketing blast eligibility defaults off. Do not repurpose reserved Ads numbers or existing agent/company lines without an explicit impact review. Inbound called-number tag records source `email_program`; exact campaign/thread attribution requires a unique confirmed match or caller/agent confirmation, not assumption from one shared number.

Routing: known uniquely matched caller → responsible available agent; unknown/shared/blocked caller-ID → team intake with context as unknown; no answer → backup then business voicemail. Create one missed-call task/notification from the actual dialed agent-leg result, not parent-call completed status. Attach voicemail metadata and safely available recording to the conversation, keeping sensitive content in CRM. Keep a stable business caller ID for deliberate return calls; no automatic dialing. Incoming texts, if supported/enabled, go to the existing SMS inbox; providing a phone number never enables an automatic marketing SMS campaign.

The local CRM already contains number-purpose configuration, agent routing and missed-call handlers. Some existing handlers can send automatic SMS and trigger broad lead alerts. The email line must use an explicit purpose-aware branch and durable dedup so those side effects do not happen accidentally. Do not copy timeout callbacks using serverless `setTimeout`. Actual phone routing/account ownership must be verified before setting the line active.

Twilio supports incoming call webhooks and call-status callbacks, which are sufficient building blocks for routing and observed outcomes; correct agent-leg handling still needs local integration tests. [Voice webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks).

## 7. What success still depends on

These are launch inputs and operating disciplines, not reasons to add more software:

- **One narrow starting audience and one truthful reason to respond.** Record who the message is for, what concern/outcome it addresses, evidence, what SavingKC can actually offer and the one next step.
- **Human coverage and acknowledgment.** Enough staffed capacity to answer calls, accept handoffs and follow through; pause acquisition of new conversations when promised response work exceeds capacity.
- **A usable offer and proof.** Owner-approved explanation of how SavingKC helps, limitations and genuine proof permitted for use; no invented testimonials, financial capability or closing promises.
- **A short test-and-learning loop.** Compare a neutral control with context-aware copy on deduplicated comparable cohorts; pin versions/assignment, do not change many variables together. Measure conversations, qualified Opportunities, contracts and cost/human effort alongside complaints/opt-outs, not just reply rate. Small pilots are directional evidence, not statistically proven winners.
- **After-call outcomes.** Missed calls, not-now sellers, no-shows, wrong-person replies, closed conversations and later re-engagement all need a responsible owner and next action; email generation alone does not solve conversion.
- **Current source and operational truth.** Contact identity/permission, ability to receive replies, tested alert/calendar/phone routing, source freshness and stop/recovery behavior were already core requirements; they remain mandatory.

Setup adds an approved example library from the team's real style when available. Use fabricated examples until permission and redaction are established; no need to block design awaiting training materials. Do not reproduce proprietary training materials not supplied or authorized. Human reviewers judge everyday tone and whether the seller feels understood, not how many named techniques appear.

## 8. Results first, with explicit judgment

Accepted operating principle: Ernest wants the simplest approach that produces results, and expects Codex to challenge a plan when evidence shows a material problem. Agreement is not a success criterion. State known facts, assumptions and unknowns separately; explain a material problem and its consequence before the dependent action. Recommend a correction, pause or smaller reversible test according to the evidence. Do not treat every uncertainty as a blocker, or promise that every failure can be predicted.

The initial copy baseline is approved segment wording plus useful verified fields. AI can still handle classification, individual conversation replies and handoffs. Test additional first-touch personalization against that baseline only when it has a clear hypothesis, fixed cohorts/versions, an explicit cost limit and observable success/stop criteria. Use the existing T56 outcome and capacity checks. Prefer qualified conversations and Opportunities, then contracts and revenue as they mature; also account for complaints, opt-outs, spend and human effort. Do not promote a small-sample apparent winner as a proven improvement. Added complexity must earn its cost through meaningful outcomes.

Gmail clarification, checked 2026-09-12: Google supports campaigns using a shared mail-merge message with substituted recipient fields. This supports template reuse as a legitimate format; it does not guarantee inbox placement. [Google mail merge](https://support.google.com/mail/answer/12921167?hl=en). Gmail also says spam reports help it identify similar messages as spam, so content similarity can matter when it resembles reported spam. [Gmail spam reporting](https://support.google.com/mail/answer/1366858?hl=en).

Google's published sender guidance emphasizes wanted mail, authentication, sender reputation, complaints, unsubscribe handling and controlled sending volume. Its complete filtering weights are not public. [Google sender guidelines](https://support.google.com/mail/answer/81126). Neither identical wording nor AI uniqueness alone establishes delivery eligibility or inbox placement. Do not add random rewriting or text spinning to evade filters. Personalization must improve relevance or outcomes; provider/audience readiness and existing stop controls remain necessary regardless of copy mode.
