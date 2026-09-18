# Email contact hygiene

One person can retain a primary email and one backup. Only the primary participates in a sequence. Imports fill empty slots; bounce, silence, and reimport do not promote the backup. Extra evidence remains in the address history. Changing the pair requires owner access, no active conversation or unresolved send, and a recorded reason. Personal stops and the minimum 90-day campaign recontact interval still apply after a change.

Unsubscribe, complaint and manual person stops persist at the confirmed person level and block newly linked aliases. Hard bounces and other mailbox failures stop only that mailbox. A shared or ambiguous mailbox cannot propagate a personal stop to other people; the mailbox itself remains blocked. No stop propagates through a property relationship.

Property holds are separate, temporary coordination controls. A real non-automatic reply linked to exactly one property holds other people at that property for review. An explicit broad family request or reported death/sale holds all property outreach for owner review. Ordinary opt-out alone does not create a property hold. Ambiguous/multiple property links require explicit owner selection. No heir relationship or representative authority is inferred.

Owner controls: Email → Inbox → Contact → Contact rules. Owners can record deceased reports/confirmation, clear only deceased holds with evidence, hold/release a linked property, and change the primary/backup pair. Personal unsubscribe cannot be undone by clearing a deceased or property hold. All changes are audited and stale-state/idempotency checked. Queued marketing is cancelled on a property hold and never revived on release. Already dispatched provider requests cannot be recalled.

## Release and validation

Apply `20261110120000_email_person_property_hygiene.sql` and `20261110121000_email_hygiene_runtime_access.sql` before the application release. The second migration grants only the existing hosted backend role access to the three new tables; it does not alter role flags or RLS. It adds private RLS-protected tables and backfills existing selected pairs and personal stops; it never clears existing suppression. The migration is replayable. If application rollback is needed, retain the additive tables and keep campaign sending off until behavior is reverified.

Tests cover independent heirs, late aliases, mailbox-only failure, shared inboxes, maximum pair size, no automatic promotion, owner access, stale requests, idempotency, property coordination and dispatch blocking after launch. The local browser test exercises an owner property hold at 360px with visible success feedback.

A selected pilot list is not a verified/launchable list. Source identity and dated deliverability evidence remain required. This change does not add an external verification subscription or claim a complete KPI reporting rollout.
