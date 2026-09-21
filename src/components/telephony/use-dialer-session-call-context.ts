'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  PROSPECTING_DIALER_RESET_CALL_CONTEXT_EVENT,
  SESSION_CALL_CONTEXT_MISMATCH_MESSAGE,
  prospectingCallMatchesSession,
  queueItemCallContext,
  type SessionCallContext,
} from '@/lib/telephony/dialer-session-call-context'

type SessionStatus = 'active' | 'paused' | 'completed' | 'stopped'

type SessionSnapshot = SessionCallContext & {
  id?: string
  status?: SessionStatus
  stopRequestedAt?: string | null
}

type QueueRow = {
  leadId: string | null
  prospectId: string | null
  prospect_phone_id: string | null
  campaignMemberId: string | null
}

export function useDialerSessionCallContext({
  pendingSessionId,
  queueItem,
  cancelQueuedAutoDial,
  endQueue,
  setError,
  setWorkspaceSessionStatus,
  stopRequestedSessionIdRef,
  pausedSessionIdRef,
}: {
  pendingSessionId: string | null
  queueItem: QueueRow | null
  cancelQueuedAutoDial: () => void
  endQueue: () => void
  setError: Dispatch<SetStateAction<string | null>>
  setWorkspaceSessionStatus: Dispatch<SetStateAction<SessionStatus | null>>
  stopRequestedSessionIdRef: MutableRefObject<string | null>
  pausedSessionIdRef: MutableRefObject<string | null>
}) {
  const [sessionCallContextMismatch, setSessionCallContextMismatch] = useState(false)
  const sessionCurrentRef = useRef<SessionCallContext | null>(null)

  const captureSessionCurrent = useCallback((session: SessionCallContext | null | undefined) => {
    sessionCurrentRef.current = {
      currentSubjectKind: session?.currentSubjectKind ?? null,
      currentSubjectId: session?.currentSubjectId ?? null,
      currentCampaignMemberId: session?.currentCampaignMemberId ?? null,
    }
  }, [])

  const clearMismatchError = useCallback(() => {
    setSessionCallContextMismatch(false)
    setError((current) => current === SESSION_CALL_CONTEXT_MISMATCH_MESSAGE ? null : current)
  }, [setError])

  const clearStaleSessionCallContext = useCallback((message = SESSION_CALL_CONTEXT_MISMATCH_MESSAGE) => {
    cancelQueuedAutoDial()
    endQueue()
    setSessionCallContextMismatch(true)
    setError(message)
  }, [cancelQueuedAutoDial, endQueue, setError])

  const resetSessionCallContext = useCallback(() => {
    cancelQueuedAutoDial()
    endQueue()
    setSessionCallContextMismatch(false)
    setError(null)
    if (pendingSessionId) {
      window.dispatchEvent(new CustomEvent(PROSPECTING_DIALER_RESET_CALL_CONTEXT_EVENT, {
        detail: { sessionId: pendingSessionId },
      }))
    }
  }, [cancelQueuedAutoDial, endQueue, pendingSessionId, setError])

  const queueMatchesActiveSession = useCallback((item: QueueRow | null) => (
    !item
    || !sessionCurrentRef.current
    || prospectingCallMatchesSession(sessionCurrentRef.current, queueItemCallContext(item))
  ), [])

  const acceptIncomingSessionQueue = useCallback((item: QueueRow) => {
    if (pendingSessionId && !queueMatchesActiveSession(item)) {
      clearStaleSessionCallContext()
      return false
    }
    clearMismatchError()
    return true
  }, [clearMismatchError, clearStaleSessionCallContext, pendingSessionId, queueMatchesActiveSession])

  useEffect(() => {
    function onSessionState(event: Event) {
      const session = (event as CustomEvent).detail as SessionSnapshot | null
      if (!pendingSessionId || session?.id !== pendingSessionId || !session.status) return
      captureSessionCurrent(session)
      setWorkspaceSessionStatus(session.status)
      stopRequestedSessionIdRef.current = session.stopRequestedAt ? pendingSessionId : null
      pausedSessionIdRef.current = session.status === 'paused' ? pendingSessionId : null
      if (session.status !== 'active' || session.stopRequestedAt) cancelQueuedAutoDial()
      if (session.status === 'completed' || session.status === 'stopped') {
        endQueue()
        clearMismatchError()
        return
      }
      if (!queueMatchesActiveSession(queueItem)) clearStaleSessionCallContext()
    }
    window.addEventListener('dialer-session-state', onSessionState)
    return () => window.removeEventListener('dialer-session-state', onSessionState)
  }, [
    cancelQueuedAutoDial,
    captureSessionCurrent,
    clearMismatchError,
    clearStaleSessionCallContext,
    endQueue,
    pendingSessionId,
    pausedSessionIdRef,
    queueItem,
    queueMatchesActiveSession,
    setWorkspaceSessionStatus,
    stopRequestedSessionIdRef,
  ])

  return useMemo(() => ({
    sessionCallContextMismatch,
    setSessionCallContextMismatch,
    sessionCurrentRef,
    captureSessionCurrent,
    clearStaleSessionCallContext,
    resetSessionCallContext,
    acceptIncomingSessionQueue,
    queueMatchesActiveSession,
  }), [
    acceptIncomingSessionQueue,
    captureSessionCurrent,
    clearStaleSessionCallContext,
    queueMatchesActiveSession,
    resetSessionCallContext,
    sessionCallContextMismatch,
  ])
}
