'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { CaseyAndonQueue } from '@/components/my-day/casey-andon-queue'
import { MyDayCallReview } from '@/components/my-day/my-day-call-review'
import {
  MY_DAY_TIME_ZONE,
  type MyDayData,
  type MyDayDateRange,
  type MyDayMetric,
  type MyDayQueueItem,
  type MyDayRangePreset,
  type MyDayRangeRequest,
} from '@/lib/my-day'
import { cn } from '@/lib/utils'

const TONE_STYLES: Record<MyDayMetric['tone'], { icon: string; text: string; dot: string; soft: string }> = {
  blue: { icon: 'text-[var(--crm-info)]', text: 'text-[var(--crm-info)]', dot: 'bg-[var(--crm-info)]', soft: 'bg-[var(--crm-info-soft)]' },
  violet: { icon: 'text-[#6d28d9]', text: 'text-[#6d28d9]', dot: 'bg-[#6d28d9]', soft: 'bg-[#f1ebff]' },
  coral: { icon: 'text-[var(--crm-brand)]', text: 'text-[var(--crm-brand)]', dot: 'bg-[var(--crm-brand)]', soft: 'bg-[var(--crm-brand-soft)]' },
  sky: { icon: 'text-[#0f6fe8]', text: 'text-[#0f6fe8]', dot: 'bg-[#0f6fe8]', soft: 'bg-[#eaf4ff]' },
  green: { icon: 'text-[#07883f]', text: 'text-[#07883f]', dot: 'bg-[#07883f]', soft: 'bg-[#eaf7ef]' },
  indigo: { icon: 'text-[#175cd3]', text: 'text-[#175cd3]', dot: 'bg-[#175cd3]', soft: 'bg-[#edf3ff]' },
}

const PRIORITY_STYLES: Record<MyDayQueueItem['priority'], string> = {
  High: 'border-[#ffd4d0] bg-[#fff0ef] text-[#c13229]',
  Medium: 'border-[#ffe0a8] bg-[#fff7e7] text-[#9a5b00]',
  Low: 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
}

const STAGE_STYLES: Record<string, string> = {
  New: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Leads: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Contacted: 'border-[#c7dcff] bg-[#edf4ff] text-[#225eb8]',
  Opportunity: 'border-[#d7c7fb] bg-[#f4efff] text-[#6d28d9]',
  'Appointment Set': 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
  'Offer Made': 'border-[#ffd7c1] bg-[#fff3eb] text-[#b84b14]',
  'Under Contract': 'border-[#bfe7d0] bg-[#edf9f2] text-[#08753f]',
}

function greeting(generatedAt: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MY_DAY_TIME_ZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(generatedAt))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 12)
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function centralDateKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MY_DAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

const RANGE_CHOICES: Array<{ preset: Exclude<MyDayRangePreset, 'custom'>; label: string; description: string }> = [
  { preset: 'today', label: 'Today', description: 'Current day' },
  { preset: 'yesterday', label: 'Yesterday', description: 'Previous day' },
  { preset: 'this_week', label: 'This week', description: 'Monday through today' },
  { preset: 'last_week', label: 'Last week', description: 'Previous calendar week' },
  { preset: 'last_7_days', label: 'Last 7 days', description: 'Rolling seven-day window' },
  { preset: 'month_to_date', label: 'Month to date', description: 'First of month through today' },
  { preset: 'previous_month', label: 'Previous month', description: 'Full prior calendar month' },
  { preset: 'last_30_days', label: 'Last 30 days', description: 'Rolling thirty-day window' },
]

function compactRangeDates(range: MyDayDateRange) {
  const start = new Date(`${range.from}T12:00:00Z`)
  const end = new Date(`${range.to}T12:00:00Z`)
  if (range.from === range.to) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(start)
  }
  const left = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(start)
  const right = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(end)
  return `${left} – ${right}`
}

function rangeRequest(range: MyDayDateRange): MyDayRangeRequest {
  return range.preset === 'custom'
    ? { preset: 'custom', from: range.from, to: range.to }
    : { preset: range.preset }
}

