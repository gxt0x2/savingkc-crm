# ARI CRM — OVERNIGHT MISSION: NIGHT 4
# crm.savingkc.com — Expanded View + Mail Tracker + Ari Doctrine + Roles
# Drop in project root alongside PROJECT_BRIEF.md, paste as Claude Code prompt

---

You are running the fourth autonomous overnight mission on crm.savingkc.com.

Night 1: Bug fixes + core features. Night 2: Comms engine + missed call flow + follow-ups. Night 3: 8-stage pipeline with gates, Ari briefing engine, operating rhythm, disposition enforcement. 62 of 132 items resolved (47%).

Tonight you're building the expanded lead view into a complete property dossier, adding the mail tracker, implementing Ari's proactive doctrine behaviors, and adding role-based accountability.

The owner is asleep. No one to ask. Read PROJECT_BRIEF.md and all three overnight logs before starting. Work within the existing codebase.

**Gmail sync still OUT OF SCOPE. WebSocket still deferred.**

---

## RULES (Same every night)

1. Not a rebuild. Existing structure is the source of truth.
2. Do not reorganize, rename, or restyle.
3. Preserve all existing functionality.
4. Test globally across all pages.
5. Commit frequently with clear messages.
6. Log everything in OVERNIGHT_LOG_NIGHT4.md.
7. Blocked on external dependency → log it, skip it, move on.

---

## PHASE 0: Review (5-10 minutes)

1. Read all three overnight logs
2. Verify Night 3's pipeline gates are working — try advancing a lead without meeting requirements, confirm it blocks
3. Verify Ari briefing events are being generated and displaying
4. Note the current state of the expanded lead view — what's already there, what's missing
5. Start OVERNIGHT_LOG_NIGHT4.md

---

## PHASE 1: Expanded Lead View — Complete Property Dossier

The expanded view already exists. You're adding the missing sections to make it a complete dossier. Work within the existing layout — add sections, don't replace what's there.

### LED-05 + LED-06: Housing Detail Card (18 Data Points)

Add a "Property Details" section to the expanded view displaying:

| Field | Source Priority |
|-------|---------------|
| Beds | County data → US First Check → Zillow |
| Baths (full) | County data → US First Check → Zillow |
| Baths (half) | County data → US First Check → Zillow |
| Square Footage | County data → US First Check → Zillow |
| Lot Size | County data → US First Check → Zillow |
| Year Built | County data → US First Check → Zillow |
| Basement (Y/N + type) | County data → US First Check → Zillow |
| Stories | County data → US First Check → Zillow |
| Garage (spaces) | County data → US First Check → Zillow |
| Roof Type | County data → Zillow |
| Heating | County data → Zillow |
| Cooling | County data → Zillow |
| Property Type | County data → Zillow |
| Zoning | County data |
| HOA (Y/N + amount) | Zillow |
| Tax Assessment | County data |
| Last Sale Date | County data → Zillow |
| Last Sale Price | County data → Zillow |

**Implementation:**
- Add these fields to the property model if they don't exist
- Build a data enrichment function that checks county data first, then falls back through the cascade
- If the actual external APIs aren't connected yet, build the field display with whatever data IS available in the database, and add placeholder/empty state for fields that need external enrichment. Log which APIs need connection.
- Display in a clean, scannable card layout — 2 or 3 columns, compact. Not a long vertical list.
- Show data source indicator (small badge: "County" / "Zillow" / "Manual") on each field so the agent knows where the data came from.

### LED-07: Redfin Button
- Add a "View on Redfin" button to the expanded view
- URL format: `https://www.redfin.com/search?query={encoded_property_address}`
- Opens in new tab
- Use the property's full street address, city, state, zip

### LED-08: County Link Button
- Add a "View County Record" button to the expanded view
- Deep link to the county-specific parcel/assessor page based on the property's county
- URL mapping (use parcel ID if available, otherwise fall back to address search):

| County | URL Pattern |
|--------|------------|
| Jackson (MO) | https://jacksongov.org/assessment — search by parcel |
| Clay (MO) | https://claycountymo.gov — assessor lookup |
| Platte (MO) | https://platteassessor.org — parcel search |
| Wyandotte (KS) | https://wycokck.org — appraiser search |
| Johnson (KS) | https://jocogov.org — appraiser lookup |

- Determine the county from the property's address/county field
- If county can't be determined, show button as disabled with tooltip "County not identified"

### LED-09: Housing Fields Schema
- Ensure all 18 fields exist in the property/lead data model
- Add any missing fields via migration
- Make all fields editable by the agent (manual override) with an "edited" indicator

