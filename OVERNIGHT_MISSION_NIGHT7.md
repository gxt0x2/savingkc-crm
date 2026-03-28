# ARI CRM — OVERNIGHT MISSION: NIGHT 7
# crm.savingkc.com — Expanded Lead Page Overhaul + System-Wide Fixes
# Drop in project root alongside PROJECT_BRIEF.md, paste as Claude Code prompt

---

You are running Night 7 on crm.savingkc.com. The build sprint completed on Night 6 (129/132 items, 98%). Tonight is a critical polish and correction night. The owner has reviewed the app and found issues that must be fixed. Every item below is mandatory.

The expanded lead page is THE source of truth for every contact in the system. It must be perfect. No empty sections. No placeholder data. No broken links. No emojis. No test data.

The owner is asleep. No one to ask. Work within the existing codebase. Fix everything listed below.

---

## RULES

1. Not a rebuild. Work within existing structure.
2. Preserve all working functionality.
3. Test globally after every fix.
4. Commit frequently with clear messages.
5. Log everything in OVERNIGHT_LOG_NIGHT7.md.
6. **NEVER use emojis anywhere in the UI.** Use proper icons (Lucide, Heroicons, or whatever icon library the project uses).
7. **The expanded lead page is the source of truth.** Every section must have real data, not placeholders.

---

## PHASE 0: Review + Codebase Audit (10 minutes)

1. Read all prior overnight logs
2. Open the expanded lead view code — understand every section, every component, every data source
3. Identify the icon library in use (Lucide? Heroicons? FontAwesome?)
4. Identify the database (Supabase confirmed) and how property data is fetched
5. Find where Zillow data is pulled (or should be pulled)
6. Locate the favicon file and where it's referenced
7. Start OVERNIGHT_LOG_NIGHT7.md

---

## PHASE 1: System-Wide Fixes (Apply to ALL pages)

### FIX-01: Favicon
The favicon has not been updated. Find the favicon file (likely in /public or /app) and replace it with the Saving KC / Ari brand favicon. If a branded favicon file doesn't exist, create a clean, professional one — dark navy (#1B2A4A) background with "A" in amber (#D4A843) for Ari. Update all references (favicon.ico, apple-touch-icon, manifest.json if present). Verify it shows on every page.

### FIX-02: Lead Names — Proper Case
All lead names are displaying in lowercase. This is wrong. Names must display in proper case (Title Case): "John Smith" not "john smith."
- Find where lead names are rendered across the app
- Apply proper case formatting at the display level (do NOT modify the database values — format on render)
- Create a utility function: `toProperCase(name)` that handles edge cases (McDonald, O'Brien, etc.)
- Apply everywhere names appear: lead cards, expanded view, pipeline tiles, conversations, Ari briefing events, activity log, calendar tasks
- Verify across ALL pages

### FIX-03: Phone Number Formatting
All phone numbers must display as: **(816) XXX-XXXX** format (parentheses around area code, space, dash-separated).
- Create a utility function: `formatPhone(number)` that takes any phone string and outputs `(XXX) XXX-XXXX`
- Handle edge cases: numbers with country code (+1), numbers with no formatting, 10-digit raw strings
- Apply everywhere phone numbers appear: lead cards, expanded view, conversation threads, call logs, activity feed, skip trace section, Ari briefing
- Verify across ALL pages

### FIX-04: Remove ALL Test Leads
Delete every test/dummy/sample lead from the database (Supabase).
- Identify test leads: look for names like "Test", "Sample", "Demo", "John Doe", "Jane Doe", or obviously fake data
- Remove from: leads table, all related records (activities, communications, tasks, dispositions, mail pieces, stage transitions, ghost protocol enrollments)
- Be careful — only remove obvious test data. If unsure, leave it and log it.
- After removal, verify no orphaned records remain

### FIX-05: No Emojis — Icons Only
Search the entire codebase for emoji characters used in the UI. Replace every emoji with a proper icon from the project's icon library.
- Search for common emoji patterns: ✅ ❌ ⚠️ 🔥 ❄️ 📞 📧 ✉️ 📋 🏠 💰 📝 🎯 etc.
- Replace with appropriate SVG/component icons (checkmark, x-circle, alert-triangle, flame, phone, mail, clipboard, home, dollar-sign, edit, target, etc.)
- This includes the "Thank you letter sent" item mentioned below — must use a real icon, not an emoji
- Verify no emojis remain in any rendered UI

---

## PHASE 2: Leads Page Fixes

### FIX-06: Google Image → Street View
On ALL lead pages, the center Google image currently shows a map view. This must be Google Street View at street level.
- Replace Google Maps static image with Google Street View Static API
- URL format: `https://maps.googleapis.com/maps/api/streetview?size=600x300&location={address}&key={API_KEY}`
- The image should show the property as if you're standing in front of it on the street
- When the image is clicked, open Google Street View in a new tab at that address: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}` or `https://www.google.com/maps/place/{encoded_address}`
- Apply to: Leads list view, expanded lead view, pipeline cards (if they show property images)
- If Google Street View API key is not configured, log exactly what env var is needed

