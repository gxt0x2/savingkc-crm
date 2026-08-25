'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const FIRST_DIAL_COUNTDOWN_SECONDS = 15

export function useDialerStartCountdown(pendingAutoDialRef: { current: boolean }) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const activeSessionRef = useRef<string | null>(null)
  const completedSessionRef = useRef<string | null>(null)
  const deadlineRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    pendingAutoDialRef.current = false
    deadlineRef.current = null
    setRemainingSeconds(null)
  }, [pendingAutoDialRef])

  const arm = useCallback((sessionId: string | null) => {
    pendingAutoDialRef.current = true
    const sessionKey = sessionId || 'legacy-session'
    if (activeSessionRef.current === sessionKey && deadlineRef.current !== null && deadlineRef.current > Date.now()) {
      setRemainingSeconds(Math.max(1, Math.ceil((deadlineRef.current - Date.now()) / 1_000)))
      return
    }
    activeSessionRef.current = sessionKey
    if (completedSessionRef.current === sessionKey) {
      deadlineRef.current = null
      setRemainingSeconds(null)
      return
    }
    deadlineRef.current = Date.now() + FIRST_DIAL_COUNTDOWN_SECONDS * 1_000
    setRemainingSeconds(FIRST_DIAL_COUNTDOWN_SECONDS)
  }, [pendingAutoDialRef])

  const finish = useCallback(() => {
    pendingAutoDialRef.current = false
    completedSessionRef.current = activeSessionRef.current
    deadlineRef.current = null
    setRemainingSeconds(null)
  }, [pendingAutoDialRef])

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds <= 0) return
    const timeout = window.setTimeout(() => {
      if (deadlineRef.current === null) return
      setRemainingSeconds(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1_000)))
    }, 1_000)
    return () => window.clearTimeout(timeout)
  }, [remainingSeconds])

  useEffect(() => {
    function onSessionCommand(event: Event) {
      const action = ((event as CustomEvent).detail as { action?: string } | null)?.action
      if (action === 'pause' || action === 'end') cancel()
    }
    window.addEventListener('prospecting-session-command', onSessionCommand)
    return () => window.removeEventListener('prospecting-session-command', onSessionCommand)
  }, [cancel])

  return { arm, cancel, finish, remainingSeconds }
}
