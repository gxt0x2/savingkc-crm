# Workflow run governance

## Outcome

SavingKC workflows now have an additive execution contract instead of relying on route logs or mutable JSON alone. A run captures the exact definition version and hash, the verified requester, input, approval boundary, attempts, leases, step outcomes, retry schedule, result, and append-only lifecycle events.

This release does not activate a cron schedule or silently enable existing catalog workflows. The only approved executor is `workflow-registry-health`, a manual read-only validation of code-owned definitions and stored drafts.

## Trust boundaries

- Browser and authenticated database roles cannot read or mutate workflow ledgers directly.
- Server routes resolve the authenticated actor; client actor fields are ignored.
- Workflow drafts require owner/admin authorization.
- Every data-mutating workflow enters `awaiting_approval`, even when old catalog metadata says `automatic`.
- Approval decisions require the admin boundary and an idempotency key.
- Workers claim supported runs with a time-bound lease. A crashed lease is retryable after expiry.
- Step and run completion require the active lease owner.
- Retries use database-owned exponential backoff and stop at the run's retry budget.

## Durable model

- `workflow_definition_versions`: immutable snapshots referenced by runs.
- `workflow_runs`: current durable state, lease, attempts, retry time, and result.
- `workflow_run_steps`: one idempotent outcome per step and attempt.
- `workflow_approvals`: explicit approve/reject decisions.
- `workflow_run_events`: append-only lifecycle provenance.

The code/configuration catalog remains the authoring source. Registering a run never rewrites an existing `(workflow_id, version)` with different content; it fails with `definition_version_conflict`.

## Controlled rollout

1. Recheck that all five target tables are absent and required roles/functions exist.
2. Apply `20260822120000_workflow_run_governance.sql` transactionally.
3. Verify RLS, grants, function execution rights, indexes, and empty ledgers.
4. Run a rollback-only SQL probe for idempotent start, lease, step, completion, approval, and retry.
5. Deploy application code.
6. Run `Workflow Registry Health` once from the signed-in Workflows page and verify one successful run, step, and lifecycle sequence.

No production migration is authorized by merging the draft PR. It requires a separate controlled rollout approval.

## Rollback

Before any real run exists, application rollback is sufficient: the Workflows panel reports the ledger as unavailable and no existing CRM process depends on it. The additive tables and functions can remain dormant.

After real runs exist, do not drop the ledgers. Roll back the application executor, keep the audit data read-only, and repair or replay only by explicit run ID and idempotency key.
