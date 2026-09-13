# Email data and state contract

Specification v1.2 · 2026-09-12 · Design, not an applied migration.

v1.2 adds personal `em_inbox_views`, shared authorized filter/count predicates and focused campaign navigation in [08](08-focused-workspace-and-cadence.md). Shared capacity and same-program active enrollment protection must apply across campaigns; filters never alter business state.
## 1. Existing CRM integration

The original design used revision `cbd2da47e25433d37a95c9ae9f81089953d4276d`. The [2026-09-12 implementation baseline](implementation-baseline.md) reconciles source against `d03bb95e16e92da67530d62bc911589951833ba0` and takes precedence over older assumptions. Authenticated target schema inspection remains pending before SQL. A file describing a table is not proof of the deployed schema.

Reuse the current canonical `crm_people`, `crm_contact_methods`, `crm_properties` and `crm_lead_entity_links`; `em_parties` adapts email relationships and stores confirmed canonical references, without creating another master identity. Keep compatibility lead IDs, but use reviewed canonical lifecycle commands and their business guards rather than direct station writes. Operational Manifest writers are retired. Bridge existing `conversation_thread_state` and the Conversations read model into the same controller/dispatch guards; existing owner text is not an AI lock, and unmatched email chains need a stable key extension. See the baseline for exact sources and current send entry points, including mobile and transactional drafts.

| Existing surface | Use | Required boundary |
| --- | --- | --- |
| `src/types/pipeline.ts` | Canonical stages: `new` = New, `contacted` = Leads, `qualified` = Opportunities | Positive seller interest can create/advance a Lead to `contacted`; only an acquisitions user qualifies to `qualified` |
| `leads`, with current canonical entity authority | Compatibility acquisition/contact projection | Reuse confidently matched canonical person/property and lead links. Never manufacture a phone number or create one lead per campaign |
| `prospects`, `prospects.lead_id` | Property/list identity before interest | An audience import does not create a Lead. Preserve prospect and parcel references |
| `lead_activities` | CRM timeline projection | Project each email message once with `metadata.email_message_id` and `metadata.email_thread_id`; canonical email body/state lives in email tables |
| `hot_opportunities_cache` | Existing derived score/display | A score is not a qualification event; do not populate it to manufacture Opportunities |
| `src/lib/prospect-to-lead.ts` | Reference for current phone-driven promotion | Its call/SMS helper assumes inbound phone and seller-called-in semantics. Write a canonical email adapter; do not restore retired Manifest writers |
| `src/lib/pipeline-auto-advance.ts` | Existing cross-channel automation | Email classification/activity must not invoke automatic pillar-based qualification or PPC conversions |
| `/api/leads/create-appointment` | Existing appointment workflow | A simple callback request must not trigger stage advancement, SMS reminders, dialing, or PPC conversion. Use the email handoff adapter |
| Conversations send and Gmail sync | Existing email display/send | Route known campaign threads through the same guard and controller. Deduplicate Gmail projections by RFC Message-ID, not subject/name |

`email_marketing` is the proposed new `leads.source` value; extend the actual existing source constraint additively. Keep first-touch source on existing leads; attach email attribution as an activity/touch instead of overwriting it. A new email-only Lead needs nullable phone support; verify nullability and dependent renderers in EM-001/EM-014. If absent, make a narrow additive compatibility change. Do not use a dummy number or another source label.

Seller Lead conversion requires an unambiguous identity/property context and cited seller interest. If identity is unresolved, keep the conversation and create review work. Existing `qualified`, appointment, offer, contract, or closed stages are never demoted. Parked, dead, archived, and closed records require human review before reactivation. An explicit callback request linked to selling can create a Lead, but a bare phone number cannot. Buyers remain buyer records and never enter the seller pipeline through this engine.

## 2. Storage conventions

