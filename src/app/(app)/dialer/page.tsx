'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { HeirsSection } from '@/components/leads/heirs-section'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { createClient } from '@/lib/supabase/client'
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
      setResolveError('No lead_ids or cohort in the URL. Open the dialer from the leads list.')
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
  const mailingAddress = joinAddress([
    currentProspect?.mailing_street,
    currentProspect?.mailing_city,
    currentProspect?.mailing_state,
    currentProspect?.mailing_zip,
  ])
  const mailingDiffers = mailingAddress && mailingAddress !== situsAddress

  const coOwners: string[] = (currentManifest?.owner?.coOwners ?? []).filter(Boolean)

  const delinquentYears = currentProspect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : currentProspect?.delinquent_years_category === '2yr'
    ? '2 yr'
    : null

  const isCallingNow = queueState?.queueItem && ['calling', 'on_call'].includes(queueState.status)

  if (resolveError) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="ck-card p-8 max-w-md text-center">
          <Icon name="error_outline" className="!text-4xl text-[#E32E2E] mb-3" />
          <p className="text-sm font-bold text-[var(--ck-text)] mb-2">Can't start a dialing session</p>
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

            {/* Mailing address — when different from situs, it's absentee-owned. */}
            {mailingAddress && (
              <div
                className={`mb-4 p-3 rounded-lg border ${
                  mailingDiffers
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)]'
                }`}
              >
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${mailingDiffers ? 'text-amber-400' : 'text-[var(--ck-text-dim)]'}`}>
                  Tax bill mailed to {mailingDiffers ? '· absentee' : '· same as situs'}
                </p>
                <p className="text-xs text-[var(--ck-text)]">{mailingAddress}</p>
              </div>
            )}

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

export default function DialerPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center"><Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" /></div>}>
      <DialerPageInner />
    </Suspense>
  )
}