### FIX-07: Leads Page — Column Sorting
The leads page must have complete and functional column sorting:
- Every column header should be clickable to sort ascending/descending
- Visual indicator showing current sort column and direction (arrow up/down)
- Columns that must be sortable: Name, Address, Phone, Stage, Temperature, Last Activity, Date Created, Source
- Sort should work on the full dataset, not just the visible page

### FIX-08: Leads Page — Column Filtering
Add filtering capability to the leads list:
- Filter by: Stage (multi-select), Temperature (Hot/Warm/Cool/Cold), Source, Date range (created), Date range (last activity)
- Filters should be combinable (e.g., Stage = Qualified AND Temperature = Hot)
- Active filters shown as chips/badges above the list with ability to remove individually
- "Clear all filters" button

### FIX-09: Leads Page — Column Rearrangement
Add the ability to rearrange columns:
- Drag-and-drop column headers to reorder
- Column order persists per user (store in user_settings or localStorage)
- Option to show/hide columns (column visibility toggle)

### FIX-10: Leads Page — Default Sort
The default leads page view must sort by **most recent activity in descending order** (newest activity first).
- The "Last Activity" column should be the default sort column
- Descending order (most recent at top)
- This should be the sort state when the page first loads

---

## PHASE 3: Expanded Lead Page — Section-by-Section Overhaul

### FIX-11: Property Details — Must Be Populated
The property details section is EMPTY. This is unacceptable. The data IS available.
- For every lead with an address, fetch property details from Zillow (or whatever data source is available)
- Use the Zillow data enrichment function built on Night 4 (LED-05/06)
- If the Zillow API isn't connected, use the data already in the database from county scrapers
- If the data doesn't exist in the DB for a specific lead, attempt to fetch it NOW during this overnight run
- At minimum, populate: Beds, Baths, Sqft, Lot Size, Year Built, Property Type from available sources
- NO EMPTY property detail sections. If data truly cannot be found, show "Data unavailable — manual entry required" with editable fields, not just blank space.

### FIX-12: Google Image → Street View (Expanded View)
Same as FIX-06 but specifically for the expanded lead view:
- The property image must be Google Street View (street level), not a map
- Clicking the image opens interactive Google Street View where you're standing in front of the property
- Image should be prominently displayed in the property section

### FIX-13: Change Zillow Button (was Redfin)
Change the "Redfin" button to "Zillow" and fix the link:
- Button label: "View on Zillow"
- The link must go to the ACTUAL Zillow property page, not a search results page
- Zillow property URL format: `https://www.zillow.com/homedetails/{address-slug}/{zpid}_zpid/`
- To get the correct URL: use the Zillow API to look up the property by address and get the zpid (Zillow Property ID)
- If Zillow API lookup isn't available, construct a search URL: `https://www.zillow.com/homes/{encoded_address}`
- Example for reference: 5621 W 151st Ter, Overland Park, KS 66223 → https://www.zillow.com/homedetails/5621-W-151st-Ter-Overland-Park-KS-66223/75564525_zpid/
- The link must pull up the PROPERTY PAGE, not search results

### FIX-14: County Collector Link — Fix
The county link must go to the ACTUAL tax/parcel page for the specific property, not a general county site.
- For Johnson County (KS): `https://taxbill.jocogov.org/Property-Detail/PropertyQuickRefID/{parcel_id}/PartyQuickRefID/{party_id}`
- For Jackson County (MO): Direct parcel lookup URL with the property's parcel ID
- For Clay County (MO): Direct assessor lookup with parcel ID
- For Platte County (MO): Direct assessor lookup with parcel ID
- For Wyandotte County (KS): Direct appraiser lookup with parcel ID
- The link must go to THE SPECIFIC PROPERTY'S tax/parcel page. If parcel ID is stored in the database, use it. If not, construct the best possible direct link.
- Label the button: "County Tax Record" (not just "County Link")
- Example: Sharion at 5621 W 151st Ter, Overland Park → https://taxbill.jocogov.org/Property-Detail/PropertyQuickRefID/R97653/PartyQuickRefID/O0077078

### FIX-15: Lead Temperature — Must Be Changeable
The lead temperature (Hot/Warm/Cool/Cold) currently cannot be manually changed by the agent.
- Add a temperature selector/dropdown on the expanded lead view
- Agent can override the auto-calculated temperature
- When manually changed, log it: "Temperature manually changed from Cool to Hot by Casey"
- Manual override should persist until the next system recalculation (or add a "lock" option to prevent system override)
- Temperature change creates an Ari briefing event