Use the existing Supabase PostgreSQL database. All new tables use prefix `em_`. UUID primary keys default server-side; timestamps are `timestamptz` in UTC. Money is integer micro-USD (`bigint`), displayed in USD with an as-of rate if another currency is later supported. Revision numbers are positive `bigint`. Text enums use CHECK constraints and shared Zod schemas. JSON columns named below require typed schemas; they are not permission bags or arbitrary patches.

This is one SavingKC workspace, not a SaaS tenant product. Every child row has `workspace_id` referencing one `em_workspaces` row; the workspace parent itself uses its primary `id`. The server derives the workspace from the signed-in membership, never trusts a request-selected workspace. This allows consistent isolation without building signup/billing tenancy. Child foreign keys include workspace consistency through composite unique keys/FKs. Cross-workspace references fail in the database.

Unless noted, mutable tables include `id`, `workspace_id`, `created_at`, `updated_at`, `revision`; append-only records omit `updated_at`/`revision`. `?` means nullable, `[]` array, `→` foreign key. Every unmarked field below is required. Delete is restricted for historical parents; UI archive changes status. Display names are bounded to 120 characters; notes to 4,000; plain email body to 100,000 decoded characters. Oversized inbound content is retained privately but excluded from automatic handling.

## 3. Table contracts

v1.1 additions in [07](07-sales-voice-and-response-operations.md): immutable recipient copy sets/content references (§3), recipient-scoped notification delivery/acknowledgment (§4), expanded scheduling policy (§5) and explicit email-response telephone purpose (§6). These supplement the tables below and are required by EM-031–EM-034.

### Configuration and identity

| Table | Fields in addition to conventions | Constraints / indexes |
| --- | --- | --- |
| `em_workspaces` | `name`, `business_address`, `primary_domain`, `timezone`, `programs[]`, `setup_completed_at?`, `send_enabled=false`, `ai_auto_enabled=false`, `pause_reason?`, `config` | One initial workspace. `config` schema contains hours, retention, limits and cost settings defined in §8 |
| `em_memberships` | `auth_user_id → auth.users`, `roles[]`, `active` | Unique workspace/user. Roles from §7; bootstrap only existing verified CRM admins |
| `em_setup_steps` | `step` 1–10, `state`, `evidence_ids[]`, `verified_at?`, `invalidated_reason?` | Unique workspace/step. Verification derived from evidence, not a client checkbox |
| `em_connections` | `kind: email/ai/verification/calendar`, `provider`, `state`, `account_label`, `capabilities` typed object, `secret_ref?`, `last_checked_at?`, `failure_code?`, `scope_evidence?`, `cost_terms` | No secret values in readable rows. Scope evidence records program/audience applicability, date and provenance |
| `em_connection_secrets` | `connection_id`, `key_version`, `ciphertext`, `nonce`, `auth_tag` | Private server-only table; encryption contract in 03 §2. Unique connection/key version |
| `em_domains` | `connection_id`, `name_ascii`, `provider_domain_id?`, `sending_state`, `receiving_state`, `dns_records`, `brand_url`, `last_verified_at?`, `paused`, `health_state`, `health_as_of?` | Unique workspace/name. Canonical registrable domain must differ from primary domain, including its subdomains. DNS records are provider-returned values |
| `em_senders` | `domain_id`, `from_name`, `local_part`, `reply_mode=token_alias`, `state`, `daily_limit`, `hourly_limit`, `last_test_run_id?` | Unique domain/local part; active thread sender cannot be deleted/swapped. Case-safe local-part rules restrict configured senders to lowercase ASCII |
| `em_parties` | `kind: seller/buyer/unknown`, `lead_id?`, `buyer_ref?`, `display_name`, `identity_state`, `identity_evidence` | Email identity index, not a second pipeline. One linked lead per party; existing duplicate leads require review, not destructive merge |
| `em_party_properties` | `party_id`, `prospect_id?`, `parcel_id?`, `county?`, `address`, `relationship`, `evidence` | One row per relationship; owner/representative/unconfirmed. Never infer ownership from a list match |
| `em_addresses` | `raw_address`, `normalized_address`, `verification_state`, `verification_provider?`, `verified_at?`, `verification_expires_at?`, `verification_evidence?`, `restriction_revision=1` | Unique workspace/normalized address. Trim; IDNA/lowercase domain, preserve local-part in normalized key. Do not strip dots or plus aliases; suspected case variants are review candidates |
| `em_party_addresses` | `party_id`, `address_id`, `relationship: confirmed/candidate/shared`, `evidence`, `confirmed_by?` | Unique pair. An address shared by parties is not automatically merged; one active marketing conversation per address across the workspace |

