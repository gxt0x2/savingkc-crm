# TC Build Spec — Title Company / Transaction Coordinator Layer

**Repo:** `savingkc-crm`
**Target app:** `crm.savingkc.com`
**Stack:** Next.js 16 App Router, React 19, Supabase, DocuSeal, Twilio
**Written:** 2026-04-28

## Mission

Build the post-assignment closing command center for Saving KC. Once a buyer offer is accepted and an assignment contract is sent/signed, the CRM must stop treating the deal as "done" and start managing the title-company / transaction-coordination workflow through closing.

The final product should give Ernest one place to see:

- Which assigned deals need title-company action.
- Which title company, closer, escrow officer, and file number are attached.
- Whether the assignment contract is signed, opening package sent, EMD confirmed, title cleared, closing scheduled, HUD/settlement statement received, and revenue logged.
- What Ari thinks is at risk and what needs to happen next.

This is not a rebuild. Add this as a focused layer on top of the existing disposition, offer, assignment, document, manifest, and Ari patterns.

## Existing Reality

Use these real paths. Do not invent `app/dispositions/...`; this repo uses `src/app/(app)/dispo/...`.

- Dispo UI pages:
  - `src/app/(app)/dispo/offers/page.tsx`
  - `src/app/(app)/dispo/pipeline/page.tsx`
  - `src/app/(app)/dispo/deals/page.tsx`
  - `src/app/(app)/dispo/vendors/page.tsx`
- Assignment preview pattern:
  - `src/components/dispo/assignment-preview-modal.tsx`
- Assignment APIs:
  - `src/app/api/offers/[id]/assignment/route.ts`
  - `src/app/api/offers/[id]/assignment/send/route.ts`
- DocuSeal webhook:
  - `src/app/api/docuseal/webhook/route.ts`
- Existing assignment tracking migration:
  - `supabase/migrations/20260424_assignment_tracking.sql`
- Dispo platform migration:
  - `supabase/migrations/20260421_disposition_platform.sql`
- Dispo types:
  - `src/types/dispo.ts`
- Document taxonomy:
  - `src/lib/documents.ts`
  - `src/app/api/documents/route.ts`
  - `src/app/api/documents/[id]/route.ts`
- Manifest write doctrine:
  - `src/lib/manifest-sync.ts`
  - `src/lib/manifest/schema.ts`
  - `docs/manifest-write-audit-2026-04.md`
  - `docs/manifest-v2-1-spec/00_README_START_HERE.md`
- Stage logic:
  - `src/lib/stage-logic.ts`
  - `src/lib/stage-timeout.ts`
- Tests:
  - `vitest.config.ts`
  - `playwright.config.ts`
  - `tests/`

## Corrected Architecture Decision

Claude's original direction was right to assume full repo access. The correction is scope and naming:

- Treat `TC` as "Title Company / Transaction Coordinator", not a separate app.
- Store TC state in first-class tables, not inside one overloaded JSON blob.
- Mirror essential TC status into the lead manifest only through the canonical manifest write path.
- Keep DocuSeal assignment state on `buyer_offers`; do not duplicate it in the TC tables.
- Link one TC file to one accepted buyer offer and one dispo deal.

## Database Work

Add one migration under `supabase/migrations/` named with the current date, for example:

`supabase/migrations/20260428_tc_closing_files.sql`

Create these tables:

### `title_companies`

Fields:

- `id uuid primary key default gen_random_uuid()`
- `name text not null`
- `office_phone text`
- `office_email text`
- `address text`
- `preferred boolean default false`
- `notes text`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- unique lower-name index to avoid duplicates.
- preferred index where `preferred = true`.

### `title_contacts`

Fields:

- `id uuid primary key default gen_random_uuid()`
- `title_company_id uuid references title_companies(id) on delete cascade`
- `name text not null`
- `role text` such as closer, escrow_officer, processor, attorney
- `email text`
- `phone text`
- `is_primary boolean default false`
- `notes text`
- timestamps

Indexes:

- `title_company_id`
- primary contact partial index where `is_primary = true`.

### `tc_files`

Fields:

- `id uuid primary key default gen_random_uuid()`
- `lead_id uuid not null references leads(id) on delete cascade`
- `dispo_deal_id uuid references dispo_deals(id) on delete set null`
- `buyer_offer_id uuid references buyer_offers(id) on delete set null`
- `title_company_id uuid references title_companies(id) on delete set null`
- `title_contact_id uuid references title_contacts(id) on delete set null`
- `file_number text`
- `status text not null default 'not_opened'`
- `opened_at timestamptz`
- `emd_due_at timestamptz`
- `emd_confirmed_at timestamptz`
- `title_clear_at timestamptz`
- `closing_scheduled_at timestamptz`
- `closing_completed_at timestamptz`
- `hud_received_at timestamptz`
- `assignment_fee numeric`
- `revenue_logged_at timestamptz`
- `next_action text`
- `risk_level text not null default 'normal'`
- `risk_reason text`
- `notes text`
- timestamps

