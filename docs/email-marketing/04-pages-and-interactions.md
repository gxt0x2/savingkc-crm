# Pages and action/reaction contract

Specification v1.2 · 2026-09-12 · Complete v1 product surface. All named routes are proposed. [08 Focused workspace and cadence](08-focused-workspace-and-cadence.md) defines current navigation, exact inbox predicates, campaign list and drip presentation.

## 1. Shared shell and interaction rules

Keep the existing CRM shell, theme, typography and compact top navigation. Preserve **Ads** at `/marketing`; add **Email** at `/marketing/email` for permitted users. Ads active-route matching must exclude `/marketing/email`. Within Email show **Inbox, Campaigns, More**. Open Inbox → Needs action → Mine across campaigns. More contains Results, Saved recipient lists, AI rules, Sending & phone, Setup & settings, and permitted Operations. Handoffs are reachable through Calls & appointments; Needs review is an Inbox view. Setup appears as a progress banner until complete. Existing detail routes remain valid; see08 for exact scope and navigation behavior.

At ≥1100px use a 240px list/sidebar where useful and a flexible detail area. At 768–1099px reduce secondary columns and use drawers for evidence. At <768px show one pane with Back to list and persistent thread/campaign context; menus wrap or become a labeled navigation menu. At 320px, no whole-page horizontal scroll. Dense report tables may have a labeled horizontal scroll region. Use existing red action accent, opaque theme-aware surfaces, readable borders, 14px body / 12px secondary text, 16px mobile inputs, ≥44px touch hit areas, native controls and visible focus. Never use color alone for status.

Each page header contains title, short context, one main action where applicable and last source refresh time. Setup banner explains the next blocked capability, not a generic error. Empty states offer the relevant next action. Loading uses stable skeleton dimensions, not fake zero metrics. Failed reads preserve last known data with “Updated … / unable to refresh.” Stale data cannot enable Launch, Verify passed, Approve stale draft or confirmed scheduling. Permission failures show a plain no-access page and a route back; do not expose inaccessible names/counts in error text.

All mutations inherit this **full command lifecycle**, unless explicitly local/external:

1. Trigger from labeled button/menu/form; server role and prerequisites are in the action row plus 02 §7.
2. Validate fields inline and on server; focus first error. Use exact typed fields, reject extras. Existing entity commands send current revision and one persistent idempotency key.
3. Pending disables the same action and says Saving/Checking/Queuing; fields remain readable. No optimistic “sent,” “verified,” “qualified” or “booked.”
4. Success renders server state, audit receipt and invalidates related queries. A queued job shows progress and survives page close. Scroll/focus returns to resulting item without losing list filters.
5. 422 preserves input; 401 preserves a nonsensitive draft for return after login; 403 prevents action; 409 shows current version/owner and offers reload + compare; 429 shows next permitted time; 503 shows cause and Retry. Secrets are never preserved. After timeout inspect receipt before retry.
6. Concurrent changes use revisions; a destructive-looking overwrite is never silent. New inbound marks open composer stale. Toasts supplement durable state; a toast alone is not evidence.
7. Audit name equals action ID; acceptance cases are in the last column. Row-specific reactions extend this lifecycle. All server mutations use 03 §3 unless a dedicated route is named.

**Local actions** never create audit records unless noted. `UI-VIEW`: navigation, sorting, search, filter chips, pagination, expand details, view full evidence and clear filters use allowlisted GETs and URL state. Search debounce300ms, canceled old responses cannot replace newer results. Default sort for work queues is urgency then most recent inbound; stable tie ID. `UI-CANCEL`: close/back/discard in dirty forms opens Save draft / Discard changes / Keep editing; simple dismissal makes no provider mutation. Escape closes dialogs; focus returns to trigger. `UI-DOWNLOAD`: authorized export/attachment/error download, signed short-lived access, audit download; CSV escapes formulas beginning `= + - @` and tabs/newlines. These shared actions are tested by T01/T02/T03/T38/T46 and apply to every page below.

## 2. Page map and content

