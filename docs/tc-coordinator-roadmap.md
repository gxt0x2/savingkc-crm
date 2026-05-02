# TC Coordinator Roadmap

Updated: 2026-05-02

## Goal

Build the Transaction Coordinator module by extending the current Saving KC CRM, not by starting a separate app. The finished workflow should collapse Gertha's closing workload into three approval queues:

- Document drafts
- Calls
- Exceptions

The current foundation in this branch deliberately starts lower in the stack: title companies, TC files, TC tasks, TC events, accepted-offer hooks, assignment-signed hooks, a TC work surface, and manifest mirroring.

## Current Repo Decisions

- Active app routes live under `src/app/(app)`.
- TC belongs inside the existing Dispo surface for now: `src/app/(app)/dispo/tc/page.tsx`.
- The canonical operational record is still the lead manifest in `manifests.manifest`, keyed by `lead_id`.
- New TC tables are allowed when they are manifest-linked workflow records, not a parallel source of truth.
- Manifest updates use `updateManifestV2_1` for new code. `updateManifestAndCascade` remains a legacy compatibility shim.
- Assignment state stays on `buyer_offers`; TC files link to the accepted offer instead of duplicating assignment fields.
- This foundation intentionally keeps the first UI dark to match the existing Dispo app. The later Gertha approval cockpit can move to a dedicated light theme once the workflow is proven.

## Foundation In This PR

This PR establishes the first reliable TC layer:

- `title_companies` and `title_contacts`
- `tc_files`, `tc_tasks`, and `tc_events`
- reusable TC document/email templates
- idempotent TC file creation from accepted offers
- DocuSeal assignment-signed hook into TC file creation
- `/api/tc/*` route handlers for files, tasks, templates, and title contacts
- `/dispo/tc` operational work surface
- Dispo navigation and badge integrations
- manifest mirroring of TC closing state through `updateManifestV2_1`

## Next PR Stack

### PR 2: Three-Queue Shell

Refactor `/dispo/tc` from status tabs into the target approval model:

- Drafts queue backed initially by templates and manual copy actions
- Calls queue backed initially by TC tasks and title-contact metadata
- Exceptions queue backed initially by `tc_files.risk_level`, `risk_reason`, and blocked tasks
- light-mode design tokens isolated to TC approval pages

No autonomous sending in this PR.

### PR 3: Draft Approval System

Add `tc_drafts` and the approval workflow:

- generated draft body
- edited body autosave
- approval/rejection audit log
- final sent body
- property file attachment
- Gmail/DocuSeal send behind explicit approval

### PR 4: Calls And Exceptions

Add first-class `tc_calls` and `tc_exceptions`:

- call agenda cards
- Twilio click-to-call from Gertha's number
- post-call transcript/fact extraction hooks
- exception resolution actions
- custom action capture

### PR 5: Phase Engine

Add the TC phase state machine:

- `contract_signed`
- `title_opened`
- `emd_pending`
- `inspection_period`
- `title_review`
- `clear_to_close`
- `closing_scheduled`
- `closed`

Phase advancement should be evaluated from manifest facts and TC artifacts, then mirrored back to the manifest through `updateManifestV2_1`.

### PR 6: Email Ingestion

Add support inbox ingestion once auth and secrets are hardened:

- Gmail webhook or polling
- sender role and intent classification
- property/lead matching
- fact extraction
- confidence thresholds
- low-confidence exceptions

### PR 7: Settlement And Title Audit

Add the high-leverage audit engines:

- HUD/CD settlement diff
- title commitment flag detector
- variance exceptions
- pushback draft generation
- fixture-heavy Vitest coverage

## Pre-Flight Security Gates

Before enabling autonomous Gmail, Twilio, DocuSeal, or cron behavior, the CRM needs the security cleanup already identified in `docs/SECURITY-ROTATION-CHECKLIST.md` and the cleanup audit:

- rotate exposed bearer values
- avoid broad unauthenticated API bypasses
- restrict API CORS
- tighten RLS policies
- reduce service-role blast radius
- keep branch protection and required checks current

## Success Criteria

The 60-day target remains:

- Gertha clears the TC approval queue in under 30 minutes per day on average.
- Draft rejection rate stays below 15%.
- No active-deal deadline is missed by the CRM.
- No settlement statement variance reaches closing unflagged.
- Email ingestion exceeds 90% accuracy for auto-cascaded facts.
- Ernest and Gertha read the daily TC brief consistently.
