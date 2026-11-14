# Listed and sold market check

The dialer export stays on the suppression classifier from the dialer-label scrub. This check adds the market half.

The Heartland Matrix saved search has to cover the whole metro: Jackson, Clay, Platte, Johnson, and Wyandotte. `target_zips` limits only expired intake and the high-price tag. A pool row whose zip or parcel is not in that metro export is `listing_check_unknown` and is blocked. A blank zip stays blocked until it matches a parcel.

`MLS_MARKET_CHECK_ENABLED` defaults to false. The export does not apply this check until that flag is true. `EXPIRED_OWNER_CONFIRMED` defaults to false. Counsel recorded the override as EXC-2026-11-14-003. Turning that flag on removes only `expired_owner_confirm_pending`. The loader still requires #814's phone block, a line check (fail closed as `line_check_unknown` until #812 merges), `owner_changed`, a same-day relist block for Active, Coming Soon, and Pending, the Monday-Saturday 9am-7pm Chicago window, and a single live-agent line. Expired rows carry `requires_licensee_disclosure`, `basis=owner_override_2026-11-14` (not the 8/29 clearance), and `ks_license_unconfirmed` on Kansas rows. Active high-price listings are tagged only and stay no-contact.

Expired rows stay in the wholesale pool with `requires_licensee_disclosure`. They do not get `off_market_ok`. They still pass DNC, fan-out, the line check, `owner_changed`, and a same-day relist check. A row with no relist check in today's export is `relist_check_missing`.

Active listings in a core or keep zip at or above `mls_price_thresholds.min_list_price` are tagged `active_high_price` / `novation_traditional`. They stay out of the wholesale file and show up in `review_high_price`. Parked and avoid zips are excluded from both tags. Kansas rows set `ks_license_unconfirmed`. `basis` is the lead source.

## Clock

The calling list locks at 4:00am America/Chicago. The Matrix file arrives around 1:30am CT. Load it by 2:30am and finish by 3:30am. Adds and tags at or after 4:00am count on the next day's list. After the lock, jobs may only suppress rows.

Vercel cron is UTC. The route runs at 07:30, 08:30, and 09:30 UTC and keeps the tick that matches local time:

| UTC | CDT | CST |
| --- | --- | --- |
| 07:30 | 2:30am load | 1:30am idle |
| 08:30 | 3:30am deadline | 2:30am load |
| 09:30 | 4:30am idle | 3:30am deadline |

If no export is loaded by 3:30am CT, no new `off_market_ok` rows are written. Expired and high-price tags from the last good export stay. An alert row is logged. The route does not require `CRON_SECRET` and does not download MLS data.

```bash
npx tsx scripts/load-market-check-csv.mts --file ./data/mls-inbox/matrix.csv
npx tsx scripts/load-market-check-csv.mts --file ./data/mls-inbox/matrix.csv --confirm
```

An admin can also post the CSV to `POST /api/admin/market-check`. Do not commit the file.
