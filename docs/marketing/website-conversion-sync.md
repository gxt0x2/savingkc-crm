# Website conversion board

Route: `/marketing/website-conversion`

The board is the daily, weekly, monthly, quarterly, and yearly read of Saving KC website conversion. It is inside the Marketing section of the CRM, next to Google Ads. Signed-in CRM users load it through `GET /api/marketing/website-conversion?range=day|week|month|quarter|year`. The API uses the service role after that sign-in check. The browser never receives a service key.

Saving KC Homebuyers was founded in 2014. Seller conversations stay at (816) 429-2900 and support@savingkc.com. This board does not buy media. It reads warehouse rows that the nightly sync already stored.

## What “Day” means

Ranges are calendar windows in America/Chicago, and they end on yesterday. The nightly job writes through yesterday, so “today” is not on the board until the next run. Week is Monday through that yesterday. Month, quarter, and year run from the start of that period through the same day.

## Nightly feed

The warehouse is not filled by a Vercel cron. Production Atlas (`fprrknfyzlthbxewnwmi`) already has:

1. pg_cron job `analytics-sync-nightly`, schedule `17 8 * * *` (08:17 UTC, early morning in Kansas City).
2. `public.analytics_sync_invoke('{"mode":"nightly"}')`, which posts to the Supabase edge function `analytics-sync`. The caller token stays in Vault as `analytics_sync_token`. The function checks it and does not use a CRM user session.
3. Nightly mode pulls the last three days through yesterday for both sources. A separate backfill mode can pass `source` and `since`. Backfill is not part of the board.

The edge function writes:

| Table | Grain | Conflict key |
| --- | --- | --- |
| `ga4_landing_daily` | GA4 date, landing page, session source / medium | `date, landing_page, session_source_medium` |
| `gsc_page_query_daily` | Search Console date, page, query, country, device | `date, page, query, country, device` |

GA4 metrics stored on each row are sessions, engaged sessions, key events, and new users. Search Console stores clicks, impressions, CTR, and position. Each run is logged in `analytics_sync_runs`. Table comments name the edge function as the writer and mark the Search Console table read-only for the CRM.

Secrets used by the function, and not by this board, are `SKC_ANALYTICS_SA_JSON` (a Google service account with Analytics and Search Console read scopes) and `GA4_PROPERTY_ID`. The Search Console site is `sc-domain:savingkc.com`.

The board reads `date` as a calendar date. That matches a Chicago GA4 property and the nightly “through yesterday” cutoff. It does not call the Google Analytics or Search Console APIs.

## How the board aggregates

- Sessions, engaged sessions, and engagement rate are sums from `ga4_landing_daily`. Engagement rate is engaged sessions divided by sessions.
- Source split keeps six buckets: `chatgpt.com / ai-assistant`, `google / organic`, `bing / organic`, `google / cpc`, direct (`(direct) / (none)`), and other. Anything else, including `(not set)` and referrals, stays in other.
- Landing pages are normalized to a path. `https://savingkc.com/` and `https://www.savingkc.com/` both become `/`. Trailing slashes are removed. Empty and `(not set)` stay visible as `(not set)`.
- Search clicks and impressions are summed across query, country, and device. Position is the impression-weighted average. The stored CTR column is ignored and recomputed from the summed clicks and impressions. Search Console drops some low-volume rows, so these totals can undercount. They are not unique visitors.
- Website form leads are `leads` rows whose `source` is exactly `website_form`, counted by `created_at` inside the Chicago window. They are not attributed to a landing page because that column is not on the lead.
- Session-to-form is website form leads divided by GA4 sessions. Engaged-to-form uses engaged sessions. Either rate stays blank when the denominator is zero or either source is missing.
- The first-party funnel reads `ppc_tracking_events` where `is_test` is false. Landing events are `ppc_landing_request` and `ppc_visit_started`. Any other event is “later,” except `legacy_attribution_backfill`, which is excluded. Session counts use `session_id` when it is present.
- Call intent is trackable. Tel clicks are `phone_click` and `skc_phone_number_selected`. Phone leads are `google_ads_phone` and `google_ads_tax_phone`.

## Empty states

A section says “Not synced” when its table is missing, or when the table has no rows for the range and no successful `analytics_sync_runs` row covers the start of that range. A successful sync that covered the day and stored nothing shows a real zero. Days after the last successful `until_date` stay blank on the chart instead of being drawn as zero. The page rules do not run until GA4 rows exist.

## Suggestion rules

These are fixed rules. The board does not call a model.

- A page other than `/call` and `(not set)` with at least 10 sessions and an engaged rate under 15%.
- Form conversion is 0% when sessions are greater than 20 and website form leads are 0.
- `/call` is called out as a bounce when it has at least 5 sessions and an engaged rate under 15%.
- `/about` or `/about-us` with any sessions reminds that the About seller form sits below the fold.

The panel keeps at most eight suggestions. The form, `/call`, and About rules are kept ahead of the longer low-engagement list.
