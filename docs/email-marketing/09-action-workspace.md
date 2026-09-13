# Action workspace, revision 1.3

Approved by Ernest after reviewing the September 12 inbox screenshots. This supersedes the overlapping queues and passive callback card in revision 1.2. It is a local implementation checkpoint; production integrations remain unfinished.

## Agent workspace

Keep Inbox, Campaigns and More in the white/red/grey theme. The inbox has a conversation list, selected conversation, and a Details column that starts expanded for each selected conversation. The column has distinct labeled icon tabs: Contact, Property, Follow-ups, Notes, and Ari’s Insights. Show one tab panel at a time; preserve unsaved notes and task entries between tabs. Arrow keys, Home and End move between tabs. On narrow screens Details becomes a fixed panel; Escape closes it and restores focus. Each panel scrolls independently beneath the visible tab strip. Long message history must not push the composer down the page.

Ari’s Insights currently presents the saved next step, seller reply and available practice suggestion, with a clear notice that live AI insights are not connected. Open follow-up selects that tab; Edit this reply transfers the exact suggestion to the composer. Do not invent seller motivation, property intelligence or model-generated findings.

Show one primary queue per conversation, evaluated against the server's displayed time:

| Queue | Meaning |
| --- | --- |
| To do | New reply, unscheduled callback, due follow-up, manual reply work or unresolved CRM issue. The row and selected panel state the actual next action. |
| Waiting on seller | An outbound message was accepted and no current human task is due. |
| Scheduled | A future manual follow-up or queued email. Each row identifies which and the details distinguish internal reminders from appointments. |
| Done | Finished conversations or stopped marketing with no unresolved work. |
| All | Every conversation the actor can access, subject to search, owner and campaign filters. |

Unsubscribed is an independent restriction filter. A stopped conversation with an unresolved callback hold remains To do: sending stays stopped while the team resolves the task. Keep the selected conversation and typed draft open when a new reply moves it to a different queue. There are no separate Needs action and Needs review tabs.

## Next action and prepared reply

Replace the large status grid with a compact next-action panel showing owner, actual requested timing/due time, and the available action. Place prepared response text beside its approval/edit controls. Do not repeat an empty composer when a suggestion exists; Write a reply or Edit reply opens it. Preserve typed text on new inbound, but prevent saving/sending until the agent reviews the new content. Sending compares exact draft body hash, content revision and controller revision. Only one human reply can remain queued for a thread.

The present preview uses a deliberately narrow deterministic practice helper, labeled **Practice suggestion · Live AI is not connected**. It is not model inference or an evaluation runner. It recognizes a direct phone reply/call request to the supported seller outreach and ignores quoted history, common signatures, third-party numbers and common negative wording. Unrecognized messages require human composition. Never treat these heuristics as sufficient production lead qualification.

Create Lead & callback is an explicit human acceptance of the displayed contact details and current reply context. It invokes the existing canonical CRM bridge, preserves first-touch attribution and an existing Opportunity, rechecks person/property/owner evidence, stops sequence work, and creates the governed callback task. It uses configured acquisitions routing, with the current practice actor and another eligible member as the local fallback. A raw number alone is not a production automatic promotion rule. There are no website SMS, Ads conversion, dialing or calendar-invite side effects. Automatic intent detection, shared web-intake policy and external alerts still require implementation and verification.

## History and Details

History shows sender → recipient, received/sent state and time. Initially show the last three messages; earlier history expands inside the scroll region. Quoted email history collapses within its message. Distinct stored messages stay distinct, even when their bodies are identical; provider message deduplication belongs to ingestion.

Details includes:

- Contact, evidenced phone, assigned agent, backup and actual CRM stage.
- A single confirmed owner property's address and available facts; missing facts say Unknown. Multiple/unconfirmed matches do not receive guessed details. Practice properties have no Street View; real matched addresses can open a map to choose Street View. Embedded imagery is pending.
- Current callback review deadline or manually scheduled follow-up, plus the seller's original timing. Calendar explicitly remains unconnected.
- Save follow-up: current task owner selects a future weekday Chicago time at or after 8:30 AM. Update the canonical activity and verify its work-item projection atomically. Require current content and handoff revisions, current CRM/task ownership, and no pending repair/hold. No invitation is created.
- Complete callback: save a required outcome note, complete the canonical task, and mark the conversation Done. Preserve Lead stage; never qualify an Opportunity. Subsequent new inbound reopens work. A later unsubscribe must not resurrect a completed task.
- Add note: append to the canonical Lead history with server actor/time and idempotent receipt. Notes persist after refresh and unsubscribe. Notes before a Lead is linked remain unavailable.
- Source and stop-marketing controls under a disclosure. Existing owner-only repair retry remains visible when applicable.

Held callbacks cannot be silently completed, rescheduled or resumed. Projection failures roll back these new task mutations; unsubscribe continues to use the separate durable repair path. General reassignment, initial-handoff resolution, automatic scheduling, calendar availability, bookings and external notifications remain pending.

## Implementation and acceptance

New migration: `20260913010000_email_action_workspace.sql`, adding a handoff revision, manually scheduled timestamp and completed/done states. Apply only in disposable local databases during this checkpoint. Shared command addition THR-NOTE is owned by EM-013; manual HAN-SCHEDULE and HAN-OUTCOME behavior is owned by EM-024. The existing command schemas contain additional future variants; unavailable variants must fail closed.

Verification covers exclusive queues, conservative practice extraction, canonical notes, replay, current ownership, stale task/draft rejection, weekday/time boundaries, task projection rollback, stage preservation, completion followed by unsubscribe, and the browser flow with history scrolling and narrow-screen Details. See [current verification](local-verification.md) for measured results. Live AI, Resend, external team notifications, Google Calendar and authenticated CRM-shell verification remain separate unfinished work.
