# Provider lifecycle, fenced dispatch and preference-center continuation

Local-only continuation of build-status next implementation order #2. This increment hardens remaining EM-006/007/009/012 gaps on top of credential intake, domain setup, signed intake, reply retrieval and public unsubscribe. It does not create a Resend account, write DNS, deploy schema or send customer mail.

## What this increment connects

- Credential key versions `EMAIL_CREDENTIALS_KEY_V*` with decrypt-by-stored-version and owner-only local re-encryption. Older keys stay required until every stored secret is rewritten.
- Owner-only webhook signing-secret provision/rotate on `em_webhook_endpoints`. New endpoints stay inactive. Capture decrypts with the stored `key_version`. No Resend webhook is created.
- Historical account replacement review. A newer checked connection can be linked with `superseded_by` after an impact-hash review. Domain and provider-event `connection_id` values are never rewritten.
- Durable `dispatch` jobs with SKIP LOCKED leases. `processNextDispatch` always holds the intent. `EMAIL_LIVE_DISPATCH_ENABLED` and even a forged `send_enabled` are not controlled provider evidence. The worker never calls `resend.emails.send`.
- `OPS-RECONCILE` marks uncertain/held remote intents reconciled without resending.
- Delivery-event reducer for sent/delivered/bounced/complained/delayed. Matched facts do not pause the workspace. Bounce and complaint suppress immediately. Opens/clicks are stored as diagnostics. Unmatched delivery still quarantines and pauses until an owner `OPS-ACK`.
- Simulated outbound frozen payloads include `List-Unsubscribe` / `List-Unsubscribe-Post` when `EMAIL_PREFERENCE_KEY_V*` exists. Missing keys record `headersMissing` and do not invent a signing secret.
- After one-click unsubscribe, the public page can record a program note. That note cannot release suppression or resume sending.

## Still blocked

- A Resend API key wired into Email. A signup-only account exists at `ernest@savingkc.com`; that is not a product connection or sending proof.
- Independent sending domains and Cloudflare DNS. Owner-purchased outreach names (Cloudflare Registrar, nameservers already on Cloudflare): `talktosavingkc.com`, `savingkcteam.com`, `yourkchomebuyer.com`. Robin has landed Resend domain add + Cloudflare DNS-only records (`talktosavingkc.com` verified; the other two send-verified / Resend partial). See [ops-verify](19-outreach-dns-ops-verify.md). This increment does not invent product readiness from those writes. `savingkc.com` stays the primary business domain and is excluded from campaign senders. Sending stays off until the Email product API key, hosted secrets and release auth.
- Production preference and credential key deployment
- Controlled provider evidence that would allow live dispatch
- Hosted signed-in CRM-shell verification
- Funded Ari / AI Gateway credits (prior HTTP 403 for missing paid credits still stands)

Cash floor remains no. Do not buy more domains. This increment does not invent readiness from Robin’s landed Resend/DNS writes or treat the existing Resend signup as a product connection. The disposable harness now applies seventeen named Email migrations including `20260913180000_email_provider_lifecycle.sql`.
