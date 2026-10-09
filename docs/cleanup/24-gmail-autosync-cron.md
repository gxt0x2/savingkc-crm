# Gmail Auto-Sync Cron

Date: 2026-05-05

Superseded 2026-10-08: the project is on a plan that allows minute crons, and the schedule is now `*/5 * * * *` (see `src/config/system-registry.json`).

## What Changed

- Added `/api/cron/sync-gmail` to Vercel cron.
- Scheduled Gmail sync once daily at `15 13 * * *`.
- Updated the Settings copy so it no longer promises a 5-minute sync cadence.

## Why

The CRM had a Gmail sync endpoint and working manual `Sync now`, but `vercel.json` did not schedule the endpoint. The live Vercel team is on the Hobby plan, which allows cron jobs but does not support every-15-minute Vercel cron frequency.

## Risk

Low. The cron calls an existing protected route. Vercel sends `Authorization: Bearer $CRON_SECRET`, and the route already requires admin/session/secret auth.

## Rollback

Remove the `/api/cron/sync-gmail` entry from `vercel.json` and redeploy. Manual `Sync now` will continue to work.

## Follow-Up

For near-real-time Gmail sync, use one of these:

- Upgrade Vercel to Pro and change the schedule to `*/15 * * * *`.
- Configure a documented external scheduler that sends `Authorization: Bearer $CRON_SECRET`.