### Audiences and campaigns

| Table | Fields | Constraints / indexes |
| --- | --- | --- |
| `em_audiences` | `name`, `program`, `kind: import/segment`, `segment_definition?`, `state: draft/processing/ready/archived`, `last_snapshot_id?` | Segment is allowlisted CRM filters; no arbitrary SQL |
| `em_imports` | `audience_id`, `file_ref`, `sha256`, `mapping`, `state`, `counts`, `cursor?`, `error_file_ref?` | File private; max 25 MB / 100,000 rows. Same file can be intentionally reimported but rows deduplicate by stable source key |
| `em_audience_rows` | `audience_id`, `import_id?`, `source_row_key`, `party_id?`, `address_id?`, `property_ref?`, `source_evidence`, `permission_evidence`, `match_state`, `eligibility`, `reason_codes[]` | Unique audience/source key. Separate valid address, identity match, program permission, and suppression checks |
| `em_audience_snapshots` | `audience_id`, `source_revision`, `created_by`, `row_count`, `eligible_count`, `content_hash` | Immutable; each launch gets a frozen snapshot |
| `em_snapshot_rows` | `snapshot_id`, `audience_row_id`, `party_id?`, `address_id`, `property_ref?`, `eligibility`, `reason_codes[]`, `evidence_hash` | Immutable; unique snapshot/address/property context. Import/export sensitive data remains access controlled |
| `em_campaigns` | `name`, `program`, `state`, `draft_config`, `active_version_id?`, `owner_id`, `paused_reason?`, `archived_at?` | One draft per campaign; draft uses typed config below, with optimistic revision |
| `em_campaign_versions` | `campaign_id`, `version_number`, `snapshot_id`, `playbook_version_id`, `config`, `content_hash`, `published_by`, `published_at` | Immutable. Unique campaign/version. Config pins copy, timing, audience, budgets, senders, mode and business identity |
| `em_enrollments` | `campaign_version_id`, `party_id`, `address_id`, `property_ref?`, `sender_id`, `thread_id?`, `state`, `next_step`, `next_due_at?`, `stop_reason?`, `last_message_id?` | Unique campaign/address across revisions through campaign ID denormalized+FK. Partial unique active workspace/address across campaigns. Shared-person verified aliases also checked under party lock |

Campaign config schema: `audience_id`, `sender_ids[1..10]`, `playbook_version_id`, `mode: draft_only/bounded_auto`, `copy_mode: template/contextual_ai`, `copy_set_id?`, `draft_generation_budget`, `steps[1..4]` each `{id, delay_min_calendar_days, delay_max_calendar_days, target_calendar_day, subject, body_template}`, `timezone`, `weekdays`, `start_local`, `end_local`, `daily_limit`, `hourly_limit`, `max_recipients`, `daily_cost_cap`, `total_cost_cap`, `recontact_days`, `expires_at`, `reply_actions[]`, `required_permission_basis`. Step1 delays are0; subsequent no-response steps use min7/max10/target8 calendar days, weekday sends only. Health/eligibility/capacity can hold past the window; never force dispatch. Subject1–150 characters; rendered body1–10,000. Templates and contextual AI use only permitted evidence; exact reviewed recipient copy is frozen before launch under07 §3. Missing required field excludes the row, never prints undefined. Plain text with simple branded HTML equivalent; no outbound attachments or tracking pixels initially.

