# INC-2026-10-24 — Website lead alert did not reach the owner

**Status:** draft fix, not deployed  
**Lead:** `ccc0dcf5-faa8-41c1-a4b8-01bf542e4083` (contact-page form, about 10:03 AM CT)

The `website_lead_alert` text failed closed: automated SMS is disabled, and only a human 1:1 send (`sms.conversation.1to1.v1`) is allowed. That guard stays closed. This note does not add an SMS exemption.

The form callback did bridge the owner's cell over PSTN. Nothing rang in the SavingKC app because that callback never invites the Twilio Voice client.

## What ships in the draft

Internal new-lead triggers (`website_lead_alert`, `ppc_lead_alert`, and any other trigger ending in `_lead_alert`) skip SMS. They send:

- an Expo push to each scheduled alert agent, through `src/lib/mobile-push.ts`
- a browser push when VAPID is configured
- an email to `ernest@savingkc.com` or `casey@savingkc.com` through the same Resend transactional sender appointment email uses (`RESEND_FROM_EMAIL`). This is not the marketing dispatch path.

The activity row records `sms_status: skipped` and a `delivery_status` entry per channel (`mobile_push`, `web_push`, `email`). A skipped SMS is not stored as the "Automated SMS is disabled" failure.

Reply alerts (`lead_reply_alert`, `yes_reply_alert`) are unchanged and stay off. Missed-call and voicemail alerts still attempt SMS and still hit the same guard.

Phone values read from env or callback config are trimmed. The caller ID stays the configured number. A trailing newline on `TWILIO_PHONE_NUMBER` was being copied into callback metadata as `callerId` and `calledNumber`.

## Push infrastructure

Server push exists:

- `src/lib/mobile-push.ts` posts to Expo's push API.
- Devices are stored in `mobile_push_devices`.
- `POST /api/mobile/v1/devices/push-token` accepts an Expo token for a signed-in CRM user.
- Sending is fail-closed unless `MOBILE_PUSH_ENABLED=true` or `EXPO_ACCESS_TOKEN` is set. A missing device is recorded as `no_device`, not as a delivered alert.

The mobile app does not receive those pushes yet:

- `apps/mobile` does not depend on `expo-notifications`.
- It never calls the push-token route.
- It has no handler for an Expo notification payload.

Until a build registers a token and displays the payload, app push will record `not_configured` or `no_device`. Email is the channel that can arrive with the current app binary. Browser push still depends on a VAPID subscription.

The app does initialize Twilio Voice PushKit on iOS (`initializePushRegistry`). That is call ringing, not an Expo banner.

## VoIP / CallKit recommendation

Do not build this in the same change. The shape, if we do it later:

Today `startLeadFormAgentCallback` places one Twilio call per alert agent to the cell (`to` is the PSTN number, `from` is the trimmed caller ID). When the agent answers, `/api/ivr/form-lead-agent-callback` speaks the intro and dials the seller. The app rings only when Twilio invites `client:<identity>` and the Voice SDK is registered.

Company lines already do the simultaneous ring in `src/app/api/twiml-voice/route.ts`: a `<Client>` noun for Ernest beside the cell. Form callback has no client leg, which is why the bridge could connect on the cell while the app stayed silent.

Recommended later change: for each alert agent, keep the cell call and add a second `calls.create` to `client:` plus the identity from `resolveAgentTelephonyProfile` (`ernest`, `casey`). Use the same callback URL and the same `batchId`. The claim in the form-callback webhook already lets the first answer win and tells the other leg the lead was picked up. Do not drop the cell.

The mobile token route already sets `incomingAllow` and attaches `TWILIO_VOIP_PUSH_CREDENTIAL_SID` when that value is set. That credential is what lets iOS CallKit ring after the app is backgrounded. The browser token allows incoming calls but does not attach the VoIP credential, so a desktop tab rings only while it is open.

### Risks

- Replacing the cell with the app drops the lead when the phone is signed out, unregistered, or missing the VoIP credential. A CallKit screen is not proof the device will wake. Company-line code already keeps the cell until VoIP push registration is proven. Keep that rule.
- Both legs ring. The loser still gets a short call that says someone else picked up the lead.
- A mismatched identity never rings. Twilio can still accept the call request.
- The app initializes PushKit on iOS only.
- Expo alert push does not ring CallKit. They are different systems.
- The caller ID must stay the same configured number, with whitespace removed. A newline in `From` dirties the activity metadata and can fail a client leg.
- The seller leg stays behind the dialer policy after the claim. Two agent legs must not both dial the seller. The shared batch claim already stops the second leg before that dial.
- Two call legs per agent cost more until one of them answers.
