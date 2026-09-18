# First email batch — unsent review packet

Status: audience selection and current production readiness still require verification. This document does not authorize sending.

## Audience

20–25 verified seller email addresses, selected from one named audience. Exclude internal/test contacts, opt-outs, invalid addresses, duplicate identities, active campaign enrollments and contacts within the recontact window. Record the actual eligibility review and exclusions before approval; do not mark unverified data as verified to reach a target count.

Use one campaign for this batch. Report its results separately from campaigns marked `is_test`; existing setup-test records are not seller conversions.

## Reviewed copy proposal

Subject: A question about your property

Hi there,

Would selling your property be something you would consider, or is keeping it the better fit right now?

Best regards,

Ari
Saving KC Homebuyers LLC
1705 Baltimore Ave
Kansas City, MO 64108

If you’d rather I not email you again, just reply “remove” and I’ll take you off the list today.

Include the working unsubscribe link supplied by the sending system. Do not duplicate the signature if the transport already appends it.

Follow-up body: “Would you prefer I leave it here?” Use the same signature and opt-out footer.

## Schedule and limits

- Target follow-up on calendar day 8; permitted range 7–10 days; weekdays only, Chicago time.
- Initial proposal: 10 recipients/day, 2/hour, 25 maximum recipients, one follow-up maximum. Actual hosted review must accept those limits before launch.
- Any reply stops the drip. A clear, confirmed callback request creates/links one Lead and callback task, assigns the configured owner and queues the owner SMS. Missing a requested time is allowed.
- Phone-only, conditional, third-party, negative, conflicting, suppressed, automatic and test replies are excluded from automatic conversion and remain available for review as appropriate.
- Lead and Opportunity remain separate; automatic callback routing never qualifies an Opportunity.

## Before enabling the campaign

Verify the signed-in readiness screen, sender/domain, recipient verification and suppressions, owner/backup SMS numbers, receiving and sending workers, SMS alerts, pause control, and reply/remove handling. Verify the deployed automatic callback path with an explicitly approved controlled recipient before exposing real seller replies to it.

Present the exact recipient count/list, exclusions, sender, two messages, schedule and owner/backup to Ernest. Keep sending off until approval of that concrete batch.

## Pilot results

Track sent, delivered, bounced, unsubscribed, human replies, new or linked Leads, routing holds, SMS failures, and overdue callbacks for this campaign only. Pause and investigate an incorrect handoff, unexplained duplicate, missed opt-out or failed reply ingestion before expanding.
