# ARI CRM — OVERNIGHT MISSION: NIGHT 2
# crm.savingkc.com — Backlog Fixes + Communications Engine
# Drop this in the project root alongside PROJECT_BRIEF.md, paste as your Claude Code prompt

---

You are running the second autonomous overnight mission on crm.savingkc.com. Night 1 was a success — 13 bugs fixed, 5 enhancements shipped, 4 new features live. Tonight you're cleaning up what Night 1 left behind and building the communications engine.

The owner is going to sleep. There is no one to ask questions to. You must make decisions independently, work methodically, and leave a clean, working application.

**Read PROJECT_BRIEF.md first** if you haven't already. It contains the complete spec and Ari Doctrine.

**Read OVERNIGHT_LOG.md from Night 1** to understand what was already done, what patterns were used, and what decisions were made. Build on that work, don't redo it.

---

## RULES (Same as Night 1 — still apply)

1. **This is NOT a rebuild.** Work within the existing codebase, structure, and patterns.
2. **Do NOT reorganize, rename, or restyle** anything unless a specific item requires it.
3. **Preserve all existing functionality.** If it works, don't touch it.
4. **Test globally.** Every change verified across all pages where that component or data appears.
5. **Commit frequently.** One commit per logical unit of work. Clear messages.
6. **Log everything in OVERNIGHT_LOG_NIGHT2.md** — same format as Night 1. This is Ernest's morning briefing.
7. **If you hit an external dependency you can't resolve** (missing API key, unconfigured service), log it, skip it, move on. Don't get blocked.
8. **Gmail 2-way sync is OUT OF SCOPE tonight.** OAuth credentials are not yet configured. Skip EML-01, EML-02, EML-03 entirely. Do not attempt Gmail integration.

## CORRECTION FROM OWNER — READ THIS BEFORE TOUCHING SETTINGS

Night 1 created a new Settings nav tab — that was WRONG. There should be NO separate Settings tab in navigation.

**Correct behavior:**
- The gear icon already in the header should open the settings/profile panel
- Settings must be accessed via the gear icon only — NOT a nav item
- If a Settings nav item was added in Night 1, remove it from the navigation

**Profile photo (SET-02) — correct implementation:**
- Under the agent profile section, add a profile photo upload option
- The initials avatar in the top-right corner of the app should display the profile photo if one has been uploaded
- If no photo is uploaded, keep the initials as fallback
- Do NOT change the position or structure of the top-right avatar — only update what it renders (photo vs initials)

Fix this first in Phase 0 before anything else.

---

## PHASE 0: Quick Audit (5-10 minutes)

1. Review OVERNIGHT_LOG.md from Night 1 — understand what changed
2. Check the current state of the codebase — make sure Night 1's commits are clean
3. Verify the 4 items flagged as "needs verification": CAL-03 (month/week view state), CAL-04 (agenda click-to-property), LED-02 (Street View), LED-04 (letter tracking). If any are still broken, fix them in Phase 1.
4. Start OVERNIGHT_LOG_NIGHT2.md with your findings.

---

## PHASE 1: Fix the 5 Backlog Items

These were identified during Night 1 as incomplete. Fix all 5 before moving on.

### BKL-01: Calendar Tasks on Mock Data
The calendar is currently rendering from mock/dummy data instead of querying the real database. 
- Find where calendar tasks, appointments, and events are fetched
- Replace mock data with actual database queries
- Ensure tasks created elsewhere in the app (follow-ups, callbacks, appointments) appear on the calendar
- Test: create a task from a lead, verify it shows on the calendar

### BKL-02: Mojo KPI Hard-Coded Date
Dashboard Mojo metrics are using a hard-coded date instead of dynamic lookup.
- Find where Mojo KPI data is fetched/displayed on the dashboard
- Replace hard-coded date with dynamic current date lookup (today for daily, current week for weekly, current month for monthly)
- Ensure metrics refresh correctly when the dashboard loads
- Test: verify the metrics show current period data, not stale numbers

### BKL-03: Twilio Inbound SMS → Lead Activities
Incoming SMS messages from Twilio are not being logged to the lead_activities table.
- Find the Twilio inbound SMS webhook handler
- After processing the message, insert a record into lead_activities with: contact_id, type='sms_inbound', content, timestamp, phone_number
- Match the inbound number against existing leads/contacts
- Ensure the SMS appears in the conversation thread for that lead AND on the lead's activity timeline
- Test: simulate an inbound SMS, verify it appears in Conversations view AND on the lead's expanded view activity log

### BKL-04: Verify and Fix Night 1 Amber Items
Check these 4 items flagged from Night 1:
- **CAL-03:** Month view should not override week view when navigating to a non-current month
- **CAL-04:** Agenda view — should be able to click into the associated property and create new tasks
- **LED-02:** Google Street View should load on lead cards (if API key is configured; if not, log as blocked)
- **LED-04:** Letter tracking should be visible on leads (if the data model exists; if stubbed, implement basic tracking display)