Allowed `status` values:

- `not_opened`
- `opening_package_needed`
- `opened`
- `emd_pending`
- `title_work`
- `clear_to_close`
- `scheduled`
- `closed`
- `cancelled`

Allowed `risk_level` values:

- `normal`
- `watch`
- `urgent`
- `blocked`

Indexes:

- `lead_id`
- `buyer_offer_id`
- `dispo_deal_id`
- `status`
- `risk_level`
- `closing_scheduled_at`
- unique partial index on `buyer_offer_id where buyer_offer_id is not null`.

### `tc_tasks`

Fields:

- `id uuid primary key default gen_random_uuid()`
- `tc_file_id uuid not null references tc_files(id) on delete cascade`
- `task_type text not null`
- `label text not null`
- `status text not null default 'open'`
- `due_at timestamptz`
- `completed_at timestamptz`
- `assigned_to text`
- `source text not null default 'system'`
- `notes text`
- timestamps

Allowed statuses:

- `open`
- `done`
- `waived`
- `blocked`

Seed standard tasks when a file opens:

- Send opening package to title.
- Confirm assignment contract fully signed.
- Confirm EMD receipt.
- Confirm title file number.
- Confirm title clear.
- Schedule closing.
- Collect HUD / settlement statement.
- Log assignment revenue.

### `tc_events`

Fields:

- `id uuid primary key default gen_random_uuid()`
- `tc_file_id uuid not null references tc_files(id) on delete cascade`
- `event_type text not null`
- `payload jsonb not null default '{}'::jsonb`
- `actor text not null default 'system'`
- `created_at timestamptz default now()`

Use this as the audit trail for status changes and external events.

## API Work

Follow existing route-handler style and `supabaseAdmin()` from `src/lib/supabase/admin`.

Add:

- `src/app/api/tc/files/route.ts`
  - `GET`: list TC files with lead, offer, buyer, title company, primary contact, open tasks.
  - `POST`: create or upsert a TC file from `lead_id`, `buyer_offer_id`, optional `dispo_deal_id`.
- `src/app/api/tc/files/[id]/route.ts`
  - `GET`: full TC file detail.
  - `PATCH`: update file fields, status, risk, dates, title company/contact.
- `src/app/api/tc/files/[id]/tasks/route.ts`
  - `POST`: create a task.
  - `PATCH`: bulk update task statuses if useful.
- `src/app/api/tc/tasks/[id]/route.ts`
  - `PATCH`: update or complete one task.
- `src/app/api/tc/title-companies/route.ts`
  - `GET`: list companies and contacts.
  - `POST`: create company.
- `src/app/api/tc/title-companies/[id]/contacts/route.ts`
  - `POST`: add contact.

API rules:

- Validate request bodies with Zod or local narrow guards.
- Do not accept arbitrary status strings.
- Every status-changing mutation writes a `tc_events` row.
- When TC file status reaches `closed`, update `dispo_deals.stage = 'closed'` if the linked deal is not already closed.
- When revenue is logged, insert or update the appropriate financial row using the existing revenue pattern in `src/app/api/financials/route.ts` / `supabase/migrations/005_financial_tracking.sql`.

## Automation Hooks

### Assignment Signed

Update `src/app/api/docuseal/webhook/route.ts`.

When the assignee has completed and `buyer_offers.assignment_signed_at` is set:

1. Look up the accepted `buyer_offers` row by `assignment_submission_id`.
2. Find the linked `dispo_deals` row by `lead_id` and accepted offer if present.
3. Create a `tc_files` row if none exists for `buyer_offer_id`.
4. Set TC status to `opening_package_needed`.
5. Seed standard `tc_tasks`.
6. Write a `tc_events` row with event type `assignment_signed`.

Do not make webhook delivery depend on non-critical follow-up work. If TC creation fails after the offer update succeeds, log the error and return a non-500 only if the current webhook behavior already does that. Prefer a helper so this remains readable.

### Offer Accepted

Update `src/app/api/offers/route.ts`.

When an offer moves to `accepted`, create or update the corresponding `dispo_deals` accepted buyer/offer fields if that is not already handled, then ensure a TC file exists in `not_opened` status. This makes the TC queue visible before DocuSeal is fully signed.

### Manifest Sync

Add a small helper in `src/lib/tc-manifest-sync.ts`:

- `syncTcStatusToManifest(leadId, tcFileSummary)`

It must call the canonical manifest write path from `src/lib/manifest-sync.ts`. Do not write to `manifests` directly. The manifest subtree should be shallow-replaced, for example:

```ts
closing: {
  tc_file_id,
  title_company,
  title_contact,
  file_number,
  status,
  risk_level,
  closing_scheduled_at,
  emd_confirmed_at,
  hud_received_at,
  next_action,
}
```

