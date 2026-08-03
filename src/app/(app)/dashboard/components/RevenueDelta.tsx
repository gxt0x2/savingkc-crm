import type { ScenarioComparison } from '../lib/bottleneck.types'

export function RevenueDelta({ comparison }: { comparison: ScenarioComparison }) {
  return (
    <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4 text-[var(--crm-ink)]">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--crm-text-dim)]">Revenue Lift</div>
      <div
        data-testid="revenue-increase-percent"
        className="mt-2 text-5xl font-black tracking-normal tabular-nums text-[var(--crm-brand)]"
      >
        {formatPercent(comparison.revenueIncreasePercent)}
      </div>
      <div className="mt-4 rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-[var(--crm-ink)]">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--crm-text-dim)]">Net Increase</div>
        <div className="text-2xl font-black tabular-nums">{formatDollars(comparison.netIncrease)}</div>
      </div>
    </section>
  )
}

function formatPercent(value: number) {
  if (value === 0) {
    return '—'
  }

  return `${value.toFixed(2)}%`
}

function formatDollars(value: number) {
  const abs = Math.abs(value)
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'USD',
  }).format(abs)

  return value < 0 ? `-${formatted}` : formatted
}