### BKL-05: Ghost Protocol — Foundation
The full 3-phase Ghost Protocol is a big build. Tonight, lay the foundation:
- **Data model:** Create or extend the schema to track ghost protocol enrollments: lead_id, enrolled_date, current_phase (1/2/3), last_action_date, next_action_date, status (active/paused/completed/cancelled), pause_reason
- **Detection logic:** Write the query/function that identifies ghost protocol candidates: leads in Stage 2+ that had at least 1 successful conversation but have had no response to 2+ contact attempts over 7+ days
- **Enrollment:** When a lead matches ghost criteria, auto-enroll them and create the Phase 1 task sequence (SMS Day 1, Email Day 3, Voicemail Day 5, Note Day 7)
- **UI indicator:** Add a ghost protocol badge/status on the lead card so agents can see which leads are in the protocol
- Do NOT build the full Phase 2 and Phase 3 automation tonight — just Phase 1 enrollment and task creation. Log the remaining phases as next steps.

---

## PHASE 2: Missed Call Flow

Build the automated missed call handling system. This is critical — missed calls from motivated sellers need immediate response.

### MCF-01: Caller Identification
When a call comes in and is missed (Twilio webhook for missed/no-answer):
- Query the CRM database: does this phone number match any existing lead or contact?
- Query the raw skip trace data: does this number match any property owner in our data?
- Check Twilio Lookup API for spam score (if Twilio Lookup is configured; if not, skip spam check and log as needs-setup)
- Return the classification: known_lead, skip_trace_match, unknown_clean, or spam

