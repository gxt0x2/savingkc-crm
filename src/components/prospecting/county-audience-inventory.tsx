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
import {
  countyOwnerStatusFiltersForListType,
  countySavedViewsForListType,
  prospectingCampaignListTypeForCampaign,
} from '@/lib/prospecting/campaign-contract'
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

export function CountyAudienceInventory({
  campaignId,
  campaignName,
  campaignKind,
  onEnrolled,
}: {
  campaignId?: string
  campaignName?: string
  campaignKind?: 'dialer' | 'sms'
  onEnrolled?: () => void | Promise<void>
} = {}) {
  const listType = prospectingCampaignListTypeForCampaign({ id: campaignId, name: campaignName ?? '' })
  const allowedViews = countySavedViewsForListType(listType)
  const allowedDeceasedFilters = countyOwnerStatusFiltersForListType(listType)
  const [summary, setSummary] = useState<CountyProspectAudienceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewId, setViewId] = useState<CountySavedViewDefinition['id']>(allowedViews[0] ?? 'tax_2yr')
  const [deceasedFilter, setDeceasedFilter] = useState<CountyDeceasedFilter>(allowedDeceasedFilters[0] ?? 'all')
  const [propertyFilter, setPropertyFilter] = useState<CountyPropertyClassFilter>('all')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollmentNotice, setEnrollmentNotice] = useState<string | null>(null)
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null)

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

  const views = (summary?.savedViews ?? (summary ? buildCountySavedViews(summary.rows) : []))
    .filter((view) => allowedViews.includes(view.id))
  const visibleDeceasedFilters = DECEASED_FILTERS.filter((filter) => allowedDeceasedFilters.includes(filter.value))
  const selectedViewId = allowedViews.includes(viewId) ? viewId : (allowedViews[0] ?? 'tax_2yr')
  const selectedDeceasedFilter = allowedDeceasedFilters.includes(deceasedFilter)
    ? deceasedFilter
    : (allowedDeceasedFilters[0] ?? 'all')
  const activeView = selectedView(views, selectedViewId)
  const activeMetrics = activeView ? filterCountySavedView(activeView, selectedDeceasedFilter, propertyFilter) : null

  async function enrollReviewedAudience() {
    if (!campaignId || !activeView || !activeMetrics || activeMetrics.total < 1 || enrolling) return
    setEnrolling(true)
    setEnrollmentError(null)
    setEnrollmentNotice(null)
    try {
      const response = await fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}/members`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countyAudience: {
          savedView: activeView.id,
          deceasedFilter: selectedDeceasedFilter,
          propertyFilter,
          reviewedCount: activeMetrics.total,
        } }),
      })
      const body = await response.json().catch(() => null) as { enrollment?: { subjects?: number; eligible?: number; needsReview?: number; suppressed?: number; missing?: number }; error?: string } | null
      if (!response.ok || !body?.enrollment) throw new Error(body?.error || 'County audience could not be enrolled')
      const result = body.enrollment
      setConfirmOpen(false)
      setEnrollmentNotice(campaignKind === 'sms'
        ? `${Number(result.subjects) || 0} seller groups added. ${Number(result.needsReview) || 0} require an explicit SMS recipient before activation.`
        : `${Number(result.subjects) || 0} seller groups added with ${Number(result.eligible) || 0} ready to call. No calls were placed.`)
      await onEnrolled?.()
    } catch (caught) {
      setEnrollmentError(caught instanceof Error ? caught.message : 'County audience could not be enrolled')
    } finally {
      setEnrolling(false)
    }
  }

  return <section className="mt-5 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-label="County prospect saved views">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="crm-eyebrow">County source Saved Views</p><h3 className="mt-1 text-sm font-black text-[var(--crm-ink)]">Tax-delinquent prospect inventory</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{listType === 'tax_3_plus' ? 'Tax 3+ is living first-pass only. Deceased owners stay on a separate Deceased campaign. Voice only.' : listType === 'deceased' ? 'This Deceased campaign enrolls inherited or deceased owners only. Do not mix in living Tax 3+ rows. Voice only.' : 'Dynamic source views—not copied lists or CRM leads. Opening or filtering a view never starts calls or messages.'}</p></div>
      {summary ? <span className="rounded-full bg-[var(--crm-info-soft)] px-3 py-1 text-[10px] font-black text-[var(--crm-info)]">{summary.withPhoneCandidate.toLocaleString()} with a phone candidate</span> : null}
    </div>

    {!summary && !error ? <p role="status" className="mt-4 text-xs font-bold text-[var(--crm-text-muted)]">Loading county Saved Views…</p> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}

    {summary && activeView && activeMetrics ? <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Tax delinquency Saved Views">
        {views.map((view) => <button key={view.id} type="button" aria-pressed={selectedViewId === view.id} onClick={() => setViewId(view.id)} className={`rounded-xl border p-4 text-left transition-colors ${selectedViewId === view.id ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-brand-border)]'}`}>
          <span className="flex items-start justify-between gap-3"><span><strong className="block text-sm text-[var(--crm-ink)]">{view.label}</strong><span className="mt-1 block text-[10px] font-semibold text-[var(--crm-text-muted)]">{view.description}</span></span><Icon name="bookmark" className={selectedViewId === view.id ? 'text-xl text-[var(--crm-brand)]' : 'text-xl text-[var(--crm-text-dim)]'} /></span>
          <span className="mt-3 block text-2xl font-black text-[var(--crm-ink)]">{view.total.toLocaleString()}</span>
          <span className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{view.withPhoneCandidate.toLocaleString()} with a phone candidate · {view.needsPropertyClass.toLocaleString()} need classification</span>
        </button>)}
      </div>

      <div className="mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-[var(--crm-ink)]">{activeView.label}</p><p className="mt-1 text-[10px] font-semibold text-[var(--crm-text-muted)]">Deceased status and property class filter this Saved View; they do not create separate source systems.</p></div><div className="text-right"><p className="text-2xl font-black text-[var(--crm-ink)]">{activeMetrics.total.toLocaleString()}</p><p className="text-[10px] font-semibold text-[var(--crm-text-muted)]">matching records</p></div></div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <fieldset><legend className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Owner status</legend><div className="mt-2 flex flex-wrap gap-1.5">{visibleDeceasedFilters.map((filter) => <FilterButton key={filter.value} active={selectedDeceasedFilter === filter.value} label={filter.label} onClick={() => setDeceasedFilter(filter.value)} />)}</div></fieldset>
          <fieldset><legend className="text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Property class</legend><div className="mt-2 flex flex-wrap gap-1.5">{PROPERTY_FILTERS.map((filter) => <FilterButton key={filter.value} active={propertyFilter === filter.value} label={filter.label} onClick={() => setPropertyFilter(filter.value)} />)}</div></fieldset>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {PROPERTY_CARDS.map((property) => {
            const metrics = filterCountySavedView(activeView, selectedDeceasedFilter, property.value)
            return <button key={property.value} type="button" aria-label={`${property.label}: ${metrics.total.toLocaleString()} records, ${phoneCandidateLabel(metrics.withPhoneCandidate)}`} aria-pressed={propertyFilter === property.value} onClick={() => setPropertyFilter(property.value)} className={`rounded-lg border p-3 text-left ${propertyFilter === property.value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]'}`}>
              <span className="flex items-start justify-between gap-2"><strong className="text-xs text-[var(--crm-ink)]">{property.label}</strong><Icon name={property.icon} className={`text-lg ${property.value === 'unknown' ? 'text-[var(--crm-warning)]' : 'text-[var(--crm-info)]'}`} /></span>
              <span className="mt-2 block text-xl font-black text-[var(--crm-ink)]">{metrics.total.toLocaleString()}</span>
              <span className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{phoneCandidateLabel(metrics.withPhoneCandidate)}</span>
            </button>
          })}
        </div>

        <div className="mt-3 grid gap-2 rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-[10px] font-semibold text-[var(--crm-text-muted)] sm:grid-cols-3"><span><strong className="text-[var(--crm-ink)]">{activeMetrics.total.toLocaleString()}</strong> eligible source records</span><span><strong className="text-[var(--crm-ink)]">{activeMetrics.withPhoneCandidate.toLocaleString()}</strong> with a phone candidate</span><span><strong className="text-[var(--crm-ink)]">{activeMetrics.linkedLeads.toLocaleString()}</strong> linked to CRM</span></div>
        {campaignId ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--crm-border)] pt-4"><p className="max-w-xl text-[10px] leading-4 text-[var(--crm-text-muted)]">Enrollment snapshots every associated phone. Linked records use their existing Lead; unlinked county records remain Prospects. Nothing is called or messaged by this action.</p><button type="button" onClick={() => { setEnrollmentError(null); setConfirmOpen(true) }} disabled={activeMetrics.total < 1 || enrolling} className="crm-primary-button h-10 rounded-lg px-4 text-xs font-black disabled:opacity-40">Review {activeMetrics.total.toLocaleString()} for enrollment</button></div> : null}
        {enrollmentNotice ? <p role="status" className="mt-3 rounded-lg bg-[var(--crm-success-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-success)]">{enrollmentNotice}</p> : null}
        {enrollmentError ? <p role="alert" className="mt-3 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{enrollmentError}</p> : null}
      </div>

      {summary.needsPropertyClass > 0 ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs text-[var(--crm-ink)]"><Icon name="fact_check" className="mt-0.5 text-base text-[var(--crm-warning)]" /><p><strong>{summary.needsPropertyClass.toLocaleString()} records remain visible under Needs classification.</strong> County or import evidence can move them into Residential or Land later; valuation and occupancy are not used as guesses.</p></div> : null}
      {confirmOpen ? <div className="fixed inset-0 z-[90] grid place-items-center bg-[#101711]/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !enrolling) setConfirmOpen(false) }}><section role="dialog" aria-modal="true" aria-labelledby="county-enrollment-title" className="crm-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl"><p className="crm-eyebrow">Reviewed source enrollment</p><h2 id="county-enrollment-title" className="mt-1 text-xl font-black text-[var(--crm-ink)]">Add {activeMetrics.total.toLocaleString()} matching records?</h2><p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">{activeView.label} · {DECEASED_FILTERS.find((item) => item.value === selectedDeceasedFilter)?.label} · {PROPERTY_FILTERS.find((item) => item.value === propertyFilter)?.label}</p><div className="mt-4 rounded-xl bg-[var(--crm-surface-subtle)] p-4 text-xs leading-5 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">This is inert enrollment.</strong> Existing Lead links are deduplicated, unlinked records remain source Prospects, blocked phones remain visible but unusable, and {campaignKind === 'sms' ? 'every source Prospect waits for an explicit recipient choice.' : 'calls begin only after campaign activation and a human starts the calling floor.'}</div>{enrollmentError ? <p role="alert" className="mt-3 text-xs font-bold text-[var(--crm-danger)]">{enrollmentError}</p> : null}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setConfirmOpen(false)} disabled={enrolling} className="crm-secondary-button h-10 rounded-lg px-4 text-xs font-black">Cancel</button><button type="button" onClick={() => void enrollReviewedAudience()} disabled={enrolling} className="crm-primary-button h-10 rounded-lg px-4 text-xs font-black disabled:opacity-50">{enrolling ? 'Adding reviewed audience…' : 'Add reviewed audience'}</button></div></section></div> : null}
    </> : null}
  </section>
}
