# Dialer call lifecycle

The prospecting dialer is a single-line, server-owned state machine. Twilio's
browser `Call` object controls the live media leg; it does not own campaign
position or the operator's intent to stop.

## Sources of truth

- `dialer_sessions` owns session status, queue position, caller policy, and a
  durable `stop_requested_at` command.
- `dialer_session_attempts` owns the current attempt lifecycle and required
  disposition.
- Twilio events (`ringing`, `accept`, `disconnect`, `cancel`) report media-leg
  changes. They never advance the queue by themselves.
- The browser renders server state and delivers commands to the Twilio actor.
  Browser events are delivery signals, not durable state.

## Required transitions

| Operator/provider event | Current attempt | Server result | UI result |
| --- | --- | --- | --- |
| Start call | none | authorize one attempt | dial one number |
| Hang up / disconnect | dialing or connected | awaiting disposition | open wrap-up |
| Save outcome | awaiting disposition | dispositioned | advance only if no stop is pending |
| End session | none | stopped | leave calling floor |
| End session | active or awaiting disposition | stop requested | hang up, save outcome, then stop |
| Refresh after interruption | unfinished attempt | unchanged | restore exact number and wrap-up |

## Invariants

1. At most one unfinished attempt exists per session.
2. A queue cannot advance without a saved disposition.
3. `stop_requested_at` blocks all new attempt authorization.
4. A stale advance issued after a stop request stops the session instead of
   changing queue position.
5. Hang Up ends only the current call. It never means Next Number.
6. End Session survives refresh and is idempotent.
7. Provider callbacks and server records remain authoritative if browser
   events arrive late or more than once.

Any new call control must add a state transition and tests for repeated events,
late events, failed persistence, refresh recovery, and concurrent commands.
