# Email hosted-secrets contract (for Robin)

Updated: 2026-09-13. Source: existing EM-007 / 03 §2 / Connections packet. **Wiring these secrets does not unlock live send.**

Robin is hosting the Email product secrets in parallel. This document is the exact name/format contract already in code. Do not invent a new env name. Do not set the live-dispatch flags.

## Resend API key (product path)

| Item | Contract |
| --- | --- |
| How it enters Email | Owner pastes it on Connections (`SVC-CONNECT` / `POST /api/email/connections`) |
| Format | `re_` + 12–200 URL-safe characters (`^re_[A-Za-z0-9_-]{12,200}$`) |
| Storage | AES-256-GCM, random 12-byte nonce, AAD = workspace/connection/provider/key-version |
| Hosted master key | `EMAIL_CREDENTIALS_KEY_V1` (64 hex characters). Never `NEXT_PUBLIC_`. Never stored beside ciphertext. |
| Rotation | Optional `EMAIL_CREDENTIALS_KEY_V2` (same format). Keep V1 until every stored secret is rewritten. |
| What a checked key is | Domain + receiving access check. Not sending, billing, DNS or inbound-routing readiness. |

**`RESEND_API_KEY` is not this product.** That env is used by Conversations / TC drafts / broadcasts. Email Connections does not read it. Putting a Resend key only in `RESEND_API_KEY` does not connect Email.

The local practice workspace still refuses a real key paste even if `EMAIL_CREDENTIALS_KEY_V1` is present.

## Other Email hosted secrets (existing names)

| Name | Format | Why |
| --- | --- | --- |
| `EMAIL_PREFERENCE_KEY_V1` | 64 hex | HMAC for public unsubscribe tokens / List-Unsubscribe. Optional `V2+`. |
| `EMAIL_PUBLIC_ORIGIN` | `https` origin, no trailing slash | Absolute unsubscribe URLs. |
| `EMAIL_RESEND_WEBHOOK_ENDPOINT_ID` | UUID of an `em_webhook_endpoints` row | Binds `POST /api/webhooks/email/resend`. Endpoints stay inactive until provisioned. |

Push device tests also use the existing CRM pair `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Those are not a Resend secret.

## Flags that must stay off

Even if Robin wires every secret above:

- `EMAIL_LIVE_DISPATCH_ENABLED` must stay unset / not `true`
- `EMAIL_CONTROLLED_PROVIDER_EVIDENCE` must stay unset / not `true`
- `EMAIL_AI_ENABLED` must stay unset / not `true` until Ari credits are funded

`liveDispatchBlockReason` still returns `CONTROLLED_PROVIDER_EVIDENCE_REQUIRED` when both dispatch flags are `true`. Env flags are not controlled provider evidence. Ernest release auth is still required for live customer send.

## What Robin can do now without this VM

1. Create `EMAIL_CREDENTIALS_KEY_V1` (64 hex) in hosted Email/prod env. Do not commit it.
2. Optionally create `EMAIL_PREFERENCE_KEY_V1` and set `EMAIL_PUBLIC_ORIGIN`.
3. Leave a Resend `re_…` key for an owner to paste on Connections after the master key is present — or hold the key until Ernest is ready to paste. Do not put it in `RESEND_API_KEY` and call Email connected.
4. Do not set the three flags above. Do not prod-migrate. Do not customer-send.

Code source of truth: `src/lib/email/secrets-contract.ts`, `src/lib/email/secrets.ts`, `src/lib/email/connections/service.ts`.