### Messages, work and outcomes

| Table | Fields | Constraints / indexes |
| --- | --- | --- |
| `em_threads` | `party_id?`, `address_id`, `sender_id`, `campaign_id?`, `enrollment_id?`, `lead_id?`, `subject`, `reply_alias_hash`, `controller: ai/human/none`, `controller_user_id?`, `controller_revision`, `content_revision`, `state: open/snoozed/closed`, `snooze_until?`, `last_message_at?`, `ingest_pending`, `automation_hold_reason?` | Human controller requires active user. Opaque reply alias ≥128 random bits. Index last_message_at, controller, lead_id. Controller never expires just because browser closes |
| `em_thread_user_state` | `thread_id`, `auth_user_id`, `last_read_message_id?`, `tags[]` | Unique thread/user. Unread is per user, not a team-wide race |
| `em_messages` | `thread_id`, `connection_id`, `direction: inbound/outbound`, `origin: sequence/ai/human/inbound`, `send_intent_id?`, `provider_message_id?`, `rfc_message_id?`, `in_reply_to?`, `references[]`, `from_address`, `to_addresses[]`, `subject`, `text_body?`, `sanitized_html_ref?`, `raw_content_ref?`, `content_hash`, `accepted_at?`, `delivered_at?`, `bounced_at?`, `complained_at?`, `failed_at?`, `received_at?`, `failure_code?` | Unique connection/provider/direction ID; RFC IDs scoped to mailbox+direction to avoid forged global collision. Delivery facts remain independent timestamps; never overwrite delivered with an older accepted event |
| `em_send_intents` | `logical_key`, `message_id`, `enrollment_id?`, `thread_id`, `state`, `frozen_payload`, `payload_hash`, `provider_idempotency_key`, `expected_content_revision`, `expected_controller_revision`, `not_before`, `expires_at`, `first_attempt_at?`, `last_attempt_at?`, `attempt_count`, `provider_message_id?`, `error_code?`, `cost_reservation_id?` | Unique workspace/logical key; one immutable payload per intent. Partial due-state index. Provider call begins only after durable `dispatching` transition |
| `em_provider_events` | `connection_id`, `provider_event_id`, `type`, `provider_time`, `received_at`, `raw_ref`, `payload_hash`, `state: pending/processed/quarantined`, `processed_at?`, `failure_code?` | Unique connection/event ID. Same ID/different payload is quarantined; authenticity checked before insert |
| `em_jobs` | `kind`, `dedupe_key`, `entity_id`, `state: ready/leased/retry/done/dead`, `run_after`, `attempts`, `lease_token?`, `lease_until?`, `last_error?`, `payload_version` | Unique workspace/kind/dedupe key. Claim with SKIP LOCKED + fencing token. Index due states/run_after |
| `em_ai_decisions` | `thread_id`, `content_revision`, `controller_revision`, `playbook_version_id`, `model_id`, `prompt_hash`, `input_hash`, `result`, `guard_results`, `state`, `usage`, `cost_entry_id?`, `latency_ms` | Immutable input/result evidence. No generic tool-call execution. One accepted decision per thread/content/playbook revision |
| `em_drafts` | `thread_id`, `decision_id?`, `body`, `subject`, `state: draft/review/approved/stale/rejected/sent`, `content_revision`, `controller_revision`, `playbook_version_id`, `body_hash`, `approved_by?`, `approved_at?` | An approval binds exact body, thread revisions, sender and policy hash. Editing invalidates approval |
| `em_reviews` | `thread_id`, `draft_id?`, `reason_codes[]`, `priority`, `state: open/assigned/resolved`, `assigned_to?`, `due_at`, `resolution?` | Unique active thread/reason fingerprint; resolving a review does not imply sending |
| `em_suppressions` | `address_id?`, `party_id?`, `scope: all_marketing/program/campaign`, `program?`, `campaign_id?`, `reason`, `evidence_message_id?`, `created_by?`, `effective_at`, `released_at?`, `release_evidence?` | At least address or party. Reason unsubscribe/complaint/hard_bounce/possible_opt_out/manual/imported/wrong_person. Release audited, never deletes original event |
| `em_preference_tokens` | `address_id`, `party_id?`, `token_hash`, `hash_key_version`, `created_at`, `revoked_at?` | Server-only mapping, unique token hash; opaque tokens contain no identity. Revocation cannot strand existing unsubscribe links without a working replacement path |
| `em_handoffs` | `thread_id`, `lead_id`, `requested_by`, `owner_id`, `backup_id`, `state`, `reason`, `facts`, `requested_contact`, `due_at`, `accepted_at?`, `completed_at?`, `outcome?`, `crm_task_id?`, `calendar_event_id?` | One open handoff per thread. Callback phone stored as evidence with consent scope, not automatic dial authorization |
| `em_calendar_operations` | `handoff_id`, `operation_key`, `calendar_ref`, `start_at`, `end_at`, `timezone`, `state: queued/booking/booked/uncertain/rejected/canceled`, `provider_event_id?`, `last_checked_at?`, `failure_code?` | Unique operation key; booking/reconciliation fenced like send intents. A slot token contains no permission beyond current actor and handoff |
| `em_qualification_events` | `lead_id`, `handoff_id?`, `qualified_by`, `criteria`, `source_message_ids[]`, `previous_station`, `resulting_station`, `occurred_at` | Append-only. Acquisitions permission and current canonical qualification guard required, including human-verified TIMELINE, CONDITION, MOTIVATION and PRICE evidence. Retain identity/authority assessment, property, reason and next action; unknowns remain explicit on Leads/handoffs and do not bypass promotion requirements |
| `em_playbooks` / `em_playbook_versions` | Parent: `name`, `program`, `draft`, `active_version_id?`; version: `playbook_id`, `version`, `policy`, `prompt`, `content_hash`, `eval_run_id`, `published_by` | Published versions immutable. Unique playbook/version. Policy schema in 05 |
| `em_test_runs` | `kind: simulation/provider/readiness`, `target_ref`, `config_hash`, `state`, `results`, `started_by`, `completed_at?` | Provider tests must store provider IDs + inbound correlation, not only a boolean |
| `em_attribution_touches` | `party_id`, `lead_id?`, `campaign_version_id`, `thread_id`, `event_type`, `source_event_id`, `occurred_at` | Unique source/event type. First qualifying email touch kept separately from assisted touches |
| `em_cost_entries` | `kind: reserve/settle/release/adjust`, `operation_key`, `parent_reservation_id?`, `provider`, `campaign_id?`, `amount_micro_usd`, `quantity`, `unit`, `rate_version`, `estimated`, `occurred_at` | Append-only; unique operation/kind. Unknown send reserves remain charged to cap until reconciled |
| `em_rate_buckets` | `scope_type`, `scope_id`, `window_start`, `window_seconds`, `reserved_count`, `accepted_count` | Unique scope/window. Reservation and dispatch permit occur in one transaction; no browser counters |
| `em_audit_events` | `actor_type`, `actor_id?`, `action`, `entity_type`, `entity_id`, `request_id`, `before_hash?`, `after_hash?`, `reason?`, `occurred_at` | Append-only, redact secrets/message bodies; index entity/time and request |
| `em_incidents` | `fingerprint`, `kind`, `entity_type`, `entity_id`, `state: open/acknowledged/recovered`, `severity: urgent/normal`, `owner_id?`, `first_seen_at`, `last_seen_at`, `acknowledged_by?`, `acknowledged_at?`, `recovery_evidence_ids[]` | Unique active fingerprint, acknowledgment retains failure; source recovery controls recovered state |
| `em_command_receipts` | `auth_user_id`, `idempotency_key`, `command`, `payload_hash`, `result`, `expires_at` | Unique workspace/user/key, retain 30 days. Key reuse with changed payload = 409 |

