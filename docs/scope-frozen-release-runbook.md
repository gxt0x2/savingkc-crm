# Scope-frozen CRM release runbook

This runbook is the production boundary for the integrated AI-native CRM release. It does not authorize a production migration by itself.

## Release artifact

- Integration PR: `#532`
- Integrated product head rehearsed before this runbook-only update: `99502e3dd5b649368bdcf39a1459c822b690cadc`
- Release head: the live PR `#532` head; re-check it immediately before approval
- Supabase project ref: `fprrknfyzlthbxewnwmi`
- Last migration recorded in production at preflight: `20260921120000`

The GitHub and Vercel checks must remain green on the exact integration head. Signed-in preview acceptance and explicit production migration approval are required before the PR leaves draft.

## Current read-only preflight

The August 24, 2026 preflight found:

- zero active SMS campaigns;
- zero paused SMS campaigns;
- zero queued or processing campaign actions;
- zero existing campaign members;
- 24,544 source prospects and 24,210 source phone rows; and
- no `prospecting_campaign_member_contacts` table before migration, as expected.

The current production schema is ahead of its migration ledger in a few
places: the 722 legacy qualification hints, canonical briefing queue, and
Manifest writer shutdown already exist, while the subject-aware Prospecting,
verified intake, and department-hardening functions do not. None of the twenty
versions below are recorded remotely. Do not mark the entire train applied with
`migration repair`; execute the idempotent files so the missing artifacts are
created and the ledger becomes truthful.

The full-data rehearsal found these exact migration-time effects:

- 280 canonical properties are linked to a Lead; 30 currently have a genuine
  source-backed fact change (29 occupancy values and one tax/delinquency fact);
- those 30 property changes queue 30 internal AI briefing refreshes through the
  already-deployed briefing trigger; they do not call or message a seller;
- all 722 legacy Manifest qualification hints are already present as
  `needs_review`, so the idempotent backfill inserts zero additional hints;
- zero current briefings require duplicate-current repair and zero PPC
  attribution rows require backfill; and
- campaign members, queued/processing campaign actions, Dialer sessions,
  Dialer attempts, and Dialer events all remain zero.

Re-run the read-only fact comparison immediately before apply. The exact
property/briefing count may change with legitimate CRM activity; require every
other count above to remain inert.

No preflight, migration rehearsal, enrollment, or browser smoke test placed a call, sent a message, created a Lead, or changed a production row.

## Required migration order

Apply exactly these migrations, in order:

1. `20260922120000_contact_workspace_canonical_overlay.sql`
2. `20260923120000_contact_workspace_manifest_retirement.sql`
3. `20260924120000_crm_property_facts.sql`
4. `20260925120000_crm_lead_qualification_pillars.sql`
5. `20260926120000_crm_lead_offer_command.sql`
6. `20260927120000_crm_property_enrichment_evidence.sql`
7. `20260928120000_crm_property_enrichment_jobs.sql`
8. `20260929110000_canonical_lead_asking_price.sql`
9. `20260929120000_canonical_ai_briefings.sql`
10. `20260930110000_canonical_bookings_and_appointments.sql`
11. `20261001120000_canonical_mojo_call_ingestion.sql`
12. `20261002120000_ai_change_proposal_manifest_retirement.sql`
13. `20261003120000_canonical_ppc_attribution_backfill.sql`
14. `20261004120000_contact_workspace_canonical_opportunity_score.sql`
15. `20261005120000_retire_manifest_runtime_writers.sql`
16. `20261006120000_prospecting_campaign_subjects.sql`
17. `20261006123000_subject_aware_dialer_sessions.sql`
18. `20261006130000_reviewed_sms_recipients.sql`
19. `20261007120000_verified_seller_intake_workflow.sql`
20. `20261008120000_department_responsibility_hardening.sql`

All twenty were applied twice without error to an isolated PostgreSQL 17 clone
of the current production `public` schema and current public data. The
325-MB/10,668-row `manifest_history` table was excluded from the local data copy
because none of the migrations reads or changes it; its production count is a
separate invariant. The second pass produced no additional business rows or
briefing revisions. The rehearsal also verified canonical contact reads,
subject-aware dialing, reviewed SMS contacts, verified seller intake,
service-role boundaries, and the Acquisitions → Dispositions → Transaction
Coordination responsibility mapping.

## Safe Supabase procedure

Do not run `supabase db push --include-all` from the repository. Historical local files predate the current remote migration ledger and would be incorrectly offered for replay.

Instead:

1. Create a temporary Supabase work directory.
2. Copy one local placeholder file for every migration already recorded remotely.
3. Copy only the twenty files listed above after those placeholders.
4. Link the temporary directory to project `fprrknfyzlthbxewnwmi`.
5. Run `supabase db push --linked --dry-run`.
6. Require the dry run to list exactly the twenty files above, with no additions, omissions, or reordering.
7. Re-run the read-only operational preflight immediately before apply.
8. Only after explicit approval, run the same whitelisted push without `--dry-run`.

## Post-apply proof

Before merging application code, verify:

- all twenty migration versions appear in the remote ledger;
- application runtime roles cannot write Manifest history;
- canonical contact, property, qualification, offer, appointment, attribution, AI briefing, workflow, and department functions exist with service-role-only permissions;
- Prospecting remains inert until a human enrolls and separately activates reviewed work;
- the expected source-backed property changes created only the matching number
  of internal briefing jobs, with no duplicate revision on replay;
- no unexpected SMS action, dialer session, lifecycle event, workflow run, or Lead was created during apply; and
- the pre-migration Manifest and Manifest-history row counts remain unchanged.

Then merge PR `#532`, verify the exact production deployment SHA, run the signed-in desktop and mobile acceptance set, and begin the controlled pilot. Physical Manifest archival remains a later, separately reviewed encrypted-data operation; this release disables operational authority and writers but does not delete historical rows.
