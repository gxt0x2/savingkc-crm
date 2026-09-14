# Verification, implementation gates and release

Specification v1.2 · 2026-09-12 · These are required future checks, not test results.

## 1. Evidence levels

**Design reviewed** means contracts cross-reference and examples are coherent. **Implemented** means code exists in an identified revision. **Locally verified** means relevant automated checks and authenticated UI paths passed in an isolated environment. **Provider verified** means actual authorized mail/receiving/recovery checks have correlated provider evidence. **Production verified** means the deployed revision, real schema/config and signed-in flow were inspected. Never substitute a screenshot, compilation, simulation or bot summary for a higher evidence level.

Current authorization covers the design package/walkthrough. It does not itself activate production campaigns or authorize spending. Future implementation work should proceed on an isolated branch/worktree with existing uncommitted work preserved. Migrations, production deployment, paid purchases and first live campaign each require their applicable concrete release/setup authorization. Routine reversible implementation and tests within an authorized build do not require repeated permission questions.

## 2. Test suite layout and commands

Proposed files under `src/lib/email/__tests__/`: `schema.test.ts`, `auth.test.ts`, `setup.test.ts`, `provider.test.ts`, `inbound.test.ts`, `concurrency.test.ts`, `identity.test.ts`, `audiences.test.ts`, `campaigns.test.ts`, `ai.test.ts`, `limits.test.ts`, `threads.test.ts`, `handoffs.test.ts`, `domains.test.ts`, `suppression.test.ts`, `jobs.test.ts`, `reports.test.ts`, `legacy.test.ts`, `retention.test.ts`.

Database integration tests live in `tests/email-db/` and use a disposable local Supabase/Postgres schema, never production credentials. Browser journeys live in `tests/email/` and use authenticated test identities. Provider probes live in `scripts/email/verify-controlled-path.ts`; explicit allowlist, max-send count and scope printed before execution. No probe sends by default: default is `--dry-run`. Model evaluations live in `scripts/email/evaluate-playbook.ts` with fixture/config hashes and explicit maximum budget.

Use existing lockfile/package manager resolved in EM-001. The checkout currently advertises these npm scripts, but EM-001 must record the exact working equivalents before build packets run:

```
npm run test:ci -- src/lib/email/__tests__/<relevant>.test.ts
npm run lint
npm run build
npm run gate:routes
npm run gate:proxy
npm run gate:theme
npm run test:smoke:theme
```

EM-002 adds `test:email:db` (disposable DB integration runner) and `test:email:ui` (Playwright project) scripts once the existing runner pattern is known. Do not write a script that silently skips missing DB tests and returns success; report blocked. Broad coverage/KPI gates are required only when existing release policy or changed scope warrants them. A failing unrelated baseline is recorded separately, not hidden or “fixed” outside the task.

## 3. Acceptance case catalog

Each case specifies its minimum evidence. Unit-only tests do not satisfy explicit DB/browser/provider cases. Fixture names T01–T48 must appear in test titles so task packets can select/verify them.

Packets implement portions of these end-to-end cases in dependency order. A backend packet records its specific unit/DB assertions as component evidence; it does not need a future UI to exist to finish that component. A shared T-case remains pending as an overall acceptance case until all stated evidence exists. EM-017 owns the complete controlled foundation journey; EM-030 reconciles and completes the full catalog. This distinction prevents both dependency deadlocks and premature claims that a unit test passed an entire user journey.

