# ARI CRM — OVERNIGHT MISSION: NIGHT 3
# crm.savingkc.com — Pipeline Stage Logic + Ari Intelligence
# Drop this in the project root alongside PROJECT_BRIEF.md, paste as your Claude Code prompt

---

You are running the third autonomous overnight mission on crm.savingkc.com.

Night 1: 13 bugs fixed, 5 enhancements, 4 new features. Night 2: 5 backlog items, full missed call flow, follow-up engine, comm sync. 42 of 132 items resolved (32%). Tonight you're building the pipeline brain and making Ari proactive.

The owner is asleep. No one to ask. Read PROJECT_BRIEF.md and both overnight logs before starting. Work within the existing codebase. Make decisions independently.

**Gmail sync remains OUT OF SCOPE. WebSocket infrastructure is deferred — use polling or event-driven DB patterns where real-time is needed.**

---

## RULES (Same as every night)

1. Not a rebuild. Work within existing structure and patterns.
2. Do not reorganize, rename, or restyle.
3. Preserve all existing functionality.
4. Test globally — every change verified across all pages where it appears.
5. Commit frequently with clear messages.
6. Log everything in OVERNIGHT_LOG_NIGHT3.md.
7. If blocked on external dependency, log it, skip it, move on.

---

## PHASE 0: Review (5-10 minutes)

1. Read OVERNIGHT_LOG.md and OVERNIGHT_LOG_NIGHT2.md
2. Verify Night 2's work is clean — missed call flow, follow-up engine, ghost protocol foundation all functional
3. Note the current state of the pipeline/stage view, the Ari briefing component, and the EOD modal
4. Start OVERNIGHT_LOG_NIGHT3.md

---

## PHASE 1: 8-Stage Pipeline Logic with Gates

The pipeline/stage view already exists. Tonight you're reinforcing it with formal stage definitions, minimum requirements (gates), auto-triggers, and transition logging. A lead cannot advance to the next stage unless it meets the minimum requirements. Ari enforces this.

### WRK-01: Stage State Machine
- Every lead MUST have exactly one stage at all times. No lead can exist without a stage.
- If any leads in the database currently lack a stage, assign them to Stage 1 (New) as a migration.
- Add a `current_stage` field to the lead model if not already present, with a NOT NULL constraint.

