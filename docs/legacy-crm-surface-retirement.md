# Legacy CRM surface retirement

## Decision

The canonical operator surfaces are Dashboard, Contacts, and the unified AI
Assistant. The legacy list/dashboard pages remain as server redirects so old
bookmarks do not break:

| Legacy route | Replacement | Owner |
| --- | --- | --- |
| `/leads` | `/contacts` | Acquisitions |
| `/in-closing` | `/contacts?list=in_closing` | Acquisitions |
| `/opportunities` | `/contacts?list=hot` | Acquisitions |
| `/ari` | `/dashboard` | Operations |

`/leads/[id]` remains the full contact workspace. Hot Opps is now a first-class
Contacts smart list using the persisted motivation score and the same owner,
next-action, conversation, bulk-action, and filter controls as the rest of the
pipeline.

## Why

- The old Leads page downloaded up to 500 lead rows directly from browser
  Supabase and maintained its own filters, selection state, bulk actions, and
  refresh behavior beside the server-owned Contacts workspace.
- In Closing duplicated the canonical Contacts smart list.
- Hot Opportunities duplicated Contacts data and actions. Its custom drag
  order lived only in one browser, so it was not a durable team priority. The
  canonical Hot Opps list sorts by persisted motivation score instead.
- The old ARI dashboard duplicated Dashboard, Tasks, Conversations, Dialer,
  and the persistent AI Assistant while continuing to use separate client
  data hooks.
- A bounded production log sample on 2026-08-21 showed current traffic on
  Dashboard, Contacts, and AI, and no requests to these three legacy pages.

## Compatibility and retention

- Redirects remain in place for bookmarks and internal history.
- Internal links point directly to canonical destinations.
- The old Ghost Protocol phase cards no longer pretend to apply a filter that
  neither Leads nor Contacts implemented; they remain truthful status cards.
- Lead-level ARI APIs and their tables remain available for embedded lead
  detail consumers. They are registered as deprecated with a 2026-11-30
  review date and are not deleted by this change.
- Scheduled ranking and the authorized admin recovery route remain available;
  the retired page no longer exposes its older manual rerank write surface.

## Removal gate

Do not delete the redirect routes or ARI data until a later production access
check confirms no remaining caller, the embedded lead-detail consumers have
been migrated, and the system registry retention review is complete.
