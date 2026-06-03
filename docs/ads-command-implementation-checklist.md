# Ads Command Implementation Checklist

Source plan: `/Users/ernestdodson/Downloads/ADS_COMMAND_BUILD_PLAN.md`
Approved visual contract: `/Users/ernestdodson/Downloads/Saving-KC-Google-Ads-Command-Premium.html`

## Current Repo Comparison

- Current route exists at `src/app/(app)/marketing/page.tsx`.
- Current live data endpoint exists at `src/app/api/marketing/ppc-report/route.ts`.
- Existing API reads `leads`, `ppc_conversion_outbox`, `ppc_tracking_events`, `lead_activities`, `manifests`, `appointments`, and `revenue_transactions`.
- Existing API returns the old `PpcReport` shape, not the new named contract (`KPI`, `SERIES`, `CAMPAIGNS`, `KEYWORDS`, `NEGATIVES`, `FUNNEL`, `LEADS`, `PAID_SESSIONS`, `MICRO_STEPS`, `DROP_LABEL`).
- No conversion-write/export route was changed for this pass.

## Phase 1 - Static Shell

- [x] Add seed arrays in `src/lib/marketing/ads-command-seed.ts`.
- [x] Replace `/marketing` with the Ads Command shell on representative seed data.
- [x] Preserve theme toggle with `localStorage` persistence.
- [x] Preserve per-panel period controls.
- [x] Preserve series chips with up to three active trend metrics.
- [x] Preserve campaign view toggle.
- [x] Preserve sortable keyword/negative table.
- [x] Preserve marketing funnel geometry and conversion labels.
- [x] Preserve active lead roster and full lead journey overlay.
- [x] Preserve paid-journey pagination, filters, and micro replay overlay.
- [ ] Visual QA side-by-side against the approved HTML in desktop and mobile.

## Phase 2 - API Contract

- [ ] Add shared TypeScript/Zod schemas matching the seed data shapes.
- [ ] Add `GET /api/marketing/kpis?period=`.
- [ ] Add `GET /api/marketing/series?period=`.
- [ ] Add `GET /api/marketing/campaigns?period=`.
- [ ] Add `GET /api/marketing/keywords?period=`.
- [ ] Add `GET /api/marketing/funnel?period=`.
- [ ] Add `GET /api/marketing/leads?period=`.
- [ ] Add `GET /api/marketing/paid-sessions?period=&limit=&page=`.
- [ ] Add `GET /api/marketing/session/:id`.
- [ ] Unit test empty ranges and shape validation.

## Phase 3 - Google Ads

- [ ] Confirm exact live campaign names before hard-coding a five-campaign map.
- [ ] Add server-side Google Ads client and env checks.
- [ ] Pull account metrics, campaign metrics, search terms, and negatives.
- [ ] Cache by endpoint and period.
- [ ] Surface real cache age in the header sync chip.

## Phase 4 - Supabase Pipeline

- [ ] Build live lead roster from `leads`, `ppc_conversion_outbox`, and manifest data.
- [ ] Build funnel tail and conversion type breakdown from Supabase.
- [ ] Exclude or visibly segregate `dryRun=true` rows from real conversion counts.
- [ ] Keep all dashboard routes read-only.

## Phase 5 - Micro-Event Replay

- [ ] Audit GTM/Stape event stream before assuming `session_events` exists.
- [ ] Confirm required event types and write a dataLayer push spec.
- [ ] Add/read `session_events` indexed by `session_id` and `gclid`.
- [ ] Derive paid-session progress, drop reason, and CRM lead linkage from real events.
- [ ] Chain converted session replay into full lead journey by `leadId`.

## Phase 6 - Polish And Deploy

- [ ] Add panel-level loading skeletons.
- [ ] Add panel-level empty states.
- [ ] Add panel-level error states.
- [ ] Persist per-panel period selections.
- [ ] Verify mobile around 380px.
- [ ] Deploy preview for side-by-side review before production cutover.
