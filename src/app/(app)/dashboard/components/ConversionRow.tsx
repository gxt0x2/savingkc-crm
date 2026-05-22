'use client'

import { useEffect, useState } from 'react'

export function ConversionRow({
  label,
  rate,
  count,
  comparedRate,
  editable,
  onChange,
}: {
  label: string
  rate: number
  count: number
  comparedRate?: number
  editable?: boolean
  onChange?: (value: number) => void
}) {
  const [displayRate, setDisplayRate] = useState(formatRateInput(rate))

  useEffect(() => {
    setDisplayRate(formatRateInput(rate))
  }, [rate])

  function commitRate() {
    const parsed = Number(displayRate)

    if (!Number.isFinite(parsed) || parsed < 0) {
      setDisplayRate(formatRateInput(rate))
      return
    }

    onChange?.(Math.min(parsed, 100) / 100)
  }

  const delta = comparedRate === undefined ? null : getRateDelta(rate, comparedRate)

  return (
    <div data-testid="conversion-row" className="grid grid-cols-[1fr_92px_86px_64px] items-center gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      </div>
      <label className="relative block">
        <span className="sr-only">{label} rate</span>
        <input
          aria-label={`${label} rate`}
          inputMode="decimal"
          readOnly={!editable}
          value={displayRate}
          onChange={(event) => setDisplayRate(event.target.value)}
          onBlur={commitRate}
          className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 pr-7 text-right text-sm font-black tabular-nums text-slate-950 outline-none focus:border-[#ff4d56] focus:ring-2 focus:ring-[#ff4d56]/15 read-only:bg-slate-50"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
      </label>
      <div className="text-right text-sm font-black tabular-nums text-slate-950">{count.toFixed(2)}</div>
      {delta ? (
        <div
          data-testid="rate-delta"
          data-tone={delta.tone}
          className={getDeltaClassName(delta.tone)}
        >
          {delta.label}
        </div>
      ) : (
        <div aria-hidden="true" />
      )}
    </div>
  )
}

function formatRateInput(rate: number) {
  return String(Math.round(rate * 100))
}

function getRateDelta(rate: number, comparedRate: number) {
  const rawDelta = comparedRate === 0 ? (rate === 0 ? 0 : 100) : ((rate - comparedRate) / comparedRate) * 100
  const roundedDelta = Math.round(rawDelta)
  const tone = roundedDelta > 0 ? 'positive' : roundedDelta < 0 ? 'negative' : 'neutral'
  const label = roundedDelta > 0 ? `+${roundedDelta}%` : `${roundedDelta}%`

  return { label, tone }
}

function getDeltaClassName(tone: string) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-slate-400'

  return `text-right text-xs font-black tabular-nums ${toneClass}`
}