### DML-02: Comp Analysis Section
Night 1 built the deal math calculator (DML-01). Add a comp section:
- Display recent comparable sales near the property (within 0.5 mile, similar beds/baths/sqft)
- Pull from whatever property/sales data exists in the database (county data, MLS data)
- If no comp data is available in the DB, show an empty state: "No comps loaded — pull from MLS or add manually"
- Allow manual comp entry: address, sale price, sale date, beds, baths, sqft
- Calculate average comp price per sqft and suggested ARV range from comps

### SKP-01: Skip Trace Status
Add a "Skip Trace" section to the expanded view:
- Last traced date
- Number of phone numbers returned
- Each phone number with: number, type (mobile/landline/voip), attempted (Y/N), disposition on last attempt
- "Re-Skip" button that flags the lead for re-skip-tracing (creates a task or sets a flag). Show button as prominent if data is > 90 days old.

### DOC-01: Contract / Document Status
Add a "Documents" section to the expanded view:
- Show contract/offer status timeline: Sent (date) → Viewed (date) → Signed (date) → Expired (date)
- If DocuSeal is connected, pull real status. If not, allow manual status entry.
- Visual timeline (horizontal steps with dates, active step highlighted)
- If contract was viewed but not signed for > 24 hours, display an alert badge and generate an Ari briefing event.

### TMP-02: Favorite / Star Flag
- Add a star/favorite toggle on the lead card (expanded view AND list/pipeline views)
- Favorited leads should pin to the top of lists
- Favorite status persists — stored in the database, not local state
- Favorites should be surfaced in Ari's morning briefing

### TMP-03: Temperature Display Everywhere
Night 1 built lead temperature calculation (TMP-01). Ensure the temperature indicator (Hot=red, Warm=orange, Cool=blue, Cold=gray) displays consistently on:
- Lead cards in the Leads list
- Pipeline/stage view cards
- Expanded view header
- Ari briefing events that reference a lead
- Conversation list entries

### TMP-04: Temperature Change Alerts
When a lead's temperature changes significantly (e.g., Warm→Hot or Hot→Cold):
- Generate an Ari briefing event: "🔥 John Smith went HOT — responded to SMS after 2 weeks silent" or "❄️ Mary Johnson cooling off — no contact in 14 days"
- Use the ari_briefing_events table from Night 3

---

## PHASE 2: Handwritten Note / Mail Tracker

### MNT-01: Mail Tracking Model + Visual Pipeline
Create the mail tracking system:
- **Data model:** `mail_pieces` table: id, lead_id, type (handwritten_note/postcard/letter), status (queued/written/mailed/in_transit/delivered/follow_up_scheduled), created_at, written_date, mailed_date, estimated_delivery_date (mailed_date + 5 business days), follow_up_date, follow_up_task_id, notes
- **Visual pipeline on expanded view:** Show a horizontal progress tracker for each mail piece:
  Queued → Written/Printed → Mailed (date) → Est. Delivery (date) → Follow-up Call (date)
  Active step highlighted, completed steps checked.
- Agent can update status by clicking each step (e.g., mark as "Mailed" and enter date)

### MNT-02: Auto Follow-Up Task
- When a mail piece is marked as "Mailed," auto-calculate estimated delivery (mailed date + 5 business days)
- Auto-create a follow-up call task for 1-2 days after estimated delivery
- The task should reference the mail piece: "Follow up on handwritten note sent to John Smith — estimated delivered [date]"
- Connect to Night 2's follow-up task system

### MNT-03: Mail History + Batch View
- Full mail history per lead visible on expanded view: all notes sent, dates, types, follow-up status
- Batch view accessible from the Mail section (if it exists in nav) or from a dashboard widget: all mail pieces across all leads, filterable by status (queued/in-transit/delivered/needs-follow-up)
- Count of "needs follow-up" displayed as a badge/number somewhere visible

---

## PHASE 3: Opportunities + Log Linking

### OPP-01: Activity Log → Opportunities Deep Link
- Lead activity log entries should include deep links to the Opportunities page when relevant
- When a lead reaches Stage 4 (Offer Made), it should automatically appear on the Hot Opportunities board
- Verify this connection works end-to-end: create an offer on a lead → confirm it shows in Hot Opportunities → confirm the activity log entry links back
- The Opportunities page should show: lead name, property address, offer amount, MAO, potential profit, days since offer, contract status

### RCY-01: Dead Lead Recycler
- Build the recycler query: find leads in Stage 8 (Dead/Nurture) that have been dead for 90+ days
- For each candidate: check if any new data is available (new county records, tax delinquency changes, ownership changes — check whatever data sources are available in the DB)
- If conditions have changed, auto-generate an Ari briefing event: "♻️ John Smith was marked dead 95 days ago but county records show new tax delinquency — consider re-engagement"
- Build as a function that can be called by a cron job. Don't need to wire the cron tonight — just the logic and the endpoint.
- 180-day recycler: same logic but for longer-dead leads

