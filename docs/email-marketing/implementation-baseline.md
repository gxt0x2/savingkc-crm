# Email implementation baseline and model handoff

Checked 2026-09-12. **Local baseline complete; live database and provider preflight remain pending.** It records EM-001 evidence and the completed local contract/harness portion of EM-002. It does not mark G0 fully passed, authorize SQL against production, or claim the email feature is implemented.

## 1. Use this checkout

- Implementation worktree: `/Users/ernestdodson/Documents/New project/savingkc-crm-email-foundation`
- Branch: `codex/email-foundation-20260912`
- Starting commit: `d03bb95e16e92da67530d62bc911589951833ba0`, fetched from `origin/main` on2026-09-12; merge of PR652.
- Original design checkout: `/Users/ernestdodson/Documents/New project/savingkc-crm-main`, branch `codex/restore-ernest-forwarding`, commit `cbd2da47e25433d37a95c9ae9f81089953d4276d`.
- There are536 commits reachable from the fetched main that are not reachable from the design checkout. Do not implement against that old checkout or merge its unrelated work into this feature.
- Preserved original tracked edits: dialer page, leads page, dialer deceased-queue/queue routes, globals.css, nav-tab.tsx, use-app-mode.ts. The original checkout also has unrelated untracked files; none were removed, staged or copied into the implementation tree.
- Copied only `docs/email-marketing/` into the new worktree. No environment file, provider token, app code change or UI mockup was copied into application paths. Original thread-owned light-theme walkthrough remains the visual reference.
- The new worktree had no tracked changes after dependency installation and the baseline tests. This work adds documentation only. No commit, push, migration or deployment performed.

The fetched main is a source-code baseline, not proof of the currently deployed production revision. Recheck branch drift before a release, not by silently changing this baseline mid-packet.

## 2. Runtime restored from the actual lockfile

| Component | Verified local version / evidence |
| --- | --- |
| Node |22.22.3 |
| Package manager |npm, tracked `package-lock.json`; package.json has no packageManager declaration; Vercel config uses npm |
| Next |16.3.4, rather than the old design checkout's16.2.6 |
| React / React DOM |19.2.4 |
| Resend |6.12.4 |
| Supabase JS |2.101.1 |
| Zod |3.25.76; do not copy Zod4 examples from newer framework guides without adapting APIs |
| Vitest |4.1.11 |
| Install |`npm ci --ignore-scripts --no-audit --no-fund`, exit0,798 packages |

Lifecycle install scripts were intentionally not executed during this metadata/test preparation. This is sufficient for the inspected guides and the passing selected tests, not proof that every native dependency or production build is ready. Retain the locked versions; no framework upgrade or package-lock change was made.

Read the actual installed guides: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `01-app/02-guides/server-actions.md`, and the authentication guide's opening sections. Routes use Web Request/Response; dynamic params are awaited; GET is not cached by default; private email responses must still enforce server auth/authorization and private/no-store. Server Actions dispatch sequentially per client, so do not build a queue around concurrent client Server Action calls. Read further relevant installed guide sections before writing their associated app code.

## 3. Current CRM authority overrides stale assumptions

These findings are grounded in the new worktree's source and migrations. Actual deployment/schema correspondence remains unverified. They are mandatory inputs to EM-002/EM-004/EM-013/EM-014/EM-028, not a license to make direct writes to new tables.

