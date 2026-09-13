# Setup, AI policy, calendar and remaining-view productization

Local-only continuation of build-status next implementation order #3. This increment productizes the setup wizard, draft-only AI policy/evaluations, manual calendar/phone/push records and personal inbox views on top of the provider-lifecycle work. It does not wire a Resend API key, book Google events, provision a phone line, deliver push, fund Ari credits, migrate production or send customer mail.

## What this increment connects

- Seven-step setup: Business, Team, Connections, AI rules, Calendar, Phone, Readiness. Steps 4–6 now use the same playbook, calendar and phone/push forms as More. Finish and enable stay fail-closed without live provider evidence. Hosted secret names for Robin are listed on Connections and in [hosted-secrets contract](20-hosted-secrets-contract.md).
- `SET-READINESS` `kind=simulation` records a blocked checklist on `em_readiness_runs` when the config hash matches and recipients are reserved `.test` addresses. `kind=provider` still fails `PROVIDER_READINESS_UNAVAILABLE`. The workspace `config.readiness` field is never written as `current`.
- Draft-only playbooks: `PB-SAVE` / `PB-SIMULATE` / `PB-PUBLISH`. Simulation uses the bundled 40 seed fixtures and `deterministic-guards` only. Any other `modelId` fails `MODEL_EVALUATION_UNAVAILABLE`. Publication requires a passing deterministic run and empty `allowedActions`. Practice expansions (quoted history + extra turn) and `scripts/email/evaluate-playbook.ts` stay local and unpaid. Publish still uses the original 40 seeds. The playbook editor keeps the last eval id across refresh, compares draft vs published allowed actions, and drills into saved practice cases.
- `SET-AUTOMATION` `draft_only` now requires a published playbook version with empty `allowedActions`. `bounded_auto` still fails `AUTOMATION_READINESS_REQUIRED`.
- Manual weekday callback policy via `SCH-POLICY` with `enabled=false`. `SCH-RESCHEDULE` / `SCH-CANCEL` and `enabled=true` fail `CALENDAR_NOT_CONNECTED`. Stored CRM Google tokens are not treated as a live Email connection.
- Intended email-response number via `TEL-SAVE`. Ads reserved UUID `00000000-0000-4000-8000-0000000000ad` is rejected. `TEL-TEST` fails `RESPONSE_LINE_NOT_PROVISIONED`. No number is purchased.
- `NTF-TEST` records a blocked push delivery (`PUSH_NOT_CONFIGURED` or `PUSH_DEVICE_UNVERIFIED`). It does not call the unscoped CRM push helper.
- Personal allowlisted inbox views (`INB-SAVEVIEW` / `INB-DELETEVIEW`) plus controller/outcome filters. Views are owner-scoped and never change controller, campaign or Lead stage.

The local harness applies eighteen named Email migrations including `20260913190000_email_productization.sql`.

## Still blocked

- A Resend Email product API key pasted on Connections after `EMAIL_CREDENTIALS_KEY_V1` is hosted. Signup-only account at `ernest@savingkc.com` is not a product connection. Robin is wiring hosted secrets in parallel; see [hosted-secrets contract](20-hosted-secrets-contract.md). `RESEND_API_KEY` is not this product.
- Robin’s live Resend domain add and Cloudflare email DNS for the three outreach domains — **landed**. `talktosavingkc.com` is Resend verified (send+receive). `savingkcteam.com` and `yourkchomebuyer.com` are send-verified with receive enabled and Resend still rechecking or partial. See [ops-verify snapshot](19-outreach-dns-ops-verify.md). This is not product readiness. `savingkc.com` stays untouched.
- Funded Ari / AI Gateway credits (prior HTTP 403). Deterministic examples are not a paid model evaluation. AI paths stay fail-closed.
- Verified Google Calendar refresh and per-agent calendars. Three stored CRM tokens with Calendar scope remain expired/unverified for Email.
- VAPID keys plus per-user push device registration.
- Ownership verification of an existing Twilio number and a real `TEL-TEST`. This product does not buy a number.
- Hosted signed-in CRM-shell verification.
- Production migrate, deploy or customer send. No live customer send without release auth.

Local software for build-status #3 is as far as it can go without those live dependencies. See [local #3 packet-complete report](18-local-3-packet-complete.md). Packets stay **Partial**.
