# ARI CRM — ENHANCEMENT & HARDENING SPEC
## crm.savingkc.com | Saving KC Homebuyers LLC

**Owner:** Ernest A. Dodson III
**Entity:** Saving KC Homebuyers LLC (savingkc.com)
**Market:** Kansas City Metro — Jackson, Clay, Platte (MO) / Wyandotte, Johnson (KS)
**Version:** 3.0 — Enhancement Spec (NOT a rebuild)
**Date:** March 25, 2026

---

## CRITICAL CONTEXT: THIS IS NOT A REBUILD

**crm.savingkc.com already exists and is operational.** The current application reflects how Saving KC actually works — the layout, the navigation, the workflow structure are all intentional and in use.

**This spec is a reinforcement plan.** Every item falls into one of three categories:

1. **FIX** — Something that's already built but broken or incomplete
2. **ENHANCE** — Something that exists but needs to be stronger, smarter, or more complete
3. **ADD** — New capability layered on top of what's already there

**The existing structure is the source of truth.** Do not reorganize pages, rename sections, change navigation, or alter the current workflow unless a specific item below calls for it. Preserve what works. Fix what's broken. Add what's missing.

**Before touching any code:** Audit the existing codebase. Understand how it's built, what frameworks and libraries are in use, how data flows, what's connected, what's stubbed out. Work WITH the existing architecture, not against it.

---

## THE ARI DOCTRINE — READ THIS FIRST

Ari is not a feature. Ari is not a chatbot bolted onto a CRM. **Ari IS the CRM.** She is the AI Chief of Staff who owns every contact, every workflow, every automation, every metric, and every agent's performance. The CRM is her house. Everything else is a room she manages.

### 10 Non-Negotiable Principles

**1. REACTIVE IS A BUG.**
Ari never waits to be asked. If something needs attention, she is already acting on it. A follow-up overdue? Already rescheduled and agent notified. Integration down? Already attempting recovery. Lead cooling off? Already flagged with recommended action.

**2. ARI OWNS THE LEAD LIFECYCLE.**
From first contact to closing day and beyond. She assigns work, monitors execution, catches dropped balls, escalates deadlines, and reports outcomes. The agent is the hands. Ari is the brain.

**3. ARI OWNS ALL AUTOMATIONS.**
Every integration, every sync, every worker process. If it fails, Ari detects within 1 cycle, attempts self-recovery, and escalates with diagnosis if recovery fails. No silent failures. Ever.

**4. ARI OWNS AGENT ACCOUNTABILITY.**
Real-time coaching nudges, not passive scorecards. Direct. Specific. Immediate. "Casey, you promised Maria Lopez a callback 4 days ago — she's waiting."

**5. ARI OWNS PIPELINE HEALTH.**
Hourly pipeline scan. Stagnating leads get re-engagement tasks auto-created. Bad deal math gets flagged before offers go out. Expiring contracts trigger immediate owner alerts.

**6. ARI OWNS THE OPERATING RHYTHM.**
Morning briefing pushes automatically at office hours. EOD reconciliation runs whether Casey submits or not. The rhythm doesn't depend on human memory.

**7. ARI OWNS DATA QUALITY.**
Incomplete records are blocked from advancing. Stale data auto-refreshes. Missing fields cascade through data sources. Clean data is not optional.

**8. ARI OWNS COMMUNICATION CADENCE.**
She queues the SMS, drafts the email, schedules the voicemail drop, and queues the handwritten note. The agent's job is the live call and the negotiation. Everything else, Ari handles.

**9. ARI OWNS ESCALATION.**
Every problem has an owner and a deadline. Agent issues nudge first, then escalate to Ernest after 3 days. System issues go to Ernest immediately. Deal issues go to Ernest immediately.

**10. ARI IS THE HOME SCREEN.**
The CRM opens to Ari. Not a dashboard. Not a lead list. Ari — with what matters right now. The CRM is Ari's house. Everything else is a room she manages.

---

## WHAT EXISTS TODAY (Baseline)

The following pages/views are already built and operational at crm.savingkc.com. The existing structure, layout, and navigation must be preserved. Enhancements are layered on top.

