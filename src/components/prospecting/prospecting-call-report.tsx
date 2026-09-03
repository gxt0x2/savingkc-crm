import { Fragment } from 'react'
import Link from 'next/link'
import { ProspectingReportFilters } from '@/components/prospecting/prospecting-report-filters'
import { ProspectingSectionNav } from '@/components/prospecting/prospecting-section-nav'
import { Icon } from '@/components/ui/icon'
import { dispositionLabel, normalizeDisposition, PROSPECTING_DIALER_DISPOSITIONS } from '@/lib/dialer-dispositions'
import { formatPhone } from '@/lib/format'
import type { MyDayDateRange } from '@/lib/my-day-range'
import type { ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import type { ProspectingCallReport, ProspectingCallReportAttempt, ProspectingCallSort, ProspectingCallSortDirection } from '@/lib/server/prospecting-call-report'

type ReportView = 'calls' | 'sessions' | 'recordings'

const CHICAGO_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
})
const PROSPECTING_RESULT_LABELS = new Map(PROSPECTING_DIALER_DISPOSITIONS.map((item) => [item.id, item.label]))
const RESULT_COLORS: Record<string, { badge: string; bar: string }> = {
  spoke_with_owner: { badge: 'bg-emerald-100 text-emerald-800', bar: '#45a35a' },
  callback_requested: { badge: 'bg-sky-100 text-sky-800', bar: '#3984c6' },
  appointment_set: { badge: 'bg-violet-100 text-violet-800', bar: '#7966c2' },
  deal_potential: { badge: 'bg-teal-100 text-teal-800', bar: '#4b9c9a' },
  not_interested: { badge: 'bg-orange-100 text-orange-800', bar: '#d9822b' },
  no_answer: { badge: 'bg-[#d9dee6] text-[#354052]', bar: '#a5abb5' },
  left_voicemail: { badge: 'bg-indigo-100 text-indigo-800', bar: '#5879c7' },
  busy: { badge: 'bg-amber-100 text-amber-800', bar: '#d6a128' },
  wrong_number: { badge: 'bg-rose-100 text-rose-800', bar: '#c4515c' },
  disconnected: { badge: 'bg-red-100 text-red-800', bar: '#ba3d49' },
  dnc: { badge: 'bg-red-200 text-red-950', bar: '#882f3a' },
  dead: { badge: 'bg-[#cbc7cc] text-[#312f33]', bar: '#57545a' },
}

function dateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : CHICAGO_DATE_TIME.format(date)
}

