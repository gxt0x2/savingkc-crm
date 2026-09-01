'use client'

import { useEffect, useState, type RefObject } from 'react'

type ControlledCallStatus = 'calling' | 'on_call' | string

export function useDialerControlLoss(
  sessionId: string | null,
  cancelAutoStart: () => void,
  endQueue: () => void,
  callRef: RefObject<unknown>,
  callIntentPendingRef: RefObject<boolean>,
  status: ControlledCallStatus,
) {
  const [unavailableSessionId, setUnavailableSessionId] = useState<string | null>(null)

  useEffect(() => {
    function onControlLost(event: Event) {
      const detail = (event as CustomEvent).detail as { sessionId?: string } | string | null
      const lostSessionId = typeof detail === 'string' ? detail : detail?.sessionId
      if (!sessionId || lostSessionId !== sessionId) return

      setUnavailableSessionId(sessionId)
      cancelAutoStart()
      // Takeover is blocked during a call; a delayed event must still never
      // disconnect that call defensively.
      const callInProgress = Boolean(callRef.current)
        || callIntentPendingRef.current
        || status === 'calling'
        || status === 'on_call'
      if (!callInProgress) endQueue()
    }
    function onControlAcquired(event: Event) {
      const detail = (event as CustomEvent).detail as { sessionId?: string } | string | null
      const acquiredSessionId = typeof detail === 'string' ? detail : detail?.sessionId
      if (!sessionId || acquiredSessionId !== sessionId) return
      setUnavailableSessionId((current) => current === sessionId ? null : current)
    }
    window.addEventListener('dialer-control-lost', onControlLost)
    window.addEventListener('dialer-control-acquired', onControlAcquired)
    return () => {
      window.removeEventListener('dialer-control-lost', onControlLost)
      window.removeEventListener('dialer-control-acquired', onControlAcquired)
    }
  }, [callIntentPendingRef, callRef, cancelAutoStart, endQueue, sessionId, status])

  return Boolean(sessionId && unavailableSessionId === sessionId)
}
