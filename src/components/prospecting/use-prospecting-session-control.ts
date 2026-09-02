'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import {
  DialerSessionClientError,
  heartbeatDurableDialerSessionControl,
  isDialerControlLossError,
  loadDialerAttemptHistory,
  loadDurableDialerSession,
  requestPauseDurableDialerSession,
  takeOverDurableDialerSession,
  transitionDurableDialerAttempt,
  transitionDurableDialerSession,
  type DialerPauseRequest,
  type DialerSessionControlResult,
  type DialerSessionControlSummary,
  type DurableDialerQueueSubject,
  type DurableDialerSession,
} from '@/lib/dialer-session-client'
import {
  newDialerControlRequestId,
  publishDialerControlTaken,
} from '@/lib/telephony/dialer-controller-client'
import { useDialerControlPresence } from '@/components/prospecting/use-dialer-control-presence'

interface ResumeAttemptSnapshot {
  sessionId: string | null
  subjectKey: string | null
  autoStartEpoch: number | null
  completedPhoneIds: string[]
  completedPhones: string[]
  unadvancedAttemptId: string | null
}

interface UseProspectingSessionControlArgs {
  readOnlyPreview: boolean
  sessionId: string
  currentSubject: DurableDialerQueueSubject | null
  currentSubjectKey: string | null
  autoQueueSubjectKey: string | null
  onApplySession: (session: DurableDialerSession, armAutoStart: boolean) => void
  onControlLost: () => void
}

function controllerGeneration(control: Record<string, unknown> | null | undefined): number {
  const generation = Number(control?.generation)
  return Number.isInteger(generation) && generation >= 0 ? generation : 0
}

function emptyResumeSnapshot(sessionId: string | null, subjectKey: string | null, autoStartEpoch: number): ResumeAttemptSnapshot {
  return {
    sessionId,
    subjectKey,
    autoStartEpoch,
    completedPhoneIds: [],
    completedPhones: [],
    unadvancedAttemptId: null,
  }
}

