'use client'

import { Icon } from '@/components/ui/icon'
import type { OperatingReportPeriod } from '@/lib/operating-report'

const PERIOD_LABELS: Record<OperatingReportPeriod, string> = {
  today: 'Today',
  '30d': 'Last 30 days',
  quarter: 'This quarter',
  ytd: 'Year to date',
  all: 'All time',
  custom: 'Custom range',
}

export interface OperatingCustomRange {
  start: string
  end: string
}

export function localDateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function defaultOperatingCustomRange(): OperatingCustomRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return { start: localDateInput(start), end: localDateInput(end) }
}

export function operatingRangeQuery(period: OperatingReportPeriod, customRange: OperatingCustomRange) {
  const params = new URLSearchParams({ period })
  if (period === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    params.set('start', start.toISOString())
    params.set('end', new Date().toISOString())
  }
  if (period === 'custom' && customRange.start && customRange.end) {
    params.set('start', new Date(`${customRange.start}T00:00:00`).toISOString())
    params.set('end', new Date(`${customRange.end}T23:59:59.999`).toISOString())
  }
  return params
}

export function ReportDateRangeControl({
  period,
  customRange,
  onPeriodChange,
  onCustomRangeChange,
}: {
  period: OperatingReportPeriod
  customRange: OperatingCustomRange
  onPeriodChange: (period: OperatingReportPeriod) => void
  onCustomRangeChange: (range: OperatingCustomRange) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 shadow-sm">
        <Icon name="date_range" className="text-[19px] text-[var(--crm-brand)]" />
        <span className="sr-only">Reporting period</span>
        <select aria-label="Reporting period" value={period} onChange={(event) => onPeriodChange(event.target.value as OperatingReportPeriod)} className="bg-transparent text-xs font-black text-[var(--crm-ink)] outline-none">
          {Object.entries(PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {period === 'custom' ? <>
        <input aria-label="Reporting start date" type="date" value={customRange.start} max={customRange.end} onChange={(event) => onCustomRangeChange({ ...customRange, start: event.target.value })} className="crm-field h-10 rounded-xl px-3 text-xs font-bold" />
        <span className="text-xs font-bold text-[var(--crm-text-muted)]">to</span>
        <input aria-label="Reporting end date" type="date" value={customRange.end} min={customRange.start} onChange={(event) => onCustomRangeChange({ ...customRange, end: event.target.value })} className="crm-field h-10 rounded-xl px-3 text-xs font-bold" />
      </> : null}
    </div>
  )
}