### WRK-02: Stage 1 — NEW
- **Auto-assigned** on any lead creation event (website form, cold call import, skip trace, missed call auto-create from Night 2's MCF-03).
- **Minimum requirements:** Name OR address, at least 1 phone number or property address, source tagged (website/cold_call/skip_trace/referral/driving_for_dollars/other).
- **Auto-actions on entry:** If phone is missing, flag for skip trace. Queue for first contact attempt (create initial follow-up task using Night 2's follow-up engine).
- Implement the requirement check as a validation function that returns { valid: boolean, missing: string[] }.

### WRK-03: Stage 2 — CONTACTED
- **Trigger:** Agent logs disposition as "spoke_with_owner" OR lead responds to SMS/email.
- **Minimum requirements:** Confirmed ownership (boolean), confirmed property address, initial motivation level captured (1-10 scale or text note).
- **Gate:** Cannot advance from Stage 1 to Stage 2 without at least one successful contact. Leaving a voicemail does NOT qualify.

### WRK-04: Stage 3 — QUALIFIED
- **Trigger:** All 4 qualification pillars are captured.
- **The 4 Pillars (all required):**
  - TIMELINE — When do they need to sell? (date or timeframe)
  - CONDITION — Property physical condition (description or rating)
  - MOTIVATION — Why selling and urgency level (1-10)
  - PRICE — Asking price or price flexibility (number or text)
- **Gate:** HARD GATE. Cannot advance to Stage 3 without ALL 4 pillars filled. The system must reject the advancement and tell the agent exactly which pillars are missing.
- Connect this to the Critical Info Missing banner (CIM-01) from Night 1 — that banner should reflect these same 4 pillars.

### WRK-05: Stage 4 — OFFER MADE
- **Trigger:** Contract/offer sent (via DocuSeal or manual entry if DocuSeal isn't connected yet).
- **Minimum requirements:** MAO calculated (deal math card completed), offer amount logged, offer document reference.
- **Auto-action:** Lead automatically appears on Hot Opportunities board. Connect to HOT-01/HOT-02 that were fixed on Night 1.

### WRK-06: Stage 5 — UNDER CONTRACT
- **Trigger:** Signed purchase agreement recorded.
- **Minimum requirements:** Signed contract reference on file, earnest money status (paid/pending/waived), inspection period end date, closing date set.
- **Monitoring:** Flag if inspection deadline is within 48 hours. Flag if closing date is within 7 days.

### WRK-07: Stage 6 — DISPOSITION (WHOLESALE)
- **Trigger:** Buyer matched and assignment contract initiated.
- **Minimum requirements:** Buyer name/info, assignment fee amount, title company assigned.

### WRK-08: Stage 7 — CLOSED
- **Trigger:** Closing confirmed.
- **Minimum requirements:** Settlement statement reference uploaded, revenue amount logged, all docs archived flag.
- **Auto-actions:** Update dashboard "Days Since Last Closing" metric to 0. Log revenue event for financial tracking.

### WRK-09: Stage 8 — DEAD / NURTURE
- **Trigger:** Agent manually marks dead OR system detects max contact attempts with no response.
- **Minimum requirements:** Disposition reason logged (why dead — not interested, wrong number, property sold, can't reach, other).
- **Auto-action:** Enroll in dead lead recycler queue (90-day and 180-day re-evaluation). Connect to Ghost Protocol foundation from Night 2.
- **Visibility:** Hidden from default pipeline view. Accessible via filter or dedicated "Dead/Nurture" tab.

### WRK-10: Stage Transition Logging
- Every stage change creates a record: lead_id, from_stage, to_stage, timestamp, changed_by (agent ID or "system"), reason, method (manual_advance / auto_trigger / agent_override).
- Build a `stage_transitions` table if it doesn't exist.
- Display transition history on the lead's expanded view activity timeline.
- Backward movement allowed (e.g., Qualified back to Contacted) but requires a reason and is logged as a notable event.

### WRK-11: Stage Timeout Alerts
Create a function (or cron-ready query) that checks for leads sitting too long in a stage:
- Stage 1 (New): > 48 hours with no contact attempt
- Stage 2 (Contacted): > 7 days with no follow-up or advancement
- Stage 3 (Qualified): > 5 days with no offer action
- Stage 4 (Offer Made): > 72 hours with no response
- Stage 5 (Under Contract): approaching inspection or closing deadline
- Generate an alert/task when timeout threshold is exceeded.
- Connect to Ari briefing (Phase 2 tonight) if possible, otherwise log as activity.

### Implementation Notes:
- The stage advancement UI should work with the existing pipeline/stage view. When an agent drags a card or clicks to advance, the system checks requirements. If requirements aren't met, show a modal/toast listing what's missing. Do NOT silently block — tell the agent what they need.
- Add a `stage_requirements` config (can be a JSON config file or DB table) so requirements are adjustable without code changes.
- Run a migration to ensure all existing leads have a valid stage.

---

## PHASE 2: Ari Briefing Engine — Proactive Intelligence

The Ari briefing component exists. Tonight you're making it proactive — it should surface what matters without being asked.

### ARI-01: Event-Driven Briefing Updates
Since WebSocket is deferred, implement event-driven briefing via the database:
- Create an `ari_briefing_events` table: id, event_type, priority (critical/high/medium/low), title, description, lead_id (nullable), action_url (deep link), created_at, read (boolean), dismissed (boolean).
- When meaningful events occur throughout the system, insert a briefing event:
  - New inbound lead (from website form, missed call auto-create)
  - Incoming call / SMS / email to a known lead
  - Lead stage change
  - Contract sent / viewed / signed / expired
  - Missed call with auto text-back sent
  - Follow-up task overdue
  - Ghost protocol enrollment
  - Stage timeout alert (from WRK-11)
  - EOD submission
  - System worker failure (if monitoring exists)
- The briefing component should poll for new events on a short interval (15-30 seconds) or refresh on page navigation.

### ARI-02: Priority Stacking
- Briefing events display in priority order: Critical at top, Low at bottom.
- Within same priority, most recent first.
- Show max 5-6 visible events before scroll.
- Priority mapping:
  - **Critical:** New inbound lead, contract event (signed/expired), closing event, system failure
  - **High:** Incoming communication from lead, missed call, offer response, temperature spike (Hot↔Cold)
  - **Medium:** EOD submitted, follow-up overdue, stage timeout, ghost protocol action
  - **Low:** Routine sync complete, metric update, system status

### ARI-03: Actionable Deep Links
Every briefing event that references a lead must include an action_url that navigates directly to:
- The lead's expanded view (for lead-specific events)
- The conversation thread (for communication events)
- The calendar (for task/appointment events)
- The deal detail (for contract/offer events)
Tapping a briefing event takes the agent straight to the relevant record. One tap to context.

### ARI-04: Pattern Analysis Preparation
Full Anthropic API-powered pattern analysis is a bigger build, but lay the foundation tonight:
- Create a function that aggregates agent activity data for a given period: call count, meaningful conversation count, disposition breakdown, follow-up completion rate, stage advancements.
- Store daily summaries in an `agent_daily_stats` table: agent_id, date, calls_made, meaningful_conversations, dispositions_logged, followups_completed, followups_missed, leads_advanced, leads_stagnant.
- The Ari briefing component should display a daily stats card from this data.
- Log where the Anthropic API call would go (system prompt, data payload format) for Night 5's intelligence build.

---

## PHASE 3: EOD Enhancement + Operating Rhythm Foundation

### EOD-02: EOD Triggers Mojo Refresh
When Casey submits EOD:
- Trigger a refresh of Mojo metrics (connect to Night 2's dynamic Mojo KPI work)
- The EOD submission should also insert an Ari briefing event (from Phase 2 tonight)
- If Mojo API polling is on a timer, force an immediate poll on EOD submit

### RHY-01: Morning Briefing Data
Build the query/function that assembles the morning briefing payload:
- Today's scheduled callbacks (from task system)
- Overdue follow-ups (tasks past due date)
- Leads requiring attention (stage timeouts from WRK-11, temperature changes)
- Handwritten notes estimated to arrive today (from mail tracking if built, otherwise skip)
- Pipeline summary: count of leads per stage
- Yesterday's agent stats (from ARI-04's daily stats table)

Create an API endpoint or server function that returns this data. The briefing component can call it on first load of the day. If office hours are configured (from SET-06), only generate after office hours start.

### RHY-02: EOD Reconciliation Data
Build the query/function that compares planned vs accomplished:
- Tasks that were due today: how many completed, how many missed
- Follow-up sequences that should have advanced: did they?
- Dispositions logged vs calls made (gap = calls without outcomes)
- Leads that should have been contacted (per schedule) — were they?

Create an API endpoint that returns this comparison. The EOD modal should display it when Casey opens EOD, and it should be logged as the day's reconciliation record.

### RHY-03: Weekly Review Data
Build the query/function for Ernest's Friday review:
- Pipeline health: leads per stage, net movement this week, stagnation flags
- Agent scorecard: all KPIs for the week with trend vs prior week
- Active deal math: all Stage 4+ leads with MAO, offer amount, status
- Revenue/expense summary (whatever financial data exists in the system)
- System health: error count, worker status, uptime
- Auto-generate top 3 priorities for next week based on: highest-value stagnant leads, most overdue follow-ups, worst-performing metrics

Store weekly reviews in a `weekly_reviews` table. Create the endpoint. The UI for displaying it can come later — the data assembly is the hard part.

---

## PHASE 4: Disposition System Enhancement

### DSP-01 Enhancement: Enforce Disposition Logging
Night 1 built the disposition system. Tonight, enforce it:
- After every completed call (outbound or inbound that was answered), the system should require a disposition before the agent can navigate away or start another call.
- If the agent tries to close the call modal or navigate to another lead without logging a disposition, show a blocking prompt: "Log the outcome of this call before continuing."
- Track disposition compliance rate: dispositions logged / calls completed. Store in agent_daily_stats.

### CIM-02: Ari References Missing Pillars
Connect the Critical Info Missing banner to Ari's briefing:
- When an agent has a scheduled callback with a lead, Ari's briefing event for that callback should include which pillars are still missing: "Callback with John Smith at 2pm — still need: TIMELINE, PRICE"
- The briefing event description field should list the missing pillars.
- This requires reading the lead's pillar completion status when generating callback briefing events.

---

## OVERNIGHT_LOG_NIGHT3.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 3
## Date: [today's date]
## Started: [time]

---

## Night 1-2 Review
- Current state: [summary of what's working]
- Any issues found from prior nights: [list or none]

---

## Phase 1: Pipeline Stage Logic

### WRK-01: Stage State Machine
- **Implementation:** [what you built]
- **Migration:** [how existing leads were handled]
- **Files modified:** [list]
- **Status:** ✅ / ⚠️ / ❌

[Repeat for WRK-02 through WRK-11]

---

## Phase 2: Ari Briefing Engine

### ARI-01: Event-Driven Briefing
[same format]

[Repeat for ARI-02 through ARI-04]

---

## Phase 3: Operating Rhythm

### EOD-02: EOD Triggers Refresh
[same format]

### RHY-01: Morning Briefing Data
[same format]

### RHY-02: EOD Reconciliation
[same format]

### RHY-03: Weekly Review
[same format]

---

## Phase 4: Disposition & Pillar Enhancement

### DSP-01 Enhancement: Enforce Logging
[same format]

### CIM-02: Ari References Missing Pillars
[same format]

---

## Blocked Items
[External dependencies needed]

---

## Findings & Recommendations
[What Ernest should know. What Night 4 should target.]

---

## Summary
- **Pipeline stage items:** X / 11
- **Ari briefing items:** X / 4
- **Operating rhythm items:** X / 4
- **Disposition/pillar items:** X / 2
- **Blocked items:** X
- **Commits made:** X
- **Completed at:** [time]

## What Night 4 Should Target
[Recommendation based on codebase state]
```

---

## GO

Phase 0 (review). Phase 1 (pipeline gates — the spine of the CRM). Phase 2 (Ari briefing — make her proactive). Phase 3 (operating rhythm — morning/EOD/weekly). Phase 4 (disposition enforcement + pillar coaching).

Tonight is the night Ari becomes the Chief of Staff. The pipeline gets its rules. The operating rhythm starts running. When Ernest opens the CRM tomorrow morning, Ari should have something to say.

Make it count.
