# ARI CRM — OVERNIGHT MISSION: NIGHT 5
# crm.savingkc.com — Ari Audit Engine + Ghost Protocol + Settings + Security
# Drop in project root alongside PROJECT_BRIEF.md, paste as Claude Code prompt

---

You are running the fifth autonomous overnight mission on crm.savingkc.com.

Night 1: Bug fixes. Night 2: Comms engine. Night 3: Pipeline gates + briefing. Night 4: Expanded view dossier + mail tracker + roles. 81 of 132 items resolved (61%).

Tonight is a big consolidation night. You're building Ari's audit/coaching brain, completing the Ghost Protocol, finishing Settings, adding the feedback system, system health dashboard, and security hardening. This should bring us to ~90%+ completion.

The owner is asleep. No one to ask. Read PROJECT_BRIEF.md and all four overnight logs. Work within the existing codebase.

**Gmail sync still OUT OF SCOPE. WebSocket still deferred.**

---

## RULES (Same every night)

1. Not a rebuild. Existing structure is the source of truth.
2. Do not reorganize, rename, or restyle.
3. Preserve all existing functionality.
4. Test globally across all pages.
5. Commit frequently with clear messages.
6. Log everything in OVERNIGHT_LOG_NIGHT5.md.
7. Blocked on external dependency → log it, skip it, move on.

---

## PHASE 0: Review (5-10 minutes)

1. Read all four overnight logs
2. Quick sanity check: pipeline gates working, briefing events generating, mail tracker functional, expanded view complete
3. Take stock of what's left in the spec — tonight's job is to close as many remaining gaps as possible
4. Start OVERNIGHT_LOG_NIGHT5.md

---

## PHASE 1: Ari Audit Engine — The Quality Control Brain

Night 3 built the briefing event system and daily stats table. Tonight you're adding the audit logic that makes Ari a true quality controller.

