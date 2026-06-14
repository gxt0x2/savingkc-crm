# Mojo Session Maintenance

The Mojo sync depends on a browser `sessionid` cookie from `https://app71.mojosells.com`.
Mojo expires that cookie periodically. When it expires, calls stop entering
`mojo_call_queue`, so no leads or manifests can be created from Casey's calls.

## Manual Refresh

Run this from the active cron checkout so the same `.env.live` values are loaded:

```sh
cd "/Users/ernestdodson/Documents/New project/savingkc-crm-fix"
set -a && . ./.env.live && set +a
npm run mojo:session:manual
```

That opens a visible Chrome window on the dedicated Mojo bot profile. Log into
Mojo there. The script waits for a valid session, validates it against Mojo's
activity-stream API, writes it to:

- `/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json`
- CRM `system_config` key `mojo_session_id`

Then run:

```sh
npm run mojo:sync
npm run mojo:queue
```

## Automated Refresh

The normal refresh command is:

```sh
npm run mojo:refresh
```

It runs `scripts/mojo-extract-session.mjs`, which uses the current
`lb11.mojosells.com` login app by default, validates the resulting `sessionid`
against the `app71` activity-stream API, and stores it in disk plus CRM. If the
legacy `app71` form is used explicitly through `MOJO_LOGIN_URL`, the script also
waits for the hidden database field after username blur before submitting.

Recommended weekly crontab entry:

```cron
0 20 * * 0 cd "/Users/ernestdodson/Documents/New project/savingkc-crm-fix" && set -a && . ./.env.live && set +a && /usr/local/bin/node "/Users/ernestdodson/Documents/New project/savingkc-crm-mojo-pipeline/scripts/mojo-cron-runner.mjs" refresh >> /tmp/mojo-session-refresh.log 2>&1 # mojo-session-refresh
```

On the production Mac, the weekly refresh may also run as a user LaunchAgent
when `crontab <file>` is unavailable or blocks:

- plist: `/Users/ernestdodson/Library/LaunchAgents/com.savingkc.mojo-session-refresh.plist`
- schedule: Sunday 8:00 PM local time
- command: `/usr/local/bin/node "/Users/ernestdodson/Documents/New project/savingkc-crm-mojo-pipeline/scripts/mojo-cron-runner.mjs" refresh`
- log: `/tmp/mojo-session-refresh.log`

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
