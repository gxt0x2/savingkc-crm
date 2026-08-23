'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  buildCountySavedViews,
  filterCountySavedView,
  type CountyDeceasedFilter,
  type CountyPropertyClass,
  type CountyPropertyClassFilter,
  type CountySavedViewDefinition,
  type CountySavedViewSummary,
} from '@/lib/prospecting/county-saved-views'
import type { CountyProspectAudienceSummary } from '@/lib/server/county-prospect-audiences'

const DECEASED_FILTERS: ReadonlyArray<{ value: CountyDeceasedFilter; label: string }> = [
  { value: 'all', label: 'All owners' },
  { value: 'non_deceased', label: 'Non-deceased' },
  { value: 'deceased', label: 'Deceased' },
]

const PROPERTY_FILTERS: ReadonlyArray<{ value: CountyPropertyClassFilter; label: string }> = [
  { value: 'all', label: 'All property classes' },
  { value: 'residential', label: 'Residential' },
  { value: 'land', label: 'Land' },
  { value: 'unknown', label: 'Needs classification' },
]

const PROPERTY_CARDS: ReadonlyArray<{ value: CountyPropertyClass; label: string; icon: string }> = [
  { value: 'residential', label: 'Residential', icon: 'home' },
  { value: 'land', label: 'Land', icon: 'landscape' },
  { value: 'unknown', label: 'Needs classification', icon: 'fact_check' },
]

