# Revised email pilot — 2026-09-18

The pilot remains a draft. Implementation is not permission to start it.

## Included

- Visible, separate Unsubscribe link, plain-text link, and existing one-click headers; reply-remove remains available.
- Shared opt-out recognition for live and simulated replies, including polite requests and signatures. Quoted older messages do not count as new requests.
- Recipient previews using only confirmed identity and one evidenced, canonical property. Supported fields: `first_name`, `property_address`, `property_question`. Unknown tokens or ambiguous facts block personalization.
- A two-message inherited-property preset. Only confirmed heirs receive conditional family wording. Other contacts are asked whether they are the right person. No claim about tax debt, probate authority, inheritance, deadlines, or motivation is invented.
- All sequence copy is frozen at launch, including the follow-up. Later property edits do not silently change approved copy. Existing 7–10 calendar-day weekday cadence is preserved.
- Clean sender mailbox as Reply-To. Signed provider events supply the actual RFC Message-ID. Received replies must match an original message reference, expected sender, receiving connection and mailbox. Existing aliases still work.
- Unmatched replies hold outreach and are surfaced for review after bounded retries. A known sender's fresh opt-out is honored without inventing a conversation match.
- First bounce, complaint or provider suppression pauses the affected non-test campaign, cancels pending sequence sends and alerts its owner. It never restarts automatically.
- Exact campaign samples are scoped to the requested intent and configured owner inbox. Personalized samples require reviewed source facts. Accepted attempts are not sent again by a repeated request.

## Migration

Apply `20261110122000_email_reply_message_ids.sql` before the application release. It adds a provider-correlation field and unique index to send intents; immutable message history and existing row security remain unchanged.

## Verification

- Full email database suite: 126 passing before the final unthreaded-opt-out addition.
- Revised dispatch suite: 19 passing, including unthreaded opt-out and unmatched callback hold.
- Additional early-webhook/follow-up-threading regression: passed.
- Email unit suite: 122 passing. TypeScript, changed-file lint and canonical build gate pass.
- Live Resend domain configuration inspected: tracking metrics not configured; no tracking subdomain added.

## Remaining launch evidence

- The five imported candidates still require independent identity/property relationship review; a deliverable address is not proof of the contact's relationship to a property.
- Save the revised sequence in the pilot draft and review each eligible person's exact message.
- Send the corrected sample to the approved owner inbox, inspect visible link, sender, reply address and placement; confirm a reply returns to the correct thread.
- Verify the selected sender's live callback creates/links the intended Lead, assigned work item and SMS alert. Tests are not a replacement for this live proof.
- Owner approval before starting the recipient campaign. A prior spam placement remains unresolved until a fresh sample is inspected.
