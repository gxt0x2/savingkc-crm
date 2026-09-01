'use client'

import { useCallback, useEffect } from 'react'

import {
  requestPauseDurableDialerSession,
  type DialerPauseRequest,
  type DurableDialerSession,
} from '@/lib/dialer-session-client'

export type DialerPauseRequestedDetail = DialerPauseRequest & {
  leaveAfterPause: boolean
}

export function dispatchDialerPauseRequested(result: DialerPauseRequest, leaveAfterPause: boolean) {
  window.dispatchEvent(new CustomEvent<DialerPauseRequestedDetail>('dialer-session-pause-requested', {
    detail: { ...result, leaveAfterPause },
  }))
}

type UseDialerPauseAndLeaveInput = {
  session: DurableDialerSession | null
  sessionId: string
  applySession: (session: DurableDialerSession) => void
  navigateAway: () => void
  setPending: (pending: boolean) => void
  setError: (error: string | null) => void
}
export function useDialerPauseAndLeave({
  session,
  sessionId,
  applySession,
  navigateAway,
  setPending,
  setError,
}: UseDialerPauseAndLeaveInput) {
  const pauseAndLeave = useCallback(async () => {
    if (!sessionId || session?.status !== 'active') {
      navigateAway()
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await requestPauseDurableDialerSession(sessionId, 'Agent paused the calling session')
      applySession(result.session)
      dispatchDialerPauseRequested(result, true)
      if (result.requiresDisposition) {
        setError('Session paused. Save the current call outcome to leave without dialing another number.')
        return
      }
      navigateAway()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not pause the dialer session.')
    } finally {
      setPending(false)
    }
  }, [applySession, navigateAway, session?.status, sessionId, setError, setPending])

  useEffect(() => {
    function onPauseCompleted(event: Event) {
      const detail = (event as CustomEvent).detail as { sessionId?: string; leaveAfterPause?: boolean } | null
      if (detail?.sessionId === sessionId && detail.leaveAfterPause === true) navigateAway()
    }
    window.addEventListener('dialer-session-pause-completed', onPauseCompleted)
    return () => window.removeEventListener('dialer-session-pause-completed', onPauseCompleted)
  }, [navigateAway, sessionId])

  return pauseAndLeave
}
