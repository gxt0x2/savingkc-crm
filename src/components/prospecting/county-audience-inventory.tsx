'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { CountyProspectAudienceSummary } from '@/lib/server/county-prospect-audiences'

type AudienceCard = {
  deceased: boolean
  propertyClass: 'residential' | 'land'
  label: string
}

const AUDIENCES: AudienceCard[] = [
  { deceased: false, propertyClass: 'residential', label: '2–3 year tax delinquent · Residential' },
  { deceased: false, propertyClass: 'land', label: '2–3 year tax delinquent · Land' },
  { deceased: true, propertyClass: 'residential', label: '2–3 year deceased owner · Residential' },
  { deceased: true, propertyClass: 'land', label: '2–3 year deceased owner · Land' },
]

export function CountyAudienceInventory() {
  const [summary, setSummary] = useState<CountyProspectAudienceSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const cards = useMemo(() => AUDIENCES.map((audience) => {
    const rows = summary?.rows.filter((row) => row.deceased === audience.deceased && row.propertyClass === audience.propertyClass) ?? []
    return {
      ...audience,
      total: rows.reduce((sum, row) => sum + row.total, 0),
      withPhoneCandidate: rows.reduce((sum, row) => sum + row.withPhoneCandidate, 0),
    }
  }), [summary])

  return <section className="mt-5 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-label="County prospect lists">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="crm-eyebrow">County source lists</p><h3 className="mt-1 text-sm font-black text-[var(--crm-ink)]">Reviewed tax-delinquent audiences</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">These are source records, not CRM leads. Reviewing a list never starts calls or messages.</p></div>
      {summary ? <span className="rounded-full bg-[var(--crm-info-soft)] px-3 py-1 text-[10px] font-black text-[var(--crm-info)]">{summary.withPhoneCandidate.toLocaleString()} with a phone candidate</span> : null}
    </div>
    {!summary && !error ? <p role="status" className="mt-4 text-xs font-bold text-[var(--crm-text-muted)]">Loading county list inventory…</p> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
    {summary ? <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {cards.map((card) => <article key={`${card.deceased}:${card.propertyClass}`} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
          <div className="flex items-start justify-between gap-2"><p className="text-xs font-black text-[var(--crm-ink)]">{card.label}</p><Icon name={card.propertyClass === 'land' ? 'landscape' : 'home'} className="text-lg text-[var(--crm-info)]" /></div>
          <p className="mt-2 text-xl font-black text-[var(--crm-ink)]">{card.total.toLocaleString()}</p>
          <p className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{card.withPhoneCandidate.toLocaleString()} with a phone candidate</p>
        </article>)}
      </div>
      {summary.needsPropertyClass > 0 ? <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs text-[var(--crm-ink)]"><Icon name="fact_check" className="mt-0.5 text-base text-[var(--crm-warning)]" /><p><strong>{summary.needsPropertyClass.toLocaleString()} records need county property classification.</strong> They stay out of Residential and Land until evidence is backfilled; valuation and occupancy are not used as guesses.</p></div> : null}
    </> : null}
  </section>
}