### MCF-02: Known Lead Response
If the missed caller matches an existing lead:
- Bump the lead's priority/temperature
- Send an immediate SMS via Twilio: "Hey, this is [agent name] with Saving KC — I just missed your call. I'm available now if you'd like to try again, or I can call you back at a better time."
- Create a callback task due in 5 minutes
- Create an Ari briefing event (or activity log entry if briefing events aren't wired yet)
- Log the missed call in lead_activities

### MCF-03: Skip Trace Match Response
If the missed caller matches a phone number in skip trace data but is NOT yet a lead:
- Auto-create a new lead record from the skip trace data (name, address, property info)
- Assign to Stage 1 — New
- Send SMS: "Hey, I think you may have been trying to reach us about your property. I'd love to chat when you have a moment."
- Create a callback task
- Log everything in lead_activities

### MCF-04: Unknown Caller Response
If the number doesn't match anything and spam score is low (or spam check unavailable):
- Send generic SMS: "Thanks for calling Saving KC Homebuyers. Were you looking to sell a property?"
- Log the call with the phone number for manual review
- If they respond, route the response to the Conversations inbox for agent handling

### MCF-05: Spam Handling
If spam score is high:
- Log the call (number, timestamp, spam score)
- Do NOT send any response
- If the same number has been flagged 3+ times, add to a block list

### MCF-06: No Response Follow-Up
- If no response to the text-back within 2 hours, create a single callback task scheduled during office hours (use the office hours from agent settings if configured, otherwise default to 9am-5pm CT)
- Log the scheduled callback in lead_activities

### Implementation Notes:
- The Twilio missed call webhook endpoint may already exist from Night 1 work. If so, extend it. If not, create it.
- Use the existing SMS sending pattern from the app (find how outbound SMS is currently sent and follow the same approach)
- All of this should work with the existing Twilio numbers (19 numbers, 10DLC approved)
- If Twilio credentials/webhook URLs need configuration, log exactly what's needed in the overnight log

---

## PHASE 3: Multi-Channel Follow-Up Engine

Build the follow-up system that orchestrates across phone, SMS, email, and direct mail.

### FUP-01: Follow-Up Sequence Model
Create or extend the data model for follow-up sequences:
- **follow_up_sequences:** id, name, stage (which pipeline stage this applies to), steps (JSON array of sequence steps)
- **follow_up_steps:** sequence_id, step_number, channel (call/sms/email/voicemail/mail), delay_days, delay_hours, template_content, status
- **follow_up_executions:** id, lead_id, sequence_id, current_step, started_at, next_action_at, status (active/completed/paused/cancelled)

### FUP-02: Default Sequences
Seed the database with default follow-up sequences per stage:

**New Lead sequence:**
- Step 1: Call + SMS (Day 0, same day)
- Step 2: Email (Day 2)
- Step 3: Call (Day 3)
- Step 4: Handwritten note queued (Day 5)
- Step 5: Call (Day 7)

**Offer Made sequence:**
- Step 1: Call (Day 1)
- Step 2: SMS (Day 2)
- Step 3: Email (Day 3)
- Step 4: Call + Note (Day 5)

**Post-Disposition (No Answer) sequence:**
- Step 1: Retry call + SMS (24 hours)

**Post-Disposition (Left Voicemail) sequence:**
- Step 1: Retry call (48 hours)

**Post-Disposition (Not Interested) sequence:**
- Step 1: 90-day nurture check-in SMS

### FUP-03: Follow-Up Task Creation
When a lead enters a stage or receives a disposition:
- Look up the matching follow-up sequence
- Create a follow_up_execution record
- Generate the first task in the sequence with the correct channel, due date, and content
- When that task is completed (or its due date passes), auto-create the next task in the sequence
- If a new disposition is logged that changes the cadence (e.g., they answer and become "Spoke w/ Owner"), cancel the current sequence and start the appropriate new one

### FUP-04: Task Channel Display
Follow-up tasks should clearly display which channel they require:
- Show an icon for the channel: phone icon for calls, message icon for SMS, envelope for email, pencil for handwritten note
- Task card should show: lead name, channel, due date/time, template preview
- One-tap execution where possible: tap call task → initiates call, tap SMS task → opens compose with template pre-filled

### Implementation Notes:
- Connect this to the disposition system (DSP-01) that was built on Night 1 — dispositions should trigger the appropriate follow-up sequence
- Connect to the stage pipeline — stage changes should trigger the appropriate sequence
- If the task/activity system from Night 1 supports task types, extend it. If not, add a channel/type field to tasks.
- Don't over-engineer the automation runner tonight. It's fine if sequence advancement requires a cron job or manual trigger initially — log what's needed for full automation as a next step.

---

## PHASE 4: Communication Sync Hardening

Verify and strengthen that communications are truly synced everywhere.

### SYNC-01: Unified Communication Thread
For every contact, ensure there is ONE communication thread that includes:
- Outbound calls (from CRM)
- Inbound calls (from Twilio webhook)
- Outbound SMS (from CRM)
- Inbound SMS (from Twilio webhook — BKL-03)
- Outbound emails (from CRM)
- Missed calls (from MCF flow built tonight)
- Voicemail notifications
- System-generated messages (ghost protocol SMS, follow-up SMS)

All of these should appear in chronological order in:
- The Conversations/Inbox view
- The lead's expanded view activity timeline
- The Pipeline stage card (recent activity preview)

### SYNC-02: Real-Time Updates
If WebSocket infrastructure exists from Night 1, ensure new communications push to all open views immediately. If not, ensure that navigating to any view pulls the latest data (no stale cache showing old conversations).

### SYNC-03: Communication Search
Verify that the conversation search (CNV-03 autocomplete from Night 1) works against the full communication dataset — not just a subset.

---

## OVERNIGHT_LOG_NIGHT2.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 2
## Date: [today's date]
## Started: [time]

---

## Night 1 Review
- OVERNIGHT_LOG.md findings: [summary]
- Verification of amber items: CAL-03, CAL-04, LED-02, LED-04 — [status of each]
- Codebase state: [clean/issues found]

---

## Phase 1: Backlog Fixes

### BKL-01: Calendar Mock Data → Real DB
- **Root cause:** [what was using mocks]
- **Fix:** [what you changed]
- **Files modified:** [list]
- **Tested on:** [which pages/views]
- **Status:** ✅ Fixed / ⚠️ Partial / ❌ Blocked

### BKL-02: Mojo KPI Dynamic Date
[same format]

### BKL-03: Twilio Inbound SMS → Lead Activities
[same format]

### BKL-04: Night 1 Amber Verification
[same format per item]

### BKL-05: Ghost Protocol Foundation
[same format]

---

## Phase 2: Missed Call Flow

### MCF-01: Caller Identification
[same format]

### MCF-02: Known Lead Response
[same format]

[etc for MCF-03 through MCF-06]

---

## Phase 3: Follow-Up Engine

### FUP-01: Sequence Data Model
[same format]

[etc for FUP-02 through FUP-04]

---

## Phase 4: Communication Sync

### SYNC-01: Unified Thread
[same format]

[etc]

---

## Blocked Items
[Items that need external setup — API keys, OAuth, service config]

---

## Findings & Recommendations
[Anything Ernest should know — patterns found, architectural notes, quick wins for Night 3]

---

## Summary
- **Backlog items fixed:** X / 5
- **Missed Call Flow items:** X / 6
- **Follow-Up Engine items:** X / 4
- **Comm Sync items:** X / 3
- **Blocked items:** X
- **Commits made:** X
- **Completed at:** [time]

---

## What Night 3 Should Target
[Your recommendation for the next overnight run based on what you see in the codebase and spec]
```

---

## GO

Start with Phase 0 (review Night 1). Then Phase 1 (backlog). Then Phase 2 (missed call flow). Then Phase 3 (follow-up engine). Then Phase 4 (comm sync hardening). Work until everything is done or you've exhausted what can be done tonight.

**Skip Gmail sync entirely (no OAuth credentials yet).**

Leave OVERNIGHT_LOG_NIGHT2.md as your deliverable. The owner reviews in the morning.

Make it count. Night 1 set the bar — raise it.