| Page ID | Route | Required content / default empty state |
| --- | --- | --- |
| P01 | `/marketing/email` → Inbox; overview at `/marketing/email/overview` | Default opens P08 Needs action/Mine. Management overview remains under Results with setup progress, urgent work, outcomes, sending status, spend and freshness |
| P02 | `/marketing/email/setup?step=1..10` | Left progress list, current form, Save and continue, Back, Save and exit. Mobile progress select. Steps accessible before ready but dependent tests disabled with cause |
| P03 | `/marketing/email/audiences` via More → Saved recipient lists | Reusable CRM lists/imports with source, counts and repair actions; normal recipient selection lives inside campaign P06/P07 |
| P04 | `/marketing/email/audiences/[id]` | Summary counts, source/permission evidence, row table, mapping/errors/identity review tabs, verify progress, campaign preparation. Detail drawer shows original row and each exclusion reason |
| P05 | `/marketing/email/campaigns` | Multiple campaign rows, state filters, owner/purpose, started/approved recipients, next send or hold reason, action count, Leads/Opportunities; New campaign; per-campaign pause separate from global pause |
| P06 | `/marketing/email/campaigns/[id]/edit` | Builder Recipients → Sequence → Conversation rules → Senders and schedule → Budget → Review. Sequence shows full messages, 7–10 calendar-day wait, weekday rule and computed date preview. Persistent Save draft; Launch only at review |
| P07 | `/marketing/email/campaigns/[id]` | Summary / Recipients / Sequence / Activity tabs; immutable active version, actual enrollment/next action or hold, full drip timeline, outcomes and evidence; editing creates a new draft |
| P08 | `/marketing/email/inbox?thread=...&view=...` | Needs action, Needs review, Calls & appointments, AI handling, Waiting, Closed & stopped, All conversations. Owner/campaign/search + granular reason/outcome/controller/unread/date filters; Unsubscribed shortcut; server counts and next actions; exact definitions in08 |
| P09 | `/marketing/email/inbox/[id]` and existing Conversations link | Same shared ThreadView, owner/banner, stable sender, message status, facts with quotes, timeline, composer and next action. Unknown match clearly identified |
| P10 | `/marketing/email/review` | Filtered shared inbox with reason, due time, owner, exact draft and evidence/guard failures; no parallel conversation store |
| P11 | `/marketing/email/handoffs` | Pending/accepted/overdue/completed; seller/property/request/owner/due time; detail includes reply evidence, callback task, calendar state, outcome and qualification form |
| P12 | `/marketing/email/playbooks` | Seller/buyer playbooks, published/draft versions, rules editor, permitted claims, examples, simulation comparisons and Publish. Empty: Start from reviewed template |
| P13 | `/marketing/email/sending` | Connections, domains, identities, DNS details, send/receive readiness, health evidence, per-sender limits, actual test history; Add domain |
| P14 | `/marketing/email/reports` | Cohort/date/program/source/campaign filters; unique recipient funnel, human handling time, costs, CRM outcomes and source lag; evidence drilldown. No sample data in production |
| P15 | `/marketing/email/settings?tab=...` | Tabs Business, Services, Team, Automation, Budget, Contact preferences, Operations, Data. Reuses setup editors; no duplicate config |
| P16 | Settings → Contact preferences | Search restriction, scope/reason/effective time/evidence; import exclusions; correction review. Empty: No matching restrictions, not proof everyone is eligible |
| P17 | Settings → Operations | Queued/retrying/uncertain/dead jobs, ingress lag, incidents, provider IDs, immutable audit details; replay/reconcile actions with exact effect |
| P18 | `/email/unsubscribe/[token]` | Public business branding, generic preference action, immediate success/error. No recipient email/name/property in rendered content |
| P19 | `/email/brand/[domain]` | Public SavingKC affiliation, physical business address, contact method, privacy link, sending-brand domain; unknown domain generic404 |

No v1 page for buying leads, registrar search, visual drag-and-drop email templates, warming networks, multi-provider rotation, automatic offers, autonomous dialing, billing cards or SaaS customer signup. These are explicit scope boundaries, not missing buttons.

## 3. Setup wizard (P02) and shared settings actions

Each step saves independently, shows state with evidence date and can be reopened. Connection/account success must not fill later steps with invented values. “Create account” and “Purchase domain” are official external journeys with a return checklist. Setup sidebar status values come from 02; never a front-end-only completion array.

| Step | Fields / layout | Completion rule |
| --- | --- | --- |
| 1 Business | Company, physical mailing address, primary domain, program checkboxes seller outreach/nurture/buyers, timezone, contact address, privacy URL | Valid business identity and program; primary domain excluded from campaign domains |
| 2 Services | Email/AI/verifier/calendar rows, account label, scope, masked connection, permissions, reported plan/as-of, estimated incremental cost; Connect or Create account | Email and AI access verified; verifier connected or imported evidence path chosen; calendar optional/manual path |
| 3 Domains | Owned domain input, affiliation/brand URL, registrar link, exact DNS record table, pending explanation | Sending, receiving, DMARC and brand host verified; no main-domain/subdomain option |
| 4 Senders | From name, local part, domain, signature, reply-path explanation, per-hour/day caps; test recipient allowlist | At least one verified sender, send/receive test evidence; no identity swap on active threads |
| 5 Team | Reviewer, acquisition owner, backup, hours, SLA defaults, calendar/manual scheduling choice | Active owners and backup with roles; calendar validated only if selected |
| 6 AI | Draft-only / bounded auto, routine permitted actions, handoff rules, approved claims, max replies, language, example scenarios | Published tested policy; bounded auto unavailable when its critical evaluations fail |
| 7 Audience | CRM segment/import, field mapping, original source and program permission, verification method, excluded reasons | A ready snapshot candidate with eligible recipients; unknowns remain excluded |
| 8 Campaign | Name, goal/program, audience, first message and follow-up, stable sender pool, hours, volume, reply mode | Valid saved draft; preview includes rendered identity/footer, missing fields and total possible touches |
| 9 Readiness | Check rows with evidence/time/type, authorized test recipient, Run controlled check, failures with Fix links | Required checks pass for exact config. Simulated and provider-backed results separate |
| 10 Cost and finish | Existing vs new recurring cost, domains/renewals, estimated usage range, caps, exact recipients/version, reviewer | Finish setup saves readiness; separate Launch review for an existing draft. No automatic purchase/send |

