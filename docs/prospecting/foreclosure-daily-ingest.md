# Foreclosure daily ingest + stale alert

## Why the portal looked frozen

`mortgage_foreclosure_prospects` only grows when something calls the shared CSV import
path (`importForeclosureCsv` / `POST /api/prospecting/foreclosure/import`). There was no
scheduled job. Manual CSV drops stopped around **2026-09-25**, so the CRM UI correctly
showed stale data.

## What this adds

| Piece | Path |
| --- | --- |
| Daily cron | `GET/POST /api/cron/foreclosure-ingest` (Vercel, Mon–Fri 13:30 UTC ≈ 08:30 CT) |
| Shared import | Reuses `importForeclosureCsv` (same as the UI import button) |
| Watermarks | Seeds + advances `mortgage_foreclosure_ingest_controls` per county × notice type |
| Stale alert | Email to `ernest@savingkc.com` via Resend when `max(created_at)` is ≥ 24h on a Chicago weekday |
| Owner flag | `GET /api/prospecting/foreclosure/ingest` now includes `freshness` |

## PropStream — blocked on first-hand docs

This repository has **no** PropStream API client and **no** first-hand PropStream endpoint
documentation. The cron **must not invent** PropStream URLs.

Until PropStream is wired from their real docs, use one of:

1. **CSV drop URL** — set `FORECLOSURE_INGEST_PROVIDER=csv_url` and
   `FORECLOSURE_INGEST_CSV_URL` to an HTTPS URL that returns the pilot CSV header used by
   `parseForeclosureCsv` (see `docs/prospecting/mortgage-foreclosure-sandbox.csv`).
2. **Manual / GH Action POST** — `POST /api/cron/foreclosure-ingest` with
   `Authorization: Bearer $CRON_SECRET` and either:
   - `Content-Type: text/csv` body, or
   - `multipart/form-data` file field `file`, or
   - JSON `{ "csv": "..." }`.

### Secret names (exact)

| Secret | Required for | Notes |
| --- | --- | --- |
| `CRON_SECRET` | Vercel cron auth | Existing |
| `RESEND_API_KEY` | Stale email alert | Existing |
| `RESEND_FROM_EMAIL` | Stale email alert | Existing verified sender |
| `FORECLOSURE_STALE_ALERT_TO` | Alert recipient | Default `ernest@savingkc.com` |
| `FORECLOSURE_STALE_ALERT_MIN_INTERVAL_HOURS` | Alert dedupe | Default `20` |
| `FORECLOSURE_INGEST_ACTOR_EMAIL` | `created_by` / `updated_by` | Default `foreclosure-cron@savingkc.com` |
| `FORECLOSURE_INGEST_PROVIDER` | Provider switch | `csv_url` or `propstream` |
| `FORECLOSURE_INGEST_CSV_URL` | Interim feed | HTTPS CSV drop |
| `PROPSTREAM_API_KEY` | Future PropStream | Do not invent paths |
| `PROPSTREAM_API_BASE_URL` | Future PropStream | **Must** come from PropStream docs |
| `PROPSTREAM_ACCOUNT_ID` | Future PropStream | Optional depending on their docs |

When `FORECLOSURE_INGEST_PROVIDER=propstream` (or any PropStream env is set) without a
documented base URL, the cron returns `provider.status = "not_configured"`, still seeds
watermarks, still evaluates freshness, and may send the stale email. It does **not** call
a fake PropStream API.

## Watermarks

Table: `mortgage_foreclosure_ingest_controls`

- Primary key: `(county, notice_type)`
- Notice types: `lis_pendens`, `nod`, `notice_of_sale`, `sheriff_sale`
- First counties seeded: `jackson`, `johnson`
- `paused=true` skips that slice
- `updated_since` advances only after a successful import with `imported > 0`

UI pause toggles remain on Prospecting → Foreclosure (`PATCH /api/prospecting/foreclosure/ingest`).

## Stale alert rules

- Threshold: `max(created_at)` age ≥ **24 hours**
- Chicago **weekdays only** (weekend freshness is logged; email is suppressed)
- Empty table counts as stale on weekdays
- Fail soft: missing Resend config logs a warning and never invents SMS
- In-process min interval avoids duplicate emails from a noisy retry

## Manual checks

```bash
# Freshness + alert pass (no CSV)
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://crm.savingkc.com/api/cron/foreclosure-ingest | jq .

# Drop a pilot CSV
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: text/csv' \
  --data-binary @foreclosures.csv \
  https://crm.savingkc.com/api/cron/foreclosure-ingest | jq .
```