export function useProspectingSessionControl({
  readOnlyPreview,
  sessionId,
  currentSubject,
  currentSubjectKey,
  autoQueueSubjectKey,
  onApplySession,
  onControlLost,
}: UseProspectingSessionControlArgs) {
  const initiallyOwned = readOnlyPreview || !sessionId
  const [session, setSession] = useState<DurableDialerSession | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [controlOwned, setControlOwned] = useState(initiallyOwned)
  const [autoStartEpoch, setAutoStartEpoch] = useState(0)
  const [controlSummary, setControlSummary] = useState<DialerSessionControlSummary | null>(null)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)
  const [loadedResumeAttempts, setLoadedResumeAttempts] = useState<ResumeAttemptSnapshot>(
    emptyResumeSnapshot(null, null, 0),
  )
  const controlOwnedRef = useRef(initiallyOwned)
  const controlGenerationRef = useRef(0)
  const controlRevisionRef = useRef(0)

  const setHasControl = useCallback((owned: boolean) => {
    const previouslyOwned = controlOwnedRef.current
    controlRevisionRef.current += 1
    controlOwnedRef.current = owned
    setControlOwned(owned)
    if (owned && !previouslyOwned) setAutoStartEpoch((current) => current + 1)
    if (!owned) onControlLost()
  }, [onControlLost])

  const applySession = useCallback((nextSession: DurableDialerSession, armAutoStart = true) => {
    setSession(nextSession)
    onApplySession(
      nextSession,
      armAutoStart
        && controlOwnedRef.current
        && nextSession.status === 'active'
        && !nextSession.stopRequestedAt,
    )
  }, [onApplySession])

  const markUserActivity = useCallback((at: Date) => {
    const lastInteractionAt = at.toISOString()
    const idleExpiresAt = new Date(at.getTime() + 5 * 60 * 1_000).toISOString()
    setSession((current) => {
      if (!current || at.getTime() - Date.parse(current.lastInteractionAt) < 1_000) return current
      return { ...current, lastInteractionAt, idleExpiresAt }
    })
  }, [])

  const clearSession = useCallback(() => { setSession(null) }, [])

  const acceptVerifiedControl = useCallback((result: DialerSessionControlResult, armAutoStart = true, expectedRevision?: number) => {
    if (expectedRevision !== undefined && expectedRevision !== controlRevisionRef.current) return false
    const generation = controllerGeneration(result.control)
    if (generation < controlGenerationRef.current) return false
    controlGenerationRef.current = generation
    if (result.control.operationActive === true) {
      setHasControl(false)
      setControlSummary(null)
      setControlError(null)
      setSessionError(`A CRM change${typeof result.control.operationLabel === 'string' ? ` (${result.control.operationLabel})` : ''} is still finishing. Reload after it completes before dialing.`)
      applySession(result.session, false)
      return false
    }
    setHasControl(true)
    setControlSummary(null)
    setControlError(null)
    setSessionError(null)
    applySession(result.session, armAutoStart)
    window.dispatchEvent(new CustomEvent('dialer-control-acquired', { detail: { sessionId: result.session.id } }))
    return true
  }, [applySession, setHasControl])

  const showControlConflict = useCallback((error: DialerSessionClientError, expectedRevision?: number) => {
    if (expectedRevision !== undefined && expectedRevision !== controlRevisionRef.current) return false
    setHasControl(false)
    window.dispatchEvent(new CustomEvent('dialer-control-lost', { detail: { sessionId } }))
    if (error.details) {
      controlGenerationRef.current = Math.max(controlGenerationRef.current, error.details.generation)
      setControlSummary(error.details)
    }
    setControlError(error.code === 'session_control_conflict' || error.code === 'session_control_lost'
      ? null
      : error.message)
    return true
  }, [sessionId, setHasControl])

  const initializeSession = useCallback(async () => {
    setHasControl(false)
    setControlSummary(null)
    setControlError(null)
    const loadedSession = await loadDurableDialerSession(sessionId)
    applySession(loadedSession, false)
    if (['completed', 'stopped'].includes(loadedSession.status)) return loadedSession
    const autoStartKey = `savingkc:dialer-autostart:${loadedSession.id}`
    if (window.sessionStorage.getItem(autoStartKey) === '1') window.sessionStorage.removeItem(autoStartKey)
    const heartbeatRevision = controlRevisionRef.current
    try {
      const control = await heartbeatDurableDialerSessionControl(sessionId)
      acceptVerifiedControl(control, true, heartbeatRevision)
    } catch (error) {
      if (isDialerControlLossError(error)) {
        showControlConflict(error, heartbeatRevision)
      } else {
        throw error
      }
    }
    return loadedSession
  }, [acceptVerifiedControl, applySession, sessionId, setHasControl, showControlConflict])

  useEffect(() => {
    if (!sessionId || !currentSubject || !currentSubjectKey) return
    let cancelled = false
    void loadDialerAttemptHistory(sessionId)
      .then(({ attempts }) => {
        if (cancelled) return
        const completedAttempts = attempts.items.filter((attempt) => (
          attempt.subject_kind === currentSubject.kind
          && attempt.subject_id === currentSubject.id
          && attempt.status === 'dispositioned'
        ))
        const completedPhoneIds = completedAttempts.flatMap((attempt) => (
          attempt.prospect_phone_id ? [attempt.prospect_phone_id] : []
        ))
        const completedPhones = completedAttempts.flatMap((attempt) => {
          const normalized = normalizePhoneToE164(attempt.phone)
          return normalized ? [normalized] : []
        })
        setLoadedResumeAttempts({
          sessionId,
          subjectKey: currentSubjectKey,
          autoStartEpoch,
          completedPhoneIds: Array.from(new Set(completedPhoneIds)),
          completedPhones: Array.from(new Set(completedPhones)),
          unadvancedAttemptId: completedAttempts.find((attempt) => !attempt.advanced_at)?.client_attempt_id || null,
        })
      })
      .catch((error) => {
        if (!cancelled) setSessionError(error instanceof Error ? error.message : 'Could not restore the saved phone position.')
      })
    return () => { cancelled = true }
  }, [autoStartEpoch, currentSubject, currentSubjectKey, sessionId])

  useDialerControlPresence({
    readOnlyPreview,
    sessionId,
    idleExpiresAt: session?.idleExpiresAt || null,
    controlOwned,
    controlOwnedRef,
    controlGenerationRef,
    controlRevisionRef,
    setHasControl,
    acceptVerifiedControl,
    showControlConflict,
    setSessionError,
    applySession,
    onUserActivity: markUserActivity,
  })

  const transitionSession = useCallback(async (
    action: 'pause' | 'resume' | 'request_stop' | 'stop' | 'skip',
    reason?: string,
  ) => {
    if (!sessionId || !controlOwnedRef.current) return null
    const operationRevision = controlRevisionRef.current
    setActionPending(true)
    setSessionError(null)
    try {
      const nextSession = await transitionDurableDialerSession(sessionId, action, reason)
      if (operationRevision !== controlRevisionRef.current) return null
      if (action === 'resume' && nextSession.status === 'active') setAutoStartEpoch((current) => current + 1)
      applySession(nextSession)
      window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: nextSession }))
      return nextSession
    } catch (error) {
      if (operationRevision !== controlRevisionRef.current) return null
      if (isDialerControlLossError(error)) showControlConflict(error, operationRevision)
      setSessionError(error instanceof Error ? error.message : 'Could not update the dialer session.')
      return null
    } finally {
      setActionPending(false)
    }
  }, [applySession, sessionId, showControlConflict])

  const requestPause = useCallback(async (): Promise<DialerPauseRequest | null> => {
    if (!sessionId || session?.status !== 'active' || !controlOwnedRef.current) return null
    const operationRevision = controlRevisionRef.current
    setActionPending(true)
    setSessionError(null)
    try {
      const result = await requestPauseDurableDialerSession(sessionId, 'Agent paused the calling session')
      if (operationRevision !== controlRevisionRef.current) return null
      applySession(result.session)
      return result
    } catch (error) {
      if (operationRevision !== controlRevisionRef.current) return null
      if (isDialerControlLossError(error)) showControlConflict(error, operationRevision)
      setSessionError(error instanceof Error ? error.message : 'Could not pause the dialer session.')
      return null
    } finally {
      setActionPending(false)
    }
  }, [applySession, session?.status, sessionId, showControlConflict])

  const resumeAttempts = !sessionId
    ? emptyResumeSnapshot(null, currentSubjectKey, autoStartEpoch)
    : loadedResumeAttempts
  const resumeAttemptsReady = resumeAttempts.sessionId === (sessionId || null)
    && resumeAttempts.subjectKey === currentSubjectKey
    && resumeAttempts.autoStartEpoch === autoStartEpoch

  const finishUnadvancedAttempt = useCallback(async () => {
    if (
      readOnlyPreview
      || !sessionId
      || !controlOwnedRef.current
      || !resumeAttemptsReady
      || !resumeAttempts.unadvancedAttemptId
    ) return
    const operationRevision = controlRevisionRef.current
    try {
      const payload = await transitionDurableDialerAttempt({
        sessionId,
        clientAttemptId: resumeAttempts.unadvancedAttemptId,
        action: 'advance',
      })
      if (operationRevision !== controlRevisionRef.current) return
      if (!payload.session) throw new Error('Dialer session advance returned no state.')
      applySession(payload.session)
      window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: payload.session }))
    } catch (error) {
      if (operationRevision !== controlRevisionRef.current) return
      if (isDialerControlLossError(error)) showControlConflict(error, operationRevision)
      setSessionError(error instanceof Error ? error.message : 'Could not finish the saved seller outcome.')
    }
  }, [applySession, readOnlyPreview, resumeAttempts, resumeAttemptsReady, sessionId, showControlConflict])

  const confirmTakeover = useCallback(async () => {
    if (!controlSummary || controlBusy) return
    setControlBusy(true)
    setControlError(null)
    let operationRevision = controlRevisionRef.current
    try {
      const result = await takeOverDurableDialerSession({
        sessionId: controlSummary.sessionId,
        expectedGeneration: controlSummary.generation,
        requestId: newDialerControlRequestId(),
      })
      if (!acceptVerifiedControl(result, true, operationRevision)) {
        operationRevision = controlRevisionRef.current
        const verified = await heartbeatDurableDialerSessionControl(result.session.id)
        if (!acceptVerifiedControl(verified, true, operationRevision)) {
          throw new Error('A newer dialing controller is already active.')
        }
      }
      publishDialerControlTaken(result.session.id, controlGenerationRef.current)
    } catch (error) {
      if (operationRevision !== controlRevisionRef.current) return
      if (error instanceof DialerSessionClientError && error.details) setControlSummary(error.details)
      setControlError(error instanceof Error ? error.message : 'Dialing control could not be transferred.')
    } finally {
      setControlBusy(false)
    }
  }, [acceptVerifiedControl, controlBusy, controlSummary])

  const heirsAutoStart = useMemo(() => ({
    autoStart: readOnlyPreview || (
      !sessionId || controlOwned
    ) && resumeAttemptsReady && autoQueueSubjectKey === currentSubjectKey,
    autoStartEpoch,
    autoStartSkipPhoneIds: resumeAttemptsReady ? resumeAttempts.completedPhoneIds : [],
    autoStartSkipPhones: resumeAttemptsReady ? resumeAttempts.completedPhones : [],
  }), [autoQueueSubjectKey, autoStartEpoch, controlOwned, currentSubjectKey, readOnlyPreview, resumeAttempts.completedPhoneIds, resumeAttempts.completedPhones, resumeAttemptsReady, sessionId])

  return {
    session,
    applySession,
    clearSession,
    initializeSession,
    actionPending,
    setActionPending,
    sessionError,
    setSessionError,
    controlOwned,
    controlLocked: Boolean(sessionId && !controlOwned),
    controlSummary,
    controlBusy,
    controlError,
    autoStartEpoch,
    heirsAutoStart,
    transitionSession,
    requestPause,
    finishUnadvancedAttempt,
    confirmTakeover,
  }
}