Action field abbreviations: `O` owner/admin, `M` marketer, `R` reviewer, `A` acquisitions. Combined roles allowed per 02. Fields in backticks are payload keys; optional `?`; IDs UUID unless a named enum. Setup “Save and continue” invokes its domain save action then changes local step only if saved; exiting while waiting preserves job and state.

| Action ID / trigger | Role, payload and prerequisites | Write / visible reaction / special failure | Tests |
| --- | --- | --- | --- |
| SET-BUSINESS · Save business | O; `name,address,primaryDomain,timezone,programs,contact,privacyUrl` | Save config, invalidate dependent branding/policy evidence on change; show affected drafts before commit | T04,T42 |
| SVC-CONNECT · Connect/reconnect | O; dedicated secret endpoint 03 §2 | Checking → masked connected or scoped error; clear secret form; failed reconnect preserves previous valid credential until replacement tested | T05,T06 |
| SVC-SIGNUP · Create account / open billing / registrar | O; local selected allowlisted provider link | Save wizard return step; external tab with explicit provider name. On return show Recheck; no connected/purchased claim | T04,T05 |
| SVC-CHECK · Recheck service | O; `connectionId` | Durable capability check; changed account/scope invalidates affected readiness; show precise missing permission/credits | T05,T42 |
| SVC-DISCONNECT · Disconnect | O; `connectionId,reason,confirmedAffectedHash` from preview | Pause affected sending then revoke local connection; show impacted campaigns before confirmation; existing inbound/history retained as possible | T06,T26 |
| SET-TEAM · Save team and hours | O; `reviewerId,acquisitionOwnerId,backupId,hours,sla,calendarMode` | Validate active membership and hours; assignments affected by removal transfer to backup/hold; no invitations sent | T07,T31 |
| SET-AUTOMATION · Save default mode/limits | O; `mode,playbookVersionId,maxReplies,language,allowedActions` | Save future defaults; existing campaigns retain published versions. Raising autonomy requires eval evidence and explicit activation | T21,T22 |
| SET-BUDGET · Save budget/terms | O; `dailyCap,totalCap,rateCards,costTerms` | Server recalculates estimates, rejects negative/unknown required rates, updates future dispatch restrictions; fixed subscription remains external | T24,T25 |
| SET-READINESS · Run readiness / controlled check | O; `kind,configHash,testRecipientIds,maximumTestSends` | Simulation uses fixtures; provider mode shows exact test email and authorized allowlist before queuing. Progress per item, evidence-linked result | T08,T09 |
| SET-FINISH · Finish setup | O; `readinessRunId,configHash` | Records setup complete if required gates current; opens overview with drafts still unsent; stale evidence returns affected-step list | T04,T08 |
| SET-ENABLE · Enable workspace sending | O; `readinessRunId,configHash` | Enables dispatch capability only, does not publish campaign. Shared conspicuous status changes; failed readiness keeps disabled | T08,T26 |
| SET-PAUSE · Pause all sending | O/M/R/A; `reason` | Immediate workspace dispatch stop; confirmation unnecessary for emergency pause. Show in-flight caveat, affected jobs and owner; inbound remains available | T10,T26 |

## 4. Audiences (P03–P04)

Create dialog selects Seller outreach, Seller nurture, Buyer marketing; never mixes recipients across programs. Import accepts CSV UTF-8 with visible file limit, sample mapping of name/email/property/prospect or lead ID/source/permission date/evidence/verification status/date/provider. Email required; identity/property required for automated seller personalization, not guessed. Upload preview shows first20 rows and full server counts after processing. Each row may have several exclusions; summary distinct counts must reconcile total rows vs unique addresses. Show exactly eligible, excluded and needs review; total imported is not the send count.

