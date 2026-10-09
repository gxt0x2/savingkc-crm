# Codex contract audit — 2026-10-01 (refreshed 2026-10-09)

CRM commands stay independent of Google. Google sync, Gmail send, and other
providers report their own outcome. Additive fields are allowed; removing a
field or failing a CRM write because a provider grant is missing is not.

## Calendar

A missing Google Calendar grant does not fail `executeMobileAppointmentCommand`.
The CRM appointment is saved, then calendar sync runs. Sync records
`not_configured` on the provider ledger and returns a warning. Clients read
`appointment.sync.provider` and `warning`; they do not treat a 409
`calendar_grant` as the command result.

Commit `771569bf` reversed this by throwing `calendar_grant` before the RPC and
again after a `not_configured` sync. That fail-closed grant check is removed.
Standalone-event-cannot-invent-seller, briefing citation, and voice gates from
that commit stay.

## Email send

Manual one-to-one email still uses the signed-in Gmail grant, the stored lead
address, and explicit suppression clear. There is no Resend fallback and no
admin mailbox override.

When Gmail does not confirm send (`gmail_result_ambiguous`, HTTP 504):

- `code` stays `gmail_result_ambiguous`
- `sent` is `null`
- `deliveryState` is `delivery_unknown` (additive; restored after `771569bf`)

Do not resend. Clients that already key on `code` keep working; clients that
key on `deliveryState` see the unclear-delivery contract again.

## Mobile live email — unlocked 2026-10-09

Ernest decided 2026-10-09 to keep mobile live email unlocked. Counsel mail lock
`INC-2026-09-22-001` is superseded. Live Gmail-grant sends stay available on
mobile; they are gated by the signed-in Gmail grant and the manual lead-email
consent checks, not by a blanket mail lock.

See `docs/incidents/INC-2026-09-22-001.md`.
