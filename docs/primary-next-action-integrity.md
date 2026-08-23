# Primary next-action integrity

## Operating rule

Every active opportunity should have exactly one pending primary next action.
Tasks in lifecycle review or automation quarantine do not satisfy this rule.

## This release

- Adds exact server-side counts for active opportunities with zero, one, or
  multiple current primary next actions.
- Shows the missing and duplicate counts in the Tasks reconciliation strip.
- Prevents a newly created current primary next action when that opportunity
  already has one.
- Serializes simultaneous creation attempts and also rejects duplicates inside
  a single multi-row statement.
- Keeps normal task replacement valid: complete or demote the old primary, then
  create the next one.
- Returns an actionable conflict to the UI instead of a generic server error.

## Controlled repair approved 2026-08-22

The aggregate-only production census found 19 active opportunities without a
primary next action. Four have exactly one current, pending, operator-entered
task and are eligible for promotion. Eleven have no trustworthy candidate and
four have multiple candidates; those fifteen remain unchanged for human review.

The repair entrypoint is server-only and requires the exact preflight counts
plus an opaque fingerprint of the four source rows. It updates only
`primary_next_action` and repair provenance on those existing task metadata
records, writes immutable `work_item_events`, and returns a post-repair
fingerprint. A separate rollback entrypoint works only while that post-repair
fingerprint remains unchanged.

AI suggestions, manifest recommendations, automation quarantine, event-derived
tasks, and ambiguous operator tasks are never promoted by this repair.

## Earlier explicit non-goals

This release does not modify any existing task, including known historical
duplicates or opportunities missing a primary. It does not complete, cancel,
delete, rename, reassign, redate, or demote a task. The visible production
counts become the evidence for a separate repair proposal.

The integrity release itself remains non-mutating. The separately approved
controlled repair above is the only authorized exception.