CRM segment builder fields: record kind (prospects/leads/buyers), county/city, existing stage, source, owner, last-contact date and program-specific permission; operator allowlist equals/one-of/before/after/is-empty. Existing DNC/archived restrictions displayed separately. A segment changes only on refresh; published snapshots remain immutable. Bulk select defaults current page; “Select all matching N” creates a server filter snapshot, shows N and excludes future matching arrivals.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| AUD-CREATE · New audience | O/M; `name,program,kind,segmentDefinition?` | Create empty draft; navigate detail; empty segment produces0 with explanation | T11 |
| AUD-UPLOAD · Import file | O/M; dedicated upload routes; `audienceId,fileName,size,sha256` | Private staged file → mapping; reject oversized/non-CSV; canceled upload cannot enroll recipients | T11,T12 |
| AUD-MAP · Save mapping and process | O/M; `importId,mapping,sourceEvidence,permissionEvidence,verificationMapping?` | Queue resumable parse; counts update; malformed rows downloadable; provenance never defaults to permission | T11,T12,T13 |
| AUD-REFRESH · Refresh segment | O/M; `audienceId,segmentDefinition` | Snapshot candidate recomputed; diff added/removed/excluded displayed; active campaign remains frozen | T11,T17 |
| AUD-RESOLVE · Resolve identity/property | O/M/R; `rowId,partyId?,leadId?,propertyRef?,resolution,evidence` | Link confirmed records or mark unresolved/excluded; shared mailbox warning requires explicit evidence; no automatic merge/create Lead | T13,T14 |
| AUD-VERIFY · Verify selected addresses | O/M; `selectionToken,method:provider/import,estimateHash` | Show maximum credits/cost first; queue only stale/missing evidence; unknown results remain excluded; cancellation stops unclaimed work | T15,T24 |
| AUD-EXCLUDE · Exclude/restore audience row | O/M; `rowIds,excluded,reason` | Audience-specific eligibility change; Restore still rechecks global restrictions, never unsuppresses | T13,T16 |
| AUD-PREPARE · Use in campaign | O/M; `audienceId` | Create campaign draft with audience reference; opens builder; no enrollment/send | T17 |
| AUD-ARCHIVE · Archive audience | O/M; `audienceId,reason` | Hide default list, preserve snapshots and active campaign evidence; preview dependent drafts | T11,T17 |

## 5. Campaign builder and detail (P05–P07)

Sequence editor is ordered cards: subject, plain body, insert approved field, delay in calendar days (min7/target8/max10), weekday send window, date/content preview, add/remove/move step. Show every message and end condition, not a collapsed follow-up caption. Moving/removing adjusts draft only and shows resulting maximum touches. No fake previous-contact language, made-up facts, unsupported price/offer or anonymous brand. Preview renders one sample recipient from the frozen candidate selection with a visible Sample label; missing tokens are errors. Preview does not send.08 defines active-version behavior and shared multi-campaign capacity.

Review screen includes exact program, audience revision and counts, all exclusions, published playbook version, From/reply path, every step, earliest/estimated last send under caps, hours/timezone, expiry, cost estimates/caps, reviewer/backup, and selected mode. Button says **Launch N recipients** or **Schedule N recipients**. This is the user's concrete campaign authorization. If actual eligible count or content changed, return review with diff and new hash; do not silently launch revised scope. Less eligibility at dispatch is allowed through exclusions, never more recipients than authorized.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| CAM-CREATE · New campaign | O/M; `name,program,audienceId?` | Create draft; prefill proposed defaults labeled as such | T17 |
| CAM-SAVE · Save draft / sequence edits | O/M; `draftConfig` schema02 | Validate fields, save revision; dirty indicator clears; stale edit compares current draft rather than overwriting | T02,T18 |
| CAM-PREVIEW · Render recipient | O/M; `recipientRowId,draftHash`; read-only preview request | Return subject/body/footer/missing fields/eligibility; no provider call or lead event | T18 |
| CAM-TEST · Send controlled test | O/M; `senderId,testRecipientId,draftHash` with owner-approved test allowlist | Show actual recipient and copy, then queue marked test intent; exclude from business reports and sequences | T09,T18 |
| CAM-LAUNCH · Launch/schedule reviewed version | O/M; `draftHash,audienceHash,readinessRunId,startAt?,approvedMaxRecipients,estimateHash` | Publish immutable version + enroll once; show materialization progress and pause control; repeated click same result | T17,T19,T24 |
| CAM-PAUSE · Pause campaign | O/M; `reason` | Stop new dispatch for this campaign including automated replies, allow inbound and reviewed human handling; show possible in-flight message | T10,T26 |
| CAM-RESUME · Review and resume | O/M; `readinessRunId,resumePreviewHash` | Preview remaining/expired/excluded and next paced schedule; resume excludes replied/suppressed, no overdue burst | T20,T26 |
| CAM-REVISE · Create revision | O/M; `campaignId` | Copy config to draft; prior version/history intact. Existing enrollments stay pinned; apply only to future newly authorized audience after review | T17,T18 |
| CAM-DUPLICATE · Duplicate | O/M; `campaignId,newName` | Copy config into a new draft, no execution/approvals; prior recipient recontact and concurrency restrictions still apply | T17,T20 |
| CAM-STOP-RECIPIENT · Stop enrollment | O/M/R/A; `enrollmentId,reason` | Stop pending sequence and automated replies for selected thread; not an opt-out unless suppression action used; never resend completed steps | T16,T20 |
| CAM-ARCHIVE · Archive campaign | O/M; `campaignId,reason` | Allowed draft/paused/completed only; live campaigns require pause first, historical reports remain | T17,T26 |

