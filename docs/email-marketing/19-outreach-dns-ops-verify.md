# Outreach DNS ops-verify snapshot

Updated: 2026-09-13. Source: Robin ops update. This is **not** product readiness and does **not** unlock live send.

Robin landed Resend domain add + Cloudflare DNS-only email records for the three outreach domains. This VM did not write those records. `savingkc.com` is unchanged and stays the primary business domain.

## Domain status

| Domain | Resend | Send | Receive | Notes |
| --- | --- | --- | --- | --- |
| `talktosavingkc.com` | Verified | Enabled | Enabled | CF DNS-only records in place |
| `savingkcteam.com` | Rechecking / partial | Verified | Enabled | Apex MX added |
| `yourkchomebuyer.com` | Rechecking / partial | Verified | Enabled | Partial verify |

## Record pattern (all three)

- DKIM TXT `resend._domainkey`
- MX `send` → `feedback-smtp.us-east-1.amazonses.com` p10
- TXT `send` SPF amazonses
- TXT `_dmarc` `p=none`
- MX `@` → `inbound-smtp.us-east-1.amazonaws.com` p10

## Still required for a controlled external test

- Resend API key wired into the Email product + hosted secrets
- Funded Ari / AI Gateway credits (still unfunded; AI paths stay fail-closed)
- Ernest release auth for live send

Do not enable live customer send or production migrate from this snapshot. The local catalog in `src/lib/email/domains/intended.ts` records these ops flags with `sendingReady: false`.