- **Dashboard** — exists, needs metric additions
- **Stage / Pipeline view** — exists, has bugs (tile click, filters, buttons)
- **Leads page** — exists, has bugs (missing icons, missing data fields)
- **Conversations / Inbox** — exists, has bugs (View Profile, new message, search)
- **Calendar** — exists, has bugs (day view, task detail, month/week state)
- **Hot Opportunities** — exists, has bugs (Top 3 cards, double-click)
- **End of Day (EOD)** — exists, submission history bug
- **Ari briefing** — exists as concept/component, needs real-time event engine
- **Settings** — needs expansion (agent profile, feedback, system health)
- **Lead expanded view** — exists, needs housing details, deal math, action buttons

---

## CATEGORY 1: FIXES (Broken in Current Build)

These are bugs in the existing application that must be resolved first. Test every fix across all dependent views.

### Stage / Pipeline View
- **STG-01:** When tile clicked, expanded contact record should appear — currently does not open
- **STG-02:** Filters & New Lead buttons are inoperable
- **STG-03:** Sort/Filter controls not functional

### End of Day
- **EOD-01:** When EOD submits, does not update the submission history

### Website → CRM
- **WEB-01:** Lead form from savingkc.com not populating to CRM (CRITICAL — losing inbound leads)

### Hot Opportunities
- **HOT-01:** Top 3 cards missing — no way to add them
- **HOT-02:** All Opportunities double-click does not work

### Leads Page
- **LED-01:** Call, SMS, Email icons missing — click-to-call not working
- **LED-02:** Street View not pulled in on lead cards
- **LED-04:** Letter tracking missing entirely

### Conversation / Inbox
- **CNV-01:** View Profile goes nowhere (dead link)
- **CNV-02:** New Message icon not working

### Calendar
- **CAL-01:** Missing Day view
- **CAL-02:** When task clicked, should pop up with details — currently doesn't
- **CAL-03:** Month view overrides week view when not in current month
- **CAL-04:** Agenda — new task / no way to click into property

### Cross-Cutting
- **CNV-04:** Communications must sync across ALL pages wherever viewed (Conversations, Leads, Contact detail, Pipeline cards). One conversation, one truth, everywhere.

**Testing mandate:** After every fix, test the change across ALL views where that component or data appears. Fixes must be global — not isolated to one page.

---

## CATEGORY 2: ENHANCEMENTS (Exists But Needs Strengthening)

### Leads Page — Enhanced Action Buttons
- **LED-01-E:** Call, SMS, Email buttons must work on EVERY page where a lead appears — not just Leads page. Build as a global component. Click-to-call via Twilio, click-to-SMS opens compose, click-to-email opens compose. Consistent everywhere.

### Conversation / Inbox — Enhanced Search & Sync
- **CNV-03:** Search bar should auto-pop from typing and match likely contacts (autocomplete)
- **CNV-04-E:** All communication threads (calls, SMS, email) must be unified per contact and synced across every view in real time

### Expanded Lead View — Enhanced Property Data
- **LED-05:** Add full housing details to the existing expanded view. 18 data points matching Zillow parity: Beds, Baths (full/half), Sqft, Lot Size, Year Built, Basement (Y/N + type), Stories, Garage (spaces), Roof, Heating, Cooling, Property Type, Zoning, HOA, Tax Assessment, Last Sale Date, Last Sale Price.
- **LED-06:** Data source cascade: (1) In-house county parcel data, (2) US First Check housing data, (3) Zillow API fallback. No blank fields.
- **LED-07:** Redfin button — click opens that property's Redfin page
- **LED-08:** County Link button — deep links to county-specific parcel/tax page (Jackson → jacksongov.org, Clay → claycountymo.gov, Platte → platteassessor.org, Wyandotte → wycokck.org, Johnson → jocogov.org)

### Dashboard — Enhanced Metrics
- **DSH-01:** Add metric: Days Since Last Closing
- **DSH-02:** Add metric: Days Since Last Contract Signing
- **DSH-03:** Add metric: Meaningful Calls count
- **DSH-04:** Add metric: Follow-ups Completed
- **DSH-05:** Backdate dashboard from Google Sheet: https://docs.google.com/spreadsheets/d/15QlmO_4zYMGWgS-C62hS1LAcoK5oNzmBAgLAiyQ8S4I/
- **DSH-06:** Revenue to date = $0 (set baseline)
- **DSH-07:** Expenses tracking seeded: $975 office/meals + $800 car/travel
- **DSH-08:** Weekly financial update automation

