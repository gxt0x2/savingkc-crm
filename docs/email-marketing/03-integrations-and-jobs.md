# Integrations, commands and durable execution

Specification v1.2 · 2026-09-12 · Proposed implementation contracts.

v1.2 adds personal `em_inbox_views`, shared authorized filter/count predicates and focused campaign navigation in [08](08-focused-workspace-and-cadence.md). Shared capacity and same-program active enrollment protection must apply across campaigns; filters never alter business state.
## 1. Architecture and file boundaries

Use existing Next.js/Supabase/Resend infrastructure. Add a PostgreSQL job queue and short Vercel worker; no extra campaign SaaS or separate queue subscription in v1. The UI, worker and provider adapters call the same domain services. React components never call providers directly.

Read the [current implementation baseline](implementation-baseline.md) first. Reuse verified actor resolution, canonical CRM entity/lifecycle/qualification authorities and existing Conversations state through explicit bridges. Include mobile, buyer broadcast and transactional draft entry points in suppression/control integration, applying the correct purpose-specific policy. Pending live schema evidence must be resolved before dependent SQL or canonical writes.

Proposed code ownership:

```
src/lib/email/
  contracts.ts             # Zod commands, DTOs, enums
  auth.ts                  # session, membership, capabilities
  db.ts                    # scoped repository and transaction RPC callers
  config.ts secrets.ts     # readiness and encrypted credential access
  identity.ts audiences.ts # matching, imports, eligibility
  campaigns.ts             # immutable publication and enrollment
  guards.ts limits.ts      # deterministic dispatch and reservations
  threads.ts drafts.ts     # controller, revisions, shared compose
  suppression.ts           # all-domain restrictions
  crm-adapter.ts           # lead/activity/handoff qualification bridge
  handoffs.ts calendar.ts  # human next actions, optional Google Calendar
  jobs.ts worker.ts        # durable claim and fenced completion
  reports.ts costs.ts      # provenance, freshness and monetary ledger
  commands/*.ts            # handlers grouped by domain
  providers/resend.ts verification.ts ai.ts
  inbound/verify.ts ingest.ts correlate.ts project.ts
  ai/policy.ts prompts.ts evaluate.ts
  __tests__/*.test.ts
src/hooks/use-email.ts
src/components/email/*
src/app/(app)/marketing/email/*
src/app/api/email/actions/route.ts
src/app/api/email/[resource]/route.ts
src/app/api/email/[resource]/[id]/route.ts
src/app/api/email/connections/route.ts
src/app/api/webhooks/email/resend/route.ts
src/app/api/workers/email/route.ts
src/app/email/unsubscribe/[token]/page.tsx
src/app/api/email/unsubscribe/[token]/route.ts
src/app/email/brand/[domain]/page.tsx
```

These are new paths, not claims that files already exist. Next route handlers use Node runtime and installed-version guides; await async params and auth APIs. The isolated implementation checkout now has locked Next 16.3.4 dependencies and its installed documentation; the baseline records the guides read. Read further relevant guides before associated app code. Do not change framework versions to avoid this step.

## 2. Connections, secrets and subscriptions

Connection choices: Resend for transport; OpenAI Responses as the initial dedicated email AI adapter; ZeroBounce as the initial optional automated verification adapter; existing Google Calendar connection for optional scheduling. These last two external-service choices are design defaults, not subscriptions selected or purchased by Ernest. Importing recent verifiable address-check results is supported so a second verification purchase is not mandatory. Existing Groq call-analysis code has a different pipeline scoring contract and must not be reused as email qualification logic.

For each provider, show Connected / Needs access / Needs credits / Account created, unverified / Failed separately. Account billing often cannot be read with an ordinary API key: store owner-entered plan, source link and date as **reported** terms, not verified account billing. The wizard never promises automatic checkout or subscription cancellation. “Create account” opens an allowlisted official signup link, saves the step, and returns to Connect; no card fields inside CRM. Domain registration follows the existing registrar's checkout. v1 includes no registrar purchasing API or automatic domain shopping. A domain text entry does not prove availability or ownership.

Credential endpoint: `POST /api/email/connections`, session owner/admin + same-origin CSRF checks, JSON `{kind, provider, secret, expectedRevision, accountLabel}`; success returns masked connection DTO, never secret. Password input is write-only, no autofill persistence, cleared after submit; TLS sends it to server. Disable request-body telemetry for this endpoint. Optionally bind a known deployment secret reference without returning its value. Validate API access server-side before connected. Browser transient form input is unavoidable for pasted keys; no key in URL, localStorage, ordinary app state store, error, audit or analytics.

