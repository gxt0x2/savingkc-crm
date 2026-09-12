# Connected local workflow verification

Date: 2026-09-12. Branch: `codex/email-foundation-20260912`.

This is component and local integration evidence, not a completed EM-017/EM-030 acceptance or production release. The first connected milestone follows `3334191e`; the setup/theme continuation follows `35146922`.

| Check | Result | Scope |
| --- | --- | --- |
| `npm run test:email:workflow` | 20 passed, 0 failed | Real disposable PostgreSQL: publication races, idempotency, immutable versions, audit rollback, inbound deduplication, stale drafts, ownership, handoff evidence, private notification acknowledgment, alias suppression, pause, verification expiry, shared capacity and Chicago DST/weekend cadence; atomic settings/replay/rollback, stale edits, forged readiness rejection, team roles/hours, competing owner removals, access-change holds and inactive CRM dispatch guards |
| `npm run test:email:local-ui` | 3 passed, 0 failed | Shared component → actual API → disposable PostgreSQL → rendered response; desktop/mobile screenshots, reload persistence, unavailable state recovery, wrong-origin rejection, persisted business/team setup and unavailable connections |
| `npm run test:ci -- src/lib/email/__tests__` | 27 files / 48 tests passed | Regression checks for earlier contracts and helpers; these do not prove entire packet completion |
| `npx tsc --noEmit --pretty false` | Passed | Entire isolated worktree TypeScript validation, including new CRM page and API |
| Targeted ESLint | Passed | `src/lib/email/workflow`, `src/components/email`, Email page and API |
| Design reference validator | Passed | Design structure only: 19 surfaces, 88 actions, 35 packets, 62 acceptance cases, 40 AI seed cases |
| Production build of isolated app | Passed | Bundling only; no CRM-shell deployment or provider test |

## Browser story

The automated test creates a campaign, saves both messages, reviews two eligible and one unverified fixture recipients, starts simulated delivery, receives replies, takes human control, saves and invalidates a draft, creates an evidenced callback handoff, acknowledges a notification, processes an opt-out, reloads and verifies the stopped conversation and held callback. A second browser case exercises unavailable-state recovery and a forbidden cross-origin mutation. A third saves business/team setup, reloads both forms and confirms pending connections cannot enable sending. The team-form test uses accessible combobox roles rather than matching the option text inside nested labels. Runtime page errors and horizontal overflow at 390px are checked.

Manual in-app browser verification additionally exercised campaign creation, saved sequence, review exclusions, publication, simulated acceptance, incoming reply, takeover and callback evidence. Browser testing caught and fixed a Next development origin mismatch, UUID array typing in refresh queries, unstable ordering for equal message timestamps, and the local test drawer and textarea label. The final test run passed after these fixes. The API now returns the shared strict command response envelope. A shutdown race in the browser harness was fixed with a shared cleanup promise and graceful termination; the final browser run left zero temporary database or app processes running.

Generated artifacts (local, ignored by Git):

- `test-results/email-local/inbox-desktop.png`
- `test-results/email-local/inbox-mobile.png`
- `test-results/email-local/setup-desktop.png`
- `test-results/email-local/setup-mobile.png`
- These screenshots show the restored white/red/grey theme; desktop and mobile images were visually inspected.
- Playwright retains a trace for any failed run. These show fabricated fixture data only.

## Important limits

- `tests/email-local` supplies a fixed fabricated owner at a localhost-only test boundary. It shares UI, HTTP command handler and database service with the CRM, but does not exercise real CRM login, shell navigation or Supabase session provisioning.
- Five additive Email migrations were applied to fresh disposable PostgreSQL 16 clusters with explicitly minimal canonical-table prerequisites. No migration was applied to SavingKC.
- Simulation is the only permitted transport. The production worker remains disabled. There are no provider/model requests, customer emails, push messages, phone calls, calendar events or canonical CRM lifecycle writes.
- The simulation serializer uses a workspace row lock for its bounded transactions. This is not the planned remote-provider lease/reconciliation implementation. Settings now use this same transaction boundary; the old multi-write repository was removed. Provider readiness remains unavailable instead of trusting a legacy config hash.
- Pilot settings deliberately support two literal-template messages, one operating timezone/window and all-marketing restrictions. Other command IDs fail closed. Imports, saved views, production paging, AI generation/evaluation, scope-specific preferences and recovery tools remain incomplete.
- Callback records explicitly remain `crm_sync_state=not_connected`; they do not constitute booked appointments, CRM Leads or qualified Opportunities.

## Reproduction

Run from the Email worktree. `npm run test:email:workflow` owns each disposable database lifecycle. `npm run test:email:local-ui` owns a separate local app on port 3211 and cleans up its database when finished. `npm run dev:email:local` starts manual practice on port 3210; Ctrl-C stops the app and deletes only its own temporary cluster. Do not run both web harnesses simultaneously in the same Next project directory. No credentials, `.env` file or paid subscription is needed.

The unit test total changed from 50 to 48 because three mocked settings tests were replaced by six real PostgreSQL settings/permissions scenarios, and one deny-by-default authorization regression was added. Database and browser totals are reported separately; none proves live provider or canonical CRM integration.
