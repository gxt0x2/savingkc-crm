'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Icon } from '@/components/ui/icon'
import {
  CONVERSION_RANGES,
  isConversionRange,
  type ChartPoint,
  type ConversionRange,
  type LandingPageRow,
  type MetricStatus,
  type SeriesPoint,
  type WebsiteConversionReport,
} from '@/lib/marketing/website-conversion'

const RANGE_LABELS: Record<ConversionRange, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
}

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('en-US')
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatPosition(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(1)
}

function formatWhen(value: string | null): string {
  if (!value) return 'No run recorded'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function metricText(status: MetricStatus, value: number | null, format: (value: number) => string): string {
  if (status === 'missing') return 'Not synced'
  if (value == null) return '—'
  return format(value)
}

function Sparkline({ series, field, label }: { series: SeriesPoint[]; field: 'sessions' | 'engagedSessions' | 'clicks'; label: string }) {
  const values = series.map((point) => point[field])
  if (values.every((value) => value == null)) return null
  const numbers = values.map((value) => value ?? 0)
  const max = Math.max(...numbers, 1)
  const min = Math.min(...numbers, 0)
  const span = Math.max(max - min, 1)
  if (numbers.length < 2) {
    return <div role="img" aria-label={label} className="mt-2 h-7"><span className="block h-full w-2 rounded-sm bg-[#1769e0]" /></div>
  }
  const points = numbers.map((value, index) => `${(index / (numbers.length - 1)) * 138},${28 - ((value - min) / span) * 24}`).join(' ')
  return <svg role="img" aria-label={label} viewBox="0 0 138 32" className="mt-2 h-7 w-full overflow-visible"><polyline points={points} fill="none" stroke="#1769e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function Bars({ points, field, label }: { points: ChartPoint[]; field: 'sessions' | 'engagedSessions' | 'clicks'; label: string }) {
  if (points.every((point) => point[field] == null)) {
    return <p className="rounded-xl bg-[var(--crm-surface-subtle)] px-3 py-6 text-center text-xs font-semibold text-[var(--crm-text-muted)]">No rows for this range.</p>
  }
  const max = Math.max(...points.map((point) => point[field] ?? 0), 1)
  return (
    <div className="flex h-28 items-end gap-1" role="img" aria-label={label}>
      {points.map((point, index) => {
        const value = point[field]
        const height = value == null ? 0 : Math.max((value / max) * 100, value > 0 ? 8 : 0)
        return (
          <div key={`${point.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={value == null ? `${point.label}: no row` : `${point.label}: ${value.toLocaleString('en-US')}`}>
            <div className="flex h-16 w-full items-end rounded-sm bg-[var(--crm-surface-subtle)]">
              <span className="block w-full rounded-sm bg-[#1769e0]" style={{ height: `${height}%` }} />
            </div>
            <span className="max-w-full truncate text-[9px] font-bold text-[var(--crm-text-muted)]">{point.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ label, value, detail, series, field }: { label: string; value: string; detail: string; series?: SeriesPoint[]; field?: 'sessions' | 'engagedSessions' | 'clicks' }) {
  return (
    <article className="crm-panel flex min-h-[148px] flex-col rounded-2xl p-3.5">
      <p className="text-[10px] font-black uppercase tracking-[0.06em] text-[var(--crm-text-muted)]">{label}</p>
      <strong className="mt-2 text-[25px] font-black tracking-[-0.04em] text-[var(--crm-ink)]">{value}</strong>
      <span className="mt-1 text-[10px] font-semibold leading-4 text-[var(--crm-text-muted)]">{detail}</span>
      {series && field ? <Sparkline series={series} field={field} label={`${label} trend`} /> : <span className="mt-auto" />}
    </article>
  )
}

function EmptyNote({ children }: { children: string }) {
  return <p className="rounded-xl bg-[var(--crm-surface-subtle)] px-3 py-6 text-center text-xs font-semibold text-[var(--crm-text-muted)]">{children}</p>
}

function PageTable({ rows, empty, rank }: { rows: LandingPageRow[]; empty: string; rank: 'sessions' | 'engaged' }) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[11px]">
        <thead className="text-[9px] uppercase tracking-[0.05em] text-[var(--crm-text-muted)]">
          <tr>
            <th className="pb-2 font-black">Landing page</th>
            <th className="pb-2 text-right font-black">Sessions</th>
            <th className="pb-2 text-right font-black">Engaged</th>
            <th className="pb-2 text-right font-black">Engagement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--crm-border)]">
          {rows.map((row) => (
            <tr key={`${rank}-${row.path}`}>
              <td className="py-2 pr-3 font-black text-[var(--crm-ink)]">{row.path}</td>
              <td className="py-2 text-right">{formatCount(row.sessions)}</td>
              <td className="py-2 text-right">{formatCount(row.engagedSessions)}</td>
              <td className="py-2 text-right">{formatPercent(row.engagementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="crm-panel min-w-0 overflow-hidden rounded-2xl">
      <header className="border-b border-[var(--crm-border)] px-4 py-3">
        <h2 className="text-xs font-black uppercase tracking-[0.04em] text-[var(--crm-ink)]">{title}</h2>
        {hint ? <p className="mt-1 text-[10px] font-semibold leading-4 text-[var(--crm-text-muted)]">{hint}</p> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

export function WebsiteConversionPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requested = searchParams.get('range')
  const range: ConversionRange = isConversionRange(requested) ? requested : 'day'
  const [report, setReport] = useState<WebsiteConversionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/marketing/website-conversion?range=${range}`, { signal, cache: 'no-store' })
      const body = await response.json() as WebsiteConversionReport & { error?: string }
      if (!response.ok) throw new Error(body.error || 'Website conversion data could not be read.')
      setReport(body)
    } catch (cause) {
      if (signal?.aborted) return
      setReport(null)
      setError(cause instanceof Error ? cause.message : 'Website conversion data could not be read.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function selectRange(next: ConversionRange) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const ga4Missing = report?.ga4.status === 'missing'
  const gscMissing = report?.gsc.status === 'missing'

  return (
    <main className="mx-auto w-full max-w-[1720px] space-y-3 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <header className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-5 py-4 shadow-[var(--crm-shadow-sm)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="crm-eyebrow">Mission control</p>
            <h1 className="mt-1 text-[25px] font-black tracking-[-0.035em] text-[var(--crm-ink)]">Website conversion</h1>
            <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-[var(--crm-text-muted)]">
              {report ? `${report.window.label} · through the last complete Chicago day` : 'Day, week, month, quarter, and year through the last complete Chicago day.'}
              {' '}Numbers come from the nightly GA4 and Search Console warehouse. A section stays blank when that sync has not written the range.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Date range" className="flex rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-1">
              {CONVERSION_RANGES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={range === option}
                  onClick={() => selectRange(option)}
                  className={`h-9 rounded-lg px-3 text-xs font-black ${range === option ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'}`}
                >
                  {RANGE_LABELS[option]}
                </button>
              ))}
            </div>
            <Link href="/reports/marketing" className="crm-secondary-button inline-flex h-10 items-center rounded-xl px-3 text-xs font-black">Marketing overview</Link>
          </div>
        </div>
      </header>

      {error ? (
        <div role="alert" className="crm-panel rounded-2xl px-4 py-3 text-sm text-[var(--crm-danger)]">
          {error} <button type="button" onClick={() => void load()} className="font-black underline">Try again</button>
        </div>
      ) : null}

      {loading && !report ? (
        <div role="status" className="crm-panel rounded-2xl px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading website conversion.</div>
      ) : null}

      {report ? (
        <div className={`space-y-3 ${loading ? 'opacity-70' : ''}`} aria-busy={loading}>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Website conversion metrics">
            <MetricCard label="Sessions" value={metricText(report.ga4.status, report.ga4.sessions, formatCount)} detail={ga4Missing ? 'ga4_landing_daily has no rows for this range' : `${formatCount(report.ga4.daysWithRows)} ${report.ga4.daysWithRows === 1 ? 'day' : 'days'} with GA4 rows`} series={report.series} field="sessions" />
            <MetricCard label="Engaged sessions" value={metricText(report.ga4.status, report.ga4.engagedSessions, formatCount)} detail={ga4Missing ? 'Waiting on the nightly GA4 sync' : 'GA4 engagedSessions'} series={report.series} field="engagedSessions" />
            <MetricCard label="Engagement rate" value={metricText(report.ga4.status, report.ga4.engagementRate, formatPercent)} detail="Engaged sessions divided by sessions" />
            <MetricCard label="Search clicks" value={metricText(report.gsc.status, report.gsc.clicks, formatCount)} detail={gscMissing ? 'gsc_page_query_daily has no rows for this range' : `${formatCount(report.gsc.impressions)} impressions · ${formatPercent(report.gsc.ctr)} CTR`} series={report.series} field="clicks" />
            <MetricCard label="Search impressions" value={metricText(report.gsc.status, report.gsc.impressions, formatCount)} detail={gscMissing ? 'Waiting on the nightly Search Console sync' : `Avg. position ${formatPosition(report.gsc.averagePosition)}`} />
            <MetricCard label="Website form leads" value={metricText(report.leads.status, report.leads.websiteForm, formatCount)} detail="leads.source = website_form" />
            <MetricCard label="Session to form" value={report.ga4.status === 'missing' || report.leads.status === 'missing' ? 'Not synced' : formatPercent(report.rates.sessionToForm)} detail="Website form leads divided by GA4 sessions" />
            <MetricCard label="Engaged to form" value={report.ga4.status === 'missing' || report.leads.status === 'missing' ? 'Not synced' : formatPercent(report.rates.engagedToForm)} detail="Website form leads divided by engaged sessions" />
          </section>

          <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Sessions" hint="Daily inside the day, week, and month. Weekly inside the quarter. Monthly inside the year. A gap is a day the warehouse did not store.">
              {ga4Missing ? <EmptyNote>No GA4 rows for this range.</EmptyNote> : <Bars points={report.chart} field="sessions" label="Sessions by period" />}
            </Panel>
            <Panel title="Search clicks" hint={report.gsc.aggregation}>
              {gscMissing ? <EmptyNote>No Search Console rows for this range.</EmptyNote> : <Bars points={report.chart} field="clicks" label="Search clicks by period" />}
            </Panel>
          </section>

          <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Source split" hint="GA4 session source / medium, rolled into the six buckets Ernest reviews.">
              {ga4Missing ? <EmptyNote>Source split waits for GA4 rows.</EmptyNote> : (
                <div className="space-y-3">
                  {report.sources.map((source) => (
                    <div key={source.key}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
                        <span className="font-black text-[var(--crm-ink)]">{source.label}</span>
                        <span className="font-semibold text-[var(--crm-text-muted)]">{formatCount(source.sessions)} · {formatPercent(source.share)} · {formatPercent(source.engagementRate)} engaged</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--crm-surface-subtle)]">
                        <span className="block h-full rounded-full bg-[#1769e0]" style={{ width: `${Math.max((source.share ?? 0) * 100, source.sessions > 0 ? 2 : 0)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Suggestions" hint="Rule checks only. Nothing on this panel is written by a model.">
              {ga4Missing ? <EmptyNote>Page rules stay quiet until GA4 rows exist for this range.</EmptyNote> : report.suggestions.length === 0 ? <EmptyNote>No rule fired for this range.</EmptyNote> : (
                <ul className="space-y-2">
                  {report.suggestions.map((suggestion) => (
                    <li key={suggestion.id} className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon name={suggestion.severity === 'act' ? 'priority_high' : 'lightbulb'} className={suggestion.severity === 'act' ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-info)]'} />
                        <strong className="text-xs text-[var(--crm-ink)]">{suggestion.title}</strong>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-[var(--crm-text)]">{suggestion.detail}</p>
                      <p className="mt-1 text-[10px] font-semibold text-[var(--crm-text-muted)]">{suggestion.rule}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <Panel title="Top landing pages by sessions" hint="Paths from GA4. Blank and (not set) stay labeled instead of being dropped.">
              <PageTable rows={report.landingPagesBySessions} rank="sessions" empty={ga4Missing ? 'No GA4 landing pages for this range.' : 'No landing page recorded a session in this range.'} />
            </Panel>
            <Panel title="Top landing pages by engaged sessions" hint="Same rows, ranked by engaged sessions. Pages with zero engaged sessions are left off this list.">
              <PageTable rows={report.landingPagesByEngaged} rank="engaged" empty={ga4Missing ? 'No GA4 landing pages for this range.' : 'No landing page recorded an engaged session in this range.'} />
            </Panel>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <Panel title="First-party funnel" hint="ppc_tracking_events, tests excluded. Landing is ppc_landing_request or ppc_visit_started. Later is any other event except legacy attribution backfill.">
              {report.funnel.status === 'missing' ? <EmptyNote>ppc_tracking_events could not be read for this range.</EmptyNote> : (
                <table className="w-full text-left text-[11px]">
                  <tbody className="divide-y divide-[var(--crm-border)]">
                    {[
                      ['Landing events', formatCount(report.funnel.landingEvents)],
                      ['Later events', formatCount(report.funnel.laterEvents)],
                      ['Landing sessions', formatCount(report.funnel.landingSessions)],
                      ['Later sessions', formatCount(report.funnel.laterSessions)],
                      ['Sessions with a later event', formatCount(report.funnel.sessionsWithLaterEvent)],
                      ['Landing events without a session id', formatCount(report.funnel.unsessionedLandingEvents)],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <th className="py-2 pr-3 text-left font-semibold text-[var(--crm-text-muted)]">{label}</th>
                        <td className="py-2 text-right font-black text-[var(--crm-ink)]">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel title="Call intent" hint="Tel clicks are phone_click and skc_phone_number_selected. Phone leads are google_ads_phone and google_ads_tax_phone.">
              <table className="w-full text-left text-[11px]">
                <tbody className="divide-y divide-[var(--crm-border)]">
                  <tr>
                    <th className="py-2 pr-3 text-left font-semibold text-[var(--crm-text-muted)]">Tel clicks</th>
                    <td className="py-2 text-right font-black text-[var(--crm-ink)]">{metricText(report.callIntent.telStatus, report.callIntent.telClicks, formatCount)}</td>
                  </tr>
                  <tr>
                    <th className="py-2 pr-3 text-left font-semibold text-[var(--crm-text-muted)]">Google Ads phone leads</th>
                    <td className="py-2 text-right font-black text-[var(--crm-ink)]">{metricText(report.callIntent.leadStatus, report.callIntent.googleAdsPhoneLeads, formatCount)}</td>
                  </tr>
                  <tr>
                    <th className="py-2 pr-3 text-left font-semibold text-[var(--crm-text-muted)]">google_ads_phone</th>
                    <td className="py-2 text-right font-black text-[var(--crm-ink)]">{metricText(report.leads.status, report.leads.googleAdsPhone, formatCount)}</td>
                  </tr>
                  <tr>
                    <th className="py-2 pr-3 text-left font-semibold text-[var(--crm-text-muted)]">google_ads_tax_phone</th>
                    <td className="py-2 text-right font-black text-[var(--crm-ink)]">{metricText(report.leads.status, report.leads.googleAdsTaxPhone, formatCount)}</td>
                  </tr>
                </tbody>
              </table>
            </Panel>
          </section>

          <details className="crm-panel rounded-2xl px-4 py-3 text-xs leading-5 text-[var(--crm-text-muted)]">
            <summary className="cursor-pointer font-black text-[var(--crm-ink)]">How the nightly sync feeds this board</summary>
            <p className="mt-2">
              Supabase pg_cron job <span className="font-black">analytics-sync-nightly</span> runs at 08:17 UTC and calls the <span className="font-black">analytics-sync</span> edge function in nightly mode.
              That pull writes the last three days, through yesterday, into <span className="font-black">ga4_landing_daily</span> and <span className="font-black">gsc_page_query_daily</span>.
              This page only reads those tables, plus <span className="font-black">leads</span> and <span className="font-black">ppc_tracking_events</span>. It does not call Google.
            </p>
            <p className="mt-2">
              GA4 covered through {report.freshness.ga4.coveredThrough ?? 'no successful run'} · last run {report.freshness.ga4.latestStatus ?? 'none'} {formatWhen(report.freshness.ga4.latestFinishedAt)} · newest stored date {report.ga4.latestDate ?? 'none'}.
            </p>
            <p>
              Search Console covered through {report.freshness.gsc.coveredThrough ?? 'no successful run'} · last run {report.freshness.gsc.latestStatus ?? 'none'} {formatWhen(report.freshness.gsc.latestFinishedAt)} · newest stored date {report.gsc.latestDate ?? 'none'}.
            </p>
            {report.freshness.ga4.latestError ? <p className="mt-2 text-[var(--crm-danger)]">Latest GA4 run: {report.freshness.ga4.latestError}</p> : null}
            {report.freshness.gsc.latestError ? <p className="text-[var(--crm-danger)]">Latest Search Console run: {report.freshness.gsc.latestError}</p> : null}
          </details>

          <p className="px-1 text-[10px] font-semibold text-[var(--crm-text-dim)]">Saving KC Homebuyers, founded 2014. (816) 429-2900 · support@savingkc.com. This board reads the site warehouse. It does not buy media.</p>
        </div>
      ) : null}
    </main>
  )
}
