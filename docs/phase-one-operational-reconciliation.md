# Phase 1 — Operational Reconciliation

Date opened: 2026-08-22  
Baseline: `ac290cf47a8ee756fc5b0e9f428bd9f972ad0dfe` (`origin/main`)  
Branch: `codex/phase-one-operational-reconciliation`

## Outcome

Turn the current inbox and work backlog into trustworthy operating queues before adding more Mojo- or Launch Control-style automation.

This phase does not bulk-complete tasks, auto-dismiss inbound messages, or use AI to silently decide whether a person matters. It first separates structural categories, then gives an operator explicit reviewed actions.

## Frozen Scope

1. Produce an authenticated, aggregate-only reconciliation snapshot for work items and conversation attention.
2. Separate overdue work linked to current records, terminal records, and no record.
3. Identify multiple active and multiple primary actions per contact without changing them.
4. Separate known-contact Needs Reply demand from unmatched callers/numbers without hiding either.
5. Add indexed server filters and visible review lanes only after production counts prove the categories.
6. Preserve one-click access to the underlying record and require an actor-attributed decision for resolution.

## Non-goals

- No bulk close/delete/cancel operation based only on age or lifecycle.
- No AI spam/vendor classification in the source-of-truth state.
- No new dashboard or duplicate inbox.
- No Manifest field, writer, or operational authority expansion.
- No predictive/multiline dialer work until queue truth is complete.

## Initial Evidence

- Tasks currently reports 208 acquisition work items, including 175 overdue and 15 completed.
- The oldest visible work starts in April 2026; the first page contains assigned, linked follow-up and appointment work.
- Conversations currently reports 128 Needs Reply threads, with known seller demand mixed beside unmatched and obvious non-seller inbound traffic.
- External Vercel tooling intentionally does not reveal sensitive production database credentials. Phase 1 therefore adds a server-side authenticated aggregate instead of exporting customer records or secrets.

## First Deliverable

`GET /api/reports/operational-reconciliation` returns no names, phones, addresses, messages, or record identifiers. It reports exact source totals and bounded classifications for:

- active and overdue acquisition work;
- current, terminal, and unlinked overdue work;
- assignment coverage;
- multiple active and multiple primary actions;
- known, unmatched, terminal-known, assigned, and unassigned Needs Reply threads;
- age and channel buckets.

Classification reads are capped at 5,000 rows per source. If a source exceeds the cap, the response preserves exact totals, marks itself degraded, and refuses to imply complete classified counts.

## Acceptance Gates

- Aggregate route is authenticated, private/no-store, and fails honestly with 503.
- No PII fields are selected by the reconciliation service.
- Production totals reconcile to the canonical Task and Conversation counts.
- Indexed filter migration is additive, rehearsed, permission-checked, and rollback-safe.
- Known and unmatched inbox lanes remain independently accessible.
- Current-work and review-debt task lanes remain independently accessible.
- No lifecycle or attention state changes occur during read-model rollout.
- Signed-in desktop/mobile evidence and exact-SHA production checks pass.

## Approval Boundary

Reading and rendering the classifications is reversible and may proceed autonomously. Any production operation that completes, cancels, deletes, reassigns, merges, or marks records resolved requires a separately reviewed reconciliation and explicit approval.