Private storage buckets: `em-imports`, `em-mail`, `em-evidence`. All access through authenticated server routes or short-lived signed downloads, never public bucket URLs. Raw HTML and attachments are untrusted; no remote image loading. Downloads use attachment disposition, safe MIME and filename, authorization on every request. v1 AI ignores attachments; no outbound attachment UI. Large or malformed MIME goes to review while headers/metadata remain visible.

Shared enums not repeated in every table: identity/match = unresolved/confirmed/conflicting/shared; address verification = unverified/valid/invalid/risky/unknown (provider blocked statuses map invalid, review statuses map risky/unknown); eligibility = eligible/excluded/needs_review; domain capability = missing/pending/verified/failed/disabled; sender state = draft/active/paused/retired; health = unknown/healthy/held/failed; AI decision state = proposed/blocked/review/queued/stale; review priority = urgent/normal; import state = uploaded/mapping/processing/ready/failed/canceled; test state = queued/running/passed/failed/canceled. All state transitions must use these exact contracts rather than inventing UI-specific stored states.

## 4. State transitions

Only named service functions may mutate these states. Each uses database transactions, revision checks, an audit event and an outbox job where needed.

| Entity | Allowed path | Trigger and effect |
| --- | --- | --- |
| Campaign | draft → scheduled/active; scheduled → active; active/scheduled → paused; paused → active; active → completed; draft/paused/completed → archived | Publish freezes version; scheduled waits for start. Pause cancels uncommitted dispatch permits. Resume revalidates and reschedules. Archive cannot race active work |
| Enrollment | eligible → queued → waiting_reply → completed | Successful provider acceptance advances sequence cursor once; next step scheduled from actual acceptance, not original plan |
| Enrollment interrupts | queued/waiting_reply → replied/suppressed/held/failed; held → queued or replied | Any inbound hint cancels pending sequence. A reply permanently ends that sequence; subsequent conversation replies are separately governed. Suppression never auto-resumes |
| Send intent | queued → dispatching → accepted; queued → canceled; dispatching → rejected/uncertain; uncertain → accepted/rejected | A recovered worker must not turn dispatching into a new send. Retry known nonacceptance with same key/payload inside window; unknown older outcomes need reconciliation |
| Thread controller | ai/none → human; human → human transfer; human → ai only by explicit release | Increment controller revision and invalidate pending AI work in same transaction. Human ownership persists across logout |
| Thread lifecycle | open ↔ snoozed; open/snoozed → closed; closed → open on real new inbound | Snooze pauses automatic outbound and review reminders until due; inbound wakes immediately. Close never silently authorizes recontact |
| Handoff | pending → accepted → completed; pending/accepted → canceled; accepted → pending on reassignment | Reassignment records history and returns state pending for new owner. Outcomes: callback_due, conversation_complete, qualified, not_qualified, follow_up, no_contact. Only qualified writes an Opportunity through qualification service |
| Connection | missing → checking → connected; checking → action_required; connected → stale/failed/revoked | Reconnect preserves history and sender links; changing account invalidates dependent verification |
| Setup step | not_started → in_progress → waiting/action_required/verified/not_needed | Verified can be invalidated by changed dependencies. Finishing setup changes no campaign state |

