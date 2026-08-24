# Prospecting V1 acceptance boundary

Prospecting is one governed workspace with two execution modes:

- a human-owned, single-line power dialer that can work every safe associated
  phone for a property; and
- a reviewed SMS cadence that sends only to explicitly selected recipients.

The county Saved Views are source inventory. Opening or filtering a view never
creates a CRM Lead, places a call, or sends a message.

## Canonical subject model

A campaign member represents exactly one subject:

- `lead` when a CRM Lead already exists; or
- `prospect` while the county/source record has not graduated into the CRM
  lifecycle.

Every member has one or more immutable campaign contact snapshots. A contact
snapshot records the phone, associated person, relationship, source phone row,
and suppression state that the operator reviewed. This is deliberately separate
from the member:

- the dialer can work every safe associated phone without duplicating the
  property in the campaign;
- SMS can require an explicit recipient choice instead of texting every person
  attached to a deceased-owner record; and
- later source refreshes cannot silently change an already reviewed audience.

An existing linked Lead always wins over a source Prospect as the campaign
subject. The source Prospect and its associated phones remain provenance; they
do not create a duplicate campaign member.

## Safety and promotion rules

- Enrollment is inert. Activation remains a separate human confirmation.
- DNC, STOP, disconnected, wrong-number, and bad-number evidence is evaluated
  for every contact snapshot and rechecked immediately before execution.
- Dialer members are ready when at least one contact target is callable.
- SMS members remain `needs_review` until a human chooses exactly one ready
  recipient snapshot. They do not count as launch-ready, and reviewing a
  recipient never launches or sends the campaign.
- A Prospect becomes a Lead only through an explicit promotion action after
  meaningful engagement. Campaign enrollment is never promotion.
- Replies and opt-outs are matched by canonical phone identity as well as Lead
  identity, so an unlinked source Prospect cannot continue in a cadence after
  responding.

## Compatibility

Existing Lead-only campaigns and dialer sessions remain valid. The additive V2
contracts expose subject-aware queue items while preserving legacy Lead IDs for
old clients. New source-prospect execution must use the subject-aware contracts;
there is no shadow-Lead fallback.

## Release acceptance

The first production release is complete only when all of these are proven:

1. A reviewed county Saved View can be enrolled without inserting a Lead.
2. Linked source rows deduplicate to their existing Lead campaign member.
3. Every associated phone remains visible, with blocked targets visible but
   non-executable.
4. A durable dialer session resumes on the same subject and works one phone at
   a time.
5. A saved disposition advances only after durable attempt and activity audit
   are written.
6. A human can approve exactly one non-suppressed SMS recipient, with no send
   occurring until a separate activation.
7. An inbound reply or STOP cancels remaining SMS work by normalized phone.
8. No automated call or message is sent by migration, enrollment, preview, or
   test verification.
