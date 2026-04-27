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
  metadata: { due_date?: string; status?: string } | null
  created_at: string
}

interface QueueProspect {
  lead_id: string | null
  is_deceased: boolean | null
  delinquent_years_category: string | null
}

type QueuePreset = 'followups_today' | 'warm_followups' | 'cold_prospecting' | 'tax_2yr' | 'deceased_3yr' | 'priority' | 'next_step' | 'custom'

const QUEUE_PRESETS: Array<{ id: QueuePreset; label: string; icon: string; description: string }> = [
  { id: 'followups_today', label: 'Follow-ups Today', icon: 'event_upcoming', description: 'Callbacks and next-step work due now.' },
  { id: 'warm_followups', label: 'Warm Follow-ups', icon: 'local_fire_department', description: 'Hot, high-priority, qualified, and motivated sellers.' },
  { id: 'cold_prospecting', label: 'Cold Prospecting', icon: 'ac_unit', description: 'Fresh or untouched records for outbound sessions.' },
  { id: 'tax_2yr', label: '2-Year Tax Delinquent', icon: 'request_quote', description: 'Tax delinquent prospects marked around two years.' },
  { id: 'deceased_3yr', label: '3+ Year Deceased Tax', icon: 'account_balance', description: 'Deceased-owner tax leads for the heir dialer workflow.' },
  { id: 'priority', label: 'Priority Queue', icon: 'priority_high', description: 'High intent by priority or motivation score.' },
  { id: 'next_step', label: 'Next-Step Date', icon: 'date_range', description: 'Leads with an appointment or next action date.' },
  { id: 'custom', label: 'Custom Filters', icon: 'tune', description: 'Build a session from campaign, status, score, and search.' },
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
            onClick={() => router.push('/leads')}
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
  const [prospects, setProspects] = useState<QueueProspect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<QueuePreset>('followups_today')
  const [campaign, setCampaign] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [minMotivation, setMinMotivation] = useState(0)
  const [search, setSearch] = useState('')
  const [agent, setAgent] = useState('Casey')
  const [mode, setMode] = useState<'power' | 'predictive'>('power')
  const [pacing, setPacing] = useState(18)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      const supabase = createClient()
      const [{ data: leadRows, error: leadError }, { data: followupRows }, { data: prospectRows }] = await Promise.all([
        supabase
          .from('leads')
          .select('id, full_name, phone, property_address, city, state, source, station, priority, seller_situation, motivation_score, appointment_date, created_at, updated_at')
          .not('phone', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1000),
        supabase
          .from('lead_activities')
          .select('lead_id, metadata, created_at')
          .in('activity_type', ['task', 'follow_up', 'callback'])
          .limit(400),
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
      setProspects((prospectRows as QueueProspect[] | null) ?? [])
      setLoading(false)
    }
    load()
  }, [])

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
        if (preset === 'followups_today') return followupLeadIds.has(lead.id) || dateKey(lead.appointment_date) === today
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
        const aDue = followupLeadIds.has(a.id) ? 1 : 0
        const bDue = followupLeadIds.has(b.id) ? 1 : 0
        if (aDue !== bDue) return bDue - aDue
        const aScore = (a.motivation_score || 0) + (a.priority === 'hot' ? 4 : a.priority === 'high' ? 2 : 0)
        const bScore = (b.motivation_score || 0) + (b.priority === 'hot' ? 4 : b.priority === 'high' ? 2 : 0)
        if (aScore !== bScore) return bScore - aScore
        return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
      })
  }, [campaign, followupLeadIds, leads, minMotivation, preset, priorityFilter, prospectByLeadId, search, statusFilter, today])

  const startQueue = useCallback(() => {
    if (preset === 'deceased_3yr') {
      router.push('/dialer?cohort=deceased-2-3yr')
      return
    }
    const ids = queue.slice(0, 100).map((lead) => lead.id)
    if (ids.length > 0) router.push(`/dialer?lead_ids=${ids.join(',')}`)
  }, [preset, queue, router])

  const currentLead = queue[0] ?? null

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] mb-2">Enterprise Dialer</p>
          <h1 className="text-3xl font-black text-[var(--ck-text)] tracking-tight">Calling Command Center</h1>
          <p className="mt-2 text-sm text-[var(--ck-text-muted)] max-w-2xl">
            Choose the queue, set pacing, and launch into the existing Saving KC dialer and required disposition workflow.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startQueue}
            disabled={queue.length === 0}
            className="inline-flex items-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Icon name="play_arrow" size="text-sm" /> Start Queue
          </button>
          {currentLead?.phone && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-dialer', {
                detail: { phone: currentLead.phone, name: currentLead.full_name || 'Unknown Lead', leadId: currentLead.id },
              }))}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors"
            >
              <Icon name="phone_in_talk" size="text-sm" /> Call First
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-4 text-sm text-[#ffb4b4]">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
        <MetricCard label="Queue" value={loading ? '...' : String(queue.length)} detail="callable leads" icon="format_list_bulleted" />
        <MetricCard label="Due Today" value={String(followupLeadIds.size)} detail="follow-ups and callbacks" icon="event_available" />
        <MetricCard label="Agent" value={agent} detail={mode === 'predictive' ? 'predictive pacing' : 'power dialing'} icon="support_agent" />
        <MetricCard label="Pace" value={`${pacing}s`} detail="between calls" icon="speed" />
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-4">
          <section className="ck-card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-black text-[var(--ck-text)]">Calling Queues</p>
              <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{queue.length}</span>
            </div>
            <div className="space-y-2">
              {QUEUE_PRESETS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setPreset(option.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    preset === option.id
                      ? 'bg-[#E32E2E]/10 border-[#E32E2E]/40'
                      : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] hover:border-[var(--ck-border-strong)]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon name={option.icon} size="text-lg" className={preset === option.id ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'} />
                    <div>
                      <p className="text-sm font-bold text-[var(--ck-text)]">{option.label}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--ck-text-muted)]">{option.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="ck-card p-4">
            <p className="text-sm font-black text-[var(--ck-text)] mb-4">Dialer Controls</p>
            <div className="space-y-4">
              <SegmentedControl value={mode} onChange={(value) => setMode(value as 'power' | 'predictive')} />
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Pace: {pacing}s</span>
                <input type="range" min={mode === 'predictive' ? 6 : 12} max="90" value={pacing} onChange={(e) => setPacing(Number(e.target.value))} className="mt-2 w-full accent-[#E32E2E]" />
              </label>
              <DarkSelect label="Agent" value={agent} onChange={setAgent} options={['Casey', 'Gertha', 'Ernest']} />
            </div>
          </section>
        </aside>

        <main className="col-span-12 lg:col-span-8 xl:col-span-6 ck-card overflow-hidden">
          <div className="border-b border-[var(--ck-border)] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-lg font-black text-[var(--ck-text)]">{QUEUE_PRESETS.find((item) => item.id === preset)?.label}</p>
                <p className="text-xs text-[var(--ck-text-muted)]">Launches into the current session page; dispositions stay in the existing modal.</p>
              </div>
              <div className="relative">
                <Icon name="search" size="text-lg" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search queue"
                  className="w-full xl:w-72 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] py-2 pl-10 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                />
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <DarkSelect label="Campaign" value={campaign} onChange={setCampaign} options={sourceOptions} />
              <DarkSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
              <DarkSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={['all', 'hot', 'high', 'normal']} />
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Motivation {minMotivation}+</span>
                <input type="range" min="0" max="10" value={minMotivation} onChange={(e) => setMinMotivation(Number(e.target.value))} className="mt-3 w-full accent-[#E32E2E]" />
              </label>
            </div>
          </div>

          <div className="max-h-[720px] overflow-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--ck-text-muted)]">Loading queue...</div>
            ) : queue.length === 0 ? (
              <div className="p-8 text-center">
                <Icon name="filter_alt_off" className="!text-4xl text-[var(--ck-text-dim)] mb-3" />
                <p className="text-sm font-bold text-[var(--ck-text)]">No callable leads match this queue.</p>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Change the preset, campaign, status, score, or search filter.</p>
              </div>
            ) : (
              queue.slice(0, 100).map((lead, index) => (
                <div key={lead.id} className="grid gap-3 border-b border-[var(--ck-border)] p-4 lg:grid-cols-[42px_minmax(0,1fr)_150px_105px] lg:items-center hover:bg-white/[0.03] transition-colors">
                  <div className="h-9 w-9 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] flex items-center justify-center text-xs font-black text-[var(--ck-text-muted)]">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black text-[var(--ck-text)]">{toProperCase(lead.full_name) || 'Unknown Lead'}</p>
                      {followupLeadIds.has(lead.id) && <DarkPill tone="red">due</DarkPill>}
                      {lead.priority && <DarkPill>{lead.priority}</DarkPill>}
                      {lead.motivation_score ? <DarkPill>{lead.motivation_score}/10</DarkPill> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{lead.property_address || lead.city || 'No property address'}</p>
                    <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">{lead.source || 'uncategorized'} · {lead.station || 'intake'}</p>
                  </div>
                  <p className="text-sm font-bold text-[var(--ck-text)] font-mono">{formatPhone(lead.phone || '')}</p>
                  <button
                    onClick={() => router.push(`/dialer?lead_ids=${lead.id}`)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[#E32E2E]/50 px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors"
                  >
                    <Icon name="play_arrow" size="text-sm" /> Open
                  </button>
                </div>
              ))
            )}
          </div>
        </main>

        <aside className="col-span-12 xl:col-span-3 space-y-4">
          <section className="ck-card p-5">
            <p className="text-sm font-black text-[var(--ck-text)]">Now Ready</p>
            {currentLead ? (
              <div className="mt-4">
                <p className="text-xl font-black text-[var(--ck-text)] leading-tight">{toProperCase(currentLead.full_name) || 'Unknown Lead'}</p>
                <p className="mt-1 font-mono text-sm font-bold text-[#E32E2E]">{formatPhone(currentLead.phone || '')}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--ck-text-muted)]">{currentLead.property_address || currentLead.city || 'No property address on file.'}</p>
                <button
                  onClick={() => router.push(`/dialer?lead_ids=${currentLead.id}`)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-[#E32E2E] hover:bg-[#C42626] text-white px-4 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                >
                  <Icon name="phone_in_talk" size="text-sm" /> Start This Lead
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--ck-text-muted)]">Select a queue with callable leads.</p>
            )}
          </section>

          <section className="ck-card p-5">
            <p className="text-sm font-black text-[var(--ck-text)]">Outcome Controls</p>
            <div className="mt-4 space-y-3">
              <ComplianceRow icon="rule" label="Disposition required" value="Existing modal" />
              <ComplianceRow icon="edit_note" label="Call notes" value="Timeline" />
              <ComplianceRow icon="event_repeat" label="Callbacks" value="Outcome flow" />
              <ComplianceRow icon="sell" label="Auto-tagging" value="Manifest sync" />
              <ComplianceRow icon="fiber_manual_record" label="Recording" value="Twilio" />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  return (
    <div className="ck-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{label}</p>
          <p className="mt-2 text-2xl font-black text-[var(--ck-text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--ck-text-muted)]">{detail}</p>
        </div>
        <Icon name={icon} size="text-2xl" className="text-[#E32E2E]" />
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
          <option key={option} value={option}>{option === 'all' ? 'All' : option.replace(/_/g, ' ')}</option>
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

function ComplianceRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon name={icon} size="text-base" className="text-[#E32E2E]" />
        <span className="truncate text-xs font-bold text-[var(--ck-text)]">{label}</span>
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">{value}</span>
    </div>
  )
}

export default function DialerPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center"><Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" /></div>}>
      <DialerPageInner />
    </Suspense>
  )
}
