'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceCallRailOpen } from '@/components/conversations/workspace-frame'
import { formatPhone } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { normalizeDialerCallerPlan, parseCallerIdsCsv } from '@/lib/dialer-caller-plan'
import { loadDialerSubjectActivities, type DialerActivity as Activity } from '@/lib/dialer-lead-activity'
import { DialerSessionCommand } from '@/components/dialer/dialer-session-command'
import { ProspectingCallingContextRail } from '@/components/prospecting/prospecting-calling-context-rail'
import { ProspectingMarkDeadDialog } from '@/components/prospecting/prospecting-mark-dead-dialog'
import { resolveProspectingCallingSellerContext } from '@/components/prospecting/prospecting-calling-seller-context'
import { ProspectingSessionTakeoverDialog } from '@/components/prospecting/prospecting-session-takeover-dialog'
import { StalePausedDialerHardStopBanner } from '@/components/prospecting/stale-paused-dialer-hard-stop'
import {
  type DurableDialerSession,
  type DurableDialerQueueSubject,
} from '@/lib/dialer-session-client'
import type {
  ProspectingCallingLead as LeadSummary,
  ProspectingCallingProspect as ProspectSummary,
  ProspectingCallingQueueState as QueueState,
  ProspectingCallingTab,
  ProspectingSmsTarget,
} from '@/components/prospecting/prospecting-calling-types'
import { useCampaignPreviewQueue } from '@/components/prospecting/use-campaign-preview-queue'
import {
  dispatchDialerPauseRequested,
  useDialerPauseAndLeave,
} from '@/components/prospecting/use-dialer-pause-and-leave'
import { useDialerTodayMetrics } from '@/components/prospecting/use-dialer-today-metrics'
import { useProspectingSessionControl } from '@/components/prospecting/use-prospecting-session-control'
import {
  DialerOperationHoldRetainedError,
  withDialerSessionControlOperation,
} from '@/lib/telephony/dialer-control-operation-client'

const HeirsSection = dynamic(() => import('@/components/leads/heirs-section').then((module) => module.HeirsSection))
const SmsComposeModal = dynamic(() => import('@/components/leads/sms-compose-modal').then((module) => module.SmsComposeModal))
const DEFAULT_DIALER_CALLER_ID = TWILIO_NUMBERS[0]?.value ?? ''
const DEFAULT_ROTATION_EVERY_CALLS = 50

interface ProspectingCallingFloorProps {
  readOnlyPreview?: boolean
  previewCampaignId?: string | null
}