export function MyDayDateRangeSelector({
  range,
  today,
  loading,
  onChange,
}: {
  range: MyDayDateRange
  today: string
  loading: boolean
  onChange: (request: MyDayRangeRequest) => void
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(range.from)
  const [customTo, setCustomTo] = useState(range.to)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const customInvalid = !customFrom || !customTo || customFrom > customTo || customTo > today

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${range.label}`}
        disabled={loading}
        onClick={() => setOpen((current) => {
          if (!current) {
            setCustomFrom(range.from)
            setCustomTo(range.to)
          }
          return !current
        })}
        className="crm-field flex h-12 min-w-[210px] items-center gap-3 rounded-xl px-3 text-left outline-none transition hover:border-[var(--crm-brand)] disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]">
          <Icon name="date_range" className="text-[19px]" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[12px] font-black text-[var(--crm-text)]">{range.label}</strong>
          <span className="block truncate text-[10px] font-semibold text-[var(--crm-text-muted)]">{compactRangeDates(range)}</span>
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} className="text-[18px] text-[var(--crm-text-muted)]" />
      </button>

      {open ? (
        <div role="dialog" aria-label="Choose reporting date range" className="absolute right-0 z-50 mt-2 grid w-[min(640px,calc(100vw-2rem))] gap-4 rounded-2xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-4 shadow-2xl sm:grid-cols-[1.1fr_0.9fr]">
          <section aria-labelledby="quick-ranges-title">
            <h2 id="quick-ranges-title" className="px-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Quick ranges</h2>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {RANGE_CHOICES.map((choice) => {
                const active = range.preset === choice.preset
                return (
                  <button
                    key={choice.preset}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setOpen(false)
                      onChange({ preset: choice.preset })
                    }}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition',
                      active
                        ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                        : 'border-transparent hover:border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 text-[12px] font-black">{choice.label}{active ? <Icon name="check" className="text-[16px]" /> : null}</span>
                    <span className="mt-0.5 block text-[9px] font-semibold text-[var(--crm-text-muted)]">{choice.description}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section aria-labelledby="custom-range-title" className="rounded-xl bg-[var(--crm-surface-subtle)] p-3">
            <h2 id="custom-range-title" className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Custom range</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--crm-text-muted)]">Choose up to 90 days. Future dates are unavailable.</p>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-[10px] font-black text-[var(--crm-text-muted)]">From<input aria-label="Custom range start" type="date" value={customFrom} max={today} onChange={(event) => setCustomFrom(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-xs font-bold text-[var(--crm-text)]" /></label>
              <label className="grid gap-1 text-[10px] font-black text-[var(--crm-text-muted)]">To<input aria-label="Custom range end" type="date" value={customTo} min={customFrom || undefined} max={today} onChange={(event) => setCustomTo(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-xs font-bold text-[var(--crm-text)]" /></label>
            </div>
            <button
              type="button"
              disabled={customInvalid}
              onClick={() => {
                setOpen(false)
                onChange({ preset: 'custom', from: customFrom, to: customTo })
              }}
              className="crm-primary-button mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Icon name="check" className="text-[16px]" />Apply custom range
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function formatDateTime(value: string | null, mode: 'time' | 'due', referenceAt: string) {
  if (!value) return mode === 'due' ? 'No due date' : 'Time not set'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date unavailable'
  if (mode === 'time') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: MY_DAY_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }

  const now = new Date(referenceAt)
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: MY_DAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = dateKey.format(now)
  const tomorrowDate = new Date(now.getTime() + 86_400_000)
  const tomorrow = dateKey.format(tomorrowDate)
  const target = dateKey.format(date)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: MY_DAY_TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(date)
  if (target === today) return `Today ${time}`
  if (target === tomorrow) return `Tomorrow ${time}`
  return new Intl.DateTimeFormat('en-US', { timeZone: MY_DAY_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function metricValue(value: number | null) {
  return value === null ? '—' : value.toLocaleString()
}

function dialingTime(seconds: number | null) {
  if (seconds === null) return 'Dialing time unavailable'
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours} hr ${String(minutes).padStart(2, '0')} min dialing`
}

function sourceFreshness(value: string | null) {
  if (!value) return 'Update time unavailable'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Update time unavailable'
  return `Updated ${new Intl.DateTimeFormat('en-US', {
    timeZone: MY_DAY_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`
}

function ordinalDay(day: number) {
  const remainder = day % 100
  if (remainder >= 11 && remainder <= 13) return `${day}th`
  return `${day}${day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`
}

function formatWeekRange(endValue: string) {
  const end = new Date(`${endValue}T12:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - 4)
  const month = (date: Date) => new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date)
  return `${month(start)} ${ordinalDay(start.getUTCDate())} – ${month(end)} ${ordinalDay(end.getUTCDate())}`
}

function FunnelCard({ data }: { data: MyDayData }) {
  const { metrics, performance } = { metrics: data.funnel, performance: data.performance }
  const performanceSource = performance.source === 'combined'
    ? 'Mojo + CRM dialer'
    : performance.source === 'native_dialer' ? 'CRM dialer' : 'Mojo'
  return (
    <section aria-labelledby="conversion-funnel-title" className="crm-panel rounded-xl px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="conversion-funnel-title" className="text-[22px] font-black tracking-[-0.02em]">Conversion Funnel</h2>
        {performance.status === 'available' ? (
          <p className="text-[11px] font-bold text-[var(--crm-text-muted)]">{performanceSource} · {dialingTime(performance.dialingSeconds)} · {sourceFreshness(performance.sourceFetchedAt)}</p>
        ) : performance.status === 'partial' ? (
          <p className="text-[11px] font-bold text-[var(--crm-warning)]">{performanceSource} is partial · available totals are shown</p>
        ) : (
          <p className="text-[11px] font-bold text-[var(--crm-danger)]">Mojo performance unavailable · call totals are not inferred</p>
        )}
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="grid min-w-[1080px] grid-cols-7 xl:min-w-0">
          {metrics.map((metric, index) => {
          const tone = TONE_STYLES[metric.tone]
          return (
            <div key={metric.key} className="relative min-w-0 px-2 first:pl-0 last:pr-0">
              <div className="flex min-h-[74px] items-center gap-2.5">
                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone.soft)}>
                  <Icon name={metric.icon} className={cn('text-[25px]', tone.icon)} />
                </div>
                <div className="min-w-0">
                  <p className="max-w-[108px] text-[13px] font-extrabold leading-[1.25] text-[var(--crm-text)]">{metric.label}</p>
                  <p className="mt-1 text-[28px] font-black leading-none">{metricValue(metric.value)}</p>
                </div>
                {index < metrics.length - 1 ? <Icon name="chevron_right" className="ml-auto shrink-0 text-[20px] text-[var(--crm-text-dim)]" /> : null}
              </div>
              <div className="relative mt-1 h-3 border-t border-dashed border-[var(--crm-border-strong)]">
                <span className={cn('absolute -top-[4px] left-6 h-2 w-2 rounded-full ring-4 ring-[var(--crm-surface)]', tone.dot)} />
              </div>
              {index > 0 ? <p className={cn('text-center text-xs font-black', tone.text)}>{metric.conversion === null ? 'Not recorded' : `${metric.conversion.toFixed(1)}%`}</p> : <p className="text-center text-xs font-black text-transparent" aria-hidden="true">—</p>}
            </div>
          )
          })}
        </div>
      </div>
    </section>
  )
}

export function MojoFreshnessAlert({ data }: { data: MyDayData }) {
  const freshness = data.performance.freshness
  if (freshness.status === 'current') return null

  const delayed = freshness.status === 'delayed'
  const lastSync = freshness.lastSuccessfulSyncAt ? sourceFreshness(freshness.lastSuccessfulSyncAt) : 'No successful sync recorded'
  return (
    <section
      role="alert"
      aria-label="Mojo data freshness"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-xs',
        delayed
          ? 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
          : 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
      )}
    >
      <Icon name={delayed ? 'schedule' : 'sync_problem'} className="mt-0.5 text-[19px]" />
      <div>
        <p className="font-black">Mojo data {delayed ? 'is delayed' : 'is not current'}</p>
        <p className="mt-0.5 font-semibold leading-relaxed">
          {freshness.message}. {lastSync}. {delayed
            ? 'The latest available totals are labeled as partial.'
            : 'Today’s provider totals are withheld until a healthy sync completes.'}
        </p>
      </div>
    </section>
  )
}

export function ReconciliationAttention({ data, onReviewed }: { data: MyDayData; onReviewed: (id: string) => void }) {
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const markReviewed = async (item: MyDayData['attention']['items'][number]) => {
    setReviewingId(item.id)
    setReviewError(null)
    try {
      const response = await fetch('/api/my-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: item.recordId }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'The review could not be saved.')
      onReviewed(item.id)
    } catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : 'The review could not be saved.')
    } finally {
      setReviewingId(null)
    }
  }

  if (data.attention.status === 'available' && data.attention.items.length === 0) return null
  if (data.attention.status === 'unavailable') {
    return (
      <section aria-label="CRM reconciliation status" className="rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-4 py-3 text-xs font-bold text-[var(--crm-warning)]">
        Mojo-to-CRM conflict checks are unavailable. Lead totals remain visible, but terminal-record activity needs manual verification.
      </section>
    )
  }

  return (
    <section aria-labelledby="reconciliation-attention-title" className="overflow-hidden rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)]">
      <header className="flex items-center gap-3 border-b border-[var(--crm-warning-border)] px-4 py-3">
        <Icon name="warning_amber" className="text-[22px] text-[var(--crm-warning)]" />
        <div>
          <h2 id="reconciliation-attention-title" className="text-sm font-black">Mojo activity needs CRM review</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-[var(--crm-text-muted)]">Open the CRM record to inspect it, then mark the notice reviewed when it has been handled.</p>
        </div>
      </header>
      {reviewError ? <p role="alert" className="border-b border-[var(--crm-warning-border)] px-4 py-2 text-xs font-bold text-[var(--crm-danger)]">{reviewError}</p> : null}
      <div className="divide-y divide-[var(--crm-warning-border)]">
        {data.attention.items.map((item) => (
          <div key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{item.leadName} · {item.property}</p>
              <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{item.disposition} · {new Date(item.happenedAt).toLocaleString()}</p>
              {item.missingFollowUpAt ? <p className="mt-1 text-[11px] font-black text-[var(--crm-danger)]">No callback time was supplied by Mojo.</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href={item.href} prefetch={false} className="crm-secondary-button inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black">
                Open record <Icon name="open_in_new" className="text-[16px]" />
              </Link>
              <button type="button" onClick={() => void markReviewed(item)} disabled={reviewingId === item.id} className="crm-primary-button inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black disabled:cursor-wait disabled:opacity-60">
                {reviewingId === item.id ? 'Saving…' : 'Mark reviewed'} <Icon name="check" className="text-[16px]" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function WeeklySnapshot({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby="weekly-snapshot-title" className="crm-panel overflow-hidden rounded-xl">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="weekly-snapshot-title" className="px-5 pt-4 text-[22px] font-black tracking-[-0.02em]">Workweek Snapshot</h2>
        <p className="px-5 pt-4 text-sm font-bold text-[var(--crm-text-muted)]">{formatWeekRange(data.week.end)}</p>
      </div>
      <div className="mt-3 overflow-x-auto px-5">
        <table className="w-full min-w-[840px] table-fixed border-collapse border border-[var(--crm-border)] text-[13px]">
          <thead>
            <tr className="bg-[var(--crm-surface-subtle)] text-[11px] font-black uppercase tracking-[0.05em] text-[var(--crm-text-muted)]">
              <th className="w-[220px] border border-[var(--crm-border)] px-4 py-3 text-left">Metric</th>
              {data.week.dayLabels.map((day) => <th key={day} className="border border-[var(--crm-border)] px-3 py-3 text-center">{day}</th>)}
              <th className="border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-3 text-center text-[var(--crm-brand)]">Week Total</th>
            </tr>
          </thead>
          <tbody>
            {data.week.rows.map((row) => {
              const tone = TONE_STYLES[row.tone]
              return (
                <tr key={row.key} className="hover:bg-[var(--crm-surface-subtle)]">
                  <th className="border border-[var(--crm-border)] px-4 py-3 text-left font-extrabold"><span className="inline-flex items-center gap-2.5"><Icon name={row.icon} className={cn('text-[18px]', tone.icon)} />{row.label}</span></th>
                  {row.days.map((value, index) => <td key={`${row.key}-${index}`} className="border border-[var(--crm-border)] px-3 py-3 text-center font-bold">{metricValue(value)}</td>)}
                  <td className={cn('border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-3 text-center text-[15px] font-black', tone.text)}>{metricValue(row.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function CommitmentsCard({ data }: { data: MyDayData }) {
  return (
    <section aria-labelledby="next-commitments-title" className="crm-panel flex min-h-[284px] flex-col rounded-xl">
      <h2 id="next-commitments-title" className="px-4 pt-4 text-[22px] font-black tracking-[-0.02em]">Next Commitments</h2>
      <div className="mt-1 flex-1 px-4">
        {data.commitments.length === 0 ? (
          <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center">
            <Icon name="event_available" className="text-[28px] text-[var(--crm-success)]" />
            <p className="mt-2 text-sm font-extrabold">No upcoming commitments</p>
            <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Casey’s next 14 days are clear.</p>
          </div>
        ) : (
          <ol className="relative border-l-2 border-[#d8e5ff] pl-4">
            {data.commitments.map((item) => (
              <li key={item.id} className="relative py-2">
                <span className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full bg-[#1769e0] ring-4 ring-[var(--crm-surface)]" />
                <Link href={item.href} prefetch className="grid grid-cols-[56px_32px_1fr_16px] items-center gap-2 rounded-lg p-1 hover:bg-[var(--crm-surface-subtle)]">
                  <time className="text-[10px] font-black">{formatDateTime(item.dueAt, 'time', data.generatedAt)}</time>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name={item.icon} className="text-[17px]" /></span>
                  <span className="min-w-0"><strong className="block truncate text-[10px]">{item.title}</strong><span className="block truncate text-[9px] text-[var(--crm-text-muted)]">{item.detail}</span></span>
                  <Icon name="chevron_right" className="text-[16px] text-[var(--crm-text-muted)]" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Link href="/calendar?department=acquisitions" prefetch className="flex items-center justify-between border-t border-[var(--crm-border)] px-4 py-3 text-[10px] font-black text-[var(--crm-info)] hover:bg-[var(--crm-info-soft)]">View full calendar<Icon name="chevron_right" className="text-[17px]" /></Link>
    </section>
  )
}

export function QueueCard({ data, selected, onToggle, onAction, onCreateCallingList }: {
  data: MyDayData
  selected: Set<string>
  onToggle: (id: string) => void
  onAction: (item: MyDayQueueItem) => void
  onCreateCallingList: () => void
}) {
  const callableSelected = data.queue.filter((item) => selected.has(item.id) && item.leadId && item.phone)
  return (
    <section aria-labelledby="priority-queue-title" className="crm-panel flex min-h-[284px] min-w-0 flex-col rounded-xl">
      <div className="flex items-center gap-2 px-4 pt-3">
        <h2 id="priority-queue-title" className="text-[22px] font-black tracking-[-0.02em]">Priority Queue / Next Best Actions</h2>
        <span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-xs font-black text-[var(--crm-text-muted)]">{data.queue.length}</span>
      </div>
      <div className="mt-1 flex-1 overflow-x-auto px-4">
        {data.queue.length === 0 ? (
          <div className="flex min-h-[190px] flex-col items-center justify-center text-center"><Icon name="task_alt" className="text-[28px] text-[var(--crm-success)]" /><p className="mt-2 text-xs font-bold">Queue cleared</p><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">No open Casey tasks require action.</p></div>
        ) : (
          <table className="w-full min-w-[820px] table-fixed text-[12px]">
            <thead className="text-[10px] font-black uppercase tracking-[0.04em] text-[var(--crm-text-muted)]">
              <tr><th className="w-8 py-1"><span className="sr-only">Select</span></th><th className="w-[30%] py-1 text-left">Lead / Task</th><th className="w-[22%] py-1 text-left">Stage / Source</th><th className="w-[14%] py-1 text-left">Priority</th><th className="w-[16%] py-1 text-center">Next Action</th><th className="py-1 text-left">Due By</th></tr>
            </thead>
            <tbody>
              {data.queue.map((item, index) => {
                const stageStyle = STAGE_STYLES[item.stage] || 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text)]'
                const initials = item.leadName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '—'
                const avatarTones = ['bg-[#e7efff] text-[#235fc0]', 'bg-[#eee8ff] text-[#6d28d9]', 'bg-[#e8f7ef] text-[#08753f]', 'bg-[#fff0e8] text-[#b84b14]']
                return (
                  <tr key={item.id} className="border-t border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]">
                    <td className="py-2"><input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} aria-label={`Select ${item.leadName}`} className="h-4 w-4 accent-[var(--crm-brand)]" /></td>
                    <td className="py-2 pr-2"><Link href={item.leadId ? `/leads/${item.leadId}` : '/tasks'} prefetch={false} className="flex min-w-0 items-center gap-2"><span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black', avatarTones[index % avatarTones.length])}>{initials}</span><span className="min-w-0"><strong className="block truncate text-xs">{item.leadName}</strong><span className="block truncate text-[10px] text-[var(--crm-text-muted)]">{item.property}</span></span></Link></td>
                    <td className="py-2 pr-2"><span className={cn('inline-flex rounded border px-2 py-0.5 text-[10px] font-bold', stageStyle)}>{item.stage}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--crm-text-muted)]">{item.source}</span></td>
                    <td className="py-2"><span className={cn('inline-flex min-w-[64px] justify-center rounded border px-2 py-0.5 text-[10px] font-bold', PRIORITY_STYLES[item.priority])}>{item.priority}</span></td>
                    <td className="py-2 text-center"><button type="button" onClick={() => onAction(item)} className={cn('inline-flex min-w-[76px] items-center justify-center gap-1 rounded border px-2 py-1.5 text-[10px] font-black', item.action === 'Open' ? 'border-[var(--crm-info)] bg-transparent text-[var(--crm-info)]' : 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-white hover:bg-[var(--crm-brand-hover)]')}><Icon name={item.action === 'Call' ? 'call' : item.action === 'SMS' ? 'sms' : 'open_in_new'} className="text-[14px]" />{item.action}</button></td>
                    <td className={cn('py-1.5 font-bold', item.dueAt && new Date(item.dueAt).getTime() < new Date(data.generatedAt).getTime() ? 'text-[var(--crm-danger)]' : '')}>{formatDateTime(item.dueAt, 'due', data.generatedAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--crm-border)] px-4 py-2">
        <span className="text-xs font-black text-[var(--crm-text-muted)]">{selected.size} selected</span>
        <button type="button" onClick={onCreateCallingList} disabled={callableSelected.length === 0} className="crm-primary-button inline-flex min-w-[245px] items-center justify-center gap-2 rounded-md px-4 py-2.5 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45"><Icon name="format_list_numbered" className="text-[17px]" />Create Calling List ({callableSelected.length})</button>
      </div>
    </section>
  )
}

export function MyDayWorkspace({ initialData, canReviewCalls = false }: { initialData: MyDayData; canReviewCalls?: boolean }) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scorecardActive, setScorecardActive] = useState(false)
  const rangeRef = useRef(initialData.range)

  const removeReviewedAttention = useCallback((id: string) => {
    setData((current) => ({
      ...current,
      attention: {
        ...current.attention,
        items: current.attention.items.filter((item) => item.id !== id),
      },
    }))
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => {
      rangeRef.current = initialData.range
      setData(initialData)
    })
  }, [initialData])

  const loadRange = useCallback(async (request: MyDayRangeRequest, foreground = true) => {
    if (foreground) setLoading(true)
    setError(null)
    const search = new URLSearchParams({ range: request.preset || 'today' })
    if (request.from) search.set('from', request.from)
    if (request.to) search.set('to', request.to)
    try {
      const response = await fetch(`/api/my-day?${search.toString()}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'The date range could not load.')
      const next = payload as MyDayData
      rangeRef.current = next.range
      setData(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The date range could not load.')
    } finally {
      if (foreground) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (!scorecardActive) void loadRange(rangeRequest(rangeRef.current), false)
    }
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [loadRange, scorecardActive])

  return (
    <main className="relative mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-5 sm:px-6 lg:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-brand)]">Casey’s Mission Control</p>
          <h1 className="text-[30px] font-black tracking-[-0.04em]">My Day</h1>
          <p className="mt-0.5 text-xs font-semibold text-[var(--crm-text-muted)]">{greeting(data.generatedAt)}, Casey</p>
        </div>
        <div className="flex items-center gap-3">
          <MyDayDateRangeSelector range={data.range} today={centralDateKey(data.generatedAt)} loading={loading} onChange={(request) => void loadRange(request)} />
          <label className="relative">
            <span className="sr-only">Agent</span>
            <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--crm-brand)] text-[10px] font-black text-white">C</span>
            <select aria-label="Agent" value="casey" disabled className="crm-field h-12 min-w-[130px] appearance-none rounded-xl pl-11 pr-9 text-[11px] font-black outline-none disabled:cursor-default disabled:opacity-100">
              <option value="casey">Casey</option>
            </select>
            <Icon name="expand_more" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[17px] text-[var(--crm-text-muted)]" />
          </label>
        </div>
      </header>
      {error ? <div role="alert" className="flex items-center justify-between rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-2 text-xs font-bold text-[var(--crm-danger)]"><span>{error}</span><button type="button" onClick={() => void loadRange(rangeRequest(data.range))} className="underline">Retry</button></div> : null}
      <MojoFreshnessAlert data={data} />
      <FunnelCard data={data} />
      <ReconciliationAttention data={data} onReviewed={removeReviewedAttention} />
      <WeeklySnapshot data={data} />
      {canReviewCalls ? <MyDayCallReview onReviewActiveChange={setScorecardActive} /> : null}
      <CaseyAndonQueue />
      {loading ? <div role="status" aria-live="polite" className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-[var(--crm-canvas)]/70 backdrop-blur-[1px]"><span className="rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2 text-xs font-black shadow-lg">Loading {data.range.label.toLowerCase()}…</span></div> : null}
    </main>
  )
}
