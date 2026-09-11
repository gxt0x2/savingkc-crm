# Mojo automatic recovery

The Mac LaunchAgent owns recovery. The hosted health, KPI and session failure producers observe symptoms through one gate; they do not send a text on the first failure. No additional service is required.

## Run and verification contract

- The Mac and hosted health share the confirmed SavingKC workday calendar and 8 AM–6 PM America/Chicago window. Closed hours do not count as missed intake. The first run has until 8:30 AM to complete and verify, unless three actual attempts already failed.
- Every admitted run receives a UUID and a server timestamp in `mojo_recovery_runs`. Admission and receipts require the deployed runtime content digest.
- Each cycle permits three attempts, with 15- and 45-second backoff. An attempt renews a missing/expired session, runs the existing archived/idempotent intake and due queue processor, and asks the hosted KPI writer to refresh missing/stale current-day totals.
- Each child process group is bounded to four minutes. Health and receipt requests are bounded; the complete run receipt expires after 20 minutes. The lock prevents overlapping collectors. Shutdown terminates the child group and does not start another attempt.
- A zero exit code is insufficient. The server must independently verify a source completion timestamp after the run started, current-day provider performance, the admitted runtime, and reconciliation. Known evidence holds remain visible without being called an outage.
- Receipts are retained both in the database and in the Mac's `mojo-recovery-history.jsonl`; the heartbeat is replaced atomically. A lost report response is retried using the same run UUID. A finished receipt cannot be rewritten by a late child.

## Escalation contract

`mojo_recovery_incidents` retains one continuous open episode across all failure producers. Intermediate failures await the scheduled collector. Three verified failed attempts, or an unresolved 30-minute recovery deadline, permit escalation. A missing worker receipt has its own concrete Mac/connectivity action. The host can detect a missing Mac even though it cannot restart a powered-off computer.

A database compare-and-set permits one alert claim per episode. Repeated symptoms, growing age counters, and different producer names do not generate repeated texts. Fresh verified health closes the episode. Ambiguous SMS delivery stays recorded without blind retransmission.

System Health shows the current gate, attempt count, receipt time, verification limitation, and any specific action required. Routine healthy cycles and known historical evidence holds do not send SMS.

## Safe boundaries

Automatic recovery renews sessions and replays the existing admitted source/queue process. It does not guess missing callback times, overwrite conflicting seller facts, reset dead letters indefinitely, bypass runtime checks, perform historical corrections, or deploy arbitrary code. Login/MFA, a disconnected Mac, a damaged runtime, conflicting evidence, or a persistent defect can require intervention after recovery is exhausted. The ordinary 15-minute collector continues retrying after an escalation.

## Verification and rollout

Run focused policy/controller/route/incident tests and `bash scripts/rehearse-mojo-recovery.sh`. The PostgreSQL rehearsal checks service-only access, one open episode, atomic alert claims, and completion compare-and-set. Test faults with injected functions; never generate a synthetic seller or real SMS.

Apply only `20261103140000_mojo_automatic_recovery.sql`, deploy the exact passing main revision, install its matching supervisor package, then verify an actual scheduled run and the signed-in System Health panel. Retain the prior package for rollback. The server and local runtime digest must match.
