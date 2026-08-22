'use client'

import { Icon } from '@/components/ui/icon'
import { useOperationalReconciliation } from '@/hooks/use-operational-reconciliation'

export function ConversationReconciliationStrip() {
  const { data, isLoading, error } = useOperationalReconciliation()

  if (isLoading) {
    return (
      <div role="status" className="flex shrink-0 items-center gap-2 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-2 text-xs text-[var(--crm-text-muted)]">
        <Icon name="progress_activity" className="animate-spin" /> Loading Needs Reply mix…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div role="status" className="flex shrink-0 items-center gap-2 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-2 text-xs font-semibold text-[var(--crm-warning)]">
        <Icon name="warning_amber" /> Needs Reply mix unavailable. No threads are hidden.
      </div>
    )
  }

  return (
    <section aria-label="Needs Reply mix" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-bold text-[var(--crm-ink)]"><Icon name="account_tree" className="text-[16px] text-[var(--crm-brand)]" /> Needs Reply mix</span>
      <span><strong className="tabular-nums text-[var(--crm-ink)]">{data.conversations.known.toLocaleString()}</strong> <span className="text-[var(--crm-text-muted)]">known contacts</span></span>
      <span><strong className="tabular-nums text-[var(--crm-ink)]">{data.conversations.unmatched.toLocaleString()}</strong> <span className="text-[var(--crm-text-muted)]">unmatched</span></span>
      <span><strong className="tabular-nums text-[var(--crm-ink)]">{data.conversations.terminalKnown.toLocaleString()}</strong> <span className="text-[var(--crm-text-muted)]">terminal review</span></span>
      <span className="ml-auto text-[11px] font-semibold text-[var(--crm-text-muted)]">Nothing is auto-dismissed.</span>
      {data.degraded ? <span role="status" className="w-full font-semibold text-[var(--crm-warning)]">{data.warning}</span> : null}
    </section>
  )
}
