# Admin runtime route retirement

## Decision

The following one-time admin handlers are retired from the hosted CRM:

| Retired route | Replacement |
| --- | --- |
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

## Intentionally retained

`/api/admin/fix-orphans` remains available behind its existing admin boundary.
Production still has one unlinked manifest created on 2026-03-29 in the
qualification station, so that recovery capability is not yet eligible for
retirement. It must be investigated and repaired through a controlled,
auditable operation before the handler is removed.

Operational admin routes such as reranking, Mojo session management, entity
health, stuck-station review, historical import, and enrichment reprocessing
are outside this retirement and remain unchanged.