| Concern | Current source | Consequence for email |
| --- | --- | --- |
| People, contact methods, properties | `src/lib/server/crm-entity-foundation.ts`, `crm_people`, `crm_contact_methods`, `crm_properties`, `crm_lead_entity_links` | Reuse canonical person/property identities when confirmed. `em_parties` is an email enrollment/relationship adapter with canonical references, not a second master contact list. A property/address or guessed name cannot merge people |
| Lead compatibility projection | `leads` plus `applyCrmEntityAuthority` and linked `crm_opportunities` | Retain existing lead IDs for timeline/UI compatibility, but never bypass canonical profile/lifecycle commands. The internal table name crm_opportunities is not proof every row is a business Opportunity |
| Stage meanings | `src/types/pipeline.ts`, `src/lib/server/crm-lifecycle.ts` | contacted = Leads; qualified = Opportunity. Keep interest evidence and human qualification separate. New/enrolled/replied/callback rows do not count as qualified just because a canonical entity exists |
| Lifecycle writes | `applyCrmLifecycleCommand` → `crm_apply_lifecycle_command_v1`; lifecycle API includes additional guards | Use a reviewed email bridge with current business guard checks, durable command ID and canonical transition. Directly updating leads.station or copying old Manifest writers is prohibited |
| Qualification | `qualification-policy.ts`, `crm_lead_qualification_pillars`, `/api/leads/[id]/qualification`, lifecycle route | Existing promotion guard expects human-verified TIMELINE, CONDITION, MOTIVATION and PRICE evidence. Unknown facts may remain unknown on a Lead/handoff, but the email feature must not bypass this existing gate or fabricate evidence. Any later change to the company qualification rule is a separate business decision |
| Conversations | `conversation_thread_state`, `conversation_read_model` migration, `server/conversation-read-model.ts`, contract/queries and assignment/thread-state APIs | Existing queue, owner, attention and timeline projection must participate in one shared email control path. Existing owner text/attention state alone is not an AI dispatch lock. Extend through reviewed mapping and guards; no two independent owners |
| Thread identity | Current thread-key parser accepts lead, phone and activity keys; not an em UUID/email-only key | Specify a stable email thread bridge and extension before exposing an unmatched email thread. One CRM lead timeline can contain several email chains; preserve per-chain identity and exact source headers |
| Auth | `resolveAuthenticatedActor`, verified Supabase claims, optional mobile bearer path | Use immutable verified subject for em membership and ownership; names/email display labels are not authorization. New em roles require explicit bootstrap/mapping, not inferred access from an arbitrary profile name |
| Consent | Canonical contact methods and crm_consent_events coexist with channel-specific SMS opt-outs and buyer email_opted_in | Email suppression must integrate correct scope without treating an SMS restriction as proof of email permission or silently releasing an all-contact restriction |
| Property/prospect promotion | `prospect-to-lead.ts` currently requires an inbound phone and enumerated call/SMS sources | Do not use it unchanged for email-only sellers. Retain prospect/property evidence and confirmed canonical links without inventing a phone number |
| Historic Manifest | Current canonical source/lifecycle code treats it as historical; retirement migrations exist | No operational Manifest writes. Do not recreate retired helpers to satisfy an old packet |

## 4. Existing sending paths and side effects

Inventory from non-test source search of Resend and email sending:

| Entry point | Existing behavior to preserve or adapt |
| --- | --- |
| `/api/conversations/send` | Direct Resend branch; configured From can fall back to the primary business domain; protected dialer requests have provider-deadline/uncertain-result behavior. It writes email activity and invokes outbound_contact auto-advance. Campaign replies must use stable campaign identity, controller/suppression guard, durable email intent and no outbound-send-as-interest transition |
| `/api/mobile/v1/messages` | Direct email send and activity/auto-advance. Must obey the same campaign-thread ownership/suppression rules as desktop; no bypass through mobile |
| `/api/broadcasts/send` | Buyer email_opted_in and direct Resend; recipient statuses updated per send. Reuse existing buyer identity and enforce shared marketing restrictions; buyer campaigns never create seller Leads |
| `/api/tc/drafts/[id]/send` | Transaction coordinator draft delivery with separate transactional purpose. Inventory and distinguish this legitimate workflow from marketing; do not blanket-disable required transactional correspondence by an email-marketing rule |
| `safe-communications.ts` safe email | Placeholder/test-mode helper; not a usable real email provider adapter |
| `/api/cron/sync-gmail` → `gmail-sync.ts` | Metadata/snippet import; matching by exact address, then names/property text, and dedup by lead_id+gmail_message_id. Insufficient for authoritative full-body campaign replies or exact cross-provider correlation. Use durable RFC/provider/thread evidence for the new adapter, and quarantine uncertain identity instead of inheriting heuristic match confidence |

`checkAutoAdvance` currently moves New to Leads on outbound_contact and can move appointment events to later stages; it also queues PPC qualification evaluation. `create-appointment` writes an appointment, updates lead snapshot/activity, invokes appointment_set auto-advance, queues PPC appointment evaluation and can create an SMS reminder. None of these composite helpers may be invoked blindly for a mere email or callback. The new feature must use the reviewed same-channel adapters defined in the plan.

## 5. Schema and integration evidence still needed

No production table rows were queried. Process environment did not contain usable database/server credentials. The original `.env.production.local` was inspected through the normal Next loader without printing values: a public Supabase URL exists, but server secret/service-role and PostgreSQL connection settings were not configured. A metadata-only GET using the available public credential returned HTTP401. No authenticated live schema result is claimed, and no credentials were copied to the new worktree.

Before any schema-dependent migration or canonical write, obtain a current read-only schema snapshot for the actual target. Required facts:

