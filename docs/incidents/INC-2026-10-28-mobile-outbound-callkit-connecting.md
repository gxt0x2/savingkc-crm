# INC-2026-10-28 — Mobile outbound CallKit stays on connecting

**Status:** findings only. No TwiML, status-callback, or hangup change.  
**Attempt:** `6caed03d-845a-4e63-bf2b-4762dae36488`  
**When:** 2026-10-28 15:08:24Z (10:08 CT)  
**Lead:** `f6ee3b04-9c0e-413b-8cd4-ccc603e41a6b` (Howard Snitkoff)

Ernest placed a SavingKC iOS outbound call. Native CallKit stayed on “Saving KC Audio connecting…” with the contact name Howard Snitkoff. He heard no ring. Twilio still dialed the PSTN child, reached voicemail, and recorded the greeting.

## What Twilio and the CRM actually did

| Fact | Value |
| --- | --- |
| Source | `mobile_lead` |
| Identity | `ernest` (`client:ernest`) |
| Caller ID | `+18166088588` |
| Parent (Client) | `CA9259d7e252f4e5f805c617facb27db02` |
| Child (PSTN) | `CAcc41df2165bcceaa7d80ca0e03d08f87` |
| Child status | `completed`, duration 8, no error code |
| Recording | `REac4e381fd36523f17fbde53b89d24bb2` on the **parent** SID, 8s, transcript “Please leave your message for…” |
| Ledger | `mobile_voice_attempts.last_status = completed`, `end_requested_at` null |
| App row | `savingkc_mobile` “Mobile outbound call ended: no_answer”, duration 0, same `clientCallId` |

The child status row and the recording row are about 5 seconds apart (15:09:04Z and 15:09:08Z). The app disposition row is 15:09:09Z. The PSTN leg was not canceled. The attempt was created at 15:08:24Z, so the child lived about 40 seconds: roughly the ring, then 8 seconds of voicemail. That matches the mobile dial timeout of 45 seconds (`dialTimeoutFallbackForSource('mobile_lead')`).

The same `<Dial>` shape is what the web click-to-call client uses. Web calls to this lead on Oct 19 and Oct 27 recorded the agent speaking over the same style of voicemail greeting. The bridge itself is not mobile-only.

## TwiML the parent Client received

`POST /api/twiml-voice` treats `From: client:…` as outbound. A signed `mobile_lead` intent returns exactly one `<Dial>` and one `<Number>`:

```xml
<Dial callerId="{approved caller id}" timeout="45" answerOnBridge="true" ringTone="us"
      record="record-from-answer-dual" recordingStatusCallback="…" recordingStatusCallbackMethod="POST">
  <Number statusCallback="/api/twilio-call-status?identity=ernest&amp;clientAttemptId={attempt}&amp;source=mobile_lead"
          statusCallbackEvent="initiated ringing answered completed"
          statusCallbackMethod="POST">{E.164}</Number>
</Dial>
```

`answerOnBridge="true"` and `ringTone="us"` have been on this verb since `1197097d` (2026-09-11). `source=mobile_lead` has been on the child status callback since `a514e813` (2026-10-08). Both were live for this attempt.

There is no parent-leg status callback. Twilio delivers parent Client progress to the Voice SDK. The CRM callback is the PSTN child only. Non-terminal child states (`initiated`, `ringing`, `answered`) update the dialer attempt and the mobile ledger, then return `skipped: non_terminal`. The terminal child row is the `completed` activity above. That split is why the CRM can show a completed 8-second call while the phone UI is still on connecting.

`answerOnBridge="true"` is what keeps the parent unanswered until the child answers:

- Twilio does not send the parent a final answer until the PSTN leg is answered (here, voicemail).
- `ringTone="us"` is the early-media ringback Twilio offers the caller during that wait. It does not answer the parent.
- The iOS SDK’s `callDidConnect` is defined to fire only once the callee answers when this flag is true, and only after ICE is connected and DTLS has finished. Until then the SDK stays in connecting/ringing.
- Outgoing CallKit has no “ringing” label. It shows “{provider} connecting…” until the SDK calls `reportOutgoingCall(connectedAt:)`.

## Why the phone stayed on connecting and stayed silent

The installed client is `savingkc-mobile-crm` on `codex/mobile-live-integration`, using `@twilio/voice-react-native-sdk` `^2.0.0-preview.2`. That SDK’s CallKit delegate (`ios/TwilioVoiceReactNative+CallKit.m` in the 2.0.0-preview.2 tag) does this on an outbound start:

1. `twilioAudioDevice.enabled = NO` and `block()`.
2. `reportOutgoingCall startedConnectingAt` — CallKit paints “connecting…”.
3. `TwilioVoiceSDK connectWithOptions`. The completion that would call `reportOutgoingCall connectedAt` is stored and is **not** invoked here.
4. `CXStartCallAction` is fulfilled while the call is still unanswered.

