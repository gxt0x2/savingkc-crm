'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { HeirsSection } from '@/components/leads/heirs-section'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { createClient } from '@/lib/supabase/client'
import { calculateTemperature } from '@/lib/lead-temperature'
import { toProperCase, formatPhone } from '@/lib/format'

// URL contract:
//   /dialer?lead_ids=<uuid>,<uuid>,...
//   /dialer?cohort=deceased-2-3yr   (shorthand; resolves to lead_ids client-side)

interface LeadSummary {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  is_favorite: boolean | null
}

interface ProspectSummary {
  id: string
  owner_1: string | null
  cumulative_due: number | null
  earliest_delinquent_year: number | null
  delinquent_years_category: string | null
  total_market_value: number | null
  zestimate: number | null
  situs_street: string | null
  situs_city: string | null
  situs_state: string | null
  situs_zip: string | null
  mailing_street: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  county: string | null
}

interface ManifestShape {
  owner?: { coOwners?: string[] }
  property?: { vacant?: boolean }
}

interface Activity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

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
  status: 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'
}

interface DialerQueueLead {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  state: string | null
  source: string | null
  station: string | null
  priority: string | null
  seller_situation: string | null
  motivation_score: number | null
  appointment_date: string | null
  created_at: string
  updated_at: string | null
}

interface QueueFollowup {
  lead_id: string | null
  activity_type: string
  metadata: { due_date?: string; status?: string; task_type?: string; title?: string } | null
  created_at: string
}

interface QueueContactActivity {
  lead_id: string | null
  activity_type: string
  created_at: string
}

interface QueueProspect {
  lead_id: string | null
  is_deceased: boolean | null
  delinquent_years_category: string | null
}

type QueuePreset = 'scheduled_today' | 'followups_today' | 'stale_30' | 'warm_followups' | 'cold_prospecting' | 'tax_2yr' | 'deceased_3yr' | 'priority' | 'next_step' | 'custom'
type QueueSort = 'recommended' | 'due_first' | 'oldest_contact' | 'newest' | 'oldest' | 'motivation' | 'name'

interface SavedDialerQueue {
  id: string
  name: string
  agent: string
  preset: QueuePreset
  campaign: string
  statusFilter: string
  priorityFilter: string
  minMotivation: number
  search: string
  sortBy: QueueSort
  visibleLimit: number
  createdAt: string
  updatedAt: string
}

const QUEUE_PRESETS: Array<{ id: QueuePreset; label: string; icon: string; description: string }> = [
  { id: 'scheduled_today', label: 'Calendar Scheduled Today', icon: 'today', description: 'Calendar tasks, callbacks, and appointments due today.' },
  { id: 'followups_today', label: 'Follow-ups Today', icon: 'event_upcoming', description: 'Callbacks and next-step work due now.' },
  { id: 'stale_30', label: 'Not Contacted in 30 Days', icon: 'history', description: 'Callable leads with no recent call, SMS, or voicemail activity.' },
  { id: 'warm_followups', label: 'Warm Follow-ups', icon: 'local_fire_department', description: 'Hot, high-priority, qualified, and motivated sellers.' },
  { id: 'cold_prospecting', label: 'Cold Prospecting', icon: 'ac_unit', description: 'Fresh or untouched records for outbound sessions.' },
  { id: 'tax_2yr', label: '2-Year Tax Delinquent', icon: 'request_quote', description: 'Tax delinquent prospects marked around two years.' },
  { id: 'deceased_3yr', label: '3+ Year Deceased Tax', icon: 'account_balance', description: 'Deceased-owner tax leads for the heir dialer workflow.' },
  { id: 'priority', label: 'Priority Queue', icon: 'priority_high', description: 'High intent by priority or motivation score.' },
  { id: 'next_step', label: 'Next-Step Date', icon: 'date_range', description: 'Leads with an appointment or next action date.' },
  { id: 'custom', label: 'Custom Filters', icon: 'tune', description: 'Build a session from campaign, status, score, and search.' },
]

const QUEUE_SORTS: Array<{ id: QueueSort; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'due_first', label: 'Due first' },
  { id: 'oldest_contact', label: 'Longest since contact' },
  { id: 'newest', label: 'Newest updated' },
  { id: 'oldest', label: 'Oldest updated' },
  { id: 'motivation', label: 'Motivation high to low' },
  { id: 'name', label: 'Name A-Z' },
]

