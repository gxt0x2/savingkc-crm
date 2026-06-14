# Claude Review Brief: Ads Command `Unmapped keyword` Issue

## Context

Repo checkout:

`/Users/ernestdodson/Documents/New project/savingkc-crm-main`

Current preview to inspect:

`https://savingkc-r5h832ijx-gxt0x2s-projects.vercel.app/ppc-command-preview?adsPreviewToken=<redacted-preview-token>`

Branch/worktree caveat:

This checkout is dirty. It includes the Ads Command preview work plus unrelated local changes in other CRM areas. Do not treat the whole worktree as clean branch truth. For this review, focus on the files listed below unless you find a direct dependency.

## Issue

The Ads Command dashboard repeatedly shows `Unmapped keyword` for paid journeys, the active lead roster, and the conversion outbox.

This is not just a display bug. Current live journey rows have campaign and click ID data, but they do not have reliable click-level keyword/search-term text attached to the `gclid`/`gbraid`/`wbraid`.

## Verified Evidence

Preview API checked:

`/api/marketing/ads-command?period=month&previewToken=<redacted-preview-token>`

Observed for month range `2026-05-03` through `2026-06-01`:

- `paidSessions`: `23`
- paid session keyword counts: `{ "Unmapped keyword": 23 }`
- Rob Porter lead keyword: `Unmapped keyword`
- Search Term Performance does have real Google Ads terms, including:
  - `steps to selling a house`
  - `best company to sell house as is`
  - `what is a quick sale for a house`
  - `webuyhouse`
  - `unpaid property taxes`

So the dashboard has aggregated Google Ads search-term rows, but the journey/outbox click rows are not keyword-mapped.

## Likely Cause

The dashboard maps paid journey keywords from attribution fields only:

- `src/app/api/marketing/ads-command/route.ts:813-829` builds tracking attribution from event columns and event payload.
- `src/app/api/marketing/ads-command/route.ts:841-843` returns `utm_term`, `keyword`, `search_term`, or `Unmapped keyword`.
- `src/app/api/marketing/ads-command/route.ts:961-1003` builds Latest Paid Journeys and assigns `kw: keywordFromAttribution(attribution)`.
- `src/app/api/marketing/ads-command/route.ts:1075-1082` builds Active Lead Roster rows and assigns `kw: keywordFromAttribution(attribution)`.
- `src/app/api/marketing/ads-command/route.ts:1149-1161` builds outbox rows and assigns `keyword: keywordFromAttribution(attribution)`.

The tracking layer is capable of storing keyword-like fields if they are present:

- `src/lib/ppc/attribution.ts:34-50` captures URL params including `utm_term`, `keyword`, `matchtype`, `campaignid`, and `adgroupid`.
- `src/lib/ppc/tracking-events.ts:157-196` persists attribution into `ppc_tracking_events`, including `utm_term`, click IDs, and Google Ads campaign/ad group IDs.

But current click/journey rows appear not to contain keyword/search-term params, so every journey falls back to `Unmapped keyword`.

Google Ads reporting import currently stores aggregated search-term rows:

- `src/lib/marketing/google-ads-reporting-sync.ts:232-285` imports from `search_term_view`.
- `src/app/api/marketing/ads-command/route.ts:1197` reads `google_ads_search_term_daily`.
- `src/app/api/marketing/ads-command/route.ts:547-570` builds Search Term Performance from those rows.

Those rows are aggregated by date/campaign/ad group/search term and are not currently joined to specific click IDs.

## Review Request

Please review and answer:

1. What is the safest durable way to attach keyword/search-term text to each paid journey?
2. Should we rely on ValueTrack parameters in the landing URL, a Google Ads click-view import keyed by `gclid`, or both?
3. Can the current Google Ads import be expanded to include a click-level table that maps `gclid`/click ID to campaign/ad group/keyword/search term?
4. If click-level backfill is not available for historical rows, what should the UI label be instead of `Unmapped keyword`?
5. Are there privacy or Google Ads API policy concerns with storing/displaying click-level search term text in the CRM dashboard?

## Preferred Fix Shape

Suggested approach to evaluate:

1. Add Google Ads ValueTrack parameters to PPC landing URLs going forward, such as:
   - `utm_term={keyword}`
   - `keyword={keyword}`
   - `matchtype={matchtype}`
   - `campaignid={campaignid}`
   - `adgroupid={adgroupid}`
   - keep `gclid`/`gbraid`/`wbraid`
2. Confirm `captureAttribution()` stores those params and `buildPpcTrackingEventRow()` persists them.
3. Add a click-level Google Ads import if feasible, keyed by click ID, for backfill and reconciliation.
4. Update `Ads Command` keyword resolution to prefer:
   - captured URL keyword/search term
   - click-level import lookup by `gclid`/`gbraid`/`wbraid`
   - lead/outbox attribution fields
   - only then a clear fallback label.

## Acceptance Criteria

- Latest Paid Journeys does not show `Unmapped keyword` for new paid clicks when Google Ads landing URLs include keyword params.
- Active Lead Roster and Lead Conversion Outbox show the same mapped keyword for the associated lead/click.
- Search Term Performance remains based on Google Ads search-term import and does not invent lead attribution.
- If historical rows cannot be mapped, the UI clearly labels them as missing click keyword data rather than implying a real keyword named `Unmapped keyword`.
- No fake keyword values are generated from aggregate search-term rows unless there is a defensible click-level join.

## Do Not Do

- Do not randomly assign a search term from aggregate Google Ads rows to a click just to remove `Unmapped keyword`.
- Do not mutate production outbox rows as part of this review.
- Do not remove the fallback without replacing it with a more truthful label or mapping path.