`connectedAt` is reported only from `callDidConnect`, which then runs that stored completion. `didActivateAudioSession` is what sets `twilioAudioDevice.enabled = YES`. Apple invokes `didActivate` after the outgoing call is reported connected. So the audio unit stays blocked for the whole `answerOnBridge` wait.

Two ringback paths are both silent in that window:

- Server `ringTone="us"` is early media. The SDK cannot play it while the audio device is blocked.
- The SDK’s own `playRingback` (`ringtone.wav`, bundled by mobile PR #71) runs from `callDidStartRinging`, but it is an `AVAudioPlayer` against a CallKit session that is not activated yet.
- The app’s expo-audio fallback is intentionally off on iOS and Android (`shouldPlayOutboundRingback` returns false when `nativeVoiceSession` is set) so it does not steal the CallKit session.

The web dialer does not have this gate. It connects with `enableRingingState: true` and plays `/api/audio/us-ringback.wav` locally when the ringing event has no early media (`src/lib/telephony/call-ringback.ts`). That is why the same TwiML is audible on the web and silent on this CallKit client.

The JS connect timeout does not explain this attempt. `OUTBOUND_CONNECT_TIMEOUT_MS` is 20 seconds and only fires while the JS state is still `connecting`. `Call.Event.Ringing` moves that state to `ringing`, which cancels the timeout. This call survived ~40 seconds and the child completed on its own (`end_requested_at` is null). The phone was in the SDK ringing window, which CallKit still renders as connecting, until voicemail finished.

## The app’s “duration 0 / no_answer” row is not the Twilio result

`app/call/[id].tsx` on the live mobile branch increments the on-screen timer only while `voice.state` is `connected` or `reconnecting`. On Log the outcome it posts:

```ts
durationSeconds: outcome === 'answered' ? seconds : 0
```

“No answer” is a button on that sheet, not a value the CRM invents from the child status callback. Tapping it always stores duration 0, even if the SDK had been connected. The 15:09:09Z activity is that post (`source: savingkc_mobile`, `outcome: no_answer`, `disposition: no_answer`). It does not prove the parent never reached `callDidConnect` after voicemail answered. It does prove the owner logged the call as unanswered, which matches hearing nothing and watching CallKit stay on connecting.

## What was not changed, and why

No server attribute will make outgoing CallKit display “ringing”, and none will enable the Twilio audio device. That device flips on only after the SDK reports CallKit connected.

Turning `answerOnBridge` off for `mobile_lead` would answer the parent as soon as TwiML returns. The SDK would emit `callDidConnect` immediately after ringing, CallKit would leave connecting, and in-band audio could start while the PSTN leg was still ringing. That is the opposite of keeping the client leg in sync with the child. The child status callback would stay accurate, but the client would look answered before the callee answered. The web dialer shares this verb and depends on `answerOnBridge="true"` for `enableRingingState`. A mobile-only fork of the verb would be a speculative client workaround, not a fix for a wrong webhook.

Hangup scoping from CRM #746 is already doing the job this attempt needed. `end_requested_at` was null, so nothing issued a hangup. Status callbacks carry `source=mobile_lead` and the attempt id. `hangupMobileVoiceAttempt` only ends a parent SID stored on `mobile_voice_attempts` for that identity and attempt. A web dialer call on identity `ernest` has no row there. This incident does not change that path.

## Retest (sandbox only)

Dial **+1 913-717-9716** only. That number is the internal test phone for Ernest Dodson (`savingkc@gmail.com`). Do not dial a seller number, including the lead on this incident.

1. Sign the current TestFlight/dev build in as Ernest. Leave a web dialer session for identity `ernest` idle in a browser if you want to prove hangup scope.
2. From the app, call the sandbox number (lead or manual). Note `clientAttemptId`.
3. While the sandbox phone is ringing, the native CallKit screen is expected to stay on connecting and to stay silent. That is this bug. Do not treat a silent connecting screen as “the dial did not leave the server.”
4. Answer the sandbox phone. Confirm whether CallKit then shows a timer and whether both sides hear each other. If it stays on connecting with no audio after answer, the client still has not reported `connectedAt` / enabled the audio device. Capture the parent and child Call SIDs.
5. Hang up from the app. Confirm the web dialer call, if one was up, is still up. Confirm `mobile_voice_attempts.end_requested_at` is set only when End was tapped, and that the child status callback still says `source=mobile_lead` with this attempt id.
6. Read the app’s saved duration only when the tapped outcome is Answered. No answer, voicemail, and DNC are stored as duration 0 on purpose.

The client change that matches this trace is in the iOS CallKit integration, not in `/api/twiml-voice`: report the outgoing CallKit call connected early enough for `didActivateAudioSession` to enable the audio device, play ringback between SDK ringing and SDK connected, and keep using `callDidStartRinging` / `callDidConnect` for the in-app state so it still tracks the PSTN leg.