A paused campaign's human response uses current owner plus normal suppression/sender gates, with a visible “Human response while campaign paused” confirmation. Workspace or provider pause blocks all outbound except a separately authorized controlled diagnostic test. No automatic domain substitution.

## 6. Inbox, thread and review (P08–P10)

Apply08 §2 for independent work/outcome/controller filters, exact view predicates, per-scope counts, saved views and Unsubscribed visibility. UI-VIEW covers filtering, paging and cadence previews, contributes T57–T62, and cannot mutate conversations or enrollments.

Thread header: person/unknown identity, property context, Lead/Opportunity badge from existing CRM, controller name or AI mode, stable From address, pause reason, latest inbound. Message rows show sender, received/accepted/delivered/uncertain status and timestamps; expandable evidence contains original headers and source. Facts drawer distinguishes “Seller said” quote, imported data and human assessment. Never blend inferred/AI facts with verified seller statements.

Composer: subject for initial unmatched conversation only, fixed thread recipient/sender for known thread, text body, draft state, approval/guard information, Send. No keyboard shortcut sends without visible command (Cmd/Ctrl+Enter opens confirm if enabled). Read-only for others' ownership, button **Take over**; transfer is deliberate when owned by another human. AI suggestion shows why review is needed and cited source; Approve and send binds exact text/revisions. “Approve” alone is not ambiguous: default label explicitly includes send when it queues a message.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| THR-READ · Mark read/unread | any member; `threadId,lastReadMessageId?,unread` | Per-user watermark only; new reply stays unread if newer than watermark | T27 |
| THR-TAKEOVER · Take over | O/R/A; `threadId,expectedControllerRevision` | Acquire human control, invalidate/cancel AI drafts/intents; show owner immediately after server commit; occupied human thread requires Transfer | T10,T28 |
| THR-TRANSFER · Transfer/assign control | O/R/A; `threadId,newOwnerId,reason,expectedControllerRevision` | Confirm current/new owner; active eligible user only; server CAS prevents double ownership; audit transfer | T07,T28 |
| THR-RELEASE · Return to AI | O/R/A current owner or O; `threadId,playbookVersionId,reviewedContentRevision` | Show pending facts/drafts and mode; invalidate old decisions and reevaluate latest context; unresolved critical review/hold blocks release | T21,T28,T29 |
| THR-DRAFT · Save/edit draft | O/R/A controller; `threadId,body,contentRevision,controllerRevision` | Save exact text/body hash; edit invalidates approval. New inbound returns stale and preserves comparison | T29,T30 |
| THR-SEND · Send human reply | O/R/A controller; `draftId,bodyHash,contentRevision,controllerRevision` | Queue guarded immutable intent; show queued/accepted/uncertain accurately; suppression/ownership/stale error prevents send | T10,T16,T29,T30 |
| THR-REGENERATE · Suggest another reply | O/R/A; `threadId,instruction?` max500 chars from permitted operator | One bounded new inference, cost checked; previous draft retained until replace; never sends by itself | T21,T23,T24 |
| THR-SNOOZE · Snooze/wake | O/R/A; `threadId,until?` | Pause automatic outbound and review reminders; inbound wakes; explicit wake refreshes current work, not old pending draft | T27,T29 |
| THR-CLOSE · Close/reopen | O/R/A; `threadId,closed,reason` | Close stops automated follow-up; inbound reopens with controller preserved; reopen does not authorize marketing recontact | T20,T27 |
| THR-TAG · Edit tags | O/M/R/A; `threadId,tags` | Shared allowlisted tags; additive conflict resolution, no stage side effect | T27 |
| THR-LINK · Resolve/link conversation | O/R/A; `threadId,partyId,propertyRef?,leadId?,evidence` | Shows current and target; links shared canonical thread; uncertain sender requires review; does not qualify stage | T13,T14,T32 |
| THR-HANDOFF · Request acquisitions | O/R/A or permitted policy; `threadId,ownerId,backupId,reason,requestedContact,factEvidence` | Attach/create evidenced Lead, create one handoff/task, stop routine AI; seller needing immediate contact need not finish questionnaire | T31,T32 |
| REV-APPROVE · Approve and send | O/R/A; `reviewId,draftId,bodyHash,contentRevision,controllerRevision,policyHash` | Exact current approval → guarded queue; server rechecks all restrictions. New inbound/edit/policy invalidation returns409 | T29,T30 |
| REV-REJECT · Reject suggestion | O/R/A; `reviewId,reason` | Reject draft, preserve evidence; keep thread human-review held until alternative/resolution; no auto-retry loop | T21,T30 |
| REV-ASSIGN · Assign review | O/R/A; `reviewId,assigneeId,dueAt?` | Assign task; does not by itself transfer thread controller; prompt Take over before editing if needed | T07,T30 |
| REV-RESOLVE · Resolve without sending | O/R/A; `reviewId,resolution,note` | Record resolution (no reply needed, identity fixed, handled elsewhere); show resulting hold/controller state; cannot clear suppression implicitly | T16,T30 |
| INB-SAVEVIEW · Save/update my view | any member; `viewId?,name,queryVersion,query,expectedRevision?` | Persist owner-scoped allowlisted filters; validate referenced access, duplicate name offers rename; stale update409 preserves input; no conversation mutation | T57,T58 |
| INB-DELETEVIEW · Remove my saved view | view owner; `viewId,expectedRevision` | Delete preference only, return to built-in view; other users' views inaccessible; history, threads and restrictions unchanged | T58 |

