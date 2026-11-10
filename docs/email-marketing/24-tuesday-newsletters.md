# Tuesday newsletters (draft only)

Four segment presets live in the CRM email platform. Nothing in this change enrolls a person or sends mail. The owner has not approved a send.

| Segment | Edition | Program | Sender | Cadence |
| --- | --- | --- | --- | --- |
| `general` (homeowners weighing a sale) | `tuesday_note_general` | `seller_nurture` | ernest@talktosavingkc.com | Tuesday 07:00 America/Chicago |
| `tax` (owners behind on property taxes) | `tuesday_note_tax` | `seller_nurture` | ernest@talktosavingkc.com | Tuesday 07:00 America/Chicago |
| `inherited` (heirs) | `tuesday_note_inherited` | `seller_nurture` | ernest@talktosavingkc.com | Tuesday 07:00 America/Chicago |
| `investor` (buyer list, no deal cards) | `tuesday_deal_desk` | `buyer_marketing` | ernest@talktosavingkc.com | Tuesday 07:00 America/Chicago |

`seller_outreach` stays pinned to ari@talktosavingkc.com. Every hosted program still rejects the savingkc.com registrable domain. Issue HTML keeps List-Unsubscribe, List-Unsubscribe-Post, and a visible Unsubscribe link.

Schedules are stored `disabled` with mode `draft_only` and `owner_approved = false`. `holdNewsletterDispatch` returns `sent: false` even if `NEWSLETTER_OWNER_APPROVED=approved`.

Public signup is `/newsletters` and the form on the sell funnel pages. The subscriber picks one segment. The control defaults to `general`. It posts to `/api/email/newsletters/signup` and stores an email contact with role (derived from the segment), segment, county, tags, and the consent sentence. A suppressed or unsubscribed address is not opted back in. The route does not create a Lead.

## Ops prerequisites before any enablement

1. Sender row for `ernest@talktosavingkc.com` on the verified `talktosavingkc.com` domain, for the nurture programs only.
2. Domain verification for `talktosavingkc.com` current in the email workspace. Do not add savingkc.com.
3. Environment: apply `supabase/migrations/20261126120000_email_newsletter_drafts.sql`, then `supabase/migrations/20261126130000_email_newsletter_segments.sql`, to the email database. Keep `EMAIL_WORKFLOW_MODE=hosted` and `EMAIL_DATABASE_URL` pointed at that database. Leave `NEWSLETTER_OWNER_APPROVED` unset. Leave dispatch and receiving workers off.
4. Owner approval before enabling: Ernest sets `NEWSLETTER_OWNER_APPROVED` to `approved` only when he wants a later change to leave draft-only. This revision still will not send.
