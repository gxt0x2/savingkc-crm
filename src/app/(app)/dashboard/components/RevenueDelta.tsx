import type { ScenarioComparison } from '../lib/bottleneck.types'

export function RevenueDelta({ comparison }: { comparison: ScenarioComparison }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-white">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Revenue Lift</div>
      <div
        data-testid="revenue-increase-percent"
        className="mt-2 text-5xl font-black tracking-normal tabular-nums"
        style={{ color: '#ff4d56' }}
      >
        {formatPercent(comparison.revenueIncreasePercent)}
      </div>
      <div className="mt-4 rounded-md bg-white p-3 text-slate-950">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Net Increase</div>
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
