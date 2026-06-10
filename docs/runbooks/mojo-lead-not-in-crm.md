# Runbook: Mojo-tagged contact not appearing in the CRM

**Current case:** Bartley Hampton — tagged in Mojo on 2026-06-10, still not in the CRM 15+ minutes later.

This doc is written for dispatch. Run the steps in order, copy the outputs listed
in **"Report back"** at the bottom, and send them to engineering. Steps 0–1 take
about 5 minutes and usually identify the cause on their own.

---

## Case reference data

| Field | Value |
|---|---|
| Name in Mojo / prospect list | BARTLEY HAMPTON (county record: "HAMPTON, BARTLEY A.") |
| Phone 1 | +1 913-284-6550 |
| Phone 2 | +1 913-284-1102 |
| Property 1 | 10109 Lamar Ave, Overland Park, KS 66207 |
| Property 2 | 8375 Carter St, Overland Park, KS |
| Expected lead source | `mojo_call` (shows as the "Mojo" badge in the CRM) |

## How the pipeline works (30-second version)

1. Casey dials prospects in Mojo (app71.mojosells.com).
2. A cron job on **Ernest's Mac** (`scripts/mojo-sync.mjs`, every 15 min, 8a–5p M–F)
   reads Casey's Mojo activity stream using a saved login cookie.
3. It syncs **only "meaningful" contacts**: group/tag is *exactly* `Follow Up` or
   `Appointment Set`, OR an appointment/follow-up was scheduled, OR Mojo marked
   them "qualified as lead", OR the call note contains seller intel. Everything
   else is silently skipped — and the 5:30pm end-of-day sweep applies the
   **same filter**, so a skipped contact stays skipped.
4. Synced calls land in the `mojo_call_queue` table; a worker (cron-job.org,
   every 5 min, 9–5 CT M–F) creates/updates the CRM lead.

A break at any of these four points produces "tagged in Mojo but not in the CRM."

---

## Step 0 — Search the CRM by PHONE, not name (~2 min, no Mac needed)

In the CRM, search for `9132846550` and then `9132841102`.

- **Lead found with either phone:** the call merged into an existing record
  (matching is phone-first; the lead keeps its original name, so a name search
  misses it). Open the lead, confirm today's Mojo call/note is on it, and copy
  the lead URL into the report. **Likely done — no further steps needed.**
- **Nothing found:** continue to Step 1.

## Step 1 — On Ernest's Mac: read the sync log (~3 min)

```bash
tail -60 ~/.openclaw/workspace/memory/logs/mojo-sync.log
```

Copy the full output into the report, then match it against this table:

| What the log shows | Meaning | Next step |
|---|---|---|
| `No valid session found. Run session extraction first.` | Mojo login cookie expired — **nothing** has synced since it died | Step 2 |
| Entries stop hours/days ago (no run in the last 15 min during 8a–5p) | Cron not firing or Mac was asleep | Step 2b |
| Recent run says `Built 0 meaningful calls, skipped N non-meaningful` around the time Casey tagged him | The tag Casey used doesn't match the filter | Step 4 |
| A line `→ BARTLEY HAMPTON (...)` with a disposition | Sync worked; problem is downstream in the queue | Step 3 |

## Step 2 — Refresh the Mojo session (only if Step 1 said "No valid session")

```bash
cd ~/savingkc-crm
set -a && . ./.env.live 2>/dev/null || . ./.env.local && set +a
node scripts/mojo-extract-session.mjs
node scripts/mojo-sync.mjs
tail -20 ~/.openclaw/workspace/memory/logs/mojo-sync.log
```

(`mojo-extract-session.mjs` opens Chrome and logs into Mojo as savingkc@gmail.com;
it needs `MOJO_PASSWORD` from the env file loaded above.)

Then check the CRM again after ~5 minutes (the queue worker runs every 5 min).
If Casey tagged other people today while the session was dead, also run the
catch-up sweep for today:

```bash
node scripts/mojo-eod-sweep.mjs
```

Note: the sweep still applies the meaningful-tag filter — if Bartley doesn't
appear after this, ALSO do Step 4.

### Step 2b — If the log shows no recent runs at all

```bash
crontab -l | grep -i mojo
pmset -g | grep sleep
```

Copy both outputs into the report. If the crontab line is missing, that's the
root cause — report it and engineering will restore it.

## Step 3 — Check the queue (only if the log shows Bartley synced)

```bash
cd ~/savingkc-crm
node scripts/mojo-queue-status.mjs --since=6h
```

Look for his record (contact name or record_id). Copy the output, especially
`status` and `last_error`:

- `status=completed` with a `lead_id` → he IS in the CRM; open that lead id directly.
- `status=dead_letter` → processing crashed 3 times; the `last_error` text is
  exactly what engineering needs.
- `status=pending` for more than ~10 min during business hours → the
  cron-job.org worker isn't firing; check the job's execution history at
  cron-job.org (account: ernest@savingkc.com).

## Step 4 — In Mojo: capture exactly how he was tagged

Open Bartley Hampton's contact in Mojo and record:

1. The **exact name(s)** of the group/tag(s) on him — exact spelling matters
   (`Follow Up` syncs; `Follow-Up`, `Follow Ups`, `Hot`, `Interested`, etc. do NOT).
2. Whether a follow-up call or appointment was scheduled (and for when).
3. The text of Casey's note on the contact.
4. A screenshot of the contact page if possible.

If the tag isn't exactly `Follow Up` or `Appointment Set`, that's the root
cause: the sync filter silently drops it. Engineering will widen the filter —
the exact tag name from item 1 is what they need to do it.

## Optional remote checks (no Mac access, needs CRON_SECRET)

Use the `CRON_SECRET` value from Vercel env vars (do not pull it from any doc
in this repo — it's slated for rotation, see `docs/SECURITY-ROTATION-CHECKLIST.md`):

```bash
# When did the Mac-side sync last run successfully? (updatedAt should be < 20 min old during business hours)
curl -H "Authorization: Bearer $CRON_SECRET" "https://crm.savingkc.com/api/admin/mojo-session"

# Timestamp of the last meaningful call synced
curl -H "Authorization: Bearer $CRON_SECRET" "https://crm.savingkc.com/api/admin/system-config?key=last_mojo_sync_timestamp"
```

---

## Report back to engineering

- [ ] Step 0: lead found by phone? If yes: lead URL
- [ ] Step 1: the 60-line log tail (paste as text)
- [ ] Step 2: if run — did Bartley appear after the manual sync? (yes/no)
- [ ] Step 2b: if run — crontab output
- [ ] Step 3: if run — queue status output, esp. `last_error`
- [ ] Step 4: exact tag name(s), follow-up/appointment time, note text, screenshot

## What engineering will do with the results

| Finding | Fix |
|---|---|
| Tag name doesn't match filter | Patch `MEANINGFUL_GROUPS` matching in `scripts/mojo-sync.mjs` + `scripts/mojo-eod-sweep.mjs` (loose/configurable match), then re-run the EOD sweep for the missed day |
| Session keeps expiring | Already handled by re-extraction; consider scheduling `mojo-extract-session.mjs` daily before market hours |
| Dead-letter error | Fix per `last_error`, then reset the queue item to pending |
| Crontab missing | Restore the cron entries on the Mac |
