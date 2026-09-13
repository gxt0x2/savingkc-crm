# Connected local workflow verification

Date: 2026-09-12. Branch: `codex/email-foundation-20260912`. Action workspace implementation checkpoint: `f4c99d5e`, following CRM bridge `41b74b99` and checkpoint notes `9ba1caf8`.

This is component and local integration evidence, not a completed EM-017/EM-030 acceptance or production release. The first connected milestone follows `3334191e`; the setup/theme continuation follows `35146922`; the canonical CRM bridge continuation follows `a51fc103`.

| Check | Result | Scope |
| --- | --- | --- |
| `npm run test:email:workflow` | 41 passed, 0 failed | Disposable PostgreSQL: publication, scheduling, suppression, ownership and settings; canonical Lead/history/task/attribution atomicity, preserved Opportunity/source, review holds, phone-only review, dependency failure, rollback, duplicate races, stale callback evidence, source compatibility, distinct auth/profile IDs and unsubscribe/manual-stop survival during CRM projection failures. Owner-only repair replay resolves once; the action continuation adds canonical notes and receipt replay, manual task scheduling, owner checks, stale revisions, weekday/time boundaries, projection rollback and completion followed by unsubscribe without reopening the task. |
| `npm run test:email:local-ui` | 4 passed, 0 failed | Three shared component → actual API → disposable PostgreSQL flows cover desktop/mobile screenshots, stale callback review, reload, unavailable recovery, origin rejection and setup. A fourth mock-backed UI contract covers pending CRM repair, owner-only retry, continued failure and resolved state; actual repair transactions are covered by the DB suite. |
| `npm run test:ci -- src/lib/email/__tests__` | 28 files / 50 tests passed | Regression checks for earlier contracts and helpers; these do not prove entire packet completion |
| `npx tsc --noEmit --pretty false` | Passed | Entire isolated worktree TypeScript validation, including new CRM page and API |
| Targeted ESLint | Passed | Email workflow, CRM adapter/history/repairs, settings, components, database fixture and DB/browser tests |
| Design reference validator | Passed | Design structure only: 19 surfaces, 89 actions, 35 packets, 62 acceptance cases, 40 AI seed cases |
| Production build of isolated app | Passed | Bundling only; no CRM-shell deployment or provider test |

## Browser story

The first browser story creates/reviews/publishes a campaign, receives a phone reply, takes human control and accepts the prepared Lead/callback action. It saves a canonical note, schedules a manual follow-up, verifies the new queue, preserves a typed draft while a new reply invalidates it, approves an exact prepared reply, and checks that longer history scrolls without moving the composer. It unsubscribes, reloads, verifies the pending callback hold remains To do, checks persisted notes, and exercises the mobile Details drawer and Escape. Other cases cover unavailable recovery, cross-origin denial, business/team setup with live sending blocked, and mock-backed repair UI. Page errors, horizontal overflow and the light palette are checked.

Earlier manual in-app browser verification exercised campaign creation, saved sequence, review exclusions, publication, simulated acceptance, incoming reply, takeover and callback evidence. Browser testing caught and fixed a Next development origin mismatch, UUID array typing in refresh queries, unstable ordering for equal message timestamps, and the local test drawer and textarea label. Current automated checks cover revision-fenced reply and task actions, persisted notes, independent history scrolling, and the repair UI. The API returns the shared strict command response envelope. A shutdown race in the browser harness was fixed with a shared cleanup promise and graceful termination; each final browser test run cleaned up its own temporary database and app. A separately started manual preview may remain open on port 3210.

Generated artifacts (local, ignored by Git):

- `test-results/email-local/inbox-desktop.png`
- `test-results/email-local/inbox-mobile.png`
- `test-results/email-local/setup-desktop.png`
- `test-results/email-local/setup-mobile.png`
- These screenshots show the restored white/red/grey theme; desktop and mobile images were visually inspected.
- Playwright retains a trace for any failed run. These show fabricated fixture data only.

## Important limits

- `tests/email-local` supplies a fixed fabricated owner at a localhost-only test boundary. It shares UI, HTTP command handler and database service with the CRM, but does not exercise real CRM login, shell navigation or Supabase session provisioning.
- Nine Email migrations were applied to fresh disposable PostgreSQL 16 clusters, including the draft canonical phone/source compatibility changes and private projection-repair queue. The actual canonical entity foundation migration supplies person/property/Lead projection. The fixture copies checked production work-item function bodies and uses a deliberately reduced Conversations projection. No migration was applied to SavingKC.
- Simulation is the only permitted transport. The production worker remains disabled. Canonical-shaped Lead/history/work-item writes occur only in the disposable database. There are no provider/model requests, customer emails, push messages, phone calls, calendar events or production CRM writes.
- The simulation serializer uses a workspace row lock for its bounded transactions. This is not the planned remote-provider lease/reconciliation implementation. Settings now use this same transaction boundary; the old multi-write repository was removed. Provider readiness remains unavailable instead of trusting a legacy config hash.
- Pilot settings deliberately support two literal-template messages, one operating timezone/window and all-marketing restrictions. Other command IDs fail closed. Imports, saved views, production paging, AI generation/evaluation, scope-specific preferences and recovery tools remain incomplete.
- Callback records report `synced`, `review_required` or `dependency_unavailable` from actual transaction results. Later history/task projection failures have separate repair flags, so a saved unsubscribe remains stopped while CRM needs attention. Owner-only internal repair retry is connected; initial held-handoff resolution/retry and shared CRM ownership reconciliation remain unfinished. New linked records are Leads; existing Opportunity stages are preserved. A callback task is not a booked appointment or a qualification.

