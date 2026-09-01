'use client'
/* eslint-disable react-hooks/set-state-in-effect -- legacy event-driven dialer state is synchronized by effects */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { DispositionModal, DispositionType } from './disposition-modal'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { DialerCallerPlan, normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'
import {
  MAIN_DIALER_DISPOSITIONS,
  PROSPECTING_DIALER_DISPOSITIONS,
  isDeadDisposition,
  isReachedDisposition,
} from '@/lib/dialer-dispositions'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { agentNameForCallerId, resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { loadDialerAttemptHistory, transitionDurableDialerAttempt, transitionDurableDialerSession } from '@/lib/dialer-session-client'
import { transitionLeadLifecycle } from '@/lib/crm-lifecycle-client'
import { useDialerPostCallReview } from './use-dialer-post-call-review'
import { WorkspaceCallController } from './workspace-call-controller'
import { WorkspaceSessionControls } from './workspace-session-controls'
import { WorkspaceDispositionControls } from './workspace-disposition-controls'
import { ActiveCallCard, IncomingCallCard } from './dialer-call-state-cards'
import { DialerQueueHeader } from './dialer-queue-header'
import { DialerPanelHeader } from './dialer-panel-header'
import { useDialerStartCountdown } from './use-dialer-start-countdown'
import { useDialerControlLoss } from './use-dialer-control-loss'
import { useCallTimer } from './use-call-timer'
import type { CallStatus, DialerPanelProps, HeirQueueItem, TwilioDevice, TwilioErrorLike } from './telephony-bar-types'
export type { CallStatus, HeirQueueItem } from './telephony-bar-types'
import {
  createClientAttemptId,
  requestDialerCallIntent,
  type DialerCallIntentKind,
} from '@/lib/telephony/dialer-client-preflight'
import { saveManualCallDisposition } from '@/lib/telephony/manual-call-disposition'
import { findRecoverableDialerAttempt, type RecoverableDialerAttempt } from '@/lib/telephony/dialer-session-recovery'
import { dialerPauseIsPending, dialerStopIsPending, postDispositionCommand } from '@/lib/telephony/dialer-lifecycle'
import {
  DIALER_KEYPAD,
  DIALER_STATUS_DOT_COLOR,
  DIALER_STATUS_LABEL,
  classifyDirection,
  extractTwilioErrorMessage,
  formatCallLeg,
  formatDialDisplay,
  formatDuration,
  formatTimeAgo,
  isNoAnswer,
  isNonFatalAudioWarning,
  normalizeDispositionLabel,
  priorityColors,
  type RecentCall,
  resolveCallerIdForAttempt,
  type SearchResult,
  stationColors,
  stripDialFormatting,
} from './telephony-bar-support'

export function DialerPanel({
  open,
  onClose,
  onStatusChange,
  pendingDial,
  pendingQueue,
  pendingQueueCallerId,
  pendingQueueCallerPlan,
  pendingQueueAutoDial = false,
  pendingSessionId = null,
  pendingQueueRingCount = null,
  presentation = 'dock',
  signedInEmail = null,
}: DialerPanelProps) {
  const signedInProfile = useMemo(() => resolveAgentTelephonyProfile(signedInEmail), [signedInEmail])
  const [status, setStatus] = useState<CallStatus>('offline')
  const [dialNumber, setDialNumber] = useState('')
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deviceRef = useRef<TwilioDevice>(null)
  const callRef = useRef<TwilioDevice>(null)
  const callTimer = useCallTimer(status === 'on_call')
  const deviceInitialized = useRef(false)
  // Ring count for the current heir-queue session → Twilio Dial timeout.
  const ringCountRef = useRef<number | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<SearchResult | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)
  const dialInputRef = useRef<HTMLInputElement>(null)

  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
  const [viewTab, setViewTab] = useState<'dial' | 'recent'>('dial')

  const [callerIdDisplay, setCallerIdDisplay] = useState<string>(() => signedInProfile.defaultCallerId)
  const [selectedCallerId, setSelectedCallerId] = useState<string>(() => signedInProfile.defaultCallerId)
  const [callerIdLockedByUser, setCallerIdLockedByUser] = useState(false)
  const [agentIdentity, setAgentIdentity] = useState<string>(() => signedInProfile.identity)
  const [callerPlan, setCallerPlan] = useState<DialerCallerPlan>(() => normalizeDialerCallerPlan(null, signedInProfile.defaultCallerId))
  const [attemptsPlaced, setAttemptsPlaced] = useState(0)

  const [showDisposition, setShowDisposition] = useState(false)
  const [outcomeRequired, setOutcomeRequired] = useState(false)
  const [workspaceDispositionPreset, setWorkspaceDispositionPreset] = useState<DispositionType | null>(null)
  const [workspaceDispositionSaving, setWorkspaceDispositionSaving] = useState<DispositionType | null>(null)
  const [reviewContext, setReviewContext] = useState<{ sessionId: string; clientAttemptId: string } | null>(null)
  const [recoveryPending, setRecoveryPending] = useState<RecoverableDialerAttempt | null>(null)
  const [showNewTaskFor, setShowNewTaskFor] = useState<SearchResult | null>(null)
  const lastCallPhoneRef = useRef<string>('')
  const [lastCallDuration, setLastCallDuration] = useState<string | null>(null)
  const lastCallDurationSecondsRef = useRef(0)
  const activeCallerId = selectedCallerId || callerIdDisplay
  const activeAgentName = agentNameForCallerId(activeCallerId)
    || (agentIdentity === signedInProfile.identity ? signedInProfile.displayName : null)
    || 'System'
  const callerIdOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = TWILIO_NUMBERS.map((num) => ({ label: num.label, value: num.value }))
    if (callerIdDisplay && !options.some((opt) => opt.value === callerIdDisplay)) {
      options.unshift({ label: `${formatPhone(callerIdDisplay)} — Default`, value: callerIdDisplay })
    }
    return options
  }, [callerIdDisplay])
  const fallbackCallerId = selectedCallerId || callerIdDisplay || callerIdOptions[0]?.value || ''
  const rotatedCallerId = resolveCallerIdForAttempt(callerPlan, fallbackCallerId, attemptsPlaced)

  useEffect(() => {
    setAgentIdentity(signedInProfile.identity)
    setCallerIdDisplay(signedInProfile.defaultCallerId)
    if (callerIdLockedByUser) return
    setSelectedCallerId(signedInProfile.defaultCallerId)
    setCallerPlan(normalizeDialerCallerPlan(null, signedInProfile.defaultCallerId))
    setAttemptsPlaced(0)
  }, [callerIdLockedByUser, signedInProfile])

  const [queue, setQueue] = useState<HeirQueueItem[] | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const queueItem = queue && queue[queueIndex] ? queue[queueIndex] : null
  const queueMode = queue !== null && queue.length > 0
  const activeQueueItemRef = useRef<HeirQueueItem | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeAttemptIdRef = useRef<string | null>(null)
  const stopRequestedSessionIdRef = useRef<string | null>(null)
  const pausedSessionIdRef = useRef<string | null>(null)
  const pauseLeaveAfterOutcomeRef = useRef(false)
  const [workspaceSessionStatus, setWorkspaceSessionStatus] = useState<'active' | 'paused' | 'completed' | 'stopped' | null>(null)
  const campaignCallerIdRef = useRef<string | null>(null)
  const pendingAutoDialRef = useRef(false)
  const { arm: armAutoStart, cancel: cancelAutoStart, finish: finishAutoStart, remainingSeconds: autoStartCountdownSeconds } = useDialerStartCountdown(pendingAutoDialRef, pendingSessionId)
  const callIntentPendingRef = useRef(false)
  const makeCallRef = useRef<() => Promise<void> | void>(() => {})
  const postCallReview = useDialerPostCallReview({ open: outcomeRequired, sessionId: reviewContext?.sessionId || null, clientAttemptId: reviewContext?.clientAttemptId || null })
  const requireDisposition = useCallback(() => {
    setOutcomeRequired(true)
    if (presentation !== 'workspace') setShowDisposition(true)
  }, [presentation])
  const clearDispositionRequirement = useCallback(() => {
    setOutcomeRequired(false)
    setShowDisposition(false)
    setWorkspaceDispositionPreset(null)
  }, [])
  const endQueue = useCallback(() => {
    cancelAutoStart()
    campaignCallerIdRef.current = null
    setQueue(null)
    setQueueIndex(0)
    setSelectedLead(null)
    setDialNumber('')
    clearDispositionRequirement()
  }, [cancelAutoStart, clearDispositionRequirement])
  const workspaceControlsUnavailable = useDialerControlLoss(pendingSessionId, cancelAutoStart, endQueue, callRef, callIntentPendingRef, status)

  // Handle pendingDial from ARI page click-to-call
  useEffect(() => {
    if (open && pendingDial?.phone) {
      campaignCallerIdRef.current = null
      setViewTab('dial')
      setSelectedLead({
        id: pendingDial.leadId,
        full_name: pendingDial.name,
        phone: pendingDial.phone,
        property_address: null,
        city: null,
        station: null,
        priority: null,
        updated_at: new Date().toISOString(),
      })
      setDialNumber(pendingDial.phone)
      if (pendingDial.callerId) {
        setSelectedCallerId(pendingDial.callerId)
        setCallerIdLockedByUser(false)
        setCallerPlan(normalizeDialerCallerPlan({
          mode: 'static',
          staticCallerId: pendingDial.callerId,
          rotationCallerIds: [],
          rotateEveryCalls: 1,
          redialCallerId: null,
        }, pendingDial.callerId))
      }
      setSearchQuery('')
      setSearchResults([])
    }
  }, [open, pendingDial])

  // Broadcast queue state so the /dialer page (or any other surface) can
  // render its own "Now calling" indicator without importing the bar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('heir-queue-state', {
      detail: {
        queueItem,
        queueIndex,
        queueLength: queue?.length ?? 0,
        status,
        sessionId: pendingSessionId,
        outcomeRequired: outcomeRequired || Boolean(recoveryPending),
        callDuration: status === 'on_call' ? callTimer : status === 'calling' ? '00:00' : null,
      },
    }))
  }, [callTimer, outcomeRequired, pendingSessionId, queueItem, queueIndex, queue, recoveryPending, status])

  // Handle pendingQueue from HeirsSection — open heir-dialer queue mode.
  useEffect(() => {
    if (open && pendingQueue && pendingQueue.length > 0) {
      setViewTab('dial')
      setQueue(pendingQueue)
      setQueueIndex(0)
      clearDispositionRequirement()
      ringCountRef.current = pendingQueueRingCount ?? null
      const planFromEvent = normalizeDialerCallerPlan(
        pendingQueueCallerPlan,
        typeof pendingQueueCallerId === 'string' ? pendingQueueCallerId.trim() : '',
      )
      setCallerPlan(planFromEvent)
      setAttemptsPlaced(0)
      const initialCallerId = resolveCallerIdForAttempt(planFromEvent, planFromEvent.staticCallerId, 0)
      campaignCallerIdRef.current = pendingSessionId && initialCallerId ? initialCallerId : null
      if (initialCallerId) {
        setSelectedCallerId(initialCallerId)
        setCallerIdLockedByUser(false)
      }
      const first = pendingQueue[0]
      setSelectedLead({
        id: first.leadId ?? `prospect:${first.prospectId}`,
        full_name: first.heirName,
        phone: first.phone,
        property_address: first.propertyAddress,
        city: null,
        station: null,
        priority: null,
        updated_at: new Date().toISOString(),
      })
      setDialNumber(first.phone)
      if (pendingQueueAutoDial) armAutoStart(pendingSessionId)
      else cancelAutoStart()
      setSearchQuery('')
      setSearchResults([])
    }
  }, [armAutoStart, cancelAutoStart, clearDispositionRequirement, open, pendingQueue, pendingQueueCallerId, pendingQueueCallerPlan, pendingQueueAutoDial, pendingQueueRingCount, pendingSessionId])

  useEffect(() => {
    if (!open || !pendingSessionId || !pendingQueue?.length) return
    let cancelled = false
    void loadDialerAttemptHistory(pendingSessionId)
      .then(({ session, attempts }) => {
        if (cancelled) return
        stopRequestedSessionIdRef.current = session.stopRequestedAt ? session.id : null
        pausedSessionIdRef.current = session.status === 'paused' ? session.id : null
        setWorkspaceSessionStatus(session.status)
        if (session.stopRequestedAt || session.status === 'paused') cancelAutoStart()
        const recovery = findRecoverableDialerAttempt(session, attempts.items, pendingQueue)
        if (!recovery) {
          if (session.stopRequestedAt && session.status !== 'stopped') {
            void transitionDurableDialerSession(session.id, 'stop')
              .then((stoppedSession) => window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: stoppedSession })))
              .catch((stopError) => setError(stopError instanceof Error ? stopError.message : 'Could not finish ending the calling session.'))
          }
          return
        }

        const { attempt, queueIndex: recoveredIndex, queueItem: recoveredItem } = recovery
        cancelAutoStart()
        setRecoveryPending(recovery)
        setQueue(pendingQueue)
        setQueueIndex(recoveredIndex)
        activeQueueItemRef.current = recoveredItem
        activeSessionIdRef.current = pendingSessionId
        activeAttemptIdRef.current = attempt.client_attempt_id
        lastCallPhoneRef.current = attempt.phone
        lastCallDurationSecondsRef.current = attempt.duration_seconds ?? 0
        setLastCallDuration(attempt.duration_seconds == null ? null : formatDuration(attempt.duration_seconds))
        setReviewContext({ sessionId: pendingSessionId, clientAttemptId: attempt.client_attempt_id })
        setSelectedLead({
          id: recoveredItem.leadId ?? `prospect:${recoveredItem.prospectId}`,
          full_name: recoveredItem.heirName,
          phone: recoveredItem.phone,
          property_address: recoveredItem.propertyAddress,
          city: null,
          station: null,
          priority: null,
          updated_at: attempt.updated_at,
        })
        setDialNumber(recoveredItem.phone)

        if (recovery.needsEndTransition) {
          setError('A previous call was interrupted. Finish its outcome before starting another call.')
          return
        }
        setError(null)
        requireDisposition()
      })
      .catch((restoreError) => {
        if (!cancelled) setError(restoreError instanceof Error ? restoreError.message : 'Could not restore the unfinished call outcome.')
      })
    return () => { cancelled = true }
  }, [cancelAutoStart, open, pendingQueue, pendingSessionId, requireDisposition])

  useEffect(() => {
    function onSessionState(event: Event) {
      const session = (event as CustomEvent).detail as { id?: string; status?: 'active' | 'paused' | 'completed' | 'stopped'; stopRequestedAt?: string | null } | null
      if (!pendingSessionId || session?.id !== pendingSessionId || !session.status) return
      setWorkspaceSessionStatus(session.status)
      stopRequestedSessionIdRef.current = session.stopRequestedAt ? pendingSessionId : null
      pausedSessionIdRef.current = session.status === 'paused' ? pendingSessionId : null
      if (session.status !== 'active' || session.stopRequestedAt) cancelAutoStart()
    }
    window.addEventListener('dialer-session-state', onSessionState)
    return () => window.removeEventListener('dialer-session-state', onSessionState)
  }, [cancelAutoStart, pendingSessionId])

  useEffect(() => {
    function onWorkspaceCallCommand(event: Event) {
      const action = ((event as CustomEvent).detail as { action?: string } | null)?.action
      if (action === 'hangup' && callRef.current) callRef.current.disconnect()
    }
    window.addEventListener('prospecting-session-command', onWorkspaceCallCommand)
    return () => window.removeEventListener('prospecting-session-command', onWorkspaceCallCommand)
  }, [])

  useEffect(() => {
    function onPauseRequested(event: Event) {
      const detail = (event as CustomEvent).detail as { session?: { id?: string; status?: 'paused' }; requiresDisposition?: boolean; leaveAfterPause?: boolean } | null
      if (!pendingSessionId || detail?.session?.id !== pendingSessionId) return
      pausedSessionIdRef.current = pendingSessionId
      pauseLeaveAfterOutcomeRef.current = detail.leaveAfterPause === true
      setWorkspaceSessionStatus('paused')
      cancelAutoStart()
      setError(null)
      if (!detail.requiresDisposition) {
        pauseLeaveAfterOutcomeRef.current = false
        return
      }
      if (callRef.current) {
        callRef.current.disconnect()
        return
      }
      if (activeSessionIdRef.current === pendingSessionId && activeAttemptIdRef.current) requireDisposition()
    }
    window.addEventListener('dialer-session-pause-requested', onPauseRequested)
    return () => window.removeEventListener('dialer-session-pause-requested', onPauseRequested)
  }, [cancelAutoStart, pendingSessionId, requireDisposition])

  useEffect(() => {
    function onStopRequested(event: Event) {
      const session = (event as CustomEvent).detail as { id?: string; status?: string; stopRequestedAt?: string | null } | null
      if (!pendingSessionId || session?.id !== pendingSessionId || !session.stopRequestedAt) return
      stopRequestedSessionIdRef.current = pendingSessionId
      cancelAutoStart()
      setError(null)
      if (session.status === 'stopped') {
        endQueue()
        return
      }
      if (callRef.current) {
        callRef.current.disconnect()
        return
      }
      if (activeSessionIdRef.current === pendingSessionId && activeAttemptIdRef.current) {
        requireDisposition()
      }
    }
    window.addEventListener('dialer-session-stop-requested', onStopRequested)
    return () => window.removeEventListener('dialer-session-stop-requested', onStopRequested)
  }, [cancelAutoStart, endQueue, pendingSessionId, requireDisposition])

  function log(msg: string) {
    console.log(`[DialerPanel] ${msg}`)
  }

  const setStatusLogged = useCallback((s: CallStatus) => {
    log(`status → ${s}`)
    setStatus(s)
    onStatusChange?.(s)
  }, [onStatusChange])

  // Lazy device init on first panel open
  const initDevice = useCallback(async () => {
    if (deviceInitialized.current && deviceRef.current) return
    setStatusLogged('connecting')
    setError(null)
    try {
      log('fetching token...')
      const { Device } = await import('@twilio/voice-sdk')
      const res = await fetch('/api/twilio-token')
      const data = await res.json()
      if (!res.ok || data.error) throw new Error('Phone service is unavailable. Retry in a moment or use the production CRM.')
      const { token, callerId: cid, identity } = data
      if (cid) {
        setCallerIdDisplay(cid)
        setSelectedCallerId((prev) => {
          if (campaignCallerIdRef.current) return campaignCallerIdRef.current
          if (callerIdLockedByUser && prev) return prev
          return cid
        })
      }
      if (identity) setAgentIdentity(identity)
      log('token received')

      const device = new Device(token, { logLevel: 1 })
      deviceRef.current = device

      device.on('registered', () => setStatusLogged('ready'))
      device.on('unregistered', () => setStatusLogged('offline'))
      device.on('tokenWillExpire', async () => {
        log('token expiring, refreshing...')
        try {
          const refreshRes = await fetch('/api/twilio-token')
          const refreshData = await refreshRes.json()
          if (refreshData.token) {
            device.updateToken(refreshData.token)
            if (refreshData.callerId) {
              setCallerIdDisplay(refreshData.callerId)
              setSelectedCallerId((prev) => {
                if (campaignCallerIdRef.current) return campaignCallerIdRef.current
                if (callerIdLockedByUser && prev) return prev
                return refreshData.callerId
              })
            }
            if (refreshData.identity) setAgentIdentity(refreshData.identity)
            log('token refreshed')
          }
        } catch {
          log('token refresh failed')
        }
      })
      device.on('error', (err: TwilioErrorLike) => {
        const msg = extractTwilioErrorMessage(err)
        if (isNonFatalAudioWarning(err)) {
          log(`non-fatal audio warning: ${msg}`)
          return
        }
        log(`device error: ${msg}`)
        setError(msg)
        setStatusLogged('offline')
      })
      device.on('incoming', (call: TwilioDevice) => {
        log('incoming call')
        callRef.current = call
        setStatusLogged('incoming')
        call.on('disconnect', () => { callRef.current = null; setStatusLogged('ready') })
        call.on('cancel', () => { callRef.current = null; setStatusLogged('ready') })
      })

      log('registering device...')
      await device.register()
      deviceInitialized.current = true
    } catch (err) {
      const msg = extractTwilioErrorMessage(err)
      log(`init error: ${msg}`)
      setError(msg)
      setStatusLogged('offline')
    }
  }, [callerIdLockedByUser, setStatusLogged])

  // Init device on first open
  useEffect(() => {
    if (open && !deviceInitialized.current) {
      initDevice()
    }
  }, [open, initDevice])

  // Auto-open panel on incoming call
  useEffect(() => {
    if (status === 'incoming' && !open) {
      // We can't directly open—parent controls this. Signal via onStatusChange.
    }
  }, [status, open])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && status !== 'on_call' && status !== 'calling') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, status])

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(searchQuery.trim())}&limit=8`)
        const data = await res.json()
        setSearchResults(data.results || [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery])

  // Load recent calls
  useEffect(() => {
    if (!open) return
    async function loadRecent() {
      try {
        const res = await fetch('/api/call-log?limit=50')
        if (res.ok) {
          const data = await res.json()
          setRecentCalls(data.calls || [])
        }
      } catch {}
    }
    loadRecent()
  }, [open])

  const callStartRef = useRef<number>(0)

  async function makeCall() {
    const number = dialNumber.trim()
    if (!number || callIntentPendingRef.current) return
    if (dialerStopIsPending(pendingSessionId, stopRequestedSessionIdRef.current)) {
      setError('This calling session is ending. Save the current outcome before leaving.')
      return
    }
    if (dialerPauseIsPending(pendingSessionId, pausedSessionIdRef.current)) {
      setError('This calling session is paused. Resume it before starting another call.')
      return
    }
    if (!deviceRef.current || status !== 'ready') {
      setError(status === 'offline'
        ? 'Twilio is offline. Click Connect Twilio and wait for Ready before calling.'
        : 'Twilio is still connecting. Try again when the dialer shows Ready.'
      )
      if (status === 'offline') initDevice()
      return
    }

    callIntentPendingRef.current = true
    setError(null)
    try {
      const callerIdForThisCall = callerPlan.mode === 'rotation' && !callerIdLockedByUser
        ? rotatedCallerId
        : (effectiveCallerId || '')
      const queueItemAtStart = queueItem
      const leadIdAtStart = queueItemAtStart ? queueItemAtStart.leadId : selectedLead?.id || null
      const prospectIdAtStart = queueItemAtStart?.prospectId || null
      const prospectPhoneIdAtStart = queueItemAtStart?.prospect_phone_id || null
      const kind: DialerCallIntentKind = queueItemAtStart
        ? queueItemAtStart.leadId
          ? queueItemAtStart.prospect_phone_id ? 'heir' : 'lead'
          : 'prospect'
        : leadIdAtStart ? 'lead' : 'manual'
      const authorized = await requestDialerCallIntent({
        phone: number,
        callerId: callerIdForThisCall,
        kind,
        leadId: kind === 'lead' || kind === 'heir' ? leadIdAtStart : null,
        prospectId: kind === 'prospect' ? prospectIdAtStart : null,
        prospectPhoneId: kind === 'heir' || kind === 'prospect' ? prospectPhoneIdAtStart : null,
        campaignMemberId: queueItemAtStart?.campaignMemberId ?? null,
        clientAttemptId: createClientAttemptId(),
        sessionId: queueItemAtStart ? pendingSessionId : null,
      })

      activeSessionIdRef.current = authorized.sessionId ?? null
      activeAttemptIdRef.current = authorized.clientAttemptId
      setReviewContext(authorized.sessionId ? { sessionId: authorized.sessionId, clientAttemptId: authorized.clientAttemptId } : null)
      if (activeSessionIdRef.current) {
        await transitionDurableDialerAttempt({
          sessionId: activeSessionIdRef.current,
          clientAttemptId: authorized.clientAttemptId,
          action: 'started',
        })
      }

      // Pause/stop can win while call authorization or the durable `started`
      // transition is in flight. Do not submit that already-authorized intent
      // to Twilio after the operator's durable command has completed.
      const stopBeforeProviderConnect = dialerStopIsPending(
        activeSessionIdRef.current,
        stopRequestedSessionIdRef.current,
      )
      const pauseBeforeProviderConnect = dialerPauseIsPending(
        activeSessionIdRef.current,
        pausedSessionIdRef.current,
      )
      if (activeSessionIdRef.current && (stopBeforeProviderConnect || pauseBeforeProviderConnect)) {
        const interruptedSessionId = activeSessionIdRef.current
        const leaveAfterPause = pauseLeaveAfterOutcomeRef.current
        await transitionDurableDialerAttempt({
          sessionId: interruptedSessionId,
          clientAttemptId: authorized.clientAttemptId,
          action: 'cancelled',
        })
        activeSessionIdRef.current = null
        activeAttemptIdRef.current = null
        setReviewContext(null)
        setRecoveryPending(null)
        pendingAutoDialRef.current = false
        clearDispositionRequirement()

        if (stopBeforeProviderConnect) {
          const stoppedSession = await transitionDurableDialerSession(interruptedSessionId, 'stop')
          stopRequestedSessionIdRef.current = null
          window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: stoppedSession }))
          endQueue()
        } else {
          pauseLeaveAfterOutcomeRef.current = false
          window.dispatchEvent(new CustomEvent('dialer-session-pause-completed', {
            detail: { sessionId: interruptedSessionId, leaveAfterPause },
          }))
        }
        return
      }

      setStatusLogged('calling')
      setLastCallDuration(null)
      lastCallDurationSecondsRef.current = 0
      lastCallPhoneRef.current = authorized.to
      // Snapshot the queue item only after the server allows the call so a
      // denied attempt cannot create disposition or call-log state.
      activeQueueItemRef.current = queueItemAtStart
      log(`calling ${authorized.to}`)

      const params: Record<string, string> = {
        To: authorized.to,
        CallerId: authorized.callerId,
        DialIntentToken: authorized.intent,
      }
      const authorizedRingCount = authorized.ringCount ?? ringCountRef.current
      if (authorizedRingCount && authorizedRingCount > 0) params.RingCount = String(authorizedRingCount)
      // enableRingingState: true is required by the Twilio Voice SDK so the
      // parent (browser) call emits a 'ringing' event and plays the network
      // ringback tone while the destination phone rings. Without it the
      // call transitions pending → connecting → open with no audible
      // feedback. This surfaced after PR #131 added answerOnBridge="true"
      // to the outbound TwiML — answerOnBridge holds the parent in
      // "ringing" until the destination answers, and the SDK has to be
      // told to honor that.
      const call = await deviceRef.current.connect({
        params,
        rtcConstraints: { audio: true },
        enableRingingState: true,
      })
      if (callerPlan.mode === 'rotation' && !callerIdLockedByUser) {
        setAttemptsPlaced((current) => current + 1)
      }
      callRef.current = call
      callStartRef.current = Date.now()
      let callWasAccepted = false

      call.on('ringing', () => {
        log('ringing...')
        setStatusLogged('calling')
      })
      call.on('accept', () => {
        callWasAccepted = true
        log('call accepted')
        setStatusLogged('on_call')
        if (activeSessionIdRef.current && activeAttemptIdRef.current) {
          void transitionDurableDialerAttempt({
            sessionId: activeSessionIdRef.current,
            clientAttemptId: activeAttemptIdRef.current,
            action: 'connected',
          }).catch((transitionError) => setError(extractTwilioErrorMessage(transitionError)))
        }
      })

      const heirMeta = activeQueueItemRef.current
        ? {
            heir_name: activeQueueItemRef.current.heirName,
            heir_relation: activeQueueItemRef.current.relation,
            prospect_phone_id: activeQueueItemRef.current.prospect_phone_id,
            prospect_id: activeQueueItemRef.current.prospectId,
            campaign_member_id: activeQueueItemRef.current.campaignMemberId,
            prospect_owner_name: activeQueueItemRef.current.deceasedOwnerName,
          }
        : null
      fetch('/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: authorized.to,
          event: 'started',
          agent: activeAgentName,
          agent_identity: agentIdentity,
          from_number: authorized.callerId,
          lead_id: authorized.leadId,
          clientAttemptId: authorized.clientAttemptId,
          ...heirMeta,
        }),
      }).catch(() => {})

      call.on('disconnect', () => {
        const duration = Math.round((Date.now() - callStartRef.current) / 1000)
        // The SDK accept event means the browser leg opened, not that the
        // seller answered. Treat this as an attempt until the user disposition
        // or Twilio status callbacks provide a firmer outcome.
        const finalStatus = callWasAccepted ? 'attempted' : 'no-answer'
        const finalOutcome = callWasAccepted ? 'unknown' : 'missed'
        const finalDisposition = callWasAccepted ? 'needs_disposition' : 'no_answer'
        lastCallDurationSecondsRef.current = duration
        setLastCallDuration(formatDuration(duration))
        fetch('/api/call-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: authorized.to,
            event: 'ended',
            duration,
            status: finalStatus,
            outcome: finalOutcome,
            disposition: finalDisposition,
            agent: activeAgentName,
            agent_identity: agentIdentity,
            from_number: authorized.callerId,
            lead_id: authorized.leadId,
            clientAttemptId: authorized.clientAttemptId,
            ...heirMeta,
          }),
        }).catch(() => {})
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
        if (activeSessionIdRef.current && activeAttemptIdRef.current) {
          void transitionDurableDialerAttempt({
            sessionId: activeSessionIdRef.current,
            clientAttemptId: activeAttemptIdRef.current,
            action: 'ended',
            durationSeconds: duration,
          }).catch((transitionError) => setError(extractTwilioErrorMessage(transitionError)))
        }
        // Always prompt for disposition after a call ends — the modal
        // handles the no-lead case (manual dial) gracefully.
        requireDisposition()
      })
      call.on('cancel', () => {
        callRef.current = null
        setStatusLogged('ready')
        setMuted(false)
        if (activeSessionIdRef.current && activeAttemptIdRef.current) {
          void transitionDurableDialerAttempt({
            sessionId: activeSessionIdRef.current,
            clientAttemptId: activeAttemptIdRef.current,
            action: 'ended',
            durationSeconds: lastCallDurationSecondsRef.current,
          }).catch((transitionError) => setError(extractTwilioErrorMessage(transitionError)))
        }
        requireDisposition()
      })
      if (
        dialerStopIsPending(activeSessionIdRef.current, stopRequestedSessionIdRef.current)
        || dialerPauseIsPending(activeSessionIdRef.current, pausedSessionIdRef.current)
      ) {
        call.disconnect()
      }
    } catch (err) {
      const msg = extractTwilioErrorMessage(err)
      log(`makeCall error: ${msg}`)
      setError(msg)
      setStatusLogged('ready')
      if (activeSessionIdRef.current && activeAttemptIdRef.current) {
        void transitionDurableDialerAttempt({
          sessionId: activeSessionIdRef.current,
          clientAttemptId: activeAttemptIdRef.current,
          action: 'failed',
        }).catch(() => {})
        activeSessionIdRef.current = null
        activeAttemptIdRef.current = null
      }
    } finally {
      callIntentPendingRef.current = false
    }
  }

  makeCallRef.current = makeCall

  useEffect(() => {
    if (
      !pendingAutoDialRef.current ||
      (autoStartCountdownSeconds !== null && autoStartCountdownSeconds > 0) ||
      outcomeRequired ||
      status !== 'ready' ||
      !queueMode ||
      !queueItem ||
      !dialNumber.trim()
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      if (
        !pendingAutoDialRef.current ||
        outcomeRequired ||
        status !== 'ready' ||
        !queueItem ||
        !dialNumber.trim()
      ) {
        return
      }
      finishAutoStart()
      void makeCallRef.current()
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [autoStartCountdownSeconds, dialNumber, finishAutoStart, outcomeRequired, queueItem, queueMode, status])

  // Auto-focus the dial input when the dialer opens (idle / dial tab only),
  // so the user can immediately type a number on their keyboard without
  // clicking into the field. Skipped while on a call or in the recent tab.
  useEffect(() => {
    if (!open) return
    const isOnCallNow = status === 'on_call' || status === 'calling'
    if (isOnCallNow || status === 'incoming') return
    if (viewTab !== 'dial') return
    const id = window.setTimeout(() => {
      dialInputRef.current?.focus()
    }, 200)
    return () => window.clearTimeout(id)
  }, [open, status, viewTab])

  function hangup() {
    callRef.current?.disconnect()
    callRef.current = null
    setStatusLogged('ready')
    setMuted(false)
  }

  async function finishRecoveredAttempt() {
    if (!recoveryPending || !pendingSessionId) return
    setError(null)
    try {
      if (recoveryPending.needsEndTransition) {
        await transitionDurableDialerAttempt({
          sessionId: pendingSessionId,
          clientAttemptId: recoveryPending.attempt.client_attempt_id,
          action: 'ended',
          durationSeconds: recoveryPending.attempt.duration_seconds ?? 0,
        })
        setRecoveryPending({ ...recoveryPending, needsEndTransition: false })
      }
      requireDisposition()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Could not finish the interrupted call.')
    }
  }

  function closeDisposition() {
    if (activeSessionIdRef.current && activeAttemptIdRef.current) {
      setError('Choose and save a call outcome before closing the call summary.')
      return
    }
    setShowDisposition(false)
    setWorkspaceDispositionPreset(null)
  }

  function acceptIncoming() {
    callRef.current?.accept()
    setStatusLogged('on_call')
    callStartRef.current = Date.now()
  }

  function rejectIncoming() {
    callRef.current?.reject()
    callRef.current = null
    setStatusLogged('ready')
  }

  function toggleMute() {
    if (!callRef.current) return
    callRef.current.mute(!muted)
    setMuted(!muted)
  }

  function selectLead(lead: SearchResult) {
    setSelectedLead(lead)
    setDialNumber(lead.phone || '')
    setSearchQuery('')
    setSearchResults([])
  }

  function clearSelectedLead() {
    clearUnverifiedDialContext()
    setDialNumber('')
  }

  function dialNumberMatchesContext(nextNumber: string): boolean {
    const normalizedNext = normalizePhoneToE164(nextNumber)
    if (!normalizedNext) return false
    if (queueItem) {
      return normalizedNext === normalizePhoneToE164(queueItem.phone)
        && selectedLead?.id === (queueItem.leadId ?? `prospect:${queueItem.prospectId}`)
    }
    return Boolean(selectedLead && normalizedNext === normalizePhoneToE164(selectedLead.phone))
  }

  function clearUnverifiedDialContext(nextNumber?: string) {
    if (nextNumber && dialNumberMatchesContext(nextNumber)) return
    setSelectedLead(null)
    setQueue(null)
    setQueueIndex(0)
    pendingAutoDialRef.current = false
    activeQueueItemRef.current = null
    campaignCallerIdRef.current = null
    ringCountRef.current = null
    setCallerPlan(normalizeDialerCallerPlan(null, selectedCallerId || callerIdDisplay))
    setAttemptsPlaced(0)
  }

  function setManualDialNumber(nextNumber: string) {
    const normalizedInput = stripDialFormatting(nextNumber)
    clearUnverifiedDialContext(normalizedInput)
    setDialNumber(normalizedInput)
  }

  function appendDialChar(char: string) {
    const base = stripDialFormatting(dialNumber)
    const nextNumber = char === '+' ? (base.length === 0 ? '+' : base) : `${base}${char}`
    setManualDialNumber(nextNumber)
  }

  function backspaceDial() {
    setManualDialNumber(stripDialFormatting(dialNumber).slice(0, -1))
  }

  async function handleDisposition(
    disposition: DispositionType,
    notes?: string,
    options?: { markAsLead?: boolean; autoDialNext?: boolean; verified?: boolean; deadReason?: string | null; appointmentAt?: string | null },
  ) {
    const markedDead = isDeadDisposition(disposition)
    const durableSessionId = activeSessionIdRef.current
    const durableAttemptId = activeAttemptIdRef.current
    const postDisposition = postDispositionCommand(
      dialerStopIsPending(durableSessionId, stopRequestedSessionIdRef.current),
      dialerPauseIsPending(durableSessionId, pausedSessionIdRef.current),
    )
    const activeItem = activeQueueItemRef.current
    const isManualDisposition = !selectedLead && !activeItem
    if (isManualDisposition) {
      // Manual calls still need durable final evidence. This is a distinct
      // event from the provisional call-ended row, and failures keep the
      // wrap-up open instead of pretending the outcome saved.
      try {
        await saveManualCallDisposition({
          phone: lastCallPhoneRef.current,
          disposition,
          callerId: activeCallerId || null,
          durationSeconds: lastCallDurationSecondsRef.current,
          clientAttemptId: durableAttemptId,
          notes,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save call outcome.')
        return false
      }
    } else {
      try {
        if (activeItem?.prospect_phone_id) {
          // Heir-dialer path: log to prospect_phones + activity feed via our own
          // endpoint (which handles verification + dead-lead rollup in one call).
          const response = await fetch('/api/heirs/attempt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prospect_phone_id: activeItem.prospect_phone_id,
              disposition,
              notes,
              lead_id: activeItem.leadId,
              prospect_id: activeItem.prospectId,
              campaign_member_id: activeItem.campaignMemberId,
              agent: activeAgentName,
              duration: lastCallDurationSecondsRef.current || null,
              mark_as_lead: Boolean(options?.markAsLead),
              verified: options?.verified,
              dead_reason: options?.deadReason ?? null,
              clientAttemptId: durableAttemptId,
              appointmentAt: options?.appointmentAt ?? null,
            }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error(payload?.error || 'Could not save heir disposition.')
          }
          window.dispatchEvent(new CustomEvent('heir-attempt-logged', {
            detail: {
              leadId: activeItem.leadId,
              prospectId: activeItem.prospectId,
              prospectPhoneId: activeItem.prospect_phone_id,
            },
          }))
        } else {
          const dispositionLeadId = activeItem?.leadId ?? selectedLead?.id ?? null
          if (!dispositionLeadId) throw new Error('Lead context is required to save this disposition.')
          if (markedDead) {
            await transitionLeadLifecycle(dispositionLeadId, {
              stage: 'dead', deadReason: options?.deadReason ?? null,
              deadReasonNotes: notes || null, reason: notes || 'Marked dead from call disposition',
              dialerSessionId: durableSessionId,
            })
          }
          const response = await fetch(`/api/leads/${dispositionLeadId}/disposition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              disposition,
              notes,
              phone: lastCallPhoneRef.current,
              appointmentAt: options?.appointmentAt ?? null,
              clientAttemptId: durableAttemptId,
            }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null)
            throw new Error(payload?.error || 'Could not save call disposition.')
          }
        }
        window.dispatchEvent(new CustomEvent('crm:disposition-logged', {
          detail: {
            leadId: activeItem?.leadId ?? selectedLead?.id ?? null,
            prospectId: activeItem?.prospectId ?? null,
            disposition,
            reached: isReachedDisposition(disposition),
            dead: markedDead,
          },
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save disposition.')
        return false
      }
    }

    if (durableSessionId && durableAttemptId) {
      try {
        await transitionDurableDialerAttempt({
          sessionId: durableSessionId,
          clientAttemptId: durableAttemptId,
          action: 'disposition',
          disposition,
          durationSeconds: lastCallDurationSecondsRef.current,
        })
      } catch (transitionError) {
        setError(extractTwilioErrorMessage(transitionError))
        return false
      }
    }
    if (isManualDisposition) {
      clearDispositionRequirement()
      return true
    }
    if (durableSessionId && durableAttemptId && postDisposition === 'stop_session') {
      try {
        const session = await transitionDurableDialerSession(durableSessionId, 'stop')
        window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: session }))
      } catch (transitionError) {
        setError(extractTwilioErrorMessage(transitionError))
        return false
      }
      pendingAutoDialRef.current = false
      stopRequestedSessionIdRef.current = null
      endQueue()
      activeQueueItemRef.current = null
      activeSessionIdRef.current = null
      activeAttemptIdRef.current = null
      setRecoveryPending(null)
      return true
    }

    if (durableSessionId && durableAttemptId && postDisposition === 'pause_session') {
      const leaveAfterPause = pauseLeaveAfterOutcomeRef.current
      pendingAutoDialRef.current = false
      pausedSessionIdRef.current = null
      pauseLeaveAfterOutcomeRef.current = false
      endQueue()
      activeQueueItemRef.current = null
      activeSessionIdRef.current = null
      activeAttemptIdRef.current = null
      setRecoveryPending(null)
      window.dispatchEvent(new CustomEvent('dialer-session-pause-completed', { detail: { sessionId: durableSessionId, leaveAfterPause } }))
      return true
    }

    // Advance the server-owned lead queue only after both the durable outcome
    // and the CRM disposition have been saved. The transition is idempotent,
    // so retrying the modal cannot advance twice.
    const completesLead = !queueMode || Boolean(queue && queueIndex + 1 >= queue.length)
    if (durableSessionId && durableAttemptId && completesLead) {
      try {
        const payload = await transitionDurableDialerAttempt({
          sessionId: durableSessionId,
          clientAttemptId: durableAttemptId,
          action: 'advance',
        })
        if (!payload.session) throw new Error('Dialer session advance returned no state.')
        window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: payload.session }))
      } catch (transitionError) {
        setError(extractTwilioErrorMessage(transitionError))
        return false
      }
    }

    // Advance the heir queue after disposition is logged.
    const nextQueueItem = queueMode ? advanceQueue() : null
    if (nextQueueItem && options?.autoDialNext) {
      pendingAutoDialRef.current = true
    }
    activeQueueItemRef.current = null
    activeAttemptIdRef.current = null
    setRecoveryPending(null)
    if (completesLead) activeSessionIdRef.current = null
    clearDispositionRequirement()
    return true
  }

  async function chooseWorkspaceDisposition(disposition: DispositionType) {
    if (!outcomeRequired || workspaceDispositionSaving) return
    const availableDispositions = PROSPECTING_DIALER_DISPOSITIONS.filter((item) => activeQueueItemRef.current?.leadId || item.id !== 'appointment_set')
    const requiresReview = availableDispositions.some((item) => (
      item.id === disposition && (item.group === 'reached' || item.requiresReason)
    ))
    if (!availableDispositions.some((item) => item.id === disposition)) return
    if (requiresReview) {
      setWorkspaceDispositionPreset(disposition)
      setShowDisposition(true)
      return
    }

    setWorkspaceDispositionSaving(disposition)
    try {
      await handleDisposition(disposition, undefined, { autoDialNext: true })
    } finally {
      setWorkspaceDispositionSaving(null)
    }
  }

  function advanceQueue(): HeirQueueItem | null {
    if (!queue) return null
    const next = queueIndex + 1
    if (next >= queue.length) {
      // Queue complete — let listeners (e.g. /dialer page) advance to the
      // next lead before we reset local state.
      const finishedItem = queue[queueIndex]
      if (finishedItem) {
        window.dispatchEvent(new CustomEvent('heir-queue-complete', {
          detail: {
            leadId: finishedItem.leadId,
            prospectId: finishedItem.prospectId,
            campaignMemberId: finishedItem.campaignMemberId,
          },
        }))
      }
      setQueue(null)
      setQueueIndex(0)
      setSelectedLead(null)
      setDialNumber('')
      return null
    }
    setQueueIndex(next)
    const item = queue[next]
    setSelectedLead({
      id: item.leadId ?? `prospect:${item.prospectId}`,
      full_name: item.heirName,
      phone: item.phone,
      property_address: item.propertyAddress,
      city: null,
      station: null,
      priority: null,
      updated_at: new Date().toISOString(),
    })
    setDialNumber(item.phone)
    return item
  }

  function skipQueueItem() {
    advanceQueue()
  }

  function prevQueueItem() {
    if (!queue || queueIndex === 0) return
    const prev = queueIndex - 1
    setQueueIndex(prev)
    const item = queue[prev]
    setSelectedLead({
      id: item.leadId ?? `prospect:${item.prospectId}`,
      full_name: item.heirName,
      phone: item.phone,
      property_address: item.propertyAddress,
      city: null,
      station: null,
      priority: null,
      updated_at: new Date().toISOString(),
    })
    setDialNumber(item.phone)
  }

  function handleRedial(call: RecentCall) {
    if (call.phone) {
      clearUnverifiedDialContext()
      setViewTab('dial')
      setDialNumber(call.phone)
    }
  }

  const isOnCall = status === 'on_call' || status === 'calling'
  const isDocked = presentation === 'dock'
  const isWorkspace = presentation === 'workspace'
  const effectiveCallerId = callerPlan.mode === 'rotation' && !callerIdLockedByUser
    ? rotatedCallerId
    : (callerPlan.staticCallerId || activeCallerId || callerIdOptions[0]?.value || '')
  const dispositionQueueItem = activeQueueItemRef.current

  return (
    <>
      {/* Backdrop */}
      {open && !isDocked && !isWorkspace && (
        <div
          className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[6px] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={
          isWorkspace
            ? `relative h-full min-h-0 w-full transition-opacity duration-300 ${
                open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`
            : isDocked
            ? `fixed right-3 bottom-3 sm:right-5 sm:bottom-5 z-[70] transition-opacity duration-300 ${
                open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`
            : `fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 transition-opacity duration-300 ${
                open ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`
        }
      >
        <div
          className={`${isWorkspace ? 'w-full max-w-none' : 'w-[388px] max-w-[calc(100vw-1rem)]'} ${
            isWorkspace
              ? 'h-full min-h-0'
              : isDocked
              ? 'h-[min(82vh,760px)]'
              : 'max-h-[calc(100dvh-2rem)] h-auto'
          } bg-[var(--skc-surface-1)] ${isWorkspace ? 'border-0 rounded-none shadow-none' : 'border border-[var(--skc-separator)] rounded-[var(--skc-radius-modal)] shadow-[0_24px_70px_rgba(0,0,0,0.62)]'} transform transition-all duration-300 ease-out flex flex-col ${
            open ? 'scale-100 translate-y-0' : 'scale-95 translate-y-2'
          } ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
        <DialerPanelHeader workspace={isWorkspace} status={DIALER_STATUS_LABEL[status]} statusDotClass={DIALER_STATUS_DOT_COLOR[status]}
          reconnecting={status === 'connecting'} onReconnect={() => { deviceInitialized.current = false; void initDevice() }} onClose={onClose} />

        {queueMode && queueItem ? <DialerQueueHeader
          item={queueItem}
          index={queueIndex}
          length={queue?.length ?? 0}
          callBusy={isOnCall}
          workspace={isWorkspace}
          onEnd={endQueue}
          onPrevious={prevQueueItem}
          onSkip={skipQueueItem}
        /> : null}

        {/* Scrollable body — min-h-0 is required so flex-1 actually shrinks
            below content size and the panel respects max-h cap. Without it
            the body forces the panel past the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#E32E2E]/10 border border-[#7D2626]">
              <Icon name="error" className="text-red-400" size="text-sm" />
              <span className="text-xs text-red-300 flex-1">{error}</span>
              <button
                onClick={() => recoveryPending ? void finishRecoveredAttempt() : (setError(null), void initDevice())}
                className="text-[10px] font-bold text-red-300 hover:text-white uppercase"
              >
                {recoveryPending ? 'Finish outcome' : 'Retry'}
              </button>
            </div>
          )}

          {!isWorkspace && !isOnCall && status !== 'incoming' && (
            <div className="grid grid-cols-2 rounded-[var(--skc-radius-pill)] bg-[var(--skc-surface-3)] p-0.5 gap-0.5 mx-4 mb-1">
              <button
                onClick={() => setViewTab('dial')}
                className={`px-3 py-[7px] rounded-[var(--skc-radius-tile)] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                  viewTab === 'dial' ? 'bg-[#636366] text-white font-semibold' : 'text-[var(--skc-text-tertiary)] hover:text-white'
                }`}
              >
                Dial
              </button>
              <button
                onClick={() => setViewTab('recent')}
                className={`px-3 py-[7px] rounded-[var(--skc-radius-tile)] text-[13px] font-medium tracking-[-0.01em] transition-colors ${
                  viewTab === 'recent' ? 'bg-[#636366] text-white font-semibold' : 'text-[var(--skc-text-tertiary)] hover:text-white'
                }`}
              >
                Recent
              </button>
            </div>
          )}

          {/* Search */}
          {!isWorkspace && !isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div className="relative mx-4">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  {searching ? (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  ) : (
                    <Icon name="search" className="text-white/40" size="text-lg" />
                  )}
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leads by name, phone, address..."
                  className="w-full bg-[var(--skc-surface-3)] text-[var(--skc-text-primary)] placeholder-[var(--skc-text-tertiary)] rounded-[var(--skc-radius-control)] pl-10 pr-4 py-[9px] text-[15px] tracking-[-0.01em] border border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--skc-brand-soft-border)] focus:border-[var(--skc-brand-soft-border)] transition-all"
                />
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute top-full left-4 right-4 mt-1 bg-[var(--skc-surface-2)] border border-[var(--skc-separator)] rounded-[var(--skc-radius-control)] shadow-2xl overflow-hidden z-10 max-h-[320px] overflow-y-auto">
                  {searchResults.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => selectLead(lead)}
                      className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-bold text-white truncate">{lead.full_name}</span>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          {lead.priority && lead.priority !== 'normal' && (
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${priorityColors[lead.priority] || 'bg-slate-500/20 text-slate-400'}`}>
                              {lead.priority}
                            </span>
                          )}
                          {lead.station && (
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${stationColors[lead.station] || 'bg-slate-500/20 text-slate-400'}`}>
                              {lead.station.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </div>
                      {lead.phone && (
                        <div className="text-xs text-white/50 font-mono">{formatPhone(lead.phone)}</div>
                      )}
                      {lead.property_address && (
                        <div className="text-xs text-white/40 truncate">{lead.property_address}{lead.city ? `, ${lead.city}` : ''}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Selected Lead Context Card */}
          {!isWorkspace && selectedLead && !isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div className="mx-4 bg-[var(--skc-surface-soft)] border border-[var(--skc-separator)] rounded-[var(--skc-radius-card)] p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-white truncate">{selectedLead.full_name}</span>
                    {selectedLead.priority && selectedLead.priority !== 'normal' && (
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${priorityColors[selectedLead.priority] || ''}`}>
                        {selectedLead.priority}
                      </span>
                    )}
                    {selectedLead.station && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${stationColors[selectedLead.station] || ''}`}>
                        {selectedLead.station.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {selectedLead.property_address && (
                    <p className="text-xs text-white/50 truncate">{selectedLead.property_address}{selectedLead.city ? `, ${selectedLead.city}` : ''}</p>
                  )}
                  {queueItem && !queueItem.leadId ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300 mt-1.5">
                      Source Prospect · not yet promoted
                    </span>
                  ) : <a
                    href={`/leads/${selectedLead.id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF6D6D] hover:text-white mt-1.5 transition-colors"
                  >
                    View Lead <Icon name="arrow_forward" size="text-xs" />
                  </a>}
                </div>
                <button
                  onClick={clearSelectedLead}
                  className="p-1 text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
                >
                  <Icon name="close" size="text-sm" />
                </button>
              </div>
            </div>
          )}

          {/* Incoming Call UI */}
          {status === 'incoming' ? <IncomingCallCard onAccept={acceptIncoming} onReject={rejectIncoming} /> : null}

          {/* Active Call Card */}
          {isOnCall ? <ActiveCallCard callTimer={callTimer} dialNumber={dialNumber} leadName={selectedLead?.full_name}
            muted={muted} onHangup={hangup} onToggleMute={toggleMute} status={status} /> : null}

          {isWorkspace && !isOnCall && status !== 'incoming' && (
            <WorkspaceCallController
              autoStartCountdownSeconds={autoStartCountdownSeconds}
              callerPlan={callerPlan}
              dialDisplay={dialNumber ? formatDialDisplay(dialNumber) : ''}
              dialReady={Boolean(dialNumber.trim()) && status === 'ready' && workspaceSessionStatus !== 'paused'}
              effectiveCallerId={effectiveCallerId}
              loadingSessionQueue={Boolean(pendingSessionId && !pendingQueue && !queue?.length)}
              onCall={makeCall}
              onPauseAutoStart={() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } }))}
              outcomeRequired={outcomeRequired || Boolean(recoveryPending)}
              queueItem={queueItem}
              statusLabel={DIALER_STATUS_LABEL[status]}
            />
          )}

          {isWorkspace && pendingSessionId && (outcomeRequired || Boolean(recoveryPending)) ? <WorkspaceDispositionControls
            dispositions={PROSPECTING_DIALER_DISPOSITIONS.filter((item) => queueItem?.leadId || item.id !== 'appointment_set')}
            outcomeRequired={outcomeRequired || Boolean(recoveryPending)}
            savingDisposition={workspaceDispositionSaving}
            onDisposition={(disposition) => { void chooseWorkspaceDisposition(disposition) }}
          /> : null}

          {/* Dial Section (when not on call and not incoming) */}
          {!isWorkspace && !isOnCall && status !== 'incoming' && viewTab === 'dial' && (
            <div>
              <div className="px-4 pb-2 text-center">
                <input
                  ref={dialInputRef}
                  type="tel"
                  inputMode="tel"
                  value={formatDialDisplay(dialNumber)}
                  onChange={(e) => setManualDialNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialNumber.trim() && status === 'ready') {
                      e.preventDefault()
                      makeCall()
                    }
                  }}
                  placeholder=""
                  aria-label="Phone number"
                  className="w-full bg-transparent border-0 text-center text-[28px] font-light tracking-[-0.02em] text-[var(--skc-text-primary)] [font-feature-settings:'tnum'] focus:outline-none"
                />
              </div>

              <div className="px-8 pb-3 grid grid-cols-3 gap-x-4 gap-y-2 justify-items-center">
                {DIALER_KEYPAD.map((key) => (
                  <button
                    key={key.value}
                    onClick={() => appendDialChar(key.value)}
                    className="w-14 h-14 rounded-full bg-[var(--skc-surface-3)] hover:bg-[var(--skc-surface-2)] transition-colors flex flex-col items-center justify-center"
                    aria-label={`Dial ${key.value}`}
                  >
                    <span className="text-[24px] font-light leading-none tracking-[-0.02em] text-[var(--skc-text-primary)]">
                      {key.value}
                    </span>
                    <span className="text-[8px] font-semibold tracking-[0.18em] text-[var(--skc-text-tertiary)] mt-0.5 min-h-[10px]">
                      {key.letters || '\u00A0'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="px-4 pb-2 grid grid-cols-[56px_1fr_56px] items-center gap-3">
                <div />
                <button
                  onClick={makeCall}
                  disabled={!dialNumber.trim() || status !== 'ready'}
                  className="w-14 h-14 rounded-full bg-[#30D158] hover:bg-[#28B14B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center justify-self-center shadow-lg shadow-[#30D158]/30"
                  title={status === 'ready' ? 'Call' : 'Waiting for Twilio'}
                  aria-label={status === 'ready' ? 'Call' : 'Waiting for Twilio'}
                >
                  <Icon name="call" size="text-[24px]" className="text-white" filled />
                </button>
                <button
                  onClick={backspaceDial}
                  disabled={!dialNumber}
                  className="w-10 h-10 rounded-full bg-[var(--skc-surface-3)] hover:bg-[var(--skc-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center justify-self-center"
                  aria-label="Backspace"
                >
                  <Icon name="keyboard_backspace" size="text-[18px]" className="text-[var(--skc-text-secondary)]" />
                </button>
              </div>

              <div className="border-t border-[var(--skc-separator)] px-4 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-tertiary)] mb-0.5">
                  Calling from
                </div>
                {callerIdOptions.length > 0 ? (
                  <div className="relative">
                    <select
                      value={effectiveCallerId}
                      onChange={(e) => {
                        const value = e.target.value
                        setSelectedCallerId(value)
                        setCallerIdLockedByUser(true)
                        setCallerPlan((current) => normalizeDialerCallerPlan({
                          ...current,
                          mode: 'static',
                          staticCallerId: value,
                        }, value))
                      }}
                      className="w-full bg-[var(--skc-surface-3)] text-[var(--skc-text-primary)] rounded-[var(--skc-radius-control)] px-3 pr-8 py-1.5 text-[14px] font-medium tracking-[-0.01em] border border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--skc-brand-soft-border)] appearance-none"
                    >
                      {callerIdOptions.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[var(--skc-surface-2)]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--skc-text-quaternary)]">
                      <Icon name="chevron_right" size="text-[15px]" />
                    </span>
                  </div>
                ) : (
                  <div className="text-[15px] font-medium tracking-[-0.01em] text-[var(--skc-text-primary)]">
                    {effectiveCallerId ? formatPhone(effectiveCallerId) : 'No caller ID available'}
                  </div>
                )}
                {callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 && (
                  <p className="mt-1.5 text-[10px] tracking-[-0.01em] text-[var(--skc-text-tertiary)]">
                    Rotation active · every {callerPlan.rotateEveryCalls} calls · {callerPlan.rotationCallerIds.length} numbers
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Recent Calls (when idle) */}
          {!isWorkspace && !isOnCall && status !== 'incoming' && viewTab === 'recent' && recentCalls.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest">Recent Calls</h3>
                <span className="text-[10px] text-white/30 tabular-nums">{recentCalls.length}</span>
              </div>
              <div className="space-y-1.5 max-h-[min(26rem,50vh)] overflow-y-auto pr-1">
                {recentCalls.map((call) => {
                  const direction = classifyDirection(call.metadata)
                  const noAnswer = isNoAnswer(call.metadata)
                  const missedCall = call.metadata?.outcome === 'missed' || call.metadata?.callStatus === 'no-answer' || call.metadata?.dialStatus === 'no-answer'
                  const disposition = call.metadata?.disposition || null
                  const status = call.metadata?.status || null
                  const duration = typeof call.metadata?.duration === 'number' ? call.metadata.duration : 0
                  const isCompleted = status === 'completed' || duration > 0 || disposition === 'answered' || call.metadata?.outcome === 'connected'
                  const isPending = status === 'initiated' || status === 'ringing' || status === 'queued'
                  const isVoicemail = disposition === 'voicemail_left' || disposition === 'left_voicemail'
                  const leftIcon =
                    direction === 'outbound'
                      ? 'call_made'
                      : direction === 'inbound'
                      ? 'call_received'
                      : 'call'
                  const leftTone =
                    direction === 'outbound'
                      ? 'bg-[#30D15826] text-[#30D158]'
                      : direction === 'inbound'
                      ? 'bg-[#64D2FF26] text-[#64D2FF]'
                      : 'bg-[#BF5AF226] text-[#BF5AF2]'
                  const detailParts = [formatCallLeg(call)]
                  if (call.agent) detailParts.push(call.agent)
                  if (disposition) detailParts.push(normalizeDispositionLabel(disposition))
                  const detailLine = detailParts.join(' · ')

                  return (
                    <button
                      key={call.id}
                      onClick={() => handleRedial(call)}
                      className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-[6px] border border-[#2F2F38] bg-[#17171D] hover:bg-[#1D1D25] transition-colors text-left"
                    >
                      <div className={`w-10 h-10 rounded-[6px] flex items-center justify-center flex-shrink-0 ${leftTone}`}>
                        <Icon name={leftIcon} size="text-xl" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <p className="text-sm text-white/90 font-semibold truncate">
                            {call.lead_name || call.phone || 'Unknown'}
                          </p>
                          <span className="text-xs text-white/35 flex-shrink-0">{formatTimeAgo(call.created_at)}</span>
                        </div>
                        <p className="text-xs text-white/45 truncate">{detailLine}</p>
                      </div>

                      {noAnswer ? (
                        <span
                          className={`flex-shrink-0 w-11 h-11 rounded-[6px] flex items-center justify-center ${
                            missedCall
                              ? 'bg-[#FF453A1A] border border-[#FF453A66]'
                              : 'bg-[#1F2026] border border-[#363842]'
                          }`}
                        >
                          <Icon name={missedCall ? 'missed_call_badge' : 'no_answer_badge'} size="text-xl" />
                        </span>
                      ) : isVoicemail ? (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#BF5AF226] text-[#BF5AF2] border border-[#BF5AF259] flex items-center justify-center">
                          <Icon name="support_agent" size="text-xl" />
                        </span>
                      ) : isCompleted ? (
                        <span className="flex-shrink-0 rounded-[6px] bg-[#30D1581F] border border-[#30D15873] px-2 py-1.5 text-[#30D158] inline-flex items-center gap-1.5 min-w-[62px] justify-center">
                          <Icon name="check_circle" size="text-base" />
                          <span className="text-xs font-bold tabular-nums">{duration > 0 ? formatDuration(duration) : 'done'}</span>
                        </span>
                      ) : isPending ? (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#FF9F0A1F] text-[#FF9F0A] border border-[#FF9F0A59] flex items-center justify-center">
                          <Icon name="more_horiz" size="text-xl" />
                        </span>
                      ) : (
                        <span className="flex-shrink-0 w-11 h-11 rounded-[6px] bg-[#22222A] text-white/55 border border-[#31313A] flex items-center justify-center">
                          <Icon name="help" size="text-xl" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!isWorkspace && !isOnCall && status !== 'incoming' && viewTab === 'recent' && recentCalls.length === 0 && (
            <div className="rounded-[6px] border border-[#2F2F38] bg-[#17171D] px-4 py-5 text-center">
              <p className="text-sm font-semibold text-white/80">No recent calls yet</p>
              <p className="text-xs text-white/40 mt-1">Calls will appear here after your first dial.</p>
            </div>
          )}

          {/* Reconnect button when offline */}
          {status === 'offline' && !error && viewTab === 'dial' && (
            <button
              onClick={initDevice}
              className="w-full py-2.5 bg-[#17171D] text-white/70 font-bold rounded-[6px] hover:bg-[#1E1E26] transition-colors flex items-center justify-center gap-2 text-xs border border-[#2F2F38]"
            >
              <Icon name="refresh" size="text-sm" />
              Connect Twilio
            </button>
          )}
        </div>
        {isWorkspace && pendingSessionId ? <div className="shrink-0 bg-[var(--skc-surface-1)] px-5 pb-4">
          <WorkspaceSessionControls status={workspaceSessionStatus} callBusy={isOnCall} controlUnavailable={workspaceControlsUnavailable}
            outcomeRequired={outcomeRequired || Boolean(recoveryPending)} onAction={(action) => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action } }))} />
        </div> : null}
        </div>
      </div>

      {/* Pulsing border animation */}
      <style jsx>{`
        @keyframes pulse-border {
          0%, 100% { border-color: rgba(227, 46, 46, 0.35); }
          50% { border-color: rgba(227, 46, 46, 0.7); }
        }
      `}</style>

      {/* Disposition Modal */}
      <DispositionModal
        open={showDisposition}
        onClose={closeDisposition}
        onDisposition={handleDisposition}
        phoneNumber={lastCallPhoneRef.current}
        leadName={selectedLead?.full_name}
        callDuration={lastCallDuration || undefined}
        dispositions={dispositionQueueItem
          ? PROSPECTING_DIALER_DISPOSITIONS.filter((item) => dispositionQueueItem.leadId || item.id !== 'appointment_set')
          : MAIN_DIALER_DISPOSITIONS}
        aiSummary={postCallReview?.summary}
        aiSummaryStatus={postCallReview?.status}
        markAsLeadAvailable={Boolean(dispositionQueueItem?.leadId && dispositionQueueItem.prospect_phone_id)}
        markAsLeadLabel={dispositionQueueItem?.leadId && dispositionQueueItem.prospect_phone_id ? `Mark ${dispositionQueueItem.heirName} as lead` : undefined}
        showVerifyToggle={Boolean(dispositionQueueItem?.prospect_phone_id)}
        verifyLabel={dispositionQueueItem?.prospect_phone_id ? `Verified — this is ${dispositionQueueItem.heirName}` : undefined}
        variant={dispositionQueueItem ? 'prospecting' : 'standard'}
        autoSubmitOnPick={!workspaceDispositionPreset}
        selectedDisposition={workspaceDispositionPreset ?? undefined}
        onDispositionChange={workspaceDispositionPreset ? setWorkspaceDispositionPreset : undefined}
        primaryActionLabel={dispositionQueueItem ? 'Save & Next Number' : 'Save Call'}
        showSecondaryAction={Boolean(dispositionQueueItem)}
        nextActions={selectedLead && (!dispositionQueueItem || dispositionQueueItem.leadId) ? [
          { id: 'set_next_activity', label: 'Set Next Activity', icon: 'event_note' },
        ] : []}
        onNextActionPick={(actionId) => {
          if (actionId === 'set_next_activity') {
            setShowNewTaskFor(selectedLead || null)
          }
        }}
      />

      {/* New Task modal — triggered by Set Next Activity from disposition */}
      {showNewTaskFor && (
        <NewTaskModal
          leadId={showNewTaskFor.id}
          leadName={showNewTaskFor.full_name || undefined}
          initialTitle={`Follow up with ${showNewTaskFor.full_name || 'seller'}`}
          primaryNextAction
          onClose={() => setShowNewTaskFor(null)}
          onCreated={() => {
            setShowNewTaskFor(null)
            window.dispatchEvent(new CustomEvent('crm:task-created', {
              detail: { leadId: showNewTaskFor.id },
            }))
          }}
        />
      )}
    </>
  )
}

// Re-export for backwards compat if anything imported TelephonyBar
export { DialerPanel as TelephonyBar }
