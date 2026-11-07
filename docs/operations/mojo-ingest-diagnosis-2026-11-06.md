# Mojo → Atlas ingest diagnosis — 2026-11-06

> **Correction (11/06 evening, after the reinstall).** Cause 2 below is wrong. Ernest reinstalled the supervisor from `main` @ `082e97b3`. The packaged runtime verified at content digest `ae7d0ee9…`, the same digest `src/config/mojo-runtime-manifest.json` has carried since #718. So the runtime **content** did not change, only its revision label. #762 does not change the runtime at all. It adds a one-off backfill, `npm run mojo:calls:backfill` (window 2026-10-09 → 10-19). That backfill needs Mojo MCP OAuth (`mcp:calls.read`) credentials and writes `crm_mojo_calls` only with `--apply`. An empty `crm_mojo_calls` is therefore expected until someone runs that backfill. It is not ingest staleness. The reinstall was harmless (same digest, so batches keep being accepted). Running the backfill is Ernest's call.

Read-only check against Atlas (`fprrknfyzlthbxewnwmi`) at ~19:00 UTC. Nothing was drained, advanced, replayed or edited. `mojo_call_queue` untouched.

## Bottom line

Ingest is **not broken**. The Mac supervisor is alive and new Mojo outcomes land within ~7 minutes. The "stale since 10/28" signal has two separate causes:

1. **`crm_mojo_call_events` is meaningful-only by design.** It only receives callbacks, conversations and appointments (86 rows since June). There were no qualifying Mojo outcomes between 10/28 18:39 and 11/06 15:39 UTC. Both of today's (Casey, callback_scheduled) arrived at 15:42 and 18:09.
2. **`crm_mojo_calls` (per-dial ledger, #762) is empty because the Mac runtime predates it.** Every source batch since 10/26 reports runtime `19a96469` (#718). The ledger code that emits `mojo-call-*` records shipped later in #762, so the Mac never sends them. **Fix is a supervisor reinstall, not code.**

## Evidence

| Check | Result |
| --- | --- |
| `mojo_source_batches` | 328 total, latest 11/06 18:42 UTC, **0 unaccepted**, 0 with `last_error` |
| Runtime digest on batches since 10/26 | `19a96469` only |
| Receipts → queue → events since 10/28 | Every received record has a queue row; all `completed` rows have an event. Batches mostly re-send the same few records (e.g. 10/29: 48 receipts, 8 unique) |
| `mojo_call_queue` | 113 completed, 6 `waiting_evidence` (oldest 2026-08-24) |
| `crm_mojo_calls` | 0 rows |
| `mojo_recovery_runs` | Exhausting every minute since 10/27 on `integrity` |
| Open `mojo_recovery_incidents` | 1, opened 10/27, `CRM reconciliation has 15 unresolved issues`, alert SMS `failed` |

### Why recovery keeps exhausting

`crm_mojo_reconciliation_snapshot_v1` (30-day window) counts 15 issues — none of them ingest failures:

- `evidencePendingAllAges`: **11** — 8 canonical records from 8/24–10/01 (incl. two `mojo-email-*`) + 3 queue records (10/20, 10/26, 11/06) still waiting on recording/evidence.
- `deadCurrentWorkItems`: **3** — open work items on dead leads.
- `lifecycleStationDeadConflict`: **1** — lead `369ab430…` station `dead` with a non-dead lifecycle.

These are data-hygiene items. Recovery can't clear them, so it exhausts forever and keeps the incident open.

## Steps for Ernest (Mac — owner only)

1. On the Mac, `cd` into the CRM repo and `git pull` on `main`.
2. Dry-run: `zsh scripts/install-mojo-supervisor.sh` — confirm the paths it prints.
3. Apply: `zsh scripts/install-mojo-supervisor.sh --apply`. It stages a verified runtime package and reloads the LaunchAgent.
4. After the next run, confirm new batches show a runtime newer than `19a96469` and that `crm_mojo_calls` starts filling.
5. Only if batches stop arriving: re-auth the Mojo browser session (session refresh), then re-run step 3.

## Decisions for Ernest (not done here)

- The 11 evidence-pending records: re-request recordings, or mark them reviewed-unavailable through the reviewed correction path. Do not advance cursors manually.
- The 3 dead-lead work items and the 1 lifecycle conflict: close or correct in the CRM.
- Incident alert SMS shows `failed`; the cause wasn't traced in this pass. Worth checking alongside #763 (automated SMS disabled), and deciding whether Mojo incidents should alert by push.