function selectedView(views: CountySavedViewSummary[], id: CountySavedViewDefinition['id']) {
  return views.find((view) => view.id === id) ?? views[0] ?? null
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-full px-3 py-1.5 text-[10px] font-black transition-colors ${active ? 'bg-[var(--crm-brand)] text-white' : 'border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand-border)] hover:text-[var(--crm-ink)]'}`}>{label}</button>
}

function phoneCandidateLabel(count: number) {
  return `${count.toLocaleString()} phone candidate${count === 1 ? '' : 's'}`
}

export function CountyAudienceInventory() {
  const [summary, setSummary] = useState<CountyProspectAudienceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<CountySavedViewDefinition['id']>('tax_2yr')
  const [deceasedFilter, setDeceasedFilter] = useState<CountyDeceasedFilter>('all')
  const [propertyFilter, setPropertyFilter] = useState<CountyPropertyClassFilter>('all')

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/prospecting/county-audiences', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (CountyProspectAudienceSummary & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || 'County prospect lists are unavailable')
        setSummary(body)
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException) || caught.name !== 'AbortError') {
          setError(caught instanceof Error ? caught.message : 'County prospect lists are unavailable')
        }
      })
    return () => controller.abort()
  }, [])

  const views = summary?.savedViews ?? (summary ? buildCountySavedViews(summary.rows) : [])
  const activeView = selectedView(views, viewId)
  const activeMetrics = activeView ? filterCountySavedView(activeView, deceasedFilter, propertyFilter) : null

  return <section className="mt-5 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-label="County prospect saved views">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="crm-eyebrow">County source Saved Views</p><h3 className="mt-1 text-sm font-black text-[var(--crm-ink)]">Tax-delinquent prospect inventory</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Dynamic source views—not copied lists or CRM leads. Opening or filtering a view never starts calls or messages.</p></div>
      {summary ? <span className="rounded-full bg-[var(--crm-info-soft)] px-3 py-1 text-[10px] font-black text-[var(--crm-info)]">{summary.withPhoneCandidate.toLocaleString()} with a phone candidate</span> : null}
    </div>

    {!summary && !error ? <p role="status" className="mt-4 text-xs font-bold text-[var(--crm-text-muted)]">Loading county Saved Views…</p> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}

    {summary && activeView && activeMetrics ? <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Tax delinquency Saved Views">
        {views.map((view) => <button key={view.id} type="button" aria-pressed={activeView.id === view.id} onClick={() => setViewId(view.id)} className={`rounded-xl border p-4 text-left transition-colors ${activeView.id === view.id ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-brand-border)]'}`}>
          <span className="flex items-start justify-between gap-3"><span><strong className="block text-sm text-[var(--crm-ink)]">{view.label}</strong><span className="mt-1 block text-[10px] font-semibold text-[var(--crm-text-muted)]">{view.description}</span></span><Icon name="bookmark" className={activeView.id === view.id ? 'text-xl text-[var(--crm-brand)]' : 'text-xl text-[var(--crm-text-dim)]'} /></span>
          <span className="mt-3 block text-2xl font-black text-[var(--crm-ink)]">{view.total.toLocaleString()}</span>
          <span className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{view.withPhoneCandidate.toLocaleString()} with a phone candidate · {view.needsPropertyClass.toLocaleString()} need classification</span>
        </button>)}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-[var(--crm-ink)]">{activeView.label}</p><p className="mt-1 text-[10px] font-semibold text-[var(--crm-text-muted)]">Deceased status and property class filter this Saved View; they do not create separate source systems.</p></div><div className="text-right"><p className="text-2xl font-black text-[var(--crm-ink)]">{activeMetrics.total.toLocaleString()}</p><p className="text-[10px] font-semibold text-[var(--crm-text-muted)]">matching records</p></div></div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <fieldset><legend className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Owner status</legend><div className="mt-2 flex flex-wrap gap-1.5">{DECEASED_FILTERS.map((filter) => <FilterButton key={filter.value} active={deceasedFilter === filter.value} label={filter.label} onClick={() => setDeceasedFilter(filter.value)} />)}</div></fieldset>
          <fieldset><legend className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Property class</legend><div className="mt-2 flex flex-wrap gap-1.5">{PROPERTY_FILTERS.map((filter) => <FilterButton key={filter.value} active={propertyFilter === filter.value} label={filter.label} onClick={() => setPropertyFilter(filter.value)} />)}</div></fieldset>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {PROPERTY_CARDS.map((property) => {
            const metrics = filterCountySavedView(activeView, deceasedFilter, property.value)
            return <button key={property.value} type="button" aria-label={`${property.label}: ${metrics.total.toLocaleString()} records, ${phoneCandidateLabel(metrics.withPhoneCandidate)}`} aria-pressed={propertyFilter === property.value} onClick={() => setPropertyFilter(property.value)} className={`rounded-lg border p-3 text-left ${propertyFilter === property.value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]'}`}>
              <span className="flex items-start justify-between gap-2"><strong className="text-xs text-[var(--crm-ink)]">{property.label}</strong><Icon name={property.icon} className={`text-lg ${property.value === 'unknown' ? 'text-[var(--crm-warning)]' : 'text-[var(--crm-info)]'}`} /></span>
              <span className="mt-2 block text-xl font-black text-[var(--crm-ink)]">{metrics.total.toLocaleString()}</span>
              <span className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{phoneCandidateLabel(metrics.withPhoneCandidate)}</span>
            </button>
          })}
        </div>

        <div className="mt-3 grid gap-2 rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-[10px] font-semibold text-[var(--crm-text-muted)] sm:grid-cols-3"><span><strong className="text-[var(--crm-ink)]">{activeMetrics.total.toLocaleString()}</strong> eligible source records</span><span><strong className="text-[var(--crm-ink)]">{activeMetrics.withPhoneCandidate.toLocaleString()}</strong> with a phone candidate</span><span><strong className="text-[var(--crm-ink)]">{activeMetrics.linkedLeads.toLocaleString()}</strong> linked to CRM</span></div>
      </div>

      {summary.needsPropertyClass > 0 ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs text-[var(--crm-ink)]"><Icon name="fact_check" className="mt-0.5 text-base text-[var(--crm-warning)]" /><p><strong>{summary.needsPropertyClass.toLocaleString()} records remain visible under Needs classification.</strong> County or import evidence can move them into Residential or Land later; valuation and occupancy are not used as guesses.</p></div> : null}
    </> : null}
  </section>
}