### Ari Briefing — Enhanced to Real-Time
- **ARI-01:** Briefing box updates in real-time via WebSocket whenever a meaningful event occurs (new lead, incoming call/SMS/email, lead status change, contract event, closing event, Casey EOD, missed call, voicemail, appointment, offer response, follow-up overdue)
- **ARI-02:** Event priority stacking — Critical at top, routine at bottom. Max 5-6 visible before scroll.
- **ARI-03:** Every briefing item is tappable — one tap navigates to the relevant lead, conversation, deal, or calendar item
- **ARI-04:** Pattern analysis — Ari summarizes trends, not just events ("Casey made 47 calls but only 3 meaningful conversations — talk ratio is low")

### EOD — Enhanced with Metrics Trigger
- **EOD-02:** EOD submission should trigger Mojo metrics refresh (in addition to 15-min polling)

---

## CATEGORY 3: NEW CAPABILITIES (Add to Existing System)

### Login & Agent Settings
Add to existing Settings area:
- **SET-01:** Login system — agent authentication (if not already implemented)
- **SET-02:** Agent profile: name, profile pic upload
- **SET-03:** Forwarding number + assigned Twilio number configuration
- **SET-04:** Forwarding email + assigned email configuration
- **SET-05:** Notification preferences (SMS, email, push)
- **SET-06:** Office hours configuration
- **SET-07:** Voicemail setup (greeting, transcription)

### Critical Info Missing Banner
Add to existing expanded lead view:
- **CIM-01:** Banner at top showing which of the 4 qualification pillars are incomplete: TIMELINE, CONDITION, MOTIVATION, PRICE. Red = missing, Green = captured. Each tappable to fill inline.
- **CIM-02:** Ari references missing pillars before scheduled callbacks ("You still need John's timeline and motivation")

### Lead Temperature System
Add to existing lead cards:
- **TMP-01:** Auto-calculated temperature (Hot/Warm/Cool/Cold) based on: pillar completion, motivation score, contact recency, response rate, timeline urgency, deal math viability. Updates continuously.
- **TMP-02:** Favorite/star flag — agent manual pin, separate from system temperature
- **TMP-03:** Temperature indicator displayed on lead card everywhere it appears. Hot=red, Warm=orange, Cool=blue, Cold=gray.
- **TMP-04:** Temperature change triggers Ari alert (Warm→Hot or Hot→Cold)

### 8-Stage Pipeline Logic
Reinforce existing pipeline/stage view with formal stage requirements:
- **WRK-01:** Every lead must exist in exactly one stage at all times. No orphans.
- **WRK-02:** Stage 1 — NEW: auto-assigned on creation. Min: name OR address, 1 phone or address, source tagged. Auto: skip trace, pull county data, queue first contact.
- **WRK-03:** Stage 2 — CONTACTED: triggered on "spoke with owner" disposition or lead response. Min: confirmed ownership, confirmed address, initial motivation.
- **WRK-04:** Stage 3 — QUALIFIED: triggered when all 4 pillars captured. Min: timeline, condition, motivation, price. Cannot advance without all 4.
- **WRK-05:** Stage 4 — OFFER MADE: triggered on DocuSeal contract sent. Min: MAO calculated, comps done, offer logged. Auto: appears on Hot Opportunities.
- **WRK-06:** Stage 5 — UNDER CONTRACT: triggered on signature. Min: signed agreement, earnest money status, inspection dates, closing date.
- **WRK-07:** Stage 6 — DISPOSITION: triggered on buyer match. Min: buyer info, assignment fee, title company.
- **WRK-08:** Stage 7 — CLOSED: triggered by title company confirmation. Min: HUD uploaded, revenue logged, docs archived.
- **WRK-09:** Stage 8 — DEAD/NURTURE (hidden): triggered on agent mark or max attempts. Min: disposition reason. Auto: recycler at 90/180 days.
- **WRK-10:** Stage transition logging: timestamp, who, reason, manual vs auto.
- **WRK-11:** Stage timeout alerts: Ari flags leads past expected time per stage.

