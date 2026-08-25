'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceCallRailOpen } from '@/components/conversations/workspace-frame'
import { formatPhone, toProperCase } from '@/lib/format'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { normalizeDialerCallerPlan, parseCallerIdsCsv } from '@/lib/dialer-caller-plan'
import { loadDialerActivities, type DialerActivity as Activity } from '@/lib/dialer-lead-activity'
import { DialerSessionCommand } from '@/components/dialer/dialer-session-command'
import { ProspectingCallingContextRail } from '@/components/prospecting/prospecting-calling-context-rail'
import { ProspectingMarkDeadDialog } from '@/components/prospecting/prospecting-mark-dead-dialog'
import {
  loadDurableDialerSession,
  transitionDurableDialerSession,
  type DurableDialerSession,
  type DurableDialerQueueSubject,
} from '@/lib/dialer-session-client'
import type {
  ProspectingCallingLead as LeadSummary,
  ProspectingCallingProspect as ProspectSummary,
  ProspectingCallingQueueState as QueueState,
  ProspectingCallingTab,
  ProspectingOccupancy,
  ProspectingSmsTarget,
} from '@/components/prospecting/prospecting-calling-types'
import { useCampaignPreviewQueue } from '@/components/prospecting/use-campaign-preview-queue'
import { joinProspectingAddress as joinAddress } from '@/components/prospecting/prospecting-calling-utils'
import { useDialerPauseAndLeave } from '@/components/prospecting/use-dialer-pause-and-leave'

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

  // Activity feed for current lead
  const [activities, setActivities] = useState<Activity[]>([])
  const [leftTab, setLeftTab] = useState<ProspectingCallingTab>('texts')
  const currentLeadIdRef = useRef<string | null>(null)

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [autoQueueSubjectKey, setAutoQueueSubjectKey] = useState<string | null>(null)
  const [durableSession, setDurableSession] = useState<DurableDialerSession | null>(null)
  const [sessionActionPending, setSessionActionPending] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const campaignPreview = useCampaignPreviewQueue(readOnlyPreview ? previewCampaignId : null)

  // SMS compose state
  const [smsTarget, setSmsTarget] = useState<ProspectingSmsTarget | null>(null)

  // Session tally (Mojo-style HUD) + mark-lead-dead dialog
  const [sessionDials, setSessionDials] = useState(0)
  const [sessionContacts, setSessionContacts] = useState(0)
  const [showMarkDead, setShowMarkDead] = useState(false)
  const [markDeadReason, setMarkDeadReason] = useState('')
  const [markDeadNotes, setMarkDeadNotes] = useState('')
  const [markDeadBusy, setMarkDeadBusy] = useState(false)
  const [markDeadError, setMarkDeadError] = useState<string | null>(null)

  const currentSubject = subjects[currentIndex] ?? null
  const currentSubjectKey = currentSubject ? `${currentSubject.kind}:${currentSubject.id}` : null
  const currentLeadId: string | null = currentSubject?.leadId ?? null
  const currentProspectId: string | null = currentSubject?.prospectId ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentSubjectKey ? prospects[currentSubjectKey] ?? null : null
  const durableSessionId = params.get('session_id')?.trim() || ''
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
  const sessionRingCount = sessionRingCountParam && Number.isFinite(Number(sessionRingCountParam))
    ? Number(sessionRingCountParam)
    : null
  const sessionCallerPlan = useMemo(() => {
    const plan = normalizeDialerCallerPlan({
      mode: sessionCallerModeParam === 'rotation' ? 'rotation' : 'static',
      staticCallerId: sessionCallerId || DEFAULT_DIALER_CALLER_ID,
      rotationCallerIds: parseCallerIdsCsv(sessionRotationNumbersParam),
      rotateEveryCalls: sessionRotateEveryParam ? Number(sessionRotateEveryParam) : DEFAULT_ROTATION_EVERY_CALLS,
      redialCallerId: sessionRedialCallerId || null,
    }, sessionCallerId || DEFAULT_DIALER_CALLER_ID)
    return plan
  }, [sessionCallerId, sessionCallerModeParam, sessionRotateEveryParam, sessionRotationNumbersParam, sessionRedialCallerId])
  const sessionCallerPolicyLabel = sessionCallerPlan.mode === 'rotation' && sessionCallerPlan.rotationCallerIds.length > 1
    ? `Rotating ${sessionCallerPlan.rotationCallerIds.length} approved lines every ${sessionCallerPlan.rotateEveryCalls} calls`
    : sessionCallerId
      ? `Assigned line ${formatPhone(sessionCallerId)}`
      : 'Caller ID unavailable'
  const startIndexParam = params.get('start_index')

  useEffect(() => {
    currentLeadIdRef.current = currentLeadId
  }, [currentLeadId])

  // Resolve the durable subject queue. Legacy URLs remain Lead-only, while new
  // campaign sessions preserve unpromoted source Prospects without creating
  // shadow CRM Leads.
  useEffect(() => {
    async function resolveIds() {
      setLoading(true)
      setResolveError(null)
      if (readOnlyPreview) {
        setDurableSession(null)
        setSubjects(campaignPreview.subjects)
        setCurrentIndex(0)
        setSessionDials(0)
        setSessionContacts(0)
        setResolveError(campaignPreview.error)
        setLoading(campaignPreview.loading)
        return
      }
      if (durableSessionId) {
        try {
          const session = await loadDurableDialerSession(durableSessionId)
          setDurableSession(session)
          setSubjects(session.queueItems.length > 0
            ? session.queueItems
            : session.leadIds.map((id) => ({ kind: 'lead' as const, id, leadId: id, prospectId: null, campaignMemberId: null })))
          setCurrentIndex(session.currentIndex)
          setSessionDials(session.dialsCompleted)
          setSessionContacts(session.contacts)
          const autoStartKey = `savingkc:dialer-autostart:${session.id}`
          const autoStartRequested = window.sessionStorage.getItem(autoStartKey) === '1'
          if (autoStartRequested) window.sessionStorage.removeItem(autoStartKey)
          if (autoStartRequested && session.status === 'active' && !session.stopRequestedAt) setAutoQueueSubjectKey(`${session.currentSubjectKind}:${session.currentSubjectId}`)
          setLoading(false)
          return
        } catch (sessionError) {
          setResolveError(sessionError instanceof Error ? sessionError.message : 'Could not load the dialer session.')
          setSubjects([])
          setLoading(false)
          return
        }
      }
      setDurableSession(null)
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
  }, [campaignPreview.error, campaignPreview.loading, campaignPreview.subjects, durableSessionId, params, readOnlyPreview])

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

  // Load the bounded communication history for the current lead only.
  useEffect(() => {
    if (!currentLeadId) {
      setActivities([])
      return
    }
    const requestedLeadId = currentLeadId
    let cancelled = false
    void loadDialerActivities(requestedLeadId)
      .then((nextActivities) => {
        if (cancelled || currentLeadIdRef.current !== requestedLeadId) return
        setActivities(nextActivities)
      })
      .catch((error) => console.error('[Dialer] Could not load lead activity', error))
    return () => { cancelled = true }
  }, [currentLeadId])

  const refreshActivities = useCallback(async () => {
    if (!currentLeadId) return
    const requestedLeadId = currentLeadId
    try {
      const nextActivities = await loadDialerActivities(requestedLeadId)
      if (currentLeadIdRef.current === requestedLeadId) setActivities(nextActivities)
    } catch (error) {
      console.error('[Dialer] Could not refresh lead activity', error)
    }
  }, [currentLeadId])

  // Refresh activities when an attempt is logged.
  useEffect(() => {
    function onAttempt(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail || detail.leadId === currentLeadId) refreshActivities()
    }
    window.addEventListener('heir-attempt-logged', onAttempt)
    window.addEventListener('crm:disposition-logged', onAttempt)
    return () => {
      window.removeEventListener('heir-attempt-logged', onAttempt)
      window.removeEventListener('crm:disposition-logged', onAttempt)
    }
  }, [currentLeadId, refreshActivities])

  // Listen to queue-state events from the telephony bar
  useEffect(() => {
    function onState(e: Event) {
      setQueueState((e as CustomEvent).detail as QueueState)
    }
    window.addEventListener('heir-queue-state', onState)
    return () => window.removeEventListener('heir-queue-state', onState)
  }, [])

  const applyDurableSession = useCallback((session: DurableDialerSession) => {
    setDurableSession(session)
    setSubjects(session.queueItems.length > 0
      ? session.queueItems
      : session.leadIds.map((id) => ({ kind: 'lead' as const, id, leadId: id, prospectId: null, campaignMemberId: null })))
    setCurrentIndex(session.currentIndex)
    setSessionDials(session.dialsCompleted)
    setSessionContacts(session.contacts)
    if (session.status === 'active' && !session.stopRequestedAt) setAutoQueueSubjectKey(`${session.currentSubjectKind}:${session.currentSubjectId}`)
    if (session.stopRequestedAt) setAutoQueueSubjectKey(null)
    if (session.status === 'completed' || session.status === 'stopped') setAutoQueueSubjectKey(null)
  }, [])

  useEffect(() => {
    function onSessionState(event: Event) {
      const session = (event as CustomEvent).detail as DurableDialerSession | null
      if (session?.id === durableSessionId) applyDurableSession(session)
    }
    window.addEventListener('dialer-session-state', onSessionState)
    return () => window.removeEventListener('dialer-session-state', onSessionState)
  }, [applyDurableSession, durableSessionId])

  const advance = useCallback((autoQueueNextLead = false) => {
    const next = Math.min(currentIndex + 1, subjects.length - 1)
    setCurrentIndex(next)
    const nextSubject = subjects[next]
    if (autoQueueNextLead && next !== currentIndex && nextSubject) setAutoQueueSubjectKey(`${nextSubject.kind}:${nextSubject.id}`)
  }, [currentIndex, subjects])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const transitionCurrentSession = useCallback(async (
    action: 'pause' | 'resume' | 'request_stop' | 'stop' | 'skip',
    reason?: string,
  ) => {
    if (!durableSessionId) return null
    setSessionActionPending(true)
    setSessionError(null)
    try {
      const session = await transitionDurableDialerSession(durableSessionId, action, reason)
      applyDurableSession(session)
      window.dispatchEvent(new CustomEvent('dialer-session-state', { detail: session }))
      return session
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not update the dialer session.')
      return null
    } finally {
      setSessionActionPending(false)
    }
  }, [applyDurableSession, durableSessionId])

  const skipCurrentLead = useCallback(async () => {
    if (readOnlyPreview) {
      advance(false)
      return
    }
    if (!durableSessionId) {
      advance(true)
      return
    }
    await transitionCurrentSession('skip', 'Agent skipped this contact')
  }, [advance, durableSessionId, readOnlyPreview, transitionCurrentSession])

  const handleAutoStartEmpty = useCallback(() => {
    // A record with no callable heirs (never skip-traced, or already fully
    // worked) used to auto-advance here — which cascaded through every such
    // record in a burst and blew past deceased owners the agent still needs to
    // skip-trace. Instead, stop the auto-queue and rest on this record so the
    // agent stays in control (run skip trace, re-call, or press → to move on).
    // Auto-advance to the next record only happens after a record's heirs have
    // actually been called (the heir-queue-complete handler).
    setAutoQueueSubjectKey(null)
  }, [])

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
    const session = await transitionCurrentSession('request_stop')
    if (!session) return
    if (session.status === 'stopped') {
      navigateAwayFromSession()
      return
    }
    window.dispatchEvent(new CustomEvent('dialer-session-stop-requested', { detail: session }))
  }, [durableSessionId, navigateAwayFromSession, transitionCurrentSession])

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
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); void skipCurrentLead() }
      if (!durableSessionId && (e.key === 'k' || e.key === 'ArrowLeft')) { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, durableSessionId, skipCurrentLead])

  // Tally dials / contacts for the session HUD. crm:disposition-logged fires
  // once per saved call disposition and carries `reached` (the agent actually
  // talked to someone). Header-driven "mark dead" is not a dial, so it does not
  // dispatch this event.
  useEffect(() => {
    function onDispo(e: Event) {
      const detail = (e as CustomEvent).detail as { reached?: boolean } | null
      setSessionDials((n) => n + 1)
      if (detail?.reached) setSessionContacts((n) => n + 1)
    }
    window.addEventListener('crm:disposition-logged', onDispo)
    return () => window.removeEventListener('crm:disposition-logged', onDispo)
  }, [])

  const markLeadDead = useCallback(async () => {
    if (!currentLeadId || !markDeadReason) return
    if (markDeadReason === 'other' && !markDeadNotes.trim()) {
      setMarkDeadError('Add a note when Other is selected.')
      return
    }
    setMarkDeadBusy(true)
    setMarkDeadError(null)
    try {
      const res = await fetch(`/api/leads/${currentLeadId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transition',
          stage: 'dead',
          deadReason: markDeadReason,
          deadReasonNotes: markDeadNotes.trim() || null,
          reason: markDeadNotes.trim() || `Marked dead from dialer — ${markDeadReason.replace(/_/g, ' ')}`,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Could not mark lead dead')
      }
      setShowMarkDead(false)
      setMarkDeadReason('')
      setMarkDeadNotes('')
      refreshActivities()
      if (durableSessionId) {
        await transitionCurrentSession('skip', `Lead marked dead: ${markDeadReason}`)
      } else {
        advance(true)
      }
    } catch (e) {
      setMarkDeadError(e instanceof Error ? e.message : 'Could not mark lead dead')
    } finally {
      setMarkDeadBusy(false)
    }
  }, [currentLeadId, durableSessionId, markDeadReason, markDeadNotes, advance, refreshActivities, transitionCurrentSession])

  const ownerName = useMemo(() => {
    const raw = currentProspect?.owner_1 || currentLead?.full_name || 'Unknown'
    return toProperCase(raw)
  }, [currentProspect, currentLead])

  const situsAddress = joinAddress([
    currentProspect?.situs_street || currentLead?.property_address,
    currentProspect?.situs_city || currentLead?.city,
    currentProspect?.situs_state || currentLead?.state,
    currentProspect?.situs_zip || currentLead?.zip,
  ])
  // Occupancy is a source-backed prospect fact. Mailing-vs-situs remains a
  // deterministic fallback for older county rows that predate the column.
  const occupancy: ProspectingOccupancy | null = (() => {
    const sourceStatus = currentProspect?.occupancy_status?.trim().toLowerCase()
    if (sourceStatus === 'vacant') return { label: 'Vacant', tone: 'warn' }
    if (sourceStatus === 'absentee' || sourceStatus === 'non_owner_occupied') return { label: 'Absentee', tone: 'amber' }
    if (sourceStatus === 'owner_occupied' || sourceStatus === 'occupied') return { label: 'Owner occupied', tone: 'neutral' }
    const mailing = joinAddress([
      currentProspect?.mailing_street,
      currentProspect?.mailing_city,
      currentProspect?.mailing_state,
      currentProspect?.mailing_zip,
    ])
    if (!mailing) return null
    if (mailing !== situsAddress) return { label: 'Absentee', tone: 'amber' }
    return { label: 'Owner occupied', tone: 'neutral' }
  })()

  const currentCoOwners = currentLeadId ? coOwners[currentLeadId] ?? [] : []

  const delinquentYears = currentProspect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : currentProspect?.delinquent_years_category === '2yr'
    ? '2 yr'
    : null

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
      <DialerSessionCommand
        queueLabel={inferredQueueLabel}
        currentIndex={currentIndex}
        queueSize={subjects.length}
        callerId={sessionCallerId}
        callerPolicyLabel={sessionCallerPolicyLabel}
        durableSessionId={durableSessionId}
        durableStatus={durableSession?.status}
        stopRequested={Boolean(durableSession?.stopRequestedAt)}
        dials={sessionDials}
        contacts={sessionContacts}
        queueState={queueState}
        controlsDocked={callRailOpen}
        actionPending={sessionActionPending}
        currentLeadId={currentLeadId}
        error={sessionError}
        readOnlyPreview={readOnlyPreview}
        onClose={() => { void closeSession() }}
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
              key={currentSubjectKey}
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
              readOnlyPreview={readOnlyPreview}
              autoStart={autoQueueSubjectKey === currentSubjectKey}
              onAutoStartHandled={() => setAutoQueueSubjectKey(null)}
              onAutoStartEmpty={handleAutoStartEmpty}
              defaultExpanded
              collapsible={false}
              showAllPhones
              onSmsPhone={!readOnlyPreview && currentLeadId ? setSmsTarget : undefined}
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
          onTabChange={setLeftTab}
          onRefreshActivities={() => { void refreshActivities() }}
        />
      </div>

      {/* SMS composer — pinned to the property lead so the SMS logs there. */}
      {smsTarget && currentLeadId && currentLead && (
        <SmsComposeModal
          lead={{
            id: currentLead.id,
            full_name: smsTarget.heirName,
            phone: smsTarget.phone,
            email: null,
            property_address: situsAddress,
            assigned_agent: null,
            city: currentLead.city,
            state: currentLead.state,
            zip: currentLead.zip,
          }}
          initialTab="sms"
          conversationSource="heir_dialer"
          prospectPhoneId={smsTarget.prospectPhoneId}
          heirName={smsTarget.heirName}
          heirRelation={smsTarget.relation}
          prospectOwnerName={smsTarget.deceasedOwnerName}
          defaultFromPhone={sessionCallerId || null}
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
