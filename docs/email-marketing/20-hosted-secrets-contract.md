# Email hosted-secrets contract (for Robin)

Updated: 2026-09-13. Source: existing EM-007 / 03 §2 / Connections packet. **Wiring these secrets does not unlock live send.**

Robin is hosting the Email product secrets in parallel. This document is the exact name/format contract already in code. Do not invent a new env name. Do not set the live-dispatch flags. Do not create the Resend webhook until hosted Email routes deploy under release auth.

## Hosted presence (ops, present-but-not-live)

Ops reports these **names** as set on project `savingkc-crm`. This is not a live Email connection and does not unlock send. No Email-route deploy under release auth.

| Name | Project / envs | Product | Live for Email? |
| --- | --- | --- | --- |
| `EMAIL_CREDENTIALS_KEY_V1` | savingkc-crm · Prod / Preview (encrypted) | Email master key | **No.** Present in hosted env; not serving Email routes. |
| `RESEND_API_KEY` | savingkc-crm · Prod / Preview / Dev (encrypted) | Conversations / TC / broadcasts | **No.** Email Connections does not read it. |
| Webhook signing secret | not created | Email intake | **No.** Wait for `POST /api/webhooks/email/resend` after Email routes deploy. |

A later CRM/Conversations redeploy can apply env names without making Email foundation routes live. Treat hosted presence as `present-not-live` until those routes deploy under release auth.

## Resend API key (product path)

| Item | Contract |
| --- | --- |
| Off-chat key name | `SavingKC Email CRM` (exists; Robin is wiring it into product/hosted secrets) |
| How it enters Email | Owner pastes it on Connections (`SVC-CONNECT` / `POST /api/email/connections`) |
| Format | `re_` + 12–200 URL-safe characters (`^re_[A-Za-z0-9_-]{12,200}$`) |
| Storage | AES-256-GCM, random 12-byte nonce, AAD = workspace/connection/provider/key-version |
| Hosted master key | `EMAIL_CREDENTIALS_KEY_V1` (64 hex characters). Never `NEXT_PUBLIC_`. Never stored beside ciphertext. |
| Rotation | Optional `EMAIL_CREDENTIALS_KEY_V2` (same format). Keep V1 until every stored secret is rewritten. |
| What a checked key is | Domain + receiving access check. Not sending, billing, DNS or inbound-routing readiness. |

**`RESEND_API_KEY` is not this product.** That env is used by Conversations / TC drafts / broadcasts. It is now set encrypted on savingkc-crm Prod/Preview/Dev. Email Connections does not read it. Putting a Resend key only in `RESEND_API_KEY` does not connect Email.

The local practice workspace still refuses a real key paste even if `EMAIL_CREDENTIALS_KEY_V1` is present. A named key that exists off-chat is not a live Email connection.

## Other Email hosted secrets (existing names)

| Name | Format | Why |
| --- | --- | --- |
| `EMAIL_PREFERENCE_KEY_V*` | 64 hex (`V1` now; optional `V2+` same format) | HMAC for public unsubscribe tokens / List-Unsubscribe. |
| `EMAIL_PUBLIC_ORIGIN` | `https` origin, no trailing slash | Absolute unsubscribe URLs. |
| `EMAIL_RESEND_WEBHOOK_ENDPOINT_ID` | UUID of an `em_webhook_endpoints` row | Binds `POST /api/webhooks/email/resend`. Endpoints stay inactive until provisioned. |

Push device tests also use the existing CRM pair `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Those are not a Resend secret.

## Webhook (not created yet)

| Item | Contract |
| --- | --- |
| Method + path | `POST /api/webhooks/email/resend` |
| Public URL after hosted Email routes deploy | `https://<host>/api/webhooks/email/resend` |
| Signing secret format | `^whsec_[A-Za-z0-9+/=_-]{16,200}$` |
| Secret created? | **No.** Do not create it until Email routes are live under release auth. |
| Route without binding | Fails closed `WEBHOOK_NOT_CONFIGURED` (needs endpoint UUID + decrypt key + active checked connection). |

Release-gated. This VM does not create the Resend webhook.

## Flags that must stay off

Even if Robin wires every secret above:

- `EMAIL_LIVE_DISPATCH_ENABLED` must stay unset / not `true`
- `EMAIL_CONTROLLED_PROVIDER_EVIDENCE` must stay unset / not `true`
- `EMAIL_AI_ENABLED` must stay unset / not `true` until a funded Ari path is verified

`liveDispatchBlockReason` still returns `CONTROLLED_PROVIDER_EVIDENCE_REQUIRED` when both dispatch flags are `true`. Env flags are not controlled provider evidence. Ernest release auth is still required for live customer send.

## What Robin can do now without this VM

1. `EMAIL_CREDENTIALS_KEY_V1` is already set on Prod/Preview. Leave it. Do not commit it. It is not live until Email routes deploy.
2. Optionally create `EMAIL_PREFERENCE_KEY_V1` and set `EMAIL_PUBLIC_ORIGIN`.
3. Hold `SavingKC Email CRM` for an owner to paste on Connections after Email routes can read the master key. Do not treat `RESEND_API_KEY` as Email connected.
4. After hosted Email routes deploy under release auth, create the webhook against `https://<host>/api/webhooks/email/resend`. Not before.
5. Do not set the three flags above. Do not prod-migrate. Do not customer-send. Redeploy of Conversations/CRM is Robin’s ops lane and still does not unlock live send.

Code source of truth: `src/lib/email/secrets-contract.ts`, `src/lib/email/secrets.ts`, `src/lib/email/connections/service.ts`, `src/app/api/webhooks/email/resend/route.ts`.