| ID | Scenario and required observable result | Evidence / suite |
| --- | --- | --- |
| T01 | Every P01–P19 route renders correct loading/empty/error/stale/no-access state, list URL filters survive navigation, narrow layout usable at320/390/768/1280 | Browser `tests/email/navigation.spec.ts` |
| T02 | Dirty form close offers save/discard/stay; validation preserves input; stale save displays comparison without overwrite; secrets never persisted | Browser + setup/threads |
| T03 | Unauthenticated, read-only, wrong-role and cross-workspace direct API/RPC/storage access denied; no secret/raw event leak; last admin protected | DB + auth |
| T04 | Wizard saves/resumes across login/browser; finish setup sends zero emails; optional calendar can skip; account opening alone doesn't verify connection | Browser + setup |
| T05 | Valid key missing receive/domain scope, wrong key, exhausted credits, timeout and reported billing terms displayed distinctly; reconnect no false success | Provider adapter fixtures + setup |
| T06 | Secret round-trip encryption/AAD/key rotation; wrong key/nonce fails closed; logs and client DTOs contain no secret; disconnect pauses dependencies | Unit + DB auth/setup |
| T07 | Removed reviewer/controller hands unresolved work to valid backup/hold; two role edits conflict; no spontaneous AI release | DB + auth/handoffs |
| T08 | Launch/enable require current readiness hash; stale DNS/worker/scope invalidates dependent item; simulation cannot satisfy provider check | DB + setup |
| T09 | Authorized one-recipient test yields actual provider accepted ID, receive event and full body, headers correlated; test excluded from campaign metrics | Provider + signed-in browser |
| T10 | Opt-out/reply/pause/takeover racing dispatch: earlier DB gate wins; already in-flight accurately recorded; next send blocked | Real parallel DB transactions + controlled provider fixture |
| T11 | Segment/import 0/1/many rows, invalid encoding/size, interrupted chunk restart; source keys and counts reconcile, no Leads created by import | Unit + DB audiences |
| T12 | CSV formula injection/markup, malformed addresses, missing evidence, duplicate rows, repeated file import; safe errors/download and dedup | Unit + browser audiences |
| T13 | Shared address, similar names, case/plus aliases and multi-property owner stay distinct until evidence; no fabricated ownership/consent | DB + identity |
| T14 | Existing/new email-only seller interest creates or links one Lead; null phone handled throughout UI; advanced/parked/terminal records preserved/held | DB + identity + CRM browser |
| T15 | Verification valid/invalid/unknown/catch-all/adverse substatus; expired evidence rechecked; cached valid proof reused; corrections not auto-applied | Verification adapter + audiences |
| T16 | Suppression applies at publication and dispatch across domains, known aliases and human/legacy sends; restore audience doesn't unsuppress | DB + suppression/legacy |
| T17 | Double launch + concurrent launch workers create one version/enrollment; duplicate campaign/revision copies no execution; frozen snapshot never grows | DB + campaigns |
| T18 | Render all template variants with missing token, HTML injection and required footer; subject/body preview matches frozen send bytes; edit invalidates hash | Unit + browser campaigns |
| T19 | Resend returns `{error}` without throwing,429,4xx,5xx/timeout, duplicate retry; accurate accepted/rejected/uncertain outcome and one logical send | Provider adapter + DB |
| T20 | Reply/close/recontact/expiry/resume/DST/weekend timing: no old sequence restart, no catch-up burst, no send outside window | Fake clock + DB campaigns |
| T21 | Every AI critical fixture routes safely in three repeated model runs; deterministic guard suite independently blocks forbidden effects | ai + explicit cost-bounded model evaluation |
| T22 | Policy/model/claim changes require version/eval; published campaigns pinned; disabled automatic mode cannot dispatch AI | DB + ai |
| T23 | AI refusal/timeout/truncated/invalid schema/bad span/long context/untrusted instructions/unsupported language → review, no raw fallback send | Unit + ai model fixtures |
| T24 | Two workers contend at last credit/message/token budget; one reservation wins; timeout remains reserved; retries included; no negative balance | Parallel DB + limits |
| T25 | Estimated and actual costs settle once with adjustments; fixed subscription not falsely capped; unknown rate blocks unbounded inference | DB + costs/limits |
| T26 | Global/campaign/domain pause and provider suspension prevent new dispatch; no domain/account rotation; inbound/suppression continue; safe resume | DB + browser + provider fixtures |
| T27 | Read state per user, snooze wakes on inbound, close reopens without sequence restart, tags don't change pipeline | DB + threads/browser |
| T28 | Two humans take over simultaneously; exactly one controller; existing Conversations sees same owner; release rechecks latest context | DB race + two authenticated browser sessions |
| T29 | Seller replies while draft approved/edited; AI completes after takeover; stale approve/send rejected and old intent canceled | DB race + threads/browser |
| T30 | Approve/send binds body/recipient/sender/content/controller/policy; edit/reject/resolve/assignment has correct separate effect | Unit + DB + review browser |
| T31 | Urgent handoff created once, accepts/reassigns/returns with correct SLA and backup, no automatic call/SMS/email notification | DB + handoffs |
| T32 | Bare reply/phone/callback/completed call never qualifies Opportunity; buyer never seller Lead; no accidental PPC conversion or appointment auto-stage | DB + legacy/CRM |
| T33 | Manual callback works with calendar absent; named-zone/DST times and08:30 floor; task and stated request remain distinct | Unit + browser handoffs |
| T34 | Real availability changes before booking; slot expired, concurrent booking, API timeout: conflict/uncertain shown, duplicate event avoided | Calendar adapter fixtures + authorized provider check |
| T35 | Acquisitions-only explicit qualification records human assessment/evidence once, preserves advanced stage/source, reports linked outcome | DB + handoffs + signed-in CRM |
| T36 | Primary domain/subdomain rejected; DNS pending/failing/verified independent; duplicate SPF/MX conflict/brand HTTPS detected; stable sender | DNS adapter fixtures + domains |
| T37 | Outbound/receiving domain + token alias reply/header chain round-trip; retired sender still receives; no fake RFC ID; brand uses actual config | Provider + browser |
| T38 | Unauthorized/expired download denied; HTML never executes, remote images blocked, retention/legal hold preview preserves suppression | Browser + DB retention |
| T39 | Opt-out repeated/scanner GET/one-click POST; all-domain stop, no confirmation email; release needs evidence and never auto-enrolls | HTTP + DB suppression |
| T40 | Worker crash/restart/lease expiry/fencing/retry/dead letter/manual replay; uncertain send cannot become a blind resend after24h | DB + jobs/provider fixtures |
| T41 | Signed raw webhook valid/invalid/duplicate/different payload/out-of-order/before send response; durable ack only, full-body fetch failure holds sending | HTTP + DB inbound |
| T42 | Worker heartbeat green but ingress missing: UI stale, automation held; incident acknowledgment doesn't clear failure; recovery evidence required | DB + jobs + browser |
| T43 | Report totals reconcile to ledger/events with cohort vs event-period, duplicate contacts/messages, source attribution and excluded tests; safe export | DB + reports/browser |
| T44 | Delivered isn't opened/interested; Opportunity requires qualification; contract/revenue only confirmed CRM records; zero vs unknown distinct | DB + reports |
| T45 | Public preferences/brand routes expose no CRM identity, unknown/forged token neutral, CSRF on private commands, host allowlist, no open redirect | HTTP security + browser |
| T46 | Keyboard complete flow, labels/focus/errors/dialog escape, mobile panes, light/dark, contrast, no clipped actions or horizontal page overflow | Authenticated Playwright + visual review |
| T47 | All legacy email entry points inventoried; campaign human sends, buyer broadcasts and Gmail dedup share correct guards without breaking SMS/TC | Integration + targeted regression |
| T48 | Feature disabled rollout/rollback preserves incoming events/suppressions/history; deployed revision+schema verified; pilot evidence recorded honestly | Release rehearsal + authorized production verification |
| T49 | Plain-language label/mirror/paraphrase respects actual seller meaning; inferred pain, sensitive-record subject, forced technique and invented quotation blocked; corrected hypothesis never stored as fact | AI guard + model evaluation + human tone review |
| T50 | Contextual copy set generated under draft budget, eligible recipients only, reviewed sample/outliers and exact bytes frozen; sparse evidence safe fallback before approval, changed evidence invalidates copy; duplicate text is allowed | DB + campaign browser + cost/AI fixtures |
| T51 | New phone in current reply alerts proper owner; signature/quoted/third-party phone doesn't create false callback; duplicate event one task/alert; phone alone no Opportunity or calendar booking | Inbound/identity/notification integration |
| T52 | Targeted push and persistent recipient-scoped notification; denied device, no subscription, provider failure, replay, acknowledgment, reassignment and backup escalation; no sensitive lockscreen leak or all-team blast | Auth + delivery fixtures + two-user/device controlled verification |
| T53 | Precise permitted request auto-books real free slot; date-only/range/zone ambiguity clarifies; concurrent conflict/timeout/reschedule/cancel preserves one event and old-reminder cancellation; confirm only after booking | DB + calendar adapter + authorized provider/browser journey |
| T54 | Weekday no-response follow-up7–10 calendar days from actual acceptance; default Friday+8 rolls to Monday/day10; no weekend dispatch, reply cancels, health/capacity hold can exceed window visibly; callback alerts unaffected | Clock + scheduler/DB tests |
| T55 | Stable line routes known owner/unknown intake/backup/voicemail; actual agent-leg no-answer creates one task; reserved number protected; no surprise SMS, dial, PPC conversion, duplicate Lead or false exact-campaign attribution | Voice webhook fixtures + authorized end-to-end inbound call |
| T56 | Fixed comparable control/contextual-copy cohorts, deduplicated people, pinned versions and outcomes; no opens/reply-count-as-success; workload capacity blocks overbooking/new intake and after-call work has owner/next action | DB reports/assignment + browser |
| T57 | All inbox predicates in08 distinguish due work, AI queued/running, waiting, review, call obligation, closed and effective unsubscribe; owner/campaign facets combine correctly; counters and rows use identical authorized scope; stopped thread with unresolved duty remains actionable | Shared-query unit + RLS/DB + browser |
| T58 | Saved filter view owner-only, invalid/inaccessible query visible, URL precedence, search cancellation, pagination, empty result and Back preserve scope; reading/filtering never acknowledges work, releases AI or clears suppression | DB auth + two-user browser |
| T59 | Two active campaigns share atomic sender/provider/workspace budgets and fair pacing; concurrent enrollment of same known person/program rejected; per-campaign pause isolated; unknown campaign attribution held; no capacity multiplication or backlog burst | Scheduler/DB race + campaign browser |
| T60 | Campaign recipient picker imports/selects/maps/previews/excludes/restores with reconciled counts and reasons, duplicate/active-elsewhere restriction, verification failures, frozen publication and explicit new-cohort review; no automatic send or Lead | DB + import/campaign browser |
| T61 | Complete drip editable in draft/readable live; actual-acceptance date preview with Friday→Monday day10; window/timezone/invalid waits; every body shown; edit invalidates review, old cohort stays pinned, reply/hold outranks dates, completion never loops | Scheduler clock + campaign browser + revision/DB |
| T62 | Inbox is agent landing page, campaign list handles multiple simultaneous states, More retains permitted repair tools; deep links/Back/filter chips, reason→next action, mobile single pane and keyboard work without unread-driven obligations or hidden failures | Authenticated light/dark narrow/wide browser journey |

