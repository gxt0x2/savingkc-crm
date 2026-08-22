'use client'

import Link from 'next/link'
import { useOperationalReconciliation } from '@/hooks/use-operational-reconciliation'
import { useTaskProvenance } from '@/hooks/use-task-provenance'
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
  const provenance = useTaskProvenance()

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
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Metric label="Current-record overdue" value={data.workItems.overdueCurrent} note="linked to a non-terminal record" />
        <Metric label="Terminal review" value={data.workItems.overdueTerminal} note="linked to a terminal record" tone={data.workItems.overdueTerminal > 0 ? 'warning' : 'default'} />
        <Metric label="Unlinked review" value={data.workItems.overdueUnlinked} note="no linked contact record" tone={data.workItems.overdueUnlinked > 0 ? 'warning' : 'default'} />
        <Metric label="Multiple active" value={data.workItems.leadsWithMultipleActive} note={`up to ${data.workItems.maxActivePerLead} actions on one contact`} tone={data.workItems.leadsWithMultipleActive > 0 ? 'warning' : 'default'} />
        <Metric label="Missing primary" value={data.workItems.opportunitiesWithNoPrimary} note={`of ${data.workItems.activeOpportunities} active opportunities`} tone={data.workItems.opportunitiesWithNoPrimary > 0 ? 'warning' : 'default'} href={data.workItems.opportunitiesWithNoPrimary > 0 ? '/contacts?list=all&gap=missing_next_action' : undefined} />
        <Metric label="Multiple primary" value={data.workItems.opportunitiesWithMultiplePrimary} note="active opportunities with more than one" tone={data.workItems.opportunitiesWithMultiplePrimary > 0 ? 'warning' : 'default'} />
      </div>
      {data.degraded ? <p role="status" className="mt-2 text-xs font-semibold text-[var(--crm-warning)]">{data.warning}</p> : null}
      <div className="mt-3 border-t border-[var(--crm-border)] pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.05em] text-[var(--crm-ink)]">Task integrity</h3>
            <p className="text-[11px] text-[var(--crm-text-muted)]">Source evidence only. No tasks are hidden, completed, or deleted.</p>
          </div>
          {provenance.data ? <span className="text-[11px] font-semibold text-[var(--crm-text-muted)]">{provenance.data.active.toLocaleString()} active</span> : null}
        </div>
        {provenance.isLoading ? <p role="status" className="text-xs text-[var(--crm-text-muted)]">Loading task integrity…</p> : null}
        {provenance.error ? <p role="status" className="text-xs font-semibold text-[var(--crm-warning)]">Task integrity unavailable. Existing task lanes are unchanged.</p> : null}
        {provenance.data ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Operator entered"
            value={provenance.data.classes.governed_human.active + provenance.data.classes.approved_workflow.active + provenance.data.classes.legacy_operator.active}
            note="governed or legacy operator source"
          />
          <Metric label="Event backed" value={provenance.data.classes.event_derived.active} note="linked to a recorded CRM event" />
          <Metric label="Automation review" value={provenance.data.classes.automation_unreviewed.active} note="Mojo, briefing, or heuristic source" tone={provenance.data.classes.automation_unreviewed.active > 0 ? 'warning' : 'default'} />
          <Metric label="Unattributed" value={provenance.data.classes.unknown.active} note="no trustworthy source metadata" tone={provenance.data.classes.unknown.active > 0 ? 'warning' : 'default'} />
          <Metric label="Possible duplicates" value={provenance.data.quality.possibleDuplicateRows} note="same contact, action, and due date" tone={provenance.data.quality.possibleDuplicateRows > 0 ? 'warning' : 'default'} />
        </div> : null}
      </div>
    </section>
  )
}