Opt-out uses SUP-ADD below; not a “close conversation” synonym. Thread body rendering strips active HTML; remote images blocked; attachments labeled unreviewed and available only as controlled downloads. Unknown attachments are not silently read by AI.

## 7. Handoffs and qualification (P11)

Default table sorts urgent callback then due time; the salesperson sees the seller's exact request at the top, with Lead stage and owner. Accept creates an acknowledged next action, not an Opportunity. Outcome dialog offers Conversation completed, Follow up, No contact, Not a fit, Qualify as Opportunity. Only qualification asks for assessment; no required fake price/timing just to log a call.

Qualification form: confirmed person/authority assessment, selected property, motivation, timing, condition and price as known/unknown with evidence, why worth pursuing, next action and owner. Unknown specifics may be saved on a Lead or handoff without inventing facts. Qualify as Opportunity must satisfy the current canonical human-verified TIMELINE, CONDITION, MOTIVATION and PRICE guard, as recorded in the [implementation baseline](implementation-baseline.md); show missing evidence beside the disabled qualification action. Logging a call or saving an assessment does not require fabricated answers or promote the stage. Recheck existing station/revision; preserve later station and append the qualification event only through the guarded canonical service.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| HAN-ACCEPT · Accept | A/O; `handoffId` | Acknowledge assignment, show due next action, controller transfer explicit if needed; Lead station unchanged | T31,T32 |
| HAN-REASSIGN · Reassign | O/R/A; `handoffId,newOwnerId,reason` | New owner sees pending acceptance; backup/SLA retained, old owner notification resolved | T07,T31 |
| HAN-SCHEDULE · Save callback / book slot | A/O or server service under enabled scheduling policy; `handoffId,mode:task/calendar,startAt,timezone,phoneEvidence?,slotToken?` | Manual task or one verified internal calendar event, targeted owner alert and permitted post-booking email confirmation. Exact seller request/accepted slot required for auto-booking; no guessed time, dialing, SMS or guest invite | T33,T34,T53 |
| HAN-OUTCOME · Record conversation/outcome | A; `handoffId,outcome,note,nextAction?,completedAt?` | Append CRM activity and update handoff/task; completed conversation distinct metric, no implicit qualification | T32,T35 |
| HAN-QUALIFY · Qualify as Opportunity | A; `handoffId,leadId,leadRevision,assessment,nextAction,evidenceIds` | Server qualification event + station qualified if appropriate; preserves existing advanced stage and first-touch source; unauthorized AI/marketer rejected | T32,T35 |
| HAN-RETURN · Return for clarification | A/O; `handoffId,question,reviewerId` | Open review, preserve Lead and handoff history, human-held; does not resume old sequence or autonomously recontact | T31,T35 |

## 8. Playbooks, sending and settings (P12–P13/P15–P17)

Playbook editor groups Identity and voice, Verified claims, Routine questions, Escalations, Reply limits, Program rules, Evaluation. Preview shows a seller message, expected handling and actual candidate handling, not only an average score. Version compare highlights changes in permissions, claims and model/cost, with affected campaigns count; published campaigns do not silently adopt it.

