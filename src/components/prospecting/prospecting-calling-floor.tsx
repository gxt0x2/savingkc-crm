'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'
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
} from '@/lib/dialer-session-client'
import type {
  ProspectingCallingLead as LeadSummary,
  ProspectingCallingProspect as ProspectSummary,
  ProspectingCallingTab,
  ProspectingOccupancy,
  ProspectingRecentCall as RecentCall,
  ProspectingSmsTarget,
} from '@/components/prospecting/prospecting-calling-types'

const HeirsSection = dynamic(() => import('@/components/leads/heirs-section').then((module) => module.HeirsSection))
const SmsComposeModal = dynamic(() => import('@/components/leads/sms-compose-modal').then((module) => module.SmsComposeModal))
interface QueueState {
  queueItem: {
    phone: string
    heirName: string
    relation: string
    prospect_phone_id: string
    leadId: string
  } | null
  queueIndex: number
  queueLength: number
  callDuration?: string | null
  status: 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'
}

const DEFAULT_DIALER_CALLER_ID = TWILIO_NUMBERS[0]?.value ?? ''
const DEFAULT_ROTATION_EVERY_CALLS = 50

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(', ')
}

export function ProspectingCallingFloor() {
  const router = useRouter()
  const params = useSearchParams()
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [leads, setLeads] = useState<Record<string, LeadSummary>>({})
  const [prospects, setProspects] = useState<Record<string, ProspectSummary | null>>({})
  const [coOwners, setCoOwners] = useState<Record<string, string[]>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resolveError, setResolveError] = useState<string | null>(null)

  // Activity feed for current lead
  const [activities, setActivities] = useState<Activity[]>([])
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([])
  const [leftTab, setLeftTab] = useState<ProspectingCallingTab>('texts')
  const currentLeadIdRef = useRef<string | null>(null)

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)
  const [autoQueueLeadId, setAutoQueueLeadId] = useState<string | null>(null)
  const [durableSession, setDurableSession] = useState<DurableDialerSession | null>(null)
  const [sessionActionPending, setSessionActionPending] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

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

  const currentLeadId: string | null = leadIds[currentIndex] ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentLeadId ? prospects[currentLeadId] ?? null : null
  const durableSessionId = params.get('session_id')?.trim() || ''
  const requestedCallerId = params.get('caller_id')?.trim() || ''
  const sessionCallerId = durableSession?.callerId || requestedCallerId
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
  const startIndexParam = params.get('start_index')

  useEffect(() => {
    currentLeadIdRef.current = currentLeadId
  }, [currentLeadId])

  // Resolve cohort → lead_ids
  useEffect(() => {
    async function resolveIds() {
      setLoading(true)
      setResolveError(null)
      if (durableSessionId) {
        try {
          const session = await loadDurableDialerSession(durableSessionId)
          setDurableSession(session)
          setLeadIds(session.leadIds)
          setCurrentIndex(session.currentIndex)
          setSessionDials(session.dialsCompleted)
          setSessionContacts(session.contacts)
          setLoading(false)
          return
        } catch (sessionError) {
          setResolveError(sessionError instanceof Error ? sessionError.message : 'Could not load the dialer session.')
          setLeadIds([])
          setLoading(false)
          return
        }
      }
      setDurableSession(null)
      const explicit = params.get('lead_ids')
      if (explicit) {
        const ids = explicit.split(',').map((s) => s.trim()).filter(Boolean)
        setLeadIds(ids)
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
        setLeadIds(ids)
        setLoading(false)
        return
      }
      setLeadIds([])
      setLoading(false)
    }
    resolveIds()
  }, [durableSessionId, params])

  useEffect(() => {
    if (durableSessionId) return
    if (leadIds.length === 0) return
    const requested = Number(startIndexParam ?? '0')
    const safeIndex = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
    const timeout = window.setTimeout(() => {
      setCurrentIndex(Math.min(safeIndex, Math.max(leadIds.length - 1, 0)))
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [durableSessionId, leadIds.length, startIndexParam])

  // Batch-load leads + prospects for the cohort
  useEffect(() => {
    if (leadIds.length === 0) return

    async function load() {
      const response = await fetch(`/api/dialer/queue?lead_ids=${encodeURIComponent(leadIds.join(','))}`, { cache: 'no-store' })
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
      leadIds.forEach((id) => { prospectMap[id] = null })
      ;(prospectRows as (ProspectSummary & { lead_id: string })[] | null)?.forEach((p) => {
        prospectMap[p.lead_id] = p
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
  }, [leadIds])

  // Load the bounded communication history for the current lead only.
  useEffect(() => {
    if (!currentLeadId) return
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

  useEffect(() => {
    if (leadIds.length === 0 || leftTab !== 'recent_calls') return
    async function loadRecentCalls() {
      try {
        const res = await fetch('/api/call-log?limit=50')
        const data = await res.json()
        if (res.ok) setRecentCalls((data.calls as RecentCall[]) || [])
      } catch {}
    }
    loadRecentCalls()
  }, [leadIds.length, leftTab])

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
    setLeadIds(session.leadIds)
    setCurrentIndex(session.currentIndex)
    setSessionDials(session.dialsCompleted)
    setSessionContacts(session.contacts)
    if (session.status === 'active' && session.currentLeadId) setAutoQueueLeadId(session.currentLeadId)
    if (session.status === 'completed' || session.status === 'stopped') setAutoQueueLeadId(null)
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
    const next = Math.min(currentIndex + 1, leadIds.length - 1)
    setCurrentIndex(next)
    if (autoQueueNextLead && next !== currentIndex) setAutoQueueLeadId(leadIds[next] || null)
  }, [currentIndex, leadIds])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const transitionCurrentSession = useCallback(async (
    action: 'pause' | 'resume' | 'stop' | 'skip',
    reason?: string,
  ) => {
    if (!durableSessionId) return null
    setSessionActionPending(true)
    setSessionError(null)
    try {
      const session = await transitionDurableDialerSession(durableSessionId, action, reason)
      applyDurableSession(session)
      return session
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not update the dialer session.')
      return null
    } finally {
      setSessionActionPending(false)
    }
  }, [applyDurableSession, durableSessionId])

  const skipCurrentLead = useCallback(async () => {
    if (!durableSessionId) {
      advance(true)
      return
    }
    await transitionCurrentSession('skip', 'Agent skipped this contact')
  }, [advance, durableSessionId, transitionCurrentSession])

  const handleAutoStartEmpty = useCallback(() => {
    // A record with no callable heirs (never skip-traced, or already fully
    // worked) used to auto-advance here — which cascaded through every such
    // record in a burst and blew past deceased owners the agent still needs to
    // skip-trace. Instead, stop the auto-queue and rest on this record so the
    // agent stays in control (run skip trace, re-call, or press → to move on).
    // Auto-advance to the next record only happens after a record's heirs have
    // actually been called (the heir-queue-complete handler).
    setAutoQueueLeadId(null)
  }, [])

  const navigateAwayFromSession = useCallback(() => {
    const returnTo = params.get('return_to')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo)
      return
    }
    router.push('/prospecting')
  }, [params, router])

  const closeSession = useCallback(async () => {
    if (durableSessionId && durableSession?.status === 'active') {
      const session = await transitionCurrentSession('pause')
      if (!session) return
    }
    navigateAwayFromSession()
  }, [durableSession, durableSessionId, navigateAwayFromSession, transitionCurrentSession])

  const stopSession = useCallback(async () => {
    if (!durableSessionId) {
      navigateAwayFromSession()
      return
    }
    const session = await transitionCurrentSession('stop')
    if (session) navigateAwayFromSession()
  }, [durableSessionId, navigateAwayFromSession, transitionCurrentSession])

  useEffect(() => {
    function onQueueComplete(e: Event) {
      if (durableSessionId) return
      const detail = (e as CustomEvent).detail
      if (detail?.leadId === currentLeadId) {
        setTimeout(() => advance(true), 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [currentLeadId, advance, durableSessionId])

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

  const inferredQueueLabel = sessionQueueLabelParam ||
    (params.get('cohort') === 'deceased-2-3yr'
      ? '3+ Year Deceased Tax'
      : delinquentYears
      ? `${delinquentYears} deceased tax list`
      : 'Dialer queue')
  if (!loading && leadIds.length === 0 && !resolveError) {
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

  if (loading || leadIds.length === 0) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 pb-24 sm:px-6 lg:px-8">
      <DialerSessionCommand
        queueLabel={inferredQueueLabel}
        currentIndex={currentIndex}
        queueSize={leadIds.length}
        callerId={sessionCallerId}
        durableSessionId={durableSessionId}
        durableStatus={durableSession?.status}
        dials={sessionDials}
        contacts={sessionContacts}
        queueState={queueState}
        actionPending={sessionActionPending}
        currentLeadId={currentLeadId}
        error={sessionError}
        onClose={() => { void closeSession() }}
        onResume={() => { void transitionCurrentSession('resume') }}
        onStop={() => { void stopSession() }}
        onMarkDead={() => { setMarkDeadReason(''); setMarkDeadNotes(''); setMarkDeadError(null); setShowMarkDead(true) }}
        onPrevious={back}
        onSkip={() => { void skipCurrentLead() }}
      />

      {/* Calling floor: the callable people lead; property context supports the call. */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Supporting rail — property context, AI evidence, and communications. */}
        <ProspectingCallingContextRail
          leadId={currentLeadId || ""}
          lead={currentLead}
          prospect={currentProspect}
          ownerName={ownerName}
          situsAddress={situsAddress}
          coOwners={currentCoOwners}
          occupancy={occupancy}
          delinquentYears={delinquentYears}
          durableSessionId={durableSessionId}
          activities={activities}
          recentCalls={recentCalls}
          activeTab={leftTab}
          callerId={sessionCallerId}
          currentIndex={currentIndex}
          queueSize={leadIds.length}
          onTabChange={setLeftTab}
          onRefreshActivities={() => { void refreshActivities() }}
        />

        {/* Primary workspace — the actual people and callable numbers. */}
        <main className="order-1 col-span-12 lg:col-span-8">
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-brand)]">Current seller group</p>
              <h2 className="mt-1 text-xl font-black tracking-[-0.02em] text-[var(--crm-ink)]">Reach the right person</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Verified contacts rise to the top. Blocked outcomes remain visible but cannot enter the call queue.</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">
              <Icon name="shield" size="text-sm" className="text-emerald-500" /> Safety checked before every dial
            </div>
          </div>
          {currentLeadId && (
            <HeirsSection
              key={currentLeadId}
              leadId={currentLeadId}
              deceasedOwnerName={ownerName}
              propertyAddress={situsAddress}
              dialerCallerId={sessionCallerId || null}
              dialerCallerPlan={sessionCallerPlan}
              callHammerEnabled={sessionUseCallHammer}
              ringCount={sessionRingCount}
              dialerSessionId={durableSessionId || null}
              autoStart={autoQueueLeadId === currentLeadId}
              onAutoStartHandled={() => setAutoQueueLeadId(null)}
              onAutoStartEmpty={handleAutoStartEmpty}
              defaultExpanded
              collapsible={false}
              onSmsPhone={setSmsTarget}
            />
          )}
        </main>
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
