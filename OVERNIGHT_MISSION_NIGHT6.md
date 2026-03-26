# ARI CRM — OVERNIGHT MISSION: NIGHT 6 (FINAL BUILD)
# crm.savingkc.com — Dashboard + Integrations + Doctrine Verification + Enterprise QA
# Drop in project root alongside PROJECT_BRIEF.md, paste as Claude Code prompt

---

You are running the sixth and potentially final build night on crm.savingkc.com.

Night 1: Bug fixes. Night 2: Comms engine. Night 3: Pipeline + briefing. Night 4: Expanded view. Night 5: Audit engine + Ghost Protocol + Settings + Security. 109 of 132 items resolved (83%).

Tonight you close out the remaining 23 items: dashboard financials, integration wiring, the 2 partial items from Night 5, Ari Doctrine behavioral verification across the entire system, and a full enterprise QA sweep of every page, every button, every pathway.

The owner is asleep. No one to ask. Read PROJECT_BRIEF.md and all five overnight logs. Work within the existing codebase.

**Gmail sync (EML-01, EML-02, EML-03) is still OUT OF SCOPE — OAuth not configured. These 3 items remain as backlog. Everything else should be resolved or verified tonight.**

---

## RULES (Same every night — last time)

1. Not a rebuild. Existing structure is the source of truth.
2. Do not reorganize, rename, or restyle.
3. Preserve all existing functionality.
4. Test globally across all pages.
5. Commit frequently with clear messages.
6. Log everything in OVERNIGHT_LOG_NIGHT6.md.
7. Blocked on external dependency → log it, skip it, move on.

---

## PHASE 0: Review (5-10 minutes)

1. Read all five overnight logs
2. Identify the 2 partial items from Night 5 (likely FBK-07 sprint burndown and FBK-09 weekly digest). Check their state.
3. Note what integration credentials/APIs are actually available vs need external setup
4. Start OVERNIGHT_LOG_NIGHT6.md

---

## PHASE 1: Complete the Partials from Night 5

### FBK-07: Sprint Burndown Chart
If this was partially built, finish it. If it needs data that doesn't exist yet, build a simple "items resolved over time" chart from the feedback_submissions resolved dates or from a manual count. It doesn't need to be complex — a clear visual of build progress over the last 6 nights.

### FBK-09: Weekly System Health Digest
Connect this to the weekly_reviews table from Night 3 (RHY-03). The weekly digest should include:
- Items shipped this week (from feedback/changelog)
- Bugs resolved / new bugs found
- Worker health summary
- Error rate trend (from error_log)
Store as part of the weekly review record. The morning briefing on Monday should surface a "Weekly Review ready" event.

### CIM-03: Ari References Missing Pillars in Briefing
This may partially exist from CIM-02 (Night 3). Verify: when Ari generates a briefing event for a scheduled callback, does the event description include which of the 4 pillars are still missing? If not, add that context to the briefing event generator.

---

## PHASE 2: Dashboard Financials + Data Backfill

### DSH-05: Google Sheet Data Backfill
The historical data lives at: https://docs.google.com/spreadsheets/d/15QlmO_4zYMGWgS-C62hS1LAcoK5oNzmBAgLAiyQ8S4I/

Since we may not have Google Sheets API credentials:
- Check if the app has Google API access configured
- If YES: fetch the sheet data and import into the appropriate tables (closings, contracts, call metrics, etc.)
- If NO: build the import endpoint/function that WOULD import the data, accepting JSON/CSV input. Create a documented API route like `/api/admin/import-historical` that accepts the data structure. Log exactly what format the data needs to be in and how to trigger the import manually. Mark as "ready for data — needs manual trigger."

### DSH-06: Revenue Baseline
- Set revenue to $0 in whatever financial tracking table/field exists
- If no financial tracking exists yet, create a simple `financial_summary` table or config: revenue_to_date, expenses_to_date, last_updated
- Ensure the dashboard displays Revenue: $0