Sending domain detail shows exact DNS record names/type/value/priority and Copy, last resolver/provider check, inbound test, domain branding/HTTPS, status incidents and sender list. DNS propagation state is “Waiting,” not repeated red failure. Sender From/reply identity locked for active threads; retire retains reply processing. Provider enforcement disables affected account, not just the current sender.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| PB-SAVE · Create/edit playbook | O; `name,program,policy,prompt` | Draft revision only; required escalation rules cannot be removed via editor | T21,T22 |
| PB-SIMULATE · Run examples/evaluation | O/R; `playbookDraftHash,fixtureSetId,modelId` | Queue cost-bounded eval, show case results/evidence and failed critical cases; does not email real people | T21,T22,T23 |
| PB-PUBLISH · Publish version | O; `draftHash,evalRunId,modelRateVersion` | Immutable version if promotion checks pass; list campaigns staying pinned; no automatic mode switch | T21,T22 |
| DOM-ADD · Add owned domain | O; `domain,connectionId,brandUrl` | Validate independent domain, create provider domain idempotently, display returned DNS; provider limits/ownership conflict preserve pending form | T36,T37 |
| DOM-VERIFY · Check DNS and brand | O; `domainId` | Queue resolver/provider/HTTPS checks; per-record evidence + time, pending propagation remains waiting; no purchased/verified claim from click | T36,T37,T42 |
| DOM-PAUSE · Pause/restore sender domain | O; `domainId,paused,reason,readinessRunId?` | Pause all affected senders; restore needs current evidence, no domain rotation; existing thread identity fixed | T26,T36 |
| SND-SAVE · Add/edit/retire sender | O; `senderId?,domainId,fromName,localPart,signature,hourlyLimit,dailyLimit,state` | Verified domain required for active; identity edits with live threads create new sender instead, old remains receive-capable | T36,T37 |
| SND-TEST · Test send and reply path | O; `senderId,testRecipientId,maximumTestSends=1` | Explicit destination/content preview, queue test, require actual inbound reply before receive verified; timeout actionable | T09,T37 |
| SET-ROLES · Save role changes | O; `authUserId,roles,active,affectedWorkHash` | Prevent removing last admin; show/reassign current work, no client privilege escalation; apply membership revisions | T03,T07 |
| SET-RETENTION · Preview/save retention | O; `periods,legalHoldPolicy,activatePurge=false,previewHash?` | Preview counts first; shortening/activation requires exact current preview; default release does not purge | T38 |
| SUP-ADD · Stop marketing / import exclusions | O/M/R/A; `addressIds?,partyIds?,scope,program?,reason,evidenceIds?,importId?` | Immediately suppress, cancel pending future sends across domains, preserve history; bulk preview exact affected count | T16,T39 |
| SUP-RELEASE · Record correction | O; `suppressionId,evidence,reason,confirmedScopeHash` | Explicit fresh evidence; complaints require provider-resolution evidence and permission, hard bounce fresh valid address evidence; release never auto-enrolls/resends | T16,T39 |
| OPS-REPLAY · Retry internal processing | O; `jobId,expectedFailureCode,reason` | Preview effect; replay only eligible idempotent internal job; send outcome uncertain must use Reconcile, not new intent | T40,T41 |
| OPS-RECONCILE · Reconcile uncertain send | O; `intentId,providerEvidence?` | Retrieve known provider IDs/events, attach evidence; unresolved stays held. Confirmed rejection requires separately reviewed retry eligibility, no speculative success | T40,T41 |
| OPS-ACK · Acknowledge incident | O/R/A; `incidentKey,note` | Record acknowledgment and owner; failure/status stays visible until recovered | T40,T42 |

Settings Business/Services/Team/Automation/Budget reuse SET/SVC actions. Suppressions and Operations are tabs, not competing inboxes. Costs include provider-reported or owner-reported subscription terms with provenance. Never label local ledger totals “provider bill” without reconciliation.

## 9. Reports and public pages (P14/P18–P19)

Reports default to enrollment cohort start in America/Chicago; user can select event-period mode explicitly. Labels always show denominator, time basis and excluded tests. Required columns: eligible unique people; accepted emails; delivered-to-server emails; unique human repliers; interested seller Leads; callback requests; completed conversations; human-qualified Opportunities; contracts/closed outcomes linked to CRM; cost; cost per Lead/Opportunity; median human minutes per handoff. Deal amounts use existing confirmed CRM outcome evidence, not AI price extraction. No revenue uplift claim without a defined baseline.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| RPT-QUERY · Change cohort / compare / drilldown | any permitted; GET `reports` with dates,timeBasis,program,campaignIds,source | Totals and row denominators reconcile; loading preserves prior result with pending label; missing source shows unknown, not0 | T43,T44 |
| RPT-EXPORT · Export current result | O/M/A; `queryHash,format:csv` | Queue immutable report snapshot and authorized download, include as-of/filters/denominators; no raw keys/mail bodies | T38,T43 |
| PUB-UNSUBSCRIBE · Unsubscribe | token holder; dedicated POST, no account | Immediate generic success, all-marketing suppression; repeat idempotent, scanner GET no effect, error Retry without identity leak | T39,T45 |
| PUB-PREFERENCE · Stop selected program | token holder; `program` allowlisted, explicit choice | Adds program restriction; cannot remove broad suppression or resubscribe through public route; no prerequisite to unsubscribe | T39,T45 |
| PUB-CONTACT · Business contact/privacy | public; allowlisted verified link | Opens official contact/privacy destination; unknown domain generic404, no CRM information or claim of completed outreach | T37,T45 |