export function ProspectingCallingFloor({ readOnlyPreview = false, previewCampaignId = null }: ProspectingCallingFloorProps) {
  const callRailOpen = useWorkspaceCallRailOpen()
  const router = useRouter()
  const params = useSearchParams()
  const [subjects, setSubjects] = useState<DurableDialerQueueSubject[]>([])
  const [leads, setLeads] = useState<Record<string, LeadSummary>>({})
  const [prospects, setProspects] = useState<Record<string, ProspectSummary | null>>({})
  const [coOwners, setCoOwners] = useState<Record<string, string[]>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resolveError, setResolveError] = useState<string | null>(null)

  // Activity feed for the current Lead or unpromoted source Prospect.
  const [activitySnapshot, setActivitySnapshot] = useState<{ subjectKey: string; items: Activity[] } | null>(null)
  const [leftTab, setLeftTab] = useState<ProspectingCallingTab>('texts')
  const currentActivitySubjectRef = useRef<string | null>(null)

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [autoQueueSubjectKey, setAutoQueueSubjectKey] = useState<string | null>(null)
  const campaignPreview = useCampaignPreviewQueue(readOnlyPreview ? previewCampaignId : null)

  // SMS compose state
  const [smsTarget, setSmsTarget] = useState<ProspectingSmsTarget | null>(null)

  // Authoritative daily performance + mark-lead-dead dialog
  const todayMetrics = useDialerTodayMetrics(readOnlyPreview)
  const [showMarkDead, setShowMarkDead] = useState(false)
  const [markDeadReason, setMarkDeadReason] = useState('')
  const [markDeadNotes, setMarkDeadNotes] = useState('')
  const [markDeadBusy, setMarkDeadBusy] = useState(false)
  const [markDeadError, setMarkDeadError] = useState<string | null>(null)

  const currentSubject = subjects[currentIndex] ?? null
  const currentSubjectKey = currentSubject ? `${currentSubject.kind}:${currentSubject.id}` : null
  const currentDialerSubjectKeyRef = useRef(currentSubjectKey)
  const currentLeadId: string | null = currentSubject?.leadId ?? null
  const currentProspectId: string | null = currentSubject?.prospectId ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentSubjectKey ? prospects[currentSubjectKey] ?? null : null
  const smsOriginLead: LeadSummary | null = smsTarget ? leads[smsTarget.leadId] ?? null : null
  const activities = activitySnapshot?.subjectKey === currentSubjectKey ? activitySnapshot.items : []
  const durableSessionId = params.get('session_id')?.trim() || ''

  const applySessionQueue = useCallback((session: DurableDialerSession, armAutoStart: boolean) => {
    const nextSubjectKey = `${session.currentSubjectKind}:${session.currentSubjectId}`
    currentDialerSubjectKeyRef.current = nextSubjectKey
    setSmsTarget((target) => target && target.subjectKey !== nextSubjectKey ? null : target)
    setSubjects(session.queueItems.length > 0
      ? session.queueItems
      : session.leadIds.map((id) => ({ kind: 'lead' as const, id, leadId: id, prospectId: null, campaignMemberId: null })))
    setCurrentIndex(session.currentIndex)
    if (armAutoStart) setAutoQueueSubjectKey(`${session.currentSubjectKind}:${session.currentSubjectId}`)
    if (session.stopRequestedAt || ['completed', 'stopped', 'paused'].includes(session.status)) {
      setAutoQueueSubjectKey(null)
    }
  }, [])

  const handleControlLost = useCallback(() => {
    setAutoQueueSubjectKey(null)
    setSmsTarget(null)
    setShowMarkDead(false)
  }, [])

  const {
    session: durableSession,
    applySession: applyDurableSession,
    clearSession: clearDurableSession,
    initializeSession,
    actionPending: sessionActionPending,
    setActionPending: setSessionActionPending,
    sessionError,
    setSessionError,
    controlLocked,
    controlSummary,
    controlBusy,
    controlError,
    autoStartEpoch,
    heirsAutoStart,
    transitionSession: transitionCurrentSession,
    requestPause,
    finishUnadvancedAttempt,
    confirmTakeover: confirmControlTakeover,
  } = useProspectingSessionControl({
    readOnlyPreview,
    sessionId: durableSessionId,
    currentSubject,
    currentSubjectKey,
    autoQueueSubjectKey,
    onApplySession: applySessionQueue,
    onControlLost: handleControlLost,
  })

  const requestedCallerId = params.get('caller_id')?.trim() || ''
  const sessionCallerId = durableSession?.callerId || campaignPreview.callerId || requestedCallerId
  const sessionCallerModeParam = params.get('caller_mode')
  const sessionRotateEveryParam = params.get('rotation_every')
  const sessionRotationNumbersParam = params.get('rotation_numbers')
  const sessionRedialCallerId = params.get('redial_caller_id')?.trim() || ''
  const sessionQueueLabelParam = params.get('queue_label')?.trim() || ''
  const sessionCallHammerParam = params.get('call_hammer')
  const sessionUseCallHammer = sessionCallHammerParam === '1'
    ? true
    : sessionCallHammerParam === '0'
    ? false
    : true
  const sessionRingCountParam = params.get('ring_count')
  const savedSessionRingCount = durableSession?.settingsSnapshot?.ringCount
  const sessionRingCount = typeof savedSessionRingCount === 'number' && savedSessionRingCount >= 4 && savedSessionRingCount <= 7
    ? savedSessionRingCount
    : sessionRingCountParam && Number.isFinite(Number(sessionRingCountParam))
      ? Number(sessionRingCountParam)
      : null
  const sessionCallerPlan = useMemo(() => {
    const durableCallerPlan = durableSession?.settingsSnapshot?.callerPlan
    const plan = normalizeDialerCallerPlan(durableCallerPlan && typeof durableCallerPlan === 'object' && !Array.isArray(durableCallerPlan)
      ? durableCallerPlan
      : {
      mode: sessionCallerModeParam === 'rotation' ? 'rotation' : 'static',
      staticCallerId: sessionCallerId || DEFAULT_DIALER_CALLER_ID,
      rotationCallerIds: parseCallerIdsCsv(sessionRotationNumbersParam),
      rotateEveryCalls: sessionRotateEveryParam ? Number(sessionRotateEveryParam) : DEFAULT_ROTATION_EVERY_CALLS,
      redialCallerId: sessionRedialCallerId || null,
    }, sessionCallerId || DEFAULT_DIALER_CALLER_ID)
    return plan
  }, [durableSession?.settingsSnapshot?.callerPlan, sessionCallerId, sessionCallerModeParam, sessionRotateEveryParam, sessionRotationNumbersParam, sessionRedialCallerId])
  const sessionCallerPolicyLabel = sessionCallerPlan.mode === 'rotation' && sessionCallerPlan.rotationCallerIds.length > 1
    ? `Rotating ${sessionCallerPlan.rotationCallerIds.length} approved lines every ${sessionCallerPlan.rotateEveryCalls} calls`
    : sessionCallerId
      ? `Assigned line ${formatPhone(sessionCallerId)}`
      : 'Caller ID unavailable'
  const startIndexParam = params.get('start_index')

  useEffect(() => {
    currentActivitySubjectRef.current = currentSubjectKey
  }, [currentSubjectKey])

  // Resolve the durable subject queue. Legacy URLs remain Lead-only, while new
  // campaign sessions preserve unpromoted source Prospects without creating
  // shadow CRM Leads.
  useEffect(() => {
    async function resolveIds() {
      setLoading(true)
      setResolveError(null)
      if (readOnlyPreview) {
        clearDurableSession()
        setSubjects(campaignPreview.subjects)
        setCurrentIndex(0)
        setResolveError(campaignPreview.error)
        setLoading(campaignPreview.loading)
        return
      }
      if (durableSessionId) {
        try {
          await initializeSession()
          setLoading(false)
          return
        } catch (sessionError) {
          setResolveError(sessionError instanceof Error ? sessionError.message : 'Could not load the dialer session.')
          setSubjects([])
          setLoading(false)
          return
        }
      }
      clearDurableSession()
      const explicit = params.get('lead_ids')
      if (explicit) {
        const ids = explicit.split(',').map((s) => s.trim()).filter(Boolean)
        setSubjects(ids.map((id: string) => ({ kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null })))
        setLoading(false)
        return
      }
      const cohort = params.get('cohort')
      if (cohort === 'deceased-2-3yr') {
        const response = await fetch('/api/dialer/queue?cohort=deceased-2-3yr&ids_only=1', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) {
          setResolveError(payload?.error || 'Could not resolve dialer cohort.')
          setLoading(false)
          return
        }
        const ids = Array.isArray(payload.leadIds)
          ? payload.leadIds.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
        setSubjects(ids.map((id: string) => ({ kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null })))
        setLoading(false)
        return
      }
      setSubjects([])
      setLoading(false)
    }
    resolveIds()
  }, [campaignPreview.error, campaignPreview.loading, campaignPreview.subjects, clearDurableSession, durableSessionId, initializeSession, params, readOnlyPreview])

  useEffect(() => {
    if (durableSessionId) return
    if (subjects.length === 0) return
    const requested = Number(startIndexParam ?? '0')
    const safeIndex = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
    const timeout = window.setTimeout(() => {
      setCurrentIndex(Math.min(safeIndex, Math.max(subjects.length - 1, 0)))
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [durableSessionId, startIndexParam, subjects.length])

  // Batch-load Lead and source-Prospect context for the subject queue.
  useEffect(() => {
    if (subjects.length === 0) return

    async function load() {
      const leadIds = subjects.flatMap((subject) => subject.leadId ? [subject.leadId] : [])
      const prospectIds = subjects.flatMap((subject) => subject.prospectId ? [subject.prospectId] : [])
      const query = new URLSearchParams()
      if (leadIds.length > 0) query.set('lead_ids', leadIds.join(','))
      if (prospectIds.length > 0) query.set('prospect_ids', prospectIds.join(','))
      const response = await fetch(`/api/dialer/queue?${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        setResolveError(payload?.error || 'Could not load dialer leads.')
        setLeads({})
        setProspects({})
        return
      }
      const leadRows = payload.leads as LeadSummary[] | null
      const prospectRows = payload.prospects as (ProspectSummary & { lead_id: string })[] | null
      const coOwnerRows = payload.coOwners as Array<{ lead_id: string; name: string }> | null
      const leadMap: Record<string, LeadSummary> = {}
      ;(leadRows as LeadSummary[] | null)?.forEach((l) => { leadMap[l.id] = l })
      setLeads(leadMap)

      const prospectMap: Record<string, ProspectSummary | null> = {}
      subjects.forEach((subject) => { prospectMap[`${subject.kind}:${subject.id}`] = null })
      ;(prospectRows as (ProspectSummary & { lead_id: string })[] | null)?.forEach((p) => {
        const sourceKey = `prospect:${p.id}`
        if (sourceKey in prospectMap) prospectMap[sourceKey] = p
        if (p.lead_id) {
          const leadKey = `lead:${p.lead_id}`
          if (leadKey in prospectMap && prospectMap[leadKey] === null) prospectMap[leadKey] = p
        }
      })
      setProspects(prospectMap)

      const coOwnerMap: Record<string, string[]> = {}
      ;(coOwnerRows ?? []).forEach((row) => {
        const name = row.name.trim()
        if (!name) return
        const names = coOwnerMap[row.lead_id] ?? []
        if (!names.includes(name)) names.push(name)
        coOwnerMap[row.lead_id] = names
      })
      setCoOwners(coOwnerMap)
    }
    load()
  }, [subjects])

  // Load bounded history for either a canonical Lead or an unpromoted source
  // Prospect. Source Prospects intentionally have no Lead row, so their
  // per-contact notes are read through the Prospect-scoped endpoint.
  useEffect(() => {
    if (!currentSubjectKey || (!currentLeadId && !currentProspectId)) return
    const requestedSubjectKey = currentSubjectKey
    let cancelled = false
    void loadDialerSubjectActivities({ leadId: currentLeadId, prospectId: currentProspectId })
      .then((nextActivities) => {
        if (cancelled || currentActivitySubjectRef.current !== requestedSubjectKey) return
        setActivitySnapshot({ subjectKey: requestedSubjectKey, items: nextActivities })
      })
      .catch((error) => console.error('[Dialer] Could not load seller activity', error))
    return () => { cancelled = true }
  }, [autoStartEpoch, currentLeadId, currentProspectId, currentSubjectKey])

  const refreshActivities = useCallback(async () => {
    if (!currentSubjectKey || (!currentLeadId && !currentProspectId)) return
    const requestedSubjectKey = currentSubjectKey
    try {
      const nextActivities = await loadDialerSubjectActivities({ leadId: currentLeadId, prospectId: currentProspectId })
      if (currentActivitySubjectRef.current === requestedSubjectKey) {
        setActivitySnapshot({ subjectKey: requestedSubjectKey, items: nextActivities })
      }
    } catch (error) {
      console.error('[Dialer] Could not refresh seller activity', error)
    }
  }, [currentLeadId, currentProspectId, currentSubjectKey])

  // Refresh activities when an attempt is logged.
  useEffect(() => {
    function onAttempt(e: Event) {
      const detail = (e as CustomEvent).detail
      if (
        !detail
        || (currentLeadId && detail.leadId === currentLeadId)
        || (currentProspectId && detail.prospectId === currentProspectId)
      ) refreshActivities()
    }
    window.addEventListener('heir-attempt-logged', onAttempt)
    window.addEventListener('crm:disposition-logged', onAttempt)
    return () => {
      window.removeEventListener('heir-attempt-logged', onAttempt)
      window.removeEventListener('crm:disposition-logged', onAttempt)
    }
  }, [currentLeadId, currentProspectId, refreshActivities])

  // Listen to queue-state events from the telephony bar
  useEffect(() => {
    function onState(e: Event) {
      setQueueState((e as CustomEvent).detail as QueueState)
    }
    window.addEventListener('heir-queue-state', onState)
    return () => window.removeEventListener('heir-queue-state', onState)
  }, [])

  const advance = useCallback((autoQueueNextLead = false) => {
    const next = Math.min(currentIndex + 1, subjects.length - 1)
    const nextSubject = subjects[next]
    const nextSubjectKey = nextSubject ? `${nextSubject.kind}:${nextSubject.id}` : null
    currentDialerSubjectKeyRef.current = nextSubjectKey
    setSmsTarget((target) => target && target.subjectKey !== nextSubjectKey ? null : target)
    setCurrentIndex(next)
    if (autoQueueNextLead && next !== currentIndex && nextSubject) setAutoQueueSubjectKey(`${nextSubject.kind}:${nextSubject.id}`)
  }, [currentIndex, subjects])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const skipCurrentLead = useCallback(async () => {
    if (readOnlyPreview) {
      advance(false)
      return
    }
    if (!durableSessionId) {
      advance(true)
      return
    }
    if (markDeadBusy || controlLocked) return
    await transitionCurrentSession('skip', 'Agent skipped this contact')
  }, [advance, controlLocked, durableSessionId, markDeadBusy, readOnlyPreview, transitionCurrentSession])

  const handleAutoStartEmpty = useCallback(() => {
    setAutoQueueSubjectKey(null)
    void finishUnadvancedAttempt()
  }, [finishUnadvancedAttempt])

  const navigateAwayFromSession = useCallback(() => {
    const returnTo = params.get('return_to')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo)
      return
    }
    router.push('/prospecting')
  }, [params, router])

  const closeSession = useDialerPauseAndLeave({
    session: durableSession,
    sessionId: durableSessionId,
    applySession: applyDurableSession,
    navigateAway: navigateAwayFromSession,
    setPending: setSessionActionPending,
    setError: setSessionError,
  })

  const stopSession = useCallback(async () => {
    if (!durableSessionId) {
      navigateAwayFromSession()
      return
    }
    if (controlLocked) return
    const session = await transitionCurrentSession('request_stop')
    if (!session) return
    if (session.status === 'stopped') {
      navigateAwayFromSession()
      return
    }
    window.dispatchEvent(new CustomEvent('dialer-session-stop-requested', { detail: session }))
  }, [controlLocked, durableSessionId, navigateAwayFromSession, transitionCurrentSession])

  const pauseSession = useCallback(async () => {
    const result = await requestPause()
    if (result) dispatchDialerPauseRequested(result, false)
  }, [requestPause])

  useEffect(() => {
    if (durableSession?.status === 'stopped' && durableSession.stopRequestedAt) {
      navigateAwayFromSession()
    }
  }, [durableSession?.status, durableSession?.stopRequestedAt, navigateAwayFromSession])

  useEffect(() => {
    function onQueueComplete(e: Event) {
      if (durableSessionId) return
      const detail = (e as CustomEvent).detail
      if (
        (currentLeadId && detail?.leadId === currentLeadId)
        || (currentProspectId && detail?.prospectId === currentProspectId)
      ) {
        setTimeout(() => advance(true), 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [advance, currentLeadId, currentProspectId, durableSessionId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); void skipCurrentLead() }
      if (!durableSessionId && (e.key === 'k' || e.key === 'ArrowLeft')) { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, durableSessionId, skipCurrentLead])

  const markLeadDead = useCallback(async () => {
    if (!currentLeadId || !markDeadReason || controlLocked) return
    if (markDeadReason === 'other' && !markDeadNotes.trim()) {
      setMarkDeadError('Add a note when Other is selected.')
      return
    }
    setMarkDeadBusy(true)
    setMarkDeadError(null)
    const markDeadSubjectKey = currentSubjectKey
    try {
      const res = await withDialerSessionControlOperation(durableSessionId, 'Marking lead dead', async (controlHeaders, signal) => {
        const lifecycleResponse = await fetch(`/api/leads/${currentLeadId}/lifecycle`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', ...controlHeaders },
          body: JSON.stringify({
            action: 'transition',
            stage: 'dead',
            dialerSessionId: durableSessionId || null,
            deadReason: markDeadReason,
            deadReasonNotes: markDeadNotes.trim() || null,
            reason: markDeadNotes.trim() || `Marked dead from dialer — ${markDeadReason.replace(/_/g, ' ')}`,
          }),
        })
        if (!lifecycleResponse.ok || !durableSessionId) return lifecycleResponse

        // The lifecycle request is asynchronous. A skip that won immediately
        // before this workflow locked the controls may already have advanced
        // the queue; never apply this lead's follow-up skip to that next seller.
        if (currentDialerSubjectKeyRef.current !== markDeadSubjectKey) return lifecycleResponse

        const skippedSession = await transitionCurrentSession('skip', `Lead marked dead: ${markDeadReason}`)
        if (!skippedSession) {
          throw new DialerOperationHoldRetainedError(
            'The lead was marked dead, but the dialer could not safely advance. Reload after the CRM change hold expires.',
          )
        }
        return lifecycleResponse
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Could not mark lead dead')
      }
      setShowMarkDead(false)
      setMarkDeadReason('')
      setMarkDeadNotes('')
      refreshActivities()
      if (!durableSessionId) {
        advance(true)
      }
    } catch (e) {
      setMarkDeadError(e instanceof Error ? e.message : 'Could not mark lead dead')
    } finally {
      setMarkDeadBusy(false)
    }
  }, [currentLeadId, currentSubjectKey, durableSessionId, markDeadReason, markDeadNotes, advance, controlLocked, refreshActivities, transitionCurrentSession])
  const { ownerName, situsAddress, occupancy, delinquentYears } = useMemo(
    () => resolveProspectingCallingSellerContext(currentProspect, currentLead),
    [currentProspect, currentLead],
  )

  const currentCoOwners = currentLeadId ? coOwners[currentLeadId] ?? [] : []

  const inferredQueueLabel = sessionQueueLabelParam || campaignPreview.name ||
    (params.get('cohort') === 'deceased-2-3yr'
      ? '3+ Year Deceased Tax'
      : delinquentYears
      ? `${delinquentYears} deceased tax list`
      : 'Dialer queue')
  if (!loading && subjects.length === 0 && !resolveError) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="ck-card p-8 max-w-md text-center">
          <Icon name="playlist_remove" className="!text-4xl text-[var(--ck-text-dim)] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-2">No calling session selected</p>
          <p className="text-xs text-[var(--ck-text-muted)] mb-6">Open or launch a campaign from Prospecting to begin calling.</p>
          <Link href="/prospecting" className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors">
            <Icon name="arrow_back" size="text-sm" /> Back to campaigns
          </Link>
        </div>
      </div>
    )
  }

  if (resolveError) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="ck-card p-8 max-w-md text-center">
          <Icon name="error_outline" className="!text-4xl text-[#E32E2E] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-2">Cannot start a dialing session</p>
          <p className="text-xs text-[var(--ck-text-muted)] mb-6">{resolveError}</p>
          <Link
            href="/contacts"
            className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Icon name="arrow_back" size="text-sm" /> Back to contacts
          </Link>
        </div>
      </div>
    )
  }

  if (loading || subjects.length === 0) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1700px] px-3 pb-24 pt-3 sm:px-5 lg:px-6">
      {readOnlyPreview && campaignPreview.hardStop ? <div className="mb-4"><StalePausedDialerHardStopBanner hardStop={campaignPreview.hardStop} canClear={false} /></div> : null}
      {controlSummary ? <ProspectingSessionTakeoverDialog
        summary={controlSummary}
        selectedCampaignId={controlSummary.campaignId}
        selectedCampaignName={controlSummary.campaignName}
        busy={controlBusy}
        error={controlError}
        onCancel={navigateAwayFromSession}
        onContinue={() => { void confirmControlTakeover() }}
      /> : null}
      <DialerSessionCommand
        queueLabel={inferredQueueLabel}
        currentIndex={currentIndex}
        queueSize={subjects.length}
        callerId={sessionCallerId}
        callerPolicyLabel={sessionCallerPolicyLabel}
        durableSessionId={durableSessionId}
        durableStatus={durableSession?.status}
        stopRequested={Boolean(durableSession?.stopRequestedAt)}
        todayMetrics={todayMetrics}
        queueState={queueState}
        controlsDocked={callRailOpen}
        actionPending={sessionActionPending || markDeadBusy}
        currentLeadId={currentLeadId}
        error={sessionError}
        readOnlyPreview={readOnlyPreview}
        controlUnavailable={controlLocked}
        onClose={() => { if (controlLocked) navigateAwayFromSession(); else void closeSession() }}
        onPause={() => { void pauseSession() }}
        onResume={() => { void transitionCurrentSession('resume') }}
        onEndSession={() => { void stopSession() }}
        onMarkDead={() => { setMarkDeadReason(''); setMarkDeadNotes(''); setMarkDeadError(null); setShowMarkDead(true) }}
        onPrevious={back}
        onSkip={() => { void skipCurrentLead() }}
      />

      {/* Calling floor: people and phone actions are primary; context remains bounded at the side. */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Primary workspace — the actual people and callable numbers. */}
        <main className="order-1 col-span-12 lg:col-span-8">
          {currentSubject && (
            <HeirsSection
              key={`${currentSubjectKey}:${autoStartEpoch}`}
              leadId={currentLeadId}
              prospectId={currentProspectId}
              campaignMemberId={currentSubject.campaignMemberId}
              deceasedOwnerName={ownerName}
              propertyAddress={situsAddress}
              dialerCallerId={sessionCallerId || null}
              dialerCallerPlan={sessionCallerPlan}
              callHammerEnabled={sessionUseCallHammer}
              ringCount={sessionRingCount}
              dialerSessionId={durableSessionId || null}
              readOnlyPreview={readOnlyPreview || controlLocked}
              {...heirsAutoStart}
              onAutoStartHandled={() => setAutoQueueSubjectKey(null)}
              onAutoStartEmpty={handleAutoStartEmpty}
              defaultExpanded
              collapsible={false}
              showAllPhones
              onSmsPhone={!readOnlyPreview && !controlLocked && currentLeadId && currentSubjectKey
                ? (target) => setSmsTarget({ ...target, leadId: currentLeadId, subjectKey: currentSubjectKey })
                : undefined}
              onContactNoteSaved={() => { void refreshActivities() }}
            />
          )}
        </main>

        {/* Supporting rail — sticky, internally bounded, and limited to this seller. */}
        <ProspectingCallingContextRail
          fullWidth={false}
          leadId={currentLeadId}
          lead={currentLead}
          prospect={currentProspect}
          ownerName={ownerName}
          situsAddress={situsAddress}
          coOwners={currentCoOwners}
          occupancy={occupancy}
          delinquentYears={delinquentYears}
          durableSessionId={durableSessionId}
          activities={activities}
          activeTab={leftTab}
          callerId={sessionCallerId}
          readOnlyPreview={readOnlyPreview || controlLocked}
          onTabChange={setLeftTab}
          onRefreshActivities={() => { void refreshActivities() }}
        />
      </div>

      {/* SMS composer — pinned to the property lead so the SMS logs there. */}
      {smsTarget && smsOriginLead && currentSubjectKey === smsTarget.subjectKey && (
        <SmsComposeModal
          key={smsTarget.subjectKey}
          lead={{
            id: smsOriginLead.id,
            full_name: smsTarget.heirName,
            phone: smsTarget.phone,
            email: null,
            property_address: situsAddress,
            assigned_agent: null,
            city: smsOriginLead.city,
            state: smsOriginLead.state,
            zip: smsOriginLead.zip,
          }}
          initialTab="sms"
          conversationSource="heir_dialer"
          prospectPhoneId={smsTarget.prospectPhoneId}
          heirName={smsTarget.heirName}
          heirRelation={smsTarget.relation}
          prospectOwnerName={smsTarget.deceasedOwnerName}
          defaultFromPhone={sessionCallerId || null}
          dialerSessionId={durableSessionId || null}
          onClose={() => setSmsTarget(null)}
          onSent={() => { setSmsTarget(null); refreshActivities() }}
        />
      )}

      {showMarkDead ? <ProspectingMarkDeadDialog
        ownerName={ownerName}
        propertyAddress={situsAddress}
        reason={markDeadReason}
        notes={markDeadNotes}
        error={markDeadError}
        busy={markDeadBusy}
        onReasonChange={(reason) => { setMarkDeadReason(reason); setMarkDeadError(null) }}
        onNotesChange={(notes) => { setMarkDeadNotes(notes); setMarkDeadError(null) }}
        onClose={() => setShowMarkDead(false)}
        onSubmit={() => { void markLeadDead() }}
      /> : null}
    </div>
  )
}
