# Mojo intake and recovery

The Mac remains the supported source collector. No new paid service is required. The LaunchAgent operates independently of the display; Codex follow-up checks additionally need the desktop app available.

## Admission

Every `/api/mojo/sync` request must identify an already archived source batch and the currently released runtime digest. The server verifies activity/contact identity, scheduled follow-up facts, recording identity, duration and chronology against that source. Queue acknowledgments are persisted as per-call source receipts; archive acceptance requires those receipts. Authenticated older callers receive an explicit rejection before queue writes. Runtime identity is also required for session and Mojo checkpoint/config writes. The obsolete local KPI upload endpoint returns 410; scheduled server collection and reviewed historical reconciliation own daily totals.

Provider action identity survives a later note. The intake service maps an action back to exactly one existing legacy queue identity so existing callback tasks and command keys survive rollout. Conflicting schedules or multiple legacy matches remain retained for review. This does not implement provider cancellation semantics or a complete model of multiple calls on one day; raw activities and recording metadata remain the recovery evidence.

## Release sequence

1. Rehearse `20261103130000_mojo_intake_source_receipts.sql` in a transaction that rolls back; verify all-age recording reuse is detected.
2. Apply that additive migration and record its exact checksum in the deployment receipt. Older ingestion remains compatible with the additional tables.
3. Release the server, then immediately install the same committed runtime with `scripts/install-mojo-supervisor.sh --apply`. During this short handover, old collectors fail closed and keep their local spool/checkpoint.
4. Verify the installed content digest, run supervised intake, and inspect source receipts, queue delivery and existing callback task identities. Probe obsolete requests with invalid/empty payloads; do not create synthetic production leads.
5. Confirm server KPI collection still succeeds. Keep overnight and closed-day comparisons open until observed.

A runtime backup is preserved by the installer. Roll back server and runtime together if necessary; retain the additive archive and receipts. Do not revert to the earlier page-based source collector.

## Health

A supervisor receipt records every completion or failure, including intake success, operational health, KPI status and historical reconciliation. A historical hold does not overwrite a successful intake with a sync failure. The server health monitor continues to report the hold. Recording reuse is detected across all dates, independent of names, notes or lead linkage.

Historical evidence corrections must preserve an immutable before/after audit, source artifacts and existing business work. Incorrect analyses must be withdrawn from active context and their unapplied proposals rejected using the governed decision function. Retained notes without audio remain unresolved; absence from the current provider response is not proof audio never existed.