function duration(seconds: number | null) {
  if (seconds == null) return '—'
  const safe = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function rate(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function resultLabel(status: string, disposition: string | null) {
  if (disposition) {
    const normalized = normalizeDisposition(disposition)
    return (normalized && PROSPECTING_RESULT_LABELS.get(normalized)) || dispositionLabel(disposition)
  }
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'awaiting_disposition') return 'Outcome required'
  if (status === 'connected') return 'Connected'
  if (status === 'dialing') return 'Dialing'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function resultTone(status: string, reached: boolean | null, disposition: string | null) {
  const normalized = normalizeDisposition(disposition)
  if (normalized && RESULT_COLORS[normalized]) return RESULT_COLORS[normalized].badge
  if (reached) return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (status === 'failed' || status === 'cancelled') return 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
  if (status === 'awaiting_disposition') return 'bg-amber-100 text-amber-800'
  return 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
}

function resultBarColor(disposition: string) {
  const normalized = normalizeDisposition(disposition)
  return normalized && RESULT_COLORS[normalized] ? RESULT_COLORS[normalized].bar : '#737b86'
}

function reportHref({ report, range, view, page, query, sessionId, sort, direction }: {
  report: ProspectingCallReport
  range: MyDayDateRange
  view: ReportView
  page?: number
  query?: string | null
  sessionId?: string | null
  sort: ProspectingCallSort
  direction: ProspectingCallSortDirection
}) {
  const params = new URLSearchParams({ campaign: report.campaign.id || 'all', range: range.preset })
  if (report.runNumber !== null) params.set('run', String(report.runNumber))
  if (range.preset === 'custom') { params.set('from', range.from); params.set('to', range.to) }
  if (report.filters.agentEmail) params.set('agent', report.filters.agentEmail)
  if (report.filters.callerId) params.set('caller', report.filters.callerId)
  if (view !== 'calls') params.set('view', view)
  if (view === 'calls' && query) params.set('q', query)
  if (view === 'sessions' && sessionId) params.set('session', sessionId)
  if (view === 'calls' && page && page > 1) params.set('page', String(page))
  if (sort !== 'called') params.set('sort', sort)
  if (direction !== 'desc') params.set('dir', direction)
  return `/prospecting/reports?${params.toString()}`
}

function HiddenReportFields({ report, range, view, sort, direction }: { report: ProspectingCallReport; range: MyDayDateRange; view: ReportView; sort: ProspectingCallSort; direction: ProspectingCallSortDirection }) {
  return <>
    <input type="hidden" name="campaign" value={report.campaign.id || 'all'} />
    <input type="hidden" name="range" value={range.preset} />
    {report.runNumber !== null ? <input type="hidden" name="run" value={report.runNumber} /> : null}
    {range.preset === 'custom' ? <><input type="hidden" name="from" value={range.from} /><input type="hidden" name="to" value={range.to} /></> : null}
    {report.filters.agentEmail ? <input type="hidden" name="agent" value={report.filters.agentEmail} /> : null}
    {report.filters.callerId ? <input type="hidden" name="caller" value={report.filters.callerId} /> : null}
    {view !== 'calls' ? <input type="hidden" name="view" value={view} /> : null}
    {sort !== 'called' ? <input type="hidden" name="sort" value={sort} /> : null}
    {direction !== 'desc' ? <input type="hidden" name="dir" value={direction} /> : null}
  </>
}

function EmptyReport({ campaignId }: { campaignId: string | null }) {
  return <section className="crm-panel grid min-h-72 place-items-center rounded-2xl p-8 text-center"><div>
    <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]"><Icon name="phone_disabled" className="text-3xl" /></span>
    <h2 className="mt-4 text-lg font-black text-[var(--crm-ink)]">No calls recorded for this view</h2>
    <p className="mt-2 max-w-md text-sm leading-6 text-[var(--crm-text-muted)]">The report will populate from the durable attempt ledger as numbers are dialed and outcomes are saved.</p>
    <Link href={campaignId ? `/prospecting?campaign=${encodeURIComponent(campaignId)}` : '/prospecting'} className="crm-primary-button mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Icon name="arrow_back" />Return to campaigns</Link>
  </div></section>
}

function CallRows({ attempts, showCampaign }: { attempts: ProspectingCallReportAttempt[]; showCampaign: boolean }) {
  return <>{attempts.map((attempt) => <tr key={attempt.id} className="hover:bg-[var(--crm-surface-hover)]">
    <td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(attempt.startedAt || attempt.createdAt)}</td>
    {showCampaign ? <td className="max-w-56 px-4 py-4 font-black text-[var(--crm-ink)]">{attempt.campaignName}</td> : null}
    <td className="max-w-sm px-4 py-4"><p className="font-black text-[var(--crm-ink)]">{attempt.sellerName || 'Unknown seller'}</p><p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || 'Property not linked'}</p></td>
    <td className="whitespace-nowrap px-4 py-4 font-mono font-black text-[var(--crm-ink)]">{formatPhone(attempt.phone)}</td>
    <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${resultTone(attempt.status, attempt.reached, attempt.disposition)}`}>{resultLabel(attempt.status, attempt.disposition)}</span></td>
    <td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-ink)]">{attempt.agentName}</td>
    <td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{attempt.runNumber}</td>
    <td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(attempt.durationSeconds)}</td>
    <td className="whitespace-nowrap px-5 py-4 font-mono text-[var(--crm-text-muted)]">{formatPhone(attempt.callerId)}</td>
  </tr>)}</>
}

export function ProspectingCallReportView({ report, campaigns, page, range, today, view, selectedSessionId, sort, direction }: {
  report: ProspectingCallReport
  campaigns: Array<Pick<ProspectingCampaignSummary, 'id' | 'kind' | 'name'>>
  page: number
  range: MyDayDateRange
  today: string
  view: ReportView
  selectedSessionId: string | null
  sort: ProspectingCallSort
  direction: ProspectingCallSortDirection
}) {
  const { metrics } = report
  const totalOutcomeCount = Object.values(report.outcomes).reduce((sum, value) => sum + value, 0)
  const outcomes = Object.entries(report.outcomes).sort((left, right) => right[1] - left[1])
  const reportCampaigns = campaigns.filter((campaign) => campaign.kind === 'dialer')
  const campaignOptions = report.campaign.id && !reportCampaigns.some((campaign) => campaign.id === report.campaign.id)
    ? [{ id: report.campaign.id, kind: 'dialer' as const, name: report.campaign.name }, ...reportCampaigns]
    : reportCampaigns
  const query = report.filters.search || ''

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7"><div className="mx-auto max-w-[1540px] space-y-5">
    <ProspectingSectionNav current="reports" />
    <div className="flex flex-col gap-4"><div>
      <p className="crm-eyebrow">Prospecting reports</p>
      <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--crm-ink)]">Call performance</h1>
      <p className="mt-2 text-sm text-[var(--crm-text-muted)]">List, phone, agent, session, result, and recording reporting from saved dialer attempts.</p>
    </div>
      <ProspectingReportFilters
        key={`${report.campaign.id || 'all'}:${report.runNumber || 'all'}:${report.filters.agentEmail || 'all'}:${report.filters.callerId || 'all'}:${range.preset}:${range.from}:${range.to}`}
        campaigns={campaignOptions} campaignId={report.campaign.id} runNumber={report.runNumber} runs={report.runs}
        agents={report.filters.agents} callerIds={report.filters.callerIds} agentEmail={report.filters.agentEmail} callerId={report.filters.callerId}
        range={range} today={today} view={view} sort={sort} direction={direction}
      />
    </div>

    <details open className="crm-panel group overflow-hidden rounded-2xl">
      <summary aria-label="Toggle call details" className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 bg-[var(--crm-surface-subtle)] px-4 py-3 text-xs text-[var(--crm-ink)] marker:hidden sm:px-5">
        <span className="font-black">Call details</span>
        <span className="inline-flex items-center gap-1.5 font-bold text-[var(--crm-brand)]">
          <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span>
          <span aria-hidden="true" className="text-base leading-none transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div className="border-t border-[var(--crm-border)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[var(--crm-brand-soft)] px-2.5 py-1 text-[9px] font-black uppercase text-[var(--crm-brand)]">{range.label}</span><span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">{report.runNumber ? `Run ${report.runNumber}` : 'All runs'}</span></div><h2 className="mt-2 truncate text-lg font-black text-[var(--crm-ink)]">{report.campaign.name}</h2></div><p className="text-[10px] font-bold text-[var(--crm-text-muted)]">{range.from === range.to ? range.from : `${range.from} through ${range.to}`}</p></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">{[
          [metrics.attempts, 'Total calls'], [metrics.uniqueNumbers, 'People called'], [metrics.sessions, 'Sessions'], [metrics.providerConnected, 'Connected'], [metrics.reached, 'Reached'], [`${rate(metrics.reached, metrics.uniqueNumbers)}%`, 'Contact rate'], [duration(metrics.durationSeconds), 'Call time'], [metrics.agents, 'Agents'],
        ].map(([value, label]) => <div key={String(label)} className="rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2.5"><p className="text-lg font-black leading-none text-[var(--crm-ink)]">{value}</p><p className="mt-1.5 text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}</div>
        <div className="mt-4"><div className="flex items-center justify-between gap-3 text-[10px]"><strong className="font-black text-[var(--crm-ink)]">Call results · {totalOutcomeCount} saved</strong><span className="font-semibold text-[var(--crm-text-muted)]">Contact rate = reached ÷ people called</span></div>
          {outcomes.length > 0 ? <><div aria-label="Call result distribution" className="mt-2 flex h-5 overflow-hidden rounded-md bg-[var(--crm-surface-subtle)]">{outcomes.map(([outcome, value]) => <span key={outcome} title={`${resultLabel('dispositioned', outcome)}: ${value}`} className="min-w-1" style={{ backgroundColor: resultBarColor(outcome), width: `${(value / totalOutcomeCount) * 100}%` }} />)}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">{outcomes.map(([outcome, value]) => <span key={outcome} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--crm-text-muted)]"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: resultBarColor(outcome) }} />{resultLabel('dispositioned', outcome)} <strong className="text-[var(--crm-ink)]">{value}</strong></span>)}</div></> : <p className="mt-2 text-xs text-[var(--crm-text-muted)]">No final outcomes have been saved in this view.</p>}
        </div>
        {report.agents.length > 0 ? <details className="mt-3 border-t border-[var(--crm-border)] pt-3"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Agent performance ({report.agents.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{report.agents.map((agent) => <div key={agent.email} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-black text-[var(--crm-ink)]">{agent.name}</p><p className="truncate text-[9px] text-[var(--crm-text-muted)]">{agent.email}</p></div><dl className="flex shrink-0 gap-3 text-right"><Metric label="Results" value={agent.resultsSaved} /><Metric label="Reached" value={agent.reached} /><Metric label="Rate" value={`${rate(agent.reached, agent.resultsSaved)}%`} /></dl></div>)}</div></details> : null}
      </div>
    </details>

    {metrics.attempts === 0 ? <EmptyReport campaignId={report.campaign.id} /> : <>
      <section className="crm-panel overflow-hidden rounded-2xl">
        <nav aria-label="Call report views" className="flex flex-wrap items-center gap-1 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-2">{([
          ['calls', `Call Detail (${report.attempts.pageInfo.total})`], ['sessions', `Sessions (${metrics.sessions})`], ['recordings', `Recordings (${report.recordings.total})`],
        ] as Array<[ReportView, string]>).map(([tab, label]) => <Link key={tab} href={reportHref({ report, range, view: tab, sort, direction })} scroll={false} aria-current={view === tab ? 'page' : undefined} className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${view === tab ? 'bg-[var(--crm-brand)] text-white shadow-sm' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface)] hover:text-[var(--crm-ink)]'}`}>{label}</Link>)}</nav>
        {view === 'calls' ? <CallDetail report={report} range={range} page={page} query={query} sort={sort} direction={direction} /> : null}
        {view === 'sessions' ? <Sessions report={report} range={range} selectedSessionId={selectedSessionId} sort={sort} direction={direction} /> : null}
        {view === 'recordings' ? <Recordings report={report} /> : null}
      </section>
    </>}
  </div></main>
}

