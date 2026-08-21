# Admin runtime route retirement

## Decision

The following one-time admin handlers are retired from the hosted CRM:

| Retired route | Replacement |
| --- | --- |
| `/api/admin/fix-orphans` | Canonical Mojo ingestion; reviewed offline reconciliation for a future real orphan |
| `/api/admin/migrate-deals` | Versioned Supabase migrations |
| `/api/admin/migrate` | Versioned Supabase migrations and `/api/admin/system-config` |
| `/api/admin/repair-mojo-leads` | Normal Mojo ingestion; a reviewed operations script for any future historical repair |

These paths now return the normal application `404`. They are also registered
as retired runtime routes, so the hygiene gate fails if a handler is restored.

## Production evidence

A read-only production preflight on 2026-08-21 confirmed:

- all 12 columns formerly added by `migrate-deals` exist on `deal_pages`;
- `push_subscriptions` and `system_config` exist;
- `last_mojo_sync_timestamp`, the only legacy default still used by the
  application, already exists;
- the other three defaults from the bootstrap handler have no repository
  consumers;
- there are zero `mojo_call` leads with the placeholder names `Mojo Lead`,
  `Unknown`, or an empty name; and
- a bounded 500-request, six-hour production log sample contained no requests
  to any of the retired handlers.

No production data was changed during this preflight.

## Quarantined synthetic orphan

Production still has one unlinked manifest created on 2026-03-29 in the
qualification station. A second read-only preflight established that it is
synthetic residue, not a recoverable seller:

- its source is `mojo:Test List`;
- its owner name and property address both contain test markers;
- it has no booking or notes and no matching lead by normalized phone, exact
  address, or exact name;
- it has no `manifest_history`, PPC conversion-outbox, or PPC tracking-event
  references; and
- it contains an internal audit trail, so the row was left unchanged instead
  of being destructively deleted.

The retired handler would have read the wrong owner fields and created a
placeholder seller through a mutating GET request. A future real orphan must
be reconciled through a reviewed, transactional operation with duplicate
checks; it must not restore this endpoint.

Operational admin routes such as reranking, Mojo session management, entity
health, stuck-station review, historical import, and enrichment reprocessing
are outside this retirement and remain unchanged.
