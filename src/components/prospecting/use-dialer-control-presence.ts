'use client'

import { useEffect, type Dispatch, type SetStateAction } from 'react'
import {
  DialerSessionClientError,
  heartbeatDurableDialerSessionControl,
  isDialerControlLossError,
  type DialerSessionControlResult,
  type DurableDialerSession,
} from '@/lib/dialer-session-client'
import { subscribeToDialerControlTaken } from '@/lib/telephony/dialer-controller-client'
import { DIALER_CONTROL_LOSS_OPERATION_HOLD } from '@/lib/telephony/dialer-control-operation-client'

const CONTROL_HEARTBEAT_MS = 15_000

interface MutableValue<T> {
  current: T
}

interface UseDialerControlPresenceArgs {
  readOnlyPreview: boolean
  sessionId: string
  controlOwned: boolean
  controlOwnedRef: MutableValue<boolean>
  controlGenerationRef: MutableValue<number>
  controlRevisionRef: MutableValue<number>
  setHasControl: (owned: boolean) => void
  acceptVerifiedControl: (result: DialerSessionControlResult, armAutoStart?: boolean, expectedRevision?: number) => boolean
  showControlConflict: (error: DialerSessionClientError, expectedRevision?: number) => boolean
  setSessionError: Dispatch<SetStateAction<string | null>>
  applySession: (session: DurableDialerSession, armAutoStart?: boolean) => void
}

export function useDialerControlPresence({
  readOnlyPreview,
  sessionId,
  controlOwned,
  controlOwnedRef,
  controlGenerationRef,
  controlRevisionRef,
  setHasControl,
  acceptVerifiedControl,
  showControlConflict,
  setSessionError,
  applySession,
}: UseDialerControlPresenceArgs) {
  useEffect(() => {
    if (readOnlyPreview || !sessionId || !controlOwned) return
    let cancelled = false
    const verifyControl = async () => {
      const heartbeatRevision = controlRevisionRef.current
      try {
        await heartbeatDurableDialerSessionControl(sessionId)
      } catch (error) {
        if (cancelled || heartbeatRevision !== controlRevisionRef.current) return
        if (isDialerControlLossError(error)) {
          showControlConflict(error, heartbeatRevision)
          return
        }
        setSessionError(error instanceof Error ? error.message : 'Dialing control could not be verified.')
      }
    }
    const interval = window.setInterval(() => { void verifyControl() }, CONTROL_HEARTBEAT_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void verifyControl() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [controlOwned, controlRevisionRef, readOnlyPreview, sessionId, setSessionError, showControlConflict])

  useEffect(() => {
    if (readOnlyPreview || !sessionId) return
    return subscribeToDialerControlTaken(sessionId, (generation) => {
      if (generation <= controlGenerationRef.current) return
      controlGenerationRef.current = generation
      setHasControl(false)
      window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId } }))
      const heartbeatRevision = controlRevisionRef.current
      void heartbeatDurableDialerSessionControl(sessionId)
        .then((control) => { acceptVerifiedControl(control, true, heartbeatRevision) })
        .catch((error) => {
          if (heartbeatRevision !== controlRevisionRef.current) return
          if (isDialerControlLossError(error)) {
            showControlConflict(error, heartbeatRevision)
            return
          }
          setSessionError(error instanceof Error ? error.message : 'This dialing session moved to another window.')
        })
    })
  }, [acceptVerifiedControl, controlGenerationRef, controlRevisionRef, readOnlyPreview, sessionId, setHasControl, setSessionError, showControlConflict])

  useEffect(() => {
    if (readOnlyPreview || !sessionId) return
    function onControllerRotated() {
      if (!controlOwnedRef.current) return
      setHasControl(false)
      window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId } }))
      const heartbeatRevision = controlRevisionRef.current
      void heartbeatDurableDialerSessionControl(sessionId)
        .then((control) => { acceptVerifiedControl(control, true, heartbeatRevision) })
        .catch((error) => {
          if (heartbeatRevision !== controlRevisionRef.current) return
          if (isDialerControlLossError(error)) {
            showControlConflict(error, heartbeatRevision)
            return
          }
          setSessionError(error instanceof Error ? error.message : 'This dialing session is already open in another tab.')
        })
    }
    window.addEventListener('dialer-controller-rotated', onControllerRotated)
    return () => window.removeEventListener('dialer-controller-rotated', onControllerRotated)
  }, [acceptVerifiedControl, controlOwnedRef, controlRevisionRef, readOnlyPreview, sessionId, setHasControl, setSessionError, showControlConflict])

  useEffect(() => {
    if (readOnlyPreview || !sessionId) return
    function onControlLost(event: Event) {
      const detail = (event as CustomEvent).detail as {
        sessionId?: string
        reason?: string
        terminal?: boolean
        message?: string
      } | null
      const lostSessionId = detail?.sessionId
      if (lostSessionId !== sessionId || !controlOwnedRef.current) return
      setHasControl(false)
      if (detail?.terminal === true && detail.reason === DIALER_CONTROL_LOSS_OPERATION_HOLD) {
        setSessionError(detail.message || 'A CRM change lost its dialing-control hold. Reload before continuing.')
        return
      }
      const heartbeatRevision = controlRevisionRef.current
      void heartbeatDurableDialerSessionControl(sessionId)
        .then((control) => { acceptVerifiedControl(control, true, heartbeatRevision) })
        .catch((error) => {
          if (heartbeatRevision !== controlRevisionRef.current) return
          if (isDialerControlLossError(error)) {
            showControlConflict(error, heartbeatRevision)
            return
          }
          setSessionError(error instanceof Error ? error.message : 'This dialing session moved to another window.')
        })
    }
    window.addEventListener('dialer-control-lost', onControlLost)
    return () => window.removeEventListener('dialer-control-lost', onControlLost)
  }, [acceptVerifiedControl, controlOwnedRef, controlRevisionRef, readOnlyPreview, sessionId, setHasControl, setSessionError, showControlConflict])

  useEffect(() => {
    function onSessionState(event: Event) {
      const nextSession = (event as CustomEvent).detail as DurableDialerSession | null
      if (nextSession?.id === sessionId && controlOwnedRef.current) applySession(nextSession)
    }
    window.addEventListener('dialer-session-state', onSessionState)
    return () => window.removeEventListener('dialer-session-state', onSessionState)
  }, [applySession, controlOwnedRef, sessionId])
}
