# Outreach DNS ops-verify snapshot

Updated: 2026-09-13. Source: Robin ops update. This is **not** product readiness and does **not** unlock live send.

Robin landed Resend domain add + Cloudflare DNS-only email records for the three outreach domains. This VM did not write those records. `savingkc.com` is unchanged and stays the primary business domain.

## Domain status

| Domain | Resend | Send | Receive | Notes |
| --- | --- | --- | --- | --- |
| `talktosavingkc.com` | Verified | Verified | Verified | CF DNS-only records in place |
| `yourkchomebuyer.com` | Verified | Verified | Verified | Send + receive verified |
| `savingkcteam.com` | Send verified | Verified | Pending | Receive still pending |

## Record pattern (all three)

- DKIM TXT `resend._domainkey`
- MX `send` → `feedback-smtp.us-east-1.amazonses.com` p10
- TXT `send` SPF amazonses
- TXT `_dmarc` `p=none`
- MX `@` → `inbound-smtp.us-east-1.amazonaws.com` p10

## Still required for a controlled external test

- Resend API key `SavingKC Email CRM` pasted on Connections after hosted Email routes can read `EMAIL_CREDENTIALS_KEY_V1` (master key is present-but-not-live on Prod/Preview; not a live Email connection)
- Webhook secret for `POST /api/webhooks/email/resend` — **not created**. Needs public `https://<host>/api/webhooks/email/resend` after hosted Email routes deploy (release-gated)
- Funded / retested Ari path (prior HTTP 403 not treated as success)
- Ernest release auth for live send

Do not enable live customer send or production migrate from this snapshot. The local catalog in `src/lib/email/domains/intended.ts` records these ops flags with `sendingReady: false`. See [hosted-secrets contract](20-hosted-secrets-contract.md).