Retries and incoming events can add facts without following a visual linear delivery status. A complaint/hard bounce always wins eligibility; `accepted`, `delivered` and `complaint` can all be true in history. UI summary precedence: complaint > hard bounce > failed > delivered > accepted > dispatching/uncertain > queued, with underlying timestamps available.

## 5. Transaction and concurrency invariants

1. Lock order for sending-affecting mutations: workspace gate → domain/sender → party → address → thread → enrollment → intent, using a consistent ordered set when several rows are touched. No network call inside a database transaction.
2. In one transaction `authorizeDispatch` checks switches, connection freshness, program eligibility, restrictions, sender health, reply/ingest holds, owner/content revisions, timing, expiration, caps and cost reserves. It marks the intent dispatching and records a fenced permit. Only then may the server call the provider once.
3. A pause, inbound hint, opt-out or takeover committed before that dispatch transition blocks it. If the transition committed first, the UI shows a possible in-flight message. Email cannot be recalled. Future sends are blocked. Perform one last cheap cancellation check before the network call, without claiming atomicity across a remote provider.
4. Inbound webhook persistence sets `ingest_pending=true` and cancels sequence intents for any safely identified thread/address immediately, before full-body fetch. An unknown recipient alias or a retrieval gap pauses affected sender automation; do not wait for AI to discover the reply.
5. Duplicate launch, webhooks, job claims, handoffs, lead conversion and activity projection have durable unique keys. UUID generation alone is not deduplication.
6. New inbound increments content revision; both AI and human drafts based on an earlier revision become stale. A human can reconcile/review and create a new intent; a stale Send/Approve request returns 409, never quietly sends.
7. One active enrollment per address, plus a party lock check across confirmed aliases. Shared/uncertain identity is excluded until resolved. Global suppression follows confirmed identity links and all independently registered domains.
8. Positive-interest conversion upserts using party/lead linkage under lock. It preserves advanced/terminal stations and first-touch source. Email never triggers unrelated SMS, calling, appointment, or ad-conversion workflows by accident.
9. Qualification requires an acquisitions actor, current lead revision, filled assessment, explicit action and the current canonical four-pillar verification guard. Classification, accepting a handoff and scheduling a callback cannot call that transition. Never fabricate evidence to complete a pillar.
10. Append-only event/cost/qualification/audit evidence is immutable to ordinary users. Correction adds an event. Never represent a deleted record as proof that something did not happen.

