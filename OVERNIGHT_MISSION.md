# ARI CRM — OVERNIGHT AUTONOMOUS MISSION
# crm.savingkc.com — Full Bug Fix + Enhancement Run

---

You are running an autonomous overnight mission on crm.savingkc.com. The owner is going to sleep and will review your work in the morning. There is no one to ask questions to. You must make decisions independently, work methodically, and leave a clean, working application.

## PRIME DIRECTIVE

**This is NOT a rebuild.** The CRM at crm.savingkc.com already exists and is operational. The layout, navigation, and workflow structure reflect how the business actually operates. You are here to FIX what's broken, ENHANCE what's weak, and ADD what's missing — without disrupting what already works.

**Read PROJECT_BRIEF.md first.** It contains the complete spec, the Ari Doctrine, all 129 tracked items organized by category (Fix / Enhance / Add), and the build order. That document is your source of truth for the entire session.

---

## HOW TO WORK TONIGHT

### Phase 0: Audit (First 15-20 minutes)
Before changing a single line of code:

1. **Read the entire project structure.** Every directory, every key file. Understand the framework, libraries, patterns, and conventions already in use.
2. **Read PROJECT_BRIEF.md** completely. Understand the three categories (Fix, Enhance, Add) and the sprint order.
3. **Map the architecture:**
 - How are pages/routes organized?
 - Where is the database schema? What ORM is used?
 - Where are API routes / server actions?
 - Where are shared components?
 - How does state management work?
 - What's connected to external services (Twilio, etc.) and what's stubbed?
 - Where is the existing Ari component/briefing?
4. **Create a file called `OVERNIGHT_LOG.md` in the project root.** Log everything you do tonight in this file — what you found during audit, every bug you fix, every decision you make, every issue you encounter. This is Ernest's morning review document.

Write your audit findings in OVERNIGHT_LOG.md before proceeding.

### Phase 1: Fix What's Broken (Category 1 — All Bugs)
Work through every bug in priority order. For each one:
- Diagnose the root cause (read the code, trace the data flow)
- Implement the minimal fix that solves the problem
- Test that the fix works on the page where the bug exists
- Verify the fix across ALL other pages where that component/data appears
- Log what you did in OVERNIGHT_LOG.md
- Commit with a clear message: `FIX [ID]: [description]`

**Priority order:**

CRITICAL (fix these first — they block core operations):
1. **WEB-01:** savingkc.com lead form not populating to CRM — trace the webhook/API endpoint, find where submissions land, fix why leads aren't being created. This is losing live inbound leads.
2. **LED-01:** Call, SMS, Email icons missing on Leads page — click-to-call not working. Find the component, wire up icons and handlers.
3. **CNV-02:** New Message icon in Conversations not working.
4. **STG-01:** Tile click in Stage/Pipeline view should open expanded contact record — currently does nothing.
5. **CNV-04:** Communications not syncing across pages — all views must pull from same data source.

HIGH (fix next):
6. **STG-02:** Filters & New Lead buttons inoperable on Stage view.
7. **STG-03:** Sort/Filter controls not functional.
8. **HOT-01:** Hot Opportunities — Top 3 cards missing, can't add them.
9. **HOT-02:** Hot Opportunities — double-click doesn't work.
10. **EOD-01:** EOD submission doesn't update submission history.
11. **LED-02:** Street View not loading on lead cards.
12. **LED-04:** Letter tracking missing.
13. **CNV-01:** View Profile link goes nowhere.
14. **CAL-01:** Calendar missing Day view.
15. **CAL-02:** Task click in Calendar should show details popup.
16. **CAL-04:** Agenda — can't click into property or create new task.

MEDIUM:
17. **CAL-03:** Month view overrides week view when not in current month.

### Phase 2: Enhance What's Weak (Category 2)
After all bugs are fixed, move to enhancements. Only start this phase if Phase 1 is 100% complete.

### Phase 3: Add New Capabilities (Category 3)
Only start this phase if Phases 1 and 2 are complete.

---

## RULES FOR THE ENTIRE SESSION

1. **Do NOT reorganize the codebase.** Work within the existing file structure and patterns.
2. **Do NOT rename pages, routes, or components** unless a bug specifically requires it.
3. **Do NOT change the visual design** — preserve existing colors, layout, fonts, spacing.
4. **Preserve all existing functionality** that currently works.
5. **Commit frequently** with clear messages. One commit per fix or logical unit of work.
6. **Log everything in OVERNIGHT_LOG.md** — this is Ernest's morning briefing.
7. **Test globally.** Every fix verified across all pages where that component or data appears.
8. **Don't stop early.** Work through as many items as possible.
9. **If you hit an external dependency you can't resolve**, log it and move on.
10. **Never use real client phone numbers for testing** — use 816-555-xxxx format only.

---

## KEY CREDENTIALS (for wiring integrations)

- **Supabase URL:** https://fprrknfyzlthbxewnwmi.supabase.co
- **Supabase Service Role Key:** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwcnJrbmZ5emx0aGJ4ZXdud21pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU3MTI2NywiZXhwIjoyMDg2MTQ3MjY3fQ.y4WbIp6fQKSpo83BZ8SxlsQXeEDY6NisvAhAr5SUZ0A
- **Twilio SID:** ACa20f2f747d263115871f6053f42912e7
- **Twilio Auth:** 030043bdc9efeb169b0a517f4b78ff91
- **Twilio From:** +18163077835
- **Dialer server:** https://dialer.savingkc.com (running locally at port 3847)
- **Cloudflare API Token:** zRJNXCn2J-f6RToKL3FL9qCMglLhWuBiAJnkCOvC
- **ElevenLabs Key:** sk_0b89a086d4644cac50524717c24550d2f051837cd8f9149c

## DEPLOYMENT

The CRM frontend deploys to Cloudflare Pages (ari-crm.pages.dev / crm.savingkc.com).
After completing work, run: `npm run build && npx wrangler pages deploy dist --project-name ari-crm`

## GO

Start with Phase 0 (audit). Work through Phase 1, 2, 3. Leave OVERNIGHT_LOG.md as your deliverable. The owner reviews in the morning.