### FIX-16: Appointment Button
Add an "Schedule Appointment" button on the expanded lead view:
- Click opens a modal with:
  - Type: In-Person / Phone Call / Google Meet (radio or select)
  - Date picker
  - Time picker
  - Agent assignment (dropdown of agents)
  - Notes field (optional)
- On confirm:
  - Create a calendar event/task
  - Create an activity log entry: "Appointment scheduled: [type] on [date] at [time] with [agent]"
  - Create an Ari briefing event
  - If Google Meet selected, generate a Google Meet link (if Google API available) or placeholder
  - Send confirmation to the lead via their preferred channel (SMS or email): "Your appointment with Saving KC is confirmed for [date] at [time]"
  - The appointment workflow starts — Ari monitors for: appointment approaching (24hr reminder), appointment time passed (was it completed?), no-show handling

### FIX-17: Remove "Tactical Approach" Section
Delete the "Tactical Approach" section from the expanded lead view entirely.
- Replace it with a "Lead Journey" section that gives a detailed but brief overview of:
  - How the lead entered the system (source, date)
  - Key milestones: first contact, qualification, offers, contracts
  - Current situation summary (2-3 sentences max, based on available data)
  - Current stage and how long they've been there
  - Next recommended action
- This should read like a brief executive summary, not a tactical playbook

### FIX-18: Ari Briefing Section — MUST HAVE CONTENT
The Ari briefing section on the expanded lead view is EMPTY. This is unacceptable.
- Ari has access to all call recordings and transcriptions. These should have already been analyzed.
- For every lead with call recordings:
  - Pull the transcription (if available) or the call summary
  - Generate an Ari analysis: key points discussed, seller sentiment, pain points identified, motivation level assessment, recommended next steps
  - If Anthropic API is connected: send the transcription to Claude for analysis and store the result
  - If Anthropic API is not connected: at minimum, display the call notes, dispositions, and any agent notes that exist
- The briefing section should show Ari's assessment of THIS lead based on ALL available data (calls, texts, emails, dispositions, stage history, property data)
- **Double-click behavior:** When the Ari briefing section is double-clicked, a slide-out panel (drawer) should appear from the RIGHT side of the screen containing:
  - Complete seller notes (all agent notes + system notes chronologically)
  - Full call analysis (transcription summaries, sentiment analysis)
  - Seller pain points (extracted from conversations)
  - Ari's complete assessment and recommendations
  - This panel should be dismissible by clicking outside or a close button

### FIX-19: Seller Pain Points — Must Be Populated
The seller pain points section is EMPTY.
- Pain points should be extracted from:
  - Call transcriptions/notes (keywords: "behind on payments", "divorce", "inherited", "can't afford", "moving", "job loss", "repairs needed", etc.)
  - Agent notes and dispositions
  - Motivation score and reason
- If Anthropic API is available, use it to extract pain points from conversation data
- If not, parse agent notes and disposition reasons for pain point keywords
- Display as tagged items: "Tax Delinquency", "Deferred Maintenance", "Relocation", "Financial Hardship", etc.
- Must not be empty if any conversation or notes exist for the lead

### FIX-20: File Checklist → "Missing Information"
Rename the "File Checklist" section to **"Missing Information"**
- This section should show what data/documents are still needed for this lead
- Items like: Property photos, Repair estimate, Proof of ownership, Title search, Inspection report, etc.
- Each item has a checkbox. When checked, it logs an activity: "[item] received/completed"
- The "Thank you letter sent" item must use a REAL ICON (mail/envelope icon from the icon library), not an emoji
- When clicked/checked, it:
  - Updates the activity section with "[Thank you letter sent to {name} on {date}]"
  - Updates Supabase (the database) immediately
  - Marks the item as complete with a visual indicator (checkmark icon, not emoji)

### FIX-21: Agent Notes — Must Be Addable and Ingested by Ari
There is currently no way to add notes on the expanded lead view. Fix this:
- Add a "Add Note" button or text area on the expanded lead view
- Agent types a note and submits
- Note is saved to the database (lead_activities or a notes table) with: agent_id, lead_id, content, timestamp
- Note appears in the activity feed immediately
- **ARI INGESTION:** When a new note is saved, Ari should process it:
  - Extract any relevant data points (mentioned price → update price pillar, mentioned timeline → update timeline pillar, mentioned condition → update condition, mentioned motivation → update motivation)
  - Update seller pain points if new pain points are mentioned
  - Update the Ari briefing section with new context
  - If Anthropic API is available, send the note for analysis. If not, use keyword extraction.
  - Log what Ari extracted: "Ari updated TIMELINE based on agent note: seller wants to close by June"

