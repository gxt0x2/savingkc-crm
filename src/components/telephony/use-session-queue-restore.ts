'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  SESSION_QUEUE_RESTORE_TIMEOUT_MS,
  sessionQueueRestorePending,
  showSessionQueueLoading,
} from './session-queue-loading'

type SessionQueueRestoreInput = {
  pendingSessionId: string | null
  pendingQueue: readonly unknown[] | null | undefined
  queueLength: number
  deviceReady: boolean
  sessionTerminal: boolean
}

export function useSessionQueueRestoreLoading(input: SessionQueueRestoreInput) {
  const [failedSessionId, setFailedSessionId] = useState<string | null>(null)
  const [timedOutSessionId, setTimedOutSessionId] = useState<string | null>(null)
  const waitStartedRef = useRef<{ sessionId: string; at: number } | null>(null)
  const restorePending = sessionQueueRestorePending({
    pendingSessionId: input.pendingSessionId,
    pendingQueue: input.pendingQueue,
    queueLength: input.queueLength,
  })
  const restoreFailed = failedSessionId === input.pendingSessionId && Boolean(input.pendingSessionId)
  const readyTimedOut = timedOutSessionId === input.pendingSessionId && Boolean(input.pendingSessionId)

  useEffect(() => {
    if (!input.pendingSessionId || !restorePending) {
      waitStartedRef.current = null
      return
    }
    const started = waitStartedRef.current?.sessionId === input.pendingSessionId
      ? waitStartedRef.current
      : { sessionId: input.pendingSessionId, at: Date.now() }
    waitStartedRef.current = started
    if (readyTimedOut || !input.deviceReady || restoreFailed || input.sessionTerminal) return
    const elapsed = Date.now() - started.at
    const remaining = Math.max(0, SESSION_QUEUE_RESTORE_TIMEOUT_MS - elapsed)
    const timer = window.setTimeout(() => setTimedOutSessionId(input.pendingSessionId), remaining)
    return () => window.clearTimeout(timer)
  }, [input.deviceReady, input.pendingSessionId, input.sessionTerminal, readyTimedOut, restoreFailed, restorePending])

  const fail = useCallback((sessionId: string | null) => {
    if (sessionId) setFailedSessionId(sessionId)
  }, [])

  return {
    loading: showSessionQueueLoading({
      restorePending,
      deviceReady: input.deviceReady,
      restoreFailed,
      sessionTerminal: input.sessionTerminal,
      readyTimedOut,
    }),
    fail,
  }
}
