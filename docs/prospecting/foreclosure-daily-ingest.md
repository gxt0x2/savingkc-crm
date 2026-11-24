# Foreclosure daily ingest + stale alert

## Why the portal looked frozen

`mortgage_foreclosure_prospects` only grows when something calls `importForeclosureCsv`.
There was no scheduled job. The Sep 25 rows were a one-time county backfill, not PropStream
and not a daily upload. Newest `created_at` stayed on that backfill.

## What runs

| Piece | Path |
| --- | --- |
| Daily cron | `GET/POST /api/cron/foreclosure-ingest` (Vercel, Mon–Fri 13:30 UTC ≈ 08:30 CT) |
| Provider | `county_public` (default). No owner upload. |
| Shared import | `importForeclosureCsv` |
| Watermarks | Seeds and advances `mortgage_foreclosure_ingest_controls` for jackson/johnson × notice types after `imported > 0` |
| Stale alert | Resend email to `ernest@savingkc.com` when the later of `max(created_at)` and `max(updated_at)` is ≥ 24h on a Chicago weekday |
| Owner flag | `GET /api/prospecting/foreclosure/ingest` includes `freshness` |

`updated_at` counts as a landing because the cron upserts rows that already exist. A quiet upsert still means the job wrote.

## county_public sources

These are the same public artifacts as the Sep 2026 backfill. The cron downloads them itself.

| Source | URL | What it fills |
| --- | --- | --- |
| JoCo sheriff | `https://jims.jocosheriff.org/fs/api/ForeclosureSales/GetAllSales` | Johnson KS parties, case, sale status. No street address. |
| SouthLaw KS PDF | `https://www.southlaw.com/report/Sales_Report_KS.pdf` | Johnson situs, sale time, opening bid, firm file. Firm-only, not the whole market. |
| SouthLaw MO PDF | `https://www.southlaw.com/report/Sales_Report_MO.pdf` | Jackson sale calendar. No borrower name. |
| Legal Record | `https://thelegalrecord.net/LR.pdf` | Johnson MF civil filings (plaintiff / defendant / case). **TF tax rows are excluded.** No street on the filing line. |
| NoticeRegistry | `https://www.noticeregistry.com/notices-sitemap/missouri/1` (also `/2` and `/3`) then notice HTML | Jackson File N when the page text says Jackson County and includes “executed by {owner}”. |

Rows import only when both an owner and a situs exist:

- Jackson: NoticeRegistry owner + address, sale date filled from SouthLaw MO when the street number and ZIP match.
- Johnson: JoCo defendant + SouthLaw KS address on the same case number. Legal Record MF rows import only when that case is already on the SouthLaw KS PDF.
- JoCo sales and Legal Record filings with no street stay in the run notes (`skipped_no_situs`). SouthLaw rows with no borrower stay `skipped_no_owner`. They are not given a fake owner.

Opening bid is stored as `appraised_or_opening_bid` only. It is not estimated debt.

## mopublicnotices — computerUse gap

`https://www.mopublicnotices.com/` is the Jackson paper-of-record search. Its ASP.NET postback returns the homepage to headless `fetch` (confirmed 2026-09-25). **Do not pretend a curl search works.** A computerUse browser session has to run that search. Until then NoticeRegistry is the File N proxy and is incomplete versus the Daily Record (legal-only situses and some trustee notices never appear there).

## What this is not

- **No PropStream ingest.** This repository has no PropStream API client and must not invent paths, base URLs, or account calls. PropStream is optional later for equity (AVM / liens) only.
- **No MLS ingest.** Heartland Matrix is listed inventory. It can overlay value and comps after a filing has a situs. It does not replace NOD, lis pendens, trustee notice, or sheriff sale feeds.
- **No manual CSV.** `FORECLOSURE_INGEST_PROVIDER=csv_url` or a POST body exists only as a replay hatch. Ernest does not upload.

## Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `CRON_SECRET` | yes | Existing Vercel cron auth |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | for the stale email | Fail soft if missing. No SMS. |
| `FORECLOSURE_STALE_ALERT_TO` | no | Default `ernest@savingkc.com` |
| `FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS` | no | Default `20` |
| `FORECLOSURE_INGEST_ACTOR_EMAIL` | no | Default `foreclosure-cron@savingkc.com` |
| `FORECLOSURE_INGEST_PROVIDER` | no | Default `county_public` |
| `FORECLOSURE_NR_PAGE_CAP` | no | Default `36` (5–80) NoticeRegistry pages per run |

Do not set `PROPSTREAM_API_KEY`, `PROPSTREAM_API_BASE_URL`, or `PROPSTREAM_ACCOUNT_ID` for this cron. They are not read.

## Watermarks

Table `mortgage_foreclosure_ingest_controls`, key `(county, notice_type)`.

- Notice types: `lis_pendens`, `nod`, `notice_of_sale`, `sheriff_sale`
- Counties seeded: `jackson`, `johnson`
- `paused=true` skips import for every active slice (the public pull is one CSV, not per-slice HTTP calls)
- `updated_since` advances only after `imported > 0`
- The public snapshots are not filtered by `updated_since`. The watermark shows the last successful write.

## Stale alert

- Threshold: later of newest `created_at` and newest `updated_at` ≥ 24 hours
- Chicago weekdays only
- Empty table is stale on weekdays
- Missing Resend config logs a warning and does not send SMS

## Manual check

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://crm.savingkc.com/api/cron/foreclosure-ingest | jq '{ok,provider:.provider.status,import:.import,freshness:.freshness,notes:.notes}'
```
