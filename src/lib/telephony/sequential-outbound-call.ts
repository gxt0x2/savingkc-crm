const PARENT_CALL_SID = /^CA[0-9a-f]{32}$/i

export function readParentCallSid(parameters: { CallSid?: unknown } | null | undefined): string | null {
  const sid = typeof parameters?.CallSid === 'string' ? parameters.CallSid.trim() : ''
  return PARENT_CALL_SID.test(sid) ? sid : null
}

/**
 * Disconnect and cancel handlers must belong to the attempt that created the
 * Call. A late event from the previous number in a multi-phone queue otherwise
 * ends the next attempt and drops its provider Call SID.
 */
export function outboundCallEventOwnsAttempt(callAttemptId: string, activeAttemptId: string | null): boolean {
  return Boolean(callAttemptId) && activeAttemptId === callAttemptId
}

export function shouldClearCallRef(activeCall: unknown, endedCall: unknown): boolean {
  return Boolean(endedCall) && activeCall === endedCall
}

export function canStartQueuedDial(input: {
  pendingAutoDial: boolean
  outcomeRequired: boolean
  status: string
  hasQueueItem: boolean
  dialNumber: string
  deviceBusy: boolean
}): boolean {
  return input.pendingAutoDial
    && !input.outcomeRequired
    && input.status === 'ready'
    && input.hasQueueItem
    && input.dialNumber.trim().length > 0
    && !input.deviceBusy
}

type CallEventSubscriber = (event: string, listener: () => void) => void

export function waitForCallToClear(
  call: { on?: CallEventSubscriber } | null,
  timeoutMs = 1500,
): Promise<void> {
  const subscribe = call?.on
  if (typeof subscribe !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    try {
      subscribe('disconnect', () => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

export async function waitForDeviceIdle(
  device: { isBusy?: boolean } | null | undefined,
  timeoutMs = 2000,
): Promise<void> {
  const started = Date.now()
  while (device?.isBusy && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

type PreviousCall = { disconnect?: () => void; on?: CallEventSubscriber }

export async function retirePreviousOutboundCall(
  callRef: { current: PreviousCall | null },
  device: { isBusy?: boolean } | null | undefined,
): Promise<void> {
  const previousCall = callRef.current
  if (previousCall) {
    previousCall.disconnect?.()
    await waitForCallToClear(previousCall)
    if (callRef.current === previousCall) callRef.current = null
  }
  await waitForDeviceIdle(device)
}

export function createParentSidPublisher(input: {
  sessionId: () => string | null
  remember: (sid: string) => void
}): (parameters: { CallSid?: unknown } | null | undefined) => void {
  let published: string | null = null
  return (parameters) => {
    const sid = readParentCallSid(parameters)
    if (!sid || !input.sessionId() || sid === published) return
    published = sid
    input.remember(sid)
  }
}

export function finishOwnedOutboundCall(input: {
  call: unknown
  attemptId: string
  activeAttemptId: string | null
  callRef: { current: unknown }
  release: () => void
}): boolean {
  const owns = outboundCallEventOwnsAttempt(input.attemptId, input.activeAttemptId)
  const clear = shouldClearCallRef(input.callRef.current, input.call)
  if (!owns && !clear) return false
  if (clear) input.callRef.current = null
  input.release()
  return owns
}

export function postDialerCallLog(body: Record<string, unknown>) {
  void fetch('/api/call-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

export type OutboundDialResult = 'connected' | 'no_answer' | 'hangup_before_ring'

/**
 * With enableRingingState, Twilio emits `ringing` once the far end is ringing
 * and `accept` once it answers. A call that ends with neither never reached
 * the seller's phone (SIP 487 / cancel before ring) — label it so it is not
 * mistaken for a real no-answer.
 */
export function classifyOutboundDialResult(input: { accepted: boolean; rang: boolean }): OutboundDialResult {
  if (input.accepted) return 'connected'
  return input.rang ? 'no_answer' : 'hangup_before_ring'
}

/**
 * disconnect / cancel / error can all report the same dead call. The first
 * one handles the end; later ones are ignored.
 */
export function createOutboundEndLatch(): () => boolean {
  let ended = false
  return () => {
    if (ended) return false
    ended = true
    return true
  }
}

export function twilioCallIsClosed(call: unknown): boolean {
  const status = (call as { status?: () => unknown } | null)?.status
  if (typeof status !== 'function') return false
  try {
    return status.call(call) === 'closed'
  } catch {
    return false
  }
}

/**
 * Hang Up pressed after Twilio already dropped the call (error, network loss)
 * fires no disconnect event, which used to skip the outcome UI. If an attempt
 * is still open and the call is closed, the disposition must still be required.
 */
export function hangupMustRequireDisposition(input: {
  call: unknown
  activeAttemptId: string | null
}): boolean {
  // A null call can mean "still connecting" (attempt authorized, connect()
  // pending) — only a call Twilio reports closed is known dead.
  if (!input.activeAttemptId || !input.call) return false
  return twilioCallIsClosed(input.call)
}