### FIX-22: Call Recordings — Must Be Playable
The activity feed shows "Call Recording" entries but there is no option to listen to them.
- Add a play button on call recording activity entries
- Clicking play should:
  - If the recording URL exists (from Twilio): open an audio player inline or in a modal
  - If the recording is stored locally: play from the file
  - If the recording URL is missing: show "Recording unavailable" with an explanation
- Audio player should have: play/pause, progress bar, duration, speed control (1x/1.5x/2x)
- Below the player, show the transcription (if available)

### FIX-23: Generate Contract — Fix 404
The "Generate Contract" button goes to a 404 page. Fix this:
- Instead of navigating to a new page, open a modal/dialog
- The modal should be a contract form pre-populated with all known data points:
  - Buyer: Saving KC Homebuyers LLC (or the entity from settings)
  - Seller: Lead name(s) from the record
  - Property address: From the lead
  - Purchase price: From the deal math MAO or offer amount
  - Earnest money: Default amount (configurable)
  - Inspection period: Default days (configurable)
  - Closing date: Default (30 days from today, adjustable)
  - Contingencies: Standard checkboxes
  - Any other standard purchase contract fields
- The agent reviews the pre-populated data, makes any changes needed
- On "Send Contract":
  - Generate the contract document (PDF or DocuSeal template)
  - Send to the seller's email address
  - Send an SMS notification to the seller's phone: "Your purchase agreement from Saving KC is ready for review. Check your email."
  - Log in activity: "Contract sent to {name} at {email}"
  - Update lead stage to "Offer Made" (Stage 4) if not already
  - Create Ari briefing event: "Contract sent to {name} for {address}"
  - If DocuSeal is connected, create the signing session. If not, attach the generated PDF and log that manual signing is needed.

---

## PHASE 4: Activity Feed Verification

After all the above fixes, verify the activity feed on the expanded lead view is complete and functional:
- [ ] Shows all activities chronologically (newest first)
- [ ] Call entries show: date, duration, disposition, and PLAYABLE recording button
- [ ] SMS entries show: message content, direction (inbound/outbound), timestamp
- [ ] Email entries show: subject, preview, timestamp
- [ ] Notes show: agent name, content, timestamp
- [ ] Stage changes show: from → to, who changed it, reason
- [ ] Contract events show: sent, viewed, signed with dates
- [ ] Mail tracker events show: note queued, mailed, delivered
- [ ] Appointment events show: type, date, time, status
- [ ] "Missing Information" checklist changes logged
- [ ] "Thank you letter sent" logged with icon (no emoji)
- [ ] Every activity that Ari processes shows what Ari extracted/updated

---

## PHASE 5: Final Verification

After all fixes, do a complete walkthrough of:
1. **Leads page:** sorting, filtering, column rearrangement, default sort by recent activity, Street View images, proper case names, formatted phone numbers
2. **Expanded lead view:** every section populated, every button functional, Ari briefing has content, double-click drawer works, pain points populated, notes addable, recordings playable, contract generation works, appointment scheduling works
3. **No test data remaining** in the system
4. **No emojis anywhere** in the UI
5. **Favicon updated** on every page
6. **Phone formatting consistent** system-wide
7. **Name casing consistent** system-wide

---

## OVERNIGHT_LOG_NIGHT7.md FORMAT

```markdown
# Ari CRM — Overnight Mission Log: Night 7
## Date: [today's date]
## Started: [time]

---

## Phase 1: System-Wide Fixes
### FIX-01: Favicon — [status]
### FIX-02: Name Casing — [status]
### FIX-03: Phone Formatting — [status]
### FIX-04: Test Lead Removal — [how many removed]
### FIX-05: Emoji Removal — [how many replaced]

---

## Phase 2: Leads Page
### FIX-06: Street View — [status]
### FIX-07: Column Sorting — [status]
### FIX-08: Column Filtering — [status]
### FIX-09: Column Rearrangement — [status]
### FIX-10: Default Sort — [status]

---

## Phase 3: Expanded Lead Page
### FIX-11 through FIX-23 — [status per item]

---

## Phase 4: Activity Feed Verification — [PASS/issues]

## Phase 5: Final Verification — [PASS/issues]

---

## Blocked Items
[Anything needing external credentials]

---

## Summary
- **System-wide fixes:** X / 5
- **Leads page fixes:** X / 5
- **Expanded page fixes:** X / 13
- **Verification:** [PASS/FAIL]
- **Commits:** X
- **Completed at:** [time]
```

---

## GO

The expanded lead page is the source of truth. Every section must have real data. Every button must work. Every link must go to the right place. No emojis. No test data. No empty sections. No 404s.

When Ernest opens a lead tomorrow morning, he should see a complete property intelligence dossier with Ari's analysis, playable call recordings, populated pain points, working contract generation, appointment scheduling, and real Street View images of the property.

Make it count. This is the polish that makes Ari production-ready.