Store dynamic keys using Node `crypto` AES-256-GCM, random 12-byte nonce per write, AAD = workspace/connection/provider/key-version. Deployment-only master key `EMAIL_CREDENTIALS_KEY_V1` never stored beside ciphertext or exposed with `NEXT_PUBLIC_`. Failure to load/decrypt pauses dependent work. Rotation decrypts with old version, encrypts with new nonce/version and records successful check before switching; retain old key through rollback window. Webhook signing secret uses same storage. API keys should have needed scopes only; limited sending-only keys cannot pass receiving/domain readiness. A separate admin connection may manage domains if transport key is scoped. Provider SDK logs must be scrubbed of authorization headers and recipient/message content.

Disconnect previews affected senders/campaigns. On confirm, pause them, revoke local secret access, leave inbound receipt processing available where credentials still valid, and retain immutable history. Deleting a provider account remotely is outside this command. Account replacement creates a new connection row; never rewrite historical provider IDs to the new account.

## 3. Command and read API

All ordinary mutations use `POST /api/email/actions` with this discriminated envelope:

```ts
type CommandRequest = {
  command: ActionId; // exact IDs in 04, only server-backed actions
  idempotencyKey: string; // UUID, stable until operation is resolved
  entityId?: string;
  expectedRevision?: number; // required for existing mutable entities
  payload: ActionPayload; // strict Zod object for the selected command
};
type CommandResult = {
  ok: true; requestId: string; entityId: string; revision: number;
  state: string; jobId?: string; invalidates: string[];
};
type CommandError = {
  ok: false; requestId: string;
  error: { code: string; message: string; fieldErrors?: Record<string,string>;
    retryable: boolean; currentRevision?: number; blockedBy?: string[] };
};
```

Return 200 for durable completed actions, 201 new entity, 202 for durable queued job. A 202 is “Queued/checking,” never “sent/verified.” Validation 422; no session 401; missing role 403; inaccessible/missing record 404; stale revision/idempotency mismatch 409; rate cap 429 with retry time; external outage 503. A replay of the same key/payload returns the stored result. Client timeout → query command receipt before creating any new key. Cap JSON body at 256 KB except the dedicated upload route; reject unknown keys. One user capability check per command plus service-level authorization, not just hidden buttons.

GET resources are allowlisted: `overview`, `setup`, `connections`, `domains`, `senders`, `audiences`, `imports`, `campaigns`, `threads`, `reviews`, `handoffs`, `playbooks`, `suppressions`, `operations`, `reports`, `settings`, `test-runs`, `command-receipts`. Detail `/[resource]/[id]` only for corresponding entities; no generic table access. Lists accept `{cursor?,limit=50,query?,state?,ownerId?,program?,campaignId?,from?,to?}` with resource-specific allowlists, max limit100; cursor contains stable `(sort_value,id)` and active filter hash. Response `{items,nextCursor,asOf,freshness:{state,sourceAsOf,lagSeconds},totals?}`. Detail adds `revision`, permitted actions with disabled reason, and evidence references. Filter/sort changes reset pagination and preserve URL state. Authenticated responses are private/no-store; public brand may cache safe content.

Auxiliary routes: `POST /api/email/uploads` returns scoped private upload target and import ID after file metadata validation; `POST /api/email/uploads/[id]/complete` verifies stored bytes/hash/limits before processing; `GET /api/email/downloads/[id]` authorizes sanitized attachment/error/export download. `GET /api/email/calendar/slots` returns real available slots, timezone, checkedAt and token; no side effects. Add exact routes to route/auth tests. Never expose all `/api/email/*` as public.

Audit event name is the action ID, with actor, request ID, entity, reason and hashes. Background events use explicit `worker.<kind>.<outcome>` names. Client React Query keys start `['email', workspaceId, resource,...]`. Command invalidation updates related keys plus existing CRM contacts/conversations when projected. Realtime events carry IDs/revisions only; refetch actual records, debounced. Poll active jobs every3 seconds up to30 seconds then10 seconds while visible; inbox fallback every15 seconds. Background tabs back off; server worker continues independently.

## 4. Sending provider contract

```ts
interface EmailTransport {
  checkCapabilities(): Promise<CapabilityResult>;
  createDomain(input: DomainInput): Promise<DomainResult>;
  verifyDomain(providerDomainId: string): Promise<DomainResult>;
  retrieveDomain(providerDomainId: string): Promise<DomainResult>;
  send(payload: FrozenEmail, key: string): Promise<
    {kind:'accepted'; providerId:string} |
    {kind:'rejected'; code:string; retryable:boolean} |
    {kind:'uncertain'; code:string}
  >;
  retrieveSent(providerId: string): Promise<ProviderMessage>;
  retrieveReceived(providerId: string): Promise<ReceivedMessage>;
}
```