### Disposition System
Add post-interaction capture:
- **DSP-01:** Every interaction captures disposition: No Answer, Left VM, Callback Requested, Spoke w/ Owner, Not Interested, Wrong Number, Disconnected, DNC, Deal Potential, Appointment Set, Offer Made, Dead.
- **DSP-02:** Disposition auto-sets follow-up cadence: No Answer → retry 24hrs, Left VM → 48hrs, Callback Requested → at requested time, Not Interested → 90-day nurture, Deal Potential → 24hr follow-up.

### Missed Call Flow
Add automated missed call handling:
- **MCF-01:** Run inbound number against: (1) CRM lead match, (2) BatchSkipTracing data match, (3) Twilio Lookup spam score.
- **MCF-02:** Known lead: bump priority, personalized text-back, 5-min callback task, Ari briefing flash.
- **MCF-03:** Skip trace match: auto-create lead, attach property, warm text-back, route to Stage 1.
- **MCF-04:** Unknown + low spam: generic text-back, monitor response.
- **MCF-05:** High spam: log, no response, block after 3 attempts.
- **MCF-06:** No response in 2hrs: one callback during office hours.

### Seller Ghost Protocol
Add automated re-engagement for silent sellers:
- **GHP-01:** Activates when Stage 2+ lead with prior conversation goes dark (2+ attempts, 7+ days no response).
- **GHP-02:** Phase 1 (Days 1-7): SMS Day 1, Email Day 3, Voicemail Day 5, Handwritten note Day 7.
- **GHP-03:** Phase 2 (Days 8-21): SMS Day 10 (different angle), Voicemail Day 14, Note Day 18, Final SMS Day 21.
- **GHP-04:** Phase 3 (Day 22+): 30/60/90-day touches, quarterly notes, Ari monitors for trigger events (tax delinquency, pre-foreclosure, ownership change).
- **GHP-05:** Dashboard widget: ghost protocol enrollment by phase.
- **GHP-06:** Pausable/overridable by agent. All overrides logged.

### Multi-Channel Follow-Up
Enhance all follow-up workflows:
- **FUP-01:** ALL follow-ups orchestrate across phone, SMS, email, voicemail drop, and direct mail. No single-channel workflows.
- **FUP-02:** Default sequences by stage (configurable in Settings).
- **FUP-03:** Tasks display channel — "Call John" vs "SMS John" vs "Mail note to John." Batch by channel for efficiency.
- **FUP-04:** Ari tracks channel effectiveness per lead and adapts cadence to where they respond.

### Deal Math Card
Add to existing expanded view:
- **DML-01:** Calculator: ARV, repair estimate, holding costs, assignment fee. Auto-calculates MAO (70% rule), profit margin, deal viability flag. Pulls tax assessment from county data.
- **DML-02:** Comp section: recent sales within 0.5mi from county + MLS data.

### Skip Trace Status
Add to existing expanded view:
- **SKP-01:** Last traced date, phones returned, numbers attempted with dispositions, "Re-Skip" button if > 90 days old.

### Contract / Document Status
Add to existing expanded view:
- **DOC-01:** Offer sent → Viewed → Signed → Expired timeline. Ari alerts on viewed-but-unsigned after 24hrs.

### Handwritten Note Tracker
Add mail tracking:
- **MNT-01:** Visual pipeline on lead card: Queued → Written → Mailed (date) → Estimated Delivery → Follow-up Scheduled.
- **MNT-02:** Auto-create follow-up task timed to delivery. Batch view for all notes in transit.
- **MNT-03:** Note history per lead: dates, type, follow-up status.

### Log → Opportunities
- **OPP-01:** Activity log entries deep-link to Opportunities page. Stage 4+ auto-populates Hot Opportunities.

### Dead Lead Recycler
- **RCY-01:** Leads in Dead/Nurture re-evaluated at 90/180 days. Fresh skip trace, check county data for new tax delinquency or pre-foreclosure. Resurface if conditions changed.

