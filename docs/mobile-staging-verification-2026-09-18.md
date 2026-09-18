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

The mobile-only migration
`supabase/migrations/20260918160000_mobile_command_receipts.sql` was then
applied to staging. The receipt table is empty before behavioral testing.

## Verified baseline

- 184 public tables and 3 `manifest_archive` tables restored.
- Required mobile tables and canonical RPCs are present.
- Auth users: 2; agent profiles: 2; CRM leads: 1.
- Lead activities: 0; work items: 0; appointments: 0.
- The canonical `contact_workspace_page_v4` RPC returns the authorized record
  in the `contacted` list with `is_favorite=false`.
- Focused backend mobile API tests: 63 passed.
- Standalone mobile tests: 72 passed.
- Standalone mobile TypeScript check: passed.

This environment is a limited staging surface. Native voice, external SMS or
email delivery, EAS/TestFlight distribution, physical-device continuity, and
production release are not verified by this note.