Resend sending must inspect both returned `data` and `error`; a resolved Promise alone is not success. Use `resend.emails.send(payload, {idempotencyKey})`; frozen payload contains one recipient, stable From, reply alias, text/HTML equivalent, tags with non-PII campaign/intent IDs, and required unsubscribe headers. Persist acceptance before scheduling a next sequence step. Provider acceptance is neither delivery nor inbox placement.

Resend retains idempotency keys for **24 hours**. Our persistent intent remains the authority beyond that window. Network timeouts become uncertain; recover known provider IDs from events/retrieval. Same-key retry of identical payload is allowed inside the documented window with bounded attempts. Unknown outcomes outside it are held for human/provider reconciliation, never blindly resent. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Each sequence follow-up uses the original thread sender and known RFC reference chain. For replies, `In-Reply-To` is the RFC `message_id` from the received email, not the provider email UUID; preserve `References`. If the outbound RFC ID cannot be recovered, hold threaded follow-up pending retrieval/integration investigation; do not fabricate it. The initial controlled path must prove header behavior. [Resend reply threading](https://resend.com/docs/dashboard/receiving/reply-to-emails).

Delivery-event reducer stores sent/accepted/delivered/bounced/complained facts independently. Opens/clicks are off initially; if later introduced, they are diagnostic only and cannot create Leads. Imported replies, auto-replies and own test messages are excluded from seller-interest metrics.

## 5. Domains and incoming mail

Configure sending **and receiving** capabilities explicitly; Resend domain creation defaults receiving off. Use returned DNS records including names, types, values, priority and verification status; do not hard-code another account's SPF/DKIM/MX. Domain create is not a purchase. [Domain API](https://resend.com/docs/api-reference/domains/create-domain).

Dedicated sending domain has its own receiving MX; do not replace the primary business mailbox's MX. Wizard checks primary-domain exclusion, DNS conflict, SPF duplication, DKIM, DMARC presence/alignment and inbound destination. Owner sees exact records before applying them through their registrar; v1 Copy record / Recheck. Brand page hosts verified business identity, contact, privacy link and affiliation. Email verification and website HTTPS/host mapping are separate readiness items.

Reply-To uses a high-entropy alias at the configured receiving domain, mapped to thread and mailbox. Use the stable sender From for initial and human/AI replies; disclose changed human operator in signature where relevant. Unknown aliases are quarantined for review with no auto-response. Authenticate inbound using signed provider delivery plus available message authentication results; a valid webhook authenticates provider transport, not the original sender's identity.

Webhook `POST /api/webhooks/email/resend`: read raw body once, enforce maximum payload2 MB, verify signature/timestamp with configured signing secret and the SDK/Svix verifier, then parse. Never verify a reserialized JSON object. Persist event and minimal safely correlated inbound hold transactionally, then acknowledge200. Duplicate event returns200 after checking identical payload. Failed durable storage returns5xx so provider can retry; invalid signatures4xx. [Verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [retry behavior](https://resend.com/docs/webhooks/introduction).

`email.received` includes correlation metadata but is not assumed to contain the entire conversation body. Retrieve complete content with `resend.emails.receiving.get(id)`, normalize text/HTML/header fields and persist privately before AI. [Received-email retrieval](https://resend.com/docs/api-reference/emails/retrieve-received-email).

Inbound order: authentic event → durable hold → fetch/decode full MIME/content → correlate → append canonical message → cancel sequence → immediate opt-out/auto-response guards → classification job → CRM projection. Delayed body retrieval keeps thread/sender hold visible. Preserve provider time and server received time; do not reorder ownership history based on a sender-controlled Date header. Delivery events may arrive before send response; reducer attaches by provider ID or non-PII tag/known intent and reconciles under lock.

Poll/reconcile pending provider messages every5 minutes; source staleness independently blocks dependent automation. If provider list/history retention cannot backfill missing inbound, show exact gap and keep affected automation paused until mailbox/provider evidence resolves it. A healthy worker heartbeat alone does not prove ingestion health.

## 6. Public unsubscribe and legacy paths

Email headers include `List-Unsubscribe` HTTPS token endpoint and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. GET `/email/unsubscribe/[token]` renders a generic confirmation with a button; a scanner GET does not mutate preferences. POST `/api/email/unsubscribe/[token]` accepts one-click form payload or confirmation submission, needs no login and immediately records all-marketing suppression. Token is random ≥128 bits, mapped using a keyed hash, contains no plaintext email. Token persists for message lifetime; rotate signing/hash keys with old-token support. Do not require an expiring login, CAPTCHA, reason, or preference choice to unsubscribe. Return generic success for repeat requests; do not disclose identity or counts. Invalid token shows a neutral support route, not recipient data. Preferences can narrow program only through a separate explicit choice after broad opt-out; no default resubscribe.

Suppression commits before asynchronous cancellation/projection. Dispatch always rechecks current restrictions, so cancellation backlog cannot leak sends. No automatic confirmation email after opt-out. Complaint/hard bounce blocks immediately. A public unauthenticated endpoint cannot release suppression.

Existing `/api/conversations/send` must detect `emailThreadId` or known thread/address and delegate to guarded human send; absent explicit thread context on a campaign address returns a choose-thread conflict. Existing buyer email `/api/broadcasts/send` delegates through shared permission/suppression/intent service before v1 is complete, while preserving its existing opt-in gate. Inventory every Resend call in EM-001/EM-022 to prevent bypass. Transactional messages stay a distinct purpose and may not be used to relabel marketing. Gmail sync projects a matching RFC ID once and never acquires control or creates duplicate campaign replies.

## 7. Verification and AI adapters

Automated verification is optional if a recent, provenance-bearing verification file is imported. Verification provider is replaceable behind `verify(address): {state,checkedAt,expiresAt,provider,rawStatus,evidenceRef,cost}`. v1 ZeroBounce mapping: `valid` with no adverse substatus → valid; invalid/spamtrap/abuse/do_not_mail → blocked; catch-all/unknown or adverse/unsupported substatus → review/unknown. Role-based/disposable/possible-trap and catchall flag remain excluded by default even if top status says valid. Never auto-apply a suggested spelling correction. Use server POST form body for key/email, omit IP if unknown; request only validation, not unnecessary demographic enrichment. Cache by normalized address and verification policy for30 days; reused evidence costs zero incremental calls. [Validation API](https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails).

AI adapter: server `POST https://api.openai.com/v1/responses` with configured model ID, system/developer policy and bounded untrusted message data, `store:false`, no tools, capped output, and strict `text.format` JSON schema for 05 §2. Use compatible supported SDK version or typed HTTPS adapter, validate response again with Zod. Refusal, incomplete output, timeout and schema failure become review/hold, not sendable prose. Strict structure does not establish factual correctness. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

No runtime model is selected based solely on the coding model used to implement this product. Choose the lowest-cost account-available model that passes the fixed evaluation suite and latency/cost caps; pin its ID and rate card in a published policy. Candidate set and rate provenance are recorded by EM-013; no unbounded model discovery or silent model upgrade. A more expensive fallback requires an owner-configured cap and its own evaluation pass. Otherwise queue human review. Reuse an existing suitable API account when available. Unknown price/model access keeps cost readiness pending.

## 8. Worker and job contracts

Desired schedule: one-minute authenticated Vercel Cron calls `GET /api/workers/email`; constant-time compare `Authorization: Bearer CRON_SECRET`. Same endpoint may accept explicit server-triggered POST, never public browser requests. The queue is durable between invocations; the browser and Codex are not schedulers. Pro/Enterprise currently support per-minute cron; Hobby supports only daily invocation. EM-001 verifies the actual plan before adding cron configuration; display any needed hosting upgrade as an actual prerequisite. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Worker invocation budget45 seconds, lease90 seconds with renewal only by lease holder, batch20, network concurrency2 initially. Stop claiming when less than10 seconds remain. Provider send timeout10 seconds; inbound retrieval15; AI20; verification30 (claim separately with enough budget). Jobs with uncertain remote effects use reconciliation path when a lease expires. Fenced compare-and-set completion prevents an expired worker overwriting a newer result. Order inbound/restrictions before outbound; bounded fairness prevents import jobs starving replies. Limits are configuration checked against deployed function duration.

| Job kind | Dedupe key | Success / failure behavior |
| --- | --- | --- |
| import_chunk | import ID + chunk offset | Normalize/upsert250 rows, advance cursor transactionally; malformed rows captured individually |
| verify_address | address + policy + evidence epoch | Persist evidence/cost once; unknown holds recipient; quota/auth failure pauses verification queue |
| publish_enrollments | campaign version + chunk | Frozen snapshot, unique enrollments and sender allocation; partial progress visible; draft launch can be canceled before next dispatch |
| schedule_due | workspace + minute | Claim due items, re-evaluate all guards, calculate not-before in timezone; no backlog burst |
| dispatch | intent ID | Fenced authorize/send/reconcile; never retry arbitrary new payload under old key |
| ingest_event | connection + provider event | Full-content fetch, dedup and holds; retries preserve unread/inbox truth |
| classify_reply | thread + content + policy revision | Validate/persist decision, review or approved intent; discard stale computation after newer reply |
| project_crm | canonical event ID | Once-only timeline/Lead projection; display sync pending on failure; do not drop source event |
| handoff_reminder | handoff + due version | Persistent owner-scoped CRM notification plus configured targeted push; acknowledgement distinct from delivery, backup escalation; no unconfigured external channel or automatic dialing |
| reconcile_provider | connection + five-minute bucket | Resolve known IDs, refresh readiness/health; unmatched events remain visible |
| recompute_reports | workspace + hour bucket | Incremental aggregates with event watermarks; no current-looking zero on failure |
| retention_preview | workspace + day | Count eligible expired objects/legal holds; actual purge disabled until owner policy activation |

Retry internal read/idempotent jobs after30 seconds,2 minutes,10 minutes,30 minutes,2 hours (jitter ±20%), then dead with owner-visible incident. Honor provider Retry-After on429. Auth/permission/schema errors are terminal actionable incidents, not five retries of a wrong key. Known rejected send can retry with same immutable intent inside safe window; uncertain send follows §4. No poison job blocks other eligible threads. Manual replay is internal processing only, not an undocumented resend button.

## 9. Calendar, handoffs, notifications and costs

Request-to-talk: create/attach Lead if evidence allows, stop AI after at most a permitted acknowledgment, create handoff with stated phone/time and owner. A bare new phone number triggers owner notification but no guessed appointment. With no calendar connection create a callback task and Schedule manually. With an enabled scheduling policy, sufficiently precise seller request and usable number, recheck actual availability, owner, timezone, duration/buffers/capacity and08:30 boundary, then automatically book and notify. Date-only/range requests need one clarification or an offered exact slot first. Booking uses a5-minute checked-slot token and stable operation key; provider timeout stays uncertain until reconciled. Confirmation email is guarded and follows successful booking; human-owned threads retain owner control. No automatic guest calendar invitation or SMS by default. Reschedule/cancel updates the same event and reminders. Full contract: [07 §4–§5](07-sales-voice-and-response-operations.md).

Team notifications use recipient-scoped persistent CRM work plus configured targeted push for urgent requests and appointments. Delivery, acknowledgment and work completion are distinct. Missing/unsubscribed push is actionable, not proof of delivery; setup verifies at least one chosen alert path for responsible staff and backup. Existing local push infrastructure can be adapted after auth/device checks. No Slack/SMS/notification-email fallback or dialing is enabled silently; fallback channel is an explicit setup choice. Dedupe and escalation follow [07 §4](07-sales-voice-and-response-operations.md).

Cost preflight separates existing subscriptions, incremental subscriptions, domain purchase/renewal, per-email use, verification, AI tokens and hosting. Values carry `source`, `asOf`, `estimated` and unit. Formula: maximum sequence messages = eligible recipients × steps; AI upper estimate = configured reply cap × upper token allowance for selected share of replying threads, with low/base/high assumption shown. Reserve worst allowed operation cost before starting; settle real tokens/known provider use afterward. Never represent a local spend cap as a promise to stop a provider's fixed subscription or unrelated account usage. Provider bill reconciliation retains variance as an adjustment. A budget reached mid-conversation creates review work and keeps inbound available.

## 10. Readiness contract

Readiness returns items `{id,label,state:verified/pending/failed/not_needed,checkedAt,evidenceIds,blocks[],nextAction}`. Overall “Ready to launch” requires: business/address; exact program/audience scope; email API send+receive; external domain DNS+brand+actual inbound test; sender identity; worker cadence and fresh ingress; assigned reviewer/backup; policy/evaluation; audience permission/verification/suppression; fresh snapshot; reviewed copy/timing/limits; known cost bounds; kill switch tested. A simulation never satisfies provider verification.

Production configuration changes invalidate only dependent evidence using hashes. Launch readiness snapshot valid5 minutes and is rechecked in publication transaction; dispatch still evaluates mutable restrictions. Finishing setup and enabling workspace sending are distinct commands; neither automatically launches draft campaigns. Sending disabled must still allow inbound capture, suppression, reads, drafts and human task handling.