### Roles & Accountability
Add to Settings:
- **ROL-01:** Role registry — every user has defined responsibilities and KPIs inside the system.
- **ROL-02:** Owner role: deal decisions, approvals, financial oversight. Ari tracks review turnaround, closing velocity.
- **ROL-03:** Agent role: calls, qualification, follow-ups, dispositions. Ari tracks call volume, disposition rate, follow-up completion, pillar capture rate, stage advancement.
- **ROL-04:** System workers treated as employees: Mojo Sync, Skip Trace, County Refresh, Email/SMS Delivery, Mercury Sync. Ari monitors health per worker.

### Ari Audit Engine
Add intelligence layer:
- **AUD-01:** Continuous data quality checks: missing dispositions, stuck leads, overdue tasks, requirement violations, duplicates, orphans.
- **AUD-02:** Agent Scorecard: daily/weekly per-agent with KPIs vs targets, trend arrows. Visible to agent and owner.
- **AUD-03:** Workflow compliance checker: verifies every lead follows its stage workflow. Flags violations with specific, actionable alerts.
- **AUD-04:** System accuracy verification: spot-checks automated data against source (county site, Mojo dashboard, Mercury receipt).
- **AUD-05:** Accountability timeline per lead: expected vs actual actions, green/amber/red.
- **AUD-06:** Coaching nudges: specific guidance when patterns detected, powered by Anthropic API.

### Operating Rhythm
Add automated rhythm:
- **RHY-01:** Morning Briefing: auto-push at office hours — callbacks, overdue follow-ups, attention leads, notes arriving, pipeline summary, yesterday's scorecard.
- **RHY-02:** EOD Reconciliation: planned vs accomplished, gaps rescheduled, disposition audit, tomorrow's plan.
- **RHY-03:** Weekly Review (Friday): pipeline health, scorecards, deal math, revenue/expense, system health, top 3 next-week priorities.

### Feedback & Error System
Add to Settings:
- **FBK-01:** Agent-submitted bug reports/feature requests with auto-captured context (page, timestamp, device, screenshot).
- **FBK-02:** Auto error logging: unhandled exceptions, failed API calls, broken workflows with stack trace + last 5 actions.
- **FBK-03:** Combined log table: sortable, filterable by type/priority/status.
- **FBK-04:** Status workflow: Open → Acknowledged → In Progress → Testing → Resolved → Closed. Agent notified on changes.

### System Health Dashboard
Add to Settings:
- **FBK-05:** Visual dashboard: feature completion %, bug counts, sprint progress, uptime/error trend.
- **FBK-06:** Goal tracker: progress rings with current vs target, color-coded (green/amber/red).
- **FBK-07:** Sprint burndown chart.
- **FBK-08:** Module health cards per CRM section with status dots.
- **FBK-09:** Weekly progress digest (Ari auto-generated).
- **FBK-10:** Agent-facing simplified view: Known Issues, Coming Soon, Recently Shipped.

### Integrations
- **INT-01:** Mercury API: expense tracking, virtual card management, transaction categorization. Cards: Operations, Marketing, Travel, General.
- **INT-02:** Mojo: 15-min polling 8am-5pm CT + EOD trigger. Call count, talk time, recordings.
- **INT-03:** Google Sheet import for historical dashboard data (one-time migration).

### Email / Gmail 2-Way Sync
- **EML-01:** 2-way email sync between CRM and Gmail via Gmail API (OAuth2). Emails sent from CRM appear in Gmail sent folder. Emails received in Gmail from known contacts auto-appear in CRM conversation thread. Sync runs continuously — not batch. Agent can send/receive from either system and both stay current.
- **EML-02:** Email-to-lead matching: inbound Gmail messages matched against CRM contacts by email address. Match found → attached to lead's conversation timeline. No match → flagged for manual assignment or auto-create lead option.
- **EML-03:** Email thread view in CRM shows full conversation thread (replies, forwards) grouped by Gmail conversation ID. Agent sees full context without switching to Gmail.

### Security Hardening
- **SEC-01:** Audit and close all open/unsecured API endpoints across savingkc ecosystem.
- **SEC-02:** Rate limiting on all public endpoints.
- **SEC-03:** Input validation/sanitization via Zod schemas on all forms.

