# Mojo ingestion integrity repair

The September 10 incident exposed independent KPI writers: a valid Mac snapshot did not clear an older server failure flag. The dashboard safely withheld Mojo totals, but the underlying intake also accepted HTTP 200 responses containing rejected records, advanced past failed pagination, and could associate a sole months-old recording with a recent activity.

## Resulting behavior

- Server cron owns scheduled KPI snapshots. The Mac refreshes and hands off the provider session, captures source evidence, and delivers candidate call records. A newer exact-day source snapshot supersedes an older failure flag. Invalid KPI values still fail closed; the precise parser reason survives retries. Missing values cannot silently become zero.
- A seven-day Central calendar replay replaces the independent end-of-day implementation. Activity pagination must cross both the previous checkpoint and the replay boundary; page failures, repeated pages, and the 100-page cap retain the checkpoint. Manual `mojo:eod -- --date YYYY-MM-DD --dry-run` performs provider reads only. Historical day recovery never advances the live cursor.
- Raw activity and recording metadata are retained before qualification in a private local spool and immutable database source archive. Provider date filters are not trusted for recording matching. All returned recording metadata remains in the archive, including non-candidates; this does not automatically turn recordings into leads or copy every audio file.
- Intake returns per-record receipts. A partial rejection, concurrent enrichment conflict, or missing duplicate row cannot be acknowledged as success. Failed chunks do not prevent later chunks being delivered. Compare-and-swap updates prevent a worker claim or competing enrichment from being overwritten.
- A recording must be the sole plausible dated candidate within 90 minutes of the activity. Ambiguous, undated, and out-of-window recordings remain unmatched. Matched calls use the recording timestamp. Activity grouping cannot cross Central dates. Current contact notes and unrelated current calendar events cannot be substituted for historical activity evidence.
- Explicit DNC group changes and scheduled callback-only activities reach governed intake without requiring seller-intent qualification. Contact lookup failures remain pending. Conflicting recording identities or callback times require review rather than being acknowledged as delivered.
- Reconciliation retains held evidence of every age, unaccepted source batches older than an hour, old queue work, and future callbacks without a linked lead. The queue drains one item every two minutes; a scheduled run is not proof of completed processing.
- The installer copies the transitive local import graph and verifies every file hash and syntax before activation. The application checks the importer's content digest against its committed expected manifest and reports drift; CI rejects runtime changes without an updated manifest (`node scripts/mojo-runtime-package.mjs --write-expected`). The runtime manifest records its Git revision and content digest; every installed supervised run verifies the manifest, and source batches retain that revision and digest. Activation failure restores the prior LaunchAgent and runtime. Supervisor timeouts terminate the child process group before releasing its lock.

## Release order and acceptance

1. Review and apply `20261102120000_mojo_ingestion_integrity.sql`. This adds private source receipts and read-only health checks; it does not repair historical CRM rows. Rehearse with `bash scripts/rehearse-mojo-ingestion-integrity.sh` first.
2. Deploy the reviewed application revision. Verify the source archive endpoint, per-record queue receipts, reconciliation version `crm_mojo_reconciliation_integrity_v1`, and the server KPI writer. An older reconciliation function must not report clean under the new application.
3. Stage and verify the same revision with `node scripts/mojo-runtime-package.mjs --stage /reviewed/staging/path` and `--verify /reviewed/staging/path`. Inspect `scripts/install-mojo-supervisor.sh` without `--apply`; then install the reviewed runtime. Preserve the runtime backup and local source spool.
4. Observe a scheduled Mac run, server queue execution, and server KPI run. Compare provider source, source receipts, queue outcomes, canonical events, follow-up work items, and signed-in My Day. Confirm the manifest digest in the installed directory. Clearing a notification is not acceptance.
5. Reconcile after a full calling day and again after the next day's replay. Measure source freshness, source batches still pending, queue age, held evidence, recording matches, and missed/unlinked follow-ups. Do not call the process permanently fixed based on one successful run.

If application activation fails, restore the prior application version; the additive source archive can remain. If Mac activation fails, restore the saved runtime and plist. Do not delete pending source batches or advance cursors manually to make health green. Review the batch's `last_error` and retained payload, correct the cause, and replay it. Do not overwrite canonical recording identities through a bulk backfill.

## Historical review held separately

The audit's private evidence is retained outside the repository. These event IDs require an explicit reviewed correction, with before/after provenance and downstream analysis review:

| Canonical event | Observed chronology conflict | Review scope |
| --- | --- | --- |
| `99e75df3-8245-4c4e-abd3-0736256608b9` | Sep 8 activity, recording about 3 hours earlier | Verify event time and association |
| `c3a86b73-b260-4c02-949b-e1934d2e225e` | Aug 27 activity, Aug 24 recording | Verify activity-to-call association |
| `dd0d0cad-e0c5-4c78-9144-e0e979c5fab6` | Aug 24 activity, June 18 recording; marked eligible/analyzed | Review association and dependent analysis/qualification |
| `9687d0b1-f2eb-4d6b-acba-d609bc591063` | Aug 24 activity, June 10 recording; marked eligible/analyzed | Review association and dependent analysis/qualification |

Provider activity `17464081` had a Sep 14 noon Central callback but no matching queue/event at audit time. The new callback path covers this source shape; its actual identity and work-item creation still need production verification. Three older held canonical events need evidence resolution or an explicit documented disposition, not disappearance from a recent-only window. Nineteen Sep 9 provider recordings lacked canonical matches; that is not proof of nineteen lost leads. Raw metadata capture now precedes qualification, while full non-candidate audio retention remains outside this repair.

## Remaining operational limits

The extractor still depends on this Mac and a provider browser session. This release improves receipts, recovery, and visibility; it does not establish a hosted provider API or remove the device dependency. A provider outage, unavailable recording, identity conflict, or deleted contact can still require intervention. Source capture and queue acceptance do not prove that every downstream recording, callback, or qualification has completed.