function dateKey(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function queueLeadText(lead: DialerQueueLead) {
  return [
    lead.full_name,
    lead.phone,
    lead.property_address,
    lead.city,
    lead.state,
    lead.source,
    lead.station,
    lead.priority,
    lead.seller_situation,
  ].filter(Boolean).join(' ').toLowerCase()
}

function daysSince(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.floor((Date.now() - time) / 86_400_000)
}

function lastContactLabel(value: string | null | undefined) {
  const days = daysSince(value)
  if (days == null) return 'No contact'
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function formatSelectOption(option: string) {
  if (option === 'all') return 'All'
  const sort = QUEUE_SORTS.find((item) => item.id === option)
  if (sort) return sort.label
  return option.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactDollars(n: number | null | undefined): string {
  if (!n || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(', ')
}

function formatActivityTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function activityIcon(type: string, metadata: Record<string, unknown> | null): string {
  if (type === 'call') return 'call'
  if (type === 'sms' || type === 'sms_sent' || type === 'sms_received' || type === 'sms_inbound') return 'chat'
  if (type === 'email') return 'mail'
  if (type === 'note') return 'sticky_note_2'
  if (type === 'task') return 'task_alt'
  if ((metadata as { direction?: string } | null)?.direction === 'outbound') return 'call_made'
  return 'history'
}

function DialerPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [leads, setLeads] = useState<Record<string, LeadSummary>>({})
  const [prospects, setProspects] = useState<Record<string, ProspectSummary | null>>({})
  const [manifests, setManifests] = useState<Record<string, ManifestShape | null>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resolveError, setResolveError] = useState<string | null>(null)

  // Activity feed for current lead
  const [activities, setActivities] = useState<Activity[]>([])

  // Live queue state from telephony-bar
  const [queueState, setQueueState] = useState<QueueState | null>(null)

  // SMS compose state
  const [smsTarget, setSmsTarget] = useState<{ heirName: string; relation: string; phone: string } | null>(null)

  const currentLeadId: string | null = leadIds[currentIndex] ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentLeadId ? prospects[currentLeadId] ?? null : null
  const currentManifest: ManifestShape | null = currentLeadId ? manifests[currentLeadId] ?? null : null

  // Resolve cohort → lead_ids
  useEffect(() => {
    async function resolveIds() {
      setLoading(true)
      setResolveError(null)
      const explicit = params.get('lead_ids')
      if (explicit) {
        const ids = explicit.split(',').map((s) => s.trim()).filter(Boolean)
        setLeadIds(ids)
        setLoading(false)
        return
      }
      const cohort = params.get('cohort')
      if (cohort === 'deceased-2-3yr') {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('prospects')
          .select('lead_id')
          .eq('is_deceased', true)
          .in('delinquent_years_category', ['2yr', '3yr_plus'])
          .not('lead_id', 'is', null)
        if (error) { setResolveError(error.message); setLoading(false); return }
        const ids = Array.from(new Set<string>((data ?? [])
          .map((r: { lead_id: string | null }) => r.lead_id)
          .filter((v): v is string => Boolean(v))))
        setLeadIds(ids)
        setLoading(false)
        return
      }
      setLeadIds([])
      setLoading(false)
    }
    resolveIds()
  }, [params])

  // Batch-load leads + prospects for the cohort
  useEffect(() => {
    if (leadIds.length === 0) return
    const supabase = createClient()

    async function load() {
      const [{ data: leadRows }, { data: prospectRows }] = await Promise.all([
        supabase.from('leads')
          .select('id, full_name, phone, email, property_address, city, state, zip, county, is_favorite')
          .in('id', leadIds),
        supabase.from('prospects')
          .select('id, lead_id, owner_1, cumulative_due, earliest_delinquent_year, delinquent_years_category, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, mailing_street, mailing_city, mailing_state, mailing_zip, county')
          .in('lead_id', leadIds),
      ])
      const leadMap: Record<string, LeadSummary> = {}
      ;(leadRows as LeadSummary[] | null)?.forEach((l) => { leadMap[l.id] = l })
      setLeads(leadMap)

      const prospectMap: Record<string, ProspectSummary | null> = {}
      leadIds.forEach((id) => { prospectMap[id] = null })
      ;(prospectRows as (ProspectSummary & { lead_id: string })[] | null)?.forEach((p) => {
        prospectMap[p.lead_id] = p
      })
      setProspects(prospectMap)
    }
    load()
  }, [leadIds])

  // Load manifest + activities for the current lead only (small fetch, refreshed on advance)
  useEffect(() => {
    if (!currentLeadId) return
    const supabase = createClient()
    async function load() {
      const [{ data: mRow }, { data: aRows }] = await Promise.all([
        supabase.from('manifests').select('manifest').eq('lead_id', currentLeadId).limit(1).maybeSingle(),
        supabase.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at')
          .eq('lead_id', currentLeadId).order('created_at', { ascending: false }).limit(20),
      ])
      setManifests((prev) => ({ ...prev, [currentLeadId!]: (mRow as { manifest: ManifestShape } | null)?.manifest ?? null }))
      setActivities((aRows as Activity[] | null) ?? [])
    }
    load()
  }, [currentLeadId])

  const refreshActivities = useCallback(async () => {
    if (!currentLeadId) return
    const supabase = createClient()
    const { data } = await supabase
      .from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', currentLeadId)
      .order('created_at', { ascending: false })
      .limit(20)
    setActivities((data as Activity[] | null) ?? [])
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

  const advance = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, leadIds.length - 1))
  }, [leadIds.length])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  const closeSession = useCallback(() => {
    const returnTo = params.get('return_to')
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo)
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/dialer')
  }, [params, router])

  useEffect(() => {
    function onQueueComplete(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.leadId === currentLeadId) {
        setTimeout(advance, 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [currentLeadId, advance])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); advance() }
      if (e.key === 'k' || e.key === 'ArrowLeft')  { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, back])

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
  // Occupancy status — prefer the manifest's vacant flag, then the mailing vs
  // situs comparison (absentee when tax bill goes somewhere other than the
  // property). Default is owner-occupied when we can tell, null otherwise.
  type Occupancy = { label: 'Vacant' | 'Absentee' | 'Owner occupied'; tone: 'warn' | 'amber' | 'neutral' }
  const occupancy: Occupancy | null = (() => {
    if (currentManifest?.property?.vacant === true) return { label: 'Vacant', tone: 'warn' }
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

  const coOwners: string[] = (currentManifest?.owner?.coOwners ?? []).filter(Boolean)

  const delinquentYears = currentProspect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : currentProspect?.delinquent_years_category === '2yr'
    ? '2 yr'
    : null

  const isCallingNow = queueState?.queueItem && ['calling', 'on_call'].includes(queueState.status)

  if (!loading && leadIds.length === 0 && !resolveError) {
    return <DialerHome />
  }

  if (resolveError) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="ck-card p-8 max-w-md text-center">
          <Icon name="error_outline" className="!text-4xl text-[#E32E2E] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-2">Cannot start a dialing session</p>
          <p className="text-xs text-[var(--ck-text-muted)] mb-6">{resolveError}</p>
          <Link
            href="/leads"
            className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
          >
            <Icon name="arrow_back" size="text-sm" /> Back to leads
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
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
      {/* Session header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={closeSession}
            className="shrink-0 w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text-muted)] flex items-center justify-center transition-colors"
            title="Exit session"
            aria-label="Exit session"
          >
            <Icon name="close" size="text-xl" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E]">
              Dialing session
            </p>
            <p className="text-sm font-bold text-[var(--ck-text)]">
              Lead {currentIndex + 1} of {leadIds.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={back}
            disabled={currentIndex === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] text-xs font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Previous lead (←)"
          >
            <Icon name="chevron_left" size="text-sm" /> Prev
          </button>
          <button
            onClick={advance}
            disabled={currentIndex >= leadIds.length - 1}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] text-xs font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Next lead (→)"
          >
            Next <Icon name="chevron_right" size="text-sm" />
          </button>
        </div>
      </div>

      {/* Now Calling banner — sticks just below the session header */}
      {queueState?.queueItem && (
        <div
          className={`mb-4 rounded-xl border p-4 flex items-center justify-between gap-4 ${
            isCallingNow ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[#E32E2E]/10 border-[#E32E2E]/30'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`shrink-0 w-2.5 h-2.5 rounded-full ${
                isCallingNow ? 'bg-emerald-400 animate-pulse' : 'bg-[#E32E2E]'
              }`}
            />
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-widest ${isCallingNow ? 'text-emerald-400' : 'text-[#E32E2E]'}`}>
                {isCallingNow ? (queueState.status === 'on_call' ? 'On call now' : 'Dialing now') : 'Queued'}
              </p>
              <p className="text-sm font-bold text-[var(--ck-text)] truncate">
                {queueState.queueItem.heirName}
                <span className="text-[var(--ck-text-muted)] font-normal capitalize"> · {queueState.queueItem.relation}</span>
              </p>
              <p className="text-xs font-mono text-[var(--ck-text-muted)]">{formatPhone(queueState.queueItem.phone)}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Heir</p>
            <p className="text-sm font-bold text-[var(--ck-text)] tabular-nums">
              {queueState.queueIndex + 1} / {queueState.queueLength}
            </p>
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* LEFT — property context + activity */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <section className="ck-card p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-1">
                  Subject property
                </p>
                <h1 className="text-xl font-black text-[var(--ck-text)] leading-tight truncate">
                  {currentProspect?.situs_street || currentLead?.property_address || '—'}
                </h1>
                <p className="text-sm text-[var(--ck-text-muted)] mt-0.5">
                  {joinAddress([currentProspect?.situs_city || currentLead?.city, currentProspect?.situs_state || currentLead?.state])}
                  {(currentProspect?.situs_zip || currentLead?.zip) ? ` ${currentProspect?.situs_zip || currentLead?.zip}` : ''}
                </p>
              </div>
              <Link
                href={`/leads/${currentLeadId}`}
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] rounded-md px-2 py-1 transition-colors"
                title="Open full lead profile in a new tab"
                target="_blank"
              >
                Profile <Icon name="open_in_new" size="text-xs" />
              </Link>
            </div>


            {/* Deceased owner + co-owners + taxpayer */}
            <div className="mb-4 p-3 rounded-lg bg-[#E32E2E]/10 border border-[#E32E2E]/30">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] mb-1">
                Owner of record
              </p>
              <p className="text-sm font-bold text-[var(--ck-text)]">{ownerName}</p>
              <p className="text-[10px] text-[var(--ck-text-dim)] uppercase tracking-wider mt-0.5">Deceased · tax bill is in this name</p>
              {coOwners.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#E32E2E]/20">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-1.5">
                    Co-owners on title
                  </p>
                  <ul className="space-y-0.5">
                    {coOwners.map((name) => (
                      <li key={name} className="text-xs text-[var(--ck-text)] flex items-center gap-1.5">
                        <Icon name="person" size="text-xs" className="text-[var(--ck-text-dim)]" />
                        {toProperCase(name)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Signal chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {occupancy && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
                    occupancy.tone === 'warn'
                      ? 'bg-[#E32E2E]/15 border-[#E32E2E]/40 text-[#E32E2E]'
                      : occupancy.tone === 'amber'
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  }`}
                >
                  {occupancy.label}
                </span>
              )}
              {currentProspect?.county && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)]">
                  {currentProspect.county} county
                </span>
              )}
              {delinquentYears && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  {delinquentYears} delinquent
                </span>
              )}
              {currentProspect?.earliest_delinquent_year && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text-muted)]">
                  since {currentProspect.earliest_delinquent_year}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Taxes owed</p>
                <p className="text-lg font-black text-[#E32E2E] tabular-nums">{compactDollars(currentProspect?.cumulative_due)}</p>
              </div>
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Zestimate</p>
                <p className="text-lg font-black text-[var(--ck-text)] tabular-nums">{compactDollars(currentProspect?.zestimate)}</p>
              </div>
              <div className="ck-card-elev p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] mb-1">Market</p>
                <p className="text-lg font-black text-[var(--ck-text)] tabular-nums">{compactDollars(currentProspect?.total_market_value)}</p>
              </div>
            </div>
          </section>

          {/* Activity feed — last 20 events on the property lead */}
          <section className="ck-card p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
                Activity
              </p>
              <span className="text-[10px] text-[var(--ck-text-dim)]">{activities.length} recent</span>
            </div>
            {activities.length === 0 ? (
              <p className="text-xs text-[var(--ck-text-dim)] italic py-4 text-center">No activity yet on this lead.</p>
            ) : (
              <ul className="space-y-2.5">
                {activities.map((a) => {
                  const md = (a.metadata ?? {}) as {
                    heir_name?: string
                    heir_relation?: string
                    disposition?: string
                    direction?: string
                    duration?: number
                  }
                  return (
                    <li key={a.id} className="flex items-start gap-2.5">
                      <span className="shrink-0 w-6 h-6 rounded-md bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] flex items-center justify-center text-[var(--ck-text-muted)] mt-0.5">
                        <Icon name={activityIcon(a.activity_type, a.metadata)} size="text-sm" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[var(--ck-text)] leading-snug">
                          {a.description || a.activity_type.replace(/_/g, ' ')}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-[var(--ck-text-dim)]">{formatActivityTime(a.created_at)}</span>
                          {md.heir_relation && (
                            <span className="text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">· {md.heir_relation}</span>
                          )}
                          {md.disposition && (
                            <span className="text-[10px] uppercase tracking-wider text-emerald-400">· {md.disposition.replace(/_/g, ' ')}</span>
                          )}
                          {typeof md.duration === 'number' && md.duration > 0 && (
                            <span className="text-[10px] text-[var(--ck-text-dim)]">· {md.duration}s</span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Progress ribbon */}
          <section className="ck-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Progress</p>
              <p className="text-[10px] font-bold text-[var(--ck-text-muted)] tabular-nums">
                {currentIndex + 1} / {leadIds.length}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--ck-surface-hi)] overflow-hidden">
              <div
                className="h-full bg-[#E32E2E] transition-all"
                style={{ width: `${Math.round(((currentIndex + 1) / leadIds.length) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--ck-text-dim)] mt-3">
              <kbd className="text-[9px] font-mono bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded px-1">J</kbd> next ·
              <kbd className="text-[9px] font-mono bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded px-1 ml-1">K</kbd> prev
            </p>
          </section>
        </div>

        {/* RIGHT — heirs + dial queue */}
        <div className="col-span-12 lg:col-span-7">
          {currentLeadId && (
            <HeirsSection
              key={currentLeadId}
              leadId={currentLeadId}
              deceasedOwnerName={ownerName}
              propertyAddress={situsAddress}
              defaultExpanded
              collapsible={false}
              onSmsPhone={setSmsTarget}
            />
          )}
        </div>
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
          onClose={() => setSmsTarget(null)}
          onSent={() => { setSmsTarget(null); refreshActivities() }}
        />
      )}
    </div>
  )
}

function DialerHome() {
  const router = useRouter()
  const [leads, setLeads] = useState<DialerQueueLead[]>([])
  const [followups, setFollowups] = useState<QueueFollowup[]>([])
  const [contactActivities, setContactActivities] = useState<QueueContactActivity[]>([])
  const [prospects, setProspects] = useState<QueueProspect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<QueuePreset>('scheduled_today')
  const [campaign, setCampaign] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [minMotivation, setMinMotivation] = useState(0)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<QueueSort>('recommended')
  const [visibleLimit, setVisibleLimit] = useState(25)
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set())
  const [savedQueues, setSavedQueues] = useState<SavedDialerQueue[]>([])
  const [savedQueueName, setSavedQueueName] = useState('')
  const [activeSavedQueueId, setActiveSavedQueueId] = useState('')
  const [savedQueueError, setSavedQueueError] = useState<string | null>(null)
  const [showQueueControls, setShowQueueControls] = useState(false)
  const [agent, setAgent] = useState('Casey')
  const [mode, setMode] = useState<'power' | 'predictive'>('power')
  const [pacing, setPacing] = useState(18)

  const loadSavedQueues = useCallback(async () => {
    setSavedQueueError(null)
    try {
      const response = await fetch('/api/dialer/saved-lists', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        setSavedQueueError(payload?.error || 'Could not load saved lists.')
        setSavedQueues([])
        return
      }
      setSavedQueues((payload.savedLists || []) as SavedDialerQueue[])
    } catch {
      setSavedQueueError('Could not load saved lists.')
      setSavedQueues([])
    }
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const [{ data: leadRows, error: leadError }, { data: followupRows }, { data: contactRows }, { data: prospectRows }] = await Promise.all([
        supabase
          .from('leads')
          .select('id, full_name, phone, property_address, city, state, source, station, priority, seller_situation, motivation_score, appointment_date, created_at, updated_at')
          .not('phone', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1000),
        supabase
          .from('lead_activities')
          .select('lead_id, activity_type, metadata, created_at')
          .in('activity_type', ['task', 'appointment', 'follow_up', 'callback', 'send_offer'])
          .limit(1000),
        supabase
          .from('lead_activities')
          .select('lead_id, activity_type, created_at')
          .in('activity_type', ['call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound'])
          .not('lead_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase
          .from('prospects')
          .select('lead_id, is_deceased, delinquent_years_category')
          .not('lead_id', 'is', null)
          .limit(2000),
      ])

      if (leadError) {
        setError(leadError.message)
        setLeads([])
      } else {
        setLeads((leadRows as DialerQueueLead[] | null) ?? [])
      }
      setFollowups((followupRows as QueueFollowup[] | null) ?? [])
      setContactActivities((contactRows as QueueContactActivity[] | null) ?? [])
      setProspects((prospectRows as QueueProspect[] | null) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadSavedQueues() }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadSavedQueues])

  const today = dateKey(new Date().toISOString())
  const followupLeadIds = useMemo(() => {
    return new Set(followups
      .filter((task) => {
        const status = task.metadata?.status || 'pending'
        const dueDate = dateKey(task.metadata?.due_date)
        return status !== 'completed' && Boolean(dueDate) && dueDate <= today
      })
      .map((task) => task.lead_id)
      .filter(Boolean) as string[])
  }, [followups, today])

  const scheduledTodayLeadIds = useMemo(() => {
    const ids = new Set<string>()
    followups.forEach((task) => {
      const status = task.metadata?.status || 'pending'
      if (status === 'completed') return
      if (dateKey(task.metadata?.due_date) === today && task.lead_id) ids.add(task.lead_id)
    })
    leads.forEach((lead) => {
      if (dateKey(lead.appointment_date) === today) ids.add(lead.id)
    })
    return ids
  }, [followups, leads, today])

  const lastContactByLeadId = useMemo(() => {
    const map = new Map<string, string>()
    contactActivities.forEach((activity) => {
      if (!activity.lead_id) return
      const current = map.get(activity.lead_id)
      if (!current || new Date(activity.created_at).getTime() > new Date(current).getTime()) {
        map.set(activity.lead_id, activity.created_at)
      }
    })
    return map
  }, [contactActivities])

  const prospectByLeadId = useMemo(() => {
    const map = new Map<string, QueueProspect[]>()
    prospects.forEach((prospect) => {
      if (!prospect.lead_id) return
      map.set(prospect.lead_id, [...(map.get(prospect.lead_id) ?? []), prospect])
    })
    return map
  }, [prospects])

  const sourceOptions = useMemo(() => {
    return ['all', ...Array.from(new Set(leads.map((lead) => lead.source).filter(Boolean) as string[])).sort()]
  }, [leads])

  const statusOptions = useMemo(() => {
    return ['all', ...Array.from(new Set(leads.map((lead) => lead.station || 'intake'))).sort()]
  }, [leads])

  const queue = useMemo(() => {
    const query = search.trim().toLowerCase()
    return leads
      .filter((lead) => {
        const leadProspects = prospectByLeadId.get(lead.id) ?? []
        const temp = calculateTemperature({ priority: lead.priority, station: lead.station, created_at: lead.created_at })
        const lastContact = lastContactByLeadId.get(lead.id)
        const staleDays = daysSince(lastContact)
        if (preset === 'scheduled_today') return scheduledTodayLeadIds.has(lead.id)
        if (preset === 'followups_today') return followupLeadIds.has(lead.id) || dateKey(lead.appointment_date) === today
        if (preset === 'stale_30') return staleDays == null || staleDays >= 30
        if (preset === 'warm_followups') return lead.priority === 'hot' || lead.priority === 'high' || (lead.motivation_score || 0) >= 5 || temp === 'hot' || temp === 'warm'
        if (preset === 'cold_prospecting') return ['new', 'intake', 'not_contacted', '', null].includes(lead.station as string | null) && !['hot', 'high'].includes(lead.priority || '')
        if (preset === 'tax_2yr') return leadProspects.some((prospect) => prospect.delinquent_years_category === '2yr')
        if (preset === 'deceased_3yr') return leadProspects.some((prospect) => prospect.is_deceased && ['2yr', '3yr_plus'].includes(prospect.delinquent_years_category || ''))
        if (preset === 'priority') return lead.priority === 'hot' || lead.priority === 'high' || (lead.motivation_score || 0) >= 7
        if (preset === 'next_step') return Boolean(lead.appointment_date)
        return true
      })
      .filter((lead) => campaign === 'all' || lead.source === campaign)
      .filter((lead) => statusFilter === 'all' || (lead.station || 'intake') === statusFilter)
      .filter((lead) => priorityFilter === 'all' || lead.priority === priorityFilter)
      .filter((lead) => (lead.motivation_score || 0) >= minMotivation)
      .filter((lead) => !query || queueLeadText(lead).includes(query))
      .sort((a, b) => {
        const aDue = followupLeadIds.has(a.id) || scheduledTodayLeadIds.has(a.id) ? 1 : 0
        const bDue = followupLeadIds.has(b.id) || scheduledTodayLeadIds.has(b.id) ? 1 : 0
        const aScore = (a.motivation_score || 0) + (a.priority === 'hot' ? 4 : a.priority === 'high' ? 2 : 0)
        const bScore = (b.motivation_score || 0) + (b.priority === 'hot' ? 4 : b.priority === 'high' ? 2 : 0)
        const aUpdated = new Date(a.updated_at || a.created_at).getTime()
        const bUpdated = new Date(b.updated_at || b.created_at).getTime()
        const aContact = lastContactByLeadId.get(a.id)
        const bContact = lastContactByLeadId.get(b.id)
        const aContactTime = aContact ? new Date(aContact).getTime() : 0
        const bContactTime = bContact ? new Date(bContact).getTime() : 0

        if (sortBy === 'due_first') return bDue - aDue || bScore - aScore || bUpdated - aUpdated
        if (sortBy === 'oldest_contact') return aContactTime - bContactTime || bScore - aScore
        if (sortBy === 'newest') return bUpdated - aUpdated
        if (sortBy === 'oldest') return aUpdated - bUpdated
        if (sortBy === 'motivation') return (b.motivation_score || 0) - (a.motivation_score || 0) || bScore - aScore
        if (sortBy === 'name') return (a.full_name || '').localeCompare(b.full_name || '')
        if (aDue !== bDue) return bDue - aDue
        if (aScore !== bScore) return bScore - aScore
        return bUpdated - aUpdated
      })
  }, [campaign, followupLeadIds, lastContactByLeadId, leads, minMotivation, preset, priorityFilter, prospectByLeadId, scheduledTodayLeadIds, search, sortBy, statusFilter, today])

  const selectedQueue = useMemo(() => {
    return queue.filter((lead) => selectedLeadIds.has(lead.id))
  }, [queue, selectedLeadIds])

  const startQueue = useCallback(() => {
    const source = selectedQueue.length > 0 ? selectedQueue : queue
    const ids = source.slice(0, 100).map((lead) => lead.id)
    if (ids.length > 0) router.push(`/dialer?lead_ids=${ids.join(',')}&return_to=/dialer`)
  }, [queue, router, selectedQueue])

  const currentLead = selectedQueue[0] ?? queue[0] ?? null
  const selectedPreset = QUEUE_PRESETS.find((item) => item.id === preset) ?? QUEUE_PRESETS[0]
  const previewLeads = queue.slice(0, visibleLimit)
  const selectedVisibleCount = previewLeads.filter((lead) => selectedLeadIds.has(lead.id)).length
  const selectedCount = selectedQueue.length
  const hasFilters = campaign !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || minMotivation > 0 || search.trim().length > 0
  const activeFilterCount = [campaign !== 'all', statusFilter !== 'all', priorityFilter !== 'all', minMotivation > 0, search.trim().length > 0].filter(Boolean).length
  const resetFilters = useCallback(() => {
    setCampaign('all')
    setStatusFilter('all')
    setPriorityFilter('all')
    setMinMotivation(0)
    setSearch('')
    setSelectedLeadIds(new Set())
  }, [])
  const toggleLeadSelection = useCallback((leadId: string) => {
    setSelectedLeadIds((current) => {
      const next = new Set(current)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }, [])
  const selectVisibleLeads = useCallback(() => {
    setSelectedLeadIds((current) => {
      const next = new Set(current)
      previewLeads.forEach((lead) => next.add(lead.id))
      return next
    })
  }, [previewLeads])
  const clearSelectedLeads = useCallback(() => setSelectedLeadIds(new Set()), [])
  const applySavedQueue = useCallback((savedQueue: SavedDialerQueue) => {
    setPreset(savedQueue.preset)
    setAgent(savedQueue.agent)
    setCampaign(savedQueue.campaign)
    setStatusFilter(savedQueue.statusFilter)
    setPriorityFilter(savedQueue.priorityFilter)
    setMinMotivation(savedQueue.minMotivation)
    setSearch(savedQueue.search)
    setSortBy(savedQueue.sortBy)
    setVisibleLimit(savedQueue.visibleLimit)
    setActiveSavedQueueId(savedQueue.id)
    setSavedQueueName(savedQueue.name)
    setSelectedLeadIds(new Set())
  }, [])
  const saveCurrentQueue = useCallback(async () => {
    const name = savedQueueName.trim() || selectedPreset.label
    const existingId = activeSavedQueueId && savedQueues.some((item) => item.id === activeSavedQueueId) ? activeSavedQueueId : undefined
    const response = await fetch('/api/dialer/saved-lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: existingId,
        agent,
        name,
        preset,
        campaign,
        statusFilter,
        priorityFilter,
        minMotivation,
        search,
        sortBy,
        visibleLimit,
      }),
    })
    const payload = await response.json()
    if (!response.ok) {
      setSavedQueueError(payload?.error || 'Could not save list.')
      return
    }
    const savedQueue = payload.savedList as SavedDialerQueue
    setSavedQueues((current) => {
      const withoutCurrent = current.filter((item) => item.id !== savedQueue.id)
      return [savedQueue, ...withoutCurrent].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    })
    setActiveSavedQueueId(savedQueue.id)
    setSavedQueueName(savedQueue.name)
    setSavedQueueError(null)
  }, [activeSavedQueueId, agent, campaign, minMotivation, preset, priorityFilter, savedQueueName, savedQueues, search, selectedPreset.label, sortBy, statusFilter, visibleLimit])
  const deleteSavedQueue = useCallback(async () => {
    if (!activeSavedQueueId) return
    const response = await fetch(`/api/dialer/saved-lists?id=${encodeURIComponent(activeSavedQueueId)}`, { method: 'DELETE' })
    const payload = await response.json()
    if (!response.ok) {
      setSavedQueueError(payload?.error || 'Could not delete list.')
      return
    }
    setSavedQueues((current) => current.filter((item) => item.id !== activeSavedQueueId))
    setActiveSavedQueueId('')
    setSavedQueueName('')
    setSavedQueueError(null)
  }, [activeSavedQueueId])

  const selectedSavedQueue: SavedDialerQueue | null = activeSavedQueueId
    ? savedQueues.find((item) => item.id === activeSavedQueueId) ?? null
    : null

  return (
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-[var(--ck-text)] tracking-tight">Calling Command Center</h1>
          <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Pick a queue, confirm the session, start calling.</p>
        </div>
        <div className="text-sm font-bold text-[var(--ck-text-muted)]">
          {loading ? 'Loading queue...' : selectedCount > 0 ? `${selectedCount.toLocaleString()} selected` : `${queue.length.toLocaleString()} ready`}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-4 text-sm text-[#ffb4b4]">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <main className="space-y-5">
          <section className="ck-card p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Calling Queue</span>
                <select
                  value={preset}
                  onChange={(event) => {
                    setPreset(event.target.value as QueuePreset)
                    setSelectedLeadIds(new Set())
                  }}
                  className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-3 text-base font-bold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                >
                  {QUEUE_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={startQueue}
                disabled={queue.length === 0}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#E32E2E] px-4 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Icon name="play_arrow" size="text-sm" /> {selectedCount > 0 ? `Start ${selectedCount}` : 'Start Queue'}
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2 text-sm text-[var(--ck-text-muted)] sm:flex-row sm:items-center sm:justify-between">
              <span>{selectedPreset.description}</span>
              <span className="font-bold text-[var(--ck-text)]">{loading ? '...' : queue.length.toLocaleString()} leads</span>
            </div>

            <button
              onClick={() => setShowQueueControls((value) => !value)}
              className="mt-5 flex w-full items-center justify-between rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
              aria-expanded={showQueueControls}
            >
              <span>
                Saved lists and filters
                {activeFilterCount > 0 && <span className="ml-2 text-[#ff7777]">{activeFilterCount} active</span>}
              </span>
              <Icon name={showQueueControls ? 'expand_less' : 'expand_more'} size="text-lg" />
            </button>

            {showQueueControls && (
              <>
                <div className="mt-3 border-t border-[var(--ck-border)] pt-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px_88px] md:items-end">
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Saved List</span>
                      <select
                        value={activeSavedQueueId}
                        onChange={(event) => {
                          const savedQueue = savedQueues.find((item) => item.id === event.target.value)
                          if (savedQueue) applySavedQueue(savedQueue)
                          else {
                            setActiveSavedQueueId('')
                            setSavedQueueName('')
                          }
                        }}
                        className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                      >
                        <option value="">Select list</option>
                        {savedQueues.map((savedQueue) => (
                          <option key={savedQueue.id} value={savedQueue.id}>{savedQueue.name} ({savedQueue.agent})</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">List Name</span>
                      <input
                        value={savedQueueName}
                        onChange={(event) => setSavedQueueName(event.target.value)}
                        placeholder={selectedPreset.label}
                        className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                      />
                    </label>
                    <button
                      onClick={saveCurrentQueue}
                      className="rounded-lg border border-[#E32E2E]/45 bg-[#E32E2E]/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-[#ff7777] transition-colors hover:border-[#E32E2E]"
                    >
                      Save
                    </button>
                    <button
                      onClick={deleteSavedQueue}
                      disabled={!activeSavedQueueId}
                      className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      Delete
                    </button>
                  </div>
                  {savedQueueError && (
                    <p className="mt-3 text-xs font-bold text-[#ff7777]">{savedQueueError}</p>
                  )}
                  {selectedSavedQueue && !savedQueueError && (
                    <p className="mt-3 text-xs text-[var(--ck-text-muted)]">
                      Loaded from database for {selectedSavedQueue.agent}. Updated {formatActivityTime(selectedSavedQueue.updatedAt)}.
                    </p>
                  )}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <DarkSelect label="Campaign" value={campaign} onChange={(value) => { setCampaign(value); setSelectedLeadIds(new Set()) }} options={sourceOptions} />
                  <DarkSelect label="Status" value={statusFilter} onChange={(value) => { setStatusFilter(value); setSelectedLeadIds(new Set()) }} options={statusOptions} />
                  <DarkSelect label="Priority" value={priorityFilter} onChange={(value) => { setPriorityFilter(value); setSelectedLeadIds(new Set()) }} options={['all', 'hot', 'high', 'normal']} />
                  <DarkSelect label="Sort" value={sortBy} onChange={(value) => setSortBy(value as QueueSort)} options={QUEUE_SORTS.map((item) => item.id)} />
                  <DarkSelect label="Show" value={String(visibleLimit)} onChange={(value) => setVisibleLimit(Number(value))} options={['25', '50', '100']} />
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Motivation {minMotivation}+</span>
                    <input type="range" min="0" max="10" value={minMotivation} onChange={(e) => { setMinMotivation(Number(e.target.value)); setSelectedLeadIds(new Set()) }} className="mt-3 w-full accent-[#E32E2E]" />
                  </label>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Icon name="search" size="text-lg" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
                    <input
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setSelectedLeadIds(new Set())
                      }}
                      placeholder="Search name, phone, address, source"
                      className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] py-2.5 pl-10 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                    />
                  </div>
                  {hasFilters && (
                    <button onClick={resetFilters} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">
                      Clear filters
                    </button>
                  )}
                  <button onClick={selectVisibleLeads} disabled={previewLeads.length === 0} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:opacity-35">
                    Select shown
                  </button>
                  {selectedCount > 0 && (
                    <button onClick={clearSelectedLeads} className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">
                      Clear selected
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="ck-card overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-[var(--ck-text)]">Queue Preview</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Showing {previewLeads.length} records. Check only the leads you want to call.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--ck-text-muted)]">
                <span>{selectedVisibleCount}/{previewLeads.length} shown selected</span>
                <span className="hidden sm:inline">/</span>
                <span>{selectedCount.toLocaleString()} total selected</span>
              </div>
            </div>
            <div className="max-h-[620px] overflow-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--ck-text-muted)]">Loading queue...</div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-bold text-[var(--ck-text)]">No callable leads match this queue.</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Change the preset, campaign, status, score, or search filter.</p>
              </div>
            ) : (
              previewLeads.map((lead, index) => (
                <div key={lead.id} className="grid gap-3 border-b border-[var(--ck-border)] px-5 py-4 md:grid-cols-[28px_34px_minmax(0,1fr)_145px_88px] md:items-center hover:bg-white/[0.03] transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.has(lead.id)}
                    onChange={() => toggleLeadSelection(lead.id)}
                    aria-label={`Select ${lead.full_name || 'lead'}`}
                    className="h-4 w-4 rounded border-[var(--ck-border)] bg-[var(--ck-surface-elev)] accent-[#E32E2E]"
                  />
                  <div className="text-xs font-black text-[var(--ck-text-dim)]">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black text-[var(--ck-text)]">{toProperCase(lead.full_name) || 'Unknown Lead'}</p>
                      {scheduledTodayLeadIds.has(lead.id) && <DarkPill tone="red">today</DarkPill>}
                      {followupLeadIds.has(lead.id) && <DarkPill tone="red">due</DarkPill>}
                      {lead.priority && <DarkPill>{lead.priority}</DarkPill>}
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{lead.property_address || lead.city || 'No property address'}</p>
                    <p className="mt-1 truncate text-xs text-[var(--ck-text-dim)]">
                      {lead.source || 'uncategorized'} / {lead.station || 'intake'} / last contact {lastContactLabel(lastContactByLeadId.get(lead.id))}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-[var(--ck-text)] font-mono">{formatPhone(lead.phone || '')}</p>
                  <button
                    onClick={() => router.push(`/dialer?lead_ids=${lead.id}&return_to=/dialer`)}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[#E32E2E]/50"
                  >
                    Open
                  </button>
                </div>
              ))
            )}
            </div>
          </section>
        </main>

        <aside className="ck-card p-5 lg:sticky lg:top-24">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black text-[var(--ck-text)]">Session</p>
              <p className="mt-1 text-xs text-[var(--ck-text-muted)]">{selectedPreset.label}</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black text-[var(--ck-text)]">{loading ? '...' : (selectedCount || queue.length).toLocaleString()}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{selectedCount > 0 ? 'selected' : 'ready'}</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <SegmentedControl value={mode} onChange={(value) => setMode(value as 'power' | 'predictive')} />
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Pace: {pacing}s</span>
              <input type="range" min={mode === 'predictive' ? 6 : 12} max="90" value={pacing} onChange={(e) => setPacing(Number(e.target.value))} className="mt-3 w-full accent-[#E32E2E]" />
            </label>
            <DarkSelect label="Agent" value={agent} onChange={setAgent} options={['Casey', 'Gertha', 'Ernest']} />
          </div>

          <button
            onClick={startQueue}
            disabled={queue.length === 0}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#E32E2E] px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="phone_in_talk" size="text-sm" /> {selectedCount > 0 ? `Start Selected (${selectedCount})` : 'Start Filtered Queue'}
          </button>

          <div className="mt-3 flex items-center justify-between text-xs text-[var(--ck-text-muted)]">
            <button onClick={selectVisibleLeads} disabled={previewLeads.length === 0} className="font-bold transition-colors hover:text-[var(--ck-text)] disabled:opacity-35">
              Select shown
            </button>
            <button onClick={clearSelectedLeads} disabled={selectedCount === 0} className="font-bold transition-colors hover:text-[var(--ck-text)] disabled:opacity-35">
              Clear
            </button>
          </div>

          <div className="mt-5 border-t border-[var(--ck-border)] pt-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Next Up</p>
            {currentLead ? (
              <div className="mt-4">
                <p className="text-base font-black text-[var(--ck-text)] leading-tight">{toProperCase(currentLead.full_name) || 'Unknown Lead'}</p>
                <p className="mt-1 font-mono text-sm font-bold text-[#E32E2E]">{formatPhone(currentLead.phone || '')}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ck-text-muted)]">{currentLead.property_address || currentLead.city || 'No property address on file.'}</p>
                <button
                  onClick={() => router.push(`/dialer?lead_ids=${currentLead.id}&return_to=/dialer`)}
                  className="mt-4 w-full rounded-lg border border-[var(--ck-border)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[#E32E2E]/50"
                >
                  Open Lead
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ck-text-muted)]">Select a queue with callable leads.</p>
            )}
          </div>

          <div className="mt-5 border-t border-[var(--ck-border)] pt-5 text-xs leading-6 text-[var(--ck-text-muted)]">
            Disposition, notes, callbacks, tagging, recording, and follow-up scheduling stay in the existing call flow.
          </div>
        </aside>
      </div>
    </div>
  )
}

function DarkSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
      >
        {options.map((option) => (
          <option key={option} value={option}>{formatSelectOption(option)}</option>
        ))}
      </select>
    </label>
  )
}

function SegmentedControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Mode</span>
      <div className="mt-2 grid grid-cols-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-1">
        {['power', 'predictive'].map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-md px-3 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
              value === option ? 'bg-[#E32E2E] text-white' : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function DarkPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'red' }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone === 'red' ? 'bg-[#E32E2E]/15 text-[#ff7777]' : 'bg-white/5 text-[var(--ck-text-muted)]'}`}>
      {children}
    </span>
  )
}

export default function DialerPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center"><Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" /></div>}>
      <DialerPageInner />
    </Suspense>
  )
}
