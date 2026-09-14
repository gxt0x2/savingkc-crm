# Service connection continuation

Bounded EM-007 setup slice: owner-only Resend credential intake through a dedicated same-origin endpoint; AES-256-GCM storage with deployment key; durable per-request validation and only masked DTOs; read-only domain and receiving capability probes. This does not prove sending permissions, authenticated inbound routing, DNS, account billing, or launch readiness. Preserve previous checked connections when a candidate fails. Each new account/key gets a separate identity; do not rewrite historical provider IDs.

UI: Connections lists checked/failed/checking records, account label as owner supplied, masked key, last check and explicit next steps. Secret input is write-only and cleared immediately on submission. No secrets in command receipts, telemetry, URLs, local storage, audit or ordinary workspace state. Disable connect without encryption configuration; local harness defaults to disabled and must never suggest a disposable database is durable storage for a real key.

Dedicated runtime authentication uses existing CRM actor resolution. Read-only probes use fixed Resend endpoints and reject redirects; timeouts and errors map to safe codes. Reserve encrypted candidate before I/O, claim once, and recheck active owner/workspace revision before saving successful result. Duplicate requests return the original candidate; interrupted validation requires a fresh explicit submission. No provider mutations or customer messages.

Verification: encryption/redaction, cross-workspace and reader denial, origin/content limits, idempotent concurrency, invalid/scoped credentials, owner removal during validation, failed replacement preservation, unchanged sending flags.

References: https://resend.com/docs/api-reference/domains/list-domains and https://resend.com/docs/api-reference/emails/list-received-emails.


Implemented disconnect uses DELETE on the dedicated endpoint with connectionId, expectedRevision, current confirmedAffectedHash, reason and idempotencyKey. The preview conservatively includes all active campaigns and queued/held messages because provider-scoped sender routing is not yet implemented. It pauses the whole workspace, clears the local ciphertext, and retains audit/history; it never deletes a remote account. The production deployment must exclude this endpoint from request-body telemetry. Current repository middleware does not record its body. Actual hosted logging verification is still part of release acceptance.
