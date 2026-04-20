'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { HeirsSection } from '@/components/leads/heirs-section'
import { createClient } from '@/lib/supabase/client'
import { toProperCase } from '@/lib/format'

// URL contract:
//   /dialer?lead_ids=<uuid>,<uuid>,...
//   /dialer?cohort=deceased-2-3yr   (shorthand; resolves to lead_ids client-side)
//
// The page streams through the cohort one lead at a time. The telephony-bar's
// queue mode is what actually places calls; this page just pins the property
// context and advances on the "heir-queue-complete" event.

interface LeadSummary {
  id: string
  full_name: string | null
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
  situs_city: string | null
  situs_state: string | null
  county: string | null
}

function compactDollars(n: number | null | undefined): string {
  if (!n || n <= 0) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function DialerPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [leadIds, setLeadIds] = useState<string[]>([])
  const [leads, setLeads] = useState<Record<string, LeadSummary>>({})
  const [prospects, setProspects] = useState<Record<string, ProspectSummary | null>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const currentLeadId: string | null = leadIds[currentIndex] ?? null
  const currentLead: LeadSummary | null = currentLeadId ? leads[currentLeadId] ?? null : null
  const currentProspect: ProspectSummary | null = currentLeadId ? prospects[currentLeadId] ?? null : null

  // Resolve the cohort → list of lead_ids once, on mount / query change.
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

  // Fetch lead + prospect context for every lead we know about. Batch it so
  // one round-trip covers the cohort (we only need summary fields here).
  useEffect(() => {
    if (leadIds.length === 0) return
    const supabase = createClient()

    async function load() {
      const { data: leadRows } = await supabase
        .from('leads')
        .select('id, full_name, property_address, city, state, zip, county, is_favorite')
        .in('id', leadIds)
      const leadMap: Record<string, LeadSummary> = {}
      ;(leadRows as LeadSummary[] | null)?.forEach((l) => { leadMap[l.id] = l })
      setLeads(leadMap)

      const { data: prospectRows } = await supabase
        .from('prospects')
        .select('id, lead_id, owner_1, cumulative_due, earliest_delinquent_year, delinquent_years_category, total_market_value, zestimate, situs_city, situs_state, county')
        .in('lead_id', leadIds)
      const prospectMap: Record<string, ProspectSummary | null> = {}
      leadIds.forEach((id) => { prospectMap[id] = null })
      ;(prospectRows as (ProspectSummary & { lead_id: string })[] | null)?.forEach((p) => {
        prospectMap[p.lead_id] = p
      })
      setProspects(prospectMap)
    }
    load()
  }, [leadIds])

  const advance = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, leadIds.length - 1))
  }, [leadIds.length])

  const back = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0))
  }, [])

  // Auto-advance when the telephony-bar reports the queue finished.
  useEffect(() => {
    function onQueueComplete(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.leadId === currentLeadId) {
        // Give the disposition modal / activity feed a beat to settle.
        setTimeout(advance, 400)
      }
    }
    window.addEventListener('heir-queue-complete', onQueueComplete)
    return () => window.removeEventListener('heir-queue-complete', onQueueComplete)
  }, [currentLeadId, advance])

  // Keyboard shortcuts — J/K (vim) and arrow keys to navigate leads.
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

  const address = currentLead?.property_address || '—'
  const cityState = [currentLead?.city, currentLead?.state].filter(Boolean).join(', ')
  const delinquentYears = currentProspect?.delinquent_years_category === '3yr_plus'
    ? '3+ yr'
    : currentProspect?.delinquent_years_category === '2yr'
    ? '2 yr'
    : null

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

        {/* Prev / Next lead controls */}
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

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* LEFT — property / owner context */}
        <div className="col-span-12 lg:col-span-5 space-y-4">
          <section className="ck-card p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-1">
                  Subject property
                </p>
                <h1 className="text-xl font-black text-[var(--ck-text)] leading-tight truncate">
                  {address}
                </h1>
                {cityState && (
                  <p className="text-sm text-[var(--ck-text-muted)] mt-0.5">{cityState}{currentLead?.zip ? ` ${currentLead.zip}` : ''}</p>
                )}
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

            {/* Deceased owner callout */}
            <div className="p-3 rounded-lg bg-[#E32E2E]/10 border border-[#E32E2E]/30 mb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E32E2E] mb-0.5">
                Deceased owner
              </p>
              <p className="text-sm font-bold text-[var(--ck-text)]">{ownerName}</p>
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

            {/* Financial ribbon */}
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

          {/* Progress strip */}
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
              Tip: <kbd className="text-[9px] font-mono bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded px-1">J</kbd> next ·
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
              propertyAddress={address}
              defaultExpanded
              collapsible={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function DialerPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center"><Icon name="progress_activity" className="!text-4xl text-[var(--ck-text-dim)] animate-spin" /></div>}>
      <DialerPageInner />
    </Suspense>
  )
}