### AUD-01: Continuous Data Quality Checks
Build an audit function (callable via cron endpoint or manually) that scans for:
- Leads with logged calls but no disposition recorded (gap between calls table and dispositions)
- Leads stuck past their stage timeout SLA (connect to WRK-11 from Night 3)
- Follow-up tasks that are overdue (past due date, not completed)
- Leads that were advanced to a stage without meeting minimum requirements (shouldn't happen with gates, but check for any that slipped through before gates were built)
- Duplicate leads (same phone number or same address appearing on multiple lead records)
- Orphaned records (leads with no stage, contacts with no lead, tasks with no assignee)

For each finding, generate an Ari briefing event with appropriate priority and a specific, actionable description. Example: "Casey logged 47 calls yesterday but only 31 have dispositions — 16 calls missing outcomes."

Store audit results in an `ari_audit_findings` table: id, audit_type, severity, description, lead_id (nullable), agent_id (nullable), created_at, resolved (boolean), resolved_at.

### AUD-02: Agent Scorecard
Build the scorecard generation function using the `agent_daily_stats` table from Night 3:
- Daily scorecard: calls_made, meaningful_conversations, disposition_rate (dispositions/calls), followup_completion_rate (on_time/total), pillar_capture_rate (leads with all 4 pillars / contacted leads), leads_advanced
- Weekly scorecard: same metrics aggregated for the week, plus trend arrows comparing to prior week (↑ improving, → flat, ↓ declining)
- Compare each metric against the role KPI targets from Night 4's ROL-02/ROL-03

Build an API endpoint that returns the scorecard for a given agent and period (daily/weekly).

Add a scorecard display component:
- Visible on the dashboard for the agent themselves
- Visible to Owner/Operator for all agents
- Each metric shows: current value, target, percentage of target, trend arrow
- Color code: green (≥90% of target), amber (60-89%), red (<60%)

### AUD-03: Workflow Compliance Checker
Build a compliance check function that verifies every active lead is following its prescribed workflow:
- Lead in Stage 4 (Offer Made) but deal math card not completed → flag
- Lead in Stage 2 (Contacted) for 10+ days with no follow-up task created → flag
- Lead marked Qualified but missing one or more pillars → flag (should be caught by gates, but belt-and-suspenders)
- Ghost Protocol triggered but Phase 1 actions not started → flag
- Follow-up sequence assigned but no tasks created → flag

Each violation generates a specific Ari briefing event. Not vague — actionable: "Lead John Smith is in Offer Made but has no deal math — complete the calculator before sending."

### AUD-04: System Accuracy Verification
Build a spot-check function using the system_workers table from Night 4:
- Check each worker's last_run and last_success timestamps
- If a worker hasn't run in 2x its expected interval, mark as degraded
- If it hasn't run in 4x, mark as down
- Generate Ari briefing event for degraded/down workers: "⚠️ Mojo Sync hasn't run in 45 minutes (expected every 15) — check connection"
- Check data freshness: any leads with county data older than 30 days? Flag for refresh.
- Check skip trace freshness: any leads with skip trace data older than 90 days? Flag for re-skip.

### AUD-05: Accountability Timeline
On the expanded lead view, add an "Accountability" or "Expected vs Actual" section:
- Show a visual timeline of what SHOULD have happened (per the lead's follow-up sequence and stage cadence) vs what ACTUALLY happened
- Green checkmark: action completed on time
- Amber clock: action completed late
- Red X: action missed entirely
- Data source: follow_up_executions, tasks (completed/missed), stage_transitions, communication records
- This tells Ernest exactly where the process broke down on any lead

### AUD-06: Coaching Nudges
Build a nudge generation function that detects patterns and creates coaching briefing events:
- If an agent's disposition rate drops below 80% for 2+ consecutive days: "Casey, your disposition logging has been at [X]% for 2 days. Every call needs an outcome — it's how Ari knows what to do next."
- If meaningful conversation rate drops below 5%: "Your connect rate is low this week. Consider [suggestion based on data — e.g., prioritizing mobile numbers, calling during different hours, trying tax-delinquent leads first]."
- If follow-up completion rate drops below 80%: "You have [X] overdue follow-ups. Knock those out before starting new cold calls — warm leads cool fast."
- If a specific lead has had 3+ missed follow-ups: "John Smith has been missed 3 times. Either connect or move to Dead/Nurture — don't let leads sit in limbo."

Nudges should be generated at most once per day per pattern (don't spam the same message). Store in an `ari_nudges` table: id, agent_id, nudge_type, message, created_at, acknowledged (boolean).

---

## PHASE 2: Ghost Protocol — Full Build

Night 2 built the Ghost Protocol foundation (data model, detection, Phase 1 enrollment). Tonight, complete the full 3-phase automation.

### GHP-02: Phase 1 Actions (Days 1-7)
Verify and strengthen the Phase 1 sequence from Night 2:
- Day 1: SMS auto-sent (casual check-in, no pressure). Use a template: "Hey {first_name}, just checking in — still thinking about the property on {address}?"
- Day 3: Email queued (value-add, market context). Template: subject "Quick update on {neighborhood}" with a brief market note.
- Day 5: Voicemail drop flagged/task created (warm, personal, reference previous conversation). Since auto voicemail-drop may not be wired to Twilio yet, create a task: "Leave voicemail for {name} — reference your conversation about {topic}."
- Day 7: Handwritten note queued in mail tracker (MNT-01 from Night 4). Auto-create a mail_pieces record with status "queued."

### GHP-03: Phase 2 Actions (Days 8-21)
Add Phase 2 to the ghost protocol sequence:
- Day 10: SMS — different angle. Template: "Hey {first_name}, no hard feelings either way — just want to make sure you know your options. Feel free to reach out anytime."
- Day 14: Voicemail task — mention specific benefit or reference a comp sale. Task: "Strategic voicemail for {name} — mention the recent sale at {comp_address} for {comp_price}."
- Day 18: Second handwritten note queued in mail tracker.
- Day 21: Final SMS. Template: "Hi {first_name}, just wanted you to know the door is always open. If anything changes with {address}, my direct line is {phone}. — Ernest"

### GHP-04: Phase 3 — Long Nurture (Day 22+)
When Phase 2 completes without response:
- Move ghost protocol status to Phase 3
- Set next touchpoints: Day 52 (30 days later), Day 82 (60 days), Day 112 (90 days)
- Each touchpoint: SMS or handwritten note (alternate)
- Quarterly handwritten note auto-queued
- Monitor for trigger events: if any of these conditions appear in the data for this lead's property, immediately escalate and generate CRITICAL Ari briefing event:
  - New tax delinquency in county data
  - Pre-foreclosure filing
  - Ownership change
  - Code violation
- If trigger event detected, move lead back to Stage 1 (New) with a "Recycled — trigger event" source tag

### GHP-05: Ghost Protocol Dashboard Widget
Add a ghost protocol summary to the dashboard:
- Count of leads in Phase 1 / Phase 2 / Phase 3
- Click each count to filter the leads list to those leads
- Recovery rate: leads that re-engaged from ghost protocol / total enrolled

### GHP-06: Ghost Protocol Controls
- On the expanded lead view, if a lead is in ghost protocol, show the current phase and next scheduled action
- "Pause Protocol" button — requires a reason (traveling, hospitalization, family situation, other). Pauses all scheduled actions. Logged.
- "Resume Protocol" button — picks up where it left off
- "Cancel Protocol" button — removes from ghost protocol, requires reason. Lead stays in current stage.
- All pause/resume/cancel actions logged in lead activity timeline

---

## PHASE 3: Settings Completion + Feedback System

### SET-03: Forwarding Number + Assigned Number
- In the agent profile/settings page, add fields for:
  - Assigned Twilio number (dropdown of available Twilio numbers, or manual entry)
  - Forwarding number (personal number for call forwarding during off-hours)
- Store in user_settings or the user model

### SET-04: Forwarding Email + Assigned Email
- Assigned email (the email address shown on outbound communications)
- Forwarding email (personal email for notifications)

### SET-05: Notification Preferences
- Toggle switches for notification channels: SMS notifications (on/off), Email notifications (on/off), In-app notifications (on/off — this is the Ari briefing, always on by default)
- Notification types: New lead alert, Missed call alert, Contract event, Follow-up reminder, Ari coaching nudge, System alert
- Each type can be enabled/disabled per channel

### SET-06: Office Hours
- Set start time and end time for each day of the week (or a single schedule for all weekdays)
- Default: Mon-Fri 8:00 AM - 5:00 PM CT
- Office hours should be referenced by: morning briefing trigger (RHY-01), missed call follow-up scheduling (MCF-06), Mojo polling window

### SET-07: Voicemail Setup
- Voicemail greeting text (what the agent wants to say — stored for reference, actual Twilio voicemail config is external)
- Voicemail transcription toggle (on/off — for when Twilio transcription is connected)
- After-hours behavior: send to voicemail / send SMS auto-response / both

### FBK-01: Feedback Submission Form
Add a "Report Issue / Request Feature" form accessible from Settings:
- Type: Bug Report / Feature Request / Feedback
- Section: dropdown of CRM sections (Leads, Pipeline, Conversations, Calendar, Dashboard, Ari, Settings, Other)
- Description: free text
- Priority: Low / Medium / High / Critical (agent's assessment)
- Auto-capture (no agent input needed): current page URL, timestamp, agent name/ID, browser user agent
- Optional: screenshot upload
- Submit → creates a record in `feedback_submissions` table

### FBK-02: Auto Error Logging
- Add a global error boundary (React ErrorBoundary) that catches unhandled frontend errors
- Add an API interceptor that catches failed API calls (4xx, 5xx, timeouts)
- For each error, auto-create an `error_log` record: id, error_type (frontend_crash/api_failure/timeout), message, stack_trace, page_url, agent_id, timestamp, request_details (for API errors), resolved (boolean)
- No agent action required — this runs silently

### FBK-03: Combined Log Table
- In Settings, add a "Feedback & Errors" tab/section
- Display a combined table of feedback_submissions + error_log
- Columns: ID, Type (Bug/Feature/Feedback/Error), Section, Description, Priority, Status, Date, Submitted By
- Sortable and filterable by any column
- Default sort: most recent first

### FBK-04: Status Workflow
- Each feedback/error item has a status: Open → Acknowledged → In Progress → Testing → Resolved → Closed
- Status editable by Owner role only
- When status changes, if the original submitter has notifications enabled, notify them
- Optional comment thread per item (simple — agent can add a note, owner can reply)

---

## PHASE 4: System Health Dashboard

### FBK-05: Visual Health Dashboard
Add a "System Health" tab in Settings:
- **Feature completion ring:** X of 132 items complete (pull from a config or hard-code current count — Ernest will update)
- **Open bugs count** (from feedback_submissions where type=bug and status≠resolved)
- **Error rate trend:** chart showing error_log count per day for last 14 days
- **Worker status cards:** pull from system_workers table (Night 4) — show each worker with status dot (green/amber/red), last run time, failure count

### FBK-06: Goal Tracker
Display configurable goals as progress bars or rings:
- "CRM Feature Completion: X/132 (Y%)" — progress ring
- "Open Bugs: X → Target: 0" — bar showing progress toward zero
- "Disposition Rate: X% → Target: 100%" — pull from agent_daily_stats
- Color code: green (on track), amber (behind), red (critical)
- Goals should be configurable (stored in DB or config file)

### FBK-07: Sprint Burndown
- If sprint tracking data exists, show items completed over time vs planned pace
- If not, show a simple "items resolved this week" bar chart from commit/change history
- Can be a simple visualization — doesn't need to be complex

### FBK-08: Module Health Cards
For each CRM section (Leads, Pipeline, Conversations, Calendar, Dashboard, Ari, Settings, Integrations):
- Show: feature count (done/total for that module), open bug count, last error timestamp, status dot
- Tap a card for detail (list of items in that module)
- Derive from feedback_submissions and error_log grouped by section

### FBK-09: Weekly Digest Hook
- Build the function that generates a weekly system health summary: items shipped, bugs resolved, new bugs, worker health, error trend
- Connect to RHY-03 (weekly review from Night 3) — the weekly review should include system health alongside pipeline and financial data
- Store in weekly_reviews table

### FBK-10: Agent-Facing Status Page
- Separate from the admin System Health view
- Agents see a clean, simple page with three sections:
  - **Known Issues:** active bugs from feedback_submissions that affect agent workflow (status = Open or In Progress)
  - **Coming Soon:** features in progress (status = In Progress or Testing)
  - **Recently Shipped:** items resolved in the last 14 days
- No stack traces, no error rates — just what matters to the person using the CRM

---

## PHASE 5: Security Hardening

### SEC-01: API Endpoint Audit
- Scan every API route in the application
- Verify each route checks for authentication (session/token)
- Any route that is publicly accessible and shouldn't be → add auth check
- Log every route you audit and its status (secured/was-open-now-fixed/intentionally-public) in the overnight log
- Intentionally public routes: webhook endpoints (Twilio inbound, website form), health check

### SEC-02: Rate Limiting
- Add rate limiting middleware to all public-facing endpoints:
  - API routes: 100 requests per minute per IP (general)
  - Auth routes (login): 10 attempts per minute per IP
  - Webhook endpoints: 60 per minute per source
- Use whatever rate limiting approach fits the existing framework (in-memory for now, Redis if already available)

### SEC-03: Input Validation
- Add server-side validation on all form submissions:
  - Lead creation: validate required fields, sanitize text inputs
  - Disposition logging: validate against allowed disposition values
  - Feedback submission: validate type, sanitize description
  - Settings updates: validate email format, phone format, time format
- Use Zod if the project already uses it, or the validation approach already in the codebase
- Reject invalid input with clear error messages

---

## OVERNIGHT_LOG_NIGHT5.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 5
## Date: [today's date]
## Started: [time]

---

## Night 1-4 Review
[Quick state check]

---

## Phase 1: Ari Audit Engine
### AUD-01 through AUD-06
[format per item]

---

## Phase 2: Ghost Protocol Full Build
### GHP-02 through GHP-06
[format per item]

---

## Phase 3: Settings + Feedback
### SET-03 through SET-07, FBK-01 through FBK-04
[format per item]

---

## Phase 4: System Health Dashboard
### FBK-05 through FBK-10
[format per item]

---

## Phase 5: Security
### SEC-01 through SEC-03
[format per item]

---

## Blocked Items
[External dependencies]

---

## Summary
- **Ari audit items:** X / 6
- **Ghost protocol items:** X / 5
- **Settings items:** X / 5
- **Feedback items:** X / 4
- **System health items:** X / 6
- **Security items:** X / 3
- **Total items this night:** X / 29
- **Commits made:** X
- **Overall spec completion:** ~X / 132
- **Completed at:** [time]

## What Remains After Tonight
[List everything still open — should be very short: Gmail sync, Mercury API, dashboard backfill, Ari Anthropic API integration, WebSocket, and enterprise QA]
```

---

## GO

This is the biggest night yet — 29 items across 5 phases. Ari gets her audit brain. Ghost Protocol goes fully autonomous. Settings becomes complete. The feedback loop closes. Security hardens.

After tonight, the only major items left should be: Gmail 2-way sync (waiting on OAuth), Mercury API (waiting on credentials), Google Sheet backfill, Ari's Anthropic API intelligence, WebSocket infrastructure, and the final enterprise QA sweep.

That means Night 6 could be the last build night, with Night 7 as pure QA.

Make it count. This is the night Ari becomes fully operational.