- leads.phone nullability, source data type/check, required columns and triggers; types allow null phone but that is not DB proof.
- Known source migration `20260603_allow_google_ads_phone_lead_sources.sql` does not include email_marketing. Inspect the actual check before proposing an additive change; preserve all existing source values.
- Confirmed current canonical entity/contact-method/consent constraints and RLS, uniqueness/conflict semantics, business-stage projection and refresh triggers.
- lead_activities type/metadata support and projection triggers; existing unique indexes and bridge behavior for email/thread event dedup.
- Deployed conversation RPC signatures, attention/owner mutation rules and migration versions; exact buyers/prospects linkage.
- Current runtime SQL function versions for lifecycle and qualification; do not infer deployed functions solely from filenames.

The repository contains migration filenames extending past the current calendar date. Do not bulk-apply the directory or assume file dates establish deployed ordering. Plan an additive migration only after actual history/FK/dependency preflight.

Hosting: current vercel.json uses npm, includes5-minute workflow/prospecting workers and a2-minute Mojo worker. It does not define an email worker. These are configured schedules, not verified running jobs or proof of the account's plan/cadence allowance. No Vercel project link, live plan, email account capabilities, Google Calendar permissions, phone routing or push delivery was verified here. Preserve the existing early controlled-provider check and final setup gates.

## 6. Baseline checks performed

Command from the isolated worktree:

```sh
npm run test:ci -- src/lib/api/authenticated-actor.test.ts src/lib/server/conversation-read-model.test.ts src/lib/server/crm-entity-foundation.test.ts src/lib/server/crm-lifecycle.test.ts src/lib/qualification-policy.test.ts src/app/api/conversations/send/route.test.ts
```

Result: **6 files passed,41 tests passed**, exit0. Existing test fixtures exercised auth, canonical entity/lifecycle, qualification, conversation queries and sending behavior. No new email feature tests or live provider tests were run. A non-failing Vite warning about a future native config loader was reported; it did not justify changing the project configuration during a baseline task.

No browser journey, full production build, migration, email, call, calendar event, AI inference, deployment or model switch occurred. The original source edits remained untouched.

## 7. Model allocation

Recommendation, not measured project-specific performance: **Astra for integration decisions and critical review; GPT-5.6 Terra with High reasoning for most bounded implementation packets; Luna for small mechanical/UI polish work once contracts and test expectations are established.** Start Terra with one packet and assess correctness, rework and total cost/usage. A lower unit price alone does not prove a lower completed-task cost.

Keep Astra review at identity/auth and schema design, sending/suppression/ownership/concurrency boundaries, first provider-backed end-to-end path and final release readiness. Escalate an ambiguous contract or repeated failed integration rather than repeatedly retrying the same assumption on a cheaper model. UI and routine service code can still be authored by Terra against these reviewed interfaces. No automatic agents or separate tasks were created; the user can change the model in this same task.

OpenAI's current catalog describes Astra for complex reasoning/coding, Terra for balanced intelligence/cost and Luna for cost-sensitive work. This project-specific division is our engineering judgment, not an official benchmark or a claim about the user's Codex bill. [Official model catalog](https://developers.openai.com/api/docs/models).

## 8. Exact continuation for the next model

**EM-002 update, 2026-09-12:** the independent local contract/harness work is complete. Shared Zod 3 contracts cover 83 server-side actions; the local schema test passed. The database and browser harnesses deliberately require explicit isolated configuration and fail closed when it is absent.

The next required gate is an authenticated, read-only schema preflight for the actual target. Confirm the constraints, RLS, functions and migration history listed in §5 before selecting a schema-dependent packet. On 2026-09-12, the worktree was linked to the verified Vercel project and preview/production environment names were inspected. Both pulled server-side Supabase key values were empty, so no metadata request or database read was made; temporary environment files were deleted. Restore or supply approved read-only access before proceeding. Do not add database writes, purchases, real sending or production configuration. Mocks, an absent-environment failure and a public-credential HTTP 401 must not be called database verification. Preserve the existing auth identities, canonical entity/lifecycle/qualification authorities and required conversation bridge.

Continue the authorized email build in `/Users/ernestdodson/Documents/New project/savingkc-crm-email-foundation` on `codex/email-foundation-20260912`. Read this baseline, the v1.2 design index and EM-002. Implement only EM-002's independent shared TypeScript/Zod contracts and safe test-harness scaffolding. Use existing auth identities, canonical entity/lifecycle/qualification authorities and conversation bridge requirements from §3; do not add DB writes, purchases, real sending or production configuration. Live DB portions of G0 remain pending; mocks and an absent-environment error must not be called database verification. Add strict validation and meaningful negative/race contract cases as applicable, use the existing locked Zod3/Vitest setup, run the packet's local checks, and record exact evidence/remaining gates in build-status. Finish this bounded packet before choosing the next dependency-ready work. Preserve the approved light walkthrough, everyday-language voice, separate sender domains, Lead/Opportunity meanings, inbox filters, campaign recipient/cadence behavior and human controls.