---

## BUILD ORDER

**The existing app is the foundation. Work in this order:**

### Sprint 1: Fix What's Broken
Fix every bug in Category 1. Test globally — every fix verified across all dependent views. No new features until the existing app works correctly.

Items: STG-01, STG-02, STG-03, EOD-01, WEB-01, HOT-01, HOT-02, LED-01, LED-02, LED-04, CNV-01, CNV-02, CAL-01, CAL-02, CAL-03, CAL-04, CNV-04

### Sprint 2: Auth + Security + Core Infrastructure
Lock down the system and add the foundation for everything else.

Items: SET-01, SEC-01, SEC-02, SEC-03, SET-02 thru SET-07

### Sprint 3: Pipeline Logic + Dispositions
Reinforce the existing stage/pipeline view with formal requirements, gates, and disposition capture.

Items: WRK-01 thru WRK-11, DSP-01, DSP-02

### Sprint 4: Expanded View + Data Enrichment
Enhance the existing expanded lead view with housing details, deal math, action buttons, critical info banner, and temperature.

Items: LED-05 thru LED-09, CIM-01, CIM-02, TMP-01 thru TMP-04, DML-01, DML-02, SKP-01, DOC-01

### Sprint 5: Communications + Missed Call + Follow-Up
Build the communication engine: missed call flow, multi-channel follow-ups, global comms sync.

Items: MCF-01 thru MCF-06, FUP-01 thru FUP-04, CNV-03, LED-01-E, CNV-04-E, EML-01, EML-02, EML-03

### Sprint 6: Ari Intelligence Layer
Power up Ari with real-time briefing, audit engine, coaching, scorecards, and operating rhythm.

Items: ARI-01 thru ARI-04, AUD-01 thru AUD-06, RHY-01 thru RHY-03

### Sprint 7: Workflows + Mail + Ghost Protocol
Add ghost protocol, handwritten note tracking, dead lead recycler, and opportunities linking.

Items: GHP-01 thru GHP-06, MNT-01 thru MNT-03, OPP-01, RCY-01

### Sprint 8: Dashboard + Financials + Integrations
Metrics, Mercury API, Mojo integration, Google Sheet backfill, financial automation.

Items: DSH-01 thru DSH-08, INT-01, INT-02, INT-03, EOD-02

### Sprint 9: Settings + System Health + Feedback
Feedback system, system health dashboard, roles, and agent-facing status page.

Items: FBK-01 thru FBK-10, ROL-01 thru ROL-04

### Sprint 10: Enterprise Audit
Full regression test of every pathway a user could take. Every button, every link, every form, every workflow, every edge case. Nothing ships until every path works.

---

## TESTING MANDATE

Every change must be tested against ALL dependent views and components. A fix to the Leads page must be verified on the Pipeline view, the Expanded View, the Conversations view, and Ari's briefing — anywhere that component or data appears. Changes are global. Testing is global. No exceptions.

---

## COUNTY PARCEL URL MAPPING

| County | State | URL Pattern |
|--------|-------|-------------|
| Jackson | MO | jacksongov.org/assessment (by parcel ID) |
| Clay | MO | claycountymo.gov/assessor (by parcel ID) |
| Platte | MO | platteassessor.org (by parcel ID) |
| Wyandotte | KS | wycokck.org/appraiser (by parcel ID) |
| Johnson | KS | jocogov.org/appraiser (by parcel ID) |

---

## CURRENT STATE

- **CRM:** crm.savingkc.com — live, operational, needs enhancement and bug fixes
- **Twilio:** 19 numbers, 10DLC approved
- **Revenue to date:** $0
- **Expenses to date:** ~$1,775 ($975 office/meals + $800 car/travel)
- **Agent:** Casey (Acquisition Agent)
- **Interim tools still in use:** GoHighLevel (CRM), Mojo (dialer)
- **End goal:** Ari replaces GHL, Mojo, and DocuSeal as the single in-house system

---

*Ari owns every contact in the system. She knows everything about everything. This is her home. We're not tearing it down — we're making it bulletproof.*