## 6. Matching and suppression precedence

Inbound correlation order: exact original recipient token → verified reference to a known outbound RFC Message-ID and matching mailbox → unique known address/sender thread → unmatched review. Subject text alone cannot attach messages. Forwarded replies, different From addresses, suspicious authentication results and shared mailboxes require identity review before automatic action. Sender headers are not proof of property ownership.

Source imports preserve original row and evidence. Exact existing source ID wins; then confirmed email identity links; ambiguous name/address/phone matches are candidates. Human resolution links existing records without rewriting the imported evidence. One party can relate to several properties; select context explicitly in messages. Do not pitch multiple simultaneous property campaigns to the same person.

Restriction order: provider/account suspension → global all-marketing suppression → program suppression → campaign stop → identity/verification unknown → pacing. Hard bounce restricts the address; unsubscribe/complaint also propagates to confirmed party addresses. A wrong-person reply stops this property outreach and holds the address for identity review, without asserting that every person using a shared address opted out. Broad “do not contact me” is all marketing; ambiguous opt-out is held immediately pending review. Verification does not remove a suppression. Complaint and hard-bounce overrides are unavailable to marketers. All channels honor existing explicit all-contact restrictions; email-only opt-outs do not invent phone-channel consent or retroactively label an SMS opt-out as email permission.

## 7. Permissions

Server resolves the authenticated actor using the existing verified-claims helper and immutable subject, then checks active membership; preserve the explicit mobile bearer path and its failure behavior. Existing CRM admin is required to bootstrap/grant owner/admin. A client-provided agent name or generic cron secret is never user authority. Service role is restricted to validated worker/webhook modules. Enable RLS on all new tables; user reads scope to membership, private secrets/events/raw storage through server only; writes through commands/RPCs. SECURITY DEFINER RPCs use fixed `search_path`, qualified objects, revoked PUBLIC execute and explicit caller authorization.