If the current `ManifestV2` schema does not support this subtree yet, update `src/lib/manifest/schema.ts` and its fixtures/tests. Do not add `manifest.manifest.*` nesting and do not deep merge caller input.

## UI Work

Add a new page:

`src/app/(app)/dispo/tc/page.tsx`

Use the visual language of the existing dispo pages. This is an operational work surface, not a marketing screen.

The first screen should show:

- Status tabs: All, Needs Opening Package, EMD Pending, Title Work, Clear to Close, Scheduled, Closed, Blocked.
- Dense TC file table or board with:
  - Property address.
  - Seller/lead name.
  - Buyer.
  - Assignment status.
  - Title company/contact.
  - File number.
  - Closing date.
  - Open task count.
  - Risk badge.
  - Next action.
- Row click opens a detail drawer or modal.

Detail drawer should include:

- Title company selector.
- Contact selector.
- File number input.
- Status segmented control.
- Core date fields.
- Task checklist.
- Event timeline.
- Notes.
- Links to lead, dispo deal, accepted offer, assignment document if available.

Add navigation entry wherever the existing app shell defines dispo nav. Inspect `src/app/(app)/layout.tsx` and any nav component it imports before editing.

Use existing `Icon` component from `src/components/ui/icon` unless the relevant UI uses a different local pattern.

## Existing Page Integrations

Update these pages lightly:

- `src/app/(app)/dispo/offers/page.tsx`
  - For accepted offers, show whether a TC file exists and its status.
  - Add action "Open TC File" or "View TC File".
- `src/app/(app)/dispo/pipeline/page.tsx`
  - On under-contract / closed-stage cards, show TC risk/status badge.
- `src/app/(app)/dispo/deals/page.tsx`
  - Expose TC status and closing date on deal rows.
- `src/app/(app)/leads/[id]/page.tsx`
  - In the deal/contract area, show TC status when present.

Keep these integrations small. The main workflow belongs on `/dispo/tc`.

## Ari Behavior

Add TC facts to Ari where existing patterns make sense:

- `src/app/api/ari/briefing/route.ts`
- `src/app/api/ari/next-action/route.ts`
- `src/lib/ari-briefing.ts`
- `src/lib/stage-timeout.ts`

Ari should flag:

- Accepted offer but no TC file after 1 hour.
- Assignment signed but opening package not sent within 1 business day.
- EMD due within 24 hours and not confirmed.
- Closing scheduled within 7 days with title not clear.
- Closing completed but HUD missing.
- HUD received but revenue not logged.

Do not add noisy generic alerts. Every alert should name the property/deal, current blocker, owner, and next action.

## Document Integration

Extend `src/lib/documents.ts` only if needed. Existing types already include:

- `assignment_contract`
- `closing_docs`

If TC needs more granularity, add:

- `title_commitment`
- `emd_receipt`
- `hud_settlement_statement`

Then make sure document upload/list APIs can filter by `lead_id` and type for the TC drawer.

## Testing Requirements

Run these before final handoff:

```bash
npm run lint
npm run test:ci
npm run build
```

Add focused tests:

- Migration/SQL sanity if the repo has a migration test pattern.
- Unit test for status transition helper if added.
- API tests for:
  - creating a TC file from accepted offer,
  - idempotent TC creation,
  - completing tasks,
  - closing a TC file.
- Browser smoke test for `/dispo/tc` if Playwright route auth can be handled locally.

If full browser auth is blocked, document that and still run build + unit/API tests.

## Acceptance Criteria

The build is complete when:

- Accepted buyer offers automatically appear in TC queue.
- Signed assignment webhooks create/open TC files idempotently.
- Ernest can assign a title company/contact, set file number, track tasks, and schedule closing.
- TC status/risk appears in the dispo workflow without cluttering existing pages.
- Closing a TC file closes the linked dispo deal and logs revenue when assignment fee is present.
- Ari surfaces only actionable TC risks.
- No direct manifest writes were introduced.
- `npm run lint`, `npm run test:ci`, and `npm run build` pass or failures are documented with root cause.

## Implementation Order

1. Read all referenced files before editing.
2. Add migration and types.
3. Add server helpers for TC file creation, task seeding, event logging, and manifest sync.
4. Add APIs.
5. Wire assignment signed and offer accepted hooks.
6. Build `/dispo/tc`.
7. Add small badges/actions to existing dispo pages.
8. Add Ari risk queries.
9. Add tests.
10. Run verification commands and fix failures.

## Guardrails

- Do not reorganize the app.
- Do not rename current routes.
- Do not replace the existing assignment flow.
- Do not write directly to `manifests`.
- Do not put live client data or secrets in tests.
- Use `816-555-xxxx` test phone numbers only.
- Keep UI dense, operational, and consistent with existing CRM surfaces.