## 4. Integrated foundation before full UI build

Required early journey after minimum schema/auth/provider/guard/thread foundation: workspace setup → one controlled recipient with documented permission → campaign draft/review → one actual send → real reply/full body → draft or bounded approved action → human takeover in shared inbox → Lead/handoff task → public opt-out. Repeat with duplicate event, stale draft and timeout. Operator sees provider IDs, exact From/reply path and persisted cancellation. No fabricated seller lead/test ad conversion; use explicit test marker and exclude all test records from operational metrics.

A test domain/account and authorized receiving mailbox may be needed during this milestone before final production setup. If access is unavailable, implement/test mocks and mark **provider verification blocked**, continue independent UI/data work, and do not claim the foundation proved. Do not defer unknown provider threading/auth behavior until every screen is built.

## 5. Build and review gates

| Gate | Required evidence | Next allowed work |
| --- | --- | --- |
| G0 Baseline | EM-001 inventory, current branch/schema/lockfile/auth/hosting constraints, decisions reconciled | Additive contracts and isolated implementation |
| G1 Foundation | Schema/RLS/guard/job unit+DB race tests; secrets and known provider contracts reviewed | Controlled integration setup |
| G2 Complete path | T09/T10/T14/T28/T32/T37/T39/T40/T41 evidence through one complete journey | Finish higher-volume operations/pages |
| G3 Product complete | All action IDs implemented, all P-pages accessible with required states, relevant T-tests passed | Release candidate review |
| G4 Automatic mode | T21–T23 model-backed results, human review, fixed version/cost | Campaign-level opt-in to bounded automatic replies |
| G5 Production ready | Migrations/release authorized, disabled deployment verified, exact revision and real credentials/readiness | Wizard final setup and reviewable pilot |
| G6 Pilot | Owner deliberately launches bounded campaign; real monitored outcomes and pause available | Evaluate expansion; no automatic volume/autonomy escalation |