## 10. Cross-page reactions and completion criteria

v1.1 extends existing pages with the following actions; full data/provider contracts are in [07](07-sales-voice-and-response-operations.md). Inherit the complete command lifecycle from §1. No new primary navigation is needed.

| Action ID / trigger | Role, payload / prerequisite | Write / reaction / failure | Tests |
| --- | --- | --- | --- |
| COP-GENERATE · Generate recipient drafts | O/M on P06; `campaignId,draftRevision,snapshotId,copyMode,policyHash,generationCap` | Cost-bounded job produces exact per-person copy and evidence/guard results. Pause/cancel preserves completed rows; no send/enroll and no invented fallback on failure | T49,T50 |
| COP-REVIEW · Approve content set | O/M on P06; `copySetId,contentHash,sampleRowIds,resolvedFlagIds` | Bind approved pattern, representative sample and all flagged outliers; current hash required; changed evidence/text invalidates affected set. Cannot override prohibited claims | T49,T50 |
| NTF-TEST · Test my alert path | signed-in configured staff on P02/P15; `channel,subscriptionRef` | Queue visibly authorized test alert only to current user; show queued/provider accepted/failed and require user acknowledgment. Admin cannot impersonate acknowledgment | T51,T52 |
| NTF-ACK · Acknowledge request | assigned user/backup/O on P01/P11; `eventId,eventRevision` | Persist actor acknowledgment, stop obsolete escalation; task remains open until disposition, no automatic stage/calendar change | T51,T52 |
| SCH-POLICY · Save scheduling rules | O on P02/P15; `enabled,agentCalendars,hours,durationMinutes,bufferMinutes,maxDailyBookings,alertCheckIds` | Verify access/ownership and show affected future scheduling; enabling requires controlled check. No immediate booking from enabling the feature | T52,T53 |
| SCH-RESCHEDULE · Change callback | A/O or permitted server policy on P11; `handoffId,eventId,eventRevision,newSlotToken,requestEvidenceIds` | Recheck actual slot, update same event/task and notify owner, cancel old reminders; uncertain remote write reconciles before retry | T53 |
| SCH-CANCEL · Cancel callback | A/O or explicit seller-request policy on P11; `handoffId,eventId,eventRevision,reason,evidenceIds` | Cancel event/task reminders, retain history, notify owner; general email-only opt-out places upcoming contact on review hold unless cancellation intent is explicit | T53 |
| TEL-SAVE · Configure email-response line | O on P02/P13/P15; `existingProviderNumberId,purpose,routingPolicy,hours,voicemail,callerIdPolicy` | Verify owned existing number/purpose, show impact preview; reserved/shared number conflicts block. Any purchase is separate official checkout, no implicit provisioning | T55 |
| TEL-TEST · Test inbound routing | O on P13; `lineId,expectedPrimaryId,expectedBackupId` | Start test checklist and show number for a controlled inbound test call; observe actual primary/backup/voicemail/task/alert evidence. No synthetic successful result or automatic outbound call | T52,T55 |

Setup step5 now includes alert enrollment/test, acknowledgment/backup policy and calendar automation/buffers. Step3/4 includes optional stable response phone line and inbound-route verification. Step6 includes everyday Black Swan examples and correction handling. Builder adds template/contextual-AI mode, generation cost cap, source/sensitivity evidence, sample/outlier review and immutable copy-set hash. P11 separates Phone provided / Time needed / Booking uncertain / Booked / Rescheduled / Canceled. Sending shows inbound line health alongside domain health. Reports add message-angle/version/control cohort, response-to-acknowledgment time, booked vs held calls and after-call next action.

| Event | Surfaces that must update from server truth |
| --- | --- |
| New inbound | Inbox row/unread, open thread, stale composer/review, enrollment stopped, overview work count, Conversations projection |
| Takeover/transfer | Both Email and Conversations controller, disabled competing composer, canceled AI work, review owner context |
| Suppression | All campaign eligibility/enrollment counts, thread stop banner, sender future queue, preference history; existing messages stay visible |
| Lead conversion | Shared contact/Lead view, thread badge, source touch, handoff context; no duplicate/new Opportunity |
| Human qualification | Existing pipeline badge/row, handoff outcome, email attribution; no automatic advertising conversion |
| Pause/health failure | Overview, campaign and Sending banners, disabled dispatch/launch; inlet/review/task actions still work |
| Reconnection/policy/budget change | Dependent setup readiness, launch review diff, queue eligibility; historical versions remain readable |

P01–P19 are complete only when all associated action IDs and common states are implemented and the relevant T-cases pass. The accompanying walkthrough demonstrates selected business journeys with sample data; it is not a replacement for these production interaction contracts. No blank clickable controls, fake provider results, generic success toasts for failed jobs or inert “coming soon” pages count as completion.