| Capability | Owner/admin | Marketer | Reviewer | Acquisitions | Reader |
| --- | --- | --- | --- | --- | --- |
| View allowed marketing records | yes | yes | yes | yes | yes |
| Configure services/domains/roles/budgets | yes | no | no | no | no |
| Create audience/campaign drafts | yes | yes | no | no | no |
| Publish/pause/resume campaigns within approved caps | yes | yes | no | no | no |
| Emergency pause | yes | yes | yes | yes | no |
| Own thread, draft/send permitted human reply | yes | no | yes | yes | no |
| Review/approve an exact draft | yes | no | yes | yes | no |
| Qualify Opportunity | only with acquisitions role | no | no | yes | no |
| Accept/assign handoff | yes | no | yes | yes | no |
| Publish AI policy / release suppression / replay recovery | yes | no | no | no | no |

Roles combine. Disabled/removed owners transfer open work to configured backup and put AI on hold; do not silently hand threads back to AI. Team selection uses existing users only; provisioning/invitations remain existing CRM administration.

## 8. Proposed initial operating defaults

Values are proposals shown in setup, not assumed user approvals or promises of deliverability. Until required launch values are supplied, `send_enabled=false`.

| Setting | Initial value / behavior |
| --- | --- |
| Operating timezone | America/Chicago; store UTC, display named zone and DST-aware local times |
| Sending hours | Weekdays 09:00–17:00; no business callbacks before 08:30; recipient-local restrictions win if known |
| First pilot | One sender, one program, up to25 eligible people/day,5/hour; maximum two sequence touches; no-response follow-up7–10 calendar days after actual acceptance, weekdays only, target day8 |
| Autonomy | Draft-only initially; bounded auto becomes selectable after evaluation. Up to 3 AI replies per thread in 7 days, then human review |
| Recontact | 90 days after completed/no-response; opt-outs never automatically expire; prior active opportunity excluded unless specifically owned nurture program |
| Limits | Workspace/domain/sender/campaign count and cost caps; stricter bound wins. Budget amount required from owner, never invented |
| Human handling | Immediate targeted alert for callback requests; proposed acknowledgment within5 operating minutes and callback action within30 where seller preference permits; ordinary exception due in4 operating hours; backup escalation on unacknowledged urgent work |
| Freshness | Worker heartbeat ≤3 minutes; ingest oldest pending ≤2 minutes; sender verification ≤24 hours; account API check ≤15 minutes; verification age ≤30 days before first send |
| Health stop | Any complaint pauses affected campaign for review; 2 hard bounces in last 50 accepted messages, or ≥2% with at least 100 accepted in trailing 7 days, pauses sender. Provider enforcement always overrides these proposed stricter local limits |
| Data retention | Raw imports 30 days after resolution; raw mail/attachments 90 days; normalized threads 24 months; audit/qualification 24 months subject to CRM record policy/legal hold; suppression keyed evidence retained while needed to prevent recontact |

No automatic volume increase or domain rotation. Limits and health windows count both sequences and conversational replies. Retention jobs honor legal holds and preserve minimal keyed suppression even if message content is purged. Reports clearly show deleted/expired evidence. Retention changes require a preview of affected records and an owner action; no destructive purge at initial release.

## 9. Migration plan

EM-001 records schema evidence, auth mapping, buyer identity, all-contact restriction semantics, actual lead/source constraints, lead-activity uniqueness support, Next local guides and hosting cadence. Missing deployed access is an explicit integration gate; documentation can proceed.

Migrations are additive and dependency ordered: configuration/RLS → identity/audience → playbook/campaign/thread (add circular FKs after both tables exist) → messages/jobs/events → reviews/handoff/attribution → costs/audit/receipts → CRM compatibility constraints/indexes. Use migrations named with actual execution date plus `email_<purpose>`. No made-up migration numbers in code packets. Each migration has schema assertions and rollback guidance; rollback disables feature, retains historical tables, and does not drop customer data. Use paginated backfill with checkpoints only for verified identity links. Do not mass-create Leads from the prospect database.