### DSH-07: Expense Seeding
- Seed expenses: $975 (office/meals) + $800 (car/travel) = $1,775 total
- If expense categories exist (from Night 4's role setup or prior work), categorize:
  - Operations: $975 (office expenses + meals)
  - Travel: $800 (car + travel)
- Display on dashboard: Expenses to Date: $1,775

### DSH-08: Weekly Financial Update
- Build a function that generates a weekly financial summary: revenue this week, expenses this week, net, running totals
- If Mercury API is connected, pull from transactions. If not, pull from manual entries in the financial tables.
- Add the financial summary to the weekly review (RHY-03 from Night 3)
- On the dashboard, show: Revenue (period), Expenses (period), Net, with week-over-week comparison

---

## PHASE 3: Integration Wiring

### INT-01: Mercury API
- Check if Mercury API credentials are configured in the environment
- If YES: implement transaction sync — pull recent transactions, categorize by merchant/description into expense categories (Operations, Marketing, Travel, General), store in expenses table, update dashboard totals
- If NO: build the integration endpoints and Mercury service module with placeholder for API key. Create the expense categorization logic that would process Mercury transactions. Log exactly what env vars are needed (MERCURY_API_KEY, MERCURY_ACCOUNT_ID, etc.). Mark as "code ready — needs credentials."

### INT-02: Mojo Integration Hardening
Night 2 built Mojo dynamic date lookup. Strengthen:
- Verify the 15-minute polling job runs correctly during office hours (8am-5pm CT)
- Verify it stops outside office hours
- Verify EOD submission triggers an immediate Mojo refresh (EOD-02 from Night 3)
- If Mojo API credentials aren't configured, ensure the polling gracefully handles missing credentials (no crashes, clear error log entry)
- Pull: call count, talk time, meaningful conversations. Feed into agent_daily_stats and dashboard metrics.

### INT-03: Google Sheet Import
This overlaps with DSH-05. If Google Sheets API isn't available:
- Build an admin page or API endpoint for CSV/JSON upload
- Accept columns: date, type (closing/contract/call_metric), amount, details
- Parse and insert into appropriate tables
- One-time import + optional re-import for corrections

---

## PHASE 4: Ari Doctrine Behavioral Verification

The 10 Ari Doctrine principles (ARI-P01 through ARI-P10) are not features to build — they are behaviors to VERIFY across the entire system. Go through each one and confirm the doctrine is being enforced by the code that's been built over 5 nights. Where it's not, fix it.

### ARI-P01: Reactive is a Bug
**Verify:** Does anything in the system wait for the user to check it, rather than proactively surfacing it?
- Follow-up overdue → is an Ari briefing event generated automatically? (Should be from AUD-01)
- Lead temperature drops → is an alert generated? (Should be from TMP-04)
- Integration fails → is an alert generated? (Should be from AUD-04)
- If ANY of these are missing, wire them up.

### ARI-P02: Ari Owns the Lead Lifecycle
**Verify:** Does every major lifecycle event generate an Ari briefing event?
- Lead created → event? 
- Stage advanced → event?
- Offer sent → event?
- Contract signed → event?
- Deal closed → event?
- Lead died → event?
- Check the ari_briefing_events insertions across all relevant code paths. Add any missing.

### ARI-P03: Ari Owns All Automations
**Verify:** Does every automated worker have health monitoring?
- Check system_workers table — are all workers registered?
- Does AUD-04 (system accuracy check) cover all workers?
- If a worker fails, is an Ari briefing event generated?
- Add any missing workers to the registry.

### ARI-P04: Ari Owns Agent Accountability
**Verify:** Are coaching nudges actually being generated?
- Run the AUD-06 nudge logic mentally against sample data — would it fire correctly?
- Is the agent scorecard (AUD-02) accessible from the dashboard?
- Can the Owner see all agents' scorecards?
- Is disposition enforcement actually blocking (from Night 3)?

### ARI-P05: Ari Owns Pipeline Health
**Verify:** Does the stage timeout checker (WRK-11) generate Ari events?
- Are the timeout thresholds configured?
- If a lead has been in Stage 1 for 72 hours with no contact, does Ari flag it?
- Test the logic path mentally or with a quick query.

### ARI-P06: Ari Owns the Operating Rhythm
**Verify:** Does the morning briefing auto-generate?
- Is RHY-01 connected to the briefing component?
- Does the EOD reconciliation (RHY-02) actually compare planned vs accomplished?
- Does the weekly review (RHY-03) aggregate all data sources?
- If any of these are endpoint-only (data ready but not displayed), wire them into the Ari briefing UI.

### ARI-P07: Ari Owns Data Quality
**Verify:** Are incomplete records actually blocked from advancing?
- Try to mentally trace: lead missing Timeline pillar → attempt advance to Qualified → does the gate reject?
- Are leads with >50% missing housing data flagged?
- Is stale skip trace data (>90 days) flagged?

### ARI-P08: Ari Owns Communication Cadence
**Verify:** Does the follow-up engine (Night 2) actually create tasks across all channels?
- New lead → does it get a call + SMS task on Day 0?
- Does the Ghost Protocol create tasks across SMS, email, voicemail, mail?
- Are missed call text-backs actually sending?

### ARI-P09: Ari Owns Escalation
**Verify:** Is the escalation matrix implemented?
- Agent misses follow-ups for 3+ days → does it escalate to Owner?
- System worker goes down → does Owner get immediate alert?
- Contract expiring → does Owner get immediate alert?
- If escalation logic is missing, add it to the Ari briefing event generator with appropriate priority levels.

### ARI-P10: Ari is the Home Screen
**Verify:** When a user opens crm.savingkc.com, is Ari's briefing the first thing they see?
- Is the default route / home page the Ari briefing view (or dashboard with Ari prominently featured)?
- Does it show current, real-time information — not stale data?
- Is it actionable — can you tap events and navigate to context?
- If the home screen is a static dashboard with Ari as a sidebar widget, consider whether it should be more prominent. Don't restructure — but note in the log if the current layout doesn't fulfill this doctrine.

**For each doctrine item:** Mark as VERIFIED if the behavior exists, or describe what you fixed/added to make it compliant. Log everything.

---

## PHASE 5: Enterprise QA Sweep

This is the final quality pass. Go through every page and every interactive element in the application.

### Page-by-Page Walkthrough:

**Home / Dashboard:**
- [ ] Page loads without errors
- [ ] All metrics display current data (not stale/mock)
- [ ] Days Since Last Closing shows correct value
- [ ] Days Since Last Contract shows correct value
- [ ] Meaningful Calls metric works
- [ ] Follow-ups Completed metric works
- [ ] Revenue shows $0
- [ ] Expenses show $1,775
- [ ] Ari briefing events display with priority stacking
- [ ] Briefing events are tappable and navigate correctly
- [ ] Ghost protocol widget shows counts
- [ ] Agent scorecard visible

**Pipeline / Stage View:**
- [ ] All 8 stages display
- [ ] Lead cards show temperature indicator
- [ ] Tile click opens expanded view
- [ ] Filters work
- [ ] Sort works
- [ ] New Lead button works
- [ ] Drag-to-advance checks stage requirements (gates)
- [ ] Stage 8 (Dead) is hidden by default, accessible via filter
- [ ] Stage transition is logged

**Leads Page:**
- [ ] Lead list loads
- [ ] Call/SMS/Email buttons visible and functional
- [ ] Temperature badges display
- [ ] Favorite/star toggle works
- [ ] Search/filter works
- [ ] Click opens expanded view

**Expanded Lead View:**
- [ ] Contact info displays
- [ ] Housing details (18 fields) display
- [ ] Data source badges show (County/Zillow/Manual)
- [ ] Redfin button opens correct URL
- [ ] County Link button opens correct county page
- [ ] Critical Info Missing banner shows (if pillars missing)
- [ ] 4 pillars tappable to fill inline
- [ ] Deal math calculator works (70% rule)
- [ ] Comp section displays
- [ ] Skip trace status shows
- [ ] Re-skip button works (if data >90 days)
- [ ] Contract/document timeline displays
- [ ] Mail tracker pipeline displays
- [ ] Activity log shows all events chronologically
- [ ] Accountability timeline (expected vs actual) displays
- [ ] Ghost protocol status shows (if enrolled)
- [ ] Call/SMS/Email buttons work from expanded view

**Conversations / Inbox:**
- [ ] Conversation list loads
- [ ] Search with autocomplete works
- [ ] Click opens conversation thread
- [ ] Thread shows all channels (calls, SMS, email) unified
- [ ] New message works
- [ ] View Profile navigates correctly
- [ ] Comms sync — message sent from here appears on lead's expanded view

**Calendar:**
- [ ] Month view works
- [ ] Week view works
- [ ] Day view works
- [ ] View switching doesn't break (month↔week↔day)
- [ ] Tasks show from real DB (not mocks)
- [ ] Task click shows detail popup
- [ ] Can create new task
- [ ] Can click into associated property

**Hot Opportunities:**
- [ ] Stage 4+ leads appear automatically
- [ ] Top 3 cards display
- [ ] Can add new opportunities
- [ ] Double-click works
- [ ] Deal details show (offer amount, MAO, profit)

**End of Day:**
- [ ] EOD form submits
- [ ] Submission history updates
- [ ] Triggers Mojo refresh
- [ ] Shows planned vs accomplished comparison

**Settings:**
- [ ] Agent profile loads (name, photo, numbers, emails)
- [ ] Profile photo upload works (with initials fallback)
- [ ] Forwarding number/email configurable
- [ ] Notification preferences toggleable
- [ ] Office hours configurable
- [ ] Voicemail setup accessible
- [ ] Feedback form submits
- [ ] Error log displays
- [ ] Combined log table sortable/filterable
- [ ] System health dashboard shows module cards
- [ ] Goal tracker displays progress
- [ ] Agent status page shows Known Issues / Coming Soon / Recently Shipped
- [ ] Role assignment visible

### Cross-Cutting Checks:
- [ ] Authentication works — unauthenticated users cannot access protected routes
- [ ] Rate limiting active on public endpoints
- [ ] No console errors on any page
- [ ] No broken links
- [ ] No empty states that should have data
- [ ] Communication actions (call/SMS/email) work from EVERY page they appear on
- [ ] Temperature indicator consistent across all views
- [ ] Ari briefing events generate for all major actions

### Document EVERYTHING in the overnight log:
- Every page tested
- Every issue found (with severity)
- Every fix applied
- Anything that needs external setup (API keys, OAuth, etc.)

---

## OVERNIGHT_LOG_NIGHT6.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 6 (Final Build)
## Date: [today's date]
## Started: [time]

---

## Phase 1: Partials Completed
[FBK-07, FBK-09, CIM-03]

---

## Phase 2: Dashboard Financials
[DSH-05 through DSH-08]

---

## Phase 3: Integrations
[INT-01 through INT-03]

---

## Phase 4: Ari Doctrine Verification
### ARI-P01: Reactive is a Bug — [VERIFIED / FIXED: ...]
### ARI-P02: Lead Lifecycle — [VERIFIED / FIXED: ...]
### ARI-P03: All Automations — [VERIFIED / FIXED: ...]
### ARI-P04: Agent Accountability — [VERIFIED / FIXED: ...]
### ARI-P05: Pipeline Health — [VERIFIED / FIXED: ...]
### ARI-P06: Operating Rhythm — [VERIFIED / FIXED: ...]
### ARI-P07: Data Quality — [VERIFIED / FIXED: ...]
### ARI-P08: Communication Cadence — [VERIFIED / FIXED: ...]
### ARI-P09: Escalation — [VERIFIED / FIXED: ...]
### ARI-P10: Home Screen — [VERIFIED / FIXED: ...]

---

## Phase 5: Enterprise QA Results

### Dashboard: [PASS / X issues found]
### Pipeline: [PASS / X issues found]
### Leads: [PASS / X issues found]
### Expanded View: [PASS / X issues found]
### Conversations: [PASS / X issues found]
### Calendar: [PASS / X issues found]
### Hot Opportunities: [PASS / X issues found]
### End of Day: [PASS / X issues found]
### Settings: [PASS / X issues found]
### Cross-Cutting: [PASS / X issues found]

QA Issues Found & Fixed: [list]
QA Issues Found & NOT Fixed (needs external): [list]

---

## Blocked Items (Needs External Setup)
- Gmail OAuth: EML-01, EML-02, EML-03
- Mercury API key: INT-01 (code ready, needs credentials)
- Google Sheets API: DSH-05 / INT-03 (import endpoint ready, needs credentials or manual CSV upload)
- WebSocket server: real-time push (polling works as stopgap)

---

## FINAL STATUS

| Category | Resolved | Partial | Blocked | Total |
|----------|----------|---------|---------|-------|
| Bug Fixes (Night 1) | X | 0 | 0 | X |
| Comms Engine (Night 2) | X | 0 | 0 | X |
| Pipeline + Briefing (Night 3) | X | 0 | 0 | X |
| Expanded View (Night 4) | X | 0 | 0 | X |
| Audit + Ghost + Settings (Night 5) | X | 0 | 0 | X |
| Financials + QA (Night 6) | X | X | X | X |
| **TOTAL** | **X** | **X** | **X** | **132** |

## What Remains
[Only items that need external credentials or infrastructure — everything else should be done]

---

## Completed at: [time]
```

---

## GO

This is the last build night. Phase 1 closes the partials. Phase 2 handles the money. Phase 3 wires integrations. Phase 4 verifies Ari's doctrine is alive in every corner of the system. Phase 5 is the full enterprise QA — every page, every button, every link, every pathway.

When Ernest opens the CRM tomorrow morning, it should be ready. Not "mostly working." Not "a few things left." Ready.

129 items resolved. 3 blocked on external credentials. That's the target.

Make it count. Last night. Finish it.