Read SQL/permissions, remote side-effect/retry logic, ownership races and existing CRM integration as separate review concerns before release. If an independent reviewer is required by the future implementation instructions, obtain that review; do not fabricate it or spawn agents under the present design-only authorization. Each task packet requests a reviewable diff and evidence, not an immediate production push.

## 6. Deployment and rollback runbook

1. Record implementation SHA, intended target, clean task diff, baseline unrelated changes, migrations and exact checks. Verify package/runtime guides. Build release candidate with email UI flag off and dispatch switches false.
2. Validate backup/restore access and migration plan on disposable/staging database. Inspect source constraints and duplicate-index preflight. Apply additive migrations only under the authorized target operation; record results.
3. Deploy disabled feature under authorized deployment operation. Verify exact release SHA, runtime env presence without printing values, server auth, routes, public signed webhook/unsubscribe exceptions, job auth, schema, private storage and secrets decrypt.
4. Enable inbound capture and suppression before outbound. Send only explicitly authorized test mail to allowlisted controlled accounts. Verify signed-in desktop/mobile flow and provider IDs, current ingress/worker health and suppression across domains. A successful build alone does not pass.
5. Final wizard connects production services/domains/team, imports eligible audience, pins evaluated policy, enters actual costs/caps and runs current readiness. Setup finish retains draft campaigns.
6. Review first campaign exact version/recipients/exclusions/copy/hours/budget; user launches deliberately. Start with proposed conservative pilot limits only if user selected them. Default draft-only until G4 and campaign permission allow more.
7. During pilot, provide in-app actionable incidents/replies/handoffs and health/cost truth. Inspect first actual sends/replies plus source freshness. Track human workload and qualified outcomes; do not scale from open rates or assumed inbox placement.

