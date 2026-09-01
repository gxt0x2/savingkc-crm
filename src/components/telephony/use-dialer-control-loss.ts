'use client'

import { useEffect, useState, type RefObject } from 'react'

type DisconnectableCall = { disconnect: () => void }
const controlLossRevisions = new Map<string, number>()

export function dialerControlLossRevision(sessionId: string | null): number {
  return sessionId ? controlLossRevisions.get(sessionId) || 0 : 0
}

export function dialerControlChanged(sessionId: string | null, revision: number): boolean {
  return dialerControlLossRevision(sessionId) !== revision
}

export function useDialerControlLoss(
  sessionId: string | null,
  cancelAutoStart: () => void,
  endQueue: () => void,
  callRef: RefObject<DisconnectableCall | null>,
  callIntentPendingRef: RefObject<boolean>,
) {
  const [unavailableSessionId, setUnavailableSessionId] = useState<string | null>(null)

  useEffect(() => {
    function onControlLost(event: Event) {
      const detail = (event as CustomEvent).detail as { sessionId?: string } | string | null
      const lostSessionId = typeof detail === 'string' ? detail : detail?.sessionId
      if (!sessionId || lostSessionId !== sessionId) return

      setUnavailableSessionId(sessionId)
      controlLossRevisions.set(sessionId, dialerControlLossRevision(sessionId) + 1)
      cancelAutoStart()
      // A confirmed takeover is an emergency stop for this displaced browser.
      // Disconnect its SDK leg immediately; the server also ends the correlated
      // provider call when Twilio has already supplied a call SID.
      const activeCall = callRef.current
      callRef.current = null
      activeCall?.disconnect()
      callIntentPendingRef.current = false
      endQueue()
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
  }, [callIntentPendingRef, callRef, cancelAutoStart, endQueue, sessionId])

  return Boolean(sessionId && unavailableSessionId === sessionId)
}