## Reproduction

Run from the Email worktree. `npm run test:email:workflow` owns each disposable database lifecycle. `npm run test:email:local-ui` owns a separate local app on port 3211 and cleans up its database when finished. `npm run dev:email:local` starts manual practice on port 3210; Ctrl-C stops the app and deletes only its own temporary cluster. Do not run both web harnesses simultaneously in the same Next project directory. No credentials, `.env` file or paid subscription is needed.

The unit total is 50. Database and browser totals are reported separately; they do not prove live provider behavior or deployed CRM integration. See [CRM bridge contract and compatibility boundary](crm-bridge-checkpoint.md) for the exact source/null-phone/identity-guard release considerations.

## Action workspace verification scope

Desktop and mobile screenshots for revision 1.3 were inspected after disabling screenshot-time animations. Desktop keeps the composer within the conversation; earlier history stays in its own scroll container. Mobile Details uses its own fixed panel and scroll area. The new suggestion is deterministic practice copy, not live AI. No production migration, deployment, model call, external notification or Calendar booking was performed.

The final presentation follow-up forces a thin visible history scrollbar and styles the independent list/Details scrollbars. A fresh local browser inspection confirms `overflow-y: scroll`, a thin scrollbar and bounded history after that CSS change.

## Tabbed Details continuation

The Details column now starts expanded and uses Contact, Property, Follow-ups, Notes and Ari’s Insights tabs with visible icons and names. The updated browser suite passes all four cases, including initial expansion, tab navigation, unsaved-note preservation, follow-up saving, keyboard Home/End and mobile Escape. Desktop/mobile screenshots were inspected. TypeScript and targeted ESLint pass. Ari’s Insights exposes saved context and practice copy only; live AI remains unavailable. This continuation changes the UI and its tests, not the database/provider integration.

## Compact header and task/property cards

Updated four-case browser suite passes, including a geometry assertion that the conversation begins above 280px at the desktop test viewport. Two relevant callback database cases pass with new assertions for saved title/notes and canonical work-item title. All 50 Email unit tests, TypeScript and targeted ESLint pass. Property/card and Calendar/form screenshots were inspected on the local preview. Existing full DB totals above belong to the preceding checkpoint; this change reran the two affected callback cases. No production or provider change.

## Next step default and Calendar highlight

All four updated browser cases pass with Next step selected by default and repair actions moved out of the message history. TypeScript, targeted ESLint and design validation pass. Local screenshots `next-step-default.png`, `calendar-green.png` and `zestimate-property.png` show the revised panels; Next step and Calendar were visually inspected. A separate narrow-screen check confirms Edit reply closes the overlay and focuses the composer. Zestimate consumes an existing optional canonical property field; the fixture has no live valuation or verified Zillow page. Exact page matching and value freshness are not verified by this UI checkpoint.

## Scheduled and upcoming Calendar work

All four browser cases and two targeted database cases pass. Calendar reads the linked Lead's open canonical work items in due order, excludes completed work and other Leads, and reflects the saved callback date. The list shows overdue, held and undated work, assignees and notes, with read-only type/assignee filters and a disclosed 50-item display limit. TypeScript and targeted ESLint pass. Desktop and mobile screenshots `calendar-agenda.png` and `calendar-agenda-mobile.png` were visually inspected; the manual preview verified the saved task and absence of horizontal overflow. These checks use disposable local data. CRM appointment tasks remain distinct from Google Calendar events, which are not connected. This continuation does not enable task reassignment, provider calls, calendar bookings or production writes.

## Compact Upcoming and Scheduler

A focused Playwright check against the existing disposable preview passes: filters start hidden, active filters stay indicated when collapsed, scheduled items render pale yellow, Scheduler starts closed, collapsing preserves typed input, Cancel restores saved values, Save persists and closes, and the Next step shortcut opens the form. Desktop/mobile screenshots `upcoming-compact-desktop.png` and `upcoming-compact-mobile.png` were inspected; mobile has no horizontal overflow and no browser page errors were observed. TypeScript and targeted ESLint pass. The existing browser story was updated for the disclosures; the full four-case suite was not rerun for this presentation-only continuation. No database or provider behavior changed.

## Handoff management and visible alerts

The continuation adds explicit callback acceptance, Lead/callback reassignment, current CRM ownership mismatch detection, fresh review/retry of an unlinked held handoff, and call outcomes with required dated next work. Prior held review evidence remains in audit. Owner changes fence stale commands and assignment updates roll back if the canonical task projection fails. Notifications remain private to their recipient; header Alerts opens the corresponding conversation and supports acknowledgment. The visible page refreshes every 30 seconds without replacing typed drafts.

All 48 database cases, 50 unit tests and four browser stories pass. TypeScript, scoped ESLint and the updated 90-action design validator pass. Browser verification includes acceptance, alert navigation, collapsed Scheduler, outcome controls, persisted callback scheduling and opt-out; canonical reassignment/review failure and replay behavior are covered by database tests. The desktop screenshot was inspected. These checks do not prove hosted sign-in, push, provider delivery or Google Calendar behavior.