**Immediate rollback:** workspace send_enabled=false and ai_auto_enabled=false. Preserve inbound/webhooks/unsubscribe. Stop queue claims for outbound, cancel queued intents, list already-dispatching/uncertain sends honestly. Roll back app feature flag/revision if needed without dropping tables or key material required to decrypt pending data. Old app must still route public opt-out to working handler or separate preserved endpoint; if not, rollback is incomplete and sending stays off. Reconcile unknown remote sends before resuming. Resume only from current readiness and paced remaining recipients, not a replay of the old backlog.

**Incident playbooks:** invalid webhook secret → pause affected automation, restore verification, replay saved/provider events; provider outage → retain queue and uncertain ledger, no domain rotation; lost credential key → restore key version, no empty-secret fallback; missing inbound gap → hold relevant sender until backfill evidence; duplicate message → pause, trace intent/provider IDs and fix dedup before restart; bad AI reply → disable auto, preserve evidence, human takeover, patch policy/evaluation and publish new version; report mismatch → label stale/unknown and reconcile source without hiding actual messages.

## 7. Status record template

Every completed implementation packet appends: task ID; implementation SHA; files changed; test command and exit result; fixture/eval/provider IDs as applicable; browser route and environment; observed output; outstanding limitation; reviewer if actually involved; next ready task. Never mark a packet complete with missing dependencies or an unrun required check. Record blocked external checks separately so independent work can proceed.

No current application tests, provider probes, migration, subscription, domain registration, live campaign or deployment are claimed by this document.
