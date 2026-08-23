'use client'

import Link from 'next/link'
import { useOperationalReconciliation } from '@/hooks/use-operational-reconciliation'
import { Icon } from '@/components/ui/icon'

function Metric({ label, value, note, tone = 'default', href }: {
  label: string
  value: number
  note: string
  tone?: 'default' | 'warning'
  href?: string
}) {
  const className = `min-w-0 rounded-xl border px-3 py-2 ${tone === 'warning' ? 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)]'}`
  const content = <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--crm-text-muted)]">{label}</p>
        {href ? <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-black uppercase tracking-[0.05em] text-[var(--crm-brand)]">Review <Icon name="arrow_forward" className="text-[13px]" /></span> : null}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <strong className="text-xl tabular-nums text-[var(--crm-ink)]">{value.toLocaleString()}</strong>
        <span className="truncate text-[11px] text-[var(--crm-text-muted)]" title={note}>{note}</span>
      </div>
    </>
  return href
    ? <Link href={href} aria-label={`Review ${value.toLocaleString()} ${label.toLowerCase()}`} className={`${className} transition hover:border-[var(--crm-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-brand)]`}>{content}</Link>
    : <div className={className}>{content}</div>
}

export function TaskReconciliationStrip() {
  const { data, isLoading, error } = useOperationalReconciliation()

  if (isLoading) {
    return (
      <section aria-label="Task backlog health" className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-3 md:px-7">
        <p role="status" className="text-sm text-[var(--crm-text-muted)]">Loading backlog health…</p>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section aria-label="Task backlog health" className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-3 md:px-7">
        <p role="status" className="text-sm font-semibold text-[var(--crm-warning)]">Backlog health unavailable. Task counts remain unchanged.</p>
      </section>
    )
  }

  return (
    <section aria-label="Task backlog health" className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-3 md:px-7">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="fact_check" className="text-[18px] text-[var(--crm-brand)]" />
          <div>
            <h2 className="text-sm font-bold text-[var(--crm-ink)]">Work queue integrity</h2>
            <p className="text-xs text-[var(--crm-text-muted)]">Only current operator work appears here. Historical evidence stays in the audit record.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[var(--crm-text-muted)]">{data.workItems.activeOpportunities.toLocaleString()} active opportunities</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Current overdue" value={data.workItems.overdueCurrent} note="operator work past due" tone={data.workItems.overdueCurrent > 0 ? 'warning' : 'default'} />
        <Metric label="Missing primary" value={data.workItems.opportunitiesWithNoPrimary} note={`of ${data.workItems.activeOpportunities} active opportunities`} tone={data.workItems.opportunitiesWithNoPrimary > 0 ? 'warning' : 'default'} href={data.workItems.opportunitiesWithNoPrimary > 0 ? '/contacts?list=all&gap=missing_next_action' : undefined} />
        <Metric label="Multiple primary" value={data.workItems.opportunitiesWithMultiplePrimary} note="active opportunities with more than one" tone={data.workItems.opportunitiesWithMultiplePrimary > 0 ? 'warning' : 'default'} />
      </div>
      {data.degraded ? <p role="status" className="mt-2 text-xs font-semibold text-[var(--crm-warning)]">{data.warning}</p> : null}
    </section>
  )
}
