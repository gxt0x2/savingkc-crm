'use client'

import { useOperationalReconciliation } from '@/hooks/use-operational-reconciliation'
import { Icon } from '@/components/ui/icon'

function Metric({ label, value, note, tone = 'default' }: {
  label: string
  value: number
  note: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${tone === 'warning' ? 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)]'}`}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--crm-text-muted)]">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <strong className="text-xl tabular-nums text-[var(--crm-ink)]">{value.toLocaleString()}</strong>
        <span className="truncate text-[11px] text-[var(--crm-text-muted)]" title={note}>{note}</span>
      </div>
    </div>
  )
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
            <h2 className="text-sm font-bold text-[var(--crm-ink)]">Backlog health</h2>
            <p className="text-xs text-[var(--crm-text-muted)]">Separate current work from review debt. Nothing is auto-closed.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[var(--crm-text-muted)]">{data.workItems.overdue.toLocaleString()} overdue total</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current-record overdue" value={data.workItems.overdueCurrent} note="linked to a non-terminal record" />
        <Metric label="Terminal review" value={data.workItems.overdueTerminal} note="linked to a terminal record" tone={data.workItems.overdueTerminal > 0 ? 'warning' : 'default'} />
        <Metric label="Unlinked review" value={data.workItems.overdueUnlinked} note="no linked contact record" tone={data.workItems.overdueUnlinked > 0 ? 'warning' : 'default'} />
        <Metric label="Multiple active" value={data.workItems.leadsWithMultipleActive} note={`up to ${data.workItems.maxActivePerLead} actions on one contact`} tone={data.workItems.leadsWithMultipleActive > 0 ? 'warning' : 'default'} />
      </div>
      {data.degraded ? <p role="status" className="mt-2 text-xs font-semibold text-[var(--crm-warning)]">{data.warning}</p> : null}
    </section>
  )
}
