# Mobile staging verification — 2026-09-18

This note records the isolated preview environment used by the SavingKC mobile
implementation. It contains no credentials and is not a production migration
procedure.

## Isolation

- Parent Supabase project: `fprrknfyzlthbxewnwmi`
- Persistent data-less branch: `mobile-staging`
- Staging project ref: `jjsgubakklarrhbzabwl`
- Staging branch id: `1a2b291a-f1d8-4559-aea5-3c55e73c46f0`
- Vercel scope: Preview only, Git branch `codex/mobile-live-api`
- Preview writes: enabled only with `PREVIEW_ALLOW_WRITES=true`
- External provider effects: disabled with `TEST_MODE=true`

No production rows were copied. The staging database contains two internal
test identities and one user-authorized CRM record,
`1705b085-47c6-432d-9371-97dcabfc9bbc`. Staging passwords are stored only in
the local macOS Keychain under `SavingKC Mobile Staging`; no authentication
email was sent.

## Schema bootstrap

The historical production migration ledger begins at migration `008`; the
foundational production schema is not represented by the repository migration
chain. A normal data-less branch therefore stopped with `MIGRATIONS_FAILED`
after applying the static `008` queue seed.

The staging branch was reset and bootstrapped from a `supabase db dump`
schema-only snapshot of the production `public` and `manifest_archive`
schemas. The snapshot contained no `COPY`, `INSERT INTO`, or other data section.
The only missing production extension, `pg_trgm`, was installed in staging.
The custom `email_workflow_runtime` placeholder is `NOLOGIN`, `NOINHERIT`, and
`NOBYPASSRLS`; provider execution remains disabled.

The mobile-only migrations
`supabase/migrations/20260918160000_mobile_command_receipts.sql` and
`supabase/migrations/20260918170000_mobile_appointment_commands.sql` were then
applied to staging. Production migration history was not changed.

## Verified baseline

- 184 public tables and 3 `manifest_archive` tables restored.
- Required mobile tables and canonical RPCs are present.
- Auth users: 2; agent profiles: 2; CRM leads: 1.
- Lead activities: 0; work items: 0; appointments: 0.
- The canonical `contact_workspace_page_v4` RPC returns the authorized record
  in the `contacted` list with `is_favorite=false`.
- Focused canonical appointment backend tests: 21 passed across 8 files.
- Standalone mobile tests: 78 passed across 39 suites.
- Standalone mobile TypeScript check: passed.

This environment is a limited staging surface. Native voice, external SMS or
email delivery, EAS/TestFlight distribution, physical-device continuity, and
production release are not verified by this note.

## Authenticated behavioral verification

The clean backend source at `5a4408f58453aa4cfb576b2904e40675759c68fa`
was built with the branch-scoped preview environment. The canonical build gate,
Next.js compile, TypeScript pass, 131-page static generation, and serverless
function trace completed. The successful local verification build used the
supported webpack fallback because Turbopack could not bind its local worker
port in the execution sandbox. Build output repeatedly confirmed `TEST_MODE`
was active, so SMS and email provider delivery remained disabled.

A local preview of that exact build authenticated against staging and proved:

- an unauthenticated mobile session returns `401`;
- Ernest resolves to auth user `8fa104d1-2e2b-4a57-a841-3c2af14d2e83`;
- the contacted pipeline initially contained exactly the authorized Ernest
  Dodson record and no demo row;
- the record initially had no pin, note, work item, appointment, or activity;
- top-opportunity and Ernest's per-user chat pin both persisted as `true`;
- one clearly labelled staging note was saved, and replay returned the same
  activity id with one stored row;
- one task, one in-person appointment, and one event were saved with distinct
  canonical ids; replay returned those same ids with `created=false`;
- replaying the task key with changed content now returns `409`, while a
  same-payload replay still returns the original canonical task with
  `created=false`;
- a missing work-item idempotency key returns `400`; the existing changed-note
  replay returns `409`;
- after a complete backend restart, all rows and ids were unchanged;
- Casey's independent auth session sees the shared opportunity pin, note, and
  exactly three calendar rows while Casey's per-user chat pin remains `false`.

The durable rows are explicitly titled or described `STAGING VERIFICATION` and
state that no customer action is required. No call, SMS, email, or other
customer communication was attempted.

## Canonical appointment contract

Backend source `eeeeb1f56fbedfb707a4042ae77b808464428240` contains the
fixed mobile routes, server-derived actor handling, canonical appointment
service, and staging migration. Its 21 focused tests, 4 GB TypeScript gate, and
direct Next.js webpack production build all pass.

The appointment migration was applied only to the isolated staging branch. A
schema/RPC audit confirmed all ten mobile appointment fields, the
`appointment_command_events` ledger with RLS enabled, authenticated-role RPC
execution revoked, and service-role-only execution granted.

Direct transactional staging verification then proved:

- create produced canonical appointment
  `b97d2438-bdb9-4f65-aa4c-1031a96a4e41` at version 1;
- exact create replay returned the same ID with `replayed=true` and no duplicate;
- changed payload with the same actor/key failed with
  `appointment_idempotency_conflict`;
- edit kept the same ID and advanced to version 2; exact edit replay stayed at
  version 2;
- a stale expected version failed with `appointment_version_conflict`;
- reschedule kept the same ID and advanced to version 3 with start
  `2026-09-26T17:00:00+00:00`;
- cancel advanced to version 4, left zero active calendar rows, and the complete
  sequence created exactly four command-ledger rows and four activity rows;
- reminders remained disabled and provider status remained `not_configured`, so
  no provider call, calendar event, SMS, or email was attempted.

The database also enforces a 15-minute minimum and 24-hour maximum appointment
duration. A local route without a service-role value correctly returned `503`
rather than bypassing server authorization.

The exact rebased branch head `1470ad9ff4f1ecba4ce2d3e5bc1b5824a91160f3`
then deployed as preview `dpl_64wgV4MwdbztQdPXWGj8HiuZ12hs` at
`https://savingkc-25b47l3yw-gxt0x2s-projects.vercel.app`. Its build log confirms
that the canonical gate passed, commit `1470ad9` was cloned, all appointment
routes were built, and `TEST_MODE` disabled SMS and email delivery.

Authenticated hosted HTTP verification used independent Ernest and Casey
sessions and proved the same create/replay/conflict/edit/stale-version/
reschedule/cancel sequence. Hosted appointment
`f3623a55-8b27-49da-a080-fd36fdf4cbcc` remained one row across versions 1–4;
both users read the same version 3/start time before cancellation; the final
active-calendar count was zero. This is two-user API continuity, not a physical
two-phone result.

## Hosted-preview incident boundary

Vercel accepted two preview-only artifacts for this source:

- Git preview `dpl_5TAk3x6u436F5otqyFwc3UbC2cHu`;
- prebuilt preview `dpl_BL6MBuaV4Neks7zpJeEfiYLdKN9D`.

Both later became `READY` after Vercel incident `bwkmw4hmrgmk`, “Elevated Errors
Triggering Deployments,” cleared. They predate the canonical appointment adapter
and remain historical only. The new exact-source preview
`dpl_64wgV4MwdbztQdPXWGj8HiuZ12hs` is `READY` and passed the authenticated checks
above. It is a preview, not a production release.
