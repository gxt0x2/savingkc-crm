# Production Gate 1 — Mobile Voice + Recents

Staging-first Twilio contracts for SavingKC mobile (`com.savingkc.crm` / Apple `6810428559`). No secret values.

## Routes (existing mobile v1)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/mobile/v1/twilio/token` | Company identity Voice JWT. Fail-closed if `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, or TwiML app are missing. |
| `POST` | `/api/mobile/v1/twilio/call-intents` | Authorize outbound To + company CallerId. |
| `POST` | `/api/mobile/v1/twilio/hangup` | Twilio REST complete-by-SID (End fallback). Independent of `TEST_MODE` / SMS guards. Does not touch `mojo_call_queue`. |
| `GET` | `/api/mobile/v1/calls/recent` | Authenticated Recents. Includes Twilio status callbacks, mobile dispositions, and blocked attempts. |
| `POST` | `/api/mobile/v1/calls/events` | Operator hangup / disposition. `leadId` optional so unknown-number attempts still appear. |
| `POST` | `/api/twiml-voice` | Outbound `<Dial><Number>` from Client; inbound Client ring when in-app is on. |

## Env names (values stay on Vercel)

Required for outbound + hangup:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY`
- `TWILIO_API_SECRET`
- `TWILIO_AUTH_TOKEN` (webhook signatures + hangup fallback if API key pair is absent)
- `DIALER_CALL_INTENT_SECRET`
- TwiML app voice URL → `/api/twiml-voice` (resolved by existing `resolveTwimlAppSid`)

Inbound CallKit / VoIP push:

- `TWILIO_VOIP_PUSH_CREDENTIAL_SID`

Staging flags:

- `MOBILE_IN_APP_VOICE` — set `true` on staging so Casey/Ernest company numbers ring `<Client>casey|ernest</Client>`
- `MOBILE_PERSONAL_FORWARD` — defaults OFF when in-app is on; set `true` only as emergency cell-forward rollback

Company From numbers are the existing Casey/Ernest SKC inventory (`+18167277667`, `+18166088588`, …). Personal `ERNEST_PHONE` / `CASEY_PHONE` are never used as CallerId.

Do **not** invent or rotate `CRON_SECRET`. Do **not** drain `mojo_call_queue`.

## Owner actions if inbound is blocked

1. Apple Developer → Identifiers → `com.savingkc.crm` → enable **Push Notifications** + **Voice over IP** background mode (already declared in the Expo app).
2. Create an Apple **VoIP Services** certificate for `com.savingkc.crm`.
3. Twilio Console → Voice → Push Credentials → upload the VoIP cert → copy the Credential SID into `TWILIO_VOIP_PUSH_CREDENTIAL_SID` on the staging CRM preview.
4. Set `MOBILE_IN_APP_VOICE=true` on that preview. Leave `MOBILE_PERSONAL_FORWARD` unset.
5. Confirm the TwiML app Voice URL is the staging `/api/twiml-voice` (or production once promoted).
6. Rebuild TestFlight so PushKit / CallKit can register against the uploaded credential.

Until step 3 lands, outbound + hangup still work; lock-screen inbound will not. Foreground Client invites can still ring when the TwiML `<Client>` path is on.
