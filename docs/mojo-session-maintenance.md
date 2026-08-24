# Mojo Session Maintenance

The Mojo sync depends on a browser `sessionid` cookie from `https://app71.mojosells.com`.
Mojo expires that cookie periodically. When it expires, calls stop entering
`mojo_call_queue`, so no canonical call evidence or approved lead snapshots can
be created from Casey's calls.

## Manual Refresh

Run this from the active CRM checkout so the same `.env.live` values are loaded:

```sh
cd "/absolute/path/to/the/active/savingkc-crm-checkout"
set -a && . ./.env.live && set +a
npm run mojo:session:manual
```

That opens a visible Chrome window on the dedicated Mojo bot profile. Log into
Mojo there. The script waits for a valid session, validates it against Mojo's
activity-stream API, writes it to:

- `/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json`
- CRM `system_config` key `mojo_session_id`

Then run the protected reconciliation first:

```sh
npm run mojo:reconcile -- --start 2026-06-10
```

This command is permanently dry-run-only. It writes a private local summary
with a dataset digest, approved lead-field diffs, ambiguous identities, and
blocked canonical property/source diffs. It cannot enqueue or update CRM data.
After the ownership migration is deployed, a reviewed report can be applied
only with its exact fresh dataset digest:

```sh
npm run mojo:apply-reviewed -- --apply-reviewed --report "/absolute/path/to/report.json"
```

The apply command refuses reports older than 24 hours, any ambiguity or
protected write, a changed Mojo dataset, or a missing production ownership
marker. It ingests only the matched record IDs as historical evidence and
approved lead snapshots. It intentionally suppresses assignment, lifecycle,
appointment, follow-up, and DNC commands from old calls; those governed actions
remain enabled for new live calls handled by the supervised runner.

## One supervised runner

The production Mac uses one LaunchAgent, not separate sync, end-of-day, or
session-refresh cron entries. Install it only after a valid session and a clean
reconciliation report exist:

```sh
scripts/install-mojo-supervisor.sh --apply
```

The installer backs up crontab, removes only the three tagged legacy Mojo jobs,
and installs `com.savingkc.mojo-supervised-sync`. The runner is overlap-locked,
does no work outside 8 AM-6 PM Central weekdays, refreshes an expired session
once, runs the canonical delta fetch, persists a heartbeat, and calls the CRM
health monitor. Authentication, sync, timeout, and freshness failures create a
CRM briefing plus a throttled SMS alert.

The server queue processor, email fallback, and health monitor remain Vercel
crons. They are not duplicate upstream fetchers: only the supervised Mac runner
can fetch the browser-session-protected activity stream.

## Field ownership

- Mojo owns immutable call evidence: provider record ID, timestamp, duration,
  disposition, agent, notes, recording, follow-up, list, and campaign evidence.
- Mojo may fill a blank/placeholder contact name, blank phone, or blank email.
- The newest call may update only `mojo_record_id`, `call_result`, and
  `call_duration_seconds` on the lead.
- Assignment, lifecycle, appointment, callback task, and DNC changes go through
  governed commands; Mojo does not write those fields directly.
- County, tax-delinquent, deceased, property, valuation, occupancy, and source
  fields remain controlled by canonical CRM/county datasets. Mojo values are
  evidence only and never overwrite them.

## Expiry Alerting

When Mojo redirects to `/login/` or returns login HTML instead of JSON, the sync
scripts now:

- log `Mojo session expired - manual refresh required`
- mark the local session file expired
- set CRM `system_config` keys:
  - `mojo_session_status=expired`
  - `mojo_session_last_error`
  - `mojo_session_last_error_at`
  - `mojo_sync_health=down`
- create a critical Ari briefing event
- send Ernest an SMS alert through Twilio, throttled by
  `MOJO_SESSION_ALERT_MIN_INTERVAL_MINUTES`

On a successful refresh or sync, the scripts set `mojo_session_status=healthy`
and `mojo_sync_health=healthy`.
