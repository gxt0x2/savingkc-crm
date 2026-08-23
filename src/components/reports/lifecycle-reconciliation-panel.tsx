'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import type { LifecycleReconciliationSnapshot } from '@/lib/server/lifecycle-reconciliation'

async function readLifecycleReconciliation() {
  const response = await fetch('/api/reports/lifecycle-reconciliation', { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Lifecycle evidence review is unavailable')
  return payload as LifecycleReconciliationSnapshot
}

export function LifecycleReconciliationPanel() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['lifecycle-evidence-reconciliation'],
    queryFn: readLifecycleReconciliation,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  if (isLoading) return <section className="crm-panel h-52 animate-pulse rounded-2xl" aria-label="Loading lifecycle evidence review" />
  if (error || !data) {
    return <section className="crm-panel rounded-2xl p-5"><p className="crm-eyebrow">Evidence reconciliation</p><h2 className="mt-1 text-base font-black">Lifecycle evidence is unavailable</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">No missing record is being treated as complete.</p><button type="button" onClick={() => void refetch()} className="crm-secondary-button mt-3 rounded-lg px-3 py-2 text-xs font-black">Try again</button></section>
  }

  const totalIssues = data.counts.missingSellerHandoffs + data.counts.missingAssignmentHandoffs + data.counts.missingCloseOutcomes + data.counts.orphanClosingFiles
  const cards = [
    ['Seller handoffs', data.counts.missingSellerHandoffs, 'Signed contract evidence'],
    ['Assignment handoffs', data.counts.missingAssignmentHandoffs, 'Executed buyer assignment'],
    ['Close outcomes', data.counts.missingCloseOutcomes, 'Funded or fell-through proof'],
    ['Orphan closing files', data.counts.orphanClosingFiles, 'Missing Dispositions link'],
  ] as const

  return (
    <section className="crm-panel overflow-hidden rounded-2xl" aria-label="Lifecycle evidence reconciliation">
      <div className="flex flex-col gap-3 border-b border-[var(--crm-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="crm-eyebrow">Evidence reconciliation</p>
          <h2 className="mt-1 text-base font-black">{totalIssues === 0 ? 'Every reviewed record has governed evidence' : `${totalIssues} legacy evidence gap${totalIssues === 1 ? '' : 's'} need review`}</h2>
          <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Nothing is auto-completed or backfilled. Resolve each gap through its signed handoff or verified closeout workflow.</p>
        </div>
        <button type="button" onClick={() => void refetch()} className="crm-icon-button grid h-9 w-9 shrink-0 place-items-center rounded-lg" aria-label="Refresh lifecycle evidence"><Icon name="refresh" /></button>
      </div>
      <div className="grid gap-2 border-b border-[var(--crm-border)] p-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, detail]) => <div key={label} className={`rounded-xl border p-3 ${value > 0 ? 'border-[var(--crm-action-border)] bg-[var(--crm-action-soft)]' : 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)]'}`}><span className="text-[10px] font-black uppercase tracking-[0.07em] text-[var(--crm-text-muted)]">{label}</span><strong className="mt-1 block text-2xl font-black">{value}</strong><span className="text-[10px] font-semibold text-[var(--crm-text-muted)]">{detail}</span></div>)}
      </div>
      {data.issues.length === 0 ? <div className="flex items-center gap-3 px-5 py-5 text-sm font-bold text-[var(--crm-success)]"><Icon name="verified" />Governed evidence is complete for all reviewed records.</div> : (
        <div className="divide-y divide-[var(--crm-border)]">
          {data.issues.slice(0, 8).map((issue) => <div key={issue.key} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><strong className="block truncate text-xs">{issue.title}</strong><span className="mt-0.5 block text-[10px] font-semibold text-[var(--crm-text-muted)]">{issue.detail}</span></div><Link href={issue.href} className="crm-secondary-button inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-[10px] font-black">Open record <Icon name="arrow_forward" /></Link></div>)}
        </div>
      )}
      {data.degraded ? <p className="border-t border-[var(--crm-border)] px-5 py-3 text-xs font-semibold text-[var(--crm-action)]">{data.warning}</p> : null}
    </section>
  )
}
