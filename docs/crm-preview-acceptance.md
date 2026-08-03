# CRM Operating Model Preview Acceptance

## Environment boundary

The preview is safe to publish only when all of the following are true:

- It is a Vercel Preview deployment, never the production alias.
- `TEST_MODE=true` is configured for Preview.
- Preview points to a staging Supabase project with the current schema.
- No production service-role key is present in Preview.
- Production Twilio, Resend, Google Ads, Gmail, Mojo, push, webhook, and worker credentials are absent.
- A dedicated test user can authenticate and the preview URL is allowlisted by Supabase Auth.

The application also fails closed when `VERCEL_ENV=preview`: guarded SMS/email
transport, lead-form notifications and callbacks, push side effects, and PPC
conversion enqueueing are suppressed.

Preview API mutations are blocked by default. Set `PREVIEW_ALLOW_WRITES=true`
only after Preview points to an isolated staging Supabase project.

## Required scenarios

| Scenario | Expected operating result |
| --- | --- |
| New seller form | One lead, one seller-intake workflow run, owner `Acquisitions`, `Needs reply`, and one primary call action due in five minutes |
| Duplicate form retry | Existing workflow run reused; no duplicate primary action |
| Missing SMS consent | Acknowledgement records `consent_missing`; no seller SMS |
| Agent claims lead | Named agent overrides team ownership in the Hub |
| Seller sends inbound SMS | Thread moves to `Needs reply` and sorts above waiting/resolved threads |
| Agent sends reply | Thread moves to `Waiting on contact` without sending externally in Preview |
| Primary action completed | Task status becomes `completed` and disappears from the active action banner |
| Overdue first call | Action remains visible with an overdue treatment |
| Unmatched inbound call | Virtual thread remains visible as `Needs reply` without inventing a contact |

## Visual review

- Desktop and mobile navigation
- Brand colors, logo, typography, spacing, and accessible contrast
- Thread ordering and search
- Attention, owner, and overdue badges
- Primary-action completion
- Conversation reply composer
- Contact profile link
- Empty, loading, error, and no-message states

## Release boundary

Preview approval does not authorize production deployment. Production requires a
separate data-compatibility review, rollback point, protected health gates,
production smoke test, and monitored activation.
