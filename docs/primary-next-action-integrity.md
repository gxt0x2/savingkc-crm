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

## Explicit non-goals

This release does not modify any existing task, including known historical
duplicates or opportunities missing a primary. It does not complete, cancel,
delete, rename, reassign, redate, or demote a task. The visible production
counts become the evidence for a separate repair proposal.

Any repair of existing records remains approval-dependent because it changes
operational state. The repair must present exact candidates, proposed changes,
rollback evidence, and post-change counts before it can be applied.
