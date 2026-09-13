# Local #3 packet-complete report

Updated: 2026-09-13. Branch: `cursor/email-setup-productization-5176`. Base: `codex/email-foundation-20260912`.

**This is a local-software report, not packet completion and not a release.** EM-015, EM-016, EM-025, EM-026, EM-032, EM-033, EM-034 and EM-035 stay **Partial**. Required live evidence is missing, so those packets must not be marked complete.

Build-status next implementation order #3 asked for the setup wizard, AI policy/evaluations, calendar/push/response-line records and remaining inbox views. Local software for that bucket is now as far as it can go without live provider, credit, calendar, push or phone evidence.

## What local #3 now covers

- Seven-step setup (Business, Team, Connections, AI rules, Calendar, Phone, Readiness). Steps 4–6 run the real AI / calendar / phone-push forms. Finish and enable stay `PROVIDER_READINESS_UNAVAILABLE`.
- Draft-only playbooks: save, deterministic simulate (40 seed fixtures), publish only with a passing run and empty `allowedActions`. Last eval id, case drilldown and draft-vs-published action compare survive refresh.
- Practice expansions (quoted history + extra turn) and `scripts/email/evaluate-playbook.ts`. Publication still uses the original 40 seeds. Deterministic “three-run” identity is algorithm repeatability, not three billed model runs.
- Manual weekday calendar policy (`enabled=false`). Precision helpers never book a date-only or phone-only request. Automatic booking stays off without a live, fresh Google connection.
- Intended existing-number save. Ads reserved UUID rejected. `TEL-TEST` stays `RESPONSE_LINE_NOT_PROVISIONED`. No purchase, blast or dialer eligibility.
- Blocked push-test ledger. Lockscreen copy has no seller or property detail. Unscoped CRM push is not called.
- Personal allowlisted inbox views plus controller/outcome filters. Views do not change controller, campaign or Lead stage.

The local harness applies eighteen named Email migrations including `20260913190000_email_productization.sql`.

## Local verification (this increment)

- `npx vitest run src/lib/email/__tests__` — 41 files / 108 passed
- `npx tsx scripts/email/evaluate-playbook.ts` — 40 seeds + 120 expansions, 0 billed attempts, 0 failures
- `npm run test:email:workflow` — 88 passed (serial, PostgreSQL 16, `LC_ALL=C`)
- `npm run test:email:local-ui` — 8 browser stories passed
- Manual practice-app walkthrough: save → deterministic examples → case drilldown → publish → draft-only default → Readiness stays blocked. Live send was not enabled.
- Ops-verify follow-up: intended-domain ops copy with `sendingReady=false`.
- Wizard-finish follow-up: 108 unit tests, 8 browser stories (setup steps 4–6 embed the real forms; Connections lists `EMAIL_CREDENTIALS_KEY_V1`). Live send stayed off.

## Robin vs Ernest (authoritative)

| Work | Owner | Status |
| --- | --- | --- |
| Live Resend domain add + Cloudflare email DNS for `talktosavingkc.com`, `savingkcteam.com`, `yourkchomebuyer.com` | **Robin** | Landed. `talktosavingkc.com` verified; the other two send-verified / Resend partial. See [ops-verify](19-outreach-dns-ops-verify.md). This VM did not write those records. |
| Direction, payment, login, and live-send release auth | **Ernest** | Release auth is still required for live send. Login/payment only if a block appears. |
| Resend Email product API key + hosted secrets | **Robin (parallel)** | Exact names in [hosted-secrets contract](20-hosted-secrets-contract.md). Need `EMAIL_CREDENTIALS_KEY_V1` (64 hex) before an owner can paste `re_…` on Connections. Do not use `RESEND_API_KEY`. Wiring secrets does not unlock live send. |
| Funded Ari / AI Gateway credits | Product / billing | Unfunded (prior HTTP 403). AI paths stay fail-closed. |
| Google Calendar token refresh + per-agent calendars | Product / live verify | Stored CRM tokens are expired/unverified for Email. |
| VAPID + per-user push devices | Product / live verify | `NTF-TEST` records blocked rows only. |
| Existing Twilio number ownership + real `TEL-TEST` | Product / live verify | Intended save only. No purchase. |
| Hosted signed-in CRM-shell | Product / live verify | Practice app uses a fabricated test identity. |
| Prod migrate, deploy, customer send | Release auth | Not authorized. Live send stays gated. |

`savingkc.com` stays untouched.

## Packet status (do not flip to Complete)

| Packet | Local now | Still missing |
| --- | --- | --- |
| EM-015 | Durable human-reviewed drafting plus deterministic draft-only policy guards | Live Ari credits / bounded automatic replies |
| EM-016 | Deterministic runner, 40-seed publish gate, quote-stripped expansions, CLI report | Paid 3-run model evaluation |
| EM-025 | Editor, last-eval persistence, case drilldown, version-compare of allowed actions | Model-eval review UI / autonomy raise |
| EM-026 | Seven-step setup and a blocked simulation checklist | Finish/enable, brand, live provider |
| EM-032 | In-app alerts, blocked `NTF-TEST`, phone-signal and lockscreen helpers | Live push / devices |
| EM-033 | Weekday cadence, manual `SCH-POLICY`, callback-precision helpers | Google booking |
| EM-034 | `TEL-SAVE` intended; purchase/ads/test helpers fail-closed | Provision / `TEL-TEST` |
| EM-035 | Exclusive queues, controller/outcome filters, personal views | Full campaign/reporting integration |

## Honesty limits

- Do not claim Ari works. Credits are unfunded.
- Do not claim Calendar is connected or that a callback is a booked appointment.
- Do not claim sending-ready from purchased domains or from Robin’s landed DNS. Ops-verified is not product-ready.
- Do not treat a deterministic fixture pass as a paid model evaluation.
- A Lead is not an Opportunity unless a human qualifies it.

Local #3 software is finished. Remaining work is Robin’s hosted-secret wiring (fail-closed), funded Ari credits, live Calendar/push/phone verify, and Ernest release auth — not more local scaffolding.
