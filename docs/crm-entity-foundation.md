# CRM entity foundation

## Decision

`leads` remains the compatibility write aggregate during this phase. New
`crm_*` tables are an additive canonical projection; they do not rename,
truncate, or repurpose the existing `contacts`, `properties`, or `deals`
tables.

Production evidence on 2026-08-20 showed why a direct rename is unsafe:

- `leads` contains 79 person, property, pipeline, call, offer, and closeout
  fields in one row;
- 362 leads have 361 distinct normalized phone numbers and one duplicate phone
  group;
- 278 leads have no email and 81 have no property address;
- legacy tables already contain 102 contacts, 47 properties, and 5 deals;
- only 37 legacy contacts overlap current leads by phone, and only 31 legacy
  properties overlap by normalized address;
- the prospecting pool is separate: 24,544 prospects and 24,210 prospect phone
  rows are not promoted into canonical CRM people until they become leads.

## Canonical contracts

- `crm_people` owns a human identity.
- `crm_contact_methods` owns normalized phone/email identity, deliverability,
  and current SMS consent state. A normalized method belongs to at most one
  person.
- `crm_properties` owns a normalized property identity.
- `crm_opportunities` owns pipeline state. During compatibility, there is one
  opportunity per lead.
- `crm_opportunity_people` supports multiple sellers, heirs, owners, and buyers
  without adding more columns to `leads`.
- `crm_lead_entity_links` is the non-destructive bridge used for dual reads.
- `crm_identity_conflicts` preserves contradictory evidence for human review;
  the projection never silently steals a phone or email from another person.
- `crm_consent_events` is append-only provenance. `sms_opt_outs` remains the
  current enforcement source and projects STOP/START state into the canonical
  contact method.

## Write and rollout policy

Lead inserts and relevant identity/pipeline updates refresh one projection in
the same transaction. SMS consent changes update one normalized contact method
and append one idempotent consent event. Browser roles cannot read the new PII
tables directly; authenticated APIs use the service client.

The backfill locks only `leads` and `sms_opt_outs` against concurrent writes for
the duration of the controlled migration. At the measured production volume,
this is hundreds—not millions—of lead rows, but it must still be rehearsed and
timed before production approval.

The compatibility lead detail API returns `entityContext`. If the migration is
not present or the projection is temporarily unavailable, the legacy lead view
continues to load and marks the entity context degraded. No UI or automation
may switch its source of truth until reconciliation proves complete coverage
and zero unresolved identity conflicts for that workflow.

## Explicitly deferred

- merging the legacy `contacts`/`properties`/`deals` rows;
- promoting all skip-traced prospects into CRM people;
- destructive removal of columns from `leads`;
- automated identity-conflict resolution;
- making any mutating workflow depend exclusively on the new model.