function SortHeader({ label, sortKey, activeSort, direction, href, edge = false }: { label: string; sortKey: ProspectingCallSort; activeSort: ProspectingCallSort; direction: ProspectingCallSortDirection; href: string; edge?: boolean }) {
  const active = activeSort === sortKey
  const nextDirection = active ? (direction === 'asc' ? 'descending' : 'ascending') : 'ascending'
  return <th scope="col" data-sort-control={sortKey} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-0">
    <Link href={href} scroll={false} title={`Sort ${label} ${nextDirection}`} className={`group/sort flex min-h-11 w-full items-center justify-between gap-2 whitespace-nowrap px-3 text-left transition hover:bg-[var(--crm-surface-hover)] hover:text-[var(--crm-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--crm-brand)] ${edge ? 'sm:px-5' : 'sm:px-4'} ${active ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : ''}`} aria-label={`Sort by ${label}${active ? ` ${direction === 'asc' ? 'descending' : 'ascending'}` : ''}`}>
      <span>{label}</span>
      <span aria-hidden="true" className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition ${active ? 'border-[var(--crm-brand)] bg-[var(--crm-surface)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] group-hover/sort:border-[var(--crm-brand)] group-hover/sort:text-[var(--crm-brand)]'}`}>
        <span className="text-sm font-black leading-none">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </span>
    </Link>
  </th>
}

function CallDetail({ report, range, page, query, sort, direction }: { report: ProspectingCallReport; range: MyDayDateRange; page: number; query: string; sort: ProspectingCallSort; direction: ProspectingCallSortDirection }) {
  function sortHref(sortKey: ProspectingCallSort) {
    const nextDirection = sort === sortKey ? (direction === 'asc' ? 'desc' : 'asc') : sortKey === 'called' || sortKey === 'duration' ? 'desc' : 'asc'
    return reportHref({ report, range, view: 'calls', query, sort: sortKey, direction: nextDirection })
  }

  return <>
    <div className="flex flex-col gap-3 border-b border-[var(--crm-border)] p-4 sm:flex-row sm:items-end sm:justify-between sm:px-5"><div><p className="crm-eyebrow">Call detail</p><h2 className="mt-1 text-base font-black text-[var(--crm-ink)]">Every number and result</h2><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">Select any column heading to sort all matching calls · Central Time</p></div><form action="/prospecting/reports" className="flex w-full max-w-md gap-2"><HiddenReportFields report={report} range={range} view="calls" sort={sort} direction={direction} /><label className="sr-only" htmlFor="prospecting-call-search">Search call details</label><input id="prospecting-call-search" name="q" defaultValue={query} placeholder="Search seller, property, phone, result…" className="crm-field h-10 min-w-0 flex-1 rounded-lg px-3 text-xs" /><button type="submit" className="crm-secondary-button inline-flex h-10 items-center rounded-lg px-3 text-xs font-black">Search</button></form></div>
    {report.attempts.items.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[72rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><SortHeader label="Called" sortKey="called" activeSort={sort} direction={direction} href={sortHref('called')} edge />{report.campaign.id === null ? <SortHeader label="Campaign" sortKey="campaign" activeSort={sort} direction={direction} href={sortHref('campaign')} /> : null}<SortHeader label="Seller / property" sortKey="seller" activeSort={sort} direction={direction} href={sortHref('seller')} /><SortHeader label="Number" sortKey="number" activeSort={sort} direction={direction} href={sortHref('number')} /><SortHeader label="Result" sortKey="result" activeSort={sort} direction={direction} href={sortHref('result')} /><SortHeader label="Agent" sortKey="agent" activeSort={sort} direction={direction} href={sortHref('agent')} /><SortHeader label="Run" sortKey="run" activeSort={sort} direction={direction} href={sortHref('run')} /><SortHeader label="Duration" sortKey="duration" activeSort={sort} direction={direction} href={sortHref('duration')} /><SortHeader label="Caller ID" sortKey="caller" activeSort={sort} direction={direction} href={sortHref('caller')} edge /></tr></thead><tbody className="divide-y divide-[var(--crm-border)]"><CallRows attempts={report.attempts.items} showCampaign={report.campaign.id === null} /></tbody></table></div> : <div className="grid min-h-48 place-items-center p-8 text-center"><div><Icon name="search_off" className="text-3xl text-[var(--crm-text-dim)]" /><h3 className="mt-2 font-black text-[var(--crm-ink)]">No matching calls</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Clear the search or adjust the report filters.</p></div></div>}
    <div className="flex items-center justify-between gap-3 border-t border-[var(--crm-border)] p-4 sm:px-6"><p className="text-xs font-bold text-[var(--crm-text-muted)]">Page {page}</p><div className="flex gap-2">{page > 1 ? <Link href={reportHref({ report, range, view: 'calls', page: page - 1, query, sort, direction })} scroll={false} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black"><Icon name="chevron_left" />Previous</Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40"><Icon name="chevron_left" />Previous</span>}{report.attempts.pageInfo.hasMore ? <Link href={reportHref({ report, range, view: 'calls', page: page + 1, query, sort, direction })} scroll={false} className="crm-secondary-button inline-flex min-h-10 items-center gap-1 rounded-xl px-4 text-xs font-black">Next<Icon name="chevron_right" /></Link> : <span className="crm-secondary-button inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-xl px-4 text-xs font-black opacity-40">Next<Icon name="chevron_right" /></span>}</div></div>
  </>
}

function Sessions({ report, range, selectedSessionId, sort, direction }: { report: ProspectingCallReport; range: MyDayDateRange; selectedSessionId: string | null; sort: ProspectingCallSort; direction: ProspectingCallSortDirection }) {
  return <><div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Session history</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">List batches and performance</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Open a session to reconcile its calls, outcomes, and timing.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[76rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Started</th>{report.campaign.id === null ? <th className="px-4 py-3">Campaign</th> : null}<th className="px-4 py-3">Agent</th><th className="px-4 py-3">Run</th><th className="px-4 py-3">Calls</th><th className="px-4 py-3">Numbers</th><th className="px-4 py-3">Results</th><th className="px-4 py-3">Reached</th><th className="px-4 py-3">Call time</th><th className="px-4 py-3">Session time</th><th className="px-4 py-3">Status</th><th className="px-5 py-3"><span className="sr-only">Details</span></th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.sessions.map((session) => {
    const open = selectedSessionId === session.id
    return <Fragment key={session.id}><tr className={open ? 'bg-[var(--crm-brand-soft)]' : undefined}><td className="whitespace-nowrap px-5 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(session.startedAt)}</td>{report.campaign.id === null ? <td className="max-w-56 px-4 py-4 font-black text-[var(--crm-ink)]">{session.campaignName}</td> : null}<td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.agentName}</td><td className="px-4 py-4 font-black text-[var(--crm-text-muted)]">#{session.runNumber}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.calls}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.uniqueNumbers}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.resultsSaved}</td><td className="px-4 py-4 font-black text-[var(--crm-ink)]">{session.reached}</td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(session.durationSeconds)}</td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(session.sessionDurationSeconds)}</td><td className="px-4 py-4"><span className="rounded-full bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-[10px] font-black uppercase text-[var(--crm-text-muted)]">{session.status}</span></td><td className="px-5 py-4"><Link href={reportHref({ report, range, view: 'sessions', sessionId: open ? null : session.id, sort, direction })} scroll={false} className="font-black text-[var(--crm-brand)]">{open ? 'Hide' : 'View details'}</Link></td></tr>{open ? <tr><td colSpan={report.campaign.id === null ? 12 : 11} className="bg-[var(--crm-surface-subtle)] p-5"><SessionDetails session={session} calls={report.selectedSessionCalls} /></td></tr> : null}</Fragment>
  })}</tbody></table></div></>
}

function SessionDetails({ session, calls }: { session: ProspectingCallReport['sessions'][number]; calls: ProspectingCallReportAttempt[] }) {
  const outcomes = Object.entries(session.outcomes).sort((left, right) => right[1] - left[1])
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"><div><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Calls in this session</p><h3 className="mt-1 font-black text-[var(--crm-ink)]">{calls.length} loaded call{calls.length === 1 ? '' : 's'}</h3></div><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">Up to 100 newest calls</span></div><div className="mt-3 max-h-[30rem] overflow-auto rounded-xl border border-[var(--crm-border)]"><table className="w-full min-w-[42rem] text-left text-xs"><thead className="sticky top-0 bg-[var(--crm-surface)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-4 py-3">Called</th><th className="px-4 py-3">Seller</th><th className="px-4 py-3">Number</th><th className="px-4 py-3">Result</th><th className="px-4 py-3">Duration</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{calls.map((call) => <tr key={call.id}><td className="whitespace-nowrap px-4 py-3 text-[var(--crm-text-muted)]">{dateTime(call.startedAt || call.createdAt)}</td><td className="max-w-52 px-4 py-3 font-black text-[var(--crm-ink)]">{call.sellerName || 'Unknown seller'}</td><td className="whitespace-nowrap px-4 py-3 font-mono text-[var(--crm-ink)]">{formatPhone(call.phone)}</td><td className="px-4 py-3 font-bold text-[var(--crm-ink)]">{resultLabel(call.status, call.disposition)}</td><td className="whitespace-nowrap px-4 py-3 text-[var(--crm-text-muted)]">{duration(call.durationSeconds)}</td></tr>)}</tbody></table></div></div><aside className="space-y-4"><div className="rounded-xl bg-[var(--crm-surface)] p-4"><p className="crm-eyebrow">Session timing</p><dl className="mt-3 grid grid-cols-2 gap-3"><Metric label="Calls" value={session.calls} /><Metric label="Numbers" value={session.uniqueNumbers} /><Metric label="Connected" value={session.connected} /><Metric label="Reached" value={session.reached} /><Metric label="Call time" value={duration(session.durationSeconds)} /><Metric label="Session time" value={duration(session.sessionDurationSeconds)} /></dl></div><div className="rounded-xl bg-[var(--crm-surface)] p-4"><p className="crm-eyebrow">Session results</p>{outcomes.length > 0 ? <div className="mt-3 space-y-2">{outcomes.map(([outcome, count]) => <div key={outcome} className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-[var(--crm-ink)]">{resultLabel('dispositioned', outcome)}</span><strong className="text-[var(--crm-text-muted)]">{count}</strong></div>)}</div> : <p className="mt-3 text-xs text-[var(--crm-text-muted)]">No final outcomes saved.</p>}</div></aside></div>
}

function Recordings({ report }: { report: ProspectingCallReport }) {
  return <><div className="border-b border-[var(--crm-border)] p-5 sm:px-6"><p className="crm-eyebrow">Call recordings</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Recorded prospecting conversations</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Playback stays inside the authenticated CRM; Twilio credentials are never sent to the browser.</p></div>{report.recordings.items.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[66rem] text-left text-xs"><thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Play</th><th className="px-4 py-3">Called</th><th className="px-4 py-3">Seller / property</th><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Result</th><th className="px-5 py-3">Campaign</th></tr></thead><tbody className="divide-y divide-[var(--crm-border)]">{report.recordings.items.map((attempt) => <tr key={attempt.id}><td className="min-w-64 px-5 py-3"><audio controls preload="metadata" src={`/api/recordings/${encodeURIComponent(attempt.recordingSid || '')}`} className="h-9 w-60" /></td><td className="whitespace-nowrap px-4 py-4 font-bold text-[var(--crm-text-muted)]">{dateTime(attempt.startedAt || attempt.createdAt)}</td><td className="max-w-sm px-4 py-4"><p className="font-black text-[var(--crm-ink)]">{attempt.sellerName || 'Unknown seller'}</p><p className="mt-1 truncate text-[10px] text-[var(--crm-text-muted)]">{attempt.propertyAddress || formatPhone(attempt.phone)}</p></td><td className="px-4 py-4 font-bold text-[var(--crm-ink)]">{attempt.agentName}</td><td className="px-4 py-4 font-bold text-[var(--crm-text-muted)]">{duration(attempt.durationSeconds)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${resultTone(attempt.status, attempt.reached, attempt.disposition)}`}>{resultLabel(attempt.status, attempt.disposition)}</span></td><td className="max-w-56 px-5 py-4 font-black text-[var(--crm-ink)]">{attempt.campaignName}</td></tr>)}</tbody></table></div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Icon name="mic_off" className="text-3xl text-[var(--crm-text-dim)]" /><h3 className="mt-2 font-black text-[var(--crm-ink)]">No recordings in this view</h3><p className="mt-1 max-w-md text-xs leading-5 text-[var(--crm-text-muted)]">Only completed Twilio recordings linked to durable Prospecting attempts appear here.</p></div></div>}</>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-[9px] font-black uppercase tracking-wide text-[var(--crm-text-muted)]">{label}</dt><dd className="mt-1 text-sm font-black text-[var(--crm-ink)]">{value}</dd></div>
}