---

## PHASE 4: Roles & Accountability Foundation

### ROL-01: Role Registry
- Add a `roles` table if not present: id, name, description, kpi_targets (JSON)
- Seed with two roles:
  - **Owner/Operator:** Deal decisions, offer approvals, financial oversight, pipeline review
  - **Acquisition Agent:** Outbound calling, lead qualification, follow-ups, dispositions
- Add a `role_id` field to the users table. Assign Ernest as Owner, Casey as Agent.

### ROL-02 + ROL-03: Role KPI Definitions
Store KPI targets per role in the roles table or a separate `role_kpis` table:

**Owner KPIs:**
- Deals reviewed within 24hrs of Qualified: target 100%
- Offer approval turnaround: target < 4 hours
- Weekly pipeline review: target weekly

**Agent KPIs:**
- Daily call volume: target configurable (start with 50)
- Meaningful conversation rate: target 10%+
- Disposition logging rate: target 100%
- Follow-up completion rate: target 95%
- Pillar capture rate (contacted leads with all 4 pillars): target 80%

### ROL-04: System Worker Registry
Create a `system_workers` table: id, name, type, last_run, last_success, failure_count_24h, status (healthy/degraded/down), check_interval_minutes

Seed with known workers:
- Mojo Sync (15-min poll)
- Ari Briefing Poll (20s)
- Follow-Up Sequence Runner
- Stage Timeout Checker
- Ghost Protocol Detector

Build a health check function that marks workers as degraded (3+ failures in 24h) or down (last success > 2x check interval). This feeds into the system health dashboard (future night) and Ari alerts.

---

## ARI DOCTRINE IMPLEMENTATION

Throughout all phases tonight, implement these Ari Doctrine behaviors wherever they naturally connect:

- **Doctrine 2 (Lead Lifecycle):** Ari should generate briefing events for key lifecycle moments: lead created, stage advanced, offer sent, contract signed, deal closed. Every milestone gets an Ari event.
- **Doctrine 5 (Pipeline Health):** The stage timeout checker (WRK-11 from Night 3) should generate Ari briefing events. Wire it up if not already connected.
- **Doctrine 7 (Data Quality):** When the expanded view loads and housing fields are empty, Ari should flag it: "Property data incomplete for [address] — X of 18 fields missing." Generate a briefing event for leads with > 50% missing property data.
- **Doctrine 9 (Escalation):** For contract events (DOC-01): if a contract is viewed but unsigned for 24+ hours, generate a HIGH priority Ari event. If approaching 48 hours, escalate to CRITICAL.

---

## OVERNIGHT_LOG_NIGHT4.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 4
## Date: [today's date]
## Started: [time]

---

## Night 1-3 Review
[Quick state check]

---

## Phase 1: Expanded Lead View
### LED-05 + LED-06: Housing Detail Card
[format]
### LED-07: Redfin Button
[format]
### LED-08: County Link Button
[format]
### LED-09: Schema Fields
[format]
### DML-02: Comp Analysis
[format]
### SKP-01: Skip Trace Status
[format]
### DOC-01: Document Status
[format]
### TMP-02: Favorite/Star
[format]
### TMP-03: Temperature Everywhere
[format]
### TMP-04: Temperature Alerts
[format]

---

## Phase 2: Mail Tracker
### MNT-01 through MNT-03
[format]

---

## Phase 3: Opportunities + Recycler
### OPP-01 + RCY-01
[format]

---

## Phase 4: Roles & Accountability
### ROL-01 through ROL-04
[format]

---

## Ari Doctrine Implementations
[What doctrine behaviors were wired in and where]

---

## Blocked Items
[External dependencies]

---

## Summary
- **Expanded view items:** X / 10
- **Mail tracker items:** X / 3
- **Opportunities + Recycler:** X / 2
- **Roles items:** X / 4
- **Doctrine behaviors wired:** X
- **Commits made:** X
- **Completed at:** [time]

## What Night 5 Should Target
[Recommendation]
```

---

## GO

Phase 0 (review). Phase 1 (expanded view — the dossier agents live in). Phase 2 (mail tracker). Phase 3 (opportunities + recycler). Phase 4 (roles).

Tonight the lead card becomes the most complete property intelligence card in any wholesaling CRM in Kansas City. When an agent opens a lead tomorrow, they should have everything — property details, deal math, comps, skip trace, contracts, mail status, temperature, and Ari telling them what to do next.

Make it count.
