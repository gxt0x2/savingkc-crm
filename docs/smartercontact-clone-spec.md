# SmarterContact Clone — Feature Spec & Build Plan

Goal: full feature parity with smartercontact.com inside the Saving KC CRM (Next.js 16, Supabase, Twilio).
Source: live inspection of app.smartercontact.com (Ernest's account, 2026-07-01) + domain knowledge.

## Product overview
SmarterContact is a mass-texting + calling CRM for real-estate investors/wholesalers. Core loop:
upload a list → skip trace → mass text (with number pool for deliverability) → unified inbox to
work replies → drip/workflow automation → book appointments → report on conversion.

## Top-level navigation (parity target)

### 1. Messenger (unified SMS inbox)
- Inbox filters: **All, Unread, Missed calls, Unreplied, Awaiting reply, Opted out, Deleted**
- **Saved filters** (custom saved views)
- **Quick replies** (canned snippets, keyboard-insertable)
- Conversation thread view: full SMS history per contact, send box, contact panel
- Per-number inbox (multiple sending numbers feed one inbox)
- Create new conversation (compose to a number)
- Inbound calls surface as "Missed calls"; voicemail

### 2. Contacts
- **Groups** — uploaded lists (CSV import → group). Each group is a list of contacts.
- **Contacts** — individual contact records; custom fields; tags
- **Deleted contacts**
- **Suppressed contacts** — DNC / do-not-contact / opt-out suppression list
- Add new contact (manual) / Upload file (CSV, max 50MB)
- Custom field mapping on import

### 3. Campaigns
- **Standard campaigns** — one-time or scheduled mass texts to a group. States: Active, Paused, Draft, Completed, Deleted.
- **Keyword campaigns** — inbound: "text KEYWORD to <number>" auto-responder campaigns. Same states.
- **Message templates** — reusable message bodies w/ merge fields ({{first_name}}, {{address}}, etc.)
- **Keyword templates**
- Campaign builder (gated behind paid plan; from knowledge): select group → compose message
  (with spintax/variants for deliverability) → pick sending number(s)/pool → schedule / throttle
  (msgs per hour, sending window/timezone) → launch. Drip follow-ups optional.

### 4. Workflows (automation)
- **Contact workflows** — multi-step, time-delayed automated sequences.
  Columns: Name, Status, Active contacts, Days, Messages.
- Trigger: contact enters workflow (e.g. on reply, on tag, on campaign completion) → send message on
  day 0, day N, ... with conditions/branches. "More workflows (Soon)".

### 5. Dialer (power dialer)
- **Calling campaigns** — outbound calling lists. States: All, Active, Draft, Deleted.
- **Call scripts** — reusable scripts shown to agent during calls.
- Browser-based dialer, call disposition, recording.

### 6. Calendar
- Appointments / scheduling of follow-ups and meetings.

### 7. Skiptrace
- Upload CSV (≤50MB) → append phone numbers + emails from a data provider.
- **Add new** / **All files** (history of skip-trace jobs, downloadable results).

### 8. Reporting
Two tabs: **Messaging** and **Calling**. Filters: Date range, Campaigns, Message template. Export to CSV.
Messaging metrics:
- SMS sent, SMS segments sent, Carrier block rate, Replies received, Delivery rate, Opt-out rate,
  AI filtering rate, Reply rate
- Median response time, Leads, Contacts, SMS→lead conversion rate, Contact→lead conversion rate

### 9. Settings
- **Profile** (name, email, company, mobile, timezone, password, Google connect)
- **Sub accounts** — team members / seats / sub-accounts
- **Messaging campaign setup** — Active incoming #, Incoming calls toggle, Voicemail toggle,
  Call auto-reply toggle, Buy number, **Owned numbers** table (Phone number, Type, Status, Added,
  Last used, SMS sent, **Block rate**, **Active chats**) — this is the number-pool health dashboard
- **Calling campaign setup**
- **Membership** (plan/billing)
- **Notifications**
- **Mobile app**
- **Affiliate program**

## Deliverability primitives (the "secret sauce")
- **Number pool / rotation** — spread sends across many local numbers; track per-number block rate;
  auto-pause/retire numbers with high block rate.
- **Throttling** — messages/hour caps, sending windows, per-number daily caps.
- **Spintax / message variants** — randomize wording to avoid carrier filtering.
- **Opt-out compliance** — STOP/UNSUBSCRIBE auto-handling → suppression list; footer injection.
- **AI filtering** — classify/deprioritize undeliverable or spam-flagged sends.
- **10DLC / carrier registration** awareness (brand/campaign) for compliance.

## Build phases (see companion plan once existing-code map returns)
- Phase 0: data model — contacts/groups/tags/suppression, messages, campaigns, sending numbers, workflows.
- Phase 1: Messenger inbox parity (filters, saved filters, quick replies).
- Phase 2: Contacts + Groups + CSV import + suppression.
- Phase 3: Campaigns (standard) with number pool + throttle + templates + spintax.
- Phase 4: Workflows (drip automation engine + cron).
- Phase 5: Keyword campaigns.
- Phase 6: Dialer parity (call scripts, dispositions).
- Phase 7: Skiptrace integration.
- Phase 8: Reporting dashboards.
- Phase 9: Settings (number health, sub-accounts, compliance).
